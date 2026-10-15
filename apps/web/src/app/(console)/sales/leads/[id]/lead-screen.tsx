"use client";

import {
  ASK_SIGNAL_LABELS,
  can,
  closeWords,
  LEAD_STAGE_LABELS,
  type LeadActivityDto,
  type LeadDetailDto,
  type QuoteDto,
} from "@eccs/shared";
import Link from "next/link";
import { useEffect, useState, type ReactNode } from "react";

import { useToast } from "@/components/toast";
import { Button, LoadError, Loading, NoAccess } from "@/components/ui";
import { describe, longDay } from "@/lib/format";
import { api } from "@/lib/api";
import { useNavCounts } from "@/lib/nav-counts";
import { useQuery } from "@/lib/query";
import { useSession } from "@/lib/session";

import { money, Panel, SampleBadge } from "../../../finance/finance-parts";
import { CallButton, LeadSheet, ParkSheet, shortMoment, sourceWords, StageTag, toDoTime } from "../../sales-parts";
import { ClientSheet, LoseSheet, QuoteSheet, sendOnWhatsapp, StepSheet } from "./lead-sheets";

// One lead (15 Oct 2026): its details and next step, today's to-do for it, the timeline of
// everything logged and what the app saw, its quotes with their opens, and the buttons to
// work it: Call (logs the call), Log a step, Make a quote, Park, Lost, Became a client.
//
// PATTERN FOLLOWED: Pipedrive's deal page (the stage and the owner at the top, the next
// activity first, the details on one side and the history of every activity, e-mail and
// document view on the other) and Zoho CRM's quote "viewed" history. Which panel is open
// is kept in the web address (?do=step, quote, plan, park, lose, client, edit), so Do
// today's buttons open the right one directly.

const PANELS = ["step", "quote", "plan", "park", "lose", "client", "edit"] as const;
type PanelName = (typeof PANELS)[number];

export default function LeadScreen({ leadId }: { leadId: string }) {
  const { user } = useSession();
  const allowed = user ? can(user.memberships, "sales", "read") : false;
  if (!allowed) return <NoAccess title="Lead">The leads are for the founders, the Ops Manager and the BDEs.</NoAccess>;
  return <Lead leadId={leadId} />;
}

