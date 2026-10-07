import { Injectable, Logger, NotFoundException, OnModuleDestroy, OnModuleInit } from '@nestjs/common';
import type { Prisma } from '@eccs/db';
import {
  accessScope,
  calculateScore,
  can,
  SCORE_RULE_VERSION,
  SCORE_RULES,
  type HygieneScoreDto,
  type ScoreInput,
  type ScoreProblem,
  type ScoreResult,
  type ScoreSnapshotBreakdown,
} from '@eccs/shared';
import type { AuthUser } from '../auth/auth.types.js';
import { ChecklistsService, indiaDate, indiaTime } from '../checklists/checklists.service.js';
import { env } from '../config/env.js';
import { InspectionsService } from '../inspections/inspections.service.js';
import { IssuesService } from '../issues/issues.service.js';
import { LicencesService } from '../licences/licences.service.js';
import { PrismaService } from '../prisma/prisma.service.js';

const DAY_MS = 86_400_000;
const RECALCULATE_EVERY_MS = 6 * 60 * 60 * 1000;
// A little after the plans timer (15 seconds), so the two do not start together.
const FIRST_RECALCULATION_AFTER_MS = 25_000;
/** The trend on the score screen goes back this many days. */
const HISTORY_DAYS = 30;
/** "Since last week" compares with the score of 7 days ago, or failing that the nearest one up to this many days ago. */
const WEEK_AGO_DAYS = 7;
const WEEK_AGO_AT_MOST_DAYS = 10;

const toDbDate = (date: string) => new Date(`${date}T00:00:00.000Z`);
const fromDbDate = (date: Date) => date.toISOString().slice(0, 10);
const addDays = (date: string, days: number) => fromDbDate(new Date(toDbDate(date).getTime() + days * DAY_MS));
const daysBetween = (from: string, to: string) => Math.round((toDbDate(to).getTime() - toDbDate(from).getTime()) / DAY_MS);
/** "HH:mm" as minutes since midnight. */
const minutes = (time: string) => Number(time.slice(0, 2)) * 60 + Number(time.slice(3, 5));

/**
 * The scorer reads through the checklist, licence, inspection and issue services, so
 * their rules (what counts as missed, expired and so on) stay in one place. Those
 * services ask who is reading; the timer has no person, so it reads as ECCS, which
 * may see every outlet. It is never used to change anything.
 */
const READER: AuthUser = {
  id: 'hygiene-score',
  phone: null,
  name: 'Hygiene score',
  language: 'EN',
  contentLanguage: 'EN',
  sessionId: 'hygiene-score',
  memberships: [{ role: 'SUPER_ADMIN', organizationId: null, organizationName: null, outletId: null, outletName: null }],
};

/**
 * The hygiene score of each outlet. The rule itself is `calculateScore` in
 * packages/shared/src/scores.ts; this service counts what the rule needs from the
 * records, keeps one snapshot per outlet per day (the trend, and what the ECCS
 * monitoring board reads), and answers the apps.
 */
@Injectable()
export class ScoresService implements OnModuleInit, OnModuleDestroy {
  private readonly logger = new Logger(ScoresService.name);
  private timers: NodeJS.Timeout[] = [];

  constructor(
    private readonly prisma: PrismaService,
    private readonly checklists: ChecklistsService,
    private readonly licences: LicencesService,
    private readonly issues: IssuesService,
    private readonly inspections: InspectionsService,
  ) {}

  private get db() {
    return this.prisma.client;
  }

  /** Works out every outlet's score shortly after the server starts and a few times a day after that. */
  onModuleInit() {
    // Tests work scores out themselves, at moments they choose.
    if (env.NODE_ENV === 'test') return;
    const run = () =>
      void this.recalculateAll()
        .then(({ outlets, scored }) => this.logger.log(`Hygiene scores worked out: ${scored} of ${outlets} outlets have one`))
        .catch((error) => this.logger.warn(`Could not work out the hygiene scores: ${String(error)}`));
    const first = setTimeout(run, FIRST_RECALCULATION_AFTER_MS);
    const repeat = setInterval(run, RECALCULATE_EVERY_MS);
    // Neither keeps the server alive when it is asked to stop.
    first.unref();
    repeat.unref();
    this.timers = [first, repeat];
  }

