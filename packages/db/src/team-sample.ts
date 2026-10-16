import type { PrismaClient } from "../generated/prisma/client.js";

// The sample team for the console's Team page (16 Oct 2026), so the pages can be seen
// before the founder adds the real team: team details for the sample ECCS logins (the Ops
// Manager, the Supervisor and the three sample BDEs, found by their phone numbers), with
// areas, joining dates in September 2026, monthly salaries that together come close to the
// Lean budget's ₹1,70,000 (one with a raise from 1 October), and a few days of leave.
//
// Presence is not written here: the Team page reads it from the sample's own lead steps,
// visits and the activity log, as it does for real. What this adds besides the team details:
// - each sample BDE's first lead of the morning, logged today from the field (if that time
//   has passed), so "in today" has something to read;
// - the history of their next steps' due times over the last two weeks (LeadFollowUp), which
//   the app keeps only from 16 Oct on, so "follow-ups on time" has something to read;
// - the months of salary already over, as paid on the month's last day. This month's is made
//   by the app itself from the salaries, as it is for real, and stays owed until marked paid.
// The Finance sample's two hand-entered salary rows are taken out, because Team now makes
// the salaries; with both, the salaries would count twice.
//
// Nothing is wiped. Every row is marked `isSample` (with its own `sampleKey` where it needs
// one), so loading again adds only what is missing and never doubles a row, and
// `removeTeamSample` takes every sample row of the team out in one go. A login that already
// has team details is left as it is. The logins themselves are the seed's and the Sales
// sample's, and stay.
//
// Role and kind keys are those of packages/shared/src/team.ts and sales.ts (this package
// does not depend on that one). A past month's salary is worked out the way the app does:
// the monthly salary × days on the team that month ÷ days in the month, to the rupee.

type Db = Pick<PrismaClient, "user" | "teamMember" | "teamSalary" | "teamLeave" | "expense" | "lead" | "leadActivity" | "leadFollowUp">;

interface SampleMember {
  key: string;
  phone: string;
  area: string;
  joinedOn: string;
  /** [from, rupees a month]. */
  salaries: [string, number][];
  leave: { offset: number | "quiet-tuesday"; days: number; reason: string } | null;
  /** The first lead logged this morning: its time and the shop. */
  morning: { time: string; name: string } | null;
  /** The share of next steps that were late, this week and last week. */
  late: { thisWeek: number; lastWeek: number } | null;
}

/** The sample ECCS logins (seed: 9000000002 and 9000000003; Sales sample: 9000000004 to 9000000006). */
export const SAMPLE_TEAM: readonly SampleMember[] = [
  { key: "ops", phone: "+919000000002", area: "Head office, Madhapur", joinedOn: "2026-09-01", salaries: [["2026-09-01", 45_000]], leave: null, morning: null, late: null },
  {
    key: "supervisor",
    phone: "+919000000003",
    area: "Jubilee Hills and Banjara Hills",
    joinedOn: "2026-09-08",
    salaries: [["2026-09-08", 35_000]],
    leave: { offset: -4, days: 1, reason: "personal work" },
    morning: null,
    late: null,
  },
  {
    key: "ravi",
    phone: "+919000000004",
    area: "Banjara Hills",
    joinedOn: "2026-09-15",
    salaries: [
      ["2026-09-15", 28_000],
      ["2026-10-01", 30_000],
    ],
    leave: null,
    morning: { time: "09:15", name: "Hotel Sitara, Road No. 12 (sample)" },
    late: { thisWeek: 0.08, lastWeek: 0.1 },
  },
  {
    key: "sana",
    phone: "+919000000005",
    area: "Gachibowli",
    joinedOn: "2026-09-15",
    salaries: [["2026-09-15", 30_000]],
    leave: { offset: 4, days: 2, reason: "sister's wedding" },
    morning: { time: "10:05", name: "Biryani Point, DLF Road (sample)" },
    late: { thisWeek: 0.06, lastWeek: 0.08 },
  },
  {
    key: "imran",
    phone: "+919000000006",
    area: "Jubilee Hills",
    joinedOn: "2026-09-23",
    salaries: [["2026-09-23", 28_000]],
    leave: { offset: "quiet-tuesday", days: 1, reason: "family function" },
    morning: { time: "09:40", name: "Shah Ghouse Cafe, Film Nagar (sample)" },
    late: { thisWeek: 0.29, lastWeek: 0.12 },
  },
];

