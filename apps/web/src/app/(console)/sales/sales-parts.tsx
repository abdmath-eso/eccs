"use client";

import {
  LEAD_SOURCE_LABELS,
  LEAD_SOURCES,
  LEAD_STAGE_LABELS,
  LEAD_STAGES,
  leadSchema,
  leadUpdateSchema,
  isReferral,
  parkSchema,
  type DoTodayItemDto,
  type LeadDetailDto,
  type LeadInput,
  type LeadSource,
  type LeadStage,
  QUOTE_STATE_LABELS,
  type QuoteState,
  type SalesPersonDto,
} from "@eccs/shared";
import Link from "next/link";
import { useState, type FormEvent, type ReactNode } from "react";

import { useToast } from "@/components/toast";
import { Button, ErrorMessage, Field, PageTabs, SelectField } from "@/components/ui";
import { api } from "@/lib/api";
import { checkAgainst, focusFirstError, hasErrors, type FieldErrors } from "@/lib/forms";
import { addDays, describe, today } from "@/lib/format";

import { money, saveFile, Sheet } from "../finance/finance-parts";

// Pieces the Sales pages share (15 Oct 2026): the stage colours, the stage bar and the
// small weekly bars on the cards, the lead form, Park, and Call (which also logs the call).

// ───────────────────────── The tabs ─────────────────────────

/**
 * Sales' three tabs (the console plan, 20 Oct 2026: Overview · Leads · Quotes), each its own
 * address, so a link to the Quotes list or a filtered Leads list works as before. They
 * replace the buttons that led between the Sales page and All leads.
 */
export function SalesTabs({ current }: { current: "overview" | "leads" | "quotes" }) {
  return (
    <PageTabs
      label="Sales"
      tabs={[
        { href: "/sales", label: "Overview", current: current === "overview" },
        { href: "/sales/leads", label: "Leads", current: current === "leads" },
        { href: "/sales/quotes", label: "Quotes", current: current === "quotes" },
      ]}
    />
  );
}

// ───────────────────────── Colours ─────────────────────────

/**
 * The stages as one blue running light to dark, left to right (a sequential scale: how far
 * along a lead is), as the founder's design draws them. Every segment also carries its
 * number and the legend names it, so colour is never alone.
 */
export const STAGE_COLOR: Record<LeadStage, string> = {
  NEW: "#BCD3F3",
  CONTACTED: "#8DB4EC",
  CHECK_BOOKED: "#5F95E3",
  CHECK_DONE: "#3C7BD9",
  QUOTED: "#2963BD",
  FIRST_JOB: "#1F4E9C",
  ON_PLAN: "#163A75",
};
/** Dark writing on the three lightest stages, white on the rest. */
export const STAGE_INK: Record<LeadStage, string> = {
  NEW: "#10233F",
  CONTACTED: "#10233F",
  CHECK_BOOKED: "#0B1A30",
  CHECK_DONE: "#FFFFFF",
  QUOTED: "#FFFFFF",
  FIRST_JOB: "#FFFFFF",
  ON_PLAN: "#FFFFFF",
};

/** The two growth lines (checked with the palette validator: apart for colour-blind readers, 3:1 on white). */
export const LINE = { kitchens: "#1F4E9C", people: "#4F95E6" } as const;

/** Targets: on pace, one behind, two or more behind. Always with words beside them. */
export const STATUS = {
  GREEN: { color: "#2E7D32", words: "every target on pace" },
  AMBER: { color: "#B26A00", words: "one target behind" },
  RED: { color: "#C62828", words: "two or more targets behind" },
} as const;

// ───────────────────────── Words ─────────────────────────

/** "today", "yesterday", "3 days ago". */
export function ago(iso: string) {
  const days = Math.round((Date.parse(`${today()}T00:00:00Z`) - Date.parse(`${indiaDate(iso)}T00:00:00Z`)) / 86_400_000);
  if (days <= 0) return "today";
  if (days === 1) return "yesterday";
  return `${days} days ago`;
}

