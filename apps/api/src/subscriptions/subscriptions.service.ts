import {
  BadRequestException,
  ConflictException,
  ForbiddenException,
  Injectable,
  Logger,
  NotFoundException,
  OnModuleDestroy,
  OnModuleInit,
} from '@nestjs/common';
import { Prisma } from '@eccs/db';
import {
  accessScope,
  addDaysToDate,
  can,
  cycleAnchorDay,
  cyclePeriod,
  cyclePeriodContaining,
  subscriptionPrice,
  SUBSCRIPTION_FIRST_VISIT_LEAD_DAYS,
  type BillingCycle,
  type LocalizedText,
  type OutletSubscriptionDto,
  type PlanAdminDto,
  type PlanOfferDto,
  type PlansAdminDto,
  type SubscriptionDto,
} from '@eccs/shared';
import type { AuthUser } from '../auth/auth.types.js';
import { BillingService } from '../billing/billing.service.js';
import { indiaDate } from '../checklists/checklists.service.js';
import { env } from '../config/env.js';
import { NotifyService, type Actor } from '../notifications/notify.service.js';
import { PrismaService } from '../prisma/prisma.service.js';
import { PlansService } from '../services/plans.service.js';

const CHECK_EVERY_MS = 6 * 60 * 60 * 1000;
// After the diary has been filled (15 seconds) and before invoices are raised (50 seconds).
const FIRST_CHECK_AFTER_MS = 35_000;
// A subscription that has not ended: it is running, or ECCS has paused it.
const LIVE = ['ACTIVE', 'PAUSED'] as const;
// The server itself, when a renewal ends a plan with nobody pressing a button.
const SYSTEM: Actor = { id: 'system', memberships: [] };

const toDbDate = (date: string) => new Date(`${date}T00:00:00.000Z`);
const fromDbDate = (date: Date) => date.toISOString().slice(0, 10);
const toPaise = (rupees: number) => Math.round(rupees * 100);

const planInclude = {
  lines: { include: { serviceType: { select: { id: true, code: true, name: true } } }, orderBy: { intervalDays: 'asc' } },
} as const satisfies Prisma.PlanInclude;

const subscriptionInclude = {
  plan: { include: planInclude },
  schedules: {
    where: { isActive: true },
    include: {
      serviceType: { select: { code: true, name: true } },
      jobs: {
        where: { status: { in: ['SCHEDULED', 'ASSIGNED', 'IN_PROGRESS'] } },
        orderBy: { scheduledDate: 'asc' },
        take: 1,
        select: { scheduledDate: true },
      },
    },
    orderBy: { intervalDays: 'asc' },
  },
} as const satisfies Prisma.SubscriptionInclude;

type PlanRow = Prisma.PlanGetPayload<{ include: typeof planInclude }>;
type SubscriptionRow = Prisma.SubscriptionGetPayload<{ include: typeof subscriptionInclude }>;
/** A subscription whose price and cycle dates are known to be filled in (see `filled`). */
type Filled = SubscriptionRow & { pricePaise: number; billingCycle: BillingCycle; currentPeriodStart: Date; currentPeriodEnd: Date };

type LineInput = { serviceCode: string; intervalDays: number };

/** The console writes English only: a change replaces the English and leaves the other languages as they were. */
function withEnglish(existing: unknown, english: string): Prisma.InputJsonObject {
  const kept = existing && typeof existing === 'object' && !Array.isArray(existing) ? (existing as Prisma.InputJsonObject) : {};
  return { ...kept, en: english };
}

/**
 * Plans as ECCS configures them, and an outlet's subscription from the day it
 * starts to the day it ends.
 *
 * The rules, in one place:
 * - An outlet has at most one subscription that has not ended.
 * - The price and the billing cycle are copied from the plan when the
 *   subscription starts and again at each renewal. What the outlet gets (its
 *   recurring services) is copied the same way. So editing a plan changes
 *   nothing for a subscriber until their next cycle starts.
 * - A change of plan, and a cancellation by the restaurant, take effect when
 *   the cycle already invoiced ends. Both can be undone until then.
 * - Paused (ECCS only): no new visits are added and it is not renewed, so no
 *   new invoice is raised. Visits already in the diary stay; ECCS cancels any
 *   that should not happen. Resumed within the same cycle, it carries on as it
 *   was. Resumed after that cycle has ended, a fresh cycle starts that day.
 *
 * This module never creates invoices: billing reads the cycle dates kept here.
 */
