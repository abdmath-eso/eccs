import { describe, expect, it } from "vitest";
import { formatReading, isValidReading, OIL_TPC_LIMIT_PERCENT, readingVerdict } from "./readings.js";

describe("readingVerdict", () => {
  const verdict = (value: number) => readingVerdict(value, OIL_TPC_LIMIT_PERCENT);

  it("is within the limit well below it", () => {
    expect(verdict(0)).toBe("WITHIN");
    expect(verdict(12.5)).toBe("WITHIN");
    expect(verdict(19.9)).toBe("WITHIN");
  });

  it("is close to the limit from four fifths of it, up to and including the limit", () => {
    expect(verdict(20)).toBe("CLOSE");
    expect(verdict(24.9)).toBe("CLOSE");
    // FSSAI: "more than 25%" must not be used, so exactly 25 is not yet over.
    expect(verdict(25)).toBe("CLOSE");
  });

  it("is over the limit only above it", () => {
    expect(verdict(25.1)).toBe("OVER");
    expect(verdict(40)).toBe("OVER");
  });

  it("gives no verdict without a reading or without a limit", () => {
    expect(readingVerdict(null, 25)).toBeNull();
    expect(readingVerdict(undefined, 25)).toBeNull();
    expect(readingVerdict(12, null)).toBeNull();
    expect(readingVerdict(Number.NaN, 25)).toBeNull();
  });
});

describe("isValidReading", () => {
  it("accepts 0 to 100 with at most one decimal", () => {
    expect(isValidReading(0)).toBe(true);
    expect(isValidReading(24.9)).toBe(true);
    expect(isValidReading(100)).toBe(true);
  });

  it("refuses anything else", () => {
    expect(isValidReading(-1)).toBe(false);
    expect(isValidReading(100.1)).toBe(false);
    expect(isValidReading(24.95)).toBe(false);
    expect(isValidReading(Number.NaN)).toBe(false);
    expect(isValidReading(Number.POSITIVE_INFINITY)).toBe(false);
  });
});

describe("formatReading", () => {
  it("drops a trailing .0 and keeps one decimal", () => {
    expect(formatReading(25)).toBe("25");
    expect(formatReading(24.9)).toBe("24.9");
  });
});
