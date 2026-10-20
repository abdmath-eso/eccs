import { z } from "zod";
import { addDays, daysFrom, monthOf } from "./finance.js";
import { indiaDay } from "./food-labels.js";

// New outlets (20 Oct 2026; the console plan, docs/CONSOLE_PLAN.md section 4.6, and the
// founder's Onboarding page): each newly won outlet's first ten days, from "won" to
// "running on its own", in nine steps. Steps 1 to 6 tick themselves from what the apps
// already record; the API gathers those facts (apps/api/src/outlet-onboarding) and the
// rules below turn them into steps. Steps 7 to 9 are one tap each in the console.
//
// Pattern followed: B2B onboarding's milestone checklist with "time to first value"
// (the first checklist handed in) and stalled accounts flagged early for a person to act
// on, as onboarding guides describe it (Valuecase; customer-onboarding playbooks).

export const OUTLET_ONBOARDING_RULES = {
  /** An outlet is on the New outlets tab from the day it is added until this many days after. */
  days: 10,
  /** Not live this many hours after being added: "stuck", with "Act". */
  liveWithinHours: 24,
  /** The calls' days, counted from the day the outlet was added (that day is day 0). */
  day3CallDay: 3,
  day10CallDay: 10,
  /** A call not logged stays due for this many days after its day, then drops off Today. */
  callLateDays: 7,
  /** "Still using the app at day 10": a checklist handed in on at least `minDays` of the `lastDays` days up to day 10. */
  stillUsing: { lastDays: 7, minDays: 4 },
  noteMax: 300,
} as const;

/** The nine steps, in order. The first six tick themselves. */
export const ONBOARDING_STEPS = [
  "OUTLET_ADDED",
  "OWNER_LOGIN",
  "STAFF_PINS",
  "LEGAL",
  "LICENCES",
  "FIRST_CHECKLIST",
  "DAY3_CALL",
  "POSTERS",
  "DAY10_CALL",
] as const;
export type OnboardingStepKey = (typeof ONBOARDING_STEPS)[number];

/** Steps 1 to 6: done, the outlet is "live". */
export const SELF_TICKING_STEPS = ONBOARDING_STEPS.slice(0, 6);

export const ONBOARDING_STEP_TITLES: Record<OnboardingStepKey, string> = {
  OUTLET_ADDED: "Outlet added, with its code",
  OWNER_LOGIN: "Owner logged in, PIN set",
  STAFF_PINS: "Manager and Head Chef PINs",
  LEGAL: "Terms and privacy agreed",
  LICENCES: "Licences photographed",
  FIRST_CHECKLIST: "First checklist done with photos",
  DAY3_CALL: "Day-3 call",
  POSTERS: "QR posters delivered",
  DAY10_CALL: "Day-10 call and rating ask",
};

/** What a person logs in one tap. NOTE is a note on the outlet ("Visit and set up in person"). */
export const ONBOARDING_ENTRY_KINDS = ["DAY3_CALL", "POSTERS", "DAY10_CALL", "NOTE"] as const;
export type OnboardingEntryKind = (typeof ONBOARDING_ENTRY_KINDS)[number];

export const onboardingEntrySchema = z.object({
  kind: z.enum(ONBOARDING_ENTRY_KINDS),
  note: z.string().trim().max(OUTLET_ONBOARDING_RULES.noteMax).optional(),
});
export type OnboardingEntryInput = z.input<typeof onboardingEntrySchema>;

// ───────────────────────── The facts the steps are read from ─────────────────────────

/** A licence type as stored (LicenceType in the database). */
type LicenceKind = "FSSAI" | "FIRE_NOC" | "TRADE_LICENCE" | "PEST_CONTROL" | "OTHER";

export interface OnboardingEntryFact {
  id: string;
  kind: OnboardingEntryKind;
  note: string | null;
  at: string;
  by: string | null;
}

/** What the API gathers for one outlet from the records the apps already write. */
export interface OnboardingFacts {
  /** Outlet.createdAt. */
  addedAt: string;
  code: string;
  /** Who added it, where known. */
  addedBy: string | null;
  /** The restaurant's Owner (the first one): their first login (a session) and whether their PIN is set. Null with no Owner. */
  owner: { firstLoginAt: string | null; hasPin: boolean } | null;
  /** The outlet's Manager and Head Chef logins that have a PIN, with when they were added (their PIN is made then). */
  staffWithPin: { role: "MANAGER" | "HEAD_CHEF"; at: string }[];
  /** Everyone who must agree to the terms and privacy for this outlet (the Owner, its Managers and Head Chefs): when they last agreed, or null while something is pending. */
  people: { agreedAt: string | null }[];
  /** The outlet's licences: when a copy was filed (null with no copy) and by whom. */
  licences: { type: LicenceKind; copyAt: string | null; copyBy: string | null }[];
  /** The first checklist handed in with at least one proof photo. */
  firstChecklist: { at: string; by: string | null; name: string | null } | null;
  /** The one-tap entries, any order. */
  entries: OnboardingEntryFact[];
}

