import { describe, expect, it } from "vitest";
import { visitStanding } from "./monitoring.js";
import {
  closeProgress,
  closeShownFully,
  eveningClose,
  namesWords,
  sortTodayItems,
  sortTodayVisits,
  todayHeadline,
  todayItem,
  TODAY_ITEMS,
  TODAY_ITEM_KINDS,
  visitBadge,
  type CloseFacts,
  type TodayItemFacts,
} from "./today.js";

// Tuesday 20 October 2026, 9:10 am in India.
const NOW = new Date("2026-10-20T03:40:00.000Z");
const TODAY = "2026-10-20";
const hoursAgo = (hours: number) => new Date(NOW.getTime() - hours * 3_600_000).toISOString();

const item = (facts: TodayItemFacts, now = NOW) => todayItem(facts, now);

describe("the headline", () => {
  it("counts the visits, the free checks and what needs you", () => {
    expect(todayHeadline({ visits: 5, checks: 2, needsYou: 4 })).toBe("5 visits, 2 free checks. 4 things need you.");
    expect(todayHeadline({ visits: 1, checks: 1, needsYou: 1 })).toBe("1 visit, 1 free check. 1 thing needs you.");
  });

  it("says so plainly when nothing needs you, and leaves out free checks there are none of", () => {
    expect(todayHeadline({ visits: 3, checks: 0, needsYou: 0 })).toBe("3 visits. Nothing needs you.");
    expect(todayHeadline({ visits: 0, checks: 0, needsYou: 0 })).toBe("No visits today. Nothing needs you.");
    expect(todayHeadline({ visits: 0, checks: 2, needsYou: 1 })).toBe("No visits, 2 free checks. 1 thing needs you.");
  });

  it("has no free checks for a Supervisor", () => {
    expect(todayHeadline({ visits: 2, checks: null, needsYou: 1 })).toBe("2 visits. 1 thing needs you.");
  });
});