  onModuleDestroy() {
    for (const timer of this.timers) clearTimeout(timer);
  }

  // ───────────────────────── For the apps ─────────────────────────

  /**
   * An outlet's score now, with its breakdown and the last 30 days. Asking also
   * brings today's snapshot up to date, so the monitoring board never shows an
   * older number than the restaurant sees. The Head Chef gets the number and band only.
   */
  async forOutlet(user: AuthUser, outletId: string): Promise<HygieneScoreDto> {
    const outlet = await this.requireOutlet(user, outletId);
    const today = indiaDate();
    const result = await this.snapshot(outletId, today);

    const rows = await this.db.hygieneScoreSnapshot.findMany({
      where: { outletId, date: { gt: toDbDate(addDays(today, -HISTORY_DAYS)), lte: toDbDate(today) } },
      orderBy: { date: 'asc' },
      select: { date: true, score: true },
    });
    const history = rows.map((row) => ({ date: fromDbDate(row.date), score: Math.round(row.score) }));
    // The newest score that is at least a week old, but not so old that "last week" would be untrue.
    const before = history
      .filter((point) => point.date <= addDays(today, -WEEK_AGO_DAYS) && point.date >= addDays(today, -WEEK_AGO_AT_MOST_DAYS))
      .at(-1);

    // The same line the home screen draws: whoever may read licences gets the full picture.
    const full = can(user.memberships, 'licences', 'read', { organizationId: outlet.organizationId, outletId });
    return {
      outletId,
      outletName: outlet.name,
      date: today,
      score: result.score,
      band: result.band,
      change: result.score !== null && before ? result.score - before.score : null,
      detail: full ? { earned: result.earned, possible: result.possible, components: result.components, history } : null,
    };
  }

  // ───────────────────────── Working it out ─────────────────────────

  /**
   * Works out one outlet's score for a day and stores it as that day's snapshot,
   * replacing an earlier one for the same day. While there is too little to give a
   * number, no snapshot is kept for the day. `asOf` is today unless a test says otherwise.
   */
  async snapshot(outletId: string, asOf: string = indiaDate()): Promise<ScoreResult> {
    const result = calculateScore(await this.gather(outletId, asOf));
    const date = toDbDate(asOf);

    if (result.score === null || result.band === null) {
      await this.db.hygieneScoreSnapshot.deleteMany({ where: { outletId, date } });
      return result;
    }
    const breakdown: ScoreSnapshotBreakdown = {
      version: SCORE_RULE_VERSION,
      band: result.band,
      earned: result.earned,
      possible: result.possible,
      components: result.components,
    };
    const data = { score: result.score, breakdown: breakdown as unknown as Prisma.InputJsonValue };
    try {
      await this.db.hygieneScoreSnapshot.upsert({
        where: { outletId_date: { outletId, date } },
        create: { outletId, date, ...data },
        update: data,
      });
    } catch (error) {
      // Two people asked at the same moment and the other one created today's row first.
      if ((error as { code?: string }).code !== 'P2002') throw error;
      await this.db.hygieneScoreSnapshot.update({ where: { outletId_date: { outletId, date } }, data });
    }
    return result;
  }

  /** Works out and stores the score of every active outlet. One outlet failing does not stop the rest. */
  async recalculateAll(asOf: string = indiaDate()): Promise<{ outlets: number; scored: number }> {
    const outlets = await this.db.outlet.findMany({ where: { isActive: true }, select: { id: true } });
    let scored = 0;
    for (const outlet of outlets) {
      try {
        if ((await this.snapshot(outlet.id, asOf)).score !== null) scored += 1;
      } catch (error) {
        this.logger.warn(`Could not work out the hygiene score of outlet ${outlet.id}: ${String(error)}`);
      }
    }
    return { outlets: outlets.length, scored };
  }

