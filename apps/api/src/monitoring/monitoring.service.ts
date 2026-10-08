import { ForbiddenException, Injectable } from '@nestjs/common';
import {
  accessScope,
  checklistLevel,
  INSPECTION_GRADES,
  inspectionLevel,
  isEccsRole,
  issueLevel,
  licenceLevel,
  MONITORING_AREAS,
  MONITORING_DEFAULT_DAYS,
  MONITORING_MAX_DAYS,
  MONITORING_RULES,
  overallLevel,
  scoreLevel,
  visitLevel,
  type InspectionGrade,
  type LocalizedText,
  type MonitoringArea,
  type MonitoringBoardDto,
  type MonitoringChecklistsDto,
  type MonitoringInspectionItemDto,
  type MonitoringInspectionProblem,
  type MonitoringInspectionsDto,
  type MonitoringIssuesDto,
  type MonitoringLevel,
  type MonitoringLicencesDto,
  type MonitoringOutletDto,
  type MonitoringScoreDto,
  type MonitoringTotalsDto,
  type MonitoringVisitItemDto,
  type MonitoringVisitProblem,
  type MonitoringVisitsDto,
} from '@eccs/shared';
import type { AuthUser } from '../auth/auth.types.js';
import { indiaDate, indiaTime } from '../checklists/checklists.service.js';
import { PrismaService } from '../prisma/prisma.service.js';

const DAY_MS = 86_400_000;
const toDbDate = (date: string) => new Date(`${date}T00:00:00.000Z`);
const fromDbDate = (date: Date) => date.toISOString().slice(0, 10);
/** A YYYY-MM-DD date moved by a number of days. */
const shiftDate = (date: string, days: number) => fromDbDate(new Date(toDbDate(date).getTime() + days * DAY_MS));
/** Whole calendar days from one YYYY-MM-DD date to another. */
const daysBetween = (from: string, to: string) => Math.round((toDbDate(to).getTime() - toDbDate(from).getTime()) / DAY_MS);
const issueReference = (value: number) => `ECCS-${String(value).padStart(4, '0')}`;

/** How far back hygiene scores are read: enough for the latest one and the one from a week before it. */
const SCORE_LOOKBACK_DAYS = 45;

/** Puts rows into a list per outlet, so each area is one query for all outlets rather than one per outlet. */
function byOutlet<T extends { outletId: string }>(rows: readonly T[]): Map<string, T[]> {
  const map = new Map<string, T[]>();
  for (const row of rows) {
    const list = map.get(row.outletId);
    if (list) list.push(row);
    else map.set(row.outletId, [row]);
  }
  return map;
}

const LEVEL_ORDER: Record<MonitoringLevel, number> = { ATTENTION: 0, WATCH: 1, OK: 2, NONE: 3 };

/**
 * The ECCS monitoring board: every outlet the person may see, with the facts
 * for each area (checklists, issues, licences, visits, inspections, hygiene
 * score) and a judgement of each. It only reads; the rules and thresholds are
 * in packages/shared/src/monitoring.ts.
 *
 * Each area is fetched with one query covering all the outlets, and the rows
 * are sorted into outlets here, so the cost does not grow with the number of
 * outlets or days.
 */
@Injectable()
export class MonitoringService {
  constructor(private readonly prisma: PrismaService) {}

  private get db() {
    return this.prisma.client;
  }