const DAY_MS = 86_400_000;
const toTime = (date: string) => Date.parse(`${date}T00:00:00.000Z`);
const addDays = (date: string, days: number) => new Date(toTime(date) + days * DAY_MS).toISOString().slice(0, 10);
const toDb = (date: string) => new Date(`${date}T00:00:00.000Z`);
const indiaDay = (at: Date) => new Intl.DateTimeFormat("en-CA", { timeZone: "Asia/Kolkata" }).format(at);
const moment = (date: string, time: string) => new Date(`${date}T${time}:00.000+05:30`);
const weekday = (date: string) => new Date(`${date}T00:00:00Z`).getUTCDay();
const mondayOf = (date: string) => addDays(date, -((weekday(date) + 6) % 7));
const monthOf = (date: string) => date.slice(0, 7);
const daysInMonth = (month: string) => new Date(Date.UTC(Number(month.slice(0, 4)), Number(month.slice(5, 7)), 0)).getUTCDate();
const monthEnd = (month: string) => `${month}-${String(daysInMonth(month)).padStart(2, "0")}`;
const addMonths = (month: string, count: number) => new Date(Date.UTC(Number(month.slice(0, 4)), Number(month.slice(5, 7)) - 1 + count, 1)).toISOString().slice(0, 7);
const rupees = (amount: number) => Math.round(amount * 100);
const monthWords = (month: string) => new Intl.DateTimeFormat("en-IN", { timeZone: "UTC", month: "long", year: "numeric" }).format(toDb(`${month}-01`));
const dayShort = (date: string) => new Intl.DateTimeFormat("en-IN", { timeZone: "UTC", day: "numeric", month: "short" }).format(toDb(date));

/** The person steps of a lead's timeline (the app's own events have nobody). */
const PERSON_KINDS = ["CREATED", "CALL", "VISIT", "NOTE", "CHECK_BOOKED", "CHECK_DONE", "ASKED", "QUOTE_SENT", "PARKED", "LOST", "REOPENED", "LINKED"];

/** A past month's salary, as the app works it out (see packages/shared/src/team.ts, salaryForMonth). */
function pastSalary(member: SampleMember, month: string) {
  const first = member.joinedOn > `${month}-01` ? member.joinedOn : `${month}-01`;
  const last = monthEnd(month);
  if (last < first) return null;
  const steps = member.salaries.map(([from, amount]) => ({ from, paise: rupees(amount) })).sort((a, b) => a.from.localeCompare(b.from));
  let numerator = 0;
  for (let day = first; day <= last; day = addDays(day, 1)) {
    numerator += [...steps].reverse().find((step) => step.from <= day)?.paise ?? steps[0]!.paise;
  }
  const paise = Math.round(numerator / daysInMonth(month) / 100) * 100;
  const whole = first === `${month}-01`;
  return { paise, first, last, description: `Salary, ${monthWords(month)}${whole ? "" : ` (${Number(first.slice(8))} to ${dayShort(last)})`}` };
}

/**
 * Adds the sample team (India's today and now unless given), leaving everything else alone.
 * Rows already loaded are kept as they are.
 */
