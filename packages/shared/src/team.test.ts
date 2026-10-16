import { describe, expect, it } from "vitest";
import {
  arrivalsOnTime,
  arrivedOnTime,
  concerns,
  dayList,
  firstName,
  followUpsOnTime,
  initials,
  keepAnEyeOn,
  leaveSchema,
  presenceDays,
  presenceLine,
  salaryDescription,
  salaryForMonth,
  salaryMonths,
  salaryOn,
  summarisePresence,
  TEAM_RULES,
  teamChangeSchema,
  teamMemberSchema,
  teamRoleOf,
  teamWhatsappUrl,
  todaySentence,
  todayWords,
  worstFirst,
  type FollowUpRecord,
  type PresenceEvent,
} from "./team.js";
import type { StaleDto } from "./sales.js";

/** A moment in India time. */
const at = (date: string, time: string) => new Date(`${date}T${time}:00.000+05:30`).toISOString();

describe("names and roles", () => {
  it("makes initials as the design does", () => {
    expect(initials("Imran")).toBe("IM");
    expect(initials("Sample Supervisor")).toBe("SS");
    expect(initials("  ravi kumar reddy ")).toBe("RK");
    expect(initials("Kiran (sample)")).toBe("KI");
  });

  it("calls a person by their first name, the seed's sample logins by their whole name", () => {
    expect(firstName("Imran Khan")).toBe("Imran");
    expect(firstName("Sample Supervisor")).toBe("Sample Supervisor");
  });

  it("reads the role a login holds on the team, a founder only when nothing else", () => {
    expect(teamRoleOf(["BDE"])).toBe("BDE");
    expect(teamRoleOf(["SUPERVISOR"])).toBe("SUPERVISOR");
    expect(teamRoleOf(["SUPER_ADMIN"])).toBe("SUPER_ADMIN");
    expect(teamRoleOf(["SUPER_ADMIN", "OPS_MANAGER"])).toBe("OPS_MANAGER");
    expect(teamRoleOf(["OWNER"])).toBeNull();
  });

  it("opens WhatsApp on a chat with them, leaving a sample member's made-up number out", () => {
    expect(teamWhatsappUrl("+919876543210", false)).toBe("https://wa.me/919876543210");
    expect(teamWhatsappUrl("+919000000006", true)).toBe("https://wa.me/");
    expect(teamWhatsappUrl(null, false)).toBe("https://wa.me/");
  });
});

