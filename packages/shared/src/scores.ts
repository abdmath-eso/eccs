// The hygiene score: one number out of 100 per outlet, built from what the platform already records.
//
// The whole rule lives in this file, as `calculateScore`: it takes plain counts and
// returns the score together with every component's points and what cost points, so
// the apps can always show why the number is what it is. The server
// (apps/api/src/scores) only gathers the counts.
//
// How it works, in short (the numbered rule is on `calculateScore`):
// - Six components, each worth a set number of points (SCORE_WEIGHTS).
// - A component with nothing to measure yet (no ECCS visit so far, no inspection
//   so far) is left out altogether instead of counting as zero, exactly as a "not
//   applicable" check is left out of an FSSAI inspection score.
// - Score = points earned ÷ points possible × 100.
// - A restaurant is only marked on what is in its own hands: a visit ECCS did not
//   carry out, or an issue waiting for ECCS, costs it nothing.

/** The parts of the score, in the order they are shown. */
export const SCORE_COMPONENTS = ["checklists", "onTime", "problems", "services", "licences", "inspection"] as const;
export type ScoreComponentKey = (typeof SCORE_COMPONENTS)[number];

/**
 * How many points each component is worth. The first five are the weights in
 * docs/PROPOSAL.md ("Hygiene score, version 1") and add up to 100, so an outlet that
 * has not been inspected yet is scored exactly as the proposal says. The latest
 * approved ECCS inspection adds 25 more possible points, which makes it one fifth of
 * the score (25 of 125) and shrinks the other five in proportion (to 32, 12, 16, 12
 * and 8 in every 100). Change the numbers here to retune the score.
 */
export const SCORE_WEIGHTS: Record<ScoreComponentKey, number> = {
  /** Daily checklists handed in over the last 7 days. */
  checklists: 40,
  /** Of the checklists handed in, those handed in by their due time. */
  onTime: 15,
  /** Problems reported on checklists that are still there on a later day. */
  problems: 20,
  /** ECCS visits in the last 30 days that the restaurant has signed off. */
  services: 15,
  /** Licences in date, each with a copy on file. */
  licences: 10,
  /** The latest approved ECCS inspection. */
  inspection: 25,
};

/** How serious a problem is, mildest first (the same scale as issues and inspection findings). */
export type ScoreSeverity = "LOW" | "MEDIUM" | "HIGH" | "CRITICAL";

/** The settings of the rule other than the weights. */
export const SCORE_RULES = {
  /** Checklists are judged over today and the days before it, this many days in all. */
  checklistDays: 7,
  /**
   * No number is given until this many checklists have fallen due: one checklist is
   * too little to call a kitchen "Excellent" or "Needs attention".
   */
  minChecklistsDue: 3,
  /** A checklist handed in up to this many minutes after its due time still counts as on time. */
  onTimeGraceMinutes: 15,
  /** Points a problem costs for each day it has stayed a problem after the day it was first reported. */
  problemPoints: { LOW: 1, MEDIUM: 2, HIGH: 4, CRITICAL: 6 } as Record<ScoreSeverity, number>,
  /** A problem stops getting more expensive after this many days. */
  problemMaxDays: 3,
  /**
   * Whether issues raised with ECCS that are still open cost points. Off: they wait
   * for ECCS, not for the restaurant, and charging for them would teach people not
   * to raise them.
   */
  countIssuesWithEccs: false,
  /** ECCS visits are looked at over this many days back. */
  visitDays: 30,
  /** A finished visit has this many days to be signed off before it costs points. */
  signOffGraceDays: 3,
  /** The share of its credit a licence keeps when it is in date but has no copy on file. */
  licenceWithoutCopyCredit: 0.5,
  /** An approved inspection counts for this many days after it was carried out. */
  inspectionValidDays: 180,
} as const;

/** The word that goes with the number, best first. */
export const SCORE_BANDS = ["EXCELLENT", "GOOD", "FAIR", "NEEDS_ATTENTION"] as const;
export type ScoreBand = (typeof SCORE_BANDS)[number];

/**
 * The lowest score for each band. They are the same cut-offs as the inspection
 * grades (INSPECTION_GRADE_FROM: A+ 88, A 80, B 68), so the two numbers a restaurant
 * sees mean the same thing.
 */
export const SCORE_BAND_FROM = { EXCELLENT: 88, GOOD: 80, FAIR: 68 } as const;

export function scoreBand(score: number): ScoreBand {
  if (score >= SCORE_BAND_FROM.EXCELLENT) return "EXCELLENT";
  if (score >= SCORE_BAND_FROM.GOOD) return "GOOD";
  if (score >= SCORE_BAND_FROM.FAIR) return "FAIR";
  return "NEEDS_ATTENTION";
}

