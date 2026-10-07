import {
  BadRequestException,
  ForbiddenException,
  Injectable,
  Logger,
  NotFoundException,
  OnModuleDestroy,
  OnModuleInit,
} from '@nestjs/common';
import {
  accessScope,
  can,
  PLAN_VISITS_DAYS_AHEAD,
  type LocalizedText,
  type OutletPlanDto,
  type PlanDto,
} from '@eccs/shared';
import type { AuthUser } from '../auth/auth.types.js';
import { indiaDate } from '../checklists/checklists.service.js';
import { env } from '../config/env.js';
import { NotifyService } from '../notifications/notify.service.js';
import { PrismaService } from '../prisma/prisma.service.js';

const DAY_MS = 86_400_000;
const CHECK_EVERY_MS = 6 * 60 * 60 * 1000;
const FIRST_CHECK_AFTER_MS = 15_000;
const DEFAULT_SLOT = 'AFTER_CLOSING';

const toDbDate = (date: string) => new Date(`${date}T00:00:00.000Z`);
const fromDbDate = (date: Date) => date.toISOString().slice(0, 10);
const addDays = (date: Date, days: number) => new Date(date.getTime() + days * DAY_MS);

const planInclude = {
  lines: { include: { serviceType: { select: { code: true, name: true } } }, orderBy: { intervalDays: 'asc' } },
} as const;

/**
 * Plans: a bundle of services, each repeated every so many days. An outlet on
 * a plan has one recurring schedule per service, and this service keeps the
 * diary filled from those schedules: every visit falling due in the coming
 * weeks is created ahead of time, so nobody has to add them by hand.
 */
@Injectable()
export class PlansService implements OnModuleInit, OnModuleDestroy {
  private readonly logger = new Logger(PlansService.name);
  private timers: NodeJS.Timeout[] = [];

  constructor(
    private readonly prisma: PrismaService,
    private readonly notify: NotifyService,
  ) {}

  private get db() {
    return this.prisma.client;
  }