@Injectable()
export class SubscriptionsService implements OnModuleInit, OnModuleDestroy {
  private readonly logger = new Logger(SubscriptionsService.name);
  private timers: NodeJS.Timeout[] = [];

  constructor(
    private readonly prisma: PrismaService,
    private readonly plans: PlansService,
    private readonly notify: NotifyService,
    private readonly billing: BillingService,
  ) {}

  private get db() {
    return this.prisma.client;
  }

  /** Renews what is due shortly after the server starts and a few times a day after that. */
  onModuleInit() {
    // Tests renew at moments they choose.
    if (env.NODE_ENV === 'test') return;
    const check = () =>
      void this.renewDue()
        .then(
          ({ renewed, cancelled }) =>
            renewed + cancelled > 0 && this.logger.log(`Subscriptions: ${renewed} renewed, ${cancelled} ended at the end of their cycle`),
        )
        .catch((error) => this.logger.warn(`Could not renew subscriptions: ${String(error)}`));
    const first = setTimeout(check, FIRST_CHECK_AFTER_MS);
    const repeat = setInterval(check, CHECK_EVERY_MS);
    // Neither keeps the server alive when it is asked to stop.
    first.unref();
    repeat.unref();
    this.timers = [first, repeat];
  }

  onModuleDestroy() {
    for (const timer of this.timers) clearTimeout(timer);
  }

  // ───────────────────────── Plans ─────────────────────────

  /** The plans a restaurant can choose from, cheapest first. */
  async offered(): Promise<PlanOfferDto[]> {
    const plans = await this.db.plan.findMany({ where: { isActive: true }, include: planInclude, orderBy: { pricePaise: 'asc' } });
    return plans.map(toOffer);
  }

  /** Everything on the console's Plans page: every plan, offered or not, and the kinds of service a line can be for. */
  async adminOverview(): Promise<PlansAdminDto> {
    const [plans, live, kinds] = await Promise.all([
      this.db.plan.findMany({ include: planInclude, orderBy: [{ isActive: 'desc' }, { pricePaise: 'asc' }, { createdAt: 'asc' }] }),
      this.db.subscription.findMany({ where: { status: { in: [...LIVE] } }, select: { planId: true, pendingPlanId: true } }),
      this.db.serviceType.findMany({ orderBy: { code: 'asc' }, select: { code: true, name: true, isActive: true } }),
    ]);
    return {
      plans: plans.map(
        (plan): PlanAdminDto => ({
          ...toOffer(plan),
          id: plan.id,
          isActive: plan.isActive,
          subscriberCount: live.filter((subscription) => subscription.planId === plan.id).length,
          incomingCount: live.filter((subscription) => subscription.pendingPlanId === plan.id).length,
          createdAt: plan.createdAt.toISOString(),
        }),
      ),
      kinds: kinds.map((kind) => ({ code: kind.code, name: kind.name as LocalizedText, isActive: kind.isActive })),
    };
  }

  async createPlan(input: {
    name: string;
    description?: string | undefined;
    priceRupees: number;
    billingCycle: BillingCycle;
    lines: LineInput[];
  }): Promise<PlansAdminDto> {
    const lines = await this.resolveLines(input.lines);
    await this.db.plan.create({
      data: {
        code: await this.newPlanCode(input.name),
        name: { en: input.name },
        ...(input.description && { description: { en: input.description } }),
        pricePaise: toPaise(input.priceRupees),
        billingCycle: input.billingCycle,
        lines: { create: lines },
      },
    });
    return this.adminOverview();
  }

