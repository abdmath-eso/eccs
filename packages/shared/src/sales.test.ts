import { describe, expect, it } from "vitest";
import { FREE_CHECK_POINTS } from "./free-check.js";
import { roleCan } from "./permissions.js";
import {
  loseSchema,
  parkSchema,
  closeScore,
  closeTitle,
  closeWords,
  clockWords,
  conversionRates,
  doToday,
  doTodayFor,
  freeCheckPicks,
  mayMarkQuote,
  quoteDeclinedSchema,
  quoteFollowUp,
  quoteListQuerySchema,
  quoteRowAction,
  quoteState,
  expectedSoFar,
  forecastEnd,
  indiaClock,
  indiaMoment,
  isLinkPreviewAgent,
  leadSchema,
  likelyToClose,
  monthlyPaise,
  moveForward,
  nextWeekForecast,
  paceForecast,
  quoteMessage,
  quoteSchema,
  quoteTotals,
  quoteWhatsappUrl,
  recentDay,
  salesScope,
  staleness,
  STEP_STAGE,
  stepSchema,
  suggestedTarget,
  targetSchema,
  targetStatus,
  weeklyTargets,
  weekNumber,
  weekStartOf,
  workingDaysGone,
  type LeadFacts,
} from "./sales.js";

// "Now" is Thursday 26 November 2026, nine in the morning in India: week 4 of the
// founder's design, whose Do today and "What the app found" these tests rebuild.
const NOW = indiaMoment("2026-11-26", "09:00");
const at = (date: string, time = "10:00") => indiaMoment(date, time).toISOString();

function lead(over: Partial<LeadFacts> = {}): LeadFacts {
  return {
    id: "lead-1",
    name: "Mehfil Biryani",
    ownerId: "imran",
    stage: "CONTACTED",
    status: "OPEN",
    kitchens: 1,
    area: "Tolichowki",
    hasPhone: true,
    createdAt: at("2026-11-10"),
    lastActivityAt: at("2026-11-25"),
    nextAction: null,
    nextActionAt: null,
    parkedAt: null,
    parkedUntil: null,
    parkedReason: null,
    checkAt: null,
    checkWith: null,
    checkDoneAt: null,
    checkFindings: null,
    wonAt: null,
    planAt: null,
    lastContactAt: null,
    quote: null,
    askedQuote: false,
    askedMonthlyPrice: false,
    firstJob: null,
    onPlan: null,
    client: null,
    nearPlanCustomer: null,
    suggestedPlan: null,
    ...over,
  };
}

const quote = (over: Partial<NonNullable<LeadFacts["quote"]>> = {}): NonNullable<LeadFacts["quote"]> => ({
  totalPaise: 850_000,
  sentAt: at("2026-11-21"),
  openCount: 0,
  firstOpenedAt: null,
  lastOpenedAt: null,
  hasPlan: false,
  ...over,
});

const one = (memberships: { role: Parameters<typeof roleCan>[0] }[]) => memberships.map((m) => ({ ...m, organizationId: null, outletId: null }));

describe("who reaches which leads", () => {
  it("gives the Super Admin and the Ops Manager every lead, a BDE their own, and nobody else any", () => {
    expect(salesScope(one([{ role: "SUPER_ADMIN" }]))).toEqual({ kind: "all" });
    expect(salesScope(one([{ role: "OPS_MANAGER" }]))).toEqual({ kind: "all" });
    expect(salesScope(one([{ role: "BDE" }]))).toEqual({ kind: "own" });
    expect(salesScope(one([{ role: "SUPERVISOR" }]))).toBeNull();
    expect(salesScope(one([{ role: "OWNER" }]))).toBeNull();
  });

  it("lets a BDE read, add and change leads and nothing else; only the Super Admin sets targets", () => {
    expect(roleCan("BDE", "sales", "read")).toBe(true);
    expect(roleCan("BDE", "sales", "create")).toBe(true);
    expect(roleCan("BDE", "sales", "update")).toBe(true);
    expect(roleCan("BDE", "sales", "approve")).toBe(false);
    for (const resource of ["clients", "jobs", "finance", "invoices", "catalog", "issues"] as const) expect(roleCan("BDE", resource, "read")).toBe(false);
    expect(roleCan("SUPER_ADMIN", "sales", "approve")).toBe(true);
    expect(roleCan("OPS_MANAGER", "sales", "approve")).toBe(false);
    expect(roleCan("SUPERVISOR", "sales", "read")).toBe(false);
    expect(roleCan("OWNER", "sales", "read")).toBe(false);
  });
});

