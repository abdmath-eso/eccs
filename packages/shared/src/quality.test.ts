import { describe, expect, it } from "vitest";
import {
  followUpReason,
  followUpStanding,
  inspectionCause,
  issueReopenedCause,
  qualityHeadline,
  qualityStrip,
  ratingCause,
  scoreDropCauses,
  sortFollowUps,
  type QualityMonthFacts,
} from "./quality.js";

const signOff = (rating: number | null, comment: string | null = null) => ({
  jobId: "visit-1",
  outletId: "outlet-1",
  rating,
  comment,
  signedAt: "2026-10-19T10:00:00.000Z",
  visitDate: "2026-10-19",
  serviceName: "Kitchen deep clean",
});

describe("the follow-up causes", () => {
  it("brings in a visit rated 3 stars or fewer, once per visit", () => {
    expect(ratingCause(signOff(2, " crew left early "))).toMatchObject({
      causeKey: "RATING:visit-1",
      facts: { cause: "RATING", stars: 2, comment: "crew left early" },
    });
    expect(ratingCause(signOff(3))?.causeKey).toBe("RATING:visit-1");
    expect(ratingCause(signOff(4))).toBeNull();
    expect(ratingCause(signOff(null))).toBeNull();
  });

  it("brings in an issue each time it is reopened", () => {
    const issue = { id: "issue-1", outletId: "o", reference: "ECCS-0042", title: "Rats again", reopenedAt: "2026-10-19T10:00:00.000Z", reopenCount: 1 };
    expect(issueReopenedCause(issue)?.causeKey).toBe("ISSUE_REOPENED:issue-1:1");
    expect(issueReopenedCause({ ...issue, reopenCount: 2 })?.causeKey).toBe("ISSUE_REOPENED:issue-1:2");
    expect(issueReopenedCause({ ...issue, reopenedAt: null, reopenCount: 0 })).toBeNull();
  });

  it("brings in an approved inspection with no grade, and only once approved", () => {
    const inspection = {
      id: "i1",
      outletId: "o",
      grade: "NON_COMPLIANT",
      approvedAt: "2026-10-19T10:00:00.000Z",
      conductedOn: "2026-10-18",
      score: 61.4,
      criticalFailed: 1,
      reportNumber: "IR-1",
    };
    expect(inspectionCause(inspection)).toMatchObject({ causeKey: "INSPECTION:i1", facts: { score: 61, criticalFailed: 1 } });
    expect(inspectionCause({ ...inspection, grade: "B" })).toBeNull();
    expect(inspectionCause({ ...inspection, approvedAt: null })).toBeNull();
  });

  it("finds a fall of 15 points in a week once per high point, however long the score stays down", () => {
    const drops = scoreDropCauses("o", [
      { date: "2026-10-10", score: 80 },
      { date: "2026-10-12", score: 78 },
      { date: "2026-10-14", score: 64 },
      { date: "2026-10-15", score: 63 },
      { date: "2026-10-16", score: 64 },
    ]);
    expect(drops).toHaveLength(1);
    expect(drops[0]).toMatchObject({ causeKey: "SCORE_DROP:o:2026-10-10", facts: { from: 80, to: 64, fromDate: "2026-10-10", toDate: "2026-10-14" } });
  });

  it("does not count a fall of 14 points, or one over more than a week", () => {
    expect(
      scoreDropCauses("o", [
        { date: "2026-10-10", score: 80 },
        { date: "2026-10-12", score: 66 },
      ]),
    ).toEqual([]);
    expect(
      scoreDropCauses("o", [
        { date: "2026-10-01", score: 90 },
        { date: "2026-10-09", score: 70 },
      ]),
    ).toEqual([]);
  });

  it("puts each cause in plain words", () => {
    expect(followUpReason({ cause: "RATING", visitDate: "2026-10-19", serviceName: "Kitchen deep clean", stars: 2, comment: "floor still wet" })).toBe(
      'Kitchen deep clean on 19 Oct rated 2 stars: "floor still wet"',
    );
    expect(followUpReason({ cause: "SCORE_DROP", from: 80, to: 64, fromDate: "2026-10-10", toDate: "2026-10-14" })).toBe(
      "Hygiene score fell 16 points in a week: 80 on 10 Oct, 64 on 14 Oct",
    );
    expect(followUpReason({ cause: "INSPECTION", inspectionDate: "2026-10-18", score: 61, criticalFailed: 1, reportNumber: null })).toBe(
      "Inspection on 18 Oct: 1 critical check failed, no grade (score 61)",
    );
    expect(followUpReason({ cause: "ISSUE_REOPENED", reference: "ECCS-0042", title: "Rats again", times: 2 })).toBe("Issue ECCS-0042 reopened (twice): Rats again");
  });
});

