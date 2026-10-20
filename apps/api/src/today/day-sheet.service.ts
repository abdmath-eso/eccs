import { BadRequestException, ConflictException, ForbiddenException, Injectable } from '@nestjs/common';
import type { Prisma } from '@eccs/db';
import {
  accessScope,
  can,
  daySheetKey,
  indiaDay,
  indiaTimeWords,
  mapLink,
  mergeCarryList,
  sheetToDo,
  sheetVisitTime,
  sortSheetVisits,
  VISIT_SLOTS,
  type DaySheetDto,
  type DaySheetSentDto,
  type DaySheetVisitDto,
  type LocalizedText,
  type SheetToDoDto,
  type VisitSlot,
  type VisitStatus,
} from '@eccs/shared';
import type { AuthUser } from '../auth/auth.types.js';
import { NotificationsService } from '../notifications/notifications.service.js';
import { PrismaService } from '../prisma/prisma.service.js';

// The day's sheet (20 Oct 2026; docs/CONSOLE_PLAN.md 4.1 part 4): one per Supervisor with visits
// that day. Worked out from the diary each time it is read, so it is never out of date; "Send the
// day's sheet" only records that it was sent, with the visits as they stood, and tells the
// Supervisor (DAY_SHEET_SENT), whose app shows it at the top of the jobs list. Sending again is
// offered once the visits have changed since. The Supervisor's own copy also says what the
// Evening close still lists for their visits ("Still to do today").

const toDbDate = (date: string) => new Date(`${date}T00:00:00.000Z`);
const toSlot = (slot: string | null): VisitSlot | null => VISIT_SLOTS.find((known) => known === slot) ?? null;

const sheetVisitSelect = {
  id: true,
  outletId: true,
  status: true,
  reviewedAt: true,
  scheduledSlot: true,
  supervisorId: true,
  partnerName: true,
  free: true,
  supervisor: { select: { name: true } },
  outlet: { select: { name: true, address: true, city: true, latitude: true, longitude: true } },
  serviceType: { select: { name: true, carryItems: true } },
  signOff: { select: { id: true } },
  attachments: { where: { kind: { in: ['BEFORE', 'AFTER'] } }, select: { kind: true } },
} as const satisfies Prisma.JobSelect;
type SheetVisitRow = Prisma.JobGetPayload<{ select: typeof sheetVisitSelect }>;

