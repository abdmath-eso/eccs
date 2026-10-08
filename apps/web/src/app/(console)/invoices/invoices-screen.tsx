"use client";

import { can, type BillingTotalsDto, type InvoiceSummaryDto } from "@eccs/shared";
import { useEffect, useState } from "react";

import { useToast } from "@/components/toast";
import { Button, Card, ErrorMessage, Field, LoadError, Loading, NoAccess, PageHeader, SelectField, ToggleGroup } from "@/components/ui";
import { api } from "@/lib/api";
import { describe, longDay as day, matchesSearch } from "@/lib/format";
import { useNavCounts } from "@/lib/nav-counts";
import { isPlainClick, useQuery, useQueryField } from "@/lib/query";
import { useSession } from "@/lib/session";

import { InvoiceDetail } from "./invoice-detail";
import { money, standingOf, StateBadge, type Standing } from "./invoice-parts";

type Show = "all" | Standing;
const SHOWS: readonly Show[] = ["all", "due", "overdue", "paid", "void"];

/**
 * Invoices: every GST invoice ECCS has raised, across all clients, the newest
 * first. Nothing is typed in here: an invoice is raised by itself, for each
 * cycle of an outlet's plan and for a booked one-time visit when its report is
 * approved under Visits. From here ECCS sees what is owed, finds an invoice,
 * opens it, records a payment received outside the app, or makes it void.
 *
 * The layout is the one accounting tools use for money owed: the totals
 * first (due, overdue, collected), then a table that can be searched and
 * narrowed by state and by client, each row opening the invoice.
 *
 * The search, the filters and the open invoice are kept in the web address
 * as `q=`, `show=`, `client=` and `invoice=`.
 */