function Lead({ leadId }: { leadId: string }) {
  const { user } = useSession();
  const query = useQuery();
  const notify = useToast();
  const { refresh: refreshCounts } = useNavCounts();
  const [loaded, setLoaded] = useState<LeadDetailDto | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [attempt, setAttempt] = useState(0);
  const [busy, setBusy] = useState<string | null>(null);
  const asked = query.get("do");
  const panel = ((PANELS as readonly string[]).includes(asked) ? asked : null) as PanelName | null;
  const open = (name: PanelName | null) => query.set({ do: name }, name ? "push" : "replace");

  useEffect(() => {
    let cancelled = false;
    api.sales
      .lead(leadId)
      .then((data) => {
        if (cancelled) return;
        setLoaded(data);
        setError(null);
      })
      .catch((e) => !cancelled && setError(describe(e)));
    return () => {
      cancelled = true;
    };
  }, [leadId, attempt]);

  /** A change came back with the lead as it now stands. */
  const saved = (lead: LeadDetailDto) => {
    setLoaded(lead);
    refreshCounts();
  };
  const reload = () => {
    setAttempt((value) => value + 1);
    refreshCounts();
  };

  if (!loaded || loaded.id !== leadId) {
    return (
      <div className="flex flex-col gap-4">
        <BackLink />
        {error ? <LoadError message={error} onRetry={() => setAttempt((value) => value + 1)} /> : <Loading />}
      </div>
    );
  }
  const lead = loaded;
  const memberships = user?.memberships ?? [];
  const links = can(memberships, "clients", "update");
  const working = lead.status === "OPEN";

  async function reopen() {
    setBusy("reopen");
    try {
      saved(await api.sales.reopen(lead.id));
      notify("Reopened");
    } catch (e) {
      notify(describe(e));
    } finally {
      setBusy(null);
    }
  }

  async function resend(quote: QuoteDto) {
    setBusy(quote.id);
    try {
      const { hasPhone } = await sendOnWhatsapp(quote.id);
      notify(hasPhone ? `Quote ${quote.number} ready in WhatsApp: press send there` : `Quote ${quote.number} ready in WhatsApp: choose who to send it to`);
      reload();
    } catch (e) {
      notify(describe(e));
    } finally {
      setBusy(null);
    }
  }

  async function removeQuote(quote: QuoteDto) {
    setBusy(quote.id);
    try {
      await api.sales.removeQuote(quote.id);
      notify(`Draft ${quote.number} removed`);
      reload();
    } catch (e) {
      notify(describe(e));
    } finally {
      setBusy(null);
    }
  }

  const close = lead.close && lead.close.score > 0 ? closeWords(lead.close, 6) : [];

  return (
    <div className="flex flex-col gap-6">
      <BackLink />
      <header className="flex flex-col gap-3">
        <div className="flex flex-wrap items-start justify-between gap-x-6 gap-y-3">
          <div className="min-w-0">
            <h1 className="text-2xl font-bold">{lead.businessName}</h1>
            <p className="mt-1 flex flex-wrap items-center gap-x-3 gap-y-1 text-sm text-muted">
              <StageTag stage={lead.stage} />
              {lead.status === "PARKED" && <span className="font-semibold text-foreground">Parked until {lead.parkedUntil ? longDay(lead.parkedUntil) : "a date"}</span>}
              {lead.status === "LOST" && <span className="font-semibold text-danger">Lost</span>}
              <span>{lead.ownerName}</span>
              {lead.area && <span>{lead.area}</span>}
              {lead.isSample && <SampleBadge />}
            </p>
          </div>
          <div className="flex flex-wrap gap-2">
            <CallButton leadId={lead.id} phone={lead.contactPhone} sample={lead.isSample} onLogged={saved} size="md" />
            <Button onClick={() => open("step")}>Log a step</Button>
            <Button variant="secondary" onClick={() => open("quote")}>
              Make a quote
            </Button>
            {working ? (
              <>
                <Button variant="secondary" onClick={() => open("park")}>
                  Park
                </Button>
                <Button variant="secondary" onClick={() => open("lose")}>
                  Lost
                </Button>
              </>
            ) : (
              <Button variant="secondary" loading={busy === "reopen"} onClick={() => void reopen()}>
                Reopen
              </Button>
            )}
          </div>
        </div>

        {/* What needs doing now, before anything else. */}
        {lead.toDo && (
          <div className={`rounded-xl border-l-4 bg-surface px-4 py-3 ${lead.toDo.bucket === "OVERDUE" ? "border-danger" : "border-primary"}`}>
            <p className="text-sm font-bold">
              {lead.toDo.bucket === "OVERDUE" ? `Overdue, ${toDoTime(lead.toDo)}` : `Do today${lead.toDo.time ? ` at ${lead.toDo.time}` : ", by 6 pm"}`}
            </p>
            <p className="text-sm">{lead.toDo.line}</p>
          </div>
        )}
        {lead.stale && !lead.toDo && (
          <div className="rounded-xl border-l-4 border-danger bg-surface px-4 py-3 text-sm">
            <span className="font-bold">Waiting: </span>
            {lead.stale.context}, {lead.stale.words}. Log the next step to take it off the list.
          </div>
        )}
        {lead.status === "PARKED" && lead.parkedReason && <p className="text-sm text-muted">Parked {lead.parkedAt ? `on ${longDay(lead.parkedAt)}` : ""}: &quot;{lead.parkedReason}&quot;.</p>}
        {lead.status === "LOST" && lead.lostReason && <p className="text-sm text-muted">Lost{lead.lostAt ? ` on ${longDay(lead.lostAt)}` : ""}: {lead.lostReason}.</p>}
      </header>

      <div className="grid gap-6 lg:grid-cols-[minmax(0,1fr)_minmax(0,1.25fr)]">
        <div className="flex min-w-0 flex-col gap-6">
          <Panel title="Details" action={<Button variant="link" className="text-sm" onClick={() => open("edit")}>Change</Button>}>
            <dl className="grid grid-cols-[8rem_minmax(0,1fr)] gap-x-3 gap-y-2 text-sm">
              <Row label="Next step">
                {lead.nextAction || lead.nextActionAt ? `${lead.nextAction ?? "Next step"}${lead.nextActionAt ? `, ${shortMoment(lead.nextActionAt)}` : ""}` : <span className="text-muted">None set</span>}
              </Row>
              <Row label="Contact">
                {lead.contactName ?? <span className="text-muted">No name</span>}
                {lead.contactPhone && (
                  <span className="block tabular-nums">
                    {lead.isSample ? (
                      <span title="A made-up sample number, never dialled">{lead.contactPhone}</span>
                    ) : (
                      <a href={`tel:${lead.contactPhone}`} className="text-primary hover:underline">
                        {lead.contactPhone}
                      </a>
                    )}
                  </span>
                )}
              </Row>
              <Row label="Address">{lead.address ?? <span className="text-muted">—</span>}</Row>
              <Row label="Kitchens">{lead.kitchens}</Row>
              <Row label="Came from">{sourceWords(lead.source, lead.referrerName)}</Row>
              {lead.checkAt && <Row label="Free check">{`${shortMoment(lead.checkAt)}${lead.checkWith ? `, with ${lead.checkWith}` : ""}`}</Row>}
              {lead.checkFindings !== null && <Row label="Check found">{`${lead.checkFindings} ${lead.checkFindings === 1 ? "thing" : "things"} to fix`}</Row>}
              <Row label="Client">
                {lead.organization ? lead.organization.name : <span className="text-muted">Not yet a client</span>}
                {links && (
                  <Button variant="link" className="-ml-2 block text-sm" onClick={() => open("client")}>
                    {lead.organization ? "Change" : "Became a client"}
                  </Button>
                )}
              </Row>
              <Row label="Logged">{longDay(lead.createdAt)}</Row>
            </dl>
          </Panel>

          {close.length > 0 && (
            <Panel title="Likely to close" description="From what the owner did and who they are, not from anyone's opinion.">
              <p className="text-sm">{close.join(" · ")}</p>
            </Panel>
          )}

          <Panel title="Quotes" action={<Button variant="link" className="text-sm" onClick={() => open("quote")}>Make a quote</Button>}>
            {lead.quotes.length === 0 ? (
              <p className="text-sm text-muted">No quote yet.</p>
            ) : (
              <ul className="flex flex-col divide-y divide-border text-sm">
                {lead.quotes.map((quote) => (
                  <li key={quote.id} className="flex flex-col gap-1 py-3 first:pt-0">
                    <div className="flex flex-wrap items-baseline justify-between gap-2">
                      <span className="font-semibold">
                        {quote.number} · {money(quote.totalPaise)}
                        <span className="font-normal text-muted"> with GST</span>
                      </span>
                      <span className={quote.status === "SENT" ? "text-muted" : "font-semibold"}>{quote.status === "SENT" && quote.sentAt ? `Sent ${shortMoment(quote.sentAt)}` : "Draft, not sent"}</span>
                    </div>
                    <span className="text-muted">{quote.lines.map((line) => `${line.quantity > 1 ? `${line.quantity} × ` : ""}${line.name}`).join(", ")}</span>
                    {quote.status === "SENT" && (
                      <span className={quote.openCount > 0 ? "font-semibold" : "text-muted"}>
                        {quote.openCount === 0
                          ? "Not opened yet"
                          : `Opened ${quote.openCount === 1 ? "once" : quote.openCount === 2 ? "twice" : `${quote.openCount} times`}${quote.lastOpenedAt ? `, last ${shortMoment(quote.lastOpenedAt)}` : ""}`}
                      </span>
                    )}
                    <div className="-ml-2 flex flex-wrap gap-1">
                      <Button variant="link" className="text-sm" loading={busy === quote.id} disabled={busy !== null} onClick={() => void resend(quote)}>
                        {quote.status === "SENT" ? "Send again on WhatsApp" : "Send on WhatsApp"}
                      </Button>
                      {quote.status === "SENT" && (
                        <a href={`${quote.link}?preview=1`} target="_blank" rel="noreferrer" className="rounded-md px-2 py-1 font-semibold text-primary hover:underline">
                          See the owner&apos;s page
                        </a>
                      )}
                      {quote.status === "DRAFT" && (
                        <Button variant="link" className="text-sm text-danger" disabled={busy !== null} onClick={() => void removeQuote(quote)}>
                          Remove the draft
                        </Button>
                      )}
                    </div>
                  </li>
                ))}
              </ul>
            )}
          </Panel>
        </div>

        <Panel title="Timeline" description="Every step logged, and what the app saw: quotes opened, the first job, the plan.">
          <ol className="flex flex-col">
            {lead.activities.map((entry) => (
              <li key={entry.id} className="grid grid-cols-[7.5rem_minmax(0,1fr)] gap-x-3 border-b border-border py-2.5 text-sm last:border-0">
                <span className="text-muted tabular-nums">{shortMoment(entry.at)}</span>
                <span className="min-w-0">
                  <span className="font-medium">{activityWords(entry)}</span>
                  {entry.toStage && <span className="text-muted"> · moved to {LEAD_STAGE_LABELS[entry.toStage]}</span>}
                  {entry.note && !["PARKED", "LOST", "LINKED"].includes(entry.kind) && <span className="block text-muted">{entry.note}</span>}
                  <span className="block text-xs text-muted">{entry.byName ?? (entry.kind === "QUOTE_OPENED" ? "The owner" : "The app")}</span>
                </span>
              </li>
            ))}
          </ol>
        </Panel>
      </div>

      <StepSheet open={panel === "step"} lead={lead} onClose={() => open(null)} onSaved={saved} />
      <QuoteSheet open={panel === "quote" || panel === "plan"} lead={lead} planFirst={panel === "plan"} onClose={() => open(null)} onSaved={reload} />
      <ParkSheet lead={panel === "park" ? lead : null} onClose={() => open(null)} onSaved={saved} />
      <LoseSheet open={panel === "lose"} lead={lead} onClose={() => open(null)} onSaved={saved} />
      {links && <ClientSheet open={panel === "client"} lead={lead} onClose={() => open(null)} onSaved={saved} />}
      <LeadSheet open={panel === "edit"} lead={lead} owners={lead.owners} onClose={() => open(null)} onSaved={saved} />
    </div>
  );
}