describe("Needs you: the thresholds", () => {
  const booking = (requestedAt: string): TodayItemFacts => ({
    kind: "BOOKING_WAITING",
    bookingId: "b1",
    outletName: "Spice Route, Gachibowli",
    serviceName: "Pest control",
    preferredDate: "2026-10-24",
    preferredSlot: "1000",
    requestedAt,
  });

  it("brings in a booking not placed after 4 hours", () => {
    expect(item(booking(hoursAgo(3.9)))).toBeNull();
    expect(item(booking(hoursAgo(4)))).toMatchObject({
      key: "BOOKING_WAITING:b1",
      title: "Spice Route, Gachibowli: a booking waiting for a slot",
      detail: "Pest control, asked for 24 Oct at 10 am. Waiting 4 hours.",
      button: "Place",
      target: { kind: "WAITING" },
    });
    expect(item(booking(hoursAgo(50)))?.detail).toBe("Pest control, asked for 24 Oct at 10 am. Waiting 2 days.");
  });

  it("brings in today's and tomorrow's visits with no Supervisor, and no others", () => {
    const visit = (date: string): TodayItemFacts => ({ kind: "VISIT_NO_SUPERVISOR", visitId: "v1", outletName: "Biryani House", serviceName: "Kitchen deep clean", date, slot: "0800" });
    expect(item(visit(TODAY))).toMatchObject({ title: "Biryani House: today's visit has no Supervisor", detail: "Kitchen deep clean at 8 am.", dueToday: true, button: "Assign" });
    expect(item(visit("2026-10-21"))).toMatchObject({ title: "Biryani House: tomorrow's visit has no Supervisor", dueToday: false });
    expect(item(visit("2026-10-22"))).toBeNull();
    expect(item(visit("2026-10-19"))).toBeNull();
  });

  it("brings in a sign-off after 2 days, and shows today's reminder only", () => {
    const signOff = (finishedOn: string, remindedAt: string | null = null): TodayItemFacts => ({
      kind: "SIGN_OFF_WAITING",
      visitId: "v2",
      outletName: "Mehfil Dhaba",
      serviceName: "Pest control",
      finishedOn,
      remindedAt,
    });
    expect(item(signOff("2026-10-19"))).toBeNull();
    expect(item(signOff("2026-10-18"))).toMatchObject({
      title: "Mehfil Dhaba: Sunday's visit not signed off",
      detail: "Pest control. Waiting 2 days.",
      button: "Remind",
      remindedAt: null,
    });
    expect(item(signOff("2026-10-08"))?.title).toBe("Mehfil Dhaba: the 8 Oct visit not signed off");
    expect(item(signOff("2026-10-18", hoursAgo(1)))?.remindedAt).toBe(hoursAgo(1));
    // Reminded yesterday: Remind is offered again today.
    expect(item(signOff("2026-10-17", hoursAgo(24)))?.remindedAt).toBeNull();
  });

  it("brings in a report after 2 days and an issue nobody picked up after 2 days", () => {
    const report: TodayItemFacts = { kind: "REPORT_TO_APPROVE", visitId: "v3", outletName: "Cafe Nilgiri", serviceName: "Pest control", signedOffOn: "2026-10-19" };
    expect(item(report)).toBeNull();
    expect(item({ ...report, signedOffOn: "2026-10-18" })).toMatchObject({ detail: "Pest control, signed off Sunday. Waiting 2 days.", button: "Approve" });

    const issue: TodayItemFacts = { kind: "ISSUE_NOT_PICKED_UP", issueId: "i1", reference: "ECCS-0042", outletName: "Cafe Nilgiri", category: "Pest sighting", raisedAt: "2026-10-19T04:00:00.000Z" };
    expect(item(issue)).toBeNull();
    expect(item({ ...issue, raisedAt: "2026-10-17T20:00:00.000Z" })).toMatchObject({
      title: "Cafe Nilgiri: issue ECCS-0042 not picked up",
      detail: "Pest sighting. Open 2 days.",
      button: "Open",
    });
  });

  it("brings in an overdue invoice where the crew is today, and a new outlet that is stuck", () => {
    const invoice: TodayItemFacts = { kind: "INVOICE_OVERDUE_VISIT_TODAY", invoiceId: "n1", outletName: "Spice Route", duePaise: 708_000, overdueDays: 9, invoices: 1, visitSlot: "1400" };
    expect(item(invoice)).toMatchObject({
      title: "Spice Route: invoice overdue, 9 days",
      detail: "₹7,080 due. The crew is there today at 2 pm; ask the manager.",
      button: "Open invoice",
      dueToday: true,
    });
    expect(item({ ...invoice, overdueDays: 0 })).toBeNull();
    expect(item({ ...invoice, invoices: 2 })?.detail).toBe("₹7,080 due on 2 invoices. The crew is there today at 2 pm; ask the manager.");
    expect(item({ kind: "OUTLET_STUCK", outletId: "o1", outletName: "Green Leaf", hoursSinceAdded: 30 })).toMatchObject({
      detail: "Added 30 hours ago and not using the app yet.",
      button: "Act",
      target: { kind: "NEW_OUTLETS" },
    });
  });

  it("has a button and a grant for every kind", () => {
    for (const kind of TODAY_ITEM_KINDS) expect(TODAY_ITEMS[kind].button.length).toBeGreaterThan(0);
  });
});