export default function InvoicesScreen() {
  const { user } = useSession();
  const notify = useToast();
  const query = useQuery();
  const { refresh: refreshCounts } = useNavCounts();
  const [search, setSearch] = useQueryField("q");
  const [client, setClient] = useQueryField("client");

  const [invoices, setInvoices] = useState<InvoiceSummaryDto[] | null>(null);
  const [totals, setTotals] = useState<BillingTotalsDto | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [version, setVersion] = useState(0);
  const [raising, setRaising] = useState(false);
  const [raiseError, setRaiseError] = useState<string | null>(null);

  // Invoices are for Super Admins and Operations Managers; a Supervisor has no access to them.
  const allowed = user ? can(user.memberships, "invoices", "update") : false;
  const asked = query.get("show") as Show;
  const show: Show = SHOWS.includes(asked) ? asked : "all";
  const openId = query.get("invoice");

  useEffect(() => {
    if (!allowed) return;
    let cancelled = false;
    Promise.all([api.billing.invoices(), api.billing.totals()])
      .then(([list, sums]) => {
        if (cancelled) return;
        setInvoices(list);
        setTotals(sums);
        setError(null);
      })
      .catch((e) => !cancelled && setError(describe(e)));
    return () => {
      cancelled = true;
    };
  }, [allowed, version]);

  /** After anything that changes an invoice: the list, the totals and the number in the menu are fetched again. */
  const reload = () => {
    setVersion((current) => current + 1);
    refreshCounts();
  };

  /** Raises, now, the invoice of every plan whose cycle has begun and has none. The server also does this by itself every few hours. */
  async function raiseDue() {
    setRaising(true);
    setRaiseError(null);
    try {
      const { raised } = await api.billing.raiseDue();
      notify(raised === 0 ? "Nothing was due: every plan's current cycle already has its invoice" : `${raised} invoice${raised === 1 ? "" : "s"} raised`);
      reload();
    } catch (e) {
      setRaiseError(describe(e));
    } finally {
      setRaising(false);
    }
  }

  if (!allowed) {
    return (
      <NoAccess title="Invoices">Invoices and payments are for Super Admins and Operations Managers.</NoAccess>
    );
  }

  if (openId) {
    return (
      <InvoiceDetail
        key={openId}
        invoiceId={openId}
        backHref={query.hrefWith({ invoice: null })}
        onBack={() => query.set({ invoice: null })}
        onOpen={(id) => query.set({ invoice: id })}
        onChanged={reload}
      />
    );
  }

  const all = invoices ?? [];
  const clients = [...new Map(all.map((invoice) => [invoice.organizationId, invoice.organizationName])).entries()].sort((a, b) =>
    a[1].localeCompare(b[1]),
  );
  const found = all.filter(
    (invoice) =>
      (!client || invoice.organizationId === client) &&
      matchesSearch(search, [invoice.number, invoice.organizationName, invoice.outletName, invoice.description]),
  );
  const shown = found.filter((invoice) => show === "all" || standingOf(invoice) === show || (show === "due" && standingOf(invoice) === "overdue"));
  const counted = (standing: Standing) =>
    found.filter((invoice) => standingOf(invoice) === standing || (standing === "due" && standingOf(invoice) === "overdue")).length;
  const filtered = show !== "all" || Boolean(client) || Boolean(search);

  const tile = (label: string, amount: number | undefined, note: string, to: Show | null, alarm = false) => {
    const body = (
      <>
        <span className="text-sm font-medium text-muted">{label}</span>
        <span className={`text-2xl font-bold ${alarm ? "text-danger" : ""}`}>
          {alarm && <span aria-hidden>! </span>}
          {amount === undefined ? "…" : money(amount)}
        </span>
        <span className="text-sm text-muted">{note}</span>
      </>
    );
    const frame = "flex flex-1 basis-56 flex-col gap-1 rounded-xl border bg-surface p-4 text-left";
    // The two tiles that count invoices also narrow the table to them.
    return to ? (
      <button
        type="button"
        aria-pressed={show === to}
        onClick={() => query.set({ show: show === to ? null : to }, "replace")}
        className={`${frame} cursor-pointer hover:bg-background ${show === to ? "border-primary ring-1 ring-primary" : "border-border"}`}
      >
        {body}
      </button>
    ) : (
      <div className={`${frame} border-border`}>{body}</div>
    );
  };
  const invoicesNote = (count: number | undefined) => (count === undefined ? "" : `${count} invoice${count === 1 ? "" : "s"}`);

  return (
    <div className="flex flex-col gap-6">
      <PageHeader
        title="Invoices"
        description="The GST invoices ECCS has raised, and what is still owed on them."
        secondary={
          // A failure stays here, under the button that caused it.
          <div className="flex flex-col items-end gap-2">
            <Button variant="secondary" loading={raising} onClick={() => void raiseDue()}>
              Raise invoices that are due
            </Button>
            <ErrorMessage message={raiseError} />
          </div>
        }
        how={
          <>
            <p>
              An invoice is raised by itself at the start of each cycle of an outlet&apos;s plan, and for a booked one-time visit when
              you approve its report under Visits. The restaurant&apos;s Owner and Manager see theirs in the app, where the Owner can
              pay.
            </p>
            <p>
              An invoice is due 7 days after its date, and counts as overdue from the day after that while anything is still owed on
              it. A void invoice stays on record with its number, which is never used again.
            </p>
            <p>Company details, prices and the invoice layout are samples, and no real payment is taken anywhere.</p>
          </>
        }
      />

      <div className="flex flex-wrap gap-4">
        {tile("Due", totals?.duePaise, `${invoicesNote(totals?.unpaidCount)} not yet paid in full`, "due")}
        {tile("Overdue", totals?.overduePaise, `${invoicesNote(totals?.overdueCount)} past the due date`, "overdue", (totals?.overdueCount ?? 0) > 0)}
        {tile("Collected this month", totals?.collectedThisMonthPaise, "payments received since the 1st", null)}
      </div>

      <Card className="flex flex-col gap-4">
        <div className="flex flex-wrap items-end gap-4">
          <Field
            label="Search"
            plainLabel
            type="search"
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            placeholder="Number, client, outlet or what it is for"
            wrapperClassName="w-full sm:max-w-sm"
          />
          <SelectField label="Client" value={client} onChange={(e) => setClient(e.target.value)} wrapperClassName="w-full sm:max-w-xs">
            <option value="">All clients</option>
            {clients.map(([id, name]) => (
              <option key={id} value={id}>
                {name}
              </option>
            ))}
          </SelectField>
        </div>
        <ToggleGroup
          label="Show"
          value={show}
          onChange={(value) => query.set({ show: value === "all" ? null : value }, "replace")}
          options={[
            { value: "all", label: "All", count: found.length },
            { value: "due", label: "To pay", count: counted("due") },
            { value: "overdue", label: "Overdue", count: counted("overdue") },
            { value: "paid", label: "Paid", count: counted("paid") },
            { value: "void", label: "Void", count: counted("void") },
          ]}
        />

        <LoadError message={error} onRetry={() => setVersion((value) => value + 1)} />
        {invoices === null && !error && <Loading />}

        {invoices !== null && all.length === 0 && (
          <p className="text-muted">
            No invoices have been raised yet. The first appears here when a plan&apos;s cycle begins or when you approve the report of
            a booked visit.
          </p>
        )}
        {all.length > 0 && shown.length === 0 && (
          <div className="flex flex-col items-start gap-2">
            <p className="text-muted">No invoices match.</p>
            {filtered && (
              <Button
                variant="link"
                className="-ml-2"
                onClick={() => {
                  setSearch("");
                  setClient("");
                  query.set({ show: null }, "replace");
                }}
              >
                Clear the search and the filters
              </Button>
            )}
          </div>
        )}

        {/* Read out when the search or a filter changes what is listed. */}
        <p role="status" className="sr-only">
          {invoices !== null ? `${shown.length} invoice${shown.length === 1 ? "" : "s"} listed` : ""}
        </p>

        {shown.length > 0 && (
          // The side padding keeps the focus ring of the first and last columns from being cut off by the scrolling box.
          <div className="-mx-4 overflow-x-auto px-4">
            <table className="w-full text-left text-sm">
              <thead className="text-muted">
                <tr className="border-b border-border">
                  <th scope="col" className="py-2 pr-4 font-medium">
                    Invoice
                  </th>
                  <th scope="col" className="py-2 pr-4 font-medium">
                    Client and outlet
                  </th>
                  <th scope="col" className="py-2 pr-4 font-medium">
                    For
                  </th>
                  <th scope="col" className="py-2 pr-4 font-medium">
                    Due date
                  </th>
                  <th scope="col" className="py-2 pr-4 text-right font-medium">
                    Total
                  </th>
                  <th scope="col" className="py-2 pr-4 text-right font-medium">
                    Still due
                  </th>
                  <th scope="col" className="py-2 font-medium">
                    Status
                  </th>
                </tr>
              </thead>
              <tbody>
                {shown.map((invoice) => (
                  <tr key={invoice.id} className="border-b border-border align-top last:border-0">
                    <th scope="row" className="py-2.5 pr-4 font-semibold whitespace-nowrap">
                      <a
                        href={query.hrefWith({ invoice: invoice.id })}
                        onClick={(event) => {
                          if (!isPlainClick(event)) return;
                          event.preventDefault();
                          query.set({ invoice: invoice.id });
                        }}
                        className="inline-block py-0.5 text-primary hover:underline"
                      >
                        {invoice.number}
                      </a>
                      <div className="font-normal text-muted">{day(invoice.issueDate)}</div>
                    </th>
                    <td className="py-2.5 pr-4">
                      {invoice.organizationName}
                      <div className="text-muted">{invoice.outletName}</div>
                    </td>
                    <td className="max-w-xs py-2.5 pr-4">
                      {invoice.kind === "SUBSCRIPTION" ? "Plan" : "One-time visit"}
                      <div className="text-muted">{invoice.description}</div>
                    </td>
                    <td className="py-2.5 pr-4 whitespace-nowrap">{day(invoice.dueDate)}</td>
                    <td className="py-2.5 pr-4 text-right whitespace-nowrap tabular-nums">{money(invoice.totalPaise)}</td>
                    <td className="py-2.5 pr-4 text-right font-semibold whitespace-nowrap tabular-nums">
                      {invoice.duePaise > 0 ? money(invoice.duePaise) : <span className="font-normal text-muted">Nothing</span>}
                    </td>
                    <td className="py-2.5">
                      <StateBadge invoice={invoice} />
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </Card>
    </div>
  );
}