function BackLink() {
  return (
    <Link href="/sales/leads" className="w-fit rounded-md px-1 text-sm font-semibold text-primary hover:underline">
      ← Leads
    </Link>
  );
}

function Row({ label, children }: { label: string; children: ReactNode }) {
  return (
    <>
      <dt className="text-muted">{label}</dt>
      <dd className="min-w-0">{children}</dd>
    </>
  );
}

/** What happened, in a few words. */
function activityWords(entry: LeadActivityDto): string {
  switch (entry.kind) {
    case "CREATED":
      return "Lead logged";
    case "CALL":
      return "Called";
    case "VISIT":
      return "Visited";
    case "NOTE":
      return "Note";
    case "CHECK_BOOKED":
      return `Free check booked${entry.checkAt ? ` for ${shortMoment(entry.checkAt)}` : ""}${entry.checkWith ? ` with ${entry.checkWith}` : ""}`;
    case "CHECK_DONE":
      return `Free check done: ${entry.findings ?? 0} ${entry.findings === 1 ? "thing" : "things"} to fix`;
    case "ASKED":
      return entry.signal ? `Owner ${ASK_SIGNAL_LABELS[entry.signal].toLowerCase()}` : "Owner asked about price";
    case "QUOTE_SENT":
      return `Quote ${entry.quoteNumber ?? ""} sent${entry.amountPaise ? `, ${money(entry.amountPaise)} with GST` : ""}`;
    case "QUOTE_OPENED":
      return `Quote ${entry.quoteNumber ?? ""} opened`;
    case "PARKED":
      return `Parked${entry.note ? `: "${entry.note}"` : ""}`;
    case "LOST":
      return `Lost${entry.note ? `: ${entry.note}` : ""}`;
    case "REOPENED":
      return "Reopened";
    case "LINKED":
      return entry.note ?? "Linked to a client";
    case "WON":
      return entry.toStage === "ON_PLAN" || (entry.toStage === null && entry.rating === null)
        ? `Plan started${entry.amountPaise ? `, ${money(entry.amountPaise)} a cycle before GST` : ""}`
        : `First job${entry.amountPaise ? `, ${money(entry.amountPaise)} before GST` : ""}${entry.rating ? `, rated ${entry.rating}` : ""}`;
  }
}