describe("Needs you: the order", () => {
  const made = (facts: TodayItemFacts[]) => sortTodayItems(facts.map((one) => todayItem(one, NOW)!)).map((one) => one.key);

  it("puts what must happen today first, then what waits on ECCS, then sign-offs, longest waiting first", () => {
    const keys = made([
      { kind: "SIGN_OFF_WAITING", visitId: "old", outletName: "A", serviceName: "Pest", finishedOn: "2026-10-10", remindedAt: null },
      { kind: "REPORT_TO_APPROVE", visitId: "r1", outletName: "B", serviceName: "Pest", signedOffOn: "2026-10-17" },
      { kind: "BOOKING_WAITING", bookingId: "b1", outletName: "C", serviceName: "Pest", preferredDate: TODAY, preferredSlot: null, requestedAt: hoursAgo(5) },
      { kind: "BOOKING_WAITING", bookingId: "b2", outletName: "D", serviceName: "Pest", preferredDate: TODAY, preferredSlot: null, requestedAt: hoursAgo(30) },
      { kind: "VISIT_NO_SUPERVISOR", visitId: "tomorrow", outletName: "E", serviceName: "Pest", date: "2026-10-21", slot: null },
      { kind: "INVOICE_OVERDUE_VISIT_TODAY", invoiceId: "n1", outletName: "F", duePaise: 100, overdueDays: 3, invoices: 1, visitSlot: null },
      { kind: "VISIT_NO_SUPERVISOR", visitId: "today", outletName: "G", serviceName: "Pest", date: TODAY, slot: null },
      { kind: "OUTLET_STUCK", outletId: "o1", outletName: "H", hoursSinceAdded: 40 },
      { kind: "ISSUE_NOT_PICKED_UP", issueId: "i1", reference: "ECCS-1", outletName: "I", category: "Other", raisedAt: hoursAgo(80) },
    ]);
    expect(keys).toEqual([
      "VISIT_NO_SUPERVISOR:today",
      "INVOICE_OVERDUE_VISIT_TODAY:n1",
      "VISIT_NO_SUPERVISOR:tomorrow",
      "BOOKING_WAITING:b2",
      "BOOKING_WAITING:b1",
      "ISSUE_NOT_PICKED_UP:i1",
      "REPORT_TO_APPROVE:r1",
      "OUTLET_STUCK:o1",
      "SIGN_OFF_WAITING:old",
    ]);
  });
});

describe("today's visits", () => {
  it("are in time order, after closing last", () => {
    const rows = sortTodayVisits([
      { time: null, outletName: "Late" },
      { time: "15:30", outletName: "B" },
      { time: "07:00", outletName: "A" },
    ]);
    expect(rows.map((row) => row.outletName)).toEqual(["A", "B", "Late"]);
  });

  it("carry one badge at most, a warning before a partner", () => {
    expect(visitBadge({ freeCheck: true, partner: false, overdueDays: null })).toEqual({ kind: "FREE_CHECK", label: "Free check" });
    expect(visitBadge({ freeCheck: false, partner: true, overdueDays: 9 })).toEqual({ kind: "WARNING", label: "Invoice overdue 9 days" });
    expect(visitBadge({ freeCheck: false, partner: true, overdueDays: null })).toEqual({ kind: "PARTNER", label: "Partner" });
    expect(visitBadge({ freeCheck: false, partner: false, overdueDays: 0 })).toBeNull();
  });
});