  /** Checks the plans shortly after the server starts and a few times a day after that. */
  onModuleInit() {
    // Tests fill the diary themselves, at moments they choose.
    if (env.NODE_ENV === 'test') return;
    const check = () =>
      void this.generateAll()
        .then(({ created }) => created > 0 && this.logger.log(`Added ${created} plan visits to the diary`))
        .catch((error) => this.logger.warn(`Could not fill the diary from plans: ${String(error)}`));
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

  async plans(): Promise<PlanDto[]> {
    const plans = await this.db.plan.findMany({ where: { isActive: true }, include: planInclude, orderBy: { pricePaise: 'asc' } });
    return plans.map(toPlanDto);
  }

  /** The plan an outlet is on and when each of its services is next due. */
  async outletPlan(user: AuthUser, outletId: string): Promise<OutletPlanDto> {
    await this.requireOutlet(user, outletId, 'read');
    return this.describe(outletId);
  }

  /**
   * ECCS puts an outlet on a plan. Each of the plan's services is first due on
   * the start date and then at its own interval. Any plan the outlet was on
   * before is stopped first.
   */
  async setOutletPlan(user: AuthUser, outletId: string, input: { planCode: string; startDate: string }): Promise<OutletPlanDto> {
    await this.requireOutlet(user, outletId, 'manage');
    const plan = await this.db.plan.findFirst({ where: { code: input.planCode, isActive: true }, include: { lines: true } });
    if (!plan) throw new BadRequestException('That plan is not available');
    const today = indiaDate();
    if (input.startDate < today) throw new BadRequestException('Choose today or a later date');
    const start = toDbDate(input.startDate);

    await this.stop(outletId, today);
    await this.db.subscription.create({
      data: {
        outletId,
        planId: plan.id,
        startDate: start,
        schedules: {
          create: plan.lines.map((line) => ({
            outletId,
            serviceTypeId: line.serviceTypeId,
            intervalDays: line.intervalDays,
            nextDueDate: start,
          })),
        },
      },
    });
    await this.generateAll(today, outletId, user.id);
    await this.notify.planStarted(user, outletId);
    return this.describe(outletId);
  }

  /** ECCS takes an outlet off its plan. Plan visits that have not started are cancelled. */
  async stopOutletPlan(user: AuthUser, outletId: string): Promise<OutletPlanDto> {
    await this.requireOutlet(user, outletId, 'manage');
    await this.notify.planEnded(user, await this.stop(outletId, indiaDate()));
    return this.describe(outletId);
  }

  // ───────────────────────── Filling the diary ─────────────────────────

  /**
   * Creates every plan visit that falls due from `asOf` (today, unless a test
   * says otherwise) up to a few weeks ahead and does not exist yet. Safe to
   * run as often as wanted: a visit is tied to the date it was due on, so one
   * that was moved, done or cancelled is never created again. `actorId` is the
   * admin whose change set this off, if one did, so that they are not notified
   * of their own work.
   */
  async generateAll(asOf: string = indiaDate(), outletId?: string, actorId?: string): Promise<{ created: number }> {
    const from = toDbDate(asOf);
    const until = addDays(from, PLAN_VISITS_DAYS_AHEAD);
    const schedules = await this.db.serviceSchedule.findMany({
      where: {
        isActive: true,
        nextDueDate: { lte: until },
        outlet: { isActive: true },
        ...(outletId && { outletId }),
        OR: [{ subscriptionId: null }, { subscription: { status: 'ACTIVE' } }],
      },
      include: { subscription: { select: { endDate: true } } },
    });

    const createdIds: string[] = [];
    for (const schedule of schedules) {
      let due = schedule.nextDueDate;
      // Days already gone are not filled in afterwards; the rhythm is kept.
      while (due < from) due = addDays(due, schedule.intervalDays);

      // The same time of day and Supervisor as this service's last visit here, so the restaurant sees a familiar team.
      const last = await this.db.job.findFirst({
        where: { scheduleId: schedule.id, status: { not: 'CANCELLED' } },
        orderBy: { scheduledDate: 'desc' },
        select: { scheduledSlot: true, supervisor: { select: { id: true, isActive: true } } },
      });
      const supervisorId = last?.supervisor?.isActive ? last.supervisor.id : null;
      const ends = schedule.subscription?.endDate ?? null;

      while (due <= until && (!ends || due <= ends)) {
        const exists = await this.db.job.findFirst({ where: { scheduleId: schedule.id, plannedFor: due }, select: { id: true } });
        if (!exists) {
          try {
            const visit = await this.db.job.create({
              data: {
                outletId: schedule.outletId,
                serviceTypeId: schedule.serviceTypeId,
                scheduleId: schedule.id,
                plannedFor: due,
                scheduledDate: due,
                scheduledSlot: last?.scheduledSlot ?? DEFAULT_SLOT,
                status: supervisorId ? 'ASSIGNED' : 'SCHEDULED',
                supervisorId,
              },
            });
            createdIds.push(visit.id);
          } catch (error) {
            // Another run created the same visit at the same moment.
            if ((error as { code?: string }).code !== 'P2002') throw error;
          }
        }
        due = addDays(due, schedule.intervalDays);
      }
      if (due.getTime() !== schedule.nextDueDate.getTime()) {
        await this.db.serviceSchedule.update({ where: { id: schedule.id }, data: { nextDueDate: due } });
      }
    }
    await this.notify.planVisitsAdded(actorId, createdIds);
    return { created: createdIds.length };
  }

  // ───────────────────────── Helpers ─────────────────────────

  /** Stops the outlet's plan and returns the subscriptions that were stopped (none if it had no plan). */
  private async stop(outletId: string, today: string): Promise<string[]> {
    const active = await this.db.subscription.findMany({
      where: { outletId, status: 'ACTIVE' },
      select: { id: true, schedules: { select: { id: true } } },
    });
    if (active.length === 0) return [];
    const scheduleIds = active.flatMap((subscription) => subscription.schedules.map((schedule) => schedule.id));
    await this.db.$transaction([
      this.db.subscription.updateMany({
        where: { id: { in: active.map((subscription) => subscription.id) } },
        data: { status: 'CANCELLED', endDate: toDbDate(today) },
      }),
      this.db.serviceSchedule.updateMany({ where: { id: { in: scheduleIds } }, data: { isActive: false } }),
      // Visits already under way or done are part of the record and stay.
      this.db.job.updateMany({
        where: { scheduleId: { in: scheduleIds }, status: { in: ['SCHEDULED', 'ASSIGNED'] }, scheduledDate: { gte: toDbDate(today) } },
        data: { status: 'CANCELLED' },
      }),
    ]);
    return active.map((subscription) => subscription.id);
  }

  private async describe(outletId: string): Promise<OutletPlanDto> {
    const subscription = await this.db.subscription.findFirst({
      where: { outletId, status: 'ACTIVE' },
      orderBy: { createdAt: 'desc' },
      include: {
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
      },
    });
    if (!subscription) return { outletId, plan: null, since: null, services: [] };
    return {
      outletId,
      plan: toPlanDto(subscription.plan),
      since: fromDbDate(subscription.startDate),
      services: subscription.schedules.map((schedule) => ({
        serviceCode: schedule.serviceType.code,
        serviceName: schedule.serviceType.name as LocalizedText,
        intervalDays: schedule.intervalDays,
        // The next visit in the diary, or the next due date if it is too far ahead to be there yet.
        nextDate: fromDbDate(schedule.jobs[0]?.scheduledDate ?? schedule.nextDueDate),
      })),
    };
  }

  /** Reading is for the outlet's own Owner and Manager and for ECCS; changing a plan is for ECCS admins. */
  private async requireOutlet(user: AuthUser, outletId: string, action: 'read' | 'manage') {
    const outlet = await this.db.outlet.findUnique({ where: { id: outletId }, select: { organizationId: true } });
    if (!outlet) throw new NotFoundException('Outlet not found');
    if (action === 'manage') {
      const admin = accessScope(user.memberships, 'jobs')?.kind === 'all' && can(user.memberships, 'subscriptions', 'create');
      if (!admin) throw new ForbiddenException('Only ECCS can change a plan');
      return;
    }
    const allowed = can(user.memberships, 'subscriptions', 'read', { organizationId: outlet.organizationId, outletId });
    if (!allowed) throw new NotFoundException('Outlet not found');
  }
}

type PlanRow = {
  code: string;
  name: unknown;
  description: unknown;
  pricePaise: number;
  billingCycle: PlanDto['billingCycle'];
  lines: { intervalDays: number; serviceType: { code: string; name: unknown } }[];
};

function toPlanDto(plan: PlanRow): PlanDto {
  return {
    code: plan.code,
    name: plan.name as LocalizedText,
    description: (plan.description as LocalizedText | null) ?? null,
    pricePaise: plan.pricePaise,
    billingCycle: plan.billingCycle,
    services: plan.lines.map((line) => ({
      serviceCode: line.serviceType.code,
      serviceName: line.serviceType.name as LocalizedText,
      intervalDays: line.intervalDays,
    })),
  };
}