describe("stages move by themselves", () => {
  it("moves right when a step is logged, and never left", () => {
    expect(STEP_STAGE.CALL).toBe("CONTACTED");
    expect(STEP_STAGE.VISIT).toBe("CONTACTED");
    expect(STEP_STAGE.CHECK_BOOKED).toBe("CHECK_BOOKED");
    expect(STEP_STAGE.CHECK_DONE).toBe("CHECK_DONE");
    expect(STEP_STAGE.QUOTE_SENT).toBe("QUOTED");
    expect(STEP_STAGE.NOTE).toBeNull();
    expect(moveForward("NEW", "CONTACTED")).toBe("CONTACTED");
    expect(moveForward("CONTACTED", "CHECK_DONE")).toBe("CHECK_DONE");
    // A call on a quoted lead leaves it quoted.
    expect(moveForward("QUOTED", "CONTACTED")).toBe("QUOTED");
    expect(moveForward("ON_PLAN", "FIRST_JOB")).toBe("ON_PLAN");
    expect(moveForward("CHECK_BOOKED", null)).toBe("CHECK_BOOKED");
  });
});

describe("stale leads (What the app found)", () => {
  it("is not stale while worked in the last five days", () => {
    expect(staleness(lead({ lastActivityAt: at("2026-11-22") }), NOW)).toBeNull();
  });

  it("lists a contacted lead with no next step after five days", () => {
    expect(staleness(lead({ lastActivityAt: at("2026-11-17") }), NOW)).toEqual({
      reason: "NO_NEXT_STEP",
      days: 9,
      context: "contacted 17 Nov",
      words: "no next step set, 9 days",
    });
  });

  it("lists a quote with no contact for five days", () => {
    const stale = staleness(lead({ stage: "QUOTED", lastActivityAt: at("2026-11-21"), quote: quote() }), NOW);
    expect(stale).toMatchObject({ reason: "QUOTE_NO_CONTACT", days: 5, context: "quote ₹8,500 sent 21 Nov", words: "no contact for 5 days" });
  });

  it("lists a free check with no quote", () => {
    const stale = staleness(lead({ stage: "CHECK_DONE", checkDoneAt: at("2026-11-18"), lastActivityAt: at("2026-11-18") }), NOW);
    expect(stale).toMatchObject({ reason: "CHECK_NO_QUOTE", days: 8, context: "free check done 18 Nov", words: "no quote sent, 8 days" });
  });

  it("lists a parked lead once its date has passed, with what was said", () => {
    const parked = lead({ status: "PARKED", parkedAt: at("2026-10-28"), parkedUntil: "2026-11-23", parkedReason: "after Diwali", lastActivityAt: at("2026-10-28") });
    expect(staleness(parked, NOW)).toEqual({
      reason: "NURTURE_DATE_PASSED",
      days: 3,
      context: 'said "after Diwali" on 28 Oct',
      words: "nurture date passed 3 days ago",
    });
    expect(staleness({ ...parked, parkedUntil: "2026-11-30" }, NOW)).toBeNull();
  });

  it("lists a lead whose next-action date has passed, even if worked recently", () => {
    expect(staleness(lead({ lastActivityAt: at("2026-11-25"), nextAction: "Call back", nextActionAt: at("2026-11-24", "11:00") }), NOW)).toMatchObject({
      reason: "NEXT_ACTION_PASSED",
      days: 2,
    });
  });

  it("never lists a lost lead or a paying customer, and drops a lead as soon as a step is logged", () => {
    expect(staleness(lead({ status: "LOST", lastActivityAt: at("2026-10-01") }), NOW)).toBeNull();
    expect(staleness(lead({ stage: "ON_PLAN", lastActivityAt: at("2026-10-01") }), NOW)).toBeNull();
    const old = lead({ lastActivityAt: at("2026-11-10") });
    expect(staleness(old, NOW)).not.toBeNull();
    expect(staleness({ ...old, lastActivityAt: NOW.toISOString() }, NOW)).toBeNull();
  });
});