describe("presence, read from what was done", () => {
  // Thursday 15 October 2026 is "today"; Sundays (weekday 0) are the day off.
  const today = "2026-10-15";
  const base = { today, weeklyOff: 0, leave: [], joinedOn: "2026-09-01", leftOn: null };

  it("counts a day from its first step, on the India day it was done, even when it reached the server later", () => {
    // Logged at 9:40 on the phone without signal on the 13th; sent the next morning.
    const events: PresenceEvent[] = [
      { at: at("2026-10-13", "11:15"), what: "first call logged" },
      { at: at("2026-10-13", "09:40"), what: "first lead logged from the field" },
      // 11:30 pm India time is still the 14th, though it is the 14th 18:00 in UTC.
      { at: at("2026-10-14", "23:30"), what: "first call logged" },
    ];
    const days = presenceDays({ ...base, events });
    expect(days).toHaveLength(TEAM_RULES.windowDays);
    expect(days[0]!.date).toBe("2026-10-02");
    expect(days.at(-1)!.date).toBe(today);
    const tuesday = days.find((day) => day.date === "2026-10-13")!;
    expect(tuesday).toMatchObject({ state: "IN", firstAt: "09:40", what: "first lead logged from the field" });
    expect(days.find((day) => day.date === "2026-10-14")).toMatchObject({ state: "IN", firstAt: "23:30" });
  });

  it("tells days off, leave, today, days not in and days off worked apart, and leave is never a day missed", () => {
    const days = presenceDays({
      ...base,
      events: [
        { at: at("2026-10-11", "10:05"), what: "first call logged" }, // a Sunday, worked anyway
        { at: at("2026-10-12", "10:00"), what: "first call logged" },
      ],
      leave: [{ from: "2026-10-09", to: "2026-10-09", reason: "family function" }],
    });
    const state = (date: string) => days.find((day) => day.date === date)!.state;
    expect(state("2026-10-04")).toBe("OFF");
    expect(state("2026-10-11")).toBe("IN");
    expect(days.find((day) => day.date === "2026-10-11")!.dayOff).toBe(true);
    expect(state("2026-10-09")).toBe("LEAVE");
    expect(days.find((day) => day.date === "2026-10-09")!.leaveReason).toBe("family function");
    expect(state("2026-10-10")).toBe("NOT_IN");
    expect(state(today)).toBe("TODAY");
    const summary = summarisePresence(days);
    // 14 days less two Sundays less today (not in yet): 11 working days; in on one of them.
    expect(summary.working).toBe(11);
    expect(summary.in).toBe(1);
    expect(summary.leave).toEqual(["2026-10-09"]);
    expect(summary.offWorked).toEqual(["2026-10-11"]);
    expect(summary.off).toEqual(["2026-10-04"]);
    expect(summary.missed).not.toContain("2026-10-09");
    expect(summary.missed).not.toContain(today);
    expect(summary.missed).toHaveLength(9);
    expect(presenceLine(summary, { name: "Ravi", weeklyOff: 0, source: "LEAD_STEPS" })).toBe(
      "1 of 11 working days in · on leave Friday 9 · not in 9 days · also worked on Sunday 11, a day off · the grey square is a Sunday. Read from the first lead step Ravi logs each day.",
    );
  });

  it("says nothing of days before joining, after leaving, or before the records began", () => {
    const days = presenceDays({ ...base, events: [], joinedOn: "2026-10-08", leftOn: "2026-10-13", recordsFrom: "2026-10-10" });
    const state = (date: string) => days.find((day) => day.date === date)!.state;
    expect(state("2026-10-07")).toBe("NOT_ON_TEAM");
    expect(state("2026-10-08")).toBe("NO_RECORD");
    expect(state("2026-10-12")).toBe("NOT_IN");
    expect(state("2026-10-14")).toBe("NOT_ON_TEAM");
    expect(summarisePresence(days).working).toBe(3);
  });

  it("words the line under the squares as the design does", () => {
    // In every working day but one day of leave; the two Sundays grey; in today at 9:40.
    const events: PresenceEvent[] = [];
    for (let day = 2; day <= 15; day += 1) {
      const date = `2026-10-${String(day).padStart(2, "0")}`;
      const weekday = new Date(`${date}T00:00:00Z`).getUTCDay();
      if (weekday !== 0 && date !== "2026-10-13") events.push({ at: at(date, "09:40"), what: "first lead logged from the field" });
    }
    const days = presenceDays({ ...base, events, leave: [{ from: "2026-10-13", to: "2026-10-13" }] });
    const summary = summarisePresence(days);
    expect(presenceLine(summary, { name: "Imran", weeklyOff: 0, source: "LEAD_STEPS" })).toBe(
      "11 of 12 working days in · on leave Tuesday 13 · the two grey squares are Sundays. Read from the first lead step Imran logs each day.",
    );
    expect(todaySentence(summary.today, { name: "Imran" })).toBe("In since 9:40 am today, first lead logged from the field.");
    expect(todayWords(summary.today)).toBe("In since 9:40 am");
  });

  it("says today in one short sentence whatever the day is", () => {
    const day = (state: "LEAVE" | "OFF" | "TODAY") => ({ date: today, state, firstAt: null, what: null, dayOff: state === "OFF", onLeave: state === "LEAVE", leaveReason: state === "LEAVE" ? "wedding" : null });
    expect(todaySentence(day("LEAVE"), { name: "Sana" })).toBe("On leave today (wedding).");
    expect(todaySentence(day("OFF"), { name: "Sana Begum" })).toBe("Thursday is Sana's day off.");
    expect(todaySentence(day("TODAY"), { name: "Sana", lastIn: { ...day("TODAY"), date: "2026-10-14", state: "IN", firstAt: "10:05" } })).toBe(
      "Not in yet today; last in on Wednesday 14, from 10:05 am.",
    );
    expect(todaySentence(day("TODAY"), { name: "Sana" })).toBe("Not in yet today.");
  });

  it("lists days in words, briefly", () => {
    expect(dayList(["2026-10-09"])).toBe("Friday 9");
    expect(dayList(["2026-10-09", "2026-10-12"])).toBe("Friday 9 and Monday 12");
    expect(dayList(["2026-10-09", "2026-10-12", "2026-10-14"])).toBe("Fri 9, Mon 12 and Wed 14");
    expect(dayList(["2026-10-05", "2026-10-06", "2026-10-07", "2026-10-08", "2026-10-09"])).toBe("5 days");
  });
});