export interface OnboardingStepDto {
  key: OnboardingStepKey;
  /** 1 to 9. */
  number: number;
  title: string;
  done: boolean;
  /** When it ticked, where known. */
  at: string | null;
  /** Who did it, where known. */
  by: string | null;
  /** A few words: "2 of 2", "code SPICE-JH2K7M", the call's note, "waits on step 2". */
  detail: string | null;
  /** For the calls: the India day it is due on. */
  dueOn: string | null;
  /** The entry that ticked it (steps 7 to 9), so it can be undone. */
  entryId: string | null;
}

const latest = (values: readonly (string | null)[]): string | null =>
  values.reduce<string | null>((most, value) => (value && (!most || value > most) ? value : most), null);

/** The nine steps of one outlet from its facts. Pure: the same facts always give the same steps. */
export function onboardingSteps(facts: OnboardingFacts): OnboardingStepDto[] {
  const step = (key: OnboardingStepKey, done: boolean, rest: Partial<Omit<OnboardingStepDto, "key" | "number" | "title" | "done">> = {}): OnboardingStepDto => ({
    key,
    number: ONBOARDING_STEPS.indexOf(key) + 1,
    title: ONBOARDING_STEP_TITLES[key],
    done,
    at: null,
    by: null,
    detail: null,
    dueOn: null,
    entryId: null,
    ...rest,
  });
  const addedDay = indiaDay(facts.addedAt);
  const ownerDone = Boolean(facts.owner?.hasPin && facts.owner.firstLoginAt);
  const waitsOnOwner = ownerDone ? null : "waits on step 2";

  // 2: an Owner who logged in before this outlet was added already had a login.
  const ownerAt = facts.owner?.firstLoginAt ?? null;
  const ownerStep = !facts.owner
    ? step("OWNER_LOGIN", false, { detail: "No Owner on the restaurant" })
    : ownerDone && ownerAt
      ? step("OWNER_LOGIN", true, ownerAt < facts.addedAt ? { at: facts.addedAt, detail: "Owner already had a login" } : { at: ownerAt })
      : step("OWNER_LOGIN", false, { detail: "The Owner has not logged in yet" });

  // 3: one Manager and one Head Chef with a PIN; the step ticks when the second of the two is added.
  const firstOf = (role: "MANAGER" | "HEAD_CHEF") =>
    facts.staffWithPin.filter((person) => person.role === role).reduce<string | null>((first, person) => (!first || person.at < first ? person.at : first), null);
  const roleTimes = [firstOf("MANAGER"), firstOf("HEAD_CHEF")];
  const rolesDone = roleTimes.filter(Boolean).length;
  const staffStep = step("STAFF_PINS", rolesDone === 2, {
    at: rolesDone === 2 ? latest(roleTimes) : null,
    detail: rolesDone === 2 ? "2 of 2" : (waitsOnOwner ?? `${rolesDone} of 2`),
  });

  // 4: everyone at the outlet who must agree has agreed to the current versions.
  const agreed = facts.people.filter((person) => person.agreedAt).length;
  const legalDone = facts.people.length > 0 && agreed === facts.people.length;
  const legalStep = step("LEGAL", legalDone, {
    at: legalDone ? latest(facts.people.map((person) => person.agreedAt)) : null,
    detail: facts.people.length === 0 ? null : !legalDone && agreed === 0 && waitsOnOwner ? waitsOnOwner : `${agreed} of ${facts.people.length} ${facts.people.length === 1 ? "person" : "people"}`,
  });

  // 5: every licence the outlet has carries a copy, and there is at least the FSSAI.
  const withCopy = facts.licences.filter((licence) => licence.copyAt);
  const hasFssai = facts.licences.some((licence) => licence.type === "FSSAI" && licence.copyAt);
  const licencesDone = facts.licences.length > 0 && withCopy.length === facts.licences.length && hasFssai;
  const lastCopy = withCopy.reduce<(typeof withCopy)[number] | null>((most, licence) => (!most || (licence.copyAt ?? "") > (most.copyAt ?? "") ? licence : most), null);
  const licenceStep = step("LICENCES", licencesDone, {
    at: licencesDone ? (lastCopy?.copyAt ?? null) : null,
    by: licencesDone ? (lastCopy?.copyBy ?? null) : null,
    detail:
      facts.licences.length === 0
        ? "No licences yet"
        : `${withCopy.length} of ${facts.licences.length}${hasFssai ? "" : facts.licences.some((licence) => licence.type === "FSSAI") ? " · FSSAI copy missing" : " · no FSSAI licence yet"}`,
  });

  const checklist = facts.firstChecklist;
  const checklistStep = checklist
    ? step("FIRST_CHECKLIST", true, { at: checklist.at, by: checklist.by, detail: checklist.name })
    : step("FIRST_CHECKLIST", false, { detail: waitsOnOwner });

  // 7 to 9: the latest entry of each kind ticks the step.
  const entryStep = (key: "DAY3_CALL" | "POSTERS" | "DAY10_CALL", dueOn: string | null) => {
    const entry = facts.entries
      .filter((candidate) => candidate.kind === key)
      .reduce<OnboardingEntryFact | null>((most, candidate) => (!most || candidate.at > most.at ? candidate : most), null);
    return entry ? step(key, true, { at: entry.at, by: entry.by, detail: entry.note, entryId: entry.id, dueOn }) : step(key, false, { dueOn });
  };

  return [
    step("OUTLET_ADDED", true, { at: facts.addedAt, by: facts.addedBy, detail: `code ${facts.code}` }),
    ownerStep,
    staffStep,
    legalStep,
    licenceStep,
    checklistStep,
    entryStep("DAY3_CALL", addDays(addedDay, OUTLET_ONBOARDING_RULES.day3CallDay)),
    entryStep("POSTERS", null),
    entryStep("DAY10_CALL", addDays(addedDay, OUTLET_ONBOARDING_RULES.day10CallDay)),
  ];
}

