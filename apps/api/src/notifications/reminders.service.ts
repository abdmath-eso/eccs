import { Injectable, Logger, OnModuleDestroy, OnModuleInit } from '@nestjs/common';
import { LICENCE_REMINDER_DAYS, type LocalizedText, type NotificationLink } from '@eccs/shared';
import { env } from '../config/env.js';
import { PrismaService } from '../prisma/prisma.service.js';
import { NotificationsService } from './notifications.service.js';
import { isoDate, toSlot } from './notify.service.js';

const DAY_MS = 86_400_000;
// Often enough that an overdue checklist is noticed within a quarter of an hour.
const CHECK_EVERY_MS = 15 * 60 * 1000;
const FIRST_CHECK_AFTER_MS = 20_000;
// How far back the check looks, so that a server which was switched off for a while
// does not send reminders about things long past.
const NOT_DONE_LOOKBACK_DAYS = 7;
const SIGN_OFF_LOOKBACK_DAYS = 14;

const DEFAULT_LICENCE_NAMES: Record<string, string> = {
  FSSAI: 'FSSAI licence',
  FIRE_NOC: 'Fire NOC',
  TRADE_LICENCE: 'Trade licence',
  PEST_CONTROL: 'Pest control contract',
  OTHER: 'Licence',
};

const toDbDate = (date: string) => new Date(`${date}T00:00:00.000Z`);
const addDays = (date: Date, days: number) => new Date(date.getTime() + days * DAY_MS);

/** The calendar date in India as YYYY-MM-DD, and the time of day there as HH:mm. */
const indiaDate = (at: Date) => new Intl.DateTimeFormat('en-CA', { timeZone: 'Asia/Kolkata' }).format(at);
const indiaTime = (at: Date) =>
  new Intl.DateTimeFormat('en-GB', { timeZone: 'Asia/Kolkata', hour: '2-digit', minute: '2-digit', hour12: false }).format(at);

/**
 * Reminders: notifications about things that are due, which nobody's action
 * sets off. One check runs every few minutes and looks for licences about to
 * expire, checklists not handed in, visits coming up, visits waiting for
 * sign-off and visits that were never done.
 *
 * Every reminder carries a key (which thing, which day), and a person is never
 * sent the same key twice, so the check can run as often as wanted.
 */
@Injectable()
export class RemindersService implements OnModuleInit, OnModuleDestroy {
  private readonly logger = new Logger(RemindersService.name);
  private timers: NodeJS.Timeout[] = [];

  constructor(
    private readonly prisma: PrismaService,
    private readonly notifications: NotificationsService,
  ) {}

  private get db() {
    return this.prisma.client;
  }

