// The hygiene score: one number out of 100 per outlet, built from what the platform already records.
//
// The whole rule lives in this file, as `calculateScore`: it takes plain counts and
// returns the score together with every component's points and what cost points, so
// the apps can always show why the number is what it is. The server
// (apps/api/src/scores) only gathers the counts.
//
// How it works, in short (the numbered rule is on `calculateScore`; the founder set
// it on 7 Oct 2026):
// - Three components: the latest ECCS inspection (60 points), licences (10) and the
//   day's checklists (30). The first two change rarely; the checklists move the score
//   through every day.
// - Score = points earned ÷ points possible × 100.
// - An outlet ECCS has not inspected yet is scored on licences and checklists alone
//   and marked provisional, instead of being held at 40 for something ECCS has not done.

/** The parts of the score, in the order they are shown. */
export const SCORE_COMPONENTS = ["inspection", "licences", "checklists"] as const;
export type ScoreComponentKey = (typeof SCORE_COMPONENTS)[number];

/** How many points each component is worth. They add up to 100. Change the numbers here to retune the score. */
export const SCORE_WEIGHTS: Record<ScoreComponentKey, number> = {
  /** The latest approved ECCS inspection: an inspection with nothing wrong gives all 60. */
  inspection: 60,
  /** Licences in date, each with a copy on file. */
  licences: 10,
  /** The day's checklists: handed in, and handed in on time. */
  checklists: 30,
};