export async function loadTeamSample(db: Db, options: { now?: Date } = {}) {
  const now = options.now ?? new Date();
  const today = indiaDay(now);
  const added = { members: 0, salaries: 0, leave: 0, paidMonths: 0, leads: 0, followUps: 0, financeSalariesRemoved: 0 };

  // The Finance sample's hand-entered salaries: the team's salaries come from Team now.
  added.financeSalariesRemoved = (await db.expense.deleteMany({ where: { isSample: true, teamMemberId: null, sampleKey: { startsWith: "sample-salaries-" } } })).count;

  for (const member of SAMPLE_TEAM) {
    const user = await db.user.findUnique({ where: { phone: member.phone }, select: { id: true, name: true, teamMember: { select: { id: true, isSample: true } } } });
    if (!user) continue;
    // A login the founder has already given team details is left as it is.
    if (user.teamMember && !user.teamMember.isSample) continue;

    let memberId = user.teamMember?.id ?? null;
    if (!memberId) {
      const created = await db.teamMember.create({
        data: { userId: user.id, area: member.area, joinedOn: toDb(member.joinedOn), weeklyOff: 0, isSample: true, sampleKey: `sample-team-${member.key}` },
      });
      memberId = created.id;
      added.members += 1;
    }
    added.salaries += (
      await db.teamSalary.createMany({
        data: member.salaries.map(([from, amount]) => ({ memberId: memberId!, from: toDb(from), monthlyPaise: rupees(amount), isSample: true })),
        skipDuplicates: true,
      })
    ).count;

    // The months already over: paid by bank transfer on the month's last day.
    const thisMonth = monthOf(today);
    for (let month = monthOf(member.joinedOn); month < thisMonth; month = addMonths(month, 1)) {
      const salary = pastSalary(member, month);
      if (!salary) continue;
      const exists = await db.expense.findFirst({ where: { teamMemberId: memberId, salaryMonth: month }, select: { id: true } });
      if (exists) continue;
      await db.expense.create({
        data: {
          kind: "EXPENSE",
          date: toDb(salary.first),
          category: "SALARIES",
          vendor: user.name,
          description: salary.description,
          amountPaise: salary.paise,
          paidVia: "bank-transfer",
          paidOn: toDb(salary.last),
          teamMemberId: memberId,
          salaryMonth: month,
          isSample: true,
          sampleKey: `sample-team-salary-${member.key}-${month}`,
        },
      });
      added.paidMonths += 1;
    }

    // Leave: a day in the last two weeks, or a few days ahead.
    if (member.leave) {
      let from: string;
      if (member.leave.offset === "quiet-tuesday") {
        // A working day of the last two weeks on which this BDE logged nothing, a Tuesday if there is one.
        const steps = await db.leadActivity.findMany({ where: { byId: user.id, at: { gte: moment(addDays(today, -13), "00:00") } }, select: { at: true } });
        const worked = new Set(steps.map((step) => indiaDay(step.at)));
        const quiet: string[] = [];
        for (let day = addDays(today, -13); day < today; day = addDays(day, 1)) if (weekday(day) !== 0 && !worked.has(day)) quiet.push(day);
        from = quiet.find((day) => weekday(day) === 2) ?? quiet[0] ?? addDays(mondayOf(today), -6);
      } else {
        from = addDays(today, member.leave.offset);
        while (weekday(from) === 0) from = addDays(from, 1);
      }
      added.leave += (
        await db.teamLeave.createMany({
          data: [{ memberId, from: toDb(from), to: toDb(addDays(from, member.leave.days - 1)), reason: member.leave.reason, isSample: true, sampleKey: `sample-team-leave-${member.key}` }],
          skipDuplicates: true,
        })
      ).count;
    }

    // This morning's first lead, logged from the field.
    if (member.morning) {
      const at = moment(today, member.morning.time);
      const key = `sample-team-lead-${member.key}-${today}`;
      if (at.getTime() <= now.getTime() && !(await db.lead.findUnique({ where: { sampleKey: key }, select: { id: true } }))) {
        const area = member.area;
        await db.lead.create({
          data: {
            businessName: member.morning.name,
            area,
            address: `${area}, Hyderabad`,
            contactName: "Owner",
            // The Sales sample's made-up form (+91 90000 2xxxx), past its own numbers; never dialled.
            contactPhone: `+9190000${29_900 + SAMPLE_TEAM.indexOf(member)}`,
            kitchens: 1,
            source: "FIELD_VISIT",
            ownerId: user.id,
            createdById: user.id,
            lastActivityAt: at,
            createdAt: at,
            isSample: true,
            sampleKey: key,
            activities: { create: { kind: "CREATED", at, byId: user.id, isSample: true, sampleKey: `${key}:0`, createdAt: at } },
          },
        });
        added.leads += 1;
      }
    }

    if (member.late) added.followUps += await sampleFollowUps(db, user.id, member.late, now, today);
  }
  return added;
}

/**
 * The due times of a sample BDE's next steps over the last two weeks, from their sample
 * leads' own timelines: between two steps on a lead, a next step was set just after the first
 * and fell due either after the second (on time) or before it (late, at the share given).
 * And each sample lead's current next step, from when it was set.
 */