describe("Do today", () => {
  it("brings back a parked lead whose date has passed, with Call and Park again", () => {
    const item = doTodayFor(lead({ status: "PARKED", parkedAt: at("2026-10-28"), parkedUntil: "2026-11-23", parkedReason: "after Diwali" }), NOW);
    expect(item).toMatchObject({ bucket: "OVERDUE", kind: "PARKED_DUE", days: 3, action: "CALL", secondAction: "PARK_AGAIN" });
    expect(item?.line).toBe('Parked on 28 Oct, "after Diwali". Date passed.');
    expect(doTodayFor(lead({ status: "PARKED", parkedUntil: "2026-11-26" }), NOW)).toBeNull();
  });

  it("flags a quote the owner opened with no reply for two days", () => {
    const opened = lead({ stage: "QUOTED", name: "Paradise Lane Dhaba", lastActivityAt: at("2026-11-21"), quote: quote({ openCount: 2, firstOpenedAt: at("2026-11-24", "19:00") }) });
    const item = doTodayFor(opened, NOW);
    expect(item).toMatchObject({ bucket: "OVERDUE", kind: "QUOTE_NO_REPLY", days: 2, action: "CALL" });
    expect(item?.line).toBe("Quote ₹8,500 sent 21 Nov. Owner opened it twice, no reply.");
    // A call after the first open is a reply; an open only yesterday of a quote sent three days ago is not overdue yet.
    expect(doTodayFor({ ...opened, lastActivityAt: at("2026-11-25") }, NOW)).toBeNull();
    expect(doTodayFor({ ...opened, lastActivityAt: at("2026-11-23"), quote: quote({ sentAt: at("2026-11-23"), openCount: 1, firstOpenedAt: at("2026-11-25") }) }, NOW)).toBeNull();
    // A quote won or declined needs no follow-up.
    expect(doTodayFor({ ...opened, quote: quote({ openCount: 2, firstOpenedAt: at("2026-11-24", "19:00"), outcome: "DECLINED" }) }, NOW)).toBeNull();
  });

  it("flags a quote sent five days ago with nothing logged since, opened or not (20 Oct 2026)", () => {
    const sent = lead({ stage: "QUOTED", lastActivityAt: at("2026-11-21"), quote: quote({ sentAt: at("2026-11-21") }) });
    const item = doTodayFor(sent, NOW);
    expect(item).toMatchObject({ bucket: "OVERDUE", kind: "QUOTE_NOT_OPENED", days: 5, action: "CALL", params: { totalPaise: 850_000, sentOn: "2026-11-21", opens: 0 } });
    expect(item?.line).toBe("Quote ₹8,500 sent 21 Nov. Not opened yet, no reply.");
    // Opened only yesterday, but sent five days ago with no reply: still a follow-up, worded as opened.
    expect(doTodayFor({ ...sent, quote: quote({ sentAt: at("2026-11-21"), openCount: 1, firstOpenedAt: at("2026-11-25") }) }, NOW)).toMatchObject({ kind: "QUOTE_NO_REPLY", days: 5 });
    // Four days is not yet; a call logged after sending is a reply.
    expect(doTodayFor({ ...sent, lastActivityAt: at("2026-11-22"), quote: quote({ sentAt: at("2026-11-22") }) }, NOW)).toBeNull();
    expect(doTodayFor({ ...sent, lastActivityAt: at("2026-11-23") }, NOW)).toBeNull();
    // Won by the app or marked: nothing to chase.
    expect(doTodayFor({ ...sent, quote: quote({ sentAt: at("2026-11-21"), outcome: "WON" }) }, NOW)).toBeNull();
  });

  it("lists today's free check at its time, and a check with no quote as Send quote", () => {
    expect(doTodayFor(lead({ stage: "CHECK_BOOKED", checkAt: at("2026-11-26", "11:00"), checkWith: "Naveen" }), NOW)).toMatchObject({
      bucket: "TODAY",
      kind: "CHECK_TODAY",
      time: "11:00",
      line: "Free check with Naveen. Scorecard on the phone.",
      action: "OPEN",
    });
    expect(
      doTodayFor(lead({ stage: "CHECK_DONE", checkDoneAt: at("2026-11-18"), nextAction: "Send the quote", nextActionAt: at("2026-11-26", "10:00") }), NOW),
    ).toMatchObject({ kind: "QUOTE_NOT_SENT", time: "10:00", line: "Free check done 18 Nov; quote not sent yet. Send it.", action: "SEND_QUOTE" });
  });

  it("asks for the day-10 call after a first job until a call is logged", () => {
    const won = lead({ stage: "FIRST_JOB", wonAt: at("2026-11-16"), firstJob: { rating: 5, sameDay: true }, quote: quote({ hasPlan: true, sentAt: at("2026-11-18") }) });
    expect(doTodayFor(won, NOW)).toMatchObject({ kind: "DAY10_CALL", line: "Day-10 call: how is the app going, ask for a rating.", action: "CALL" });
    expect(doTodayFor({ ...won, wonAt: at("2026-11-17"), quote: quote({ hasPlan: true, sentAt: at("2026-11-18") }) }, NOW)).toBeNull();
    expect(doTodayFor({ ...won, lastContactAt: at("2026-11-26", "08:30") }, NOW)).toBeNull();
  });

  it("asks to offer a plan after a signed-off first job, until a plan quote is sent", () => {
    const won = lead({ name: "Green Leaf Tiffins", stage: "FIRST_JOB", wonAt: at("2026-11-24"), firstJob: { rating: 5, sameDay: true }, suggestedPlan: "Essential" });
    expect(doTodayFor(won, NOW)).toMatchObject({ kind: "OFFER_PLAN", time: null, line: "First job done Tuesday, signed off. Offer the Essential plan.", action: "SEND_PLAN" });
    expect(doTodayFor({ ...won, quote: quote({ hasPlan: true, sentAt: at("2026-11-25") }) }, NOW)).toBeNull();
  });

  it("asks to pitch the other kitchens of a client on a plan", () => {
    const client = lead({
      name: "Hyderabad Kitchen Co",
      stage: "ON_PLAN",
      kitchens: 5,
      wonAt: at("2026-11-02"),
      lastContactAt: at("2026-11-13"),
      onPlan: { kitchens: 3, planName: "Complete" },
      nextAction: "Pitch the other kitchens",
      nextActionAt: at("2026-11-26", "16:00"),
    });
    expect(doTodayFor(client, NOW)).toMatchObject({ kind: "PITCH_MORE", time: "16:00", line: "Pitch two more kitchens; they have 3 on Complete already.", action: "OPEN" });
    // Every kitchen on the plan: nothing to pitch.
    expect(doTodayFor({ ...client, onPlan: { kitchens: 5, planName: "Complete" } }, NOW)).toMatchObject({ kind: "NEXT_ACTION_TODAY" });
  });

  it("lists a next step due today, and one already past as overdue", () => {
    expect(doTodayFor(lead({ nextAction: "Meet the owner", nextActionAt: at("2026-11-26", "12:30") }), NOW)).toMatchObject({
      kind: "NEXT_ACTION_TODAY",
      time: "12:30",
      line: "Meet the owner",
    });
    expect(doTodayFor(lead({ nextAction: "Call back about the price", nextActionAt: at("2026-11-24", "15:00") }), NOW)).toMatchObject({
      bucket: "OVERDUE",
      kind: "NEXT_ACTION_OVERDUE",
      days: 2,
      line: "Call back about the price. Was due Tuesday.",
    });
  });

  it("says nothing about a lost lead, and Open in place of Call when there is no number", () => {
    expect(doTodayFor(lead({ status: "LOST", nextActionAt: at("2026-11-26") }), NOW)).toBeNull();
    expect(doTodayFor(lead({ hasPhone: false, nextActionAt: at("2026-11-26", "12:00") }), NOW)?.action).toBe("OPEN");
  });

  it("gives each line's facts too, so the BDE's phone can say it in their own language", () => {
    expect(doTodayFor(lead({ status: "PARKED", parkedAt: at("2026-10-28"), parkedUntil: "2026-11-23", parkedReason: "after Diwali" }), NOW)?.params).toEqual({
      parkedOn: "2026-10-28",
      until: "2026-11-23",
      reason: "after Diwali",
    });
    const opened = lead({ stage: "QUOTED", lastActivityAt: at("2026-11-21"), quote: quote({ openCount: 2, firstOpenedAt: at("2026-11-24", "19:00") }) });
    expect(doTodayFor(opened, NOW)?.params).toEqual({ totalPaise: 850_000, sentOn: "2026-11-21", opens: 2 });
    expect(doTodayFor(lead({ nextAction: "Call back about the price", nextActionAt: at("2026-11-24", "15:00") }), NOW)?.params).toEqual({
      nextAction: "Call back about the price",
      dueOn: "2026-11-24",
    });
    expect(doTodayFor(lead({ stage: "CHECK_DONE", checkDoneAt: at("2026-11-18") }), NOW)?.params).toEqual({ doneOn: "2026-11-18" });
  });

  it("puts overdue first, longest waiting first, then today's by time with untimed last; one to-do per lead", () => {
    const items = doToday(
      [
        lead({ id: "a", name: "A", nextActionAt: at("2026-11-26", "16:00") }),
        lead({ id: "b", name: "B", stage: "CHECK_DONE", checkDoneAt: at("2026-11-20") }),
        lead({ id: "c", name: "C", nextActionAt: at("2026-11-25") }),
        lead({ id: "d", name: "D", status: "PARKED", parkedUntil: "2026-11-22", nextActionAt: at("2026-11-20") }),
        lead({ id: "e", name: "E", stage: "CHECK_BOOKED", checkAt: at("2026-11-26", "11:00") }),
        lead({ id: "f", name: "F" }),
      ],
      NOW,
    );
    expect(items.map((item) => item.leadId)).toEqual(["d", "c", "e", "a", "b"]);
  });
});

