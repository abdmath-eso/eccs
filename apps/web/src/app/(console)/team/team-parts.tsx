"use client";

import {
  leaveSchema,
  leaveWords,
  markLeftSchema,
  TEAM_ROLE_LABELS,
  TEAM_ROLES,
  teamChangeSchema,
  teamMemberSchema,
  WEEKDAY_NAMES,
  type DayState,
  type PresenceDayDto,
  type TeamChangeInput,
  type TeamMemberDto,
  type TeamMemberInput,
  type TeamRole,
} from "@eccs/shared";
import { ApiError } from "@eccs/api-client";
import { useState, type CSSProperties, type FormEvent } from "react";

import { useToast } from "@/components/toast";
import { Button, ErrorMessage, Field, SelectField } from "@/components/ui";
import { api } from "@/lib/api";
import { checkAgainst, focusFirstError, hasErrors, type FieldErrors } from "@/lib/forms";
import { describe, today } from "@/lib/format";

import { COLOR, dayMonth, money, paiseField, Sheet, toPaise } from "../finance/finance-parts";

// Pieces the Team pages share (16 Oct 2026): a person's initials, the row of day squares,
// and the forms: add or change a team member, record leave, mark as left.

// ───────────────────────── Words ─────────────────────────

/** "BDE · Jubilee Hills · joined 23 September", as the design's line under the name. */
export function roleLine(person: Pick<TeamMemberDto, "role" | "area" | "joinedOn" | "leftOn">) {
  const joined = person.joinedOn ? `${person.joinedOn > today() ? "joins" : "joined"} ${longDate(person.joinedOn)}` : "no team details yet";
  return [TEAM_ROLE_LABELS[person.role], person.area, joined, person.leftOn ? `left ${longDate(person.leftOn)}` : null].filter(Boolean).join(" · ");
}

/** "23 September" this year, "23 September 2025" otherwise. */
export const longDate = (date: string) =>
  new Intl.DateTimeFormat("en-IN", { timeZone: "UTC", day: "numeric", month: "long", ...(date.slice(0, 4) !== today().slice(0, 4) && { year: "numeric" }) }).format(
    new Date(`${date}T00:00:00Z`),
  );

// ───────────────────────── Initials ─────────────────────────

/** The round badge with a person's initials, as the design has it beside the name. */
export function Initials({ text, size = "md" }: { text: string; size?: "md" | "lg" }) {
  const box = size === "lg" ? "h-14 w-14 text-lg" : "h-9 w-9 text-sm";
  return (
    <span aria-hidden className={`flex shrink-0 items-center justify-center rounded-full bg-primary/10 font-bold text-primary ${box}`}>
      {text}
    </span>
  );
}

// ───────────────────────── The last 14 days ─────────────────────────

/**
 * One square a day (GitHub's contribution graph, made a row): blue when in, a lighter
 * grey-blue on leave, light grey on the day off, an outline when not in, a dashed outline
 * for today before anything is done. Every square is titled with its day and what it was,
 * and the line under the row says the same in words, so colour is never alone.
 */
const SQUARE: Record<DayState, { className: string; style?: CSSProperties; words: string }> = {
  IN: { className: "", style: { background: COLOR.in }, words: "in" },
  LEAVE: { className: "", style: { background: "#9DB0C9" }, words: "on leave" },
  OFF: { className: "", style: { background: "#E3E5E8" }, words: "day off" },
  TODAY: { className: "border-2 border-dashed", style: { borderColor: COLOR.in }, words: "today, nothing yet" },
  NOT_IN: { className: "border-2", style: { borderColor: "#9AA1AB", background: "#FFFFFF" }, words: "not in" },
  NO_RECORD: { className: "border border-dotted", style: { borderColor: "#C9CDD3" }, words: "nothing to read yet" },
  NOT_ON_TEAM: { className: "border border-dotted", style: { borderColor: "#E3E5E8" }, words: "not on the team" },
};