/** Something still wrong at the outlet. */
export interface ScoreProblem {
  /** A check on a daily checklist, or an issue raised with ECCS (only counted if `countIssuesWithEccs` is on). */
  kind: "CHECKLIST_ITEM" | "ISSUE";
  severity: ScoreSeverity;
  /**
   * Days it has stayed a problem after the day it was first reported. For a checklist
   * check: reported as a problem on 3 days running is 2. Reported for the first time
   * is 0, which costs nothing: reporting a problem is never punished, leaving it is.
   */
  ageDays: number;
}

/** The plain numbers the rule works from. The server counts them; see apps/api/src/scores. */
export interface ScoreInput {
  checklists: {
    /** Checklists that fell due in the window (today's only once handed in or past their due time). */
    due: number;
    /** How many of those were handed in. */
    submitted: number;
  };
  onTime: {
    /** Checklists handed in that have a due time. */
    submitted: number;
    /** How many of those were handed in by the due time. */
    onTime: number;
  };
  problems: {
    /** Checks answered on checklists in the window. With none there is nothing to judge. */
    answered: number;
    open: ScoreProblem[];
  };
  services: {
    /** Visits ECCS finished that the restaurant has signed off. */
    signedOff: number;
    /** Finished more than `signOffGraceDays` ago and still not signed off. */
    notSignedOff: number;
    /** Finished recently and not yet signed off: still in time, so left out. */
    awaitingSignOff: number;
    /** Visits whose day passed without ECCS carrying them out. Never held against the restaurant. */
    missedByEccs: number;
  };
  licences: {
    /** In date, with a copy on file. */
    valid: number;
    /** In date, but no copy on file. */
    withoutCopy: number;
    expired: number;
    /** Of those in date, how many expire soon. Costs nothing; shown as a warning. */
    expiringSoon: number;
    /** No FSSAI licence is recorded. Every food business needs one, so this counts as a missing licence. */
    fssaiMissing: boolean;
  };
  /** The latest approved inspection still in date, or null if there is none. */
  inspection: {
    /** Its overall score out of 100. */
    score: number;
    /** Checks answered "not compliant". */
    nonCompliant: number;
  } | null;
}

/** What cost points, as a code the apps turn into a sentence in the person's language. */
export const SCORE_REASONS = [
  "CHECKLISTS_MISSED", // count = not handed in, total = fell due
  "CHECKLISTS_LATE", // count = handed in late, total = handed in with a due time
  "PROBLEMS_NOT_FIXED", // count = checklist checks reported as a problem on more than one day running
  "ISSUES_OPEN", // count = issues with ECCS open for more than a day (only if countIssuesWithEccs)
  "VISITS_NOT_SIGNED_OFF", // count = finished visits waiting too long for sign-off
  "VISITS_MISSED_BY_ECCS", // count = visits ECCS did not carry out; lost is always 0
  "LICENCES_EXPIRED", // count = expired licences
  "FSSAI_MISSING", // no FSSAI licence recorded
  "LICENCE_COPIES_MISSING", // count = licences in date with no copy on file
  "LICENCES_EXPIRING", // count = licences expiring soon; lost is always 0
  "INSPECTION_NON_COMPLIANT", // count = checks not compliant at the latest inspection
] as const;
export type ScoreReasonCode = (typeof SCORE_REASONS)[number];

export interface ScoreReason {
  code: ScoreReasonCode;
  count: number;
  /** Out of how many, where that helps ("2 of 14"). */
  total?: number;
  /** Points this cost, to one decimal place. 0 for a note that costs nothing. */
  lost: number;
}

export interface ScoreComponentResult {
  key: ScoreComponentKey;
  /** False when there is nothing to measure yet: the component is left out of the score. */
  measured: boolean;
  /** The most points this component can give (its weight). */
  max: number;
  /** Points earned, to one decimal place. 0 when not measured. */
  earned: number;
  /** Points lost (`max` − `earned`), to one decimal place. 0 when not measured. */
  lost: number;
  /** What cost points, the most costly first, then notes that cost nothing. */
  reasons: ScoreReason[];
}

export interface ScoreResult {
  /** Whole number out of 100, or null while there is too little to go on (see `minChecklistsDue`). */
  score: number | null;
  band: ScoreBand | null;
  /** Points earned and points possible across the measured components (to one decimal place). */
  earned: number;
  possible: number;
  /** All six, in the order of SCORE_COMPONENTS. */
  components: ScoreComponentResult[];
}

