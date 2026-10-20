"use client";

import type { FollowUpSource, FollowUpStanding, IncidentStatus } from "@eccs/shared";

// Pieces Quality's tabs and an incident's own page share.

export const plural = (count: number, one: string, many = `${one}s`) => `${count} ${count === 1 ? one : many}`;

/** "Today", "1 day", "3 days": how long a follow-up has waited. */
export const sinceWords = (days: number) => (days <= 0 ? "Today" : plural(days, "day"));

/** Where a follow-up's cause can be seen, and the words for the link. */
export function sourceLink(source: FollowUpSource): { href: string; label: string } {
  const q = encodeURIComponent;
  switch (source.kind) {
    case "VISIT":
      return { href: `/visits?visit=${q(source.visitId)}`, label: "See the rated visit" };
    case "ISSUE":
      return { href: `/issues?show=all&issue=${q(source.issueId)}`, label: "See the issue" };
    case "INSPECTION":
      return { href: `/inspections?inspection=${q(source.inspectionId)}`, label: "See the inspection" };
    case "HEALTH":
      return { href: `/clients?tab=health&outlet=${q(source.outletId)}`, label: "See its row on Health" };
  }
}

const STANDING_LOOK: Record<FollowUpStanding, { mark: string; style: string }> = {
  // Nothing booked needs the office: amber with a mark, as Today's warnings.
  NOT_BOOKED: { mark: "!", style: "border-amber-500 bg-amber-50 text-amber-900" },
  BOOKED: { mark: "✓", style: "border-primary bg-primary/5 text-primary" },
  DONE: { mark: "✓", style: "border-primary text-primary" },
  CLOSED: { mark: "–", style: "border-border-strong text-muted" },
};

/** Where a follow-up stands, in words with a mark beside them, never by colour alone. */
export function StandingBadge({ standing, words }: { standing: FollowUpStanding; words: string }) {
  const look = STANDING_LOOK[standing];
  return (
    <span className={`inline-flex items-center gap-1 rounded-full border px-2.5 py-0.5 text-xs font-semibold ${look.style}`}>
      <span aria-hidden="true">{look.mark}</span>
      {words}
    </span>
  );
}

/** "Open" or "Closed", in words with a mark. */
export function IncidentStatusBadge({ status }: { status: IncidentStatus }) {
  const open = status === "OPEN";
  return (
    <span
      className={`inline-flex items-center gap-1 rounded-full border px-2.5 py-0.5 text-xs font-semibold whitespace-nowrap ${
        open ? "border-amber-500 bg-amber-50 text-amber-900" : "border-primary text-primary"
      }`}
    >
      <span aria-hidden="true">{open ? "!" : "✓"}</span>
      {open ? "Open" : "Closed"}
    </span>
  );
}