describe("Likely to close", () => {
  it("scores a quoted lead from what the owner did, strongest signal first", () => {
    const score = closeScore(
      lead({ name: "Paradise Lane Dhaba", stage: "QUOTED", checkFindings: 4, nearPlanCustomer: "Banjara Hills", quote: quote({ openCount: 2, firstOpenedAt: at("2026-11-24") }) }),
      NOW,
    )!;
    expect(score.kind).toBe("FIRST_JOB");
    expect(score.score).toBe(25 + 13 + 10);
    expect(closeWords(score)).toEqual(["Quote opened twice", "check found 4 things to fix", "near a plan customer in Banjara Hills"]);
  });

  it("scores a first job for a plan from its rating and sign-off", () => {
    const facts = lead({ name: "Green Leaf Tiffins", stage: "FIRST_JOB", firstJob: { rating: 5, sameDay: true }, askedMonthlyPrice: true });
    const score = closeScore(facts, NOW)!;
    expect(score).toMatchObject({ kind: "PLAN", score: 40 });
    expect(closeTitle(facts, score.kind)).toBe("Green Leaf Tiffins, plan");
    expect(closeWords(score)).toEqual(["Asked about monthly price", "first job rated 5", "signed off same day"]);
  });

  it("scores more kitchens for a client already paying and on the app", () => {
    const facts = lead({
      name: "Hyderabad Kitchen Co",
      stage: "ON_PLAN",
      kitchens: 5,
      onPlan: { kitchens: 3, planName: "Complete" },
      client: { alreadyPaysKitchens: 3, ownerActiveDays: 6 },
      askedQuote: true,
    });
    const score = closeScore(facts, NOW)!;
    expect(closeTitle(facts, score.kind)).toBe("Hyderabad Kitchen Co, 2 more kitchens");
    expect(closeWords(score)).toEqual(["Already pays for 3", "asked for the quote", "owner on the app daily"]);
  });

  it("takes points away for a poor rating and for going quiet, and never shows them as reasons", () => {
    const score = closeScore(lead({ stage: "FIRST_JOB", firstJob: { rating: 2, sameDay: false }, lastActivityAt: at("2026-11-18"), askedMonthlyPrice: true }), NOW)!;
    expect(score.score).toBe(20 - 15 - 10);
    expect(closeWords(score)).toEqual(["Asked about monthly price"]);
  });

  it("has nothing to close for a lead lost, parked, or on a plan for every kitchen", () => {
    expect(closeScore(lead({ status: "LOST", askedQuote: true }), NOW)).toBeNull();
    expect(closeScore(lead({ status: "PARKED", askedQuote: true }), NOW)).toBeNull();
    expect(closeScore(lead({ stage: "ON_PLAN", kitchens: 2, onPlan: { kitchens: 2, planName: null } }), NOW)).toBeNull();
  });

  it("shows the top three with a positive score, best first", () => {
    const top = likelyToClose(
      [
        lead({ id: "low", askedQuote: true }),
        lead({ id: "none" }),
        lead({ id: "high", askedQuote: true, askedMonthlyPrice: true }),
        lead({ id: "mid", askedQuote: true, kitchens: 3 }),
        lead({ id: "also", askedMonthlyPrice: true }),
      ],
      NOW,
    );
    expect(top.map((entry) => entry.lead.id)).toEqual(["high", "mid", "low"]);
  });
});