const round1 = (value: number) => Math.round(value * 10) / 10;
const clamp01 = (value: number) => Math.min(1, Math.max(0, value));

/**
 * The rule.
 *
 * 1. Checklists (40): checklists handed in ÷ checklists that fell due, over today and
 *    the six days before. Today's checklists count only once handed in or past their
 *    due time. Not measured if none fell due.
 * 2. On time (15): of the checklists handed in that have a due time, the share handed
 *    in by that time (15 minutes' grace). A missed checklist is already counted in 1
 *    and is not counted again here. Not measured if none was handed in.
 * 3. Problems (20): starts at 20. A check reported as a problem costs nothing the day
 *    it is first reported. Each further day running it is still reported as a problem
 *    costs 2 points, up to 3 days (6 points) per check; the component cannot go below
 *    0. Not measured if no check was answered in the window.
 * 4. ECCS visits (15): of the visits ECCS finished in the last 30 days, the share the
 *    restaurant has signed off. A visit finished in the last 3 days and not yet signed
 *    off is left out (still in time). A visit ECCS did not carry out is left out and
 *    never costs anything. Not measured if nothing is left to count.
 * 5. Licences (10): each licence in date with a copy on file counts 1, in date without
 *    a copy ½, expired 0; an outlet with no FSSAI licence recorded has one more
 *    licence counting 0. Points = 10 × the average. A licence expiring soon still
 *    counts in full.
 * 6. Inspection (25): the overall score of the latest approved ECCS inspection carried
 *    out in the last 180 days, as a share of 25. Not measured if there is none.
 * 7. Score = points earned ÷ points possible × 100, rounded to a whole number, where
 *    "possible" adds up only the measured components. So a component with nothing to
 *    measure neither helps nor hurts, and its weight is shared among the others in
 *    proportion.
 * 8. No score at all (null) until at least 3 checklists have fallen due.
 * 9. Band: Excellent from 88, Good from 80, Fair from 68, otherwise Needs attention.
 */
export function calculateScore(input: ScoreInput): ScoreResult {
  /** A component's points from the share earned (0 to 1), or "not measured" for a null share. */
  const component = (
    key: ScoreComponentKey,
    share: number | null,
    reasons: (Omit<ScoreReason, "lost"> & { share: number })[],
  ): ScoreComponentResult & { exact: number } => {
    const max = SCORE_WEIGHTS[key];
    if (share === null) return { key, measured: false, max, earned: 0, lost: 0, reasons: [], exact: 0 };
    const exact = max * clamp01(share);
    return {
      key,
      measured: true,
      max,
      earned: round1(exact),
      lost: round1(max - exact),
      reasons: reasons
        .filter((reason) => reason.count > 0)
        .map(({ share: lostShare, ...reason }) => ({ ...reason, lost: round1(max * clamp01(lostShare)) }))
        .sort((a, b) => b.lost - a.lost),
      exact,
    };
  };

  // 1. Checklists handed in.
  const { due, submitted } = input.checklists;
  const missed = Math.max(due - submitted, 0);
  const checklists = component("checklists", due > 0 ? submitted / due : null, [
    { code: "CHECKLISTS_MISSED", count: missed, total: due, share: due > 0 ? missed / due : 0 },
  ]);

  // 2. Handed in on time.
  const timed = input.onTime.submitted;
  const late = Math.max(timed - input.onTime.onTime, 0);
  const onTime = component("onTime", timed > 0 ? input.onTime.onTime / timed : null, [
    { code: "CHECKLISTS_LATE", count: late, total: timed, share: timed > 0 ? late / timed : 0 },
  ]);

  // 3. Problems left unfixed.
  const cost = (problem: ScoreProblem) =>
    SCORE_RULES.problemPoints[problem.severity] * Math.min(Math.max(Math.floor(problem.ageDays), 0), SCORE_RULES.problemMaxDays);
  const costly = input.problems.open.filter((problem) => cost(problem) > 0);
  const ofKind = (kind: ScoreProblem["kind"]) => costly.filter((problem) => problem.kind === kind);
  const points = (problems: ScoreProblem[]) => problems.reduce((total, problem) => total + cost(problem), 0);
  const problemMax = SCORE_WEIGHTS.problems;
  const problemsMeasured = input.problems.answered > 0 || costly.length > 0;
  const problems = component("problems", problemsMeasured ? 1 - points(costly) / problemMax : null, [
    { code: "PROBLEMS_NOT_FIXED", count: ofKind("CHECKLIST_ITEM").length, share: points(ofKind("CHECKLIST_ITEM")) / problemMax },
    { code: "ISSUES_OPEN", count: ofKind("ISSUE").length, share: points(ofKind("ISSUE")) / problemMax },
  ]);

  // 4. ECCS visits signed off.
  const { signedOff, notSignedOff, missedByEccs } = input.services;
  const counted = signedOff + notSignedOff;
  const services = component("services", counted > 0 ? signedOff / counted : null, [
    { code: "VISITS_NOT_SIGNED_OFF", count: notSignedOff, total: counted, share: counted > 0 ? notSignedOff / counted : 0 },
    { code: "VISITS_MISSED_BY_ECCS", count: missedByEccs, share: 0 },
  ]);

  // 5. Licences.
  const { valid, withoutCopy, expired, expiringSoon, fssaiMissing } = input.licences;
  const expected = valid + withoutCopy + expired + (fssaiMissing ? 1 : 0);
  const noCopyLoss = 1 - SCORE_RULES.licenceWithoutCopyCredit;
  const licences = component(
    "licences",
    expected > 0 ? (valid + withoutCopy * SCORE_RULES.licenceWithoutCopyCredit) / expected : null,
    expected > 0
      ? [
          { code: "LICENCES_EXPIRED", count: expired, total: expected, share: expired / expected },
          { code: "FSSAI_MISSING", count: fssaiMissing ? 1 : 0, share: 1 / expected },
          { code: "LICENCE_COPIES_MISSING", count: withoutCopy, total: expected, share: (withoutCopy * noCopyLoss) / expected },
          { code: "LICENCES_EXPIRING", count: expiringSoon, share: 0 },
        ]
      : [],
  );

  // 6. The latest inspection.
  const inspection = component("inspection", input.inspection ? input.inspection.score / 100 : null, [
    {
      code: "INSPECTION_NON_COMPLIANT",
      // A score under 100 always has a cause; say at least one even if the count was not passed on.
      count: input.inspection && input.inspection.score < 100 ? Math.max(input.inspection.nonCompliant, 1) : 0,
      share: input.inspection ? 1 - input.inspection.score / 100 : 0,
    },
  ]);

  // 7 to 9. Earned ÷ possible over what was measured.
  const all = [checklists, onTime, problems, services, licences, inspection];
  const measured = all.filter((entry) => entry.measured);
  const possible = measured.reduce((total, entry) => total + entry.max, 0);
  const earned = measured.reduce((total, entry) => total + entry.exact, 0);
  const enough = due >= SCORE_RULES.minChecklistsDue && possible > 0;
  const score = enough ? Math.round((earned / possible) * 100) : null;

  return {
    score,
    band: score === null ? null : scoreBand(score),
    earned: round1(earned),
    possible,
    components: all.map(({ exact: _exact, ...entry }) => entry),
  };
}