/** What a square means, for its title and for screen readers. */
function squareWords(day: PresenceDayDto) {
  const date = new Intl.DateTimeFormat("en-IN", { timeZone: "UTC", weekday: "short", day: "numeric", month: "short" }).format(new Date(`${day.date}T00:00:00Z`)).replace(",", "");
  if (day.state === "IN") return `${date}: in from ${day.firstAt}${day.dayOff ? " (a day off)" : ""}${day.onLeave ? " (on leave)" : ""}`;
  if (day.state === "LEAVE") return `${date}: on leave${day.leaveReason ? ` (${day.leaveReason})` : ""}`;
  return `${date}: ${SQUARE[day.state].words}`;
}

export function DaySquares({ days }: { days: readonly PresenceDayDto[] }) {
  return (
    // Fourteen columns of at most 24px, narrower on a phone, so the two weeks stay on one row.
    <ol className="grid gap-1 sm:gap-1.5" style={{ gridTemplateColumns: `repeat(${days.length}, minmax(0, 1.5rem))` }} aria-label="The last 14 days, oldest first">
      {days.map((day) => {
        const look = SQUARE[day.state];
        const words = squareWords(day);
        return (
          <li key={day.date} title={words} className={`aspect-square w-full rounded-[5px] ${look.className}`} style={look.style}>
            <span className="sr-only">{words}</span>
          </li>
        );
      })}
    </ol>
  );
}

/** The key under the squares: only the kinds that are on show. */
export function DayLegend({ days }: { days: readonly PresenceDayDto[] }) {
  const shown = (["IN", "LEAVE", "OFF", "NOT_IN"] as const).filter((state) => days.some((day) => day.state === state));
  const label: Record<(typeof shown)[number], string> = { IN: "In", LEAVE: "On leave", OFF: "Day off", NOT_IN: "Not in" };
  return (
    <ul aria-hidden className="flex flex-wrap gap-x-3 gap-y-1 text-xs text-muted">
      {shown.map((state) => (
        <li key={state} className="flex items-center gap-1.5">
          <span className={`h-3 w-3 rounded-[3px] ${SQUARE[state].className.replace("border-2", "border")}`} style={SQUARE[state].style} />
          {label[state]}
        </li>
      ))}
    </ul>
  );
}

// ───────────────────────── Add or change a team member ─────────────────────────

/**
 * Add a team member, or change one (the Super Admin), in a panel from the right.
 * PATTERN FOLLOWED: the "invite a user" forms of small-team tools (LeadSquared's user
 * management, Zoho People's add employee): who they are and their login first, then their
 * role and area, then the joining day and pay. Their login is their mobile number; they log
 * in as ECCS staff with a one-time code.
 */
export function MemberSheet({
  open,
  member,
  seesPay,
  onClose,
  onSaved,
}: {
  open: boolean;
  member: TeamMemberDto | null;
  /** The Super Admin: sees and sets the salary. */
  seesPay: boolean;
  onClose: () => void;
  onSaved: (member: TeamMemberDto) => void;
}) {
  const title = member ? (member.memberId ? `Change ${member.name}'s details` : `Add ${member.name}'s details`) : "Add a team member";
  return (
    <Sheet open={open} title={title} onClose={onClose}>
      {open && <MemberForm key={member?.userId ?? "new"} member={member} seesPay={seesPay} onClose={onClose} onSaved={onSaved} />}
    </Sheet>
  );
}