describe("where a follow-up stands", () => {
  it("is not booked until a free visit is in the diary, and leaves once it is done or closed", () => {
    expect(followUpStanding("OPEN", null)).toEqual({ standing: "NOT_BOOKED", words: "Not booked" });
    expect(followUpStanding("OPEN", { date: "2026-10-23", slot: "1400", status: "ASSIGNED" })).toEqual({ standing: "BOOKED", words: "Booked Fri, 23 Oct, 2 pm" });
    expect(followUpStanding("OPEN", { date: "2026-10-23", slot: "1400", status: "CANCELLED" }).standing).toBe("NOT_BOOKED");
    expect(followUpStanding("OPEN", { date: "2026-10-23", slot: "1400", status: "COMPLETED" }).standing).toBe("DONE");
    expect(followUpStanding("CLOSED", null).standing).toBe("CLOSED");
  });

  it("lists what needs the office first, the longest waiting first", () => {
    const rows = sortFollowUps([
      { id: "booked", standing: "BOOKED" as const, causedAt: "2026-10-10T00:00:00Z" },
      { id: "new", standing: "NOT_BOOKED" as const, causedAt: "2026-10-19T00:00:00Z" },
      { id: "old", standing: "NOT_BOOKED" as const, causedAt: "2026-10-12T00:00:00Z" },
    ]);
    expect(rows.map((row) => row.id)).toEqual(["old", "new", "booked"]);
  });
});

describe("the page's headline and the month strip", () => {
  it("says what waits, or that nothing does", () => {
    expect(qualityHeadline({ followUpKitchens: 3, photos: 2, incidents: 1 })).toBe("3 kitchens need a follow-up. 2 photos to review. 1 incident open.");
    expect(qualityHeadline({ followUpKitchens: 1, photos: 0, incidents: 0 })).toBe("1 kitchen needs a follow-up.");
    expect(qualityHeadline({ followUpKitchens: 0, photos: 0, incidents: 0 })).toBe("Nothing is waiting in Quality.");
  });

  it("gives the month's four figures", () => {
    const facts: QualityMonthFacts = {
      month: "2026-10",
      signedOff: 24,
      rated: 18,
      starsTotal: 79,
      lowRated: 2,
      reportsApproved: 25,
      reportsFirstTime: 24,
      followUpsIn: 14,
      followUpsClosed: 11,
      followUpsOpen: 3,
      incidents: 3,
      incidentsOpen: 1,
      incidentCostPaise: 120_000,
    };
    expect(qualityStrip(facts).map((tile) => [tile.label, tile.value, tile.detail])).toEqual([
      ["Visits rated this month", "18 of 24", "average 4.4 · 2 rated 3 or below"],
      ["Reports approved first time", "96%", "24 of 25 · 1 sent back first"],
      ["Follow-ups closed this month", "11", "14 came in · 3 still open"],
      ["Incidents this month", "3", "1 open · ₹1,200 paid out"],
    ]);
  });

  it("says plainly when there is nothing yet", () => {
    const none = qualityStrip({
      month: "2026-10",
      signedOff: 0,
      rated: 0,
      starsTotal: 0,
      lowRated: 0,
      reportsApproved: 0,
      reportsFirstTime: 0,
      followUpsIn: 0,
      followUpsClosed: 0,
      followUpsOpen: 0,
      incidents: 0,
      incidentsOpen: 0,
      incidentCostPaise: 0,
    });
    expect(none[0]).toMatchObject({ value: "None yet", detail: "no visit signed off yet" });
    expect(none[3]).toMatchObject({ value: "0", detail: "0 open" });
  });
});