describe("the Evening close", () => {
  const visit = (outletName: string, over: Partial<CloseFacts["visits"][number]> = {}) => ({
    visitId: outletName,
    outletName,
    finished: true,
    hasBefore: true,
    hasAfter: true,
    awaitingSignOff: false,
    ...over,
  });
  const office: CloseFacts = {
    visits: [visit("Biryani House"), visit("Cafe Nilgiri", { awaitingSignOff: true }), visit("Spice Route", { finished: false, hasAfter: false }), visit("Green Leaf", { hasBefore: false })],
    reportsOut: [{ outletName: "Hotel Blue Fox", what: "INSPECTION", target: { kind: "INSPECTION", inspectionId: "x" } }],
    payments: { count: 2, totalPaise: 1_400_000 },
    tomorrow: { total: 6, withoutSupervisor: [{ visitId: "t1", outletName: "Tandoori Nights" }] },
  };

  it("names what is left on each line, with a link", () => {
    const lines = eveningClose(office);
    expect(lines.map((entry) => [entry.key, entry.state, entry.words])).toEqual([
      ["VISITS_FINISHED", "OPEN", "3 of 4 finished · to finish: Spice Route · photos missing: Green Leaf"],
      ["REPORTS_IN", "OPEN", "Not handed in: Hotel Blue Fox (inspection)"],
      ["SIGN_OFFS", "OPEN", "2 of 3 signed off · waiting: Cafe Nilgiri"],
      ["PAYMENTS", "KNOWN", "2 payments entered today, ₹14,000"],
      ["TOMORROW_SUPERVISORS", "OPEN", "1 of 6 without one: Tandoori Nights"],
    ]);
    expect(lines[0]?.target).toEqual({ kind: "VISITS" });
    expect(lines[1]?.target).toEqual({ kind: "INSPECTION", inspectionId: "x" });
    expect(lines[2]?.target).toEqual({ kind: "VISIT", visitId: "Cafe Nilgiri" });
    expect(lines[4]?.target).toEqual({ kind: "VISIT", visitId: "t1" });
    // A line that cannot be known is never counted as open.
    expect(closeProgress(lines)).toEqual({ done: 1, total: 5, open: 4 });
  });

  it("ticks every line on a day that is done", () => {
    const lines = eveningClose({
      visits: [visit("Biryani House"), visit("Cafe Nilgiri")],
      reportsOut: [],
      payments: { count: 0, totalPaise: 0 },
      tomorrow: { total: 3, withoutSupervisor: [] },
    });
    expect(lines.map((entry) => [entry.state, entry.words])).toEqual([
      ["DONE", "All 2 finished, with photos"],
      ["DONE", "All handed in"],
      ["DONE", "All 2 signed off"],
      ["KNOWN", "No payments entered today"],
      ["DONE", "All 3 have one"],
    ]);
    expect(closeProgress(lines)).toEqual({ done: 5, total: 5, open: 0 });
  });

  it("ticks a day with no visits, and gives a Supervisor only the lines about their own visits", () => {
    const lines = eveningClose({ visits: [], reportsOut: [], payments: null, tomorrow: null });
    expect(lines.map((entry) => [entry.key, entry.state, entry.words])).toEqual([
      ["VISITS_FINISHED", "DONE", "No visits today"],
      ["REPORTS_IN", "DONE", "All handed in"],
      ["SIGN_OFFS", "DONE", "None waiting"],
    ]);
  });

  it("shows in full from 4 pm in India", () => {
    expect(closeShownFully(new Date("2026-10-20T10:29:00.000Z"))).toBe(false); // 3:59 pm
    expect(closeShownFully(new Date("2026-10-20T10:30:00.000Z"))).toBe(true); // 4:00 pm
  });

  it("lists three names apart with semicolons, a repeated one once with its count, then how many more", () => {
    expect(namesWords(["A"])).toBe("A");
    expect(namesWords(["Spice Route, Gachibowli", "Biryani House"])).toBe("Spice Route, Gachibowli and Biryani House");
    expect(namesWords(["A", "B", "C", "D", "E"])).toBe("A; B; C and 2 more");
    expect(namesWords(["Tiffins, Madhapur", "Deccan", "Tiffins, Madhapur"])).toBe("Tiffins, Madhapur (2) and Deccan");
  });
});

describe("where a visit stands (shared with the monitoring board)", () => {
  const base = { date: "2026-10-18", finishedOn: null, signedOffOn: null, hasSignOff: false, reviewed: false };
  it("counts the days waited from the step that started the wait", () => {
    expect(visitStanding({ ...base, status: "COMPLETED", finishedOn: "2026-10-18" }, TODAY)).toEqual({ stage: "AWAITING_SIGN_OFF", waitingDays: 2 });
    expect(visitStanding({ ...base, status: "APPROVED", signedOffOn: "2026-10-19", hasSignOff: true }, TODAY)).toEqual({ stage: "REPORT_TO_APPROVE", waitingDays: 1 });
    expect(visitStanding({ ...base, status: "APPROVED", hasSignOff: true, reviewed: true }, TODAY)).toEqual({ stage: "CLOSED" });
    expect(visitStanding({ ...base, status: "IN_PROGRESS", hasSignOff: true }, TODAY)).toEqual({ stage: "REPORT_RETURNED" });
    expect(visitStanding({ ...base, status: "ASSIGNED" }, TODAY)).toEqual({ stage: "TO_DO", daysLate: 2, daysAhead: 0 });
    expect(visitStanding({ ...base, status: "SCHEDULED", date: "2026-10-21" }, TODAY)).toEqual({ stage: "TO_DO", daysLate: 0, daysAhead: 1 });
    expect(visitStanding({ ...base, status: "CANCELLED" }, TODAY)).toEqual({ stage: "CLOSED" });
  });
});