function MemberForm({ member, seesPay, onClose, onSaved }: { member: TeamMemberDto | null; seesPay: boolean; onClose: () => void; onSaved: (member: TeamMemberDto) => void }) {
  const notify = useToast();
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [errors, setErrors] = useState<FieldErrors>({});
  const founder = member?.role === "SUPER_ADMIN";
  const current = member?.salary?.monthlyPaise ?? null;

  async function save(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const form = event.currentTarget;
    const values = new FormData(form);
    const text = (name: string) => String(values.get(name) ?? "").trim();
    const salaryText = text("salary");
    const salary = salaryText ? toPaise(salaryText) : null;
    const found: FieldErrors = {};
    if (salaryText && (salary === null || salary < 0)) found.salary = "Enter the monthly salary in rupees, for example 28000";
    try {
      setBusy(true);
      setError(null);
      if (!member) {
        const input: TeamMemberInput = {
          name: text("name"),
          phone: text("phone"),
          role: text("role") as TeamRole,
          area: text("area") || null,
          joinedOn: text("joinedOn"),
          weeklyOff: Number(text("weeklyOff")),
          monthlySalaryPaise: salary,
          // Onboarding (16 Oct 2026): their role's checklist copied to them; ticked unless the founder unticks it.
          startOnboarding: values.get("startOnboarding") === "on",
        };
        Object.assign(found, checkAgainst(teamMemberSchema, input));
        if (found.monthlySalaryPaise) found.salary = found.monthlySalaryPaise;
        setErrors(found);
        if (hasErrors(found)) return focusFirstError(form, found);
        const saved = await api.eccsTeam.add(input);
        notify(`${saved.name} added. They log in with ${text("phone")} and a one-time code.`, input.startOnboarding ? { detail: "Onboarding started: send them the joining link from their page." } : undefined);
        onSaved(saved);
      } else {
        const input: TeamChangeInput = {
          name: text("name"),
          phone: text("phone"),
          ...(!founder && { role: text("role") as TeamRole }),
          area: text("area") || null,
          joinedOn: text("joinedOn"),
          weeklyOff: Number(text("weeklyOff")),
          // A salary is sent only when it changes, from the day chosen.
          ...(salary !== null && salary !== current && { salary: { monthlyPaise: salary, from: text("salaryFrom") || today() } }),
        };
        Object.assign(found, checkAgainst(teamChangeSchema, input));
        setErrors(found);
        if (hasErrors(found)) return focusFirstError(form, found);
        const saved = await api.eccsTeam.change(member.userId, input);
        notify("Saved");
        onSaved(saved);
      }
      onClose();
    } catch (e) {
      setError(describe(e));
    } finally {
      setBusy(false);
    }
  }

  return (
    <form onSubmit={(event) => void save(event)} noValidate className="flex flex-col gap-4">
      {member?.isSample && <p className="text-sm text-muted">A sample team member. The sample team can be removed in one go before real use.</p>}
      <Field label="Name" name="name" required maxLength={80} defaultValue={member?.name ?? ""} error={errors.name} />
      <Field
        label="Mobile number"
        name="phone"
        type="tel"
        inputMode="numeric"
        required
        autoComplete="off"
        defaultValue={member?.phone ?? ""}
        hint="Their login: they log in as ECCS staff with this number and a one-time code"
        error={errors.phone}
      />
      <div className="grid gap-4 sm:grid-cols-2">
        {founder ? (
          <Field label="Role" name="roleShown" value="Super Admin (a founder)" readOnly plainLabel />
        ) : (
          <SelectField label="Role" name="role" defaultValue={member?.role ?? "BDE"} error={errors.role}>
            {TEAM_ROLES.map((role) => (
              <option key={role} value={role}>
                {TEAM_ROLE_LABELS[role]}
              </option>
            ))}
          </SelectField>
        )}
        <Field label="Area" name="area" maxLength={60} defaultValue={member?.area ?? ""} hint="Where they work, for example Jubilee Hills" error={errors.area} />
      </div>
      <div className="grid gap-4 sm:grid-cols-2">
        <Field
          label={member?.memberId ? "Joined on" : "Joins on"}
          name="joinedOn"
          type="date"
          required
          defaultValue={member?.joinedOn ?? today()}
          hint={member?.memberId ? undefined : "A day ahead is fine"}
          error={errors.joinedOn}
        />
        <SelectField label="Weekly day off" name="weeklyOff" defaultValue={String(member?.weeklyOff ?? 0)} error={errors.weeklyOff}>
          {WEEKDAY_NAMES.map((name, index) => (
            <option key={name} value={index}>
              {name}
            </option>
          ))}
        </SelectField>
      </div>
      {seesPay && (
        <div className="grid gap-4 sm:grid-cols-2">
          <Field
            label="Monthly salary (₹)"
            name="salary"
            inputMode="decimal"
            defaultValue={current !== null ? paiseField(current) : ""}
            hint={member?.memberId ? "A new figure is paid from the day beside it" : "Paid from the joining day; leave days are paid"}
            error={errors.salary}
          />
          {member?.memberId && <Field label="From" name="salaryFrom" type="date" required defaultValue={today()} hint="The first day at a new salary" />}
        </div>
      )}
      {!member && seesPay && (
        <label className="flex items-start gap-2.5 text-sm">
          <input type="checkbox" name="startOnboarding" defaultChecked className="mt-0.5 h-4 w-4 shrink-0 accent-primary" />
          <span>
            <span className="font-semibold">Start onboarding</span>
            <span className="block text-muted">Their role&apos;s joining checklist, the joining file to fill in and the appointment letter.</span>
          </span>
        </label>
      )}
      <ErrorMessage message={error} />
      <div className="flex gap-2 border-t border-border pt-4">
        <Button type="submit" loading={busy}>
          {member ? "Save" : "Add to the team"}
        </Button>
        <Button type="button" variant="secondary" onClick={onClose}>
          Cancel
        </Button>
      </div>
    </form>
  );
}

