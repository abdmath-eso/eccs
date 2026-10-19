import { ForbiddenException, Injectable } from '@nestjs/common';
import {
  accessScope,
  AI_ERROR,
  firstDistinct,
  hasNumberWord,
  isEccsRole,
  MONITORING_AREAS,
  MONITORING_DIGEST_JSON_SCHEMA,
  MONITORING_DIGEST_MAX_POINTS,
  MONITORING_DIGEST_UPDATE_MINUTES,
  monitoringDigestSchema,
  numbersIn,
  unknownIds,
  unknownNumbers,
  type IssueCategory,
  type LicenceType,
  type MonitoringArea,
  type MonitoringBoardDto,
  type MonitoringDigestAnswer,
  type MonitoringDigestDto,
  type MonitoringOutletDto,
} from '@eccs/shared';
import { MONITORING_DIGEST_INSTRUCTIONS } from '../ai/ai-prompts.js';
import { aiUnavailable, AiService } from '../ai/ai.service.js';
import type { AuthUser } from '../auth/auth.types.js';
import { indiaDate } from '../checklists/checklists.service.js';
import { PrismaService } from '../prisma/prisma.service.js';
import { MonitoringService } from './monitoring.service.js';

/** One line and six short points: a few hundred tokens are plenty. */
const MAX_OUTPUT_TOKENS = 1200;
/** At most this many outlets are described to the AI; the rest are only counted. */
const MAX_OUTLETS_SENT = 30;

const toDbDate = (date: string) => new Date(`${date}T00:00:00.000Z`);

const ISSUE_WORDS: Record<IssueCategory, string> = {
  PEST_SIGHTING: 'pest sighting',
  CHIMNEY: 'chimney or exhaust',
  EQUIPMENT: 'equipment',
  HYGIENE: 'cleaning or hygiene',
  SUPPORT: 'help with the app or service',
  OTHER: 'something else',
};
const LICENCE_WORDS: Record<LicenceType, string> = {
  FSSAI: 'FSSAI licence',
  FIRE_NOC: 'fire NOC',
  TRADE_LICENCE: 'trade licence',
  PEST_CONTROL: 'pest control contract',
  OTHER: 'licence',
};

/** What the AI is told about one outlet: its names, its level, and the facts of the areas behind that level. */
interface DigestOutlet {
  id: string;
  name: string;
  restaurant: string;
  level: 'ATTENTION' | 'WATCH';
  areas: Partial<Record<MonitoringArea, Record<string, unknown>>>;
}

/** What the AI is given: the day's counts and the outlets that need attention or are worth watching. */
export interface DigestFacts {
  /** How far back the checklist and rating figures look, in days. */
  checklistDays: number;
  counts: { outlets: number; needAttention: number; toWatch: number; onTrack: number; nothingYet: number };
  outlets: DigestOutlet[];
  /** Outlets needing attention or worth watching that were left out to keep the request small. */
  notListed: number;
}

/**
 * The daily digest at the top of the ECCS console's Monitoring board (feature 4,
 * 14 Oct 2026), for the Super Admin and the Operations Manager, who see every outlet.
 * One line on the day, then at most six short points, each about one outlet that
 * needs attention and why, in the board's own order (worst first).
 *
 * The pattern is the AI summary card at the top of an operations dashboard,
 * refreshed daily, labelled as AI-written, short first with the detail one click away,
 * as in devtodev's "AI-powered dashboard insights", SurveySensum's "Dashboard AI
 * summary" and Hurree's dashboard summaries; each point links to its outlet's row,
 * following Microsoft's HAX guideline G11 (make clear why the system did what it did).
 *
 * The board stays the app's: the digest is made from the board's own facts, never
 * changes a level or a number, and an answer that names an outlet that was not given
 * or writes a number that is not in the facts is refused (the console then shows
 * nothing). It is made on the first opening of the India day and kept, so later
 * openings cost nothing; "Update" makes a fresh one at most once an hour.
 *
 * Sends to the AI: outlet and restaurant names, levels, counts, days, grades and
 * scores. No issue text, no checklist problem text, nothing about staff or any person.
 */
@Injectable()
export class MonitoringDigestService {
  /** A digest being written right now: two people opening the board at once share it. */
  private making: Promise<MonitoringDigestDto> | null = null;

  constructor(
    private readonly prisma: PrismaService,
    private readonly monitoring: MonitoringService,
    private readonly ai: AiService,
  ) {}

  private get db() {
    return this.prisma.client;
  }

  /** Today's digest: the one kept from earlier today, or made now on the first opening. */
  async today(user: AuthUser): Promise<MonitoringDigestDto> {
    this.requireEverything(user);
    if (!this.ai.isOn('monitoring-digest')) throw aiUnavailable(AI_ERROR.off, '');
    const today = indiaDate();
    const kept = await this.db.aiDigest.findUnique({ where: { date: toDbDate(today) } });
    if (kept) return this.toDto(kept, true);
    return this.makeOnce(user, today);
  }