describe("follow-ups on time", () => {
  const now = new Date(at("2026-10-15", "18:00"));
  const followUp = (leadId: string, setAt: string, dueAt: string, endedAt: string | null = null): FollowUpRecord => ({ leadId, setAt, dueAt, endedAt });

  it("counts a next step on time when a step was logged on the lead after it was set and by its due time", () => {
    const followUps = [
      followUp("a", at("2026-10-12", "10:00"), at("2026-10-13", "11:00"), at("2026-10-13", "10:30")),
      // Logged late: due at 11, called at 3.
      followUp("b", at("2026-10-12", "10:00"), at("2026-10-13", "11:00"), at("2026-10-13", "15:00")),
      // Nothing logged at all, still the next step: late.
      followUp("c", at("2026-10-12", "10:00"), at("2026-10-14", "11:00")),
    ];
    const steps = [
      { leadId: "a", at: at("2026-10-13", "10:30") },
      { leadId: "b", at: at("2026-10-13", "15:00") },
      // The step that set it does not count as meeting it.
      { leadId: "c", at: at("2026-10-12", "10:00") },
    ];
    expect(followUpsOnTime(followUps, steps, "2026-10-12", "2026-10-15", now)).toEqual({ due: 3, onTime: 1, percent: 33 });
  });

  it("leaves out one moved to a new date before it fell due, and one not yet due; one moved after it fell due is late", () => {
    const followUps = [
      followUp("a", at("2026-10-12", "10:00"), at("2026-10-14", "11:00"), at("2026-10-13", "09:00")),
      followUp("b", at("2026-10-12", "10:00"), at("2026-10-14", "11:00"), at("2026-10-14", "16:00")),
      followUp("c", at("2026-10-15", "10:00"), at("2026-10-15", "19:00")),
      // Due last week: outside this week.
      followUp("d", at("2026-10-05", "10:00"), at("2026-10-06", "11:00")),
    ];
    expect(followUpsOnTime(followUps, [], "2026-10-12", "2026-10-15", now)).toEqual({ due: 1, onTime: 0, percent: 0 });
    expect(followUpsOnTime([], [], "2026-10-12", "2026-10-15", now)).toEqual({ due: 0, onTime: 0, percent: null });
  });

  it("counts a step logged before a new date was set as meeting the old one", () => {
    const followUps = [followUp("a", at("2026-10-12", "10:00"), at("2026-10-14", "11:00"), at("2026-10-13", "12:00"))];
    expect(followUpsOnTime(followUps, [{ leadId: "a", at: at("2026-10-13", "12:00") }], "2026-10-12", "2026-10-15", now)).toEqual({ due: 1, onTime: 1, percent: 100 });
  });
});

describe("arrivals on time", () => {
  it("is on time by the end of the two-hour window, early included; after closing by 4 am", () => {
    expect(arrivedOnTime({ scheduledDate: "2026-10-13", slot: "1000", checkInAt: at("2026-10-13", "11:59") })).toBe(true);
    expect(arrivedOnTime({ scheduledDate: "2026-10-13", slot: "1000", checkInAt: at("2026-10-13", "12:01") })).toBe(false);
    expect(arrivedOnTime({ scheduledDate: "2026-10-13", slot: "1000", checkInAt: at("2026-10-12", "15:00") })).toBe(true);
    expect(arrivedOnTime({ scheduledDate: "2026-10-13", slot: "AFTER_CLOSING", checkInAt: at("2026-10-14", "03:30") })).toBe(true);
    expect(arrivedOnTime({ scheduledDate: "2026-10-13", slot: "AFTER_CLOSING", checkInAt: at("2026-10-14", "05:00") })).toBe(false);
    expect(arrivedOnTime({ scheduledDate: "2026-10-13", slot: null, checkInAt: at("2026-10-13", "23:00") })).toBe(true);
  });

  it("gives the share for the arrivals of the week", () => {
    const visits = [
      { scheduledDate: "2026-10-13", slot: "1000" as const, checkInAt: at("2026-10-13", "10:20") },
      { scheduledDate: "2026-10-13", slot: "1400" as const, checkInAt: at("2026-10-13", "17:00") },
      { scheduledDate: "2026-10-05", slot: "1400" as const, checkInAt: at("2026-10-05", "14:10") },
    ];
    expect(arrivalsOnTime(visits, "2026-10-12", "2026-10-15")).toEqual({ due: 2, onTime: 1, percent: 50 });
  });
});