// ───────────────────────── Leave ─────────────────────────

/** A day or a few days off (the Super Admin or the Ops Manager), as small-team leave trackers record it. */
export function LeaveSheet({ member, onClose, onSaved }: { member: TeamMemberDto | null; onClose: () => void; onSaved: (member: TeamMemberDto) => void }) {
  return (
    <Sheet open={member !== null} title={member ? `Leave for ${member.name}` : "Leave"} onClose={onClose}>
      {member && <LeaveForm key={member.userId} member={member} onClose={onClose} onSaved={onSaved} />}
    </Sheet>
  );
}

function LeaveForm({ member, onClose, onSaved }: { member: TeamMemberDto; onClose: () => void; onSaved: (member: TeamMemberDto) => void }) {
  const notify = useToast();
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [errors, setErrors] = useState<FieldErrors>({});
  async function save(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const form = event.currentTarget;
    const values = new FormData(form);
    const text = (name: string) => String(values.get(name) ?? "").trim();
    const input = { from: text("from"), to: text("to") || text("from"), reason: text("reason") || null };
    const found = checkAgainst(leaveSchema, input);
    setErrors(found);
    if (hasErrors(found)) return focusFirstError(form, found);
    setBusy(true);
    setError(null);
    try {
      onSaved(await api.eccsTeam.addLeave(member.userId, input));
      notify(`Leave recorded: ${leaveWords(input)}`);
      onClose();
    } catch (e) {
      setError(describe(e));
    } finally {
      setBusy(false);
    }
  }
  return (
    <form onSubmit={(event) => void save(event)} noValidate className="flex flex-col gap-4">
      <p className="text-sm text-muted">Leave days show on the squares and are never counted as days missed. They are paid.</p>
      <div className="grid gap-4 sm:grid-cols-2">
        <Field label="First day" name="from" type="date" required defaultValue={today()} error={errors.from} />
        <Field label="Last day" name="to" type="date" required defaultValue={today()} error={errors.to} />
      </div>
      <Field label="Reason" name="reason" maxLength={60} hint="A few words, for example “family function”. Keep medical details out." error={errors.reason} />
      <ErrorMessage message={error} />
      <div className="flex gap-2 border-t border-border pt-4">
        <Button type="submit" loading={busy}>
          Record leave
        </Button>
        <Button type="button" variant="secondary" onClick={onClose}>
          Cancel
        </Button>
      </div>
    </form>
  );
}