describe("weekly targets", () => {
  it("sets each target from the last two weeks, rounded up, never below the floor", () => {
    expect(suggestedTarget(17, 14, 10)).toBe(16);
    expect(suggestedTarget(3, 4, 5)).toBe(5);
    expect(suggestedTarget(0, 0, 0)).toBe(0);
  });

  it("uses the Super Admin's own figure where one is set", () => {
    const targets = weeklyTargets({ leads: 17, checks: 8, firstJobs: 4, plans: 1 }, { leads: 13, checks: 6, firstJobs: 2, plans: 1 }, { leads: 10, checks: 3, firstJobs: 1, plans: 0 }, { checks: 7, plans: null });
    expect(targets).toEqual({ leads: 15, checks: 7, firstJobs: 3, plans: 1 });
  });

  it("reads progress against how much of the working week has gone: green, amber, red", () => {
    expect(workingDaysGone("2026-11-23")).toBe(1);
    expect(workingDaysGone("2026-11-26")).toBe(4);
    expect(workingDaysGone("2026-11-29")).toBe(6);
    expect(expectedSoFar(15, "2026-11-26")).toBe(10);
    const targets = { leads: 15, checks: 7, firstJobs: 3, plans: 1 };
    expect(targetStatus({ leads: 10, checks: 5, firstJobs: 2, plans: 1 }, targets, "2026-11-26")).toEqual({ status: "GREEN", missed: [] });
    expect(targetStatus({ leads: 14, checks: 4, firstJobs: 2, plans: 1 }, targets, "2026-11-26")).toEqual({ status: "AMBER", missed: ["checks"] });
    expect(targetStatus({ leads: 9, checks: 4, firstJobs: 2, plans: 1 }, targets, "2026-11-26").status).toBe("RED");
  });
});