  /**
   * Changes a plan where it is. That is safe because a subscription does not
   * read its price or its services from the plan: it keeps its own copy, made
   * when it started and refreshed each time it renews. So an outlet already
   * on the plan pays and gets what it had until its current cycle ends, and
   * the change reaches it with its next cycle.
   *
   * A plan is never deleted. "No longer offered" only stops new subscribers;
   * outlets already on it keep it and go on renewing.
   */
  async updatePlan(
    planId: string,
    input: {
      name?: string | undefined;
      description?: string | undefined;
      priceRupees?: number | undefined;
      billingCycle?: BillingCycle | undefined;
      lines?: LineInput[] | undefined;
      isActive?: boolean | undefined;
    },
  ): Promise<PlansAdminDto> {
    const plan = await this.db.plan.findUnique({ where: { id: planId } });
    if (!plan) throw new NotFoundException('Plan not found');
    const lines = input.lines === undefined ? null : await this.resolveLines(input.lines);

    await this.db.$transaction(async (tx) => {
      await tx.plan.update({
        where: { id: plan.id },
        data: {
          ...(input.name !== undefined && { name: withEnglish(plan.name, input.name) }),
          // An emptied description is removed in every language. Prisma wants its own marker (DbNull) to empty a JSON column.
          ...(input.description !== undefined && {
            description: input.description ? withEnglish(plan.description, input.description) : Prisma.DbNull,
          }),
          ...(input.priceRupees !== undefined && { pricePaise: toPaise(input.priceRupees) }),
          ...(input.billingCycle !== undefined && { billingCycle: input.billingCycle }),
          ...(input.isActive !== undefined && { isActive: input.isActive }),
        },
      });
      if (!lines) return;
      await tx.planLine.deleteMany({
        where: { planId: plan.id, serviceTypeId: { notIn: lines.map((line) => line.serviceTypeId) } },
      });
      for (const line of lines) {
        await tx.planLine.upsert({
          where: { planId_serviceTypeId: { planId: plan.id, serviceTypeId: line.serviceTypeId } },
          create: { planId: plan.id, ...line },
          update: { intervalDays: line.intervalDays },
        });
      }
    });
    return this.adminOverview();
  }

  // ───────────────────────── An outlet's subscription ─────────────────────────

  async forOutlet(user: AuthUser, outletId: string): Promise<OutletSubscriptionDto> {
    await this.requireOutlet(user, outletId, 'read');
    return this.describe(outletId);
  }

  /**
   * Starts an outlet's subscription. The price and cycle are the plan's as
   * they are at this moment, and the first cycle starts on the start date.
   *
   * The Owner subscribes from the app: it starts today, and every service of
   * the plan is first due a few days later, so ECCS has time to give the
   * visits to a Supervisor. ECCS, from the console, may choose both dates.
   */
  async start(
    user: AuthUser,
    outletId: string,
    input: { planCode: string; startDate?: string | undefined; firstVisitDate?: string | undefined },
  ): Promise<OutletSubscriptionDto> {
    const { eccs, active } = await this.requireOutlet(user, outletId, 'manage');
    if (!active) throw new BadRequestException('This outlet is switched off, so it cannot be put on a plan');
    if (!eccs && (input.startDate !== undefined || input.firstVisitDate !== undefined)) {
      throw new BadRequestException('Only ECCS can choose the dates');
    }
    const plan = await this.db.plan.findFirst({ where: { code: input.planCode, isActive: true }, include: planInclude });
    if (!plan) throw new BadRequestException('That plan is not available');

    const today = indiaDate();
    const startDate = input.startDate ?? today;
    if (startDate < today) throw new BadRequestException('Choose today or a later date');
    const firstVisit = input.firstVisitDate ?? (eccs ? startDate : addDaysToDate(startDate, SUBSCRIPTION_FIRST_VISIT_LEAD_DAYS));
    if (firstVisit < startDate) throw new BadRequestException('The first visits cannot be before the plan starts');
    const period = cyclePeriod(startDate, plan.billingCycle);

    await this.db.$transaction(async (tx) => {
      // One at a time per outlet until this transaction ends, so two taps cannot start two subscriptions.
      await tx.$executeRaw`SELECT pg_advisory_xact_lock(hashtext(${`subscription:${outletId}`}))`;
      const existing = await tx.subscription.findFirst({ where: { outletId, status: { in: [...LIVE] } }, select: { id: true } });
      if (existing) throw new ConflictException('This outlet already has a plan');
      await tx.subscription.create({
        data: {
          outletId,
          planId: plan.id,
          startDate: toDbDate(startDate),
          pricePaise: plan.pricePaise,
          billingCycle: plan.billingCycle,
          currentPeriodStart: toDbDate(period.start),
          currentPeriodEnd: toDbDate(period.end),
          nextBillingDate: toDbDate(period.nextStart),
          schedules: {
            create: plan.lines.map((line) => ({
              outletId,
              serviceTypeId: line.serviceTypeId,
              intervalDays: line.intervalDays,
              nextDueDate: toDbDate(firstVisit),
            })),
          },
        },
      });
    });
    await this.plans.generateAll(today, outletId, user.id);
    await this.billNow(outletId);
    await this.notify.planStarted(user, outletId);
    return this.describe(outletId);
  }