describe("keep an eye on", () => {
  const quiet = { missedDays: [], onTimeTargetPercent: 90 };

  it("says nothing needs attention when all is well", () => {
    expect(concerns(quiet)).toEqual([]);
    expect(keepAnEyeOn([], "In since 9:40 am today.")).toEqual({ pick: null, note: "In since 9:40 am today. Everything is on target." });
  });

  it("picks absence first, then stale leads, then the week's figures, and puts the rest in the note", () => {
    const found = concerns({
      ...quiet,
      missedDays: ["2026-10-09", "2026-10-12"],
      staleLeads: { count: 6, longestDays: 12 },
      behind: [{ label: "free checks", done: 4, target: 7 }],
      followUps: { due: 7, onTime: 5, percent: 71 },
    });
    expect(found.map((entry) => entry.kind)).toEqual(["MISSED_DAYS", "STALE_LEADS", "TARGETS_BEHIND", "FOLLOW_UPS_LATE"]);
    expect(found[0]!.words).toBe("Not in on 2 working days of the last two weeks: Friday 9 and Monday 12.");
    expect(found[1]!.words).toBe("6 leads waiting for a follow-up, the longest for 12 days.");
    expect(found[2]!.words).toBe("Behind on free checks: 4 of 7 this week.");
    expect(found[3]!.words).toBe("Follow-ups on time 71% this week, target 90%.");
    const keep = keepAnEyeOn(found.slice(1, 2), "In since 9:40 am today, first lead logged from the field.");
    expect(keep.pick?.kind).toBe("STALE_LEADS");
    expect(keep.note).toBe("In since 9:40 am today, first lead logged from the field. Everything else is on target.");
    expect(keepAnEyeOn(found, "Not in yet today.").note).toBe("Not in yet today. Also: 6 leads waiting, free checks 4 of 7, follow-ups on time 71%.");
  });

  it("names a few missed days, and only counts many", () => {
    const many = ["2026-10-05", "2026-10-06", "2026-10-07", "2026-10-08", "2026-10-09"];
    expect(concerns({ ...quiet, missedDays: many })[0]!.words).toBe("Not in on 5 working days of the last two weeks.");
  });

  it("does not flag one missed day, one or two stale leads, or a share on time from too few", () => {
    expect(
      concerns({ ...quiet, missedDays: ["2026-10-09"], staleLeads: { count: 2, longestDays: 9 }, followUps: { due: 2, onTime: 0, percent: 0 }, arrivals: { due: 2, onTime: 1, percent: 50 } }),
    ).toEqual([]);
  });

  it("words a Supervisor's overdue visits and late arrivals", () => {
    const found = concerns({ ...quiet, visitsOverdue: 6, arrivals: { due: 5, onTime: 3, percent: 60 } });
    expect(found.map((entry) => entry.words)).toEqual(["6 visits past their day and not done.", "Arrived on time at 60% of visits this week, target 90%."]);
    expect(concerns({ ...quiet, visitsOverdue: 1 })[0]!.words).toBe("1 visit past its day and not done.");
  });

  it("lists stale leads worst first: a quote waiting, a nurture date, a check with no quote, then the longest waiting", () => {
    const stale = (reason: StaleDto["reason"], days: number) => ({ stale: { reason, days, context: "", words: "" } });
    const sorted = worstFirst([stale("NO_NEXT_STEP", 9), stale("NO_NEXT_STEP", 12), stale("CHECK_NO_QUOTE", 8), stale("QUOTE_NO_CONTACT", 5), stale("NURTURE_DATE_PASSED", 3)]);
    expect(sorted.map((entry) => [entry.stale.reason, entry.stale.days])).toEqual([
      ["QUOTE_NO_CONTACT", 5],
      ["NURTURE_DATE_PASSED", 3],
      ["CHECK_NO_QUOTE", 8],
      ["NO_NEXT_STEP", 12],
      ["NO_NEXT_STEP", 9],
    ]);
  });
});

