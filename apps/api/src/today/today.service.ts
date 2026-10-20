import { ConflictException, ForbiddenException, Injectable, NotFoundException } from '@nestjs/common';
import type { Prisma } from '@eccs/db';
import {
  accessScope,
  addDays,
  can,
  closeProgress,
  closeShownFully,
  eveningClose,
  indiaClock,
  indiaDay,
  indiaMoment,
  indiaTimeWords,
  invoiceOverdueDays,
  ISSUE_CATEGORY_LABELS,
  localize,
  namesWords,
  salesRupees,
  shortDate,
  slotTime,
  sortTodayItems,
  sortTodayVisits,
  TODAY_ITEMS,
  TODAY_RULES,
  todayHeadline,
  todayItem,
  VISIT_SLOTS,
  visitBadge,
  visitStanding,
  type CloseFacts,
  type CloseLineKey,
  type DayClosedDto,
  type LocalizedText,
  type SignOffRemindedDto,
  type TodayDto,
  type TodayItemDto,
  type TodayItemFacts,
  type TodayItemKind,
  type TodayNoteDto,
  type TodayVisitDto,
  type VisitSlot,
  type VisitStatus,
} from '@eccs/shared';
import type { AuthUser } from '../auth/auth.types.js';
import { NotificationsService } from '../notifications/notifications.service.js';
import { OutletOnboardingService } from '../outlet-onboarding/outlet-onboarding.service.js';
import { FollowUpsService } from '../quality/follow-ups.service.js';
import { IncidentsService } from '../quality/incidents.service.js';
import { PhotoReviewsService } from '../quality/photo-reviews.service.js';
import { PrismaService } from '../prisma/prisma.service.js';
import { SalesService } from '../sales/sales.service.js';
import { WeekBoardService } from '../services/week-board.service.js';
import { TeamService } from '../team/team.service.js';
import { DaySheetService } from './day-sheet.service.js';

// Today, the console's home (20 Oct 2026; docs/CONSOLE_PLAN.md 4.1). One endpoint works the
// whole page out from the records the other pages already keep, through their own services
// where they have one (the week board's capacity, New outlets' stuck outlets and calls, the
// team's documents, Sales' Do today) and the shared rules (packages/shared/src/today.ts, and
// `visitStanding`, the monitoring board's reading of a visit). Nothing is stored except a
// sign-off reminder's time on its visit and the day's close. "Today" is the India date.

const toDbDate = (date: string) => new Date(`${date}T00:00:00.000Z`);
const fromDbDate = (date: Date) => date.toISOString().slice(0, 10);
const toSlot = (slot: string | null): VisitSlot | null => VISIT_SLOTS.find((known) => known === slot) ?? null;
const english = (text: unknown) => localize(text as LocalizedText, 'EN');

/** Unpaid invoices: issued and not yet paid in full. */
const UNPAID = ['ISSUED', 'PARTIALLY_PAID'] as const;

const todayVisitSelect = {
  id: true,
  outletId: true,
  status: true,
  scheduledSlot: true,
  supervisorId: true,
  partnerName: true,
  reviewedAt: true,
  outlet: { select: { name: true, area: true } },
  serviceType: { select: { name: true, partnerDelivered: true } },
  supervisor: { select: { name: true } },
  signOff: { select: { id: true } },
  attachments: { where: { kind: { in: ['BEFORE', 'AFTER'] } }, select: { kind: true } },
} as const satisfies Prisma.JobSelect;

type TodayVisitRow = Prisma.JobGetPayload<{ select: typeof todayVisitSelect }>;

/** "Today" for the office (the Super Admin and the Ops Manager, every visit) or for a Supervisor (their own). */
type Scope = 'office' | 'own';

