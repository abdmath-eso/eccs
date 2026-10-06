import { BadRequestException, ForbiddenException, Injectable } from '@nestjs/common';
import {
  accessScope,
  CALENDAR_MONTHS_AHEAD,
  CALENDAR_MONTHS_BACK,
  can,
  daysInMonth,
  holidaysBetween,
  shiftMonth,
  type CalendarDayDto,
  type CalendarMonthDto,
  type CalendarUpcomingDto,
  type CalendarVisitDto,
  type CalendarVisitState,
  type LocalizedText,
} from '@eccs/shared';
import type { AuthUser } from '../auth/auth.types.js';
import { ChecklistsService, indiaDate } from '../checklists/checklists.service.js';
import { PrismaService } from '../prisma/prisma.service.js';

const UPCOMING_LICENCE_DAYS = 90;
const MAX_UPCOMING = 8;

const toDbDate = (date: string) => new Date(`${date}T00:00:00.000Z`);
const fromDbDate = (date: Date) => date.toISOString().slice(0, 10);

type JobRow = { id: string; scheduledDate: Date; scheduledSlot: string | null; status: string; serviceType: { name: unknown } };

/**
 * The restaurant's history calendar: for one outlet and one month, what
 * happened on each past day and what is booked or falling due ahead.
 */
@Injectable()
export class CalendarService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly checklists: ChecklistsService,
  ) {}

  private get db() {
    return this.prisma.client;
  }

  async month(user: AuthUser, outletId: string, month: string): Promise<CalendarMonthDto> {
    await this.requireOutlet(user, outletId);
    const today = indiaDate();
    const thisMonth = today.slice(0, 7);
    if (
      !/^\d{4}-(0[1-9]|1[0-2])$/.test(month) ||
      month < shiftMonth(thisMonth, -CALENDAR_MONTHS_BACK) ||
      month > shiftMonth(thisMonth, CALENDAR_MONTHS_AHEAD)
    ) {
      throw new BadRequestException('The calendar covers one year back and one year ahead');
    }
    const first = `${month}-01`;
    const last = `${month}-${String(daysInMonth(month)).padStart(2, '0')}`;

    // Today's checklists exist only once someone has looked at them; make sure they do.
    if (month === thisMonth) await this.checklists.today(user, outletId);

    const [runs, jobs, licences, upcoming] = await Promise.all([
      this.checklists.between(user, outletId, first, last),
      this.db.job.findMany({
        where: { outletId, scheduledDate: { gte: toDbDate(first), lte: toDbDate(last) }, status: { not: 'CANCELLED' } },
        select: { id: true, scheduledDate: true, scheduledSlot: true, status: true, serviceType: { select: { name: true } } },
        orderBy: { scheduledDate: 'asc' },
      }),
      this.db.licence.findMany({
        where: { outletId, expiresOn: { gte: toDbDate(first), lte: toDbDate(last) } },
        select: { id: true, type: true, name: true, expiresOn: true },
        orderBy: { expiresOn: 'asc' },
      }),
      this.upcoming(outletId, today),
    ]);

    const days = new Map<string, CalendarDayDto>();
    const day = (date: string) => {
      let entry = days.get(date);
      if (!entry) days.set(date, (entry = { date, checklists: [], visits: [], licences: [], holidays: [] }));
      return entry;
    };
    for (const run of runs) day(run.date).checklists.push(run);
    for (const job of jobs) day(fromDbDate(job.scheduledDate)).visits.push(toVisit(job, today));
    for (const licence of licences) {
      day(fromDbDate(licence.expiresOn)).licences.push({ id: licence.id, type: licence.type, name: licence.name });
    }
    for (const holiday of holidaysBetween(first, last)) day(holiday.date).holidays.push(holiday.name);

    return {
      outletId,
      month,
      today,
      days: [...days.values()].sort((a, b) => a.date.localeCompare(b.date)),
      upcoming,
    };
  }

  /** The next service visits, and licences expiring in the coming weeks, soonest first. */
  private async upcoming(outletId: string, today: string): Promise<CalendarUpcomingDto[]> {
    const [jobs, licences] = await Promise.all([
      this.db.job.findMany({
        where: {
          outletId,
          scheduledDate: { gte: toDbDate(today) },
          status: { in: ['SCHEDULED', 'ASSIGNED', 'IN_PROGRESS'] },
        },
        select: { id: true, scheduledDate: true, scheduledSlot: true, status: true, serviceType: { select: { name: true } } },
        orderBy: { scheduledDate: 'asc' },
        take: MAX_UPCOMING,
      }),
      this.db.licence.findMany({
        where: {
          outletId,
          expiresOn: {
            gte: toDbDate(today),
            lte: new Date(toDbDate(today).getTime() + UPCOMING_LICENCE_DAYS * 86_400_000),
          },
        },
        select: { id: true, type: true, name: true, expiresOn: true },
        orderBy: { expiresOn: 'asc' },
        take: MAX_UPCOMING,
      }),
    ]);

    const entries: CalendarUpcomingDto[] = [
      ...jobs.map((job) => ({ date: fromDbDate(job.scheduledDate), kind: 'visit' as const, visit: toVisit(job, today) })),
      ...licences.map((licence) => ({
        date: fromDbDate(licence.expiresOn),
        kind: 'licence' as const,
        licence: { id: licence.id, type: licence.type, name: licence.name },
      })),
    ];
    return entries.sort((a, b) => a.date.localeCompare(b.date)).slice(0, MAX_UPCOMING);
  }

  /** Checks the user may see this outlet's calendar. "Not found" and "not yours" look the same. */
  private async requireOutlet(user: AuthUser, outletId: string) {
    const outlet = await this.db.outlet.findUnique({ where: { id: outletId }, select: { organizationId: true } });
    const target = { organizationId: outlet?.organizationId ?? null, outletId };
    let allowed =
      outlet !== null && can(user.memberships, 'jobs', 'read', target) && can(user.memberships, 'checklists', 'read', target);
    // A Supervisor sees only the outlets they have visits at.
    if (allowed && accessScope(user.memberships, 'jobs')?.kind === 'assigned') {
      allowed = (await this.db.job.count({ where: { outletId, supervisorId: user.id } })) > 0;
    }
    if (!allowed) throw new ForbiddenException('You cannot see this outlet');
  }
}

function toVisit(job: JobRow, today: string): CalendarVisitDto {
  let state: CalendarVisitState;
  if (job.status === 'COMPLETED' || job.status === 'APPROVED') state = 'DONE';
  else if (job.status === 'IN_PROGRESS') state = 'IN_PROGRESS';
  else state = fromDbDate(job.scheduledDate) >= today ? 'UPCOMING' : 'NOT_DONE';
  return { id: job.id, service: job.serviceType.name as LocalizedText, slot: job.scheduledSlot, state };
}