// ───────────────────────── Mark as left ─────────────────────────

/**
 * Their last day: the login stops working, their records stay, their salary is counted to
 * that day, and anyone who owns open leads hands them to someone first, so no lead is ever
 * left with nobody.
 */
export function LeftSheet({ member, onClose, onSaved }: { member: TeamMemberDto | null; onClose: () => void; onSaved: (member: TeamMemberDto) => void }) {
  return (
    <Sheet open={member !== null} title={member ? `${member.name} has left` : "Has left"} onClose={onClose}>
      {member && <LeftForm key={member.userId} member={member} onClose={onClose} onSaved={onSaved} />}
    </Sheet>
  );
}

function LeftForm({ member, onClose, onSaved }: { member: TeamMemberDto; onClose: () => void; onSaved: (member: TeamMemberDto) => void }) {
  const notify = useToast();
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [errors, setErrors] = useState<FieldErrors>({});
  const options = [...member.handTo].sort((a, b) => Number(b.isBde) - Number(a.isBde) || a.name.localeCompare(b.name));
  async function save(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const form = event.currentTarget;
    const values = new FormData(form);
    const text = (name: string) => String(values.get(name) ?? "").trim();
    const input = { leftOn: text("leftOn"), handTo: member.openLeads > 0 ? text("handTo") || null : null };
    const found = checkAgainst(markLeftSchema, input);
    if (input.leftOn > today()) found.leftOn = "Mark them as left on their last day, not before";
    if (member.openLeads > 0 && !input.handTo) found.handTo = "Choose who takes their leads over";
    setErrors(found);
    if (hasErrors(found)) return focusFirstError(form, found);
    setBusy(true);
    setError(null);
    try {
      onSaved(await api.eccsTeam.markLeft(member.userId, input));
      notify(`${member.name} is marked as left`);
      onClose();
    } catch (e) {
      setError(e instanceof ApiError && e.code === "OPEN_LEADS" ? `${e.message}` : describe(e));
    } finally {
      setBusy(false);
    }
  }
  return (
    <form onSubmit={(event) => void save(event)} noValidate className="flex flex-col gap-4">
      <p className="text-sm text-muted">From this day they can no longer log in. Their records stay, and their salary is counted to this day.</p>
      <Field label="Last day" name="leftOn" type="date" required max={today()} defaultValue={today()} error={errors.leftOn} />
      {member.openLeads > 0 && (
        <SelectField label={`Hand their ${member.openLeads} open ${member.openLeads === 1 ? "lead" : "leads"} to`} name="handTo" defaultValue="" error={errors.handTo}>
          <option value="">Choose…</option>
          {options.map((person) => (
            <option key={person.id} value={person.id}>
              {person.name}
              {person.isBde ? "" : " (not a BDE)"}
            </option>
          ))}
        </SelectField>
      )}
      {member.upcomingVisits > 0 && (
        <p className="text-sm font-semibold text-danger">
          {member.upcomingVisits} {member.upcomingVisits === 1 ? "visit is" : "visits are"} given to them from today: give {member.upcomingVisits === 1 ? "it" : "them"} to another Supervisor on the Visits page.
        </p>
      )}
      <ErrorMessage message={error} />
      <div className="flex gap-2 border-t border-border pt-4">
        <Button type="submit" variant="danger" loading={busy}>
          Mark as left
        </Button>
        <Button type="button" variant="secondary" onClick={onClose}>
          Cancel
        </Button>
      </div>
    </form>
  );
}

/** "₹28,000 a month from 23 Sep; ₹30,000 from 1 Oct". */
export function salaryWords(history: readonly { from: string; monthlyPaise: number }[]) {
  return history.map((step, index) => `${money(step.monthlyPaise)}${index === 0 ? " a month" : ""} from ${dayMonth(step.from)}`).join("; ");
}