describe("weeks and forecasts", () => {
  it("counts weeks from Monday", () => {
    expect(weekStartOf("2026-11-26")).toBe("2026-11-23");
    expect(weekStartOf("2026-11-23")).toBe("2026-11-23");
    expect(weekStartOf("2026-11-29")).toBe("2026-11-23");
    expect(weekNumber("2026-11-04", "2026-11-26")).toBe(4);
    expect(weekNumber("2026-11-26", "2026-11-26")).toBe(1);
  });

  it("forecasts to 31 December, or next year's in the year's last week", () => {
    expect(forecastEnd("2026-11-26")).toBe("2026-12-31");
    expect(forecastEnd("2026-12-28")).toBe("2027-12-31");
  });

  it("carries the last two weeks' pace forward, never below today", () => {
    expect(paceForecast(21, 12, 5)).toBe(44);
    expect(paceForecast(10, 15, 3)).toBe(10);
    expect(paceForecast(58, 30, 0)).toBe(58);
  });

  it("forecasts next week's sales from the pace and the open pipeline, to the nearest ₹500", () => {
    expect(
      nextWeekForecast({
        lastWeekPaise: 3_800_000,
        weekBeforePaise: 4_100_000,
        openQuotesPaise: 10_600_000,
        quoteToWinPercent: 58,
        checksDone: 13,
        checkToPaidPercent: 43,
        averageSalePaise: 450_000,
      }),
    ).toBe(4_150_000);
    expect(nextWeekForecast({ lastWeekPaise: 0, weekBeforePaise: 0, openQuotesPaise: 0, quoteToWinPercent: null, checksDone: 0, checkToPaidPercent: null, averageSalePaise: 0 })).toBe(0);
  });

  it("works out the three rates over every lead", () => {
    const leads = [
      { won: true, checked: true, quoted: true },
      { won: false, checked: true, quoted: true },
      { won: false, checked: true, quoted: false },
      { won: false, checked: false, quoted: false },
    ];
    expect(conversionRates(leads)).toEqual({ checkToPaid: 33, leadToCustomer: 25, quoteToWin: 50 });
    expect(conversionRates([])).toEqual({ checkToPaid: null, leadToCustomer: null, quoteToWin: null });
  });

  it("turns a plan's price into a monthly amount", () => {
    expect(monthlyPaise(600_000, "MONTHLY")).toBe(600_000);
    expect(monthlyPaise(1_800_000, "QUARTERLY")).toBe(600_000);
  });
});

describe("quotes", () => {
  it("adds GST as CGST and SGST within Telangana", () => {
    expect(quoteTotals([{ amountPaise: 850_000, gstRatePercent: 18 }])).toEqual({ subtotalPaise: 850_000, cgstPaise: 76_500, sgstPaise: 76_500, gstPaise: 153_000, totalPaise: 1_003_000 });
  });

  it("writes the WhatsApp message with the link, and opens WhatsApp with it typed in", () => {
    const text = quoteMessage({ contactName: "Faisal", businessName: "Paradise Lane Dhaba", senderName: "Ravi", totalPaise: 1_003_000, link: "https://eccs.example/q/abc", validUntil: "2026-12-11" });
    expect(text).toContain("Hello Faisal, this is Ravi from ECCS.");
    expect(text).toContain("₹10,030 with GST");
    expect(text).toContain("https://eccs.example/q/abc");
    expect(text).toContain("valid until 11 Dec");
    expect(quoteWhatsappUrl("+919876543210", text)).toMatch(/^https:\/\/wa\.me\/919876543210\?text=Hello%20Faisal/);
    expect(quoteWhatsappUrl(null, "x")).toBe("https://wa.me/?text=x");
  });

  it("does not count a link-preview robot as the owner opening the quote", () => {
    expect(isLinkPreviewAgent("WhatsApp/2.24.20.79 A")).toBe(true);
    expect(isLinkPreviewAgent("facebookexternalhit/1.1 (+http://www.facebook.com/externalhit_uatext.php)")).toBe(true);
    expect(isLinkPreviewAgent("Mozilla/5.0 (Linux; Android 14) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0 Mobile Safari/537.36")).toBe(false);
    expect(isLinkPreviewAgent(null)).toBe(false);
  });
});