/** One thing costing points, with the component it belongs to. */
export interface ScoreFactor {
  component: ScoreComponentKey;
  reason: ScoreReason;
}

/**
 * The things costing the most points, biggest first: what to show under the number
 * as "what is holding your score back". Notes that cost nothing are left out.
 */
export function topScoreFactors(components: readonly ScoreComponentResult[], limit = 2): ScoreFactor[] {
  return components
    .filter((entry) => entry.measured)
    .flatMap((entry) => entry.reasons.map((reason) => ({ component: entry.key, reason })))
    .filter((factor) => factor.reason.lost > 0)
    .sort((a, b) => b.reason.lost - a.reason.lost)
    .slice(0, limit);
}

/** What is stored in `HygieneScoreSnapshot.breakdown` (one row per outlet per day). */
export interface ScoreSnapshotBreakdown {
  /** The version of the rule that produced it, so old rows can be told apart if the rule changes. */
  version: 1;
  band: ScoreBand;
  earned: number;
  possible: number;
  components: ScoreComponentResult[];
}
export const SCORE_RULE_VERSION = 1;

/** One day's score, for the trend. */
export interface ScoreHistoryPointDto {
  /** YYYY-MM-DD */
  date: string;
  score: number;
}

/** An outlet's hygiene score today. */
export interface HygieneScoreDto {
  outletId: string;
  outletName: string;
  /** The day it was worked out for (India date, YYYY-MM-DD). */
  date: string;
  /** Null while there is too little to go on. */
  score: number | null;
  band: ScoreBand | null;
  /** Points up or down on the score of about a week ago; null when there was none then. */
  change: number | null;
  /**
   * The breakdown and the trend. Null for the Head Chef, who gets the simple view:
   * the number and its band.
   */
  detail: {
    earned: number;
    possible: number;
    components: ScoreComponentResult[];
    /** The last 30 days that have a score, oldest first. */
    history: ScoreHistoryPointDto[];
  } | null;
}
