"use client";

import { can, FINANCE_LINE_LABELS, FINANCE_LINES, monthLabel, type ExpenseDto, type ExpenseListDto } from "@eccs/shared";
import Link from "next/link";
import { useEffect, useState } from "react";

import { useToast } from "@/components/toast";
import { Button, LoadError, Loading, NoAccess, PageHeader, SelectField } from "@/components/ui";
import { api } from "@/lib/api";
import { describe } from "@/lib/format";
import { useQuery } from "@/lib/query";
import { useSession } from "@/lib/session";

import { ExpenseSheet } from "../expense-form";
import { count, money } from "../finance-parts";
import { ExpenseTable } from "../finance-screen";

// "All entries": the whole expense book, newest first, filtered by month, budget line,
// paid or not, and linked to a visit or not (the filters of the Zoho Books and
// QuickBooks expense lists). Every filter is in the web address, so a filtered list can
// be bookmarked and comes back with Back.

const FILTERS = ["month", "category", "paid", "visit"] as const;

export default function ExpensesScreen() {
  const { user } = useSession();
  if (!(user && can(user.memberships, "finance", "read"))) return <NoAccess title="Expense book">The expense book is for the founders (the Super Admin).</NoAccess>;
  return <Expenses />;
}

function Expenses() {
  const query = useQuery();
  const notify = useToast();
  const filter = Object.fromEntries(FILTERS.map((name) => [name, query.get(name)])) as Record<(typeof FILTERS)[number], string>;
  const key = FILTERS.map((name) => filter[name]).join("|");

  const [loaded, setLoaded] = useState<{ key: string; data: ExpenseListDto } | null>(null);
  const [error, setError] = useState<{ key: string; message: string } | null>(null);
  const [attempt, setAttempt] = useState(0);
  const [open, setOpen] = useState(false);
  const [editing, setEditing] = useState<ExpenseDto | null>(null);

  useEffect(() => {
    let cancelled = false;
    const [month, category, paid, visit] = key.split("|");
    api.finance
      .expenses({ month: month || undefined, category: category || undefined, paid: (paid || undefined) as "yes" | "no" | undefined, visit: (visit || undefined) as "yes" | "no" | undefined })
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
  const entries = data?.entries ?? [];
  const total = entries.reduce((sum, entry) => sum + entry.amountPaise, 0);
  const filtered = FILTERS.some((name) => filter[name]);

  return (
    <div className="flex flex-col gap-6">
      <Link href="/finance" className="-mb-3 self-start rounded-md px-1 py-1 font-semibold text-primary hover:underline">
        ← Finance
      </Link>
      <PageHeader
        title="Expense book"
        description="Every expense and wage advance, newest first. Open one to change it, file its receipt or link it to a visit."
        action={
          <Button
            onClick={() => {
              setEditing(null);
              setOpen(true);
            }}
          >
            Add expense
          </Button>
        }
      />

      <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
        <SelectField label="Month" value={filter.month} onChange={(event) => query.set({ month: event.target.value || null }, "replace")}>
          <option value="">All months</option>
          {(data?.months ?? (filter.month ? [filter.month] : [])).map((month) => (
            <option key={month} value={month}>
              {monthLabel(month)}
            </option>
          ))}
        </SelectField>
        <SelectField label="Budget line" value={filter.category} onChange={(event) => query.set({ category: event.target.value || null }, "replace")}>
          <option value="">All lines</option>
          {FINANCE_LINES.map((line) => (
            <option key={line} value={line}>
              {FINANCE_LINE_LABELS[line]}
            </option>
          ))}
          <option value="WAGE_ADVANCE">Wage advances</option>
        </SelectField>
        <SelectField label="Paid" value={filter.paid} onChange={(event) => query.set({ paid: event.target.value || null }, "replace")}>
          <option value="">Paid or not</option>
          <option value="yes">Paid</option>
          <option value="no">Not yet paid</option>
        </SelectField>
        <SelectField label="Linked visit" value={filter.visit} onChange={(event) => query.set({ visit: event.target.value || null }, "replace")}>
          <option value="">With or without</option>
          <option value="yes">Linked to a visit</option>
          <option value="no">No visit</option>
        </SelectField>
      </div>

      {!data ? (
        error && error.key === key ? <LoadError message={error.message} onRetry={() => setAttempt((value) => value + 1)} /> : <Loading />
      ) : (
        <section className={`flex flex-col gap-3 rounded-xl border border-border bg-surface p-5 ${loaded?.key !== key ? "opacity-60" : ""}`}>
          <div className="flex flex-wrap items-center justify-between gap-3 text-sm">
            <p className="font-semibold">
              {count(entries.length, "entry", "entries")} · {money(total)}
            </p>
            {filtered && (
              <Button variant="link" className="text-sm" onClick={() => query.set({ month: null, category: null, paid: null, visit: null }, "replace")}>
                Clear the filters
              </Button>
            )}
          </div>
          <ExpenseTable
            entries={entries}
            showType
            onOpen={(entry) => {
              setEditing(entry);
              setOpen(true);
            }}
          />
        </section>
      )}

      <ExpenseSheet
        open={open}
        expense={editing}
        onClose={() => setOpen(false)}
        onSaved={(message) => {
          notify(message);
          setAttempt((value) => value + 1);
        }}
      />
    </div>
  );
}
