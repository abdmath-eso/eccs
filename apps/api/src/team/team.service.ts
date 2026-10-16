import { BadRequestException, ConflictException, ForbiddenException, Injectable, NotFoundException } from '@nestjs/common';
import type { Prisma } from '@eccs/db';
import {
  addDays,
  arrivalsOnTime,
  can,
  concerns,
  dayAndMonth,
  ECCS_ROLES,
  firstName,
  followUpsOnTime,
  indiaDay,
  indiaMoment,
  initials,
  keepAnEyeOn,
  PERSON_ACTIVITY_KINDS,
  presenceDays,
  presenceLine,
  presenceSourceFor,
  salaryOn,
  SALES_OWNER_ROLES,
  staleness,
  summarisePresence,
  TEAM_ROLES,
  TEAM_RULES,
  teamRoleOf,
  teamWhatsappUrl,
  todaySentence,
  todayWords,
  weekStartOf,
  worstFirst,
  type BdeWeekDto,
  type ConcernDto,
  type FollowUpRecord,
  type FoundLeadDto,
  type FoundVisitDto,
  type LeaveValues,
  type LocalizedText,
  type OnTimeDto,
  type PresenceDayDto,
  type PresenceEvent,
  type PresenceSource,
  type Role,
  type TargetFigure,
  type TeamCardDto,
  type TeamChangeValues,
  type TeamListDto,
  type TeamMemberDto,
  type TeamMemberRole,
  type TeamMemberValues,
  type TeamRowDto,
  type VisitSlot,
} from '@eccs/shared';
import type { AuthUser } from '../auth/auth.types.js';
import { indiaDate } from '../checklists/checklists.service.js';
import { PrismaService } from '../prisma/prisma.service.js';
import { SalesOverviewService } from '../sales/sales-overview.service.js';
import { SalesService } from '../sales/sales.service.js';
import { TeamSalaryService } from './team-salary.service.js';

// ECCS's own team (the console's Team page, 16 Oct 2026): who is on it, who is in today and
// since when, each person's week against target, the one thing to keep an eye on, the last
// 14 days, leave, what the app found, and salaries (the Super Admin only).
//
// Nothing here is typed in about a day's work. Presence is read from what each person did:
// a BDE's lead steps (by the step's own time, which is the phone's for work done offline), a
// Supervisor's visit arrivals and inspections, the Ops Manager's changes in the console (the
// activity log). A BDE's figures are Sales' own (bdeWeek, the stale rule), so the Team page
// and the Sales page always agree. The rules are in packages/shared/src/team.ts.
//
// Who sees what: the Super Admin and the Ops Manager read the team and record leave (the
// "team" grant); only the Super Admin sees and sets salaries ("team" A), adds members,
// changes their details and marks them as left (the existing "eccsUsers" grant, which is
// the one way ECCS staff logins are made). The activity log keeps only the action and who
// did it (staffData on every route).

const toDb = (date: string) => new Date(`${date}T00:00:00.000Z`);
const fromDb = (date: Date) => date.toISOString().slice(0, 10);
const english = (text: unknown) => {
  const localized = (text ?? {}) as LocalizedText;
  return localized.en ?? Object.values(localized)[0] ?? '';
};
const OPEN_VISIT = ['SCHEDULED', 'ASSIGNED', 'IN_PROGRESS'] as const;
const DONE_VISIT = ['COMPLETED', 'APPROVED'] as const;
/** The order the list is in: the Ops Manager, the Supervisors, the BDEs, a founder last. */
const ROLE_ORDER: TeamMemberRole[] = ['OPS_MANAGER', 'SUPERVISOR', 'BDE', 'SUPER_ADMIN'];
const FIGURE_WORDS: Record<TargetFigure, string> = { leads: 'leads', checks: 'free checks', firstJobs: 'first jobs', plans: 'plans' };

/** What a lead step was, for "In since 9:40 am today, first lead logged from the field". */
function stepWhat(kind: string, source: string | null): string {
  switch (kind) {
    case 'CREATED':
      return source === 'FIELD_VISIT' ? 'first lead logged from the field' : 'first lead logged';
    case 'CALL':
      return 'first call logged';
    case 'VISIT':
      return 'first shop visit logged';
    case 'CHECK_BOOKED':
      return 'first free check booked';
    case 'CHECK_DONE':
      return 'first free check done';
    case 'QUOTE_SENT':
      return 'first quote sent';
    default:
      return 'first lead step logged';
  }
}