  /** "Update": a fresh digest, at most once an hour; sooner, the kept one comes back unchanged. */
  async update(user: AuthUser): Promise<MonitoringDigestDto> {
    this.requireEverything(user);
    if (!this.ai.isOn('monitoring-digest')) throw aiUnavailable(AI_ERROR.off, '');
    const today = indiaDate();
    const kept = await this.db.aiDigest.findUnique({ where: { date: toDbDate(today) } });
    if (kept && !mayUpdate(kept.madeAt)) return this.toDto(kept, true);
    return this.makeOnce(user, today);
  }

  /** The Super Admin and the Operations Manager: the "everything" board. A Supervisor's board has no digest. */
  private requireEverything(user: AuthUser) {
    const everything = user.memberships.some((m) => isEccsRole(m.role)) && accessScope(user.memberships, 'clients')?.kind === 'all';
    if (!everything) throw new ForbiddenException("The board's digest is for ECCS's Super Admin and Operations Manager");
  }

  private makeOnce(user: AuthUser, today: string): Promise<MonitoringDigestDto> {
    this.making ??= this.make(user, today).finally(() => {
      this.making = null;
    });
    return this.making;
  }

  private async make(user: AuthUser, today: string): Promise<MonitoringDigestDto> {
    const facts = digestFacts(await this.monitoring.board(user));
    const answer = await this.ai.run<MonitoringDigestAnswer>({
      feature: 'monitoring-digest',
      model: this.ai.modelFor('monitoring-digest'),
      instructions: MONITORING_DIGEST_INSTRUCTIONS,
      text: JSON.stringify(facts),
      answer: { schema: MONITORING_DIGEST_JSON_SCHEMA, check: monitoringDigestSchema },
      maxOutputTokens: MAX_OUTPUT_TOKENS,
      // The whole board, not one outlet: counted against the platform's daily limit only.
      who: { userId: user.id, organizationId: null, outletId: null },
      facts,
    });
    const failed = 'The digest could not be written just now';
    if (!answer.ok) throw aiUnavailable(answer.code, failed);

    // Every outlet named must be one it was given, and every number one of the board's.
    const named = answer.value.points.map((point) => point.outletId);
    const words = [answer.value.overview, ...answer.value.points.map((point) => point.text)].join(' ');
    const problem =
      unknownIds(named, facts.outlets.map((outlet) => outlet.id)).length > 0
        ? 'IDS'
        : unknownNumbers(words, numbersIn(JSON.stringify(withoutIds(facts)))).length > 0 || hasNumberWord(words)
          ? 'NUMBERS'
          : null;
    if (problem) {
      await this.ai.reject(answer.requestId, problem);
      throw aiUnavailable(AI_ERROR.failed, failed);
    }

    // One point per outlet, at most six, in the board's own order (worst first), whatever
    // order the AI wrote them in: the digest must never rank outlets differently from the board.
    const kept = new Set(firstDistinct(named, MONITORING_DIGEST_MAX_POINTS));
    const points = inBoardOrder(
      answer.value.points.filter((point) => kept.delete(point.outletId)),
      facts.outlets.map((outlet) => outlet.id),
    );
    const data = { overview: answer.value.overview, points, aiRequestId: answer.requestId, madeAt: new Date() };
    const row = await this.db.aiDigest.upsert({ where: { date: toDbDate(today) }, create: { date: toDbDate(today), ...data }, update: data });
    return this.toDto(row, false);
  }

  private async toDto(
    row: { date: Date; overview: string; points: unknown; aiRequestId: string; madeAt: Date },
    stored: boolean,
  ): Promise<MonitoringDigestDto> {
    const points = row.points as { outletId: string; text: string }[];
    const outlets = await this.db.outlet.findMany({
      where: { id: { in: points.map((point) => point.outletId) } },
      select: { id: true, name: true, organization: { select: { name: true } } },
    });
    const byId = new Map(outlets.map((outlet) => [outlet.id, outlet]));
    const request = await this.db.aiRequest.findUnique({ where: { id: row.aiRequestId }, select: { outcome: true } });
    return {
      date: row.date.toISOString().slice(0, 10),
      overview: row.overview,
      // An outlet removed since the digest was made is left out.
      points: points.flatMap((point) => {
        const outlet = byId.get(point.outletId);
        return outlet ? [{ outletId: point.outletId, outletName: outlet.name, organizationName: outlet.organization.name, text: point.text }] : [];
      }),
      madeAt: row.madeAt.toISOString(),
      canUpdate: mayUpdate(row.madeAt),
      aiRequestId: row.aiRequestId,
      stored,
      helpful: request?.outcome === 'HELPFUL' ? true : request?.outcome === 'NOT_HELPFUL' ? false : null,
    };
  }
}

const mayUpdate = (madeAt: Date) => Date.now() - madeAt.getTime() >= MONITORING_DIGEST_UPDATE_MINUTES * 60_000;