/** The settings of the rule other than the weights. */
export const SCORE_RULES = {
  /** A checklist handed in up to this many minutes after its due time still counts as on time. */
  onTimeGraceMinutes: 15,
  /** The share of its points a checklist keeps when it is handed in late. */
  lateChecklistCredit: 0.5,
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

/**
 * Which day's checklists are counted. Normally the day itself; until the first
 * checklist of the day has been handed in or has passed its due time, the day before.
 */
export type ScoreChecklistsDay = "TODAY" | "YESTERDAY";

/** The plain numbers the rule works from. The server counts them; see apps/api/src/scores. */
export interface ScoreInput {
  checklists: {
    day: ScoreChecklistsDay;
    /** Checklists of that day that have been handed in or have passed their due time. */
    due: number;
    /** Handed in by the due time (or with no due time at all). */
    onTime: number;
    /** Handed in after the due time. */
    late: number;
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
  "INSPECTION_NON_COMPLIANT", // count = checks not compliant at the latest inspection
  "LICENCES_EXPIRED", // count = expired licences
  "FSSAI_MISSING", // no FSSAI licence recorded
  "LICENCE_COPIES_MISSING", // count = licences in date with no copy on file
  "LICENCES_EXPIRING", // count = licences expiring soon; lost is always 0
  "CHECKLISTS_MISSED", // count = not handed in today, total = fell due today
  "CHECKLISTS_LATE", // count = handed in late today, total = fell due today
  "CHECKLISTS_MISSED_YESTERDAY", // the same two, when yesterday's checklists are the ones counted
  "CHECKLISTS_LATE_YESTERDAY",
] as const;
export type ScoreReasonCode = (typeof SCORE_REASONS)[number];

export interface ScoreReason {
  code: ScoreReasonCode;
  count: number;
  /** Out of how many, where that helps ("1 of 3"). */
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
  /** Whole number out of 100, or null while there is neither an inspection nor a checklist to go on. */
  score: number | null;
  band: ScoreBand | null;
  /** True when there is a score but no inspection in it. */
  provisional: boolean;
  /** Which day's checklists were counted; null when there were none. */
  checklistsDay: ScoreChecklistsDay | null;
  /** Points earned and points possible across the measured components (to one decimal place). */
  earned: number;
  possible: number;
  /** All three, in the order of SCORE_COMPONENTS. */
  components: ScoreComponentResult[];
}

const round1 = (value: number) => Math.round(value * 10) / 10;
const clamp01 = (value: number) => Math.min(1, Math.max(0, value));

/**
 * The rule.
 *
 * 1. Inspection (60): the overall score of the latest approved ECCS inspection carried
 *    out in the last 180 days, as a share of 60. An inspection with nothing wrong gives
 *    all 60. Not measured if there is none. A failed critical check lowers the
 *    inspection's own score but puts no further cap on this one.
 * 2. Licences (10): each licence in date with a copy on file counts 1, in date without
 *    a copy ½, expired 0; an outlet with no FSSAI licence recorded has one more
 *    licence counting 0. Points = 10 × the average. A licence expiring soon still
 *    counts in full.
 * 3. Checklists (30): the 30 points are shared equally among the day's checklists that
 *    have been handed in or have passed their due time. Handed in on time (15 minutes'
 *    grace): its full share. Handed in late: half. Not handed in: nothing. Until the
 *    first checklist of the day is handed in or falls due, the day before is used. Not
 *    measured if neither day has one.
 * 4. Score = points earned ÷ points possible × 100, rounded to a whole number, where
 *    "possible" adds up only the measured components.
 * 5. No inspection yet: the score comes from licences and checklists (out of 40,
 *    scaled to 100) and is marked provisional.
 * 6. No score at all (null) while there is neither an inspection nor a checklist to
 *    count: licences alone do not make a hygiene score.
 * 7. Band: Excellent from 88, Good from 80, Fair from 68, otherwise Needs attention.
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

  // 1. The latest inspection.
  const inspection = component("inspection", input.inspection ? input.inspection.score / 100 : null, [
    {
      code: "INSPECTION_NON_COMPLIANT",
      // A score under 100 always has a cause; say at least one even if the count was not passed on.
      count: input.inspection && input.inspection.score < 100 ? Math.max(input.inspection.nonCompliant, 1) : 0,
      share: input.inspection ? 1 - input.inspection.score / 100 : 0,
    },
  ]);

  // 2. Licences.
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

  // 3. The day's checklists.
  const { day, due } = input.checklists;
  const onTime = Math.min(input.checklists.onTime, due);
  const late = Math.min(input.checklists.late, due - onTime);
  const missed = due - onTime - late;
  const lateLoss = 1 - SCORE_RULES.lateChecklistCredit;
  const yesterday = day === "YESTERDAY";
  const checklists = component(
    "checklists",
    due > 0 ? (onTime + late * SCORE_RULES.lateChecklistCredit) / due : null,
    due > 0
      ? [
          { code: yesterday ? "CHECKLISTS_MISSED_YESTERDAY" : "CHECKLISTS_MISSED", count: missed, total: due, share: missed / due },
          { code: yesterday ? "CHECKLISTS_LATE_YESTERDAY" : "CHECKLISTS_LATE", count: late, total: due, share: (late * lateLoss) / due },
        ]
      : [],
  );

  // 4 to 7. Earned ÷ possible over what was measured.
  const all = [inspection, licences, checklists];
  const measured = all.filter((entry) => entry.measured);
  const possible = measured.reduce((total, entry) => total + entry.max, 0);
  const earned = measured.reduce((total, entry) => total + entry.exact, 0);
  const enough = inspection.measured || checklists.measured;
  const score = enough ? Math.round((earned / possible) * 100) : null;

  return {
    score,
    band: score === null ? null : scoreBand(score),
    provisional: score !== null && !inspection.measured,
    checklistsDay: checklists.measured ? day : null,
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
  version: 2;
  band: ScoreBand;
  earned: number;
  possible: number;
  components: ScoreComponentResult[];
}
export const SCORE_RULE_VERSION = 2;

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
  /**
   * True while ECCS has not inspected the outlet (or the last inspection is too old to
   * count): the score then comes from licences and checklists alone.
   */
  provisional: boolean;
  /** Which day's checklists the score is using; null when there are none to use. */
  checklistsDay: ScoreChecklistsDay | null;
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