async function sampleFollowUps(db: Db, userId: string, late: { thisWeek: number; lastWeek: number }, now: Date, today: string): Promise<number> {
  const weekStart = mondayOf(today);
  const lastWeekStart = addDays(weekStart, -7);
  const leads = await db.lead.findMany({
    where: { ownerId: userId, isSample: true },
    select: { id: true, nextActionAt: true, lastActivityAt: true, activities: { where: { kind: { in: PERSON_KINDS }, byId: { not: null } }, orderBy: { at: "asc" }, select: { id: true, at: true } } },
  });
  const pairs: { leadId: string; activityId: string; previous: Date; step: Date }[] = [];
  for (const lead of leads) {
    for (let index = 1; index < lead.activities.length; index += 1) {
      const previous = lead.activities[index - 1]!.at;
      const step = lead.activities[index]!.at;
      if (step.getTime() - previous.getTime() < 10 * 60_000) continue;
      if (indiaDay(step) < lastWeekStart || step.getTime() > now.getTime()) continue;
      pairs.push({ leadId: lead.id, activityId: lead.activities[index]!.id, previous, step });
    }
  }
  pairs.sort((a, b) => a.step.getTime() - b.step.getTime());
  const rows: { leadId: string; ownerId: string; setAt: Date; dueAt: Date; endedAt: Date | null; isSample: boolean; sampleKey: string }[] = [];
  for (const week of [lastWeekStart, weekStart]) {
    const share = week === weekStart ? late.thisWeek : late.lastWeek;
    const inWeek = pairs.filter((pair) => indiaDay(pair.step) >= week && indiaDay(pair.step) <= addDays(week, 6));
    inWeek.forEach((pair, index) => {
      // Late ones spread evenly through the week.
      const isLate = Math.floor((index + 1) * share) > Math.floor(index * share);
      const setAt = new Date(pair.previous.getTime() + 60_000);
      const dueAt = isLate ? new Date((setAt.getTime() + pair.step.getTime()) / 2) : new Date(pair.step.getTime() + 2 * 3_600_000);
      rows.push({ leadId: pair.leadId, ownerId: userId, setAt, dueAt, endedAt: pair.step, isSample: true, sampleKey: `sample-team-fu-${pair.activityId}` });
    });
  }
  // Each lead's next step now, from the last step logged, unless the app keeps one for it already.
  for (const lead of leads) {
    if (!lead.nextActionAt || lead.nextActionAt.getTime() <= lead.lastActivityAt.getTime()) continue;
    const open = await db.leadFollowUp.count({ where: { leadId: lead.id, endedAt: null } });
    if (open > 0) continue;
    rows.push({ leadId: lead.id, ownerId: userId, setAt: lead.lastActivityAt, dueAt: lead.nextActionAt, endedAt: null, isSample: true, sampleKey: `sample-team-fu-open-${lead.id}` });
  }
  return (await db.leadFollowUp.createMany({ data: rows, skipDuplicates: true })).count;
}

/**
 * Takes the sample team out: the team details of the sample logins with their salaries,
 * leave and salary rows (paid or not), the sample follow-up history, and this morning's
 * sample leads. The logins stay (they are the seed's and the Sales sample's), and nothing
 * real is touched. The Finance sample's old hand-entered salaries are not put back.
 */
export async function removeTeamSample(db: Db) {
  const members = await db.teamMember.findMany({ where: { isSample: true }, select: { id: true } });
  const ids = members.map((member) => member.id);
  const removed = { members: 0, salaryRows: 0, followUps: 0, leads: 0 };
  removed.salaryRows = (await db.expense.deleteMany({ where: { teamMemberId: { in: ids } } })).count;
  // Their salaries and leave go with them.
  removed.members = (await db.teamMember.deleteMany({ where: { id: { in: ids } } })).count;
  removed.followUps = (await db.leadFollowUp.deleteMany({ where: { isSample: true } })).count;
  removed.leads = (await db.lead.deleteMany({ where: { isSample: true, sampleKey: { startsWith: "sample-team-lead-" } } })).count;
  return removed;
}