  async board(user: AuthUser, askedDays?: number): Promise<MonitoringBoardDto> {
    // The board is ECCS's view across clients. Restaurants have their own home screen.
    if (!user.memberships.some((m) => isEccsRole(m.role))) {
      throw new ForbiddenException('The monitoring board is for ECCS staff');
    }
    // Super Admins and Operations Managers see every outlet and everything at it. A
    // Supervisor sees the outlets they work at, and of the visits and inspections
    // there only their own, the same as on the Visits and Inspections pages.
    const everything = accessScope(user.memberships, 'clients')?.kind === 'all';
    const mine = everything ? {} : { supervisorId: user.id };

    const days = Math.min(Math.max(Math.trunc(askedDays ?? MONITORING_DEFAULT_DAYS) || MONITORING_DEFAULT_DAYS, 1), MONITORING_MAX_DAYS);
    const now = new Date();
    const today = indiaDate(now);
    const timeNow = indiaTime(now);
    const from = shiftDate(today, -(days - 1));

    const outlets = await this.db.outlet.findMany({
      where: {
        isActive: true,
        ...(everything ? {} : { OR: [{ jobs: { some: mine } }, { inspections: { some: mine } }] }),
      },
      select: {
        id: true,
        name: true,
        organization: { select: { id: true, name: true } },
        subscriptions: {
          where: { status: 'ACTIVE' },
          orderBy: { startDate: 'desc' },
          take: 1,
          select: { plan: { select: { code: true, name: true } } },
        },
      },
      orderBy: [{ organization: { name: 'asc' } }, { name: 'asc' }],
    });
    const ids = outlets.map((outlet) => outlet.id);
    const inOutlets = { outletId: { in: ids } };
    const period = { gte: toDbDate(from), lte: toDbDate(today) };

    const [lists, runs, runsWithProblems, issues, licences, jobs, ratings, inspections, scores] = await Promise.all([
      // The daily checklists each outlet is meant to fill in.
      this.db.outletChecklist.findMany({
        where: { ...inOutlets, isActive: true, template: { kind: 'DAILY', isActive: true } },
        select: {
          id: true,
          outletId: true,
          dueTime: true,
          createdAt: true,
          template: { select: { items: { where: { isActive: true }, select: { outletId: true } } } },
        },
      }),
      this.db.checklistRun.findMany({
        where: { ...inOutlets, date: period, status: 'SUBMITTED' },
        select: { id: true, outletChecklistId: true, date: true, submittedAt: true },
      }),
      // Which of those had an item reported as a problem. Only the fact is read, never what the problem was:
      // checklist problems are the restaurant's own business.
      this.db.checklistResponse.groupBy({
        by: ['runId'],
        where: { passed: false, run: { ...inOutlets, date: period, status: 'SUBMITTED' } },
      }),
      this.db.issue.findMany({
        where: { ...inOutlets, status: { in: ['OPEN', 'IN_PROGRESS'] } },
        select: { id: true, reference: true, outletId: true, status: true, category: true, createdAt: true },
        orderBy: { createdAt: 'asc' },
      }),
      this.db.licence.findMany({
        where: inOutlets,
        select: { id: true, outletId: true, type: true, name: true, expiresOn: true },
        orderBy: { expiresOn: 'asc' },
      }),
      // Every visit not yet finished with: still to do, under way, waiting for sign-off, or waiting for ECCS's approval.
      this.db.job.findMany({
        where: {
          ...inOutlets,
          ...mine,
          OR: [{ status: { in: ['SCHEDULED', 'ASSIGNED', 'IN_PROGRESS', 'COMPLETED'] } }, { status: 'APPROVED', reviewedAt: null }],
        },
        select: {
          id: true,
          outletId: true,
          status: true,
          scheduledDate: true,
          supervisorId: true,
          completedAt: true,
          approvedAt: true,
          serviceType: { select: { name: true } },
          signOff: { select: { id: true } },
        },
        orderBy: { scheduledDate: 'asc' },
      }),
      // The stars restaurants gave when signing off during the period.
      this.db.signOff.findMany({
        where: { rating: { not: null }, signedAt: { gte: new Date(`${from}T00:00:00.000+05:30`) }, job: { ...inOutlets, ...mine } },
        select: { rating: true, job: { select: { id: true, outletId: true, scheduledDate: true, serviceType: { select: { name: true } } } } },
      }),
      this.db.inspection.findMany({
        where: { ...inOutlets, ...mine },
        select: {
          id: true,
          outletId: true,
          status: true,
          plannedDate: true,
          conductedAt: true,
          completedAt: true,
          overallScore: true,
          grade: true,
          reportNumber: true,
        },
        orderBy: [{ conductedAt: 'desc' }, { createdAt: 'desc' }],
      }),
      // Written once a day per outlet by the hygiene score feature; read here straight from its table.
      this.db.hygieneScoreSnapshot.findMany({
        where: { ...inOutlets, date: { gte: toDbDate(shiftDate(today, -SCORE_LOOKBACK_DAYS)), lte: toDbDate(today) } },
        select: { outletId: true, date: true, score: true },
        orderBy: { date: 'desc' },
      }),
    ]);

    // The latest approved inspection of each outlet, and its corrective actions not yet put right.
    const latestApproved = new Map<string, (typeof inspections)[number]>();
    for (const inspection of inspections) {
      if (inspection.status === 'APPROVED' && !latestApproved.has(inspection.outletId)) latestApproved.set(inspection.outletId, inspection);
    }
    const findings = await this.db.inspectionFinding.findMany({
      where: { inspectionId: { in: [...latestApproved.values()].map((inspection) => inspection.id) }, resolvedAt: null },
      select: { inspectionId: true, dueDate: true },
    });

    const listsBy = byOutlet(lists);
    const submittedRuns = new Map(runs.map((run) => [`${run.outletChecklistId} ${fromDbDate(run.date)}`, run]));
    const problemRuns = new Set(runsWithProblems.map((row) => row.runId));
    const issuesBy = byOutlet(issues);
    const licencesBy = byOutlet(licences);
    const jobsBy = byOutlet(jobs);
    const ratingsBy = byOutlet(ratings.map((row) => ({ outletId: row.job.outletId, rating: row.rating!, job: row.job })));
    const inspectionsBy = byOutlet(inspections);
    const scoresBy = byOutlet(scores);

    const periodDates: string[] = [];
    for (let date = from; date <= today; date = shiftDate(date, 1)) periodDates.push(date);

    // ───────────────────────── One area at a time ─────────────────────────

    const checklistsFor = (outletId: string): MonitoringChecklistsDto => {
      const facts = { due: 0, submitted: 0, missed: 0, late: 0, withProblems: 0, overdueNow: 0 };
      for (const list of listsBy.get(outletId) ?? []) {
        // A checklist with no items yet is not handed out to staff, so it cannot be missed.
        if (!list.template.items.some((item) => item.outletId === null || item.outletId === outletId)) continue;
        const since = indiaDate(list.createdAt);
        for (const date of periodDates) {
          if (date < since) continue;
          const run = submittedRuns.get(`${list.id} ${date}`);
          if (run) {
            facts.due += 1;
            facts.submitted += 1;
            // Late: handed in on a later day, or the same day after the due time.
            const at = run.submittedAt ?? toDbDate(date);
            const day = indiaDate(at);
            if (day > date || (day === date && list.dueTime !== null && indiaTime(at) > list.dueTime)) facts.late += 1;
            if (problemRuns.has(run.id)) facts.withProblems += 1;
          } else if (date < today) {
            facts.due += 1;
            facts.missed += 1;
          } else if (list.dueTime !== null && timeNow > list.dueTime) {
            // Today's checklist only counts against the outlet once its time has passed.
            facts.due += 1;
            facts.missed += 1;
            facts.overdueNow += 1;
          }
        }
      }
      return {
        ...facts,
        percent: facts.due > 0 ? Math.round((facts.submitted / facts.due) * 100) : null,
        level: checklistLevel(facts),
      };
    };

    const issuesFor = (outletId: string): MonitoringIssuesDto => {
      const items = (issuesBy.get(outletId) ?? []).map((issue) => ({
        id: issue.id,
        reference: issueReference(issue.reference),
        status: issue.status,
        category: issue.category,
        ageDays: daysBetween(indiaDate(issue.createdAt), today),
      }));
      const notStarted = items.filter((issue) => issue.status === 'OPEN');
      const oldest = (list: typeof items) => (list.length > 0 ? Math.max(...list.map((issue) => issue.ageDays)) : null);
      const facts = {
        unresolved: items.length,
        notStarted: notStarted.length,
        oldestNotStartedDays: oldest(notStarted),
        oldestUnresolvedDays: oldest(items),
      };
      return { ...facts, items, level: issueLevel(facts) };
    };

    const licencesFor = (outletId: string): MonitoringLicencesDto => {
      const all = (licencesBy.get(outletId) ?? []).map((licence) => {
        const daysLeft = daysBetween(today, fromDbDate(licence.expiresOn));
        return {
          id: licence.id,
          type: licence.type,
          name: licence.name,
          expiresOn: fromDbDate(licence.expiresOn),
          daysLeft,
          state: daysLeft < 0 ? ('EXPIRED' as const) : daysLeft <= MONITORING_RULES.licences.expiringWithinDays ? ('EXPIRING' as const) : ('VALID' as const),
        };
      });
      const facts = {
        total: all.length,
        expired: all.filter((licence) => licence.state === 'EXPIRED').length,
        expiring: all.filter((licence) => licence.state === 'EXPIRING').length,
      };
      return { ...facts, items: all.filter((licence) => licence.state !== 'VALID'), level: licenceLevel(facts) };
    };

    const visitsFor = (outletId: string): MonitoringVisitsDto => {
      const rules = MONITORING_RULES.visits;
      const items = new Map<string, MonitoringVisitItemDto>();
      const flag = (
        job: { id: string; scheduledDate: Date; serviceType: { name: unknown } },
        problem: MonitoringVisitProblem,
        waitingDays: number | null,
        rating: number | null = null,
      ) => {
        const item = items.get(job.id) ?? {
          id: job.id,
          serviceName: job.serviceType.name as LocalizedText,
          date: fromDbDate(job.scheduledDate),
          problems: [],
          waitingDays: null,
          rating: null,
        };
        item.problems.push(problem);
        if (waitingDays !== null) item.waitingDays = Math.max(item.waitingDays ?? 0, waitingDays);
        if (rating !== null) item.rating = rating;
        items.set(job.id, item);
      };

      const facts = {
        overdue: 0,
        unassigned: 0,
        unassignedSoon: 0,
        awaitingSignOff: 0,
        oldestSignOffDays: null as number | null,
        reportsToApprove: 0,
        oldestApprovalDays: null as number | null,
        reportsReturned: 0,
        ratingCount: 0,
        ratingAverage: null as number | null,
        lowRatings: 0,
      };
      let nextDate: string | null = null;

      for (const job of jobsBy.get(outletId) ?? []) {
        const date = fromDbDate(job.scheduledDate);
        if (job.status === 'COMPLETED') {
          // Finished by the Supervisor; the restaurant has not signed it off yet.
          const waited = daysBetween(indiaDate(job.completedAt ?? job.scheduledDate), today);
          facts.awaitingSignOff += 1;
          facts.oldestSignOffDays = Math.max(facts.oldestSignOffDays ?? 0, waited);
          flag(job, 'AWAITING_SIGN_OFF', waited);
        } else if (job.status === 'APPROVED') {
          // Signed off by the restaurant; ECCS has not approved the report yet.
          const waited = daysBetween(indiaDate(job.approvedAt ?? job.scheduledDate), today);
          facts.reportsToApprove += 1;
          facts.oldestApprovalDays = Math.max(facts.oldestApprovalDays ?? 0, waited);
          flag(job, 'REPORT_TO_APPROVE', waited);
        } else if (job.status === 'IN_PROGRESS' && job.signOff) {
          // ECCS sent the signed-off report back to the Supervisor to correct. The work itself is done, so it is not overdue.
          facts.reportsReturned += 1;
          flag(job, 'REPORT_RETURNED', null);
        } else {
          // Still to do, or the Supervisor has checked in and not finished.
          if (date < today) {
            facts.overdue += 1;
            flag(job, 'OVERDUE', daysBetween(date, today));
          } else if (nextDate === null || date < nextDate) {
            nextDate = date;
          }
          if (job.supervisorId === null) {
            facts.unassigned += 1;
            if (daysBetween(today, date) <= rules.unassignedAttentionWithinDays) facts.unassignedSoon += 1;
            flag(job, 'UNASSIGNED', null);
          }
        }
      }

      const given = ratingsBy.get(outletId) ?? [];
      facts.ratingCount = given.length;
      if (given.length > 0) {
        facts.ratingAverage = Math.round((given.reduce((sum, row) => sum + row.rating, 0) / given.length) * 10) / 10;
      }
      for (const row of given) {
        if (row.rating <= rules.lowRatingStars) {
          facts.lowRatings += 1;
          flag(row.job, 'LOW_RATING', null, row.rating);
        }
      }

      return {
        ...facts,
        nextDate,
        items: [...items.values()].sort((a, b) => (b.waitingDays ?? -1) - (a.waitingDays ?? -1) || a.date.localeCompare(b.date)),
        level: visitLevel(facts),
      };
    };

    const findingsBy = new Map<string, { dueDate: Date | null }[]>();
    for (const finding of findings) findingsBy.set(finding.inspectionId, [...(findingsBy.get(finding.inspectionId) ?? []), finding]);

    const inspectionsFor = (outletId: string): MonitoringInspectionsDto => {
      const items = new Map<string, MonitoringInspectionItemDto>();
      const flag = (inspection: { id: string; plannedDate: Date | null; conductedAt: Date }, problem: MonitoringInspectionProblem) => {
        const item = items.get(inspection.id) ?? {
          id: inspection.id,
          date: inspection.plannedDate ? fromDbDate(inspection.plannedDate) : indiaDate(inspection.conductedAt),
          problems: [],
        };
        item.problems.push(problem);
        items.set(inspection.id, item);
      };

      const latest = latestApproved.get(outletId) ?? null;
      const grade = INSPECTION_GRADES.find((known) => known === latest?.grade) ?? null;
      const open = latest ? (findingsBy.get(latest.id) ?? []) : [];
      const facts = {
        latestGrade: grade as InspectionGrade | null,
        actionsOverdue: open.filter((finding) => finding.dueDate && fromDbDate(finding.dueDate) < today).length,
        toApprove: 0,
        oldestApprovalDays: null as number | null,
        overduePlanned: 0,
      };
      if (latest && grade === 'NON_COMPLIANT') flag(latest, 'NO_GRADE');

      for (const inspection of inspectionsBy.get(outletId) ?? []) {
        if (inspection.status === 'SUBMITTED') {
          facts.toApprove += 1;
          facts.oldestApprovalDays = Math.max(
            facts.oldestApprovalDays ?? 0,
            daysBetween(indiaDate(inspection.completedAt ?? inspection.conductedAt), today),
          );
          flag(inspection, 'REPORT_TO_APPROVE');
        } else if (inspection.status === 'DRAFT' && inspection.plannedDate && fromDbDate(inspection.plannedDate) < today) {
          facts.overduePlanned += 1;
          flag(inspection, 'OVERDUE_PLANNED');
        }
      }

      return {
        ...facts,
        latest:
          latest && grade
            ? {
                id: latest.id,
                date: latest.plannedDate ? fromDbDate(latest.plannedDate) : indiaDate(latest.conductedAt),
                score: Math.round(latest.overallScore ?? 0),
                grade,
                reportNumber: latest.reportNumber,
              }
            : null,
        actionsOpen: open.length,
        items: [...items.values()],
        level: inspectionLevel(facts),
      };
    };

    const scoreFor = (outletId: string): MonitoringScoreDto => {
      // Newest first. The one to compare with is the newest that is at least a week older than the latest.
      const rows = scoresBy.get(outletId) ?? [];
      const latest = rows[0] ?? null;
      const before = latest ? shiftDate(fromDbDate(latest.date), -MONITORING_RULES.score.compareDaysBack) : '';
      const earlier = latest ? (rows.find((row) => fromDbDate(row.date) <= before) ?? null) : null;
      const facts = {
        score: latest ? Math.round(latest.score) : null,
        previous: earlier ? Math.round(earlier.score) : null,
      };
      return {
        ...facts,
        date: latest ? fromDbDate(latest.date) : null,
        previousDate: earlier ? fromDbDate(earlier.date) : null,
        change: facts.score !== null && facts.previous !== null ? facts.score - facts.previous : null,
        level: scoreLevel(facts),
      };
    };

    // ───────────────────────── Put together ─────────────────────────

    const rows: MonitoringOutletDto[] = outlets.map((outlet) => {
      const areas = {
        checklists: checklistsFor(outlet.id),
        issues: issuesFor(outlet.id),
        licences: licencesFor(outlet.id),
        visits: visitsFor(outlet.id),
        inspections: inspectionsFor(outlet.id),
        score: scoreFor(outlet.id),
      };
      const at = (level: MonitoringLevel): MonitoringArea[] => MONITORING_AREAS.filter((area) => areas[area].level === level);
      const plan = outlet.subscriptions[0]?.plan;
      return {
        outletId: outlet.id,
        outletName: outlet.name,
        organizationId: outlet.organization.id,
        organizationName: outlet.organization.name,
        plan: plan ? { code: plan.code, name: plan.name as LocalizedText } : null,
        level: overallLevel(MONITORING_AREAS.map((area) => areas[area].level)),
        attention: at('ATTENTION'),
        watch: at('WATCH'),
        ...areas,
      };
    });

    // Worst first: the outlets with the most areas needing attention lead. The query's order (restaurant, then outlet) breaks ties.
    rows.sort(
      (a, b) =>
        LEVEL_ORDER[a.level] - LEVEL_ORDER[b.level] || b.attention.length - a.attention.length || b.watch.length - a.watch.length,
    );

    const count = (level: MonitoringLevel) => rows.filter((row) => row.level === level).length;
    const totals: MonitoringTotalsDto = {
      outlets: rows.length,
      attention: count('ATTENTION'),
      watch: count('WATCH'),
      ok: count('OK'),
      areas: Object.fromEntries(
        MONITORING_AREAS.map((area) => [
          area,
          {
            attention: rows.filter((row) => row.attention.includes(area)).length,
            watch: rows.filter((row) => row.watch.includes(area)).length,
          },
        ]),
      ) as MonitoringTotalsDto['areas'],
    };

    return { date: today, from, to: today, days, totals, outlets: rows };
  }
}
