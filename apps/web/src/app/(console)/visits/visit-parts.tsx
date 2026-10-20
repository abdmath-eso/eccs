"use client";

import { VISIT_SLOTS, visitSlotWindow, type SupervisorDto, type VisitSlot, type VisitStatus } from "@eccs/shared";

import { Field, SelectField } from "@/components/ui";

// Pieces the Visits tabs share: the List, the Week board and Waiting.

const clock = (hhmm: string) => {
  const [hours, minutes] = hhmm.split(":").map(Number) as [number, number];
  return new Intl.DateTimeFormat("en-IN", { timeZone: "UTC", hour: "numeric", minute: "2-digit" }).format(
    new Date(Date.UTC(2000, 0, 1, hours, minutes)),
  );
};

/** A two-hour arrival window as people read it, e.g. "10:00 am – 12:00 pm". */
export const slotName = (slot: VisitSlot) => {
  const window = visitSlotWindow(slot);
  return window ? `${clock(window.start)} – ${clock(window.end)}` : "After closing";
};

/** When a window starts, for a card with little room: "10:00 am", or "After closing". */
export const slotStart = (slot: VisitSlot | null) => {
  if (!slot) return "Time to be set";
  const window = visitSlotWindow(slot);
  return window ? clock(window.start) : "After closing";
};

/** An "HH:mm" time of day as people read it: "4:30 pm". */
export const timeOfDay = (hhmm: string) => clock(hhmm);

export const STATUS: Record<VisitStatus, { label: string; style: string }> = {
  SCHEDULED: { label: "No Supervisor yet", style: "border-danger text-danger" },
  ASSIGNED: { label: "Assigned", style: "border-foreground text-foreground" },
  IN_PROGRESS: { label: "In progress", style: "border-primary text-primary" },
  IN_REVIEW: { label: "Report to approve", style: "border-danger text-danger" },
  COMPLETED: { label: "Waiting for sign-off", style: "border-foreground text-foreground" },
  APPROVED: { label: "Signed off", style: "border-primary text-primary" },
  CANCELLED: { label: "Cancelled", style: "border-border-strong text-muted" },
};

export function StatusBadge({ status }: { status: VisitStatus }) {
  return (
    <span className={`inline-block rounded-full border px-2.5 py-0.5 text-xs font-semibold whitespace-nowrap ${STATUS[status].style}`}>
      {STATUS[status].label}
    </span>
  );
}

/** A visit cannot be put on a day that has gone, except that one already overdue may keep its day. */
export function checkDate(date: string, earliest: string): string | undefined {
  if (!date) return "Choose a date.";
  if (date < earliest) return "Choose today or a later date.";
  return undefined;
}

/** The day, time of day and Supervisor of a visit: used to confirm a request, add a visit and change one. */
export function WhenAndWho({
  date,
  slot,
  supervisorId,
  supervisors,
  earliest,
  dateError,
  onChange,
}: {
  date: string;
  slot: VisitSlot;
  supervisorId: string;
  supervisors: SupervisorDto[];
  /** The first day the calendar offers. */
  earliest: string;
  dateError?: string;
  onChange: (next: { date?: string; slot?: VisitSlot; supervisorId?: string }) => void;
}) {
  return (
    <div className="grid gap-3 sm:grid-cols-3">
      <Field label="Date" name="date" type="date" required min={earliest} value={date} error={dateError} onChange={(e) => onChange({ date: e.target.value })} />
      <SlotField value={slot} onChange={(next) => onChange({ slot: next })} />
      <SelectField label="Supervisor" name="supervisorId" value={supervisorId} onChange={(e) => onChange({ supervisorId: e.target.value })}>
        <option value="">Decide later</option>
        {supervisors.map((person) => (
          <option key={person.id} value={person.id}>
            {person.name}
          </option>
        ))}
      </SelectField>
    </div>
  );
}

/** The arrival window drop-down. */
export function SlotField({ value, onChange }: { value: VisitSlot; onChange: (slot: VisitSlot) => void }) {
  return (
    <SelectField label="Arrival time" name="slot" value={value} onChange={(e) => onChange(e.target.value as VisitSlot)}>
      {VISIT_SLOTS.map((option) => (
        <option key={option} value={option}>
          {slotName(option)}
        </option>
      ))}
    </SelectField>
  );
}
