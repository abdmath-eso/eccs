import { BadRequestException, ForbiddenException, Injectable } from '@nestjs/common';
import type { Prisma } from '@eccs/db';
import {
  accessScope,
  addDays,
  boardMonday,
  busyStreak,
  can,
  dayLoadsFrom,
  indiaClock,
  indiaDay,
  indiaMoment,
  suggestMove,
  VISIT_SLOTS,
  WEEK_BOARD_RULES,
  weekHeadline,
  weekUse,
  type BoardWeekday,
  type LocalizedText,
  type VisitCapacity,
  type VisitSettingsDto,
  type VisitStatus,
  type WeekBoardCheckDto,
  type WeekBoardDto,
  type WeekBoardVisitDto,
} from '@eccs/shared';
import type { AuthUser } from '../auth/auth.types.js';
import { indiaDate } from '../checklists/checklists.service.js';
import { PrismaService } from '../prisma/prisma.service.js';

const toDbDate = (date: string) => new Date(`${date}T00:00:00.000Z`);
const fromDbDate = (date: Date) => date.toISOString().slice(0, 10);
const isDate = (value: string) => /^\d{4}-\d{2}-\d{2}$/.test(value) && !Number.isNaN(Date.parse(`${value}T00:00:00Z`));

const SETTINGS_ID = 'default';

const boardVisitInclude = {
  outlet: { select: { id: true, name: true, area: true, organization: { select: { name: true } } } },
  serviceType: {
    select: {
      code: true,
      name: true,
      // The tasks in use for the kind of service: what the card counts as its size.
      checklistTemplate: { select: { _count: { select: { items: { where: { outletId: null, isActive: true } } } } } },
    },
  },
  supervisor: { select: { id: true, name: true } },
} as const satisfies Prisma.JobInclude;

type BoardVisitRow = Prisma.JobGetPayload<{ include: typeof boardVisitInclude }>;

/**
 * The Visits week board (20 Oct 2026): a week of the same visits as the diary, with the
 * crew's capacity per day, Sales' free checks and the capacity box. The rules are in
 * packages/shared/src/week-board.ts. Moving a visit is the diary's own PATCH /visits/:id.
 */
@Injectable()
export class WeekBoardService {
  constructor(private readonly prisma: PrismaService) {}

  private get db() {
    return this.prisma.client;
  }

  /** The capacity per day: the saved row, or the defaults while nothing has been saved. */
  async capacity(): Promise<{ capacity: VisitCapacity; updatedAt: Date | null }> {
    const row = await this.db.visitSettings.findUnique({ where: { id: SETTINGS_ID } });
    if (!row) return { capacity: { ...WEEK_BOARD_RULES.defaultCapacity }, updatedAt: null };
    return {
      capacity: { MON: row.capacityMon, TUE: row.capacityTue, WED: row.capacityWed, THU: row.capacityThu, FRI: row.capacityFri, SAT: row.capacitySat },
      updatedAt: row.updatedAt,
    };
  }

  async settings(user: AuthUser): Promise<VisitSettingsDto> {
    this.requireEccs(user);
    const { capacity, updatedAt } = await this.capacity();
    return { capacity, updatedAt: updatedAt?.toISOString() ?? null, canChange: can(user.memberships, 'settings', 'update') };
  }

  /** The Super Admin changes how many visits a day the crew can take. */
  async updateSettings(user: AuthUser, capacity: Record<BoardWeekday, number>): Promise<VisitSettingsDto> {
    const data = {
      capacityMon: capacity.MON,
      capacityTue: capacity.TUE,
      capacityWed: capacity.WED,
      capacityThu: capacity.THU,
      capacityFri: capacity.FRI,
      capacitySat: capacity.SAT,
      updatedById: user.id,
    };
    await this.db.visitSettings.upsert({ where: { id: SETTINGS_ID }, create: { id: SETTINGS_ID, ...data }, update: data });
    return this.settings(user);
  }