@Injectable()
export class TodayService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly weekBoard: WeekBoardService,
    private readonly onboarding: OutletOnboardingService,
    private readonly sales: SalesService,
    private readonly team: TeamService,
    private readonly notifications: NotificationsService,
    private readonly followUps: FollowUpsService,
    private readonly photoReviews: PhotoReviewsService,
    private readonly incidents: IncidentsService,
    private readonly daySheets: DaySheetService,
  ) {}

  private get db() {
    return this.prisma.client;
  }

  /** The whole page, for this person, at `now`. */
  async today(user: AuthUser, now: Date): Promise<TodayDto> {
    const scope = this.scopeOf(user);
    const office = scope === 'office';
    const today = indiaDay(now);
    const may = (resource: Parameters<typeof can>[1], action: Parameters<typeof can>[2]) => can(user.memberships, resource, action);
    const seesChecks = office && may('sales', 'read');
    const seesMoney = office && may('invoices', 'update');

    const visits = await this.visitsOn(user, scope, today);
    const outletIds = [...new Set(visits.map((visit) => visit.outletId))];
    // Read once: the rows' warnings and the Needs you item both come from it.
    const owing = seesMoney ? this.overdueAt(outletIds, today) : Promise.resolve(new Map<string, OverdueAtOutlet>());
    const [checks, overdue, lastNotes, capacity, needsYou, alsoToday, close, sheets] = await Promise.all([
      seesChecks
        ? this.db.lead.findMany({
            where: { checkAt: { gte: indiaMoment(today), lt: indiaMoment(addDays(today, 1)) }, checkDoneAt: null, status: 'OPEN' },
            select: { id: true, businessName: true, area: true, checkAt: true, checkWith: true },
          })
        : Promise.resolve([]),
      owing,
      this.lastNotes(outletIds, today),
      office ? this.weekBoard.dayLoad(today) : Promise.resolve(null),
      this.needsYou(user, scope, now, visits, owing),
      office ? this.alsoToday(user, now) : Promise.resolve([]),
      this.close(user, scope, now, visits),
      this.daySheets.sheets(user, today),
    ]);

    const rows: TodayVisitDto[] = [
      ...visits.map((visit): TodayVisitDto => {
        const slot = toSlot(visit.scheduledSlot);
        return {
          kind: 'VISIT',
          id: visit.id,
          time: slotTime(slot),
          slot,
          outletName: visit.outlet.name,
          area: visit.outlet.area,
          serviceName: english(visit.serviceType.name),
          supervisorName: visit.supervisor?.name ?? null,
          // As the Visits page says it: signed off and not yet approved is "Report to approve".
          status: (visit.status === 'APPROVED' && !visit.reviewedAt ? 'IN_REVIEW' : visit.status) as VisitStatus,
          partnerName: visit.partnerName,
          lastNote: lastNotes.get(visit.outletId) ?? null,
          badge: visitBadge({
            freeCheck: false,
            partner: Boolean(visit.partnerName) || visit.serviceType.partnerDelivered,
            overdueDays: overdue.get(visit.outletId)?.days ?? null,
          }),
        };
      }),
      ...checks.map(
        (lead): TodayVisitDto => ({
          kind: 'FREE_CHECK',
          id: lead.id,
          time: indiaClock(lead.checkAt!),
          slot: null,
          outletName: lead.businessName,
          area: lead.area,
          serviceName: 'Free check',
          supervisorName: lead.checkWith,
          status: null,
          partnerName: null,
          lastNote: null,
          badge: visitBadge({ freeCheck: true, partner: false, overdueDays: null }),
        }),
      ),
    ];

    return {
      date: today,
      at: now.toISOString(),
      scope,
      headline: todayHeadline({ visits: visits.length, checks: seesChecks ? checks.length : null, needsYou: needsYou.length }),
      visits: sortTodayVisits(rows),
      capacity: capacity && { booked: capacity.booked, capacity: capacity.capacity, over: capacity.over },
      needsYou,
      alsoToday,
      close,
      sheets,
    };
  }

  /** Remind: the existing SIGN_OFF_WAITING notification to the outlet's Owner and Managers, once a day per visit. */
  async remind(user: AuthUser, visitId: string, now: Date): Promise<SignOffRemindedDto> {
    const scope = this.scopeOf(user);
    const visit = await this.db.job.findUnique({
      where: { id: visitId },
      select: {
        id: true,
        outletId: true,
        status: true,
        supervisorId: true,
        scheduledDate: true,
        completedAt: true,
        signOffRemindedAt: true,
        outlet: { select: { name: true } },
        serviceType: { select: { name: true } },
      },
    });
    // A Supervisor reminds for their own visits only; anyone else's looks as if it does not exist.
    if (!visit || (scope === 'own' && visit.supervisorId !== user.id)) throw new NotFoundException('Visit not found');
    if (visit.status !== 'COMPLETED') throw new ConflictException('This visit is not waiting for a sign-off');
    const today = indiaDay(now);
    if (visit.signOffRemindedAt && indiaDay(visit.signOffRemindedAt) === today) {
      throw new ConflictException(`The restaurant was reminded today at ${indiaTimeWords(visit.signOffRemindedAt)}`);
    }
    const people = await this.notifications.restaurantPeople(visit.outletId, ['OWNER', 'MANAGER']);
    if (people.length === 0) throw new ConflictException('Nobody at this outlet has the app yet, so there is no one to remind');

    // Taken first, so two presses at the same moment remind once.
    const claimed = await this.db.job.updateMany({
      where: { id: visit.id, status: 'COMPLETED', OR: [{ signOffRemindedAt: null }, { signOffRemindedAt: { lt: indiaMoment(today) } }] },
      data: { signOffRemindedAt: now, signOffRemindedById: user.id },
    });
    if (claimed.count === 0) throw new ConflictException('The restaurant has just been reminded');

    const told = await this.notifications.send(
      people,
      'SIGN_OFF_WAITING',
      { outlet: visit.outlet.name, service: visit.serviceType.name as LocalizedText, date: indiaDay(visit.completedAt ?? visit.scheduledDate) },
      { kind: 'visit', visitId: visit.id },
      // The day is part of the key, so a reminder tomorrow is a new one; the automatic reminder after a day has its own key.
      { dedupeKey: `sign-off-reminded:${visit.id}:${today}` },
    );
    return { visitId: visit.id, remindedAt: now.toISOString(), told };
  }

  /**
   * Close the day: records who closed it and when, with the lines still open. It warns in the
   * console and never refuses for an open line (decision 5): a restaurant's late sign-off is
   * not the office's to force. Once per day.
   */
  async closeDay(user: AuthUser, date: string, now: Date): Promise<DayClosedDto> {
    if (this.scopeOf(user) !== 'office' || !can(user.memberships, 'jobs', 'create')) {
      throw new ForbiddenException('The Super Admin and the Ops Manager close the day');
    }
    const today = indiaDay(now);
    if (date !== today) throw new ConflictException('That day has ended. Open Today again to close today.');
    const earlier = await this.closedOn(today);
    if (earlier) throw new ConflictException(`This day was closed at ${indiaTimeWords(earlier.closedAt)} by ${earlier.closedByName}`);

    const visits = await this.visitsOn(user, 'office', today);
    const lines = eveningClose(await this.closeFacts(user, 'office', now, visits));
    const openLines = lines.filter((line) => line.state === 'OPEN').map(({ key, label, words }) => ({ key, label, words }));
    try {
      await this.db.dayClose.create({ data: { date: toDbDate(today), closedById: user.id, closedAt: now, openLines } });
    } catch (error) {
      // Two people pressing at once: the first one closes it.
      if ((error as { code?: string }).code !== 'P2002') throw error;
      const first = await this.closedOn(today);
      throw new ConflictException(first ? `This day was closed at ${indiaTimeWords(first.closedAt)} by ${first.closedByName}` : 'This day is already closed');
    }
    return (await this.closedOn(today))!;
  }

  // ───────────────────────── The parts ─────────────────────────

  /** The office sees every visit; a Supervisor their own. Anyone else (a BDE) has no Today. */
  private scopeOf(user: AuthUser): Scope {
    const scope = accessScope(user.memberships, 'jobs');
    if (scope?.kind === 'all') return 'office';
    if (scope?.kind === 'assigned') return 'own';
    throw new ForbiddenException('Today is for ECCS staff');
  }

  private visitsOn(user: AuthUser, scope: Scope, date: string): Promise<TodayVisitRow[]> {
    return this.db.job.findMany({
      where: { scheduledDate: toDbDate(date), status: { not: 'CANCELLED' }, ...(scope === 'own' && { supervisorId: user.id }) },
      select: todayVisitSelect,
      orderBy: { createdAt: 'asc' },
    });
  }

  /** What the Supervisor wrote at each outlet's last visit before today ("hood filter heavily clogged"). */
  private async lastNotes(outletIds: string[], today: string): Promise<Map<string, string>> {
    if (outletIds.length === 0) return new Map();
    const rows = await this.db.job.findMany({
      where: { outletId: { in: outletIds }, scheduledDate: { lt: toDbDate(today) }, status: { in: ['COMPLETED', 'APPROVED'] }, notes: { not: null } },
      select: { outletId: true, notes: true },
      orderBy: [{ scheduledDate: 'desc' }, { completedAt: 'desc' }],
      distinct: ['outletId'],
    });
    return new Map(rows.filter((row) => row.notes).map((row) => [row.outletId, row.notes!]));
  }

  /** Each outlet's overdue money: the oldest invoice past its due date, how late, and how much is owed in all. */
  private async overdueAt(outletIds: string[], today: string): Promise<Map<string, OverdueAtOutlet>> {
    const found = new Map<string, OverdueAtOutlet>();
    if (outletIds.length === 0) return found;
    const invoices = await this.db.invoice.findMany({
      where: { outletId: { in: outletIds }, status: { in: [...UNPAID] }, dueDate: { lt: toDbDate(today) } },
      select: { id: true, outletId: true, dueDate: true, totalPaise: true, paidPaise: true },
      orderBy: { dueDate: 'asc' },
    });
    for (const invoice of invoices) {
      const duePaise = invoice.totalPaise - invoice.paidPaise;
      const days = invoiceOverdueDays(fromDbDate(invoice.dueDate), today, duePaise);
      if (!invoice.outletId || days <= 0) continue;
      const known = found.get(invoice.outletId);
      if (known) {
        known.duePaise += duePaise;
        known.invoices += 1;
      } else {
        found.set(invoice.outletId, { invoiceId: invoice.id, days, duePaise, invoices: 1 });
      }
    }
    return found;
  }

  /**
   * Needs you: every kind's facts, made into items by the shared rules (which also apply the
   * thresholds), most urgent first. A kind is gathered only for someone who may act on it.
   */
  private async needsYou(
    user: AuthUser,
    scope: Scope,
    now: Date,
    visits: TodayVisitRow[],
    owing: Promise<Map<string, OverdueAtOutlet>>,
  ): Promise<TodayItemDto[]> {
    const office = scope === 'office';
    const today = indiaDay(now);
    const shown = (kind: TodayItemKind) => {
      const { needs, mine } = TODAY_ITEMS[kind];
      return can(user.memberships, needs.resource, needs.action) && (office || mine);
    };
    const mineOnly = office ? {} : { supervisorId: user.id };
    // Sign-offs and reports come from one reading of the open visits, asked for by both kinds.
    let waiting: ReturnType<TodayService['waitingVisits']> | undefined;
    const waitingVisits = () => (waiting ??= this.waitingVisits(mineOnly, today));

    // One gatherer per kind, in one place: step 3 of the plan adds its three kinds here.
    const gatherers: Record<TodayItemKind, () => Promise<TodayItemFacts[]>> = {
      VISIT_NO_SUPERVISOR: async () =>
        (
          await this.db.job.findMany({
            where: {
              supervisorId: null,
              status: { in: ['SCHEDULED', 'ASSIGNED'] },
              scheduledDate: { gte: toDbDate(today), lte: toDbDate(addDays(today, TODAY_RULES.unassignedDaysAhead)) },
            },
            select: { id: true, scheduledDate: true, scheduledSlot: true, outlet: { select: { name: true } }, serviceType: { select: { name: true } } },
          })
        ).map((job) => ({
          kind: 'VISIT_NO_SUPERVISOR' as const,
          visitId: job.id,
          outletName: job.outlet.name,
          serviceName: english(job.serviceType.name),
          date: fromDbDate(job.scheduledDate),
          slot: toSlot(job.scheduledSlot),
        })),
      INVOICE_OVERDUE_VISIT_TODAY: async () =>
        [...(await owing).entries()].map(([outletId, owed]) => {
          const there = visits.filter((visit) => visit.outletId === outletId);
          // The earliest of the day's visits there: when the crew can ask. VISIT_SLOTS runs in time order.
          const slots = there.map((visit) => toSlot(visit.scheduledSlot)).filter((slot): slot is VisitSlot => slot !== null);
          slots.sort((a, b) => VISIT_SLOTS.indexOf(a) - VISIT_SLOTS.indexOf(b));
          return {
            kind: 'INVOICE_OVERDUE_VISIT_TODAY' as const,
            invoiceId: owed.invoiceId,
            outletName: there[0]!.outlet.name,
            duePaise: owed.duePaise,
            overdueDays: owed.days,
            invoices: owed.invoices,
            visitSlot: slots[0] ?? null,
          };
        }),
      BOOKING_WAITING: async () =>
        (
          await this.db.booking.findMany({
            where: { status: 'REQUESTED' },
            select: { id: true, preferredDate: true, preferredSlot: true, createdAt: true, outlet: { select: { name: true } }, catalogItem: { select: { name: true } } },
          })
        ).map((booking) => ({
          kind: 'BOOKING_WAITING' as const,
          bookingId: booking.id,
          outletName: booking.outlet.name,
          serviceName: english(booking.catalogItem.name),
          preferredDate: fromDbDate(booking.preferredDate),
          preferredSlot: toSlot(booking.preferredSlot),
          requestedAt: booking.createdAt.toISOString(),
        })),
      ISSUE_NOT_PICKED_UP: async () =>
        (
          await this.db.issue.findMany({
            // A Supervisor's issues are those at the outlets they visit, as on the Issues page.
            where: { status: 'OPEN', ...(!office && { outlet: { jobs: { some: { supervisorId: user.id } } } }) },
            select: { id: true, reference: true, category: true, createdAt: true, outlet: { select: { name: true } } },
          })
        ).map((issue) => ({
          kind: 'ISSUE_NOT_PICKED_UP' as const,
          issueId: issue.id,
          reference: `ECCS-${String(issue.reference).padStart(4, '0')}`,
          outletName: issue.outlet.name,
          category: ISSUE_CATEGORY_LABELS[issue.category],
          raisedAt: issue.createdAt.toISOString(),
        })),
      OUTLET_STUCK: async () =>
        (await this.onboarding.attention(now)).stuck.map((outlet) => ({
          kind: 'OUTLET_STUCK' as const,
          outletId: outlet.outletId,
          outletName: outlet.outletName,
          hoursSinceAdded: outlet.hoursSinceAdded,
        })),
      SIGN_OFF_WAITING: async () => (await waitingVisits()).signOffs,
      REPORT_TO_APPROVE: async () => (await waitingVisits()).reports,
      // Quality's three (console plan step 3), read through its own services.
      FOLLOW_UP_DUE: async () =>
        (await this.followUps.due(now)).map((row) => ({
          kind: 'FOLLOW_UP_DUE' as const,
          followUpId: row.id,
          outletName: row.outletName,
          reason: row.reason,
          causedAt: row.causedAt,
        })),
      PHOTO_FLAGGED: async () => {
        const waiting = await this.photoReviews.waitingFacts(now);
        return waiting ? [{ kind: 'PHOTO_FLAGGED' as const, ...waiting }] : [];
      },
      INCIDENT_OPEN: async () =>
        (await this.incidents.open()).map((incident) => ({
          kind: 'INCIDENT_OPEN' as const,
          incidentId: incident.id,
          reference: incident.reference,
          outletName: incident.outletName,
          whatHappened: incident.whatHappened,
          happenedOn: incident.happenedOn,
        })),
    };

    const kinds = (Object.keys(gatherers) as TodayItemKind[]).filter(shown);
    const facts = (await Promise.all(kinds.map((kind) => gatherers[kind]()))).flat();
    return sortTodayItems(facts.map((one) => todayItem(one, now)).filter((item): item is TodayItemDto => item !== null));
  }

  /**
   * Finished visits waiting for the restaurant's sign-off, and signed-off reports waiting for
   * ECCS, read as the monitoring board reads them (`visitStanding`).
   */
  private async waitingVisits(mineOnly: Prisma.JobWhereInput, today: string): Promise<{ signOffs: TodayItemFacts[]; reports: TodayItemFacts[] }> {
    const rows = await this.db.job.findMany({
      where: { ...mineOnly, OR: [{ status: 'COMPLETED' }, { status: 'APPROVED', reviewedAt: null }] },
      select: {
        id: true,
        status: true,
        scheduledDate: true,
        completedAt: true,
        approvedAt: true,
        signOffRemindedAt: true,
        signOff: { select: { id: true } },
        outlet: { select: { name: true } },
        serviceType: { select: { name: true } },
      },
    });
    const signOffs: TodayItemFacts[] = [];
    const reports: TodayItemFacts[] = [];
    for (const row of rows) {
      const date = fromDbDate(row.scheduledDate);
      const finishedOn = row.completedAt ? indiaDay(row.completedAt) : null;
      const signedOffOn = row.approvedAt ? indiaDay(row.approvedAt) : null;
      const standing = visitStanding({ status: row.status, date, finishedOn, signedOffOn, hasSignOff: row.signOff !== null, reviewed: false }, today);
      const base = { visitId: row.id, outletName: row.outlet.name, serviceName: english(row.serviceType.name) };
      if (standing.stage === 'AWAITING_SIGN_OFF') {
        signOffs.push({ kind: 'SIGN_OFF_WAITING', ...base, finishedOn: finishedOn ?? date, remindedAt: row.signOffRemindedAt?.toISOString() ?? null });
      } else if (standing.stage === 'REPORT_TO_APPROVE') {
        reports.push({ kind: 'REPORT_TO_APPROVE', ...base, signedOffOn: signedOffOn ?? date });
      }
    }
    return { signOffs, reports };
  }

  /** Also today: worth knowing, a link each and no button. The office's only. */
  private async alsoToday(user: AuthUser, now: Date): Promise<TodayNoteDto[]> {
    const today = indiaDay(now);
    const may = (resource: Parameters<typeof can>[1], action: Parameters<typeof can>[2]) => can(user.memberships, resource, action);
    const none = <T>(value: T) => Promise.resolve(value);
    const [dueToday, doToday, attention, documents, planVisits] = await Promise.all([
      may('invoices', 'update')
        ? this.db.invoice.findMany({
            where: { status: { in: [...UNPAID] }, dueDate: toDbDate(today) },
            select: { totalPaise: true, paidPaise: true, organization: { select: { name: true } }, outlet: { select: { name: true } } },
            orderBy: { totalPaise: 'desc' },
          })
        : none([]),
      may('sales', 'read') ? this.sales.doToday(user) : none({ items: [] }),
      may('clients', 'create') ? this.onboarding.attention(now) : none({ stuck: [], calls: [] }),
      may('team', 'read') ? this.team.documentsDue() : none({ today, items: [] }),
      may('jobs', 'create')
        ? this.db.job.findMany({
            where: { scheduleId: { not: null }, createdAt: { gte: indiaMoment(today), lt: indiaMoment(addDays(today, 1)) } },
            select: { scheduledDate: true },
            orderBy: { scheduledDate: 'asc' },
          })
        : none([]),
    ]);

    const notes: TodayNoteDto[] = [];
    const owed = dueToday.filter((invoice) => invoice.totalPaise > invoice.paidPaise);
    if (owed.length > 0) {
      notes.push({
        key: 'INVOICES_DUE',
        title: `Invoices due today: ${owed.length}`,
        detail: owed
          .slice(0, TODAY_RULES.namesShown)
          .map((invoice) => `${invoice.outlet?.name ?? invoice.organization.name} ${salesRupees(invoice.totalPaise - invoice.paidPaise)}`)
          .join(' · ') + (owed.length > TODAY_RULES.namesShown ? ` · and ${owed.length - TODAY_RULES.namesShown} more` : ''),
        target: { kind: 'INVOICES' },
      });
    }
    if (doToday.items.length > 0) {
      const late = doToday.items.filter((item) => item.bucket === 'OVERDUE').length;
      notes.push({
        key: 'SALES_CALLS',
        title: `Sales calls and follow-ups due: ${doToday.items.length}`,
        detail: `${late > 0 ? `${late} overdue · ` : ''}${namesWords(doToday.items.map((item) => item.businessName))}`,
        target: { kind: 'SALES' },
      });
    }
    for (const call of attention.calls) {
      const day10 = call.kind === 'DAY10_CALL';
      notes.push({
        key: `ONBOARDING_CALL:${call.outletId}:${call.kind}`,
        title: `${day10 ? 'Day-10' : 'Day-3'} call: ${call.outletName}`,
        detail: `${call.dueOn === today ? 'Due today' : `Due ${shortDate(call.dueOn)}`}${day10 ? ' · ask for a rating' : ''}`,
        target: { kind: 'NEW_OUTLETS' },
      });
    }
    if (documents.items.length > 0) {
      const people = [...new Set(documents.items.map((item) => item.userId))];
      notes.push({
        key: 'TEAM_DOCUMENTS',
        title: `Team documents due: ${documents.items.length}`,
        detail: documents.items
          .slice(0, 2)
          .map((item) => `${item.name}: ${item.words}`)
          .join(' · ') + (documents.items.length > 2 ? ` · and ${documents.items.length - 2} more` : ''),
        target: people.length === 1 ? { kind: 'TEAM_PERSON', userId: people[0]! } : { kind: 'TEAM' },
      });
    }
    if (planVisits.length > 0) {
      const first = fromDbDate(planVisits[0]!.scheduledDate);
      const last = fromDbDate(planVisits[planVisits.length - 1]!.scheduledDate);
      notes.push({
        key: 'PLAN_VISITS',
        title: `Plan visits added today: ${planVisits.length}`,
        detail: `${first === last ? `For ${shortDate(first)}` : `For ${shortDate(first)} to ${shortDate(last)}`}; give each a Supervisor on the week board`,
        target: { kind: 'WEEK' },
      });
    }
    return notes;
  }

  /** The Evening close: its lines, how many are done, whether the day is closed, and who may close it. */
  private async close(user: AuthUser, scope: Scope, now: Date, visits: TodayVisitRow[]): Promise<TodayDto['close']> {
    const [facts, closed] = await Promise.all([this.closeFacts(user, scope, now, visits), this.closedOn(indiaDay(now))]);
    const lines = eveningClose(facts);
    const { done, total } = closeProgress(lines);
    return {
      shownFully: closeShownFully(now),
      lines,
      done,
      total,
      closed,
      canClose: scope === 'office' && can(user.memberships, 'jobs', 'create'),
    };
  }

  private async closeFacts(user: AuthUser, scope: Scope, now: Date, visits: TodayVisitRow[]): Promise<CloseFacts> {
    const office = scope === 'office';
    const today = indiaDay(now);
    const mineOnly = office ? {} : { supervisorId: user.id };
    const [inspections, returned, payments, tomorrow] = await Promise.all([
      this.db.inspection.findMany({
        where: { plannedDate: toDbDate(today), status: 'DRAFT', ...mineOnly },
        select: { id: true, outlet: { select: { name: true } } },
      }),
      // Reports ECCS sent back for correction and not yet handed in again, whatever their day.
      this.db.job.findMany({
        where: { status: 'IN_PROGRESS', signOff: { isNot: null }, ...mineOnly },
        select: { id: true, outlet: { select: { name: true } } },
      }),
      office && can(user.memberships, 'invoices', 'update')
        ? this.db.payment.aggregate({
            where: { status: 'SUCCEEDED', createdAt: { gte: indiaMoment(today), lt: indiaMoment(addDays(today, 1)) } },
            _count: { _all: true },
            _sum: { amountPaise: true },
          })
        : Promise.resolve(null),
      office
        ? this.db.job.findMany({
            where: { scheduledDate: toDbDate(addDays(today, 1)), status: { in: ['SCHEDULED', 'ASSIGNED'] } },
            select: { id: true, supervisorId: true, outlet: { select: { name: true } } },
          })
        : Promise.resolve(null),
    ]);

    return {
      visits: visits.map((visit) => {
        const kinds = new Set(visit.attachments.map((photo) => photo.kind));
        // Finished: the Supervisor pressed Finish (a report sent back after sign-off is still finished work).
        const finished = visit.status === 'COMPLETED' || visit.status === 'APPROVED' || (visit.status === 'IN_PROGRESS' && visit.signOff !== null);
        return {
          visitId: visit.id,
          outletName: visit.outlet.name,
          finished,
          hasBefore: kinds.has('BEFORE'),
          hasAfter: kinds.has('AFTER'),
          awaitingSignOff: visit.status === 'COMPLETED',
        };
      }),
      reportsOut: [
        ...inspections.map((inspection) => ({ outletName: inspection.outlet.name, what: 'INSPECTION' as const, target: { kind: 'INSPECTION' as const, inspectionId: inspection.id } })),
        ...returned.map((visit) => ({ outletName: visit.outlet.name, what: 'RETURNED' as const, target: { kind: 'VISIT' as const, visitId: visit.id } })),
      ],
      payments: payments && { count: payments._count._all, totalPaise: payments._sum.amountPaise ?? 0 },
      tomorrow: tomorrow && {
        total: tomorrow.length,
        withoutSupervisor: tomorrow.filter((visit) => visit.supervisorId === null).map((visit) => ({ visitId: visit.id, outletName: visit.outlet.name })),
      },
    };
  }

  /** The day's close, if it has been closed. */
  private async closedOn(date: string): Promise<DayClosedDto | null> {
    const row = await this.db.dayClose.findUnique({ where: { date: toDbDate(date) } });
    if (!row) return null;
    const closer = await this.db.user.findUnique({ where: { id: row.closedById }, select: { name: true } });
    return {
      date,
      closedAt: row.closedAt.toISOString(),
      closedByName: closer?.name ?? 'someone who has left',
      openLines: (row.openLines as { key: CloseLineKey; label: string; words: string }[]) ?? [],
    };
  }
}

interface OverdueAtOutlet {
  /** The oldest overdue invoice, which the button opens. */
  invoiceId: string;
  /** How many days the oldest is overdue. */
  days: number;
  /** All that is owed on overdue invoices there. */
  duePaise: number;
  invoices: number;
}