  /**
   * Raises the invoice of the outlet's current cycle straight away, if it is
   * due, instead of leaving it for the billing timer: someone who has just
   * subscribed should see the invoice the confirmation promised. A failure
   * here must not undo the subscription; the timer raises it later.
   */
  private async billNow(outletId: string): Promise<void> {
    try {
      await this.billing.billDue(indiaDate(), outletId);
    } catch (error) {
      this.logger.warn(`Could not raise the invoice for outlet ${outletId} straight away: ${String(error)}`);
    }
  }

  /**
   * Asks for a different plan. Nothing changes now: the cycle already
   * invoiced runs to its end on the present plan, and the new plan, with its
   * price and services, takes over when the next cycle starts.
   */
  async changePlan(user: AuthUser, outletId: string, planCode: string): Promise<OutletSubscriptionDto> {
    await this.requireOutlet(user, outletId, 'manage');
    const subscription = await this.requireLive(outletId);
    if (subscription.cancelAtPeriodEnd) {
      throw new ConflictException('This plan is set to end. Keep the plan first, then change it.');
    }
    const plan = await this.db.plan.findFirst({ where: { code: planCode, isActive: true }, select: { id: true } });
    if (!plan) throw new BadRequestException('That plan is not available');
    if (plan.id === subscription.planId && !subscription.pendingPlanId) {
      throw new BadRequestException('The outlet is already on that plan');
    }
    // Choosing the present plan again while a change is waiting is the same as undoing the change.
    await this.db.subscription.update({
      where: { id: subscription.id },
      data: { pendingPlanId: plan.id === subscription.planId ? null : plan.id },
    });
    await this.fillDiary(outletId);
    return this.describe(outletId);
  }

  /** Undoes a change of plan that has not taken effect yet. */
  async undoChangePlan(user: AuthUser, outletId: string): Promise<OutletSubscriptionDto> {
    await this.requireOutlet(user, outletId, 'manage');
    const subscription = await this.requireLive(outletId);
    await this.db.subscription.update({ where: { id: subscription.id }, data: { pendingPlanId: null } });
    await this.fillDiary(outletId);
    return this.describe(outletId);
  }

  /** ECCS pauses a subscription: no new visits and no renewal until it is resumed. Visits already in the diary stay. */
  async pause(user: AuthUser, outletId: string): Promise<OutletSubscriptionDto> {
    await this.requireOutlet(user, outletId, 'eccs');
    const subscription = await this.requireLive(outletId);
    if (subscription.status === 'ACTIVE') {
      await this.db.subscription.update({ where: { id: subscription.id }, data: { status: 'PAUSED', pausedAt: new Date() } });
    }
    return this.describe(outletId);
  }

  /**
   * ECCS resumes a paused subscription. If the cycle it was paused in is still
   * running, it simply carries on. If that cycle has ended meanwhile, a fresh
   * cycle starts today (a change of plan that was waiting applies to it), and
   * billing invoices that cycle as it does any other.
   */
  async resume(user: AuthUser, outletId: string): Promise<OutletSubscriptionDto> {
    await this.requireOutlet(user, outletId, 'eccs');
    const subscription = await this.requireLive(outletId);
    if (subscription.status === 'PAUSED') {
      const today = indiaDate();
      await this.db.subscription.update({ where: { id: subscription.id }, data: { status: 'ACTIVE', pausedAt: null } });
      if (fromDbDate(subscription.currentPeriodEnd) < today) {
        if (subscription.cancelAtPeriodEnd) await this.end(outletId, fromDbDate(subscription.currentPeriodEnd), today, user);
        else await this.rollOver(subscription, today);
      }
      await this.fillDiary(outletId);
    }
    return this.describe(outletId);
  }

