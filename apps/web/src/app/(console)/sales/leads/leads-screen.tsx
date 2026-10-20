"use client";

import {
  can,
  LEAD_LIST_STATES,
  LEAD_SOURCE_LABELS,
  LEAD_SOURCES,
  LEAD_STAGE_LABELS,
  LEAD_STAGES,
  type LeadListDto,
  type LeadListState,
  type LeadRowDto,
  type LeadSource,
  type LeadStage,
} from "@eccs/shared";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { useEffect, useState } from "react";

import { Button, EmptyState, Field, LoadError, Loading, NoAccess, PageHeader, SelectField } from "@/components/ui";
import { api } from "@/lib/api";
import { describe } from "@/lib/format";
import { useQuery, useQueryField } from "@/lib/query";
import { useSession } from "@/lib/session";

import { money, Segmented } from "../../finance/finance-parts";
import { ago, LeadSheet, SalesTabs, shortMoment, StageTag } from "../sales-parts";

// All leads (15 Oct 2026), newest activity first, with the filters a sales list needs:
// stage, owner, where it came from, open, stale, parked, lost or won, and a search.
// The filters are kept in the web address, so a link from the Sales page (a stage, the
// parked leads) opens the list already filtered.
//
// PATTERN FOLLOWED: Pipedrive's and Zoho CRM's list view of deals (one row per lead with
// its stage, owner, last activity and next step; a rotting deal marked in red; filters
// above the table) and the console's own Clients and Logs lists.

const STATE_LABELS: Record<LeadListState, string> = { open: "Open", stale: "Stale", parked: "Parked", lost: "Lost", won: "Customers", all: "All" };

export default function LeadsScreen() {
  const { user } = useSession();
  const allowed = user ? can(user.memberships, "sales", "read") : false;
  if (!allowed) return <NoAccess title="Leads">The leads are for the founders, the Ops Manager and the BDEs.</NoAccess>;
  return <Leads />;
}

function Leads() {
  const { user } = useSession();
  const query = useQuery();
  const router = useRouter();
  const [search, setSearch] = useQueryField("q");
  const [typed, setTyped] = useState(search);
  const stateParam = query.get("state");
  const state = ((LEAD_LIST_STATES as readonly string[]).includes(stateParam) ? stateParam : "open") as LeadListState;
  const stage = ((LEAD_STAGES as readonly string[]).includes(query.get("stage")) ? query.get("stage") : "") as LeadStage | "";
  const source = ((LEAD_SOURCES as readonly string[]).includes(query.get("source")) ? query.get("source") : "") as LeadSource | "";
  const owner = query.get("owner");
  const key = [state, stage, source, owner, search].join("|");
  const [loaded, setLoaded] = useState<{ key: string; data: LeadListDto } | null>(null);
  const [error, setError] = useState<{ key: string; message: string } | null>(null);
  const [attempt, setAttempt] = useState(0);
  const [adding, setAdding] = useState(false);
  const sees = (user?.memberships ?? []).some((m) => m.role === "SUPER_ADMIN" || m.role === "OPS_MANAGER");

  // The search is sent a moment after typing stops, not on every key.
  useEffect(() => {
    const timer = setTimeout(() => typed !== search && setSearch(typed), 350);
    return () => clearTimeout(timer);
  }, [typed, search, setSearch]);

  useEffect(() => {
    let cancelled = false;
    const [listState, listStage, listSource, listOwner, listSearch] = key.split("|");
    api.sales
      .leads({ state: listState as LeadListState, stage: listStage as LeadStage | "", source: listSource as LeadSource | "", owner: listOwner || undefined, q: listSearch || undefined })
      .then((data) => {
        if (cancelled) return;
        setLoaded({ key, data });
        setError(null);
      })
      .catch((e) => !cancelled && setError({ key, message: describe(e) }));
    return () => {
      cancelled = true;
    };
  }, [key, attempt]);

  const data = loaded?.data ?? null;
  const failure = error && error.key === key ? error.message : null;

  return (
    <div className="flex flex-col gap-6">
      <PageHeader
        title="Leads"
        description="Every lead, the latest worked first. A stale lead has had nothing logged for five days or a next step that passed."
        action={<Button onClick={() => setAdding(true)}>Add lead</Button>}
      />
      <SalesTabs current="leads" />

      <div className="flex flex-col gap-4 rounded-xl border border-border bg-surface p-4">
        <Segmented
          label="Show"
          showLabel={false}
          value={state}
          onChange={(value) => query.set({ state: value === "open" ? null : value }, "replace")}
          options={LEAD_LIST_STATES.map((value) => ({ value, label: STATE_LABELS[value] }))}
        />
        <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
          <Field label="Search" type="search" plainLabel value={typed} onChange={(event) => setTyped(event.target.value)} hint="Name, area, contact or phone" />
          <SelectField label="Stage" value={stage} onChange={(event) => query.set({ stage: event.target.value || null }, "replace")}>
            <option value="">Every stage</option>
            {LEAD_STAGES.map((value) => (
              <option key={value} value={value}>
                {LEAD_STAGE_LABELS[value]}
              </option>
            ))}
          </SelectField>
          <SelectField label="Came from" value={source} onChange={(event) => query.set({ source: event.target.value || null }, "replace")}>
            <option value="">Anywhere</option>
            {LEAD_SOURCES.map((value) => (
              <option key={value} value={value}>
                {LEAD_SOURCE_LABELS[value]}
              </option>
            ))}
          </SelectField>
          {sees && data && (
            <SelectField label="Owner" value={owner} onChange={(event) => query.set({ owner: event.target.value || null }, "replace")}>
              <option value="">Everyone</option>
              {data.owners.map((person) => (
                <option key={person.id} value={person.id}>
                  {person.name}
                </option>
              ))}
            </SelectField>
          )}
        </div>
      </div>

      {failure && <LoadError message={failure} onRetry={() => setAttempt((value) => value + 1)} />}
      {!data && !failure && <Loading />}
      {data && (
        <div className={loaded?.key !== key ? "opacity-60" : ""} aria-busy={loaded?.key !== key}>
          <p role="status" className="mb-2 text-sm text-muted">
            {data.leads.length === data.total ? `${data.total} ${data.total === 1 ? "lead" : "leads"}` : `Showing ${data.leads.length} of ${data.total} leads`}
          </p>
          {data.leads.length === 0 ? (
            <EmptyState title="No leads here">Change the filters, or add a lead.</EmptyState>
          ) : (
            <LeadTable leads={data.leads} showOwner={sees} />
          )}
        </div>
      )}

      <LeadSheet open={adding} lead={null} owners={sees && data ? data.owners : []} onClose={() => setAdding(false)} onSaved={(lead) => router.push(`/sales/leads/${lead.id}`)} />
    </div>
  );
}