describe("salaries", () => {
  const steps = [{ from: "2026-09-15", monthlyPaise: 2_800_000 }];

  it("pays a whole month at its salary exactly, leave included", () => {
    expect(salaryForMonth({ month: "2026-10", joinedOn: "2026-09-15", leftOn: null, steps })).toEqual({
      month: "2026-10",
      paise: 2_800_000,
      firstDay: "2026-10-01",
      lastDay: "2026-10-31",
      dueDate: "2026-10-31",
    });
  });

  it("counts the joining month from the joining day and the leaving month to the last day, by calendar days", () => {
    // 16 of September's 30 days at ₹28,000.
    expect(salaryForMonth({ month: "2026-09", joinedOn: "2026-09-15", leftOn: null, steps })!.paise).toBe(1_493_300);
    // Left on 10 November: 10 of 30 days, paid on that day.
    expect(salaryForMonth({ month: "2026-11", joinedOn: "2026-09-15", leftOn: "2026-11-10", steps })).toMatchObject({ paise: 933_300, lastDay: "2026-11-10", dueDate: "2026-11-10" });
    expect(salaryForMonth({ month: "2026-12", joinedOn: "2026-09-15", leftOn: "2026-11-10", steps })).toBeNull();
    expect(salaryForMonth({ month: "2026-08", joinedOn: "2026-09-15", leftOn: null, steps })).toBeNull();
  });

  it("pays a change of salary from its day: the old rate before, the new from then", () => {
    const changed = [...steps, { from: "2026-10-16", monthlyPaise: 3_100_000 }];
    // 15 days at ₹28,000 and 16 at ₹31,000, of 31.
    expect(salaryForMonth({ month: "2026-10", joinedOn: "2026-09-15", leftOn: null, steps: changed })!.paise).toBe(Math.round((15 * 2_800_000 + 16 * 3_100_000) / 31 / 100) * 100);
    expect(salaryOn(changed, "2026-10-15")).toBe(2_800_000);
    expect(salaryOn(changed, "2026-10-16")).toBe(3_100_000);
    // Before the first salary's day (a joining day moved earlier), the first salary is paid.
    expect(salaryOn(changed, "2026-09-01")).toBe(2_800_000);
    expect(salaryOn([], "2026-09-01")).toBeNull();
  });

  it("makes every month from joining to this month, and nothing without a salary or before joining", () => {
    expect(salaryMonths({ joinedOn: "2026-09-15", leftOn: null, steps, today: "2026-10-16" }).map((entry) => entry.month)).toEqual(["2026-09", "2026-10"]);
    expect(salaryMonths({ joinedOn: "2026-09-15", leftOn: null, steps: [], today: "2026-10-16" })).toEqual([]);
    expect(salaryMonths({ joinedOn: "2026-11-01", leftOn: null, steps, today: "2026-10-16" })).toEqual([]);
    expect(salaryMonths({ joinedOn: "2026-09-15", leftOn: null, steps: [{ from: "2026-09-15", monthlyPaise: 0 }], today: "2026-10-16" })).toEqual([]);
  });

  it("words a month's salary for the expense book", () => {
    expect(salaryDescription({ month: "2026-10", firstDay: "2026-10-01", lastDay: "2026-10-31" })).toBe("Salary, October 2026");
    expect(salaryDescription({ month: "2026-09", firstDay: "2026-09-23", lastDay: "2026-09-30" })).toBe("Salary, September 2026 (23 to 30 Sept)");
  });
});

describe("what the API accepts", () => {
  it("takes a new member with their login number, role and joining day; the salary is optional", () => {
    const parsed = teamMemberSchema.parse({ name: " Imran ", phone: "90000 00006", role: "BDE", joinedOn: "2026-09-23", monthlySalaryPaise: 2_800_000 });
    expect(parsed).toMatchObject({ name: "Imran", phone: "+919000000006", role: "BDE", weeklyOff: 0, area: null });
    expect(teamMemberSchema.safeParse({ name: "X", phone: "123", role: "BDE", joinedOn: "2026-09-23" }).success).toBe(false);
    expect(teamMemberSchema.safeParse({ name: "X", phone: "9876543210", role: "SUPER_ADMIN", joinedOn: "2026-09-23" }).success).toBe(false);
  });

  it("takes a change of salary with its day", () => {
    expect(teamChangeSchema.parse({ salary: { monthlyPaise: 3_000_000, from: "2026-11-01" } })).toEqual({ salary: { monthlyPaise: 3_000_000, from: "2026-11-01" } });
    expect(teamChangeSchema.safeParse({ salary: { monthlyPaise: -1, from: "2026-11-01" } }).success).toBe(false);
  });

  it("takes leave of a day or a few, the first day first", () => {
    expect(leaveSchema.parse({ from: "2026-10-20", to: "2026-10-21", reason: "  wedding " })).toEqual({ from: "2026-10-20", to: "2026-10-21", reason: "wedding" });
    expect(leaveSchema.safeParse({ from: "2026-10-21", to: "2026-10-20" }).success).toBe(false);
    expect(leaveSchema.safeParse({ from: "2026-10-01", to: "2026-12-31" }).success).toBe(false);
  });
});