// ───────────────────────── Live, stuck, the days ─────────────────────────

/** Days since the outlet was added, in India: 0 on the day itself. */
export const onboardingDay = (addedAt: string, now: Date | string) => daysFrom(indiaDay(addedAt), indiaDay(now));

/** Shown on the New outlets tab: from the day it is added until day 10; after that it is an ordinary row on Health. */
export const onNewOutletsTab = (addedAt: string, now: Date | string) => {
  const day = onboardingDay(addedAt, now);
  return day >= 0 && day <= OUTLET_ONBOARDING_RULES.days;
};

/** Live: steps 1 to 6 are done. */
export const isLive = (steps: readonly OnboardingStepDto[]) =>
  SELF_TICKING_STEPS.every((key) => steps.find((candidate) => candidate.key === key)?.done === true);

/** When it went live: the last of steps 1 to 6 to tick. Null while not live. */
export const liveAt = (steps: readonly OnboardingStepDto[]) =>
  isLive(steps) ? latest(steps.filter((candidate) => (SELF_TICKING_STEPS as readonly string[]).includes(candidate.key)).map((candidate) => candidate.at)) : null;

const HOUR_MS = 3_600_000;
export const hoursBetween = (from: string, to: Date | string) => Math.max(0, Math.floor((new Date(to).getTime() - new Date(from).getTime()) / HOUR_MS));

/** Not live 24 hours after being added. */
export const isStuck = (steps: readonly OnboardingStepDto[], addedAt: string, now: Date | string) =>
  !isLive(steps) && hoursBetween(addedAt, now) >= OUTLET_ONBOARDING_RULES.liveWithinHours;

/** A length of time in a few words: "18 h" under two days, then "3 days". */
export function durationWords(hours: number): string {
  if (hours < 48) return `${hours} h`;
  return `${Math.floor(hours / 24)} days`;
}

export interface OnboardingCallDue {
  kind: "DAY3_CALL" | "DAY10_CALL";
  dueOn: string;
}

/** The calls due today or late (up to a week), not yet logged. */
export function callsDue(steps: readonly OnboardingStepDto[], now: Date | string): OnboardingCallDue[] {
  const today = indiaDay(now);
  const due: OnboardingCallDue[] = [];
  for (const key of ["DAY3_CALL", "DAY10_CALL"] as const) {
    const found = steps.find((candidate) => candidate.key === key);
    if (!found || found.done || !found.dueOn) continue;
    const late = daysFrom(found.dueOn, today);
    if (late >= 0 && late <= OUTLET_ONBOARDING_RULES.callLateDays) due.push({ kind: key, dueOn: found.dueOn });
  }
  return due;
}

/**
 * Still using the app at day 10: a checklist handed in on at least 4 of the 7 days up to
 * day 10 (days 4 to 10). `checklistDays` are the India days with a checklist handed in.
 */
export function stillUsingAtDay10(addedAt: string, checklistDays: readonly string[]): boolean {
  const { lastDays, minDays } = OUTLET_ONBOARDING_RULES.stillUsing;
  const last = addDays(indiaDay(addedAt), OUTLET_ONBOARDING_RULES.days);
  const first = addDays(last, -(lastDays - 1));
  return new Set(checklistDays.filter((day) => day >= first && day <= last)).size >= minDays;
}

// ───────────────────────── The strip ─────────────────────────

