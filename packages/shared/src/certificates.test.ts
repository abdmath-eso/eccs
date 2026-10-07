import { describe, expect, it } from "vitest";
import { certificateValidity, certificateValidUntil, certificateWarningDays } from "./certificates.js";

describe("certificateValidUntil", () => {
  it("adds the days the certificate lasts to the day of the visit", () => {
    expect(certificateValidUntil("2026-10-01", 15)).toBe("2026-10-16");
    expect(certificateValidUntil("2026-10-07", 30)).toBe("2026-11-06");
    expect(certificateValidUntil("2026-10-07", 90)).toBe("2027-01-05");
  });

  it("crosses the end of a month, a year and a leap day", () => {
    expect(certificateValidUntil("2026-12-25", 15)).toBe("2027-01-09");
    expect(certificateValidUntil("2028-02-20", 15)).toBe("2028-03-06");
  });
});

describe("certificateWarningDays", () => {
  it("is the last fifth of the certificate's life", () => {
    expect(certificateWarningDays("2026-10-01", certificateValidUntil("2026-10-01", 15))).toBe(3);
    expect(certificateWarningDays("2026-10-01", certificateValidUntil("2026-10-01", 30))).toBe(6);
    expect(certificateWarningDays("2026-10-01", certificateValidUntil("2026-10-01", 90))).toBe(18);
  });

  it("is never under 3 days or over 30", () => {
    expect(certificateWarningDays("2026-10-01", certificateValidUntil("2026-10-01", 5))).toBe(3);
    expect(certificateWarningDays("2026-10-01", certificateValidUntil("2026-10-01", 365))).toBe(30);
    // Dates the wrong way round are treated as no life at all, not as a negative one.
    expect(certificateWarningDays("2026-10-10", "2026-10-01")).toBe(3);
  });
});

describe("certificateValidity", () => {
  // A 30-day certificate: valid 1 to 31 October, with a warning over its last 6 days.
  const from = "2026-10-01";
  const until = certificateValidUntil(from, 30);
  const on = (today: string) => certificateValidity(from, until, today);

  it("is valid from the day of the visit", () => {
    expect(until).toBe("2026-10-31");
    expect(on("2026-10-01")).toEqual({ state: "VALID", daysLeft: 30 });
    expect(on("2026-10-24")).toEqual({ state: "VALID", daysLeft: 7 });
  });

  it("is expiring soon over its last days, the last day included", () => {
    expect(on("2026-10-25")).toEqual({ state: "EXPIRING", daysLeft: 6 });
    expect(on("2026-10-31")).toEqual({ state: "EXPIRING", daysLeft: 0 });
  });

  it("is expired from the day after its last day", () => {
    expect(on("2026-11-01")).toEqual({ state: "EXPIRED", daysLeft: -1 });
    expect(on("2027-10-31")).toEqual({ state: "EXPIRED", daysLeft: -365 });
  });

  it("counts a certificate looked at before its first day as valid", () => {
    expect(on("2026-09-30")).toEqual({ state: "VALID", daysLeft: 31 });
  });
});