/** The India date of a moment. */
export const indiaDate = (iso: string) => new Intl.DateTimeFormat("en-CA", { timeZone: "Asia/Kolkata" }).format(new Date(iso));

/** A moment as a datetime-local box shows it, in India time: "2026-10-15T16:00". */
export const toLocalInput = (iso: string | null) => (iso ? new Date(new Date(iso).getTime() + 330 * 60_000).toISOString().slice(0, 16) : "");

/** What a datetime-local box holds (India time) as a moment. */
export const fromLocalInput = (value: string) => (value ? new Date(`${value}:00+05:30`).toISOString() : null);

/** "15 Oct, 4:30 pm". */
export const shortMoment = (iso: string) =>
  new Intl.DateTimeFormat("en-IN", { timeZone: "Asia/Kolkata", day: "numeric", month: "short", hour: "numeric", minute: "2-digit" }).format(new Date(iso));

/** "₹8,500" for a quote, written as the owner saw it (with GST). */
export const quoteMoney = money;

// ───────────────────────── Charts on the cards and the stage bar ─────────────────────────

/** The last four weeks as four small bars, this week's darker (the design's card corner). Values are read out by the card's own words. */
export function Sparkline({ values, label }: { values: readonly (number | null)[]; label: string }) {
  const top = Math.max(1, ...values.map((value) => value ?? 0));
  return (
    <div aria-hidden title={`${label}, the last four weeks: ${values.map((value) => value ?? "–").join(", ")}`} className="flex h-8 shrink-0 items-end gap-0.5">
      {values.map((value, index) => (
        <span
          key={index}
          className="w-2.5 rounded-t-[3px]"
          style={{ height: `${Math.max(8, ((value ?? 0) / top) * 100)}%`, background: index === values.length - 1 ? "#2F6FD6" : "#A9C7F0" }}
        />
      ))}
    </div>
  );
}

/**
 * "Where the leads are right now": one bar in the stage order, each part as wide as its
 * count with the number written in it, and a hidden table with the same numbers.
 */