describe("what the API accepts", () => {
  it("takes a lead with its phone as typed, and a referrer only on a referral", () => {
    const parsed = leadSchema.parse({ businessName: " Hotel Blue Fox ", contactPhone: "98765 43210", source: "FIELD_VISIT" });
    expect(parsed).toMatchObject({ businessName: "Hotel Blue Fox", contactPhone: "+919876543210", kitchens: 1 });
    expect(leadSchema.safeParse({ businessName: "X", source: "FIELD_VISIT", referrerName: "Chef Ravi" }).success).toBe(false);
    expect(leadSchema.safeParse({ businessName: "X", source: "CHEF_REFERRAL", referrerName: "Chef Ravi" }).success).toBe(true);
    expect(leadSchema.safeParse({ businessName: "X", source: "FIELD_VISIT", contactPhone: "12345" }).success).toBe(false);
  });

  it("asks for what each step needs", () => {
    expect(stepSchema.safeParse({ kind: "CALL" }).success).toBe(true);
    expect(stepSchema.safeParse({ kind: "NOTE" }).success).toBe(false);
    expect(stepSchema.safeParse({ kind: "CHECK_BOOKED" }).success).toBe(false);
    expect(stepSchema.safeParse({ kind: "CHECK_BOOKED", checkAt: at("2026-11-27", "11:00") }).success).toBe(true);
    expect(stepSchema.safeParse({ kind: "CHECK_DONE" }).success).toBe(false);
    expect(stepSchema.safeParse({ kind: "CHECK_DONE", findings: 0 }).success).toBe(true);
    expect(stepSchema.safeParse({ kind: "ASKED" }).success).toBe(false);
  });

  it("takes a free check done with the phone's scorecard instead of a count, and a scorecard only then", () => {
    const answers = FREE_CHECK_POINTS.map((point) => ({ point, answer: point === "HOOD" ? "FIX" : "OK" }));
    expect(stepSchema.safeParse({ kind: "CHECK_DONE", scorecard: { answers } }).success).toBe(true);
    expect(stepSchema.safeParse({ kind: "CHECK_DONE", scorecard: { answers: answers.slice(1) } }).success).toBe(false);
    expect(stepSchema.safeParse({ kind: "VISIT", scorecard: { answers } }).success).toBe(false);
  });

  it("takes a park or a loss with the phone's own id and time, for sending again safely", () => {
    const id = "6f1b8c0e-6a4d-4a8e-9d43-0d7f0a8f2b11";
    expect(parkSchema.parse({ id, at: at("2026-11-26"), until: "2026-12-10", reason: "after Diwali" })).toMatchObject({ id, until: "2026-12-10" });
    expect(loseSchema.safeParse({ id: "not-an-id", reason: "Has a vendor" }).success).toBe(false);
    expect(loseSchema.safeParse({ reason: "Has a vendor" }).success).toBe(true);
  });

  it("takes a target for a week that starts on a Monday, and each quote line once", () => {
    expect(targetSchema.safeParse({ weekStart: "2026-11-23", leads: 15 }).success).toBe(true);
    expect(targetSchema.safeParse({ weekStart: "2026-11-24", leads: 15 }).success).toBe(false);
    const line = { kind: "SERVICE", refId: "8f6c7a8e-3b8d-4d55-9a57-0d0c5f9a1b23", quantity: 1 };
    expect(quoteSchema.safeParse({ lines: [line] }).success).toBe(true);
    expect(quoteSchema.safeParse({ lines: [line, line] }).success).toBe(false);
    expect(quoteSchema.safeParse({ lines: [] }).success).toBe(false);
  });
});

describe("words", () => {
  it("says times and days the way the design does", () => {
    expect(clockWords("16:00")).toBe("4 pm");
    expect(clockWords("10:30")).toBe("10:30 am");
    expect(clockWords("12:00")).toBe("12 pm");
    expect(indiaClock(at("2026-11-26", "16:00"))).toBe("16:00");
    expect(recentDay("2026-11-24", "2026-11-26")).toBe("Tuesday");
    expect(recentDay("2026-11-25", "2026-11-26")).toBe("yesterday");
    expect(recentDay("2026-11-10", "2026-11-26")).toBe("10 Nov");
  });
});