  /**
   * Cancels. At the end of the cycle (the Owner or ECCS): it stays exactly as
   * it is until the cycle already invoiced ends, then is not renewed; this can
   * be undone until that day. Now (ECCS only): it ends today and its visits
   * that have not started are cancelled.
   */
  async cancel(user: AuthUser, outletId: string, when: 'PERIOD_END' | 'NOW'): Promise<OutletSubscriptionDto> {
    await this.requireOutlet(user, outletId, when === 'NOW' ? 'eccs' : 'manage');
    const subscription = await this.requireLive(outletId);
    const today = indiaDate();
    const periodEnd = fromDbDate(subscription.currentPeriodEnd);
    // Nothing to wait for when the first cycle has not begun, or (paused) the cycle is already over.
    const nothingLeft = fromDbDate(subscription.currentPeriodStart) > today || periodEnd < today;

    if (when === 'NOW' || nothingLeft) {
      await this.end(outletId, today, today, user);
    } else if (!subscription.cancelAtPeriodEnd) {
      // Cancelling replaces a change of plan that was waiting: there is no next cycle for it to apply to.
      await this.db.subscription.update({
        where: { id: subscription.id },
        data: { cancelAtPeriodEnd: true, pendingPlanId: null, nextBillingDate: null },
      });
    }
    return this.describe(outletId);
  }

  /** Undoes a cancellation that has not taken effect yet: the plan renews as before. */
  async keep(user: AuthUser, outletId: string): Promise<OutletSubscriptionDto> {
    await this.requireOutlet(user, outletId, 'manage');
    const subscription = await this.requireLive(outletId);
    if (subscription.cancelAtPeriodEnd) {
      await this.db.subscription.update({
        where: { id: subscription.id },
        data: { cancelAtPeriodEnd: false, nextBillingDate: new Date(subscription.currentPeriodEnd.getTime() + 86_400_000) },
      });
      await this.fillDiary(outletId);
    }
    return this.describe(outletId);
  }

  // ───────────────────────── Renewal ─────────────────────────

  /**
   * Moves every subscription whose cycle has ended before `asOf` (today,
   * unless a test says otherwise) on: one that was asked to end is ended, any
   * other active one starts its next cycle, on the plan that was asked for if
   * a change was waiting, with the plan's price, cycle and services as they
   * are now. A paused subscription is left alone.
   *
   * Safe to run as often as wanted: a cycle is only moved on from the cycle it
   * was read in, so two runs at once cannot move it twice. If the server was
   * off for longer than a cycle, the cycles in between are stepped through
   * and only the one now running is left for billing to invoice.
   *
   * `outletId` limits it to one outlet (tests use this to leave the sample data alone).
   */
  async renewDue(asOf: string = indiaDate(), outletId?: string): Promise<{ renewed: number; cancelled: number }> {
    await this.backfill(asOf, outletId);
    const due = await this.db.subscription.findMany({
      where: {
        currentPeriodEnd: { lt: toDbDate(asOf) },
        ...(outletId && { outletId }),
        // An outlet or client ECCS has switched off is not renewed (and so not invoiced) until it is back on.
        outlet: { isActive: true, organization: { isActive: true } },
        OR: [{ status: 'ACTIVE' }, { status: 'PAUSED', cancelAtPeriodEnd: true }],
      },
      select: { id: true, outletId: true },
    });

    let renewed = 0;
    let cancelled = 0;
    for (const { id, outletId: outlet } of due) {
      // At most a few hundred steps, so a bad row can never spin for ever.
      for (let step = 0; step < 500; step += 1) {
        const row = await this.db.subscription.findUnique({ where: { id }, include: subscriptionInclude });
        if (!row || !isFilled(row) || !isLive(row.status) || fromDbDate(row.currentPeriodEnd) >= asOf) break;
        if (row.cancelAtPeriodEnd) {
          const lastDay = fromDbDate(row.currentPeriodEnd);
          await this.end(outlet, lastDay, addDaysToDate(lastDay, 1), SYSTEM);
          cancelled += 1;
          break;
        }
        if (row.status !== 'ACTIVE' || !(await this.rollOver(row))) break;
        renewed += 1;
      }
      await this.plans.generateAll(asOf, outlet);
    }
    return { renewed, cancelled };
  }