  /** Counts, from the records, the plain numbers the rule works from. */
  async gather(outletId: string, asOf: string = indiaDate()): Promise<ScoreInput> {
    const [checklistPart, services, licences, inspection, issues] = await Promise.all([
      this.gatherChecklists(outletId, asOf),
      this.gatherVisits(outletId, asOf),
      this.gatherLicences(outletId),
      this.gatherInspection(outletId, asOf),
      SCORE_RULES.countIssuesWithEccs ? this.gatherIssues(outletId, asOf) : [],
    ]);
    return {
      checklists: checklistPart.checklists,
      onTime: checklistPart.onTime,
      problems: { answered: checklistPart.answered, open: [...checklistPart.problems, ...issues] },
      services,
      licences,
      inspection,
    };
  }

  /** Checklists handed in, handed in on time, and checks reported as a problem day after day. */
  private async gatherChecklists(outletId: string, asOf: string) {
    const from = addDays(asOf, -(SCORE_RULES.checklistDays - 1));
    // The checklist service knows which checklists were due each day, and records the ones nobody opened as missed.
    const summaries = await this.checklists.between(READER, outletId, from, asOf);
    const runs = summaries.length
      ? await this.db.checklistRun.findMany({
          where: { id: { in: summaries.map((summary) => summary.id) } },
          select: {
            id: true,
            submittedAt: true,
            outletChecklist: { select: { dueTime: true } },
            responses: { select: { itemId: true, passed: true, item: { select: { isActive: true, outletId: true } } } },
          },
        })
      : [];
    const byId = new Map(runs.map((run) => [run.id, run]));

    const today = indiaDate();
    const now = indiaTime();
    const checklists = { due: 0, submitted: 0 };
    const onTime = { submitted: 0, onTime: 0 };
    let answered = 0;
    /** For each check still on a checklist: how it was answered, newest day first. */
    const answers = new Map<string, boolean[]>();

    // Newest first, which is the order the answers of each check are wanted in.
    for (const summary of [...summaries].sort((a, b) => b.date.localeCompare(a.date))) {
      const run = byId.get(summary.id);
      if (!run) continue;
      const dueTime = run.outletChecklist.dueTime;
      const handedIn = summary.status === 'SUBMITTED';

      // Today's checklist is not held against anyone while there is still time to do it.
      const settled = summary.date !== today || handedIn || (dueTime !== null && now > dueTime);
      if (settled) {
        checklists.due += 1;
        if (handedIn) checklists.submitted += 1;
      }
      if (handedIn && dueTime !== null && run.submittedAt) {
        onTime.submitted += 1;
        const inTime =
          indiaDate(run.submittedAt) === summary.date &&
          minutes(indiaTime(run.submittedAt)) <= minutes(dueTime) + SCORE_RULES.onTimeGraceMinutes;
        if (inTime) onTime.onTime += 1;
      }

      answered += run.responses.length;
      for (const response of run.responses) {
        // A check the restaurant has since removed is no longer its problem.
        const current = response.item.isActive && (response.item.outletId === null || response.item.outletId === outletId);
        if (!current || response.passed === null) continue;
        answers.set(response.itemId, [...(answers.get(response.itemId) ?? []), response.passed]);
      }
    }

    // A check counts as a problem while its latest answer says so; its age is the
    // number of days running, before that latest one, on which it was also a problem.
    const problems: ScoreProblem[] = [];
    for (const history of answers.values()) {
      const firstOk = history.indexOf(true);
      const daysRunning = firstOk === -1 ? history.length : firstOk;
      if (daysRunning > 0) problems.push({ kind: 'CHECKLIST_ITEM', severity: 'MEDIUM', ageDays: daysRunning - 1 });
    }
    return { checklists, onTime, answered, problems };
  }

