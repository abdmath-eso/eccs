// A visit task that records a number instead of a tick: a meter reading taken
// on site, judged against a limit. Today there is one use: the frying oil
// test, where the reading is the oil's total polar compounds in percent and
// the limit is FSSAI's 25%.
//
// The rule lives here so the server, the console, the app (also when it has no
// signal) and the PDF all give the same verdict for the same number.

/** A reading is a percentage for now: nothing below 0 or above 100 is accepted. */
export const READING_MIN = 0;
export const READING_MAX = 100;

/**
 * FSSAI's limit for total polar compounds in frying oil, in percent: oil with
 * "more than 25%" must not be used (Licensing and Registration regulations,
 * first amendment of 2017). So exactly 25 is still within the law.
 */
export const OIL_TPC_LIMIT_PERCENT = 25;

/**
 * From this share of the limit upwards a reading is "close to the limit": 20%
 * for the oil test. A sample threshold chosen by Claude, in line with the amber
 * band oil meters show before their red one; the founder may change it.
 */
export const READING_CLOSE_FROM = 0.8;

export const READING_VERDICTS = ["WITHIN", "CLOSE", "OVER"] as const;
export type ReadingVerdict = (typeof READING_VERDICTS)[number];

/** True for a number a reading box accepts: 0 to 100, at most one decimal place. */
export function isValidReading(value: number): boolean {
  // Compared with a small allowance: 24.9 × 10 is 249.00000000000003 in a computer's arithmetic.
  return Number.isFinite(value) && value >= READING_MIN && value <= READING_MAX && Math.abs(value * 10 - Math.round(value * 10)) < 1e-6;
}

/**
 * How a reading stands against its limit. OVER is strictly more than the
 * limit; CLOSE is from four fifths of the limit up to and including the limit
 * itself; anything lower is WITHIN. Null when there is no reading or no limit.
 */
export function readingVerdict(value: number | null | undefined, limit: number | null | undefined): ReadingVerdict | null {
  if (value == null || limit == null || !Number.isFinite(value) || !Number.isFinite(limit)) return null;
  if (value > limit) return "OVER";
  if (value >= limit * READING_CLOSE_FROM) return "CLOSE";
  return "WITHIN";
}

/** The verdict in plain English, for the PDF and the console (the app words it through its own dictionary). */
export const READING_VERDICT_ENGLISH: Record<ReadingVerdict, string> = {
  WITHIN: "Within the limit",
  CLOSE: "Close to the limit",
  OVER: "Over the limit: change the oil",
};

/** A reading written out: at most one decimal, no trailing ".0". */
export function formatReading(value: number): string {
  return String(Math.round(value * 10) / 10);
}