  /** The week that holds `start` (any day of it; this week when empty). */
  async week(user: AuthUser, start: string | undefined): Promise<WeekBoardDto> {
    const scope = this.requireEccs(user);
    if (start && !isDate(start)) throw new BadRequestException('Give the week as a date, YYYY-MM-DD');
    const today = indiaDate();
    const monday = boardMonday(start || today);
    const sunday = addDays(monday, 6);
    const thisMonday = boardMonday(today);
    const canMove = can(user.memberships, 'jobs', 'create') && scope === 'all';
    const showsChecks = can(user.memberships, 'sales', 'read');

    // The streak is counted back from this week, so its weeks may lie before the one shown.
    const streakFrom = addDays(thisMonday, -7 * (WEEK_BOARD_RULES.streakWeeksMax - 1));
    const [{ capacity }, rows, counts, checks] = await Promise.all([
      this.capacity(),
      this.db.job.findMany({
        where: {
          scheduledDate: { gte: toDbDate(monday), lte: toDbDate(sunday) },
          status: { not: 'CANCELLED' },
          ...(scope === 'assigned' && { supervisorId: user.id }),
        },
        include: boardVisitInclude,
        orderBy: [{ scheduledDate: 'asc' }, { createdAt: 'asc' }],
      }),
      // Capacity is the crew's, so a day's count is every visit that day, whoever's they are.
      this.db.job.groupBy({
        by: ['scheduledDate'],
        where: {
          // From whichever comes first, the streak's oldest week or the week shown, to whichever ends last.
          scheduledDate: {
            gte: toDbDate(streakFrom < monday ? streakFrom : monday),
            lte: toDbDate(sunday > addDays(thisMonday, 6) ? sunday : addDays(thisMonday, 6)),
          },
          status: { not: 'CANCELLED' },
        },
        _count: { _all: true },
      }),
      showsChecks
        ? this.db.lead.findMany({
            where: { checkAt: { gte: indiaMoment(monday), lt: indiaMoment(addDays(sunday, 1)) }, checkDoneAt: null, status: 'OPEN' },
            select: { id: true, businessName: true, area: true, checkAt: true, checkWith: true },
            orderBy: { checkAt: 'asc' },
          })
        : Promise.resolve([]),
    ]);

    // Every visit of a day counts, so the load comes from the counts, not from the person's own cards.
    const perDay = new Map(counts.map((row) => [fromDbDate(row.scheduledDate), row._count._all]));
    const bookedOn = (date: string) => perDay.get(date) ?? 0;
    const loads = dayLoadsFrom(monday, capacity, bookedOn);

    const cards = rows.map((row) => this.card(row, canMove));
    const checkCards: WeekBoardCheckDto[] = checks.map((lead) => ({
      leadId: lead.id,
      businessName: lead.businessName,
      area: lead.area,
      date: indiaDay(lead.checkAt!),
      time: indiaClock(lead.checkAt!),
      checkWith: lead.checkWith,
    }));

    // Newest first: this week, then each week before it.
    const weeks = Array.from({ length: WEEK_BOARD_RULES.streakWeeksMax }, (_, index) => addDays(thisMonday, -7 * index)).map((from) =>
      weekUse(dayLoadsFrom(from, capacity, bookedOn)),
    );

    const suggestion = canMove
      ? suggestMove(
          loads,
          cards.map((card) => ({ id: card.id, date: card.date, status: card.status, createdAt: card.createdAt, canMove: card.canMove })),
          today,
        )
      : null;
    const moved = suggestion ? cards.find((card) => card.id === suggestion.visitId) : undefined;
    const slotOrder = (slot: string | null) => (slot ? VISIT_SLOTS.indexOf(slot as (typeof VISIT_SLOTS)[number]) : VISIT_SLOTS.length);
    const byTime = (a: WeekBoardVisitDto, b: WeekBoardVisitDto) => slotOrder(a.slot) - slotOrder(b.slot) || a.outletName.localeCompare(b.outletName);

    return {
      start: monday,
      end: addDays(monday, 5),
      today,
      headline: weekHeadline(loads),
      days: loads.map((load) => ({
        ...load,
        visits: cards.filter((card) => card.date === load.date).sort(byTime),
        checks: checkCards.filter((check) => check.date === load.date),
      })),
      sunday: {
        date: sunday,
        visits: cards.filter((card) => card.date === sunday).sort(byTime),
        checks: checkCards.filter((check) => check.date === sunday),
      },
      week: weekUse(loads),
      streak: { weeks: busyStreak(weeks), max: WEEK_BOARD_RULES.streakWeeksMax, busyPercent: WEEK_BOARD_RULES.busyPercent },
      suggestion: suggestion && moved ? { ...suggestion, outletName: moved.outletName, serviceName: moved.serviceName } : null,
      capacity,
      canMove,
      canChangeCapacity: can(user.memberships, 'settings', 'update'),
      showsChecks,
    };
  }

  private card(row: BoardVisitRow, canMove: boolean): WeekBoardVisitDto {
    const status: VisitStatus = row.status === 'APPROVED' && !row.reviewedAt ? 'IN_REVIEW' : (row.status as VisitStatus);
    const tasks = row.serviceType.checklistTemplate?._count.items ?? 0;
    return {
      id: row.id,
      date: fromDbDate(row.scheduledDate),
      slot: VISIT_SLOTS.find((slot) => slot === row.scheduledSlot) ?? null,
      status,
      outletId: row.outlet.id,
      outletName: row.outlet.name,
      organizationName: row.outlet.organization.name,
      area: row.outlet.area,
      serviceCode: row.serviceType.code,
      serviceName: row.serviceType.name as LocalizedText,
      supervisorId: row.supervisor?.id ?? null,
      supervisorName: row.supervisor?.name ?? null,
      taskCount: tasks > 0 ? tasks : null,
      crewSize: row.technicianNames.length > 0 ? row.technicianNames.length : null,
      booked: row.bookingId !== null,
      fromPlan: row.scheduleId !== null,
      createdAt: row.createdAt.toISOString(),
      // The same rule as the diary's own change: only before the visit has started.
      canMove: canMove && (row.status === 'SCHEDULED' || row.status === 'ASSIGNED'),
    };
  }

  /** The board is ECCS's: the Super Admin and Ops Manager see every visit, a Supervisor their own. */
  private requireEccs(user: AuthUser): 'all' | 'assigned' {
    const scope = accessScope(user.memberships, 'jobs');
    if (scope?.kind === 'all' || scope?.kind === 'assigned') return scope.kind;
    throw new ForbiddenException('The week board is for ECCS staff');
  }
}
