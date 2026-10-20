"use client";

import {
  can,
  CYCLE_WORDS,
  QUOTE_LIST_FILTERS,
  type QuoteBuildRowDto,
  type QuoteListDto,
  type QuoteListFilter,
  type QuoteRowDto,
} from "@eccs/shared";
import Link from "next/link";
import { useEffect, useState } from "react";

import { useToast } from "@/components/toast";
import { Button, EmptyState, LoadError, Loading, NoAccess, PageHeader, SelectField } from "@/components/ui";
import { api } from "@/lib/api";
import { describe } from "@/lib/format";
import { useNavCounts } from "@/lib/nav-counts";
import { useQuery } from "@/lib/query";
import { useSession } from "@/lib/session";

import { dayMonth, money, Segmented } from "../../finance/finance-parts";
import { sendOnWhatsapp } from "../leads/[id]/lead-sheets";
import { indiaDate, openedWords, QuoteStateBadge, SalesTabs } from "../sales-parts";

// Sales → Quotes (20 Oct 2026, the console plan 4.9 and the founder's design p. 7, "Quotes
// out"): every quote in one list with where it stands (draft, sent, won, declined,
// expired), how often the owner opened it and when last, and one button: Send a draft,
// Revise the latest quote once it waits for a reply or has expired, Open the rest. The
// free checks done with no quote yet are rows of the same list, first, as in the design
// ("Check done 19 Nov, no quote · Build now"): Build now opens the lead's quote with the
// services that fix what the check found already ticked. A BDE sees their own leads'
// quotes only. The list shows its first 30 rows, then "Show more".
//
// PATTERN FOLLOWED: the quote lists of Zoho Books (Draft, Sent, Accepted, Declined, Expired,
// marked by hand when the answer came another way; the customer's "viewed" history) and
// Jobber (quotes "awaiting response" as their own filter, one action per row), with the
// console's own table that becomes one card per row on a narrow screen, as on Leads.

const FILTER_LABELS: Record<QuoteListFilter, string> = {
  DRAFT: "Drafts",
  SENT: "Sent",
  WON: "Won",
  DECLINED: "Declined",
  EXPIRED: "Expired",
  BUILD: "Check done, no quote",
};

const plural = (n: number, one: string, many = `${one}s`) => `${n} ${n === 1 ? one : many}`;

/** How many rows the list shows before "Show more", so a long history does not make a long page. */
const PAGE_ROWS = 30;

export default function QuotesScreen() {
  const { user } = useSession();
  const allowed = user ? can(user.memberships, "sales", "read") : false;
  if (!allowed) return <NoAccess title="Quotes">The quotes are for the founders, the Ops Manager and the BDEs.</NoAccess>;
  return <Quotes />;
}