  /**
   * Starts the next cycle of a subscription: on `newStart` when it is resumed
   * after its cycle ran out, otherwise on the day after the present cycle
   * ends. Returns false if another run had already moved it.
   */
  private async rollOver(subscription: Filled, newStart?: string): Promise<boolean> {
    const pending = subscription.pendingPlanId
      ? await this.db.plan.findUnique({ where: { id: subscription.pendingPlanId }, include: planInclude })
      : null;
    const plan = pending ?? subscription.plan;
    const start = newStart ?? addDaysToDate(fromDbDate(subscription.currentPeriodEnd), 1);
    // Renewals keep to the day of the month the subscription started on, even after a short month.
    const anchorDay = newStart ? undefined : cycleAnchorDay(fromDbDate(subscription.startDate), start);
    const period = cyclePeriod(start, plan.billingCycle, anchorDay);

    const moved = await this.db.subscription.updateMany({
      where: { id: subscription.id, currentPeriodStart: subscription.currentPeriodStart, status: { in: [...LIVE] } },
      data: {
        planId: plan.id,
        pendingPlanId: null,
        pricePaise: plan.pricePaise,
        billingCycle: plan.billingCycle,
        currentPeriodStart: toDbDate(period.start),
        currentPeriodEnd: toDbDate(period.end),
        nextBillingDate: toDbDate(period.nextStart),
      },
    });
    if (moved.count === 0) return false;
    await this.syncSchedules(subscription.id, subscription.outletId, plan.lines, start);
    return true;
  }

  /**
   * Makes the outlet's recurring services match the plan's lines from `from`
   * on. A service the outlet already gets keeps its rhythm (only how often
   * changes, if it did); a new one is first due on `from`; one that is no
   * longer in the plan stops, and its visits from that day that have not
   * started are cancelled.
   */
  private async syncSchedules(subscriptionId: string, outletId: string, lines: PlanRow['lines'], from: string) {
    const schedules = await this.db.serviceSchedule.findMany({ where: { subscriptionId } });
    const wanted = new Map(lines.map((line) => [line.serviceTypeId, line.intervalDays]));

    for (const [serviceTypeId, intervalDays] of wanted) {
      const mine = schedules.filter((schedule) => schedule.serviceTypeId === serviceTypeId);
      const running = mine.find((schedule) => schedule.isActive);
      if (running) {
        if (running.intervalDays !== intervalDays) {
          await this.db.serviceSchedule.update({ where: { id: running.id }, data: { intervalDays } });
        }
      } else if (mine[0]) {
        // It was in the plan before, went away and is back: the same row is used again from today's date.
        await this.db.serviceSchedule.update({
          where: { id: mine[0].id },
          data: { isActive: true, intervalDays, nextDueDate: toDbDate(from) },
        });
      } else {
        await this.db.serviceSchedule.create({
          data: { outletId, subscriptionId, serviceTypeId, intervalDays, nextDueDate: toDbDate(from) },
        });
      }
    }

    const dropped = schedules.filter((schedule) => schedule.isActive && !wanted.has(schedule.serviceTypeId)).map((schedule) => schedule.id);
    if (dropped.length === 0) return;
    await this.db.$transaction([
      this.db.serviceSchedule.updateMany({ where: { id: { in: dropped } }, data: { isActive: false } }),
      this.db.job.updateMany({
        where: { scheduleId: { in: dropped }, status: { in: ['SCHEDULED', 'ASSIGNED'] }, scheduledDate: { gte: toDbDate(from) } },
        data: { status: 'CANCELLED' },
      }),
    ]);
  }

  /**
   * Subscriptions made before prices and cycles were recorded have neither.
   * They are given the plan's price and cycle, and the cycle that `asOf`
   * falls in counting from their start date. Runs at each renewal check and
   * whenever such a subscription is read; it touches nothing already filled.
   */
  private async backfill(asOf: string, outletId?: string) {
    const bare = await this.db.subscription.findMany({
      where: {
        status: { in: [...LIVE] },
        ...(outletId && { outletId }),
        OR: [{ pricePaise: null }, { billingCycle: null }, { currentPeriodStart: null }, { currentPeriodEnd: null }],
      },
      include: { plan: { select: { pricePaise: true, billingCycle: true } } },
    });
    for (const subscription of bare) {
      const billingCycle = subscription.billingCycle ?? subscription.plan.billingCycle;
      const period = cyclePeriodContaining(fromDbDate(subscription.startDate), billingCycle, asOf);
      await this.db.subscription.update({
        where: { id: subscription.id },
        data: {
          pricePaise: subscription.pricePaise ?? subscription.plan.pricePaise,
          billingCycle,
          currentPeriodStart: toDbDate(period.start),
          currentPeriodEnd: toDbDate(period.end),
          nextBillingDate: subscription.cancelAtPeriodEnd ? null : toDbDate(period.nextStart),
        },
      });
    }
  }

