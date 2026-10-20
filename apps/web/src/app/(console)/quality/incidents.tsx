"use client";

import { costWords, type IncidentsDto, type IncidentSummaryDto } from "@eccs/shared";
import Link from "next/link";
import { useEffect, useState } from "react";

import { EmptyState, LoadError, Loading, ToggleGroup } from "@/components/ui";
import { api } from "@/lib/api";
import { describe, shortDay } from "@/lib/format";
import { useQuery } from "@/lib/query";

import { IncidentStatusBadge } from "./quality-parts";

// Pattern followed: an incident log (SafetyCulture's Investigations: status, evidence in one place,
// actions, a report to share; the HSE accident book's columns: the date, the place, what happened,
// what was done afterwards). The founder's design (20 Oct 2026, page 5, "Incident log") is the
// table; each row opens the incident's own page, where "one link has the whole story".

type State = "all" | "open";

const hrefOf = (incident: IncidentSummaryDto) => `/quality/incidents/${encodeURIComponent(incident.id)}`;

/**
 * Quality → Incidents: anything that could become a claim, a complaint or a lesson, open ones
 * first, then the newest. `version` goes up when one is added from the page's header, so the
 * list loads again. The filter is in the web address (`state=open`).
 */
export function IncidentsTab({ openCount, version }: { openCount: number | null; version: number }) {
  const query = useQuery();
  const state: State = query.get("state") === "open" ? "open" : "all";
  const [loaded, setLoaded] = useState<{ state: State; data: IncidentsDto } | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [attempt, setAttempt] = useState(0);

  useEffect(() => {
    let cancelled = false;
    api.quality
      .incidents(state)
      .then((data) => {
        if (cancelled) return;
        setLoaded({ state, data });
        setError(null);
      })
      .catch((e) => !cancelled && setError(describe(e)));
    return () => {
      cancelled = true;
    };
  }, [state, attempt, version]);

  const items = loaded?.state === state ? loaded.data.items : null;

  return (
    <div className="flex flex-col gap-4">
      <ToggleGroup
        label="Which incidents to show"
        value={state}
        options={[
          { value: "open", label: "Open", count: openCount ?? undefined },
          { value: "all", label: "All" },
        ]}
        onChange={(value) => query.set({ state: value === "open" ? "open" : null }, "replace")}
      />
      {error && <LoadError message={error} onRetry={() => setAttempt((value) => value + 1)} />}
      {!items && !error && <Loading />}
      {items && items.length === 0 && (
        <EmptyState title={state === "open" ? "No open incidents" : "No incidents"}>
          An injury, damage or a missing item: anything that could become a claim, a complaint or a lesson. Add one with Add an incident.
        </EmptyState>
      )}
      {items && items.length > 0 && <IncidentTable items={items} />}
    </div>
  );
}

function IncidentTable({ items }: { items: readonly IncidentSummaryDto[] }) {
  return (
    <>
      {/* A narrow screen gets one card per incident, with the same facts in the same order. */}
      <ul className="flex flex-col divide-y divide-border rounded-xl border border-border bg-surface px-4 text-sm md:hidden" aria-label="Incidents">
        {items.map((incident) => (
          <li key={incident.id} className="flex flex-col gap-1.5 py-3">
            <div className="flex items-start justify-between gap-3">
              <Link href={hrefOf(incident)} className="min-w-0 font-semibold text-primary hover:underline">
                {shortDay(incident.happenedOn)} · {incident.outletName}
              </Link>
              <IncidentStatusBadge status={incident.status} />
            </div>
            <p>{incident.whatHappened}</p>
            {incident.whatWasDone && <p className="text-muted">Done: {incident.whatWasDone}</p>}
            <p className="text-muted">
              {incident.reference} · {costWords(incident.costPaise)}
              {incident.fileCount > 0 && ` · ${incident.fileCount === 1 ? "1 photo or file" : `${incident.fileCount} photos and files`}`}
            </p>
          </li>
        ))}
      </ul>
      <div className="hidden overflow-x-auto rounded-xl border border-border bg-surface md:block">
        <table className="w-full text-left text-sm">
          <caption className="sr-only">Incidents, open first, then the newest</caption>
          <thead className="text-muted">
            <tr className="border-b border-border">
              <th scope="col" className="px-4 py-2.5 font-medium">Date</th>
              <th scope="col" className="px-3 py-2.5 font-medium">Where</th>
              <th scope="col" className="px-3 py-2.5 font-medium">What happened</th>
              <th scope="col" className="px-3 py-2.5 font-medium">What was done</th>
              <th scope="col" className="px-3 py-2.5 text-right font-medium">Cost</th>
              <th scope="col" className="px-4 py-2.5 font-medium">Status</th>
            </tr>
          </thead>
          <tbody>
            {items.map((incident) => (
              <tr key={incident.id} className="border-b border-border align-top last:border-0">
                <td className="px-4 py-2.5 whitespace-nowrap">
                  <Link href={hrefOf(incident)} className="font-semibold text-primary hover:underline">
                    {shortDay(incident.happenedOn)}
                    <span className="sr-only">: open incident {incident.reference}</span>
                  </Link>
                  <span className="block text-muted tabular-nums">{incident.reference}</span>
                </td>
                <td className="px-3 py-2.5">{incident.outletName}</td>
                {/* Long accounts are cut to a few lines here; the incident's page has them in full. */}
                <td className="max-w-sm px-3 py-2.5">
                  <span className="line-clamp-4">{incident.whatHappened}</span>
                </td>
                <td className="max-w-sm px-3 py-2.5">
                  {incident.whatWasDone ? <span className="line-clamp-4">{incident.whatWasDone}</span> : <span className="text-muted">Nothing yet</span>}
                </td>
                <td className={`px-3 py-2.5 text-right whitespace-nowrap tabular-nums ${incident.costPaise ? "" : "text-muted"}`}>{costWords(incident.costPaise)}</td>
                <td className="px-4 py-2.5">
                  <IncidentStatusBadge status={incident.status} />
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </>
  );
}