/** One onboarded outlet, as the strip counts it. */
export interface OnboardingStripRow {
  addedAt: string;
  liveAt: string | null;
  firstChecklistAt: string | null;
  checklistDays: readonly string[];
}

export interface OnboardingStripDto {
  /** The India month counted ("2026-10"). */
  month: string;
  /** Outlets added this month with an onboarding. */
  onboarded: number;
  /** Of those, live within 24 hours of being added. */
  liveWithin24h: number;
  /** Hours from being added to the first checklist with photos, over this month's outlets that have one. Null with none. */
  firstChecklist: { medianHours: number; bestHours: number; worstHours: number; counted: number } | null;
  /** Of the outlets whose day 10 came in the last 30 days, how many were still using the app (stillUsingAtDay10). */
  stillUsing: { yes: number; of: number };
}

const median = (values: readonly number[]) => {
  const sorted = [...values].sort((a, b) => a - b);
  const middle = Math.floor(sorted.length / 2);
  return sorted.length % 2 === 1 ? sorted[middle]! : Math.round((sorted[middle - 1]! + sorted[middle]!) / 2);
};

/** The one line of numbers above the cards: "time to first value", the usual onboarding measure. */
export function onboardingStrip(rows: readonly OnboardingStripRow[], now: Date | string): OnboardingStripDto {
  const today = indiaDay(now);
  const month = monthOf(today);
  const thisMonth = rows.filter((row) => monthOf(indiaDay(row.addedAt)) === month);
  const hoursToFirst = thisMonth.filter((row) => row.firstChecklistAt).map((row) => hoursBetween(row.addedAt, row.firstChecklistAt!));
  const reachedDay10 = rows.filter((row) => {
    const day10 = addDays(indiaDay(row.addedAt), OUTLET_ONBOARDING_RULES.days);
    return day10 <= today && daysFrom(day10, today) < 30;
  });
  return {
    month,
    onboarded: thisMonth.length,
    liveWithin24h: thisMonth.filter((row) => row.liveAt && hoursBetween(row.addedAt, row.liveAt) < OUTLET_ONBOARDING_RULES.liveWithinHours).length,
    firstChecklist:
      hoursToFirst.length === 0
        ? null
        : { medianHours: median(hoursToFirst), bestHours: Math.min(...hoursToFirst), worstHours: Math.max(...hoursToFirst), counted: hoursToFirst.length },
    stillUsing: { yes: reachedDay10.filter((row) => stillUsingAtDay10(row.addedAt, row.checklistDays)).length, of: reachedDay10.length },
  };
}

// ───────────────────────── What the API sends ─────────────────────────

export interface OutletOnboardingCardDto {
  outletId: string;
  outletName: string;
  organizationName: string;
  /** The part of the city, when set. */
  area: string | null;
  addedAt: string;
  /** Days since it was added (0 on the day itself). */
  day: number;
  /** Who won it in Sales and when, when the client came from a lead. */
  wonBy: { name: string; on: string } | null;
  /** The outlet's plan, when it has one. */
  planName: string | null;
  steps: OnboardingStepDto[];
  stepsDone: number;
  live: boolean;
  /** Hours from being added to going live; null while not live. */
  liveAfterHours: number | null;
  hoursSinceAdded: number;
  /** Not live 24 hours after being added: show "Act". */
  stuck: boolean;
  /** For "Call the Owner". */
  owner: { name: string; phone: string | null } | null;
  /** Notes logged on it ("Visit and set up in person"), newest first. */
  notes: { id: string; note: string | null; at: string; by: string | null }[];
}

export interface OutletOnboardingBoardDto {
  /** India date. */
  today: string;
  /** Outlets in their first ten days, the stuck ones first, then the newest. */
  cards: OutletOnboardingCardDto[];
  strip: OnboardingStripDto;
  /** Outlets under ten days old that have no onboarding yet: offered "Start onboarding". */
  toStart: { outletId: string; outletName: string; organizationName: string; addedAt: string }[];
}

/** For the Today page (step 2): what needs someone now. */
export interface OutletOnboardingAttentionDto {
  stuck: { outletId: string; outletName: string; organizationName: string; hoursSinceAdded: number }[];
  calls: { outletId: string; outletName: string; organizationName: string; kind: "DAY3_CALL" | "DAY10_CALL"; dueOn: string }[];
}

/** Puts the cards in order: stuck first (longest waiting first), then not live, then live, newest first within each. */
export function sortOnboardingCards<T extends Pick<OutletOnboardingCardDto, "stuck" | "live" | "addedAt">>(cards: readonly T[]): T[] {
  const rank = (card: T) => (card.stuck ? 0 : card.live ? 2 : 1);
  return [...cards].sort((a, b) => rank(a) - rank(b) || (a.stuck ? a.addedAt.localeCompare(b.addedAt) : b.addedAt.localeCompare(a.addedAt)));
}
