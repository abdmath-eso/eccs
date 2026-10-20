import { describe, expect, it } from "vitest";
import {
  callsDue,
  durationWords,
  isLive,
  isStuck,
  liveAt,
  onboardingDay,
  onboardingSteps,
  onboardingStrip,
  onNewOutletsTab,
  sortOnboardingCards,
  stillUsingAtDay10,
  type OnboardingFacts,
} from "./outlet-onboarding.js";

// Added on Monday 20 Oct 2026 at 10:00 India time (04:30 UTC).
const ADDED = "2026-10-20T04:30:00.000Z";

const empty = (): OnboardingFacts => ({
  addedAt: ADDED,
  code: "TEST-JH1A2B",
  addedBy: "Priya",
  owner: { firstLoginAt: null, hasPin: false },
  staffWithPin: [],
  people: [{ agreedAt: null }],
  licences: [],
  firstChecklist: null,
  entries: [],
});

const live = (): OnboardingFacts => ({
  ...empty(),
  owner: { firstLoginAt: "2026-10-20T06:00:00.000Z", hasPin: true },
  staffWithPin: [
    { role: "MANAGER", at: "2026-10-20T07:00:00.000Z" },
    { role: "HEAD_CHEF", at: "2026-10-20T07:10:00.000Z" },
  ],
  people: [{ agreedAt: "2026-10-20T06:01:00.000Z" }, { agreedAt: "2026-10-20T07:20:00.000Z" }, { agreedAt: "2026-10-20T07:30:00.000Z" }],
  licences: [
    { type: "FSSAI", copyAt: "2026-10-20T08:00:00.000Z", copyBy: "Owner" },
    { type: "FIRE_NOC", copyAt: "2026-10-20T08:05:00.000Z", copyBy: "Manager" },
  ],
  firstChecklist: { at: "2026-10-21T02:10:00.000Z", by: "Head Chef", name: "Opening checklist" },
});

const byKey = (facts: OnboardingFacts) => Object.fromEntries(onboardingSteps(facts).map((step) => [step.key, step]));