function Status({ lead }: { lead: LeadRowDto }) {
  if (lead.status === "LOST") return <span className="text-muted">Lost</span>;
  if (lead.status === "PARKED") return <span className="text-muted">Parked{lead.parkedUntil ? ` to ${shortDate(lead.parkedUntil)}` : ""}</span>;
  return null;
}

const shortDate = (date: string) => new Intl.DateTimeFormat("en-IN", { timeZone: "UTC", day: "numeric", month: "short" }).format(new Date(`${date}T00:00:00Z`));

function LeadTable({ leads, showOwner }: { leads: readonly LeadRowDto[]; showOwner: boolean }) {
  const name = (lead: LeadRowDto) => (
    <>
      <Link href={`/sales/leads/${lead.id}`} className="font-semibold text-primary hover:underline">
        {lead.businessName}
      </Link>
      {/* A sample lead's name already ends in "(sample)", so no badge on each row. */}
      <span className="block text-muted">{[lead.area, lead.kitchens > 1 ? `${lead.kitchens} kitchens` : null].filter(Boolean).join(" · ")}</span>
    </>
  );
  const stale = (lead: LeadRowDto) =>
    lead.stale && (
      <span className="block font-semibold text-danger">
        <span aria-hidden>● </span>
        {lead.stale.words}
      </span>
    );
  const next = (lead: LeadRowDto) => (lead.nextAction || lead.nextActionAt ? `${lead.nextAction ?? "Next step"}${lead.nextActionAt ? `, ${shortMoment(lead.nextActionAt)}` : ""}` : "—");
  const quote = (lead: LeadRowDto) =>
    lead.quote ? (
      <>
        {money(lead.quote.totalPaise)}
        {lead.quote.openCount > 0 && <span className="block text-muted">opened {lead.quote.openCount === 1 ? "once" : lead.quote.openCount === 2 ? "twice" : `${lead.quote.openCount} times`}</span>}
      </>
    ) : (
      "—"
    );

  return (
    <>
      {/* A narrow screen gets one card per lead. */}
      <ul className="flex flex-col divide-y divide-border rounded-xl border border-border bg-surface px-4 text-sm md:hidden">
        {leads.map((lead) => (
          <li key={lead.id} className="flex flex-col gap-1 py-3">
            <div className="flex justify-between gap-3">
              <span className="min-w-0">{name(lead)}</span>
              <StageTag stage={lead.stage} />
            </div>
            <div className="flex flex-wrap gap-x-3 text-muted">
              {showOwner && <span>{lead.ownerName}</span>}
              <span>worked {ago(lead.lastActivityAt)}</span>
              <Status lead={lead} />
            </div>
            {stale(lead)}
          </li>
        ))}
      </ul>
      <div className="hidden overflow-x-auto rounded-xl border border-border bg-surface md:block">
        <table className="w-full text-left text-sm">
          <thead className="text-muted">
            <tr className="border-b border-border">
              <th scope="col" className="px-4 py-2.5 font-medium">Lead</th>
              <th scope="col" className="px-3 py-2.5 font-medium">Stage</th>
              {showOwner && <th scope="col" className="px-3 py-2.5 font-medium">Owner</th>}
              <th scope="col" className="px-3 py-2.5 font-medium">Last worked</th>
              <th scope="col" className="px-3 py-2.5 font-medium">Next step</th>
              <th scope="col" className="px-4 py-2.5 text-right font-medium">Quote</th>
            </tr>
          </thead>
          <tbody>
            {leads.map((lead) => (
              <tr key={lead.id} className="border-b border-border align-top last:border-0">
                <td className="px-4 py-2.5">{name(lead)}</td>
                <td className="px-3 py-2.5">
                  <StageTag stage={lead.stage} />
                  <span className="block">
                    <Status lead={lead} />
                  </span>
                </td>
                {showOwner && <td className="px-3 py-2.5">{lead.ownerName}</td>}
                <td className="px-3 py-2.5 whitespace-nowrap">
                  {ago(lead.lastActivityAt)}
                  {stale(lead)}
                </td>
                <td className="px-3 py-2.5">{next(lead)}</td>
                <td className="px-4 py-2.5 text-right whitespace-nowrap tabular-nums">{quote(lead)}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </>
  );
}