  // ───────────────────────── Helpers ─────────────────────────

  /** Ends the outlet's subscription and tells the restaurant. */
  private async end(outletId: string, lastDay: string, cancelVisitsFrom: string, actor: Actor) {
    await this.notify.planEnded(actor, await this.plans.endSubscriptions(outletId, lastDay, cancelVisitsFrom));
  }

  /** Puts in the diary whatever a change has just made due (for example after a cancellation is undone). */
  private fillDiary(outletId: string) {
    return this.plans.generateAll(indiaDate(), outletId);
  }

  /** The outlet's subscription that has not ended, with its price and cycle dates filled in. */
  private async live(outletId: string): Promise<Filled | null> {
    const find = () =>
      this.db.subscription.findFirst({
        where: { outletId, status: { in: [...LIVE] } },
        orderBy: { createdAt: 'desc' },
        include: subscriptionInclude,
      });
    let subscription = await find();
    if (subscription && !isFilled(subscription)) {
      await this.backfill(indiaDate(), outletId);
      subscription = await find();
    }
    return subscription && isFilled(subscription) ? subscription : null;
  }

  private async requireLive(outletId: string): Promise<Filled> {
    const subscription = await this.live(outletId);
    if (!subscription) throw new NotFoundException('This outlet is not on a plan');
    return subscription;
  }

  private async describe(outletId: string): Promise<OutletSubscriptionDto> {
    const subscription = await this.live(outletId);
    if (!subscription) {
      const last = await this.db.subscription.findFirst({
        where: { outletId, status: { notIn: [...LIVE] } },
        orderBy: [{ endDate: 'desc' }, { createdAt: 'desc' }],
        select: { endDate: true, updatedAt: true, plan: { select: { code: true, name: true } } },
      });
      return {
        outletId,
        subscription: null,
        lastEnded: last && {
          plan: { code: last.plan.code, name: last.plan.name as LocalizedText },
          endedOn: last.endDate ? fromDbDate(last.endDate) : indiaDate(last.updatedAt),
        },
      };
    }
    const pending = subscription.pendingPlanId
      ? await this.db.plan.findUnique({ where: { id: subscription.pendingPlanId }, include: planInclude })
      : null;
    return { outletId, subscription: toSubscriptionDto(subscription, pending), lastEnded: null };
  }

  /**
   * Who may do what with an outlet's subscription:
   * - read: the outlet's own Owner and Manager, and ECCS admins;
   * - manage (start, change plan, cancel at the end of the cycle, and undo): the Owner and ECCS admins;
   * - eccs (pause, resume, cancel now): ECCS admins only.
   * Someone from another restaurant is told the outlet does not exist.
   */
  private async requireOutlet(user: AuthUser, outletId: string, action: 'read' | 'manage' | 'eccs') {
    const outlet = await this.db.outlet.findUnique({
      where: { id: outletId },
      select: { organizationId: true, isActive: true, organization: { select: { isActive: true } } },
    });
    if (!outlet) throw new NotFoundException('Outlet not found');
    const target = { organizationId: outlet.organizationId, outletId };
    const eccs = accessScope(user.memberships, 'jobs')?.kind === 'all' && can(user.memberships, 'subscriptions', 'create');
    if (!eccs && !can(user.memberships, 'subscriptions', 'read', target)) throw new NotFoundException('Outlet not found');
    if (action === 'eccs' && !eccs) throw new ForbiddenException('Only ECCS can do this. Call ECCS.');
    if (action === 'manage' && !eccs && !can(user.memberships, 'subscriptions', 'create', target)) {
      throw new ForbiddenException('Only the Owner can change the plan');
    }
    return { eccs, active: outlet.isActive && outlet.organization.isActive };
  }

  /** Lines as the console sent them, with each kind of service looked up. */
  private async resolveLines(lines: LineInput[]): Promise<{ serviceTypeId: string; intervalDays: number }[]> {
    const kinds = await this.db.serviceType.findMany({
      where: { code: { in: lines.map((line) => line.serviceCode) } },
      select: { id: true, code: true },
    });
    return lines.map((line) => {
      const kind = kinds.find((entry) => entry.code === line.serviceCode);
      if (!kind) throw new BadRequestException('That kind of service was not found');
      return { serviceTypeId: kind.id, intervalDays: line.intervalDays };
    });
  }