  /** ECCS visits of the last 30 days: signed off, waiting for sign-off, or not carried out. */
  private async gatherVisits(outletId: string, asOf: string): Promise<ScoreInput['services']> {
    const visits = await this.db.job.findMany({
      where: {
        outletId,
        status: { not: 'CANCELLED' },
        scheduledDate: { gte: toDbDate(addDays(asOf, -SCORE_RULES.visitDays)), lte: toDbDate(asOf) },
      },
      select: { scheduledDate: true, completedAt: true, signOff: { select: { signedAt: true } } },
    });
    const counts = { signedOff: 0, notSignedOff: 0, awaitingSignOff: 0, missedByEccs: 0 };
    for (const visit of visits) {
      if (visit.signOff) counts.signedOff += 1;
      else if (visit.completedAt) {
        const waited = daysBetween(indiaDate(visit.completedAt), asOf);
        if (waited > SCORE_RULES.signOffGraceDays) counts.notSignedOff += 1;
        else counts.awaitingSignOff += 1;
      } else if (fromDbDate(visit.scheduledDate) < asOf) {
        // Its day has passed and ECCS has not finished it: not the restaurant's doing.
        counts.missedByEccs += 1;
      }
    }
    return counts;
  }

  private async gatherLicences(outletId: string): Promise<ScoreInput['licences']> {
    const licences = await this.licences.listLicences(READER, { outletId, attentionOnly: false });
    const inDate = licences.filter((licence) => licence.state !== 'EXPIRED');
    return {
      valid: inDate.filter((licence) => licence.file !== null).length,
      withoutCopy: inDate.filter((licence) => licence.file === null).length,
      expired: licences.length - inDate.length,
      expiringSoon: inDate.filter((licence) => licence.state === 'EXPIRING').length,
      fssaiMissing: !licences.some((licence) => licence.type === 'FSSAI'),
    };
  }

  /** The latest inspection ECCS has approved, if it was carried out recently enough to still count. */
  private async gatherInspection(outletId: string, asOf: string): Promise<ScoreInput['inspection']> {
    const oldest = addDays(asOf, -SCORE_RULES.inspectionValidDays);
    // Newest first.
    const latest = (await this.inspections.list(READER, { outletId })).find(
      (inspection) =>
        inspection.status === 'APPROVED' && inspection.overallScore !== null && inspection.date <= asOf && inspection.date >= oldest,
    );
    return latest ? { score: latest.overallScore ?? 0, nonCompliant: latest.nonCompliant } : null;
  }

  /**
   * Issues raised with ECCS that are still open. Only used if `countIssuesWithEccs`
   * is switched on in the rule; requests for help with the app are never counted.
   */
  private async gatherIssues(outletId: string, asOf: string): Promise<ScoreProblem[]> {
    const open = await this.issues.list(READER, { outletId, openOnly: true });
    return open
      .filter((issue) => issue.category !== 'SUPPORT')
      .map((issue) => ({
        kind: 'ISSUE' as const,
        severity: 'MEDIUM' as const,
        ageDays: Math.max(daysBetween(indiaDate(new Date(issue.createdAt)), asOf), 0),
      }));
  }

  // ───────────────────────── Helpers ─────────────────────────

  /**
   * The outlet, if the person may read its score: their own restaurant's for the
   * Owner, their own outlet's for a Manager or Head Chef, any for ECCS admins, and
   * for a Supervisor the outlets where they have a visit or an inspection. "Not
   * found" and "not yours" look the same.
   */
  private async requireOutlet(user: AuthUser, outletId: string) {
    const outlet = await this.db.outlet.findUnique({
      where: { id: outletId },
      select: { id: true, name: true, organizationId: true },
    });
    let allowed =
      outlet !== null && can(user.memberships, 'scores', 'read', { organizationId: outlet.organizationId, outletId });
    if (allowed && accessScope(user.memberships, 'scores')?.kind === 'assigned') {
      const [visits, inspections] = await Promise.all([
        this.db.job.count({ where: { outletId, supervisorId: user.id } }),
        this.db.inspection.count({ where: { outletId, supervisorId: user.id } }),
      ]);
      allowed = visits + inspections > 0;
    }
    if (!outlet || !allowed) throw new NotFoundException('Outlet not found');
    return outlet;
  }
}