  /** Checks shortly after the server starts and every quarter of an hour after that. */
  onModuleInit() {
    // Tests run the check themselves, for moments they choose.
    if (env.NODE_ENV === 'test') return;
    const check = () =>
      void this.run()
        .then(({ sent }) => sent > 0 && this.logger.log(`Sent ${sent} reminders`))
        .catch((error) => this.logger.warn(`Could not send reminders: ${String(error)}`));
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

  /**
   * Sends every reminder that is due at `asOf` (now, unless a test says
   * otherwise) and has not been sent yet. `outletId` limits it to one outlet.
   */
  async run(asOf: Date = new Date(), outletId?: string): Promise<{ sent: number }> {
    const parts = [
      () => this.licences(asOf, outletId),
      () => this.checklistsOverdue(asOf, outletId),
      () => this.checklistsMissed(asOf, outletId),
      () => this.visitsTomorrow(asOf, outletId),
      () => this.signOffsWaiting(asOf, outletId),
      () => this.visitsNotDone(asOf, outletId),
    ];
    let sent = 0;
    for (const part of parts) {
      // One kind of reminder failing does not hold back the others.
      sent += await part().catch((error) => {
        this.logger.warn(`A reminder check failed: ${String(error)}`);
        return 0;
      });
    }
    return { sent };
  }

  private managersOf(outletId: string) {
    return this.notifications.restaurantPeople(outletId, ['OWNER', 'MANAGER']);
  }

  /**
   * L1 and L2. Before expiry there are four reminders, at 30, 15, 7 and 1 days
   * left; a licence first seen between two of them (say with 12 days left)
   * gets the one it has just passed, once. After expiry the reminder repeats
   * each week until the licence is renewed.
   */
  private async licences(asOf: Date, outletId?: string): Promise<number> {
    const today = toDbDate(indiaDate(asOf));
    const furthest = Math.max(...LICENCE_REMINDER_DAYS);
    const licences = await this.db.licence.findMany({
      where: { expiresOn: { lte: addDays(today, furthest) }, outlet: { isActive: true }, ...(outletId && { outletId }) },
      include: { outlet: { select: { name: true } } },
    });

    let sent = 0;
    for (const licence of licences) {
      const daysLeft = Math.round((licence.expiresOn.getTime() - today.getTime()) / DAY_MS);
      const expires = isoDate(licence.expiresOn);
      const params = {
        outlet: licence.outlet.name,
        licence: licence.name ?? DEFAULT_LICENCE_NAMES[licence.type] ?? 'Licence',
        date: expires,
      };
      const link: NotificationLink = { kind: 'documents', outletId: licence.outletId };
      const people = await this.managersOf(licence.outletId);
      // The expiry date is part of the key, so a renewed licence starts its reminders afresh.
      if (daysLeft < 0) {
        const week = Math.floor((-daysLeft - 1) / 7);
        sent += await this.notifications.send(people, 'LICENCE_EXPIRED', params, link, {
          dedupeKey: `licence-expired:${licence.id}:${expires}:week${week}`,
        });
      } else {
        const stage = [...LICENCE_REMINDER_DAYS].sort((a, b) => a - b).find((days) => daysLeft <= days)!;
        sent += await this.notifications.send(people, 'LICENCE_EXPIRING', { ...params, days: daysLeft }, link, {
          dedupeKey: `licence-expiring:${licence.id}:${expires}:${stage}`,
        });
      }
    }
    return sent;
  }

  /** The outlet's daily checklists that have at least one item, with the given day's record if there is one. */
  private async dailyChecklists(day: Date, outletId?: string) {
    const lists = await this.db.outletChecklist.findMany({
      where: {
        isActive: true,
        template: { kind: 'DAILY', isActive: true },
        outlet: { isActive: true },
        ...(outletId && { outletId }),
      },
      include: {
        outlet: { select: { name: true } },
        template: { select: { title: true, items: { where: { isActive: true }, select: { outletId: true } } } },
        runs: { where: { date: day }, select: { id: true, status: true } },
      },
    });
    // A checklist with no items for this outlet is not handed out, so cannot be late.
    return lists.filter((list) => list.template.items.some((item) => item.outletId === null || item.outletId === list.outletId));
  }

  /** C2: today's checklist is past its due time and has not been handed in. Head Chef and Manager. */
  private async checklistsOverdue(asOf: Date, outletId?: string): Promise<number> {
    const today = indiaDate(asOf);
    const now = indiaTime(asOf);
    let sent = 0;
    for (const list of await this.dailyChecklists(toDbDate(today), outletId)) {
      const run = list.runs[0];
      if (!list.dueTime || now <= list.dueTime || run?.status === 'SUBMITTED') continue;
      sent += await this.notifications.send(
        await this.notifications.restaurantPeople(list.outletId, ['HEAD_CHEF', 'MANAGER']),
        'CHECKLIST_OVERDUE',
        { outlet: list.outlet.name, checklist: list.template.title as LocalizedText },
        // Today's list of checklists; opening it also creates today's record if nobody has yet.
        { kind: 'checklist', outletId: list.outletId },
        { dedupeKey: `checklist-overdue:${list.id}:${today}` },
      );
    }
    return sent;
  }

  /** C4: yesterday ended with a checklist not handed in. Manager and Owner. */
  private async checklistsMissed(asOf: Date, outletId?: string): Promise<number> {
    const yesterday = indiaDate(addDays(asOf, -1));
    let sent = 0;
    for (const list of await this.dailyChecklists(toDbDate(yesterday), outletId)) {
      const run = list.runs[0];
      // A checklist created today was not there to be done yesterday.
      if (run?.status === 'SUBMITTED' || indiaDate(list.createdAt) > yesterday) continue;
      sent += await this.notifications.send(
        await this.managersOf(list.outletId),
        'CHECKLIST_MISSED',
        { outlet: list.outlet.name, checklist: list.template.title as LocalizedText, date: yesterday },
        { kind: 'checklist', outletId: list.outletId, ...(run && { runId: run.id }) },
        { dedupeKey: `checklist-missed:${list.id}:${yesterday}` },
      );
    }
    return sent;
  }

  /** S8: a visit is tomorrow. Owner, Manager and the visit's Supervisor. */
  private async visitsTomorrow(asOf: Date, outletId?: string): Promise<number> {
    const tomorrow = indiaDate(addDays(asOf, 1));
    const visits = await this.db.job.findMany({
      where: { scheduledDate: toDbDate(tomorrow), status: { in: ['SCHEDULED', 'ASSIGNED'] }, ...(outletId && { outletId }) },
      include: { outlet: { select: { name: true } }, serviceType: { select: { name: true } } },
    });
    let sent = 0;
    for (const visit of visits) {
      sent += await this.notifications.send(
        [...(await this.managersOf(visit.outletId)), visit.supervisorId],
        'VISIT_TOMORROW',
        {
          outlet: visit.outlet.name,
          service: visit.serviceType.name as LocalizedText,
          date: tomorrow,
          slot: toSlot(visit.scheduledSlot),
        },
        { kind: 'visit', visitId: visit.id },
        // The date is part of the key: a visit moved to another day is reminded again for its new day.
        { dedupeKey: `visit-tomorrow:${visit.id}:${tomorrow}` },
      );
    }
    return sent;
  }

  /** S12: a visit finished more than a day ago is still not signed off. Owner and Manager, once. */
  private async signOffsWaiting(asOf: Date, outletId?: string): Promise<number> {
    const visits = await this.db.job.findMany({
      where: {
        status: 'COMPLETED',
        completedAt: { lte: addDays(asOf, -1), gte: addDays(asOf, -SIGN_OFF_LOOKBACK_DAYS) },
        ...(outletId && { outletId }),
      },
      include: { outlet: { select: { name: true } }, serviceType: { select: { name: true } } },
    });
    let sent = 0;
    for (const visit of visits) {
      sent += await this.notifications.send(
        await this.managersOf(visit.outletId),
        'SIGN_OFF_WAITING',
        { outlet: visit.outlet.name, service: visit.serviceType.name as LocalizedText, date: indiaDate(visit.completedAt!) },
        { kind: 'visit', visitId: visit.id },
        { dedupeKey: `sign-off-waiting:${visit.id}` },
      );
    }
    return sent;
  }

  /** S16: a visit's day has passed and it was never started. ECCS's admins and the visit's Supervisor. */
  private async visitsNotDone(asOf: Date, outletId?: string): Promise<number> {
    const today = toDbDate(indiaDate(asOf));
    const visits = await this.db.job.findMany({
      where: {
        scheduledDate: { lt: today, gte: addDays(today, -NOT_DONE_LOOKBACK_DAYS) },
        status: { in: ['SCHEDULED', 'ASSIGNED'] },
        ...(outletId && { outletId }),
      },
      include: { outlet: { select: { name: true } }, serviceType: { select: { name: true } } },
    });
    if (visits.length === 0) return 0;
    const admins = await this.notifications.admins();
    let sent = 0;
    for (const visit of visits) {
      const date = isoDate(visit.scheduledDate);
      sent += await this.notifications.send(
        [...admins, visit.supervisorId],
        'VISIT_NOT_DONE',
        { outlet: visit.outlet.name, service: visit.serviceType.name as LocalizedText, date },
        { kind: 'visit', visitId: visit.id },
        { dedupeKey: `visit-not-done:${visit.id}:${date}` },
      );
    }
    return sent;
  }
}