@Injectable()
export class DaySheetService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly notifications: NotificationsService,
  ) {}

  private get db() {
    return this.prisma.client;
  }

  /** The office (every Supervisor's sheet) or a Supervisor (their own); anyone else has none. */
  private scopeOf(user: AuthUser): 'office' | 'own' {
    const scope = accessScope(user.memberships, 'jobs');
    if (scope?.kind === 'all') return 'office';
    if (scope?.kind === 'assigned') return 'own';
    throw new ForbiddenException('The day\'s sheet is for ECCS staff');
  }

  private maySend(user: AuthUser) {
    return this.scopeOf(user) === 'office' && can(user.memberships, 'jobs', 'create');
  }

  /** Today's sheets, for Today: the office sees one per Supervisor with visits, a Supervisor their own. In the order of each one's first visit. */
  async sheets(user: AuthUser, date: string): Promise<DaySheetDto[]> {
    const scope = this.scopeOf(user);
    const visits = await this.visitsOn(date, scope === 'own' ? user.id : undefined);
    const bySupervisor = new Map<string, SheetVisitRow[]>();
    for (const visit of visits) bySupervisor.set(visit.supervisorId!, [...(bySupervisor.get(visit.supervisorId!) ?? []), visit]);
    const [notes, sends] = await Promise.all([this.lastNotes([...new Set(visits.map((visit) => visit.outletId))], date), this.latestSends(date, [...bySupervisor.keys()])]);
    const maySend = this.maySend(user);
    const sheets = [...bySupervisor].map(([supervisorId, rows]) => this.sheetOf(date, supervisorId, rows[0]!.supervisor?.name ?? '', rows, notes, sends.get(supervisorId) ?? null, maySend, []));
    return sheets.sort((a, b) => (a.visits[0]?.time ?? '99:99').localeCompare(b.visits[0]?.time ?? '99:99') || a.supervisorName.localeCompare(b.supervisorName));
  }

  /** The Supervisor's own sheet for today, with "Still to do today": the top of the phone's jobs list. */
  async mine(user: AuthUser, now: Date): Promise<DaySheetDto> {
    if (this.scopeOf(user) !== 'own') throw new BadRequestException('This is a Supervisor\'s own sheet; the office sees every sheet on Today');
    const date = indiaDay(now);
    const rows = await this.visitsOn(date, user.id);
    const [notes, sends, toDo] = await Promise.all([this.lastNotes([...new Set(rows.map((visit) => visit.outletId))], date), this.latestSends(date, [user.id]), this.stillToDo(user.id, date, rows)]);
    return this.sheetOf(date, user.id, user.name, rows, notes, sends.get(user.id) ?? null, false, toDo);
  }

  /**
   * Send the day's sheet: records it with the visits as they stand and tells the Supervisor.
   * Today only; again only once the visits have changed since the last time.
   */
  async send(user: AuthUser, supervisorId: string, date: string, now: Date): Promise<DaySheetSentDto> {
    if (!this.maySend(user)) throw new ForbiddenException('The Super Admin and the Ops Manager send the day\'s sheet');
    if (date !== indiaDay(now)) throw new ConflictException('That day has ended. Open Today again to send today\'s sheet.');
    const rows = await this.visitsOn(date, supervisorId);
    if (rows.length === 0) throw new ConflictException('This Supervisor has no visits today');
    const key = daySheetKey(rows.map((row) => ({ visitId: row.id, slot: toSlot(row.scheduledSlot) })));
    const earlier = await this.db.daySheetSend.findMany({ where: { date: toDbDate(date), supervisorId }, orderBy: { sentAt: 'desc' } });
    if (earlier[0]?.visitsKey === key) {
      throw new ConflictException(`Already sent at ${indiaTimeWords(earlier[0].sentAt)}; nothing has changed since`);
    }
    await this.db.daySheetSend.create({ data: { date: toDbDate(date), supervisorId, sentById: user.id, sentAt: now, visitsKey: key, visitCount: rows.length } });
    const told = await this.notifications.send(
      [supervisorId],
      'DAY_SHEET_SENT',
      { date, count: rows.length },
      { kind: 'services' },
      // Each sending is its own notification: the second one says the day changed.
      { dedupeKey: `day-sheet:${supervisorId}:${date}:${earlier.length + 1}` },
    );
    return { supervisorId, date, sentAt: now.toISOString(), told };
  }

  // ───────────────────────── The parts ─────────────────────────

  /** The day's visits that have a Supervisor (not cancelled), for one Supervisor or all. */
  private visitsOn(date: string, supervisorId?: string): Promise<SheetVisitRow[]> {
    return this.db.job.findMany({
      where: { scheduledDate: toDbDate(date), status: { not: 'CANCELLED' }, supervisorId: supervisorId ?? { not: null } },
      select: sheetVisitSelect,
      orderBy: { createdAt: 'asc' },
    });
  }

  /** What the Supervisor wrote at each outlet's last visit before this day (as Today's visits list shows it). */
  private async lastNotes(outletIds: string[], date: string): Promise<Map<string, string>> {
    if (outletIds.length === 0) return new Map();
    const rows = await this.db.job.findMany({
      where: { outletId: { in: outletIds }, scheduledDate: { lt: toDbDate(date) }, status: { in: ['COMPLETED', 'APPROVED'] }, notes: { not: null } },
      select: { outletId: true, notes: true },
      orderBy: [{ scheduledDate: 'desc' }, { completedAt: 'desc' }],
      distinct: ['outletId'],
    });
    return new Map(rows.filter((row) => row.notes).map((row) => [row.outletId, row.notes!]));
  }

  private async latestSends(date: string, supervisorIds: string[]) {
    if (supervisorIds.length === 0) return new Map<string, { sentAt: Date; byName: string; visitsKey: string }>();
    const rows = await this.db.daySheetSend.findMany({
      where: { date: toDbDate(date), supervisorId: { in: supervisorIds } },
      orderBy: { sentAt: 'desc' },
      distinct: ['supervisorId'],
    });
    const people = await this.db.user.findMany({ where: { id: { in: rows.map((row) => row.sentById) } }, select: { id: true, name: true } });
    return new Map(
      rows.map((row) => [row.supervisorId, { sentAt: row.sentAt, byName: people.find((person) => person.id === row.sentById)?.name ?? 'someone who has left', visitsKey: row.visitsKey }]),
    );
  }

  private sheetOf(
    date: string,
    supervisorId: string,
    supervisorName: string,
    rows: SheetVisitRow[],
    notes: Map<string, string>,
    sent: { sentAt: Date; byName: string; visitsKey: string } | null,
    canSend: boolean,
    stillToDo: SheetToDoDto[],
  ): DaySheetDto {
    const visits = sortSheetVisits(
      rows.map((row): DaySheetVisitDto => {
        const slot = toSlot(row.scheduledSlot);
        const address = [row.outlet.address, row.outlet.city].filter(Boolean).join(', ') || null;
        return {
          visitId: row.id,
          time: sheetVisitTime(slot),
          slot,
          outletName: row.outlet.name,
          address,
          mapUrl: mapLink({ latitude: row.outlet.latitude, longitude: row.outlet.longitude, address }),
          serviceName: row.serviceType.name as LocalizedText,
          status: (row.status === 'APPROVED' && !row.reviewedAt ? 'IN_REVIEW' : row.status) as VisitStatus,
          partnerName: row.partnerName,
          free: row.free,
          lastNote: notes.get(row.outletId) ?? null,
          carry: row.serviceType.carryItems,
        };
      }),
    );
    const key = daySheetKey(visits.map((visit) => ({ visitId: visit.visitId, slot: visit.slot })));
    return {
      date,
      supervisorId,
      supervisorName,
      visits,
      carry: mergeCarryList(visits.map((visit) => ({ visitId: visit.visitId, outletName: visit.outletName, time: visit.time, items: visit.carry }))),
      sent: sent && { at: sent.sentAt.toISOString(), byName: sent.byName, changedSince: sent.visitsKey !== key },
      canSend: canSend && visits.length > 0,
      stillToDo,
    };
  }

  /** The Evening close's lines for one Supervisor's own visits, per visit (the rules in shared `sheetToDo`). */
  private async stillToDo(supervisorId: string, date: string, rows: SheetVisitRow[]): Promise<SheetToDoDto[]> {
    const [inspections, returned] = await Promise.all([
      this.db.inspection.findMany({ where: { plannedDate: toDbDate(date), status: 'DRAFT', supervisorId }, select: { id: true, outlet: { select: { name: true } } } }),
      // Reports ECCS sent back for correction and not yet handed in again, whatever their day.
      this.db.job.findMany({ where: { status: 'IN_PROGRESS', signOff: { isNot: null }, supervisorId }, select: { id: true, outlet: { select: { name: true } } } }),
    ]);
    return sheetToDo({
      // In the order of the day, as the sheet lists them.
      visits: sortSheetVisits(rows.map((row) => ({ ...row, slot: toSlot(row.scheduledSlot), outletName: row.outlet.name })))
        // A report sent back is listed once, as sent back, not also as a visit to finish.
        .filter((row) => !(row.status === 'IN_PROGRESS' && row.signOff))
        .map((row) => {
          const kinds = new Set(row.attachments.map((photo) => photo.kind));
          return {
            visitId: row.id,
            outletName: row.outlet.name,
            finished: row.status === 'COMPLETED' || row.status === 'APPROVED',
            hasBefore: kinds.has('BEFORE'),
            hasAfter: kinds.has('AFTER'),
            awaitingSignOff: row.status === 'COMPLETED',
          };
        }),
      inspections: inspections.map((inspection) => ({ inspectionId: inspection.id, outletName: inspection.outlet.name })),
      returned: returned.map((visit) => ({ visitId: visit.id, outletName: visit.outlet.name })),
    });
  }
}