const personSelect = {
  id: true,
  name: true,
  phone: true,
  isActive: true,
  memberships: { select: { role: true } },
  teamMember: { include: { salaries: { orderBy: { from: 'asc' } }, leave: { orderBy: { from: 'asc' } } } },
} as const satisfies Prisma.UserSelect;
type PersonRow = Prisma.UserGetPayload<{ select: typeof personSelect }>;
type Person = PersonRow & { role: TeamMemberRole };

/** Everything worked out for one person. */
interface Worked {
  person: Person;
  row: TeamRowDto;
  source: PresenceSource;
  days: PresenceDayDto[];
  line: string;
  keep: { pick: ConcernDto | null; note: string };
  cards: TeamCardDto[];
  foundLeads: { items: FoundLeadDto[]; total: number } | null;
  foundVisits: { items: FoundVisitDto[]; total: number } | null;
  upcomingVisits: number;
}

@Injectable()
export class TeamService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly sales: SalesService,
    private readonly figures: SalesOverviewService,
    private readonly salaries: TeamSalaryService,
  ) {}

  private get db() {
    return this.prisma.client;
  }

  // ───────────────────────── Who is on the team ─────────────────────────

  /** Everyone with a team record, and every active ECCS login with a team role (shown with "Add details" until given them). */
  private async people(where: Prisma.UserWhereInput = {}): Promise<Person[]> {
    const rows = await this.db.user.findMany({
      where: { AND: [where, { OR: [{ teamMember: { isNot: null } }, { isActive: true, memberships: { some: { role: { in: [...TEAM_ROLES] } } } }] }] },
      select: personSelect,
      orderBy: { name: 'asc' },
    });
    return rows
      .map((row) => ({ ...row, role: teamRoleOf(row.memberships.map((m) => m.role as Role)) }))
      .filter((row): row is Person => row.role !== null)
      .sort((a, b) => Number(Boolean(a.teamMember?.leftOn)) - Number(Boolean(b.teamMember?.leftOn)) || ROLE_ORDER.indexOf(a.role) - ROLE_ORDER.indexOf(b.role) || a.name.localeCompare(b.name));
  }

  private async onTimeTarget(): Promise<number> {
    const row = await this.db.teamSettings.findUnique({ where: { id: 'default' } });
    return row?.onTimeTargetPercent ?? TEAM_RULES.defaultOnTimeTargetPercent;
  }

  // ───────────────────────── Reading ─────────────────────────

  async list(user: AuthUser): Promise<TeamListDto> {
    const now = new Date();
    const [people, target] = await Promise.all([this.people(), this.onTimeTarget()]);
    const worked = await this.work(people, now, target, can(user.memberships, 'team', 'approve'));
    return {
      today: indiaDate(now),
      members: worked.map((entry) => entry.row),
      flagged: worked.filter((entry) => entry.row.flag && !entry.row.leftOn).length,
      onTimeTargetPercent: target,
      sample: people.some((person) => person.teamMember?.isSample),
    };
  }

  async member(user: AuthUser, userId: string): Promise<TeamMemberDto> {
    const now = new Date();
    const [people, target] = await Promise.all([this.people({ id: userId }), this.onTimeTarget()]);
    const person = people[0];
    if (!person) throw new NotFoundException('That person is not on the team');
    const seesPay = can(user.memberships, 'team', 'approve');
    const manages = can(user.memberships, 'eccsUsers', 'update');
    const [worked] = await this.work([person], now, target, seesPay);
    const [openLeads, owners] = await Promise.all([
      this.db.lead.count({ where: { ownerId: userId, status: { not: 'LOST' } } }),
      manages ? this.sales.people() : Promise.resolve([]),
    ]);
    const member = person.teamMember;
    const today = indiaDate(now);
    return {
      ...worked!.row,
      phone: person.phone,
      presenceSource: worked!.source,
      keep: worked!.keep,
      cards: worked!.cards,
      days: worked!.days,
      presenceLine: worked!.line,
      leave: (member?.leave ?? [])
        .filter((span) => fromDb(span.to) >= addDays(today, -30))
        .map((span) => ({ id: span.id, from: fromDb(span.from), to: fromDb(span.to), reason: span.reason, isSample: span.isSample })),
      foundLeads: worked!.foundLeads,
      foundVisits: worked!.foundVisits,
      whatsappUrl: teamWhatsappUrl(person.phone, Boolean(member?.isSample)),
      openLeads,
      upcomingVisits: worked!.upcomingVisits,
      handTo: owners.filter((owner) => owner.id !== userId).map((owner) => ({ id: owner.id, name: owner.name, isBde: owner.isBde })),
      salary: seesPay && member ? { monthlyPaise: worked!.row.monthlyPaise, history: member.salaries.map((step) => ({ from: fromDb(step.from), monthlyPaise: step.monthlyPaise })) } : null,
      canRecordLeave: can(user.memberships, 'team', 'create') && Boolean(member) && !member?.leftOn,
      canManage: manages,
    };
  }

  /**
   * Works out every figure on the list and the pages for these people at once: their
   * presence over the last 14 days, this week and last week, the one thing to keep an eye on,
   * and what the app found.
   */
  private async work(people: readonly Person[], now: Date, onTimeTarget: number, seesPay: boolean): Promise<Worked[]> {
    const today = indiaDate(now);
    const windowFrom = addDays(today, -(TEAM_RULES.windowDays - 1));
    const weekStart = weekStartOf(today);
    const lastWeekStart = addDays(weekStart, -7);
    const lastWeekEnd = addDays(weekStart, -1);
    const from = windowFrom < lastWeekStart ? windowFrom : lastWeekStart;
    const since = indiaMoment(from);
    const ids = (role: TeamMemberRole[]) => people.filter((person) => role.includes(person.role)).map((person) => person.id);
    const bdeIds = ids(['BDE']);
    const supervisorIds = ids(['SUPERVISOR']);
    const logIds = ids(['OPS_MANAGER', 'SUPER_ADMIN']);

    const [steps, loaded, followUps, jobs, openJobs, inspections, logRows, firstLog] = await Promise.all([
      bdeIds.length === 0
        ? Promise.resolve([])
        : this.db.leadActivity.findMany({
            where: { byId: { in: bdeIds }, kind: { in: [...PERSON_ACTIVITY_KINDS] }, at: { gte: since } },
            select: { byId: true, kind: true, at: true, lead: { select: { source: true } } },
          }),
      bdeIds.length === 0 ? Promise.resolve(null) : this.sales.loaded({ ownerId: { in: bdeIds } }),
      bdeIds.length === 0 ? Promise.resolve([]) : this.db.leadFollowUp.findMany({ where: { ownerId: { in: bdeIds }, dueAt: { gte: indiaMoment(lastWeekStart), lte: now } } }),
      supervisorIds.length === 0
        ? Promise.resolve([])
        : this.db.job.findMany({
            where: {
              supervisorId: { in: supervisorIds },
              status: { not: 'CANCELLED' },
              OR: [{ checkInAt: { gte: since } }, { completedAt: { gte: since } }, { scheduledDate: { gte: toDb(lastWeekStart), lte: toDb(today) } }],
            },
            select: { supervisorId: true, status: true, scheduledDate: true, scheduledSlot: true, checkInAt: true, completedAt: true, outlet: { select: { name: true } } },
          }),
      supervisorIds.length === 0
        ? Promise.resolve([])
        : this.db.job.findMany({
            where: { supervisorId: { in: supervisorIds }, status: { in: [...OPEN_VISIT] } },
            select: { id: true, supervisorId: true, scheduledDate: true, outlet: { select: { name: true } }, serviceType: { select: { name: true } } },
            orderBy: { scheduledDate: 'asc' },
          }),
      supervisorIds.length === 0
        ? Promise.resolve([])
        : this.db.inspection.findMany({
            where: { supervisorId: { in: supervisorIds }, OR: [{ startedAt: { gte: since } }, { completedAt: { gte: since } }, { plannedDate: { gte: toDb(lastWeekStart), lte: toDb(today) } }] },
            select: { supervisorId: true, startedAt: true, completedAt: true, plannedDate: true, outlet: { select: { name: true } } },
          }),
      logIds.length === 0
        ? Promise.resolve([])
        : this.db.activityLog.findMany({ where: { actorUserId: { in: logIds }, result: 'SUCCESS', at: { gte: since } }, select: { actorUserId: true, at: true, phoneAt: true, source: true } }),
      // When the log began: its first row of anything but AI, whose earlier requests were copied in when it started.
      logIds.length === 0 ? Promise.resolve(null) : this.db.activityLog.findFirst({ where: { category: { not: 'ai' } }, orderBy: { at: 'asc' }, select: { at: true } }),
    ]);

    // The steps on the leads whose next steps fell due, which say whether each was on time.
    const followUpLeads = [...new Set(followUps.map((entry) => entry.leadId))];
    const earliestSet = followUps.reduce((earliest, entry) => (entry.setAt < earliest ? entry.setAt : earliest), now);
    const leadSteps =
      followUpLeads.length === 0
        ? []
        : await this.db.leadActivity.findMany({
            where: { leadId: { in: followUpLeads }, byId: { not: null }, kind: { in: [...PERSON_ACTIVITY_KINDS] }, at: { gte: earliestSet } },
            select: { leadId: true, at: true },
          });
    const stepRecords = leadSteps.map((entry) => ({ leadId: entry.leadId, at: entry.at.toISOString() }));
    const weeks: Map<string, BdeWeekDto> = loaded
      ? await this.figures.weeks(
          people.filter((person) => person.role === 'BDE').map((person) => ({ id: person.id, name: person.name })),
          loaded.rows,
        )
      : new Map();
    const logsFrom = firstLog ? indiaDay(firstLog.at) : today;

    return people.map((person): Worked => {
      const member = person.teamMember;
      const source = presenceSourceFor(person.role);
      const joinedOn = member ? fromDb(member.joinedOn) : null;
      const leftOn = member?.leftOn ? fromDb(member.leftOn) : null;
      const leave = (member?.leave ?? []).map((span) => ({ from: fromDb(span.from), to: fromDb(span.to), reason: span.reason }));
      const weeklyOff = member?.weeklyOff ?? 0;

      // ── Presence, from what they did ──
      let events: PresenceEvent[] = [];
      if (source === 'LEAD_STEPS') {
        events = steps.filter((entry) => entry.byId === person.id).map((entry) => ({ at: entry.at.toISOString(), what: stepWhat(entry.kind, entry.lead.source) }));
      } else if (source === 'FIELD_WORK') {
        events = [
          ...jobs.filter((job) => job.supervisorId === person.id && job.checkInAt).map((job) => ({ at: job.checkInAt!.toISOString(), what: `arrived at ${job.outlet.name}` })),
          ...inspections.filter((entry) => entry.supervisorId === person.id && entry.startedAt).map((entry) => ({ at: entry.startedAt!.toISOString(), what: `started an inspection at ${entry.outlet.name}` })),
        ];
      } else {
        events = logRows
          .filter((entry) => entry.actorUserId === person.id)
          .map((entry) => ({ at: (entry.phoneAt ?? entry.at).toISOString(), what: entry.source === 'CONSOLE' ? 'first change in the console' : 'first change in the app' }));
      }
      const days = presenceDays({ today, events, weeklyOff, leave, joinedOn, leftOn, recordsFrom: source === 'ACTIVITY_LOG' ? logsFrom : null });
      const summary = summarisePresence(days);
      const lastIn = [...days].reverse().find((day) => day.state === 'IN' && day.date < today) ?? null;
      const sentence = todaySentence(summary.today, { name: person.name, lastIn, leftOn });
      const line = presenceLine(summary, { name: person.name, weeklyOff, source });

      // ── The week, the cards and what the app found ──
      let cards: TeamCardDto[] = [];
      let week: TeamRowDto['week'] = null;
      let foundLeads: Worked['foundLeads'] = null;
      let foundVisits: Worked['foundVisits'] = null;
      let upcomingVisits = 0;
      const input: Parameters<typeof concerns>[0] = { missedDays: summary.missed, onTimeTargetPercent: onTimeTarget };

      if (person.role === 'BDE' && loaded) {
        const bde = weeks.get(person.id);
        const mine = followUps.filter((entry) => entry.ownerId === person.id).map(
          (entry): FollowUpRecord => ({ leadId: entry.leadId, setAt: entry.setAt.toISOString(), dueAt: entry.dueAt.toISOString(), endedAt: entry.endedAt?.toISOString() ?? null }),
        );
        const thisWeek = followUpsOnTime(mine, stepRecords, weekStart, today, now);
        const lastWeek = followUpsOnTime(mine, stepRecords, lastWeekStart, lastWeekEnd, now);
        const stale = loaded.rows
          .filter((row) => row.ownerId === person.id)
          .map((row) => ({ leadId: row.id, businessName: row.businessName, stale: staleness(loaded.facts.get(row.id)!, now) }))
          .filter((entry): entry is FoundLeadDto => entry.stale !== null);
        const sorted = worstFirst(stale);
        foundLeads = { items: sorted.slice(0, TEAM_RULES.foundShown), total: sorted.length };
        input.staleLeads = sorted.length > 0 ? { count: sorted.length, longestDays: Math.max(...sorted.map((entry) => entry.stale.days)) } : null;
        input.followUps = thisWeek;
        if (bde) {
          // Only the figures on the page's cards (leads and free checks); first jobs and plans are the Sales page's.
          input.behind = bde.missed
            .filter((figure) => figure === 'leads' || figure === 'checks')
            .map((figure) => ({ label: FIGURE_WORDS[figure], done: bde.actual[figure], target: bde.targets[figure] }));
          week = { label: 'leads', done: bde.actual.leads, target: bde.targets.leads };
          cards = [
            { key: 'leads', label: 'Leads logged this week', value: String(bde.actual.leads), target: `target ${bde.targets.leads}`, lastWeek: `last week ${bde.lastWeek.leads}`, behind: bde.missed.includes('leads') },
            { key: 'checks', label: 'Free checks done', value: String(bde.actual.checks), target: `target ${bde.targets.checks}`, lastWeek: `last week ${bde.lastWeek.checks}`, behind: bde.missed.includes('checks') },
            onTimeCard('followUps', 'Follow-ups on time', thisWeek, lastWeek, onTimeTarget),
          ];
        }
      } else if (person.role === 'SUPERVISOR') {
        const mine = jobs.filter((job) => job.supervisorId === person.id);
        const done = (start: string, end: string) =>
          mine.filter((job) => (DONE_VISIT as readonly string[]).includes(job.status) && job.completedAt && indiaDay(job.completedAt) >= start && indiaDay(job.completedAt) <= end).length;
        const planned = mine.filter((job) => fromDb(job.scheduledDate) >= weekStart && fromDb(job.scheduledDate) <= today).length;
        const inspected = (start: string, end: string) =>
          inspections.filter((entry) => entry.supervisorId === person.id && entry.completedAt && indiaDay(entry.completedAt) >= start && indiaDay(entry.completedAt) <= end).length;
        const inspectionsPlanned = inspections.filter((entry) => entry.supervisorId === person.id && entry.plannedDate && fromDb(entry.plannedDate) >= weekStart && fromDb(entry.plannedDate) <= today).length;
        const arrivals = mine
          .filter((job) => job.checkInAt)
          .map((job) => ({ scheduledDate: fromDb(job.scheduledDate), slot: (job.scheduledSlot as VisitSlot | null) ?? null, checkInAt: job.checkInAt!.toISOString() }));
        const thisWeek = arrivalsOnTime(arrivals, weekStart, today);
        const lastWeek = arrivalsOnTime(arrivals, lastWeekStart, lastWeekEnd);
        const open = openJobs.filter((job) => job.supervisorId === person.id);
        const overdue = open.filter((job) => fromDb(job.scheduledDate) < today);
        upcomingVisits = open.length - overdue.length;
        foundVisits = {
          items: overdue.slice(0, TEAM_RULES.foundShown).map((job) => ({
            visitId: job.id,
            outletName: job.outlet.name,
            serviceName: english(job.serviceType.name),
            scheduledDate: fromDb(job.scheduledDate),
            daysLate: Math.round((toDb(today).getTime() - job.scheduledDate.getTime()) / 86_400_000),
          })),
          total: overdue.length,
        };
        input.visitsOverdue = overdue.length;
        input.arrivals = thisWeek;
        const doneNow = done(weekStart, today);
        week = { label: 'visits', done: doneNow, target: planned };
        cards = [
          { key: 'visits', label: 'Visits done this week', value: String(doneNow), target: `${planned} planned`, lastWeek: `last week ${done(lastWeekStart, lastWeekEnd)}`, behind: false },
          { key: 'inspections', label: 'Inspections done', value: String(inspected(weekStart, today)), target: `${inspectionsPlanned} planned`, lastWeek: `last week ${inspected(lastWeekStart, lastWeekEnd)}`, behind: false },
          onTimeCard('arrivals', 'Arrivals on time', thisWeek, lastWeek, onTimeTarget),
        ];
      }

      const found = leftOn ? [] : concerns(input);
      const keep = keepAnEyeOn(found, sentence);
      const salarySteps = member?.salaries.map((step) => ({ from: fromDb(step.from), monthlyPaise: step.monthlyPaise })) ?? [];
      return {
        person,
        source,
        days,
        line,
        keep,
        cards,
        foundLeads,
        foundVisits,
        upcomingVisits,
        row: {
          userId: person.id,
          memberId: member?.id ?? null,
          name: person.name,
          initials: initials(person.name),
          role: person.role,
          area: member?.area ?? null,
          joinedOn,
          leftOn,
          weeklyOff,
          isSample: Boolean(member?.isSample),
          today: { state: summary.today.state, words: leftOn ? `Left ${dayAndMonth(leftOn)}` : todayWords(summary.today), firstAt: summary.today.firstAt },
          week,
          flag: keep.pick,
          monthlyPaise: seesPay ? salaryOn(salarySteps, leftOn && leftOn < today ? leftOn : today) : null,
        },
      };
    });
  }

  // ───────────────────────── Adding and changing ─────────────────────────

  /**
   * Adds a team member: their ECCS login (the number they log in with, with a one-time code,
   * as ECCS staff do), their role, area, joining day, weekly day off and salary. A number that
   * is already an ECCS login without team details gets them; a restaurant's login is refused.
   */
  async add(user: AuthUser, input: TeamMemberValues): Promise<TeamMemberDto> {
    const existing = await this.db.user.findUnique({ where: { phone: input.phone }, include: { memberships: { select: { role: true } }, teamMember: { select: { leftOn: true } } } });
    let userId: string;
    if (existing) {
      const roles = existing.memberships.map((m) => m.role as Role);
      if (existing.teamMember) {
        throw new ConflictException(existing.teamMember.leftOn ? `${existing.name} left on ${dayAndMonth(fromDb(existing.teamMember.leftOn))}.` : `${existing.name} is already on the team.`);
      }
      if (roles.some((role) => !(ECCS_ROLES as readonly Role[]).includes(role))) throw new ConflictException('That number is a restaurant login. Use another number.');
      if (!existing.isActive) throw new ConflictException('That login is switched off. Use another number.');
      userId = existing.id;
      await this.checkRoleChange(userId, roles, input.role);
      await this.db.$transaction(async (tx) => {
        await tx.user.update({ where: { id: userId }, data: { name: input.name } });
        // A founder keeps the Super Admin's role; anyone else takes the role chosen.
        if (!roles.includes('SUPER_ADMIN')) await this.setRole(tx, userId, input.role);
        await this.createMember(tx, user, userId, input);
      });
    } else {
      userId = await this.db.$transaction(async (tx) => {
        const created = await tx.user.create({ data: { phone: input.phone, name: input.name, language: 'EN', memberships: { create: [{ role: input.role }] } } });
        await this.createMember(tx, user, created.id, input);
        return created.id;
      });
    }
    await this.salaries.sync();
    return this.member(user, userId);
  }

  private async createMember(tx: Prisma.TransactionClient, user: AuthUser, userId: string, input: TeamMemberValues) {
    const member = await tx.teamMember.create({ data: { userId, area: input.area, joinedOn: toDb(input.joinedOn), weeklyOff: input.weeklyOff, createdById: user.id } });
    if (input.monthlySalaryPaise && input.monthlySalaryPaise > 0 && can(user.memberships, 'team', 'approve')) {
      await tx.teamSalary.create({ data: { memberId: member.id, from: toDb(input.joinedOn), monthlyPaise: input.monthlySalaryPaise, setById: user.id } });
    }
  }

  /** The ECCS team role a login holds, replaced by another. A founder's own role is never changed here. */
  private async setRole(tx: Prisma.TransactionClient, userId: string, role: TeamMemberRole) {
    await tx.membership.deleteMany({ where: { userId, role: { in: [...TEAM_ROLES] } } });
    await tx.membership.create({ data: { userId, role } });
  }

  /** A person who stops being able to own leads must hand theirs over first: leads are never left with nobody. */
  private async checkRoleChange(userId: string, roles: readonly Role[], next: TeamMemberRole) {
    const sells = (list: readonly Role[]) => list.some((role) => (SALES_OWNER_ROLES as readonly Role[]).includes(role));
    const after = [...roles.filter((role) => !(TEAM_ROLES as readonly Role[]).includes(role)), next];
    if (!sells(roles) || sells(after)) return;
    const open = await this.db.lead.count({ where: { ownerId: userId, status: { not: 'LOST' } } });
    if (open > 0) {
      throw new ConflictException({
        message: `They own ${open} open ${open === 1 ? 'lead' : 'leads'}. Hand them to another BDE first (the Owner of each lead, or Mark as left).`,
        code: 'OPEN_LEADS',
        count: open,
      });
    }
  }

  /** Changes a team member's details (the Super Admin). Only what is sent changes. A login without team details is given them. */
  async change(user: AuthUser, userId: string, input: TeamChangeValues): Promise<TeamMemberDto> {
    const person = await this.db.user.findUnique({ where: { id: userId }, include: { memberships: { select: { role: true } }, teamMember: true } });
    const roles = person?.memberships.map((m) => m.role as Role) ?? [];
    if (!person || !teamRoleOf(roles)) throw new NotFoundException('That person is not on the team');
    const member = person.teamMember;
    if (!member && !input.joinedOn) throw new BadRequestException('Enter the day they joined');
    if (input.phone && input.phone !== person.phone) {
      const taken = await this.db.user.findUnique({ where: { phone: input.phone }, select: { id: true } });
      if (taken) throw new ConflictException("That number is already someone else's login");
    }
    const founder = roles.includes('SUPER_ADMIN');
    if (input.role && founder && !roles.includes(input.role)) throw new BadRequestException("A founder's role is not changed here");
    if (input.role && !founder) await this.checkRoleChange(userId, roles, input.role);
    const joinedOn = input.joinedOn ?? (member ? fromDb(member.joinedOn) : null)!;
    if (member?.leftOn && fromDb(member.leftOn) < joinedOn) throw new BadRequestException('They cannot have joined after the day they left');
    if (input.salary && !can(user.memberships, 'team', 'approve')) throw new ForbiddenException('Only the Super Admin sets salaries');

    await this.db.$transaction(async (tx) => {
      const userData: Prisma.UserUpdateInput = {};
      if (input.name) userData.name = input.name;
      if (input.phone) userData.phone = input.phone;
      if (Object.keys(userData).length > 0) await tx.user.update({ where: { id: userId }, data: userData });
      if (input.role && !founder && !roles.includes(input.role)) await this.setRole(tx, userId, input.role);
      const data = {
        ...(input.area !== undefined && { area: input.area || null }),
        ...(input.joinedOn && { joinedOn: toDb(input.joinedOn) }),
        ...(input.weeklyOff !== undefined && { weeklyOff: input.weeklyOff }),
      };
      const saved = member
        ? await tx.teamMember.update({ where: { id: member.id }, data })
        : await tx.teamMember.create({ data: { userId, joinedOn: toDb(joinedOn), area: input.area || null, weeklyOff: input.weeklyOff ?? 0, createdById: user.id } });
      if (input.salary) {
        // A salary from before the joining day is the salary from the joining day.
        const from = input.salary.from < joinedOn ? joinedOn : input.salary.from;
        await tx.teamSalary.upsert({
          where: { memberId_from: { memberId: saved.id, from: toDb(from) } },
          create: { memberId: saved.id, from: toDb(from), monthlyPaise: input.salary.monthlyPaise, setById: user.id },
          update: { monthlyPaise: input.salary.monthlyPaise, setById: user.id },
        });
      }
    });
    await this.salaries.sync();
    return this.member(user, userId);
  }

  /**
   * Marks a team member as left on their last day: they can no longer log in (every session
   * ends), their records stay, their salary is counted to that day, and the leads they own
   * that are not lost are handed to `handTo` first, with B1's owner change (never left with
   * nobody).
   */
  async markLeft(user: AuthUser, userId: string, input: { leftOn: string; handTo?: string | null | undefined }): Promise<TeamMemberDto> {
    const today = indiaDate();
    const person = await this.db.user.findUnique({ where: { id: userId }, include: { memberships: { select: { role: true } }, teamMember: true } });
    if (!person || !person.teamMember) throw new NotFoundException('Add their team details first');
    if (userId === user.id) throw new ForbiddenException('You cannot mark yourself as left');
    if (person.memberships.some((m) => m.role === 'SUPER_ADMIN')) throw new ForbiddenException('A founder is not marked as left here');
    if (person.teamMember.leftOn) throw new ConflictException(`${person.name} already left on ${dayAndMonth(fromDb(person.teamMember.leftOn))}`);
    if (input.leftOn > today) throw new BadRequestException('Mark them as left on their last day, not before');
    if (input.leftOn < fromDb(person.teamMember.joinedOn)) throw new BadRequestException('The last day comes before the day they joined');
    const open = await this.db.lead.count({ where: { ownerId: userId, status: { not: 'LOST' } } });
    if (open > 0) {
      if (!input.handTo) {
        throw new ConflictException({ message: `${firstName(person.name)} owns ${open} open ${open === 1 ? 'lead' : 'leads'}. Choose who takes them over.`, code: 'OPEN_LEADS', count: open });
      }
      await this.sales.handOver(user, userId, input.handTo);
    }
    await this.db.$transaction([
      this.db.teamMember.update({ where: { id: person.teamMember.id }, data: { leftOn: toDb(input.leftOn) } }),
      this.db.user.update({ where: { id: userId }, data: { isActive: false } }),
      this.db.session.updateMany({ where: { userId, revokedAt: null }, data: { revokedAt: new Date() } }),
      this.db.deviceToken.deleteMany({ where: { userId } }),
    ]);
    await this.salaries.sync();
    return this.member(user, userId);
  }

  // ───────────────────────── Leave ─────────────────────────

  /** A day or a few days of leave (the Super Admin or the Ops Manager). Leave overlapping leave already recorded is refused. */
  async addLeave(user: AuthUser, userId: string, input: LeaveValues): Promise<TeamMemberDto> {
    const member = await this.db.teamMember.findUnique({ where: { userId }, select: { id: true, joinedOn: true, leftOn: true } });
    if (!member) throw new NotFoundException('Add their team details first');
    if (member.leftOn && input.from > fromDb(member.leftOn)) throw new BadRequestException('They have left by then');
    if (input.to < fromDb(member.joinedOn)) throw new BadRequestException('That is before they joined');
    const overlap = await this.db.teamLeave.count({ where: { memberId: member.id, from: { lte: toDb(input.to) }, to: { gte: toDb(input.from) } } });
    if (overlap > 0) throw new ConflictException('Leave is already recorded on one of those days');
    await this.db.teamLeave.create({ data: { memberId: member.id, from: toDb(input.from), to: toDb(input.to), reason: input.reason, createdById: user.id } });
    return this.member(user, userId);
  }

  async removeLeave(leaveId: string): Promise<void> {
    const { count } = await this.db.teamLeave.deleteMany({ where: { id: leaveId } });
    if (count === 0) throw new NotFoundException('That leave is no longer recorded');
  }

  async saveSettings(input: { onTimeTargetPercent: number }): Promise<{ onTimeTargetPercent: number }> {
    await this.db.teamSettings.upsert({ where: { id: 'default' }, create: { id: 'default', ...input }, update: input });
    return { onTimeTargetPercent: await this.onTimeTarget() };
  }
}

/** The on-time card: this week's share against the target, and last week's. */
function onTimeCard(key: string, label: string, thisWeek: OnTimeDto, lastWeek: OnTimeDto, target: number): TeamCardDto {
  return {
    key,
    label,
    value: thisWeek.percent === null ? '—' : `${thisWeek.percent}%`,
    target: `target ${target}%`,
    lastWeek: lastWeek.percent === null ? 'last week none due' : `last week ${lastWeek.percent}%`,
    behind: thisWeek.percent !== null && thisWeek.due >= TEAM_RULES.onTimeJudgedFrom && thisWeek.percent < target,
  };
}