  /** A code for a new plan made from its name ("Night Kitchen" becomes NIGHT_KITCHEN), with a number added if it is taken. */
  private async newPlanCode(name: string): Promise<string> {
    const base =
      name
        .toUpperCase()
        .replace(/[^A-Z0-9]+/g, '_')
        .replace(/^_+|_+$/g, '')
        .slice(0, 24) || 'PLAN';
    for (let attempt = 1; ; attempt += 1) {
      const code = attempt === 1 ? base : `${base}_${attempt}`;
      if (!(await this.db.plan.findUnique({ where: { code }, select: { id: true } }))) return code;
    }
  }
}

const isLive = (status: string) => (LIVE as readonly string[]).includes(status);

const isFilled = (subscription: SubscriptionRow): subscription is Filled =>
  subscription.pricePaise !== null &&
  subscription.billingCycle !== null &&
  subscription.currentPeriodStart !== null &&
  subscription.currentPeriodEnd !== null;

function toOffer(plan: PlanRow): PlanOfferDto {
  return {
    code: plan.code,
    name: plan.name as LocalizedText,
    description: (plan.description as LocalizedText | null) ?? null,
    ...subscriptionPrice(plan.pricePaise),
    billingCycle: plan.billingCycle,
    services: plan.lines.map((line) => ({
      serviceCode: line.serviceType.code,
      serviceName: line.serviceType.name as LocalizedText,
      intervalDays: line.intervalDays,
    })),
  };
}

function toSubscriptionDto(subscription: Filled, pending: PlanRow | null): SubscriptionDto {
  const periodEnd = fromDbDate(subscription.currentPeriodEnd);
  const ending = subscription.cancelAtPeriodEnd;
  const renews = subscription.status === 'ACTIVE' && !ending;
  const next = pending ?? subscription.plan;

  // What the next cycle will bring, compared with this one.
  const now = new Map(subscription.schedules.map((schedule) => [schedule.serviceType.code, schedule.intervalDays]));
  const servicesChange =
    next.lines.length !== now.size || next.lines.some((line) => now.get(line.serviceType.code) !== line.intervalDays);
  const changes =
    pending !== null ||
    next.pricePaise !== subscription.pricePaise ||
    next.billingCycle !== subscription.billingCycle ||
    servicesChange;

  return {
    id: subscription.id,
    status: subscription.status === 'PAUSED' ? 'PAUSED' : 'ACTIVE',
    plan: {
      code: subscription.plan.code,
      name: subscription.plan.name as LocalizedText,
      description: (subscription.plan.description as LocalizedText | null) ?? null,
    },
    ...subscriptionPrice(subscription.pricePaise),
    billingCycle: subscription.billingCycle,
    services: subscription.schedules.map((schedule) => {
      const inDiary = schedule.jobs[0] ? fromDbDate(schedule.jobs[0].scheduledDate) : null;
      // A visit already in the diary counts; otherwise the next due date, which only an active plan will fill.
      const next = inDiary ?? (subscription.status === 'ACTIVE' ? fromDbDate(schedule.nextDueDate) : null);
      // Beyond the end of the cycle nothing more comes of a service that is ending or not in the plan asked for.
      const stopsAtCycleEnd =
        ending || (pending !== null && !pending.lines.some((line) => line.serviceType.code === schedule.serviceType.code));
      return {
        serviceCode: schedule.serviceType.code,
        serviceName: schedule.serviceType.name as LocalizedText,
        intervalDays: schedule.intervalDays,
        nextDate: next !== null && stopsAtCycleEnd && next > periodEnd ? null : next,
      };
    }),
    startDate: fromDbDate(subscription.startDate),
    currentPeriodStart: fromDbDate(subscription.currentPeriodStart),
    currentPeriodEnd: periodEnd,
    renewal: renews
      ? {
          date: addDaysToDate(periodEnd, 1),
          plan: { code: next.code, name: next.name as LocalizedText },
          ...subscriptionPrice(next.pricePaise),
          billingCycle: next.billingCycle,
          changes,
        }
      : null,
    pendingPlan: pending ? { code: pending.code, name: pending.name as LocalizedText } : null,
    endsOn: ending ? periodEnd : null,
    pausedOn: subscription.pausedAt ? indiaDate(subscription.pausedAt) : null,
  };
}