describe("onboardingSteps", () => {
  it("ticks only the first step for an outlet just added, and says what waits on the Owner", () => {
    const steps = onboardingSteps(empty());
    expect(steps.map((step) => step.number)).toEqual([1, 2, 3, 4, 5, 6, 7, 8, 9]);
    expect(steps.filter((step) => step.done).map((step) => step.key)).toEqual(["OUTLET_ADDED"]);
    expect(steps[0]).toMatchObject({ at: ADDED, by: "Priya", detail: "code TEST-JH1A2B" });
    const step = byKey(empty());
    expect(step.STAFF_PINS!.detail).toBe("waits on step 2");
    expect(step.FIRST_CHECKLIST!.detail).toBe("waits on step 2");
    expect(step.LICENCES!.detail).toBe("No licences yet");
  });

  it("needs the Owner's PIN and a login for step 2, and words an Owner who already had a login", () => {
    expect(byKey({ ...empty(), owner: { firstLoginAt: "2026-10-20T06:00:00.000Z", hasPin: false } }).OWNER_LOGIN!.done).toBe(false);
    expect(byKey({ ...empty(), owner: null }).OWNER_LOGIN!.detail).toBe("No Owner on the restaurant");
    const earlier = byKey({ ...empty(), owner: { firstLoginAt: "2026-09-01T06:00:00.000Z", hasPin: true } }).OWNER_LOGIN!;
    expect(earlier).toMatchObject({ done: true, at: ADDED, detail: "Owner already had a login" });
  });

  it("needs a Manager and a Head Chef for step 3, ticking when the second is added", () => {
    const one = byKey({ ...live(), staffWithPin: [{ role: "MANAGER", at: "2026-10-20T07:00:00.000Z" }, { role: "MANAGER", at: "2026-10-20T07:05:00.000Z" }] });
    expect(one.STAFF_PINS).toMatchObject({ done: false, detail: "1 of 2" });
    expect(byKey(live()).STAFF_PINS).toMatchObject({ done: true, detail: "2 of 2", at: "2026-10-20T07:10:00.000Z" });
  });

  it("counts people for the terms and privacy", () => {
    expect(byKey({ ...live(), people: [{ agreedAt: "2026-10-20T06:01:00.000Z" }, { agreedAt: null }] }).LEGAL).toMatchObject({ done: false, detail: "1 of 2 people" });
    expect(byKey(live()).LEGAL).toMatchObject({ done: true, detail: "3 of 3 people", at: "2026-10-20T07:30:00.000Z" });
  });

  it("needs a copy of every licence, and at least the FSSAI", () => {
    const noFssai = byKey({ ...live(), licences: [{ type: "FIRE_NOC", copyAt: "2026-10-20T08:05:00.000Z", copyBy: null }] });
    expect(noFssai.LICENCES).toMatchObject({ done: false, detail: "1 of 1 · no FSSAI licence yet" });
    const missing = byKey({ ...live(), licences: [{ type: "FSSAI", copyAt: null, copyBy: null }, { type: "FIRE_NOC", copyAt: "2026-10-20T08:05:00.000Z", copyBy: null }] });
    expect(missing.LICENCES).toMatchObject({ done: false, detail: "1 of 2 · FSSAI copy missing" });
    expect(byKey(live()).LICENCES).toMatchObject({ done: true, detail: "2 of 2", by: "Manager" });
  });

  it("ticks the calls and the posters from the latest entry of each kind, with their days", () => {
    const facts: OnboardingFacts = {
      ...live(),
      entries: [
        { id: "e1", kind: "DAY3_CALL", note: "first try", at: "2026-10-23T05:00:00.000Z", by: "Abdul" },
        { id: "e2", kind: "DAY3_CALL", note: "chef wants Telugu labels", at: "2026-10-23T06:00:00.000Z", by: "Abdul" },
        { id: "e3", kind: "NOTE", note: "Visit and set up in person", at: "2026-10-21T06:00:00.000Z", by: "Priya" },
      ],
    };
    const step = byKey(facts);
    expect(step.DAY3_CALL).toMatchObject({ done: true, entryId: "e2", detail: "chef wants Telugu labels", dueOn: "2026-10-23" });
    expect(step.POSTERS!.done).toBe(false);
    expect(step.DAY10_CALL).toMatchObject({ done: false, dueOn: "2026-10-30" });
  });
});

describe("live, stuck and the days", () => {
  it("is live when steps 1 to 6 are done, at the last of them", () => {
    const steps = onboardingSteps(live());
    expect(isLive(steps)).toBe(true);
    expect(liveAt(steps)).toBe("2026-10-21T02:10:00.000Z");
    expect(isLive(onboardingSteps(empty()))).toBe(false);
    expect(liveAt(onboardingSteps(empty()))).toBeNull();
  });

  it("is stuck once 24 hours pass without being live", () => {
    const steps = onboardingSteps(empty());
    expect(isStuck(steps, ADDED, "2026-10-21T04:29:00.000Z")).toBe(false);
    expect(isStuck(steps, ADDED, "2026-10-21T04:30:00.000Z")).toBe(true);
    expect(isStuck(onboardingSteps(live()), ADDED, "2026-10-25T00:00:00.000Z")).toBe(false);
  });

  it("counts India days from the day it was added, and keeps it on the tab until day 10", () => {
    expect(onboardingDay(ADDED, "2026-10-20T18:00:00.000Z")).toBe(0);
    // 19:00 UTC on the 20th is already the 21st in India.
    expect(onboardingDay(ADDED, "2026-10-20T19:00:00.000Z")).toBe(1);
    expect(onNewOutletsTab(ADDED, "2026-10-30T12:00:00.000Z")).toBe(true);
    expect(onNewOutletsTab(ADDED, "2026-10-31T12:00:00.000Z")).toBe(false);
  });

  it("lists a call from its day until a week late, unless logged", () => {
    const steps = onboardingSteps(live());
    expect(callsDue(steps, "2026-10-22T06:00:00.000Z")).toEqual([]);
    expect(callsDue(steps, "2026-10-23T06:00:00.000Z")).toEqual([{ kind: "DAY3_CALL", dueOn: "2026-10-23" }]);
    expect(callsDue(steps, "2026-10-30T06:00:00.000Z")).toEqual([
      { kind: "DAY3_CALL", dueOn: "2026-10-23" },
      { kind: "DAY10_CALL", dueOn: "2026-10-30" },
    ]);
    expect(callsDue(steps, "2026-10-31T06:00:00.000Z")).toEqual([{ kind: "DAY10_CALL", dueOn: "2026-10-30" }]);
    const called = onboardingSteps({ ...live(), entries: [{ id: "c", kind: "DAY3_CALL", note: null, at: "2026-10-23T06:00:00.000Z", by: null }] });
    expect(callsDue(called, "2026-10-23T08:00:00.000Z")).toEqual([]);
  });

  it("words a length of time", () => {
    expect(durationWords(18)).toBe("18 h");
    expect(durationWords(47)).toBe("47 h");
    expect(durationWords(75)).toBe("3 days");
  });
});