describe("what came of a quote (20 Oct 2026)", () => {
  const sent = { status: "SENT", outcome: null, validUntil: "2026-12-05" };

  it("is a draft until sent, then sent until its day has gone", () => {
    expect(quoteState({ status: "DRAFT", outcome: null, validUntil: null }, "2026-11-26")).toBe("DRAFT");
    expect(quoteState(sent, "2026-11-26")).toBe("SENT");
    // Valid on its last day; expired the day after.
    expect(quoteState(sent, "2026-12-05")).toBe("SENT");
    expect(quoteState(sent, "2026-12-06")).toBe("EXPIRED");
  });

  it("keeps won and declined after the validity has gone", () => {
    expect(quoteState({ ...sent, outcome: "WON" }, "2026-12-20")).toBe("WON");
    expect(quoteState({ ...sent, outcome: "DECLINED" }, "2026-12-20")).toBe("DECLINED");
    // Anything else stored is ignored.
    expect(quoteState({ ...sent, outcome: "MAYBE" }, "2026-11-26")).toBe("SENT");
    expect(mayMarkQuote("SENT")).toBe(true);
    expect(mayMarkQuote("EXPIRED")).toBe(true);
    expect(mayMarkQuote("DRAFT")).toBe(false);
    expect(mayMarkQuote("WON")).toBe(false);
  });

  it("counts the days a sent quote waits for a reply", () => {
    const quoteSent = { sentAt: at("2026-11-21"), openCount: 0, firstOpenedAt: null };
    expect(quoteFollowUp(quoteSent, at("2026-11-21"), "2026-11-25")).toBeNull();
    expect(quoteFollowUp(quoteSent, at("2026-11-21"), "2026-11-26")).toEqual({ days: 5, opened: false });
    expect(quoteFollowUp({ ...quoteSent, openCount: 1, firstOpenedAt: at("2026-11-22") }, at("2026-11-21"), "2026-11-24")).toEqual({ days: 2, opened: true });
    expect(quoteFollowUp({ ...quoteSent, outcome: "DECLINED" }, at("2026-11-21"), "2026-12-01")).toBeNull();
  });

  it("gives each row one button: Send a draft, Revise the latest when it waits or has expired, else Open", () => {
    expect(quoteRowAction("DRAFT", { latest: true, waiting: false })).toBe("SEND");
    expect(quoteRowAction("SENT", { latest: true, waiting: true })).toBe("REVISE");
    expect(quoteRowAction("SENT", { latest: true, waiting: false })).toBe("OPEN");
    expect(quoteRowAction("EXPIRED", { latest: true, waiting: false })).toBe("REVISE");
    // An older quote the lead has a newer one beside is only opened.
    expect(quoteRowAction("EXPIRED", { latest: false, waiting: false })).toBe("OPEN");
    expect(quoteRowAction("WON", { latest: true, waiting: false })).toBe("OPEN");
    expect(quoteRowAction("DECLINED", { latest: true, waiting: true })).toBe("OPEN");
  });

  it("starts a quote from the free check with the services that fix what it found, as the phone does", () => {
    const options = [
      { kind: "PLAN" as const, refId: "plan", serviceCode: null },
      { kind: "SERVICE" as const, refId: "chimney-small", serviceCode: "CHIMNEY" },
      { kind: "SERVICE" as const, refId: "chimney-large", serviceCode: "CHIMNEY" },
      { kind: "SERVICE" as const, refId: "pest", serviceCode: "PEST" },
    ];
    const answers = FREE_CHECK_POINTS.map((point) => ({ point, answer: (["HOOD", "PESTS", "STORAGE", "DRAINS"].includes(point) ? "FIX" : "OK") as "FIX" | "OK" }));
    // The hood and pests have a service each (the first of each kind); labels are fixed in the app; no grease-trap service is offered here.
    expect(freeCheckPicks(options, answers)).toEqual([
      { refId: "chimney-small", quantity: 1 },
      { refId: "pest", quantity: 1 },
    ]);
    expect(freeCheckPicks(options, FREE_CHECK_POINTS.map((point) => ({ point, answer: "OK" as const })))).toEqual([]);
  });

  it("takes a reason for a decline and the list's filters", () => {
    expect(quoteDeclinedSchema.safeParse({ reason: "Went with their old vendor" }).success).toBe(true);
    expect(quoteDeclinedSchema.safeParse({ reason: "  " }).success).toBe(false);
    expect(quoteDeclinedSchema.safeParse({ reason: "x".repeat(101) }).success).toBe(false);
    expect(quoteListQuerySchema.parse({ state: "BUILD" })).toEqual({ state: "BUILD" });
    expect(quoteListQuerySchema.safeParse({ state: "OPENED" }).success).toBe(false);
  });
});