/** Leaves out empty facts (nothing, zero, an empty list), so the request stays small. */
function compact(facts: Record<string, unknown>): Record<string, unknown> {
  return Object.fromEntries(
    Object.entries(facts).filter(([, value]) => value !== null && value !== undefined && value !== 0 && !(Array.isArray(value) && value.length === 0)),
  );
}

/** The facts of one area, as the board shows them, in plain names. */
function areaFacts(outlet: MonitoringOutletDto, area: MonitoringArea): Record<string, unknown> {
  switch (area) {
    case 'checklists': {
      const c = outlet.checklists;
      return compact({ due: c.due, handedIn: c.submitted, missed: c.missed, late: c.late, overdueToday: c.overdueNow, percentHandedIn: c.percent });
    }
    case 'issues': {
      const i = outlet.issues;
      return compact({
        unresolved: i.unresolved,
        notPickedUpByEccs: i.notStarted,
        oldestNotPickedUpDays: i.oldestNotStartedDays,
        oldestUnresolvedDays: i.oldestUnresolvedDays,
        kinds: [...new Set(i.items.map((issue) => ISSUE_WORDS[issue.category]))],
      });
    }
    case 'licences': {
      const l = outlet.licences;
      return compact({
        expired: l.expired,
        expiring: l.expiring,
        licences: l.items.map((licence) =>
          licence.daysLeft < 0
            ? { type: LICENCE_WORDS[licence.type], expiredDaysAgo: -licence.daysLeft }
            : { type: LICENCE_WORDS[licence.type], expiresInDays: licence.daysLeft },
        ),
      });
    }
    case 'visits': {
      const v = outlet.visits;
      return compact({
        overdue: v.overdue,
        withoutSupervisor: v.unassigned,
        withoutSupervisorDueSoon: v.unassignedSoon,
        waitingForRestaurantSignOff: v.awaitingSignOff,
        oldestSignOffWaitDays: v.oldestSignOffDays,
        reportsForEccsToApprove: v.reportsToApprove,
        oldestApprovalWaitDays: v.oldestApprovalDays,
        reportsSentBackToSupervisor: v.reportsReturned,
        averageRatingOutOf5: v.ratingAverage,
        lowRatings: v.lowRatings,
      });
    }
    case 'inspections': {
      const n = outlet.inspections;
      return compact({
        latestGrade: n.latestGrade,
        latestScoreOutOf100: n.latest?.score,
        correctiveActionsPastDate: n.actionsOverdue,
        reportsForEccsToApprove: n.toApprove,
        oldestApprovalWaitDays: n.oldestApprovalDays,
        plannedButNotDone: n.overduePlanned,
      });
    }
    case 'score': {
      const s = outlet.score;
      return compact({ hygieneScoreOutOf100: s.score, aWeekEarlier: s.previous, change: s.change });
    }
    case 'photos': {
      const p = outlet.photos;
      return compact({ proofPhotos: p.checked, doubtful: p.doubtful, doubtfulForCertain: p.certain });
    }
  }
}

/**
 * The board trimmed to what the digest needs: the counts, and for each outlet that
 * needs attention or is worth watching (worst first, as the board sorts them) its
 * names, its level and the facts of the areas that put it there.
 */
export function digestFacts(board: MonitoringBoardDto): DigestFacts {
  const flagged = board.outlets.filter((outlet) => outlet.level === 'ATTENTION' || outlet.level === 'WATCH');
  return {
    checklistDays: board.days,
    counts: {
      outlets: board.totals.outlets,
      needAttention: board.totals.attention,
      toWatch: board.totals.watch,
      onTrack: board.totals.ok,
      nothingYet: board.totals.outlets - board.totals.attention - board.totals.watch - board.totals.ok,
    },
    outlets: flagged.slice(0, MAX_OUTLETS_SENT).map((outlet) => ({
      id: outlet.outletId,
      name: outlet.outletName,
      restaurant: outlet.organizationName,
      level: outlet.level as 'ATTENTION' | 'WATCH',
      areas: Object.fromEntries(
        MONITORING_AREAS.filter((area) => outlet.attention.includes(area) || outlet.watch.includes(area)).map((area) => [
          area,
          { level: outlet[area].level, ...areaFacts(outlet, area) },
        ]),
      ),
    })),
    notListed: Math.max(0, flagged.length - MAX_OUTLETS_SENT),
  };
}

/**
 * The points in the order of `boardOrder` (the board's outlet ids, worst first: the
 * worst level, then the most areas needing attention, then the most to watch). The
 * first pictures showed the AI ranking a different outlet first from the board.
 */
export function inBoardOrder<T extends { outletId: string }>(points: readonly T[], boardOrder: readonly string[]): T[] {
  const place = new Map(boardOrder.map((id, index) => [id, index]));
  const at = (point: T) => place.get(point.outletId) ?? boardOrder.length;
  return [...points].sort((a, b) => at(a) - at(b));
}

/** The facts without the outlets' ids, whose letters and digits are not numbers anyone could write. */
const withoutIds = (facts: DigestFacts) => ({ ...facts, outlets: facts.outlets.map(({ id: _id, ...rest }) => rest) });