describe("still using the app at day 10", () => {
  it("needs a checklist on 4 of the 7 days up to day 10", () => {
    expect(stillUsingAtDay10(ADDED, ["2026-10-24", "2026-10-26", "2026-10-28", "2026-10-30"])).toBe(true);
    // Day 3 is before the window; the same day twice counts once.
    expect(stillUsingAtDay10(ADDED, ["2026-10-23", "2026-10-26", "2026-10-26", "2026-10-28", "2026-10-30"])).toBe(false);
  });
});

describe("onboardingStrip", () => {
  it("counts this month's outlets, the 24-hour mark, time to the first checklist and day-10 use", () => {
    const now = "2026-10-31T06:00:00.000Z";
    const strip = onboardingStrip(
      [
        // Live after 5 h, first checklist after 4 h.
        { addedAt: "2026-10-02T04:30:00.000Z", liveAt: "2026-10-02T09:30:00.000Z", firstChecklistAt: "2026-10-02T08:30:00.000Z", checklistDays: ["2026-10-06", "2026-10-07", "2026-10-08", "2026-10-10"] },
        // Live after 30 h, first checklist after 30 h.
        { addedAt: "2026-10-10T04:30:00.000Z", liveAt: "2026-10-11T10:30:00.000Z", firstChecklistAt: "2026-10-11T10:30:00.000Z", checklistDays: ["2026-10-15"] },
        // Not live, no checklist; added this month but day 10 not reached.
        { addedAt: "2026-10-28T04:30:00.000Z", liveAt: null, firstChecklistAt: null, checklistDays: [] },
        // Last month: not counted in this month's numbers, but its day 10 came within 30 days.
        { addedAt: "2026-09-25T04:30:00.000Z", liveAt: "2026-09-25T06:30:00.000Z", firstChecklistAt: "2026-09-25T06:00:00.000Z", checklistDays: ["2026-09-30", "2026-10-01", "2026-10-02", "2026-10-03", "2026-10-04"] },
      ],
      now,
    );
    expect(strip).toEqual({
      month: "2026-10",
      onboarded: 3,
      liveWithin24h: 1,
      firstChecklist: { medianHours: 17, bestHours: 4, worstHours: 30, counted: 2 },
      stillUsing: { yes: 2, of: 3 },
    });
    expect(onboardingStrip([], now).firstChecklist).toBeNull();
  });
});

describe("sortOnboardingCards", () => {
  it("puts stuck first (oldest first), then not live, then live (newest first)", () => {
    const cards = [
      { id: "live-old", stuck: false, live: true, addedAt: "2026-10-01" },
      { id: "stuck-new", stuck: true, live: false, addedAt: "2026-10-05" },
      { id: "fresh", stuck: false, live: false, addedAt: "2026-10-06" },
      { id: "stuck-old", stuck: true, live: false, addedAt: "2026-10-02" },
      { id: "live-new", stuck: false, live: true, addedAt: "2026-10-04" },
    ];
    expect(sortOnboardingCards(cards).map((card) => card.id)).toEqual(["stuck-old", "stuck-new", "fresh", "live-new", "live-old"]);
  });
});