function Quotes() {
  const { user } = useSession();
  const query = useQuery();
  const { refresh: refreshCounts } = useNavCounts();
  const asked = query.get("state");
  const state = ((QUOTE_LIST_FILTERS as readonly string[]).includes(asked) ? asked : "") as QuoteListFilter | "";
  const owner = query.get("owner");
  const key = `${state}|${owner}`;
  const [loaded, setLoaded] = useState<{ key: string; data: QuoteListDto } | null>(null);
  const [error, setError] = useState<{ key: string; message: string } | null>(null);
  const [attempt, setAttempt] = useState(0);
  // How many rows are shown, kept with the list it belongs to so another filter starts short again.
  const [shown, setShown] = useState<{ key: string; rows: number }>({ key: "", rows: PAGE_ROWS });
  const sees = (user?.memberships ?? []).some((m) => m.role === "SUPER_ADMIN" || m.role === "OPS_MANAGER");

  useEffect(() => {
    let cancelled = false;
    const [listState, listOwner] = key.split("|");
    api.sales
      .quotes({ state: listState as QuoteListFilter | "", owner: listOwner || undefined })
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

  const changed = () => {
    setAttempt((value) => value + 1);
    refreshCounts();
  };

  const data = loaded?.data ?? null;
  const failure = error && error.key === key ? error.message : null;
  const waiting = data ? data.quotes.filter((quote) => quote.waitingDays !== null).length : 0;
  // The one line under the title says what needs doing, as the Sales page's headline does.
  const line = data
    ? [waiting > 0 && `${plural(waiting, "quote")} waiting for a reply`, data.counts.BUILD > 0 && `${plural(data.counts.BUILD, "free check")} with no quote yet`, data.counts.DRAFT > 0 && `${plural(data.counts.DRAFT, "draft")} not sent`]
        .filter(Boolean)
        .join(" · ") || "Every quote, where it stands and when the owner opened it."
    : "Every quote, where it stands and when the owner opened it.";
  const total = data ? QUOTE_LIST_FILTERS.filter((filter) => filter !== "BUILD").reduce((sum, filter) => sum + data.counts[filter], 0) : 0;

  return (
    <div className="flex flex-col gap-6">
      <PageHeader title="Quotes" description={line} />
      <SalesTabs current="quotes" />

      <div className="flex flex-wrap items-end gap-x-6 gap-y-3">
        {/* On a phone the choices scroll sideways rather than taking several lines. */}
        <div className="-mx-1 max-w-full overflow-x-auto px-1 py-0.5">
          <div className="w-max">
            <Segmented
              label="Show"
              showLabel={false}
              value={state}
              onChange={(value) => query.set({ state: value || null }, "replace")}
              options={[
                { value: "" as const, label: data ? `All · ${total}` : "All" },
                ...QUOTE_LIST_FILTERS.map((value) => ({ value, label: data ? `${FILTER_LABELS[value]} · ${data.counts[value]}` : FILTER_LABELS[value] })),
              ]}
            />
          </div>
        </div>
        {sees && data && data.owners.length > 0 && (
          <SelectField label="Whose quotes" value={owner} onChange={(event) => query.set({ owner: event.target.value || null }, "replace")} wrapperClassName="w-full max-w-xs">
            <option value="">Everyone</option>
            {data.owners.map((person) => (
              <option key={person.id} value={person.id}>
                {person.name}
              </option>
            ))}
          </SelectField>
        )}
      </div>

      {failure && <LoadError message={failure} onRetry={() => setAttempt((value) => value + 1)} />}
      {!data && !failure && <Loading />}
      {data && (
        <div className={`flex flex-col gap-6 ${loaded?.key !== key ? "opacity-60" : ""}`} aria-busy={loaded?.key !== key}>
          {(() => {
            // The free checks with no quote come first, as rows of the same list; then the quotes.
            const rows: ListRow[] = [
              ...(state === "" || state === "BUILD" ? data.buildNow.map((row) => ({ kind: "build" as const, row })) : []),
              ...(state === "BUILD" ? [] : data.quotes.map((quote) => ({ kind: "quote" as const, quote }))),
            ];
            if (rows.length === 0) {
              return state === "BUILD" ? (
                <EmptyState title="Every free check has its quote">A free check logged with no quote shows here, ready to build.</EmptyState>
              ) : (
                <EmptyState title={state ? `No ${FILTER_LABELS[state].toLowerCase()} quotes` : "No quotes yet"}>
                  A quote is made on a lead&apos;s page, or here with Build now after a free check.
                </EmptyState>
              );
            }
            const limit = shown.key === key ? shown.rows : PAGE_ROWS;
            return (
              <>
                <QuoteTable rows={rows.slice(0, limit)} showOwner={sees} onChanged={changed} />
                {rows.length > limit && (
                  <div className="flex flex-wrap items-center gap-3 text-sm">
                    <span role="status" className="text-muted">
                      Showing {limit} of {rows.length}.
                    </span>
                    <Button variant="secondary" size="sm" onClick={() => setShown({ key, rows: limit + PAGE_ROWS })}>
                      Show {Math.min(PAGE_ROWS, rows.length - limit)} more
                    </Button>
                  </div>
                )}
              </>
            );
          })()}
        </div>
      )}
    </div>
  );
}

/** One row of the list: a quote, or a free check done with no quote yet (the design's "Check done 19 Nov, no quote"). */
type ListRow = { kind: "quote"; quote: QuoteRowDto } | { kind: "build"; row: QuoteBuildRowDto };

/** "Check done 7 Oct, no quote · 6 things to fix". */
const buildWords = (row: QuoteBuildRowDto) =>
  [row.checkDoneAt ? `Check done ${dayMonth(indiaDate(row.checkDoneAt))}, no quote` : "Check done, no quote", row.checkFindings !== null ? `${plural(row.checkFindings, "thing")} to fix` : null]
    .filter(Boolean)
    .join(" · ");

/** Build now: the lead's quote, with the services that fix what the check found already ticked. */
function BuildNowLink({ row }: { row: QuoteBuildRowDto }) {
  return (
    <Link href={`/sales/leads/${row.leadId}?do=quote`} className="inline-flex items-center justify-center rounded-lg bg-primary px-3 py-1.5 text-sm font-semibold whitespace-nowrap text-white hover:bg-primary-hover">
      Build now<span className="sr-only"> a quote for {row.businessName}</span>
    </Link>
  );
}

const ACTION_LINK = "inline-flex items-center justify-center whitespace-nowrap rounded-lg border border-border-strong bg-surface px-3 py-1.5 text-sm font-semibold hover:bg-background";

/** The row's one button. Send opens WhatsApp with the message typed in; the others go to the lead. */
function RowAction({ quote, onChanged }: { quote: QuoteRowDto; onChanged: () => void }) {
  const notify = useToast();
  const [busy, setBusy] = useState(false);
  if (quote.action === "SEND") {
    return (
      <button
        type="button"
        disabled={busy}
        aria-busy={busy}
        className={`${ACTION_LINK} cursor-pointer disabled:opacity-50`}
        onClick={async () => {
          setBusy(true);
          try {
            const { hasPhone } = await sendOnWhatsapp(quote.id);
            notify(hasPhone ? `Quote ${quote.number} ready in WhatsApp: press send there` : `Quote ${quote.number} ready in WhatsApp: choose who to send it to`);
            onChanged();
          } catch (e) {
            notify(describe(e));
          } finally {
            setBusy(false);
          }
        }}
      >
        {busy ? "Please wait…" : "Send"}
        <span className="sr-only"> quote {quote.number}</span>
      </button>
    );
  }
  if (quote.action === "REVISE") {
    return (
      <Link href={`/sales/leads/${quote.leadId}?do=quote&from=${encodeURIComponent(quote.id)}`} className={ACTION_LINK}>
        Revise<span className="sr-only"> quote {quote.number}</span>
      </Link>
    );
  }
  return (
    <Link href={`/sales/leads/${quote.leadId}`} className={ACTION_LINK}>
      Open<span className="sr-only"> {quote.businessName}</span>
    </Link>
  );
}

/** Where it stands, with what needs knowing beside the badge: how long it has waited, or why it was declined. */
function StateCell({ quote }: { quote: QuoteRowDto }) {
  return (
    <>
      <QuoteStateBadge state={quote.state} />
      {quote.waitingDays !== null && (
        <span className="mt-1 block font-semibold text-danger">
          <span aria-hidden>● </span>No reply · {plural(quote.waitingDays, "day")}
        </span>
      )}
      {quote.state === "DECLINED" && quote.outcomeReason && <span className="mt-1 block text-muted">{quote.outcomeReason}</span>}
      {quote.state === "WON" && <span className="mt-1 block text-muted">{quote.outcomeBy ? `Marked by ${quote.outcomeBy}` : "Became a client"}</span>}
    </>
  );
}

const totalWords = (quote: QuoteRowDto) => `${money(quote.totalPaise)}${quote.perCycle ? ` ${CYCLE_WORDS[quote.perCycle]}` : ""}`;
const sentWords = (quote: QuoteRowDto) => (quote.sentAt ? dayMonth(indiaDate(quote.sentAt)) : "Not sent");

function QuoteTable({ rows, showOwner, onChanged }: { rows: readonly ListRow[]; showOwner: boolean; onChanged: () => void }) {
  const restaurant = (lead: { leadId: string; businessName: string; area: string | null; kitchens?: number; ownerName: string }) => (
    <>
      <Link href={`/sales/leads/${lead.leadId}`} className="font-semibold text-primary hover:underline">
        {lead.businessName}
      </Link>
      <span className="block text-muted">{[lead.area, lead.kitchens && lead.kitchens > 1 ? `${lead.kitchens} kitchens` : null, showOwner ? lead.ownerName : null].filter(Boolean).join(" · ")}</span>
    </>
  );
  const quotes = rows.flatMap((one) => (one.kind === "quote" ? [one.quote] : []));
  const builds = rows.flatMap((one) => (one.kind === "build" ? [one.row] : []));
  return (
    <>
      {/* A narrow screen gets one card per quote, with the same facts in the same order. */}
      <ul className="flex flex-col divide-y divide-border rounded-xl border border-border bg-surface px-4 text-sm md:hidden">
        {builds.map((row) => (
          <li key={row.leadId} className="flex flex-col gap-1.5 py-3">
            <span className="min-w-0">{restaurant(row)}</span>
            <div className="flex flex-wrap items-center justify-between gap-2">
              <span className="font-semibold text-danger">{buildWords(row)}</span>
              <BuildNowLink row={row} />
            </div>
          </li>
        ))}
        {quotes.map((quote) => (
          <li key={quote.id} className="flex flex-col gap-1.5 py-3">
            <div className="flex items-start justify-between gap-3">
              <span className="min-w-0">{restaurant(quote)}</span>
              <span className="shrink-0 text-right font-semibold tabular-nums">{totalWords(quote)}</span>
            </div>
            <div className="flex flex-wrap gap-x-3 text-muted">
              <span className="tabular-nums">{quote.number}</span>
              <span>{quote.sentAt ? `Sent ${sentWords(quote)}` : "Not sent"}</span>
              {quote.status === "SENT" && <span>{openedWords(quote)}</span>}
            </div>
            <div className="flex flex-wrap items-start justify-between gap-2">
              <span className="min-w-0">
                <StateCell quote={quote} />
              </span>
              <RowAction quote={quote} onChanged={onChanged} />
            </div>
          </li>
        ))}
      </ul>
      <div className="hidden overflow-x-auto rounded-xl border border-border bg-surface md:block">
        <table className="w-full text-left text-sm">
          <caption className="sr-only">Free checks with no quote yet, then the quotes, newest first</caption>
          <thead className="text-muted">
            <tr className="border-b border-border">
              <th scope="col" className="px-4 py-2.5 font-medium">Quote</th>
              <th scope="col" className="px-3 py-2.5 font-medium">Restaurant</th>
              <th scope="col" className="px-3 py-2.5 text-right font-medium">Total with GST</th>
              <th scope="col" className="px-3 py-2.5 font-medium">Sent</th>
              <th scope="col" className="px-3 py-2.5 font-medium">Opened</th>
              <th scope="col" className="px-3 py-2.5 font-medium">State</th>
              <th scope="col" className="px-4 py-2.5 font-medium">
                <span className="sr-only">What to do</span>
              </th>
            </tr>
          </thead>
          <tbody>
            {builds.map((row) => (
              <tr key={row.leadId} className="border-b border-border align-top last:border-0">
                <td className="px-4 py-2.5 text-muted">—</td>
                <td className="px-3 py-2.5">{restaurant(row)}</td>
                <td className="px-3 py-2.5 text-right text-muted">—</td>
                <td className="px-3 py-2.5 text-muted">—</td>
                <td className="px-3 py-2.5 text-muted">—</td>
                <td className="px-3 py-2.5 font-semibold text-danger">{buildWords(row)}</td>
                <td className="px-4 py-2.5 text-right">
                  <BuildNowLink row={row} />
                </td>
              </tr>
            ))}
            {quotes.map((quote) => (
              <tr key={quote.id} className="border-b border-border align-top last:border-0">
                <td className="px-4 py-2.5 whitespace-nowrap tabular-nums">{quote.number}</td>
                <td className="px-3 py-2.5">{restaurant(quote)}</td>
                <td className="px-3 py-2.5 text-right whitespace-nowrap tabular-nums">{totalWords(quote)}</td>
                <td className="px-3 py-2.5 whitespace-nowrap">{sentWords(quote)}</td>
                <td className="px-3 py-2.5">{quote.status === "SENT" ? openedWords(quote) : "—"}</td>
                <td className="px-3 py-2.5">
                  <StateCell quote={quote} />
                </td>
                <td className="px-4 py-2.5 text-right">
                  <RowAction quote={quote} onChanged={onChanged} />
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </>
  );
}