export function StageBar({ counts, onPick }: { counts: Record<LeadStage, number>; onPick?: (stage: LeadStage) => void }) {
  const total = LEAD_STAGES.reduce((sum, stage) => sum + counts[stage], 0);
  return (
    <figure className="flex flex-col gap-2">
      <div className="flex h-8 w-full gap-0.5 overflow-hidden rounded-lg bg-background" aria-hidden>
        {total > 0 &&
          LEAD_STAGES.filter((stage) => counts[stage] > 0).map((stage) => (
            <button
              key={stage}
              type="button"
              tabIndex={-1}
              title={`${LEAD_STAGE_LABELS[stage]}: ${counts[stage]}`}
              onClick={() => onPick?.(stage)}
              className="flex min-w-7 cursor-pointer items-center justify-center text-xs font-bold tabular-nums"
              style={{ flexGrow: counts[stage], flexBasis: 0, background: STAGE_COLOR[stage], color: STAGE_INK[stage] }}
            >
              {counts[stage]}
            </button>
          ))}
      </div>
      <div className="sr-only">
        <table>
          <caption>Open leads by stage</caption>
          <tbody>
            {LEAD_STAGES.map((stage) => (
              <tr key={stage}>
                <th scope="row">{LEAD_STAGE_LABELS[stage]}</th>
                <td>{counts[stage]}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </figure>
  );
}

/** A stage's name with its colour, for the legend and the lead's own badge. */
export function StageTag({ stage, children }: { stage: LeadStage; children?: ReactNode }) {
  return (
    <span className="inline-flex items-center gap-1.5 whitespace-nowrap">
      <span aria-hidden className="h-2.5 w-2.5 shrink-0 rounded-sm" style={{ background: STAGE_COLOR[stage] }} />
      {children ?? LEAD_STAGE_LABELS[stage]}
    </span>
  );
}

/** A coloured dot with its meaning written beside it or kept for screen readers. */
export function StatusDot({ status }: { status: keyof typeof STATUS }) {
  return (
    <span className="inline-flex items-center">
      <span aria-hidden className="h-2.5 w-2.5 shrink-0 rounded-full" style={{ background: STATUS[status].color }} />
      <span className="sr-only">{STATUS[status].words}</span>
    </span>
  );
}

/**
 * Where a quote stands, as a badge with its word (Zoho Books' and Jobber's quote states):
 * the word always shows, and the border and weight only add to it, so colour is never alone.
 */
const QUOTE_STATE_STYLE: Record<QuoteState, string> = {
  DRAFT: "border-dashed border-border-strong text-muted",
  SENT: "border-foreground text-foreground",
  WON: "border-primary bg-primary/10 font-bold text-primary",
  DECLINED: "border-border-strong text-muted",
  EXPIRED: "border-amber-600 text-amber-800",
};

export function QuoteStateBadge({ state }: { state: QuoteState }) {
  return <span className={`inline-block rounded-full border px-2.5 py-0.5 text-xs font-semibold whitespace-nowrap ${QUOTE_STATE_STYLE[state]}`}>{QUOTE_STATE_LABELS[state]}</span>;
}

/** "Not opened yet", "Opened twice, last 25 Nov, 7:10 pm". */
export const openedWords = (quote: { openCount: number; lastOpenedAt: string | null }) =>
  quote.openCount === 0
    ? "Not opened yet"
    : `Opened ${quote.openCount === 1 ? "once" : quote.openCount === 2 ? "twice" : `${quote.openCount} times`}${quote.lastOpenedAt ? `, last ${shortMoment(quote.lastOpenedAt)}` : ""}`;

/** Downloads a quote's PDF under its own name. */
export async function downloadQuotePdf(quoteId: string) {
  const { blob, fileName } = await api.sales.quotePdf(quoteId);
  saveFile(blob, fileName);
}

// ───────────────────────── Call ─────────────────────────

/**
 * Call: dials the number (the phone's dialler, or the computer's calling app) and logs
 * the call on the lead, which moves a new lead to Contacted. A sample lead's number is
 * made up, so it is never dialled; the call is only logged.
 */
export function CallButton({
  leadId,
  phone,
  sample,
  onLogged,
  size = "sm",
}: {
  leadId: string;
  phone: string | null;
  sample: boolean;
  onLogged: (lead: LeadDetailDto) => void;
  size?: "sm" | "md";
}) {
  const notify = useToast();
  const [busy, setBusy] = useState(false);
  async function log() {
    setBusy(true);
    try {
      const lead = await api.sales.logStep(leadId, { id: crypto.randomUUID(), kind: "CALL" });
      notify(sample ? "Call logged. Sample leads are never dialled." : "Call logged");
      onLogged(lead);
    } catch (e) {
      notify(describe(e));
    } finally {
      setBusy(false);
    }
  }
  const box = size === "sm" ? "px-3 py-1.5 text-sm" : "px-4 py-2.5";
  const look = `inline-flex items-center justify-center whitespace-nowrap rounded-lg border border-border-strong bg-surface font-semibold hover:bg-background ${box} ${busy ? "opacity-50" : ""}`;
  if (phone && !sample) {
    return (
      <a href={`tel:${phone}`} onClick={() => void log()} className={look} aria-busy={busy}>
        Call
      </a>
    );
  }
  return (
    <button type="button" onClick={() => void log()} disabled={busy} className={`${look} cursor-pointer`}>
      {busy ? "Please wait…" : "Call"}
    </button>
  );
}

// ───────────────────────── Do today ─────────────────────────

/** "16:00" as "4 pm"; "By 6 pm" for a to-do with no time of its own. */
export function toDoTime(item: Pick<DoTodayItemDto, "time" | "bucket" | "days">) {
  if (item.bucket === "OVERDUE") return item.days === 1 ? "1 day" : `${item.days ?? 0} days`;
  if (!item.time) return "By 6 pm";
  return item.time;
}

/** The to-do list of the design: overdue first, then today's; each with its owner and one button. */
export function DoTodayList({
  items,
  onChanged,
  onPark,
  showOwner = true,
}: {
  items: readonly DoTodayItemDto[];
  onChanged: () => void;
  onPark: (item: DoTodayItemDto) => void;
  showOwner?: boolean;
}) {
  if (items.length === 0) return <p className="text-sm text-muted">Nothing to do today. New steps appear here as leads move.</p>;
  const groups = [
    { label: "Overdue", items: items.filter((item) => item.bucket === "OVERDUE") },
    { label: "Today", items: items.filter((item) => item.bucket === "TODAY") },
  ].filter((group) => group.items.length > 0);
  return (
    <div className="flex flex-col gap-3">
      {groups.map((group) => (
        <div key={group.label}>
          <h3 className={`mb-1 text-xs font-bold tracking-wide uppercase ${group.label === "Overdue" ? "text-danger" : "text-muted"}`}>{group.label}</h3>
          <ul className="flex flex-col divide-y divide-border">
            {group.items.map((item) => (
              <li key={item.leadId} className="grid grid-cols-[4.25rem_minmax(0,1fr)] gap-x-3 gap-y-2 py-3 sm:grid-cols-[4.25rem_minmax(0,1fr)_6rem_auto] sm:items-center">
                <span className={`text-sm tabular-nums ${group.label === "Overdue" ? "font-semibold text-danger" : "text-muted"}`}>{toDoTime(item)}</span>
                <span className="min-w-0">
                  <Link href={`/sales/leads/${item.leadId}`} className="font-semibold hover:underline">
                    {item.businessName}
                  </Link>
                  <span className="block text-sm text-muted">{item.line}</span>
                </span>
                {showOwner && <span className="col-start-2 truncate text-sm text-muted sm:col-start-auto">{item.ownerName}</span>}
                <span className="col-start-2 flex flex-wrap gap-2 sm:col-start-auto sm:justify-end">
                  <ToDoAction item={item} onChanged={onChanged} onPark={onPark} />
                </span>
              </li>
            ))}
          </ul>
        </div>
      ))}
    </div>
  );
}

function ToDoAction({ item, onChanged, onPark }: { item: DoTodayItemDto; onChanged: () => void; onPark: (item: DoTodayItemDto) => void }) {
  const button = "inline-flex items-center justify-center whitespace-nowrap rounded-lg border border-border-strong bg-surface px-3 py-1.5 text-sm font-semibold hover:bg-background";
  const sample = item.businessName.endsWith("(sample)");
  const action = (kind: DoTodayItemDto["action"]) => {
    switch (kind) {
      case "CALL":
        return <CallButton key={kind} leadId={item.leadId} phone={item.contactPhone} sample={sample} onLogged={onChanged} />;
      case "PARK_AGAIN":
        return (
          <button key={kind} type="button" className={`${button} cursor-pointer`} onClick={() => onPark(item)}>
            Park again
          </button>
        );
      case "SEND_QUOTE":
        return (
          <Link key={kind} href={`/sales/leads/${item.leadId}?do=quote`} className={button}>
            Send quote
          </Link>
        );
      case "SEND_PLAN":
        return (
          <Link key={kind} href={`/sales/leads/${item.leadId}?do=plan`} className={button}>
            Send plan
          </Link>
        );
      default:
        return (
          <Link key={kind} href={`/sales/leads/${item.leadId}`} className={button}>
            Open
          </Link>
        );
    }
  };
  return (
    <>
      {action(item.action)}
      {item.secondAction && action(item.secondAction)}
    </>
  );
}

// ───────────────────────── Park ─────────────────────────

/** Park until a date, with the reason in a few words ("after Diwali"). Used for Park and Park again. */
export function ParkSheet({ lead, onClose, onSaved }: { lead: { id: string; businessName: string } | null; onClose: () => void; onSaved: (lead: LeadDetailDto) => void }) {
  return (
    <Sheet open={lead !== null} title={lead ? `Park ${lead.businessName}` : "Park"} onClose={onClose}>
      {lead && <ParkForm key={lead.id} leadId={lead.id} onClose={onClose} onSaved={onSaved} />}
    </Sheet>
  );
}

function ParkForm({ leadId, onClose, onSaved }: { leadId: string; onClose: () => void; onSaved: (lead: LeadDetailDto) => void }) {
  const notify = useToast();
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [errors, setErrors] = useState<FieldErrors>({});
  async function save(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const form = event.currentTarget;
    const values = new FormData(form);
    const input = { until: String(values.get("until") ?? ""), reason: String(values.get("reason") ?? "").trim() };
    const found = checkAgainst(parkSchema, input);
    if (input.until && input.until <= today()) found.until = "Choose a day after today";
    setErrors(found);
    if (hasErrors(found)) return focusFirstError(form, found);
    setBusy(true);
    setError(null);
    try {
      onSaved(await api.sales.park(leadId, input));
      notify("Parked. It comes back in Do today on that date.");
      onClose();
    } catch (e) {
      setError(describe(e));
    } finally {
      setBusy(false);
    }
  }
  return (
    <form onSubmit={(event) => void save(event)} noValidate className="flex flex-col gap-4">
      <p className="text-sm text-muted">The lead leaves Do today until this date, then comes back as overdue so it is called.</p>
      <Field label="Until" name="until" type="date" required min={addDays(today(), 1)} defaultValue={addDays(today(), 14)} error={errors.until} />
      <Field label="Why, in a few words" name="reason" required maxLength={60} hint={'For example "after Diwali" or "owner travelling"'} error={errors.reason} />
      <ErrorMessage message={error} />
      <div className="flex gap-2 border-t border-border pt-4">
        <Button type="submit" loading={busy}>
          Park
        </Button>
        <Button type="button" variant="secondary" onClick={onClose}>
          Cancel
        </Button>
      </div>
    </form>
  );
}

// ───────────────────────── Add or change a lead ─────────────────────────

/**
 * The lead form, in a panel from the right (Add lead, and Change on a lead's page).
 * PATTERN FOLLOWED: the quick-add of field-sales CRMs (LeadSquared, Pipedrive): the
 * business, where it is, who to talk to, where it came from, and the next step, in the
 * order a BDE learns them standing at the shop. The owner is chosen only by the founders
 * and the Ops Manager; a BDE always owns what they add.
 */
export function LeadSheet({
  open,
  lead,
  owners,
  onClose,
  onSaved,
}: {
  open: boolean;
  /** The lead to change; null to add one. */
  lead: LeadDetailDto | null;
  /** Who can own it; empty for a BDE. */
  owners: readonly SalesPersonDto[];
  onClose: () => void;
  onSaved: (lead: LeadDetailDto) => void;
}) {
  return (
    <Sheet open={open} title={lead ? "Change the lead" : "Add lead"} onClose={onClose}>
      {open && <LeadForm key={lead?.id ?? "new"} lead={lead} owners={owners} onClose={onClose} onSaved={onSaved} />}
    </Sheet>
  );
}

function LeadForm({ lead, owners, onClose, onSaved }: { lead: LeadDetailDto | null; owners: readonly SalesPersonDto[]; onClose: () => void; onSaved: (lead: LeadDetailDto) => void }) {
  const notify = useToast();
  const [newId] = useState(() => crypto.randomUUID());
  const [source, setSource] = useState<LeadSource>(lead?.source ?? "FIELD_VISIT");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [errors, setErrors] = useState<FieldErrors>({});

  async function save(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const form = event.currentTarget;
    const values = new FormData(form);
    const text = (name: string) => String(values.get(name) ?? "").trim();
    const kitchens = Number(text("kitchens") || "1");
    const input: LeadInput = {
      ...(!lead && { id: newId }),
      businessName: text("businessName"),
      area: text("area") || null,
      address: text("address") || null,
      contactName: text("contactName") || null,
      contactPhone: text("contactPhone") || null,
      kitchens: Number.isInteger(kitchens) ? kitchens : Number.NaN,
      source,
      referrerName: isReferral(source) ? text("referrerName") || null : null,
      ...(owners.length > 0 && text("ownerId") && { ownerId: text("ownerId") }),
      nextAction: text("nextAction") || null,
      nextActionAt: fromLocalInput(text("nextActionAt")),
    };
    const found = checkAgainst(lead ? leadUpdateSchema : leadSchema, input);
    setErrors(found);
    if (hasErrors(found)) return focusFirstError(form, found);
    setBusy(true);
    setError(null);
    try {
      const saved = lead ? await api.sales.updateLead(lead.id, input) : await api.sales.addLead(input);
      notify(lead ? "Lead saved" : "Lead added");
      onSaved(saved);
      onClose();
    } catch (e) {
      setError(describe(e));
    } finally {
      setBusy(false);
    }
  }

  return (
    <form onSubmit={(event) => void save(event)} noValidate className="flex flex-col gap-4">
      {lead?.isSample && <p className="text-sm text-muted">A sample lead. All sample leads can be removed in one go before real use.</p>}
      <Field label="Business name" name="businessName" required maxLength={100} defaultValue={lead?.businessName} hint="As on the shop board" error={errors.businessName} />
      <div className="grid gap-4 sm:grid-cols-[minmax(0,1fr)_7rem]">
        <Field label="Area" name="area" maxLength={60} defaultValue={lead?.area ?? ""} hint="The locality, for example Gachibowli" error={errors.area} />
        <Field label="Kitchens" name="kitchens" type="number" required min={1} max={200} defaultValue={lead?.kitchens ?? 1} error={errors.kitchens} />
      </div>
      <Field label="Address" name="address" maxLength={200} defaultValue={lead?.address ?? ""} error={errors.address} />
      <div className="grid gap-4 sm:grid-cols-2">
        <Field label="Contact's name" name="contactName" maxLength={80} defaultValue={lead?.contactName ?? ""} error={errors.contactName} />
        <Field label="Contact's mobile" name="contactPhone" type="tel" inputMode="numeric" autoComplete="off" defaultValue={lead?.contactPhone ?? ""} hint="10 digits" error={errors.contactPhone} />
      </div>
      <div className="grid gap-4 sm:grid-cols-2">
        <SelectField label="Where it came from" name="source" value={source} onChange={(event) => setSource(event.target.value as LeadSource)} error={errors.source}>
          {LEAD_SOURCES.map((entry) => (
            <option key={entry} value={entry}>
              {LEAD_SOURCE_LABELS[entry]}
            </option>
          ))}
        </SelectField>
        {isReferral(source) && <Field label="Referred by" name="referrerName" maxLength={80} defaultValue={lead?.referrerName ?? ""} error={errors.referrerName} />}
      </div>
      {owners.length > 0 && (
        <SelectField label="Owner" name="ownerId" defaultValue={lead?.ownerId ?? ""} hint="Who follows it up" error={errors.ownerId}>
          {!lead && <option value="">Me</option>}
          {owners.map((person) => (
            <option key={person.id} value={person.id}>
              {person.name}
              {person.isBde ? "" : " (not a BDE)"}
            </option>
          ))}
        </SelectField>
      )}
      <div className="grid gap-4 sm:grid-cols-2">
        <Field label="Next step" name="nextAction" maxLength={80} defaultValue={lead?.nextAction ?? ""} hint="For example: Book the free check" error={errors.nextAction} />
        <Field label="When" name="nextActionAt" type="datetime-local" defaultValue={toLocalInput(lead?.nextActionAt ?? null)} error={errors.nextActionAt} />
      </div>
      <ErrorMessage message={error} />
      <div className="flex gap-2 border-t border-border pt-4">
        <Button type="submit" loading={busy}>
          {lead ? "Save" : "Add the lead"}
        </Button>
        <Button type="button" variant="secondary" onClick={onClose}>
          Cancel
        </Button>
      </div>
    </form>
  );
}

/** Where a lead came from, in words: "Chef referral (Chef Raju)". */
export const sourceWords = (source: LeadSource, referrer: string | null) => `${LEAD_SOURCE_LABELS[source]}${referrer ? ` (${referrer})` : ""}`;
