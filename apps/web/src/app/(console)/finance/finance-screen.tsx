"use client";

import {
  can,
  EXPENSE_TYPE_LABELS,
  FINANCE_LINE_SHORT,
  financePeriod,
  monthLabel,
  monthName,
  monthOf,
  type CashDayDetailDto,
  type ExpenseDto,
  type FinanceOverviewDto,
  type FinancePeriodChoice,
  type PayoutGroupDto,
} from "@eccs/shared";
import Link from "next/link";
import { useEffect, useState, type ReactNode } from "react";

import { useToast } from "@/components/toast";
import { Button, ErrorMessage, Field, LoadError, Loading, NoAccess, PageHeader } from "@/components/ui";
import { api } from "@/lib/api";
import { describe, longDay, today } from "@/lib/format";
import { useQuery } from "@/lib/query";
import { useSession } from "@/lib/session";

import { BalanceLine, GroupedBars, Meter, StackBar } from "./finance-charts";
import { COLOR, count, dayMonth, Legend, longWeekday, money, Panel, SampleBadge, Segmented, signed, weekdayDay, weekdayShort } from "./finance-parts";
import { ExpenseSheet } from "./expense-form";
import { BudgetSheet, ExportSheet, FoundersSheet, MarkPaidSheet, OpeningSheet } from "./finance-sheets";

// The Finance page (15 Oct 2026): money in, money out and the budget, for the founders.
// Invoices and payments come from billing; expenses are entered here.
//
// PATTERN FOLLOWED: the founder's own design (docs/design/2026-10-15 Finance dashboard),
// itself the shape of established finance dashboards: Zoho Books' dashboard (cash flow
// over time, receivables split into current and overdue with the ageing under it,
// income against expenses), and founder dashboards (burn against the budget line by
// line, the cash balance day by day, runway in months, every figure next to its
// target). The main figures come first; the expense book, ageing and payouts below.

const PERIOD_KEY = "period";

export default function FinanceScreen() {
  const { user } = useSession();
  const allowed = user ? can(user.memberships, "finance", "read") : false;
  if (!allowed) return <NoAccess title="Finance">The Finance page is for the founders (the Super Admin).</NoAccess>;
  return <Finance />;
}

type SheetName = "expense" | "budget" | "founders" | "opening" | "export" | null;

function Finance() {
  const query = useQuery();
  const notify = useToast();
  const now = today();

  const choice = (["fy", "custom"].includes(query.get(PERIOD_KEY)) ? query.get(PERIOD_KEY) : "month") as FinancePeriodChoice;
  const { from, to } = financePeriod(choice, now, { from: query.get("from") || undefined, to: query.get("to") || undefined });
  const budgetId = query.get("budget") || null;
  const day = /^\d{4}-\d{2}-\d{2}$/.test(query.get("day")) ? query.get("day") : now;
  const key = `${from}|${to}|${budgetId ?? ""}`;

  const [loaded, setLoaded] = useState<{ key: string; data: FinanceOverviewDto } | null>(null);
  const [error, setError] = useState<{ key: string; message: string } | null>(null);
  const [dayCash, setDayCash] = useState<{ key: string; data: CashDayDetailDto | null; error: string | null } | null>(null);
  const [attempt, setAttempt] = useState(0);
  const [sheet, setSheet] = useState<SheetName>(null);
  const [editing, setEditing] = useState<ExpenseDto | null>(null);
  const [payout, setPayout] = useState<PayoutGroupDto | null>(null);
  const [reminding, setReminding] = useState<string | null>(null);
  const [remindError, setRemindError] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    const [periodFrom, periodTo, budget] = key.split("|");
    api.finance
      .overview({ from: periodFrom!, to: periodTo!, budgetId: budget || null })
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

  const dayKey = `${day}|${attempt}`;
  useEffect(() => {
    let cancelled = false;
    const date = dayKey.split("|")[0]!;
    api.finance
      .day(date)
      .then((data) => !cancelled && setDayCash({ key: dayKey, data, error: null }))
      .catch((e) => !cancelled && setDayCash({ key: dayKey, data: null, error: describe(e) }));
    return () => {
      cancelled = true;
    };
  }, [dayKey]);

  /** After anything is saved: say so, and fetch the figures again. */
  const saved = (message: string) => {
    notify(message);
    setAttempt((value) => value + 1);
  };

  const data = loaded?.data ?? null;
  const failure = error && error.key === key ? error.message : null;
  if (!data) {
    return (
      <div className="flex flex-col gap-6">
        <PageHeader title="Finance" description="Money in, money out and the budget." />
        {failure ? <LoadError message={failure} onRetry={() => setAttempt((value) => value + 1)} /> : <Loading />}
      </div>
    );
  }

  const budget = data.budgets.find((entry) => entry.id === data.budgetId) ?? null;
  const budgetWord = budget ? budget.name.toLowerCase() : null;
  const thisMonth = monthOf(now);
  const periodLine =
    choice === "month"
      ? `${monthLabel(thisMonth)}, to ${weekdayDay(now)}`
      : choice === "fy"
        ? `Financial year from ${longDay(from)}, to ${weekdayDay(now)} ${monthName(thisMonth)}`
        : `${longDay(from)} to ${longDay(to)}`;

  function choosePeriod(next: FinancePeriodChoice) {
    if (next === "custom") query.set({ [PERIOD_KEY]: "custom", from, to }, "replace");
    else query.set({ [PERIOD_KEY]: next === "month" ? null : next, from: null, to: null }, "replace");
  }

  function openExpense(expense: ExpenseDto | null) {
    setEditing(expense);
    setSheet("expense");
  }

  /** WhatsApp with the reminder typed in, opened in a new tab; nothing is sent by the server. */
  async function remind(invoiceId: string) {
    setReminding(invoiceId);
    setRemindError(null);
    // Opened while the click still counts, so the browser does not block it as a pop-up.
    const tab = window.open("", "_blank");
    try {
      const { url } = await api.finance.remind(invoiceId);
      if (tab) {
        tab.opener = null;
        tab.location.href = url;
      } else window.location.assign(url);
    } catch (e) {
      tab?.close();
      setRemindError(describe(e));
    } finally {
      setReminding(null);
    }
  }

  const { cards } = data;
  const reloading = loaded?.key !== key;

  return (
    <div className="flex flex-col gap-6">
      <PageHeader
        title="Finance"
        description="Money in, money out and the budget. Invoices and payments come from Billing; expenses are entered here."
        secondary={
          <>
            <Button variant="secondary" onClick={() => setSheet("budget")}>
              {budget ? `Budget (${budgetWord})` : "Budget"}
            </Button>
            <Button variant="secondary" onClick={() => setSheet("export")}>
              Export CSV for the CA
            </Button>
          </>
        }
        action={<Button onClick={() => openExpense(null)}>Add expense</Button>}
      />

      <div className="-mt-3 flex flex-wrap items-center gap-3 text-sm text-muted">
        {data.sample && <SampleBadge />}
        <span>{periodLine}</span>
      </div>

      <div className="flex flex-wrap items-center gap-x-6 gap-y-3">
        <Segmented
          label="Period"
          value={choice}
          onChange={choosePeriod}
          options={[
            { value: "month", label: monthLabel(thisMonth) },
            { value: "fy", label: "FY to date" },
            { value: "custom", label: "Custom" },
          ]}
        />
        {choice === "custom" && (
          <div className="flex flex-wrap items-end gap-3">
            <Field label="From" type="date" plainLabel value={from} max={now} onChange={(event) => event.target.value && query.set({ from: event.target.value }, "replace")} />
            <Field label="To" type="date" plainLabel value={to} onChange={(event) => event.target.value && query.set({ to: event.target.value }, "replace")} />
          </div>
        )}
        {data.budgets.length > 0 && (
          <Segmented
            label="Compare with"
            value={data.budgetId ?? ""}
            onChange={(id) => query.set({ budget: id }, "replace")}
            options={data.budgets.map((entry) => ({ value: entry.id, label: `${entry.name} budget ${money(entry.totalPaise)}` }))}
          />
        )}
      </div>

      <div className={`flex flex-col gap-6 ${reloading ? "opacity-60" : ""}`} aria-busy={reloading}>
        {/* ── The six cards ── */}
        <div className="grid grid-cols-2 gap-3 md:grid-cols-3 xl:grid-cols-6">
          <Figure label="Invoiced" value={money(cards.invoiced.totalPaise)}>
            {count(cards.invoiced.count, "invoice")} · {count(cards.invoiced.plans, "plan")}, {count(cards.invoiced.oneOff, "one-off job")}
          </Figure>
          <Figure label="Collected" value={money(cards.collected.paise)}>
            {cards.collected.percentOfInvoiced === null ? (
              "Nothing invoiced in the period"
            ) : (
              <>
                {cards.collected.percentOfInvoiced}% of invoiced · target ≥ {cards.collected.targetPercent}%
                {cards.collected.percentOfInvoiced < cards.collected.targetPercent && <span className="block font-semibold text-danger">Below target</span>}
              </>
            )}
          </Figure>
          <Figure label="Outstanding" value={money(cards.outstanding.paise)}>
            {cards.outstanding.overdueCount > 0 ? (
              <span className="inline-flex items-center gap-1.5 rounded-full bg-danger/10 px-2 py-0.5 font-semibold text-danger">
                <span aria-hidden className="h-1.5 w-1.5 rounded-full bg-danger" />
                {cards.outstanding.overdueCount} overdue · {money(cards.outstanding.overduePaise)}
              </span>
            ) : cards.outstanding.count > 0 ? (
              `${count(cards.outstanding.count, "invoice")}, none overdue`
            ) : (
              "Nothing owed"
            )}
          </Figure>
          <Figure label="Expenses" value={money(cards.expenses.paise)}>
            {cards.expenses.percentOfBudget === null
              ? "No budget to compare with"
              : `${cards.expenses.percentOfBudget}% of ${budgetWord} budget, ${cards.expenses.percentOfPeriodGone}% of ${data.budgetMonths.length > 1 ? "the months" : "month"} gone`}
          </Figure>
          <Figure label={choice === "month" ? "Net cash this month" : "Net cash in the period"} value={money(cards.netCash.paise)}>
            {cards.netCash.plannedPaise === null
              ? "No plan for these months"
              : `plan said ${money(cards.netCash.plannedPaise)} for ${cards.netCash.plannedMonths.length === 1 ? monthName(cards.netCash.plannedMonths[0]!) : `these ${cards.netCash.plannedMonths.length} months`}`}
          </Figure>
          <Figure label="Plan revenue a month" value={money(cards.planRevenue.monthlyPaise)}>
            {count(cards.planRevenue.active, "active plan")} · {cards.planRevenue.cancelled} cancelled
          </Figure>
        </div>

        {/* ── Weekly bars and the budget lines ── */}
        <div className="grid gap-6 lg:grid-cols-2">
          <Panel
            title={`Collected against expenses, by ${data.bucketKind}`}
            description={data.bucketKind === "week" ? "Expenses include salaries, spread over the weeks of their month." : "Expenses include salaries."}
          >
            <Legend items={[{ label: "Collected", color: COLOR.in }, { label: "Expenses", color: COLOR.out }]} />
            {data.buckets.length === 0 ? (
              <p className="text-sm text-muted">Nothing in this period yet.</p>
            ) : (
              <GroupedBars
                caption="Collected against expenses"
                series={[{ label: "Collected", color: COLOR.in }, { label: "Expenses", color: COLOR.out }]}
                barWidth={data.buckets.length > 6 ? "w-2.5" : "w-6"}
                groups={data.buckets.map((bucket) => ({
                  key: bucket.from,
                  title: `${bucket.label} (${dayMonth(bucket.from)} to ${dayMonth(bucket.to)}): collected ${money(bucket.collectedPaise)}, expenses ${money(bucket.expensesPaise)}`,
                  values: [bucket.collectedPaise, bucket.expensesPaise],
                  label: (
                    <>
                      <span className="block font-medium text-foreground">{bucket.label}</span>
                      {data.buckets.length <= 6 && (
                        <span className="block tabular-nums">
                          {money(bucket.collectedPaise)} · {money(bucket.expensesPaise)}
                        </span>
                      )}
                    </>
                  ),
                }))}
              />
            )}
          </Panel>

          <Panel
            title={budget ? `Expenses against the ${budgetWord} budget, by category` : "Expenses by category"}
            description={budget ? "The bar is how much of each budget line is used. Salaries come from each person's salary on the Team page." : "Add a budget to compare with."}
          >
            <ul className="flex flex-col gap-3">
              {data.lines.map((line) => {
                const over = line.overByPaise > 0 && line.budgetPaise !== null;
                const largest = Math.max(1, ...data.lines.map((entry) => entry.actualPaise));
                return (
                  <li key={line.line} className="grid grid-cols-[minmax(0,1fr)_auto] items-center gap-x-3 gap-y-1 text-sm sm:grid-cols-[minmax(0,11rem)_minmax(0,1fr)_auto]">
                    <span className="min-w-0">{line.label}</span>
                    <span className="order-3 col-span-2 sm:order-none sm:col-span-1">
                      <Meter fraction={line.budgetPaise ? line.actualPaise / line.budgetPaise : line.actualPaise / largest} color={over ? COLOR.over : COLOR.in} />
                    </span>
                    <span className="flex items-center justify-end gap-2 text-right whitespace-nowrap tabular-nums">
                      {over && (
                        <span className="rounded-full bg-danger/10 px-2 py-0.5 text-xs font-semibold text-danger">
                          <span aria-hidden>● </span>over by {money(line.overByPaise)}
                        </span>
                      )}
                      <span>
                        {money(line.actualPaise)}
                        {line.budgetPaise !== null && <span className="text-muted"> of {money(line.budgetPaise)}</span>}
                      </span>
                    </span>
                  </li>
                );
              })}
            </ul>
          </Panel>
        </div>

        {/* ── Founders' money and the cash ── */}
        <div className="grid gap-6 lg:grid-cols-2">
          <FoundersPanel data={data} onRecord={() => setSheet("founders")} />
          <CashPanel data={data} onOpening={() => setSheet("opening")} />
        </div>

        {/* ── One day's cash and the daily spend ── */}
        <div className="grid gap-6 lg:grid-cols-2">
          <Panel
            title={`${day === now ? "Today's cash" : "Cash"}, ${longWeekday(day)}`}
            description="Opening, what came in and went out, and closing. Any day can be chosen."
            action={
              <label className="flex items-center gap-2 text-sm">
                <span className="sr-only">Day</span>
                <input
                  type="date"
                  value={day}
                  max={now}
                  onChange={(event) => event.target.value && query.set({ day: event.target.value === now ? null : event.target.value }, "replace")}
                  className="rounded-lg border border-border-strong bg-surface px-2 py-1.5"
                />
              </label>
            }
          >
            <DayCash cash={dayCash && dayCash.key === dayKey ? dayCash : null} />
          </Panel>

          <Panel
            title={`Daily operating expenses by type, last ${data.dailySpend.days} days`}
            description={
              data.dailySpend.totalPaise > 0
                ? `${money(data.dailySpend.totalPaise)} paid out, about ${money(data.dailySpend.perDayPaise)} a day. Salaries are outside this: they are paid monthly.`
                : "Nothing was paid out in these days."
            }
          >
            <ul className="flex flex-col gap-3">
              {data.dailySpend.types.map((type) => (
                <li key={type.key} className="grid grid-cols-[minmax(0,1fr)_auto] items-center gap-x-3 gap-y-1 text-sm sm:grid-cols-[minmax(0,12rem)_minmax(0,1fr)_5rem]">
                  <span>{type.label}</span>
                  <span className="order-3 col-span-2 sm:order-none sm:col-span-1">
                    <Meter fraction={type.paise / Math.max(1, data.dailySpend.types[0]!.paise)} color={COLOR.out} track="#F3F1EE" />
                  </span>
                  <span className="text-right tabular-nums">{money(type.paise)}</span>
                </li>
              ))}
            </ul>
            {data.dailySpend.highest && data.dailySpend.lowest && (
              <p className="border-t border-border pt-3 text-sm text-muted">
                Highest day: {dayMonth(data.dailySpend.highest.date)}, {money(data.dailySpend.highest.paise)} · Lowest: {dayMonth(data.dailySpend.lowest.date)} (
                {weekdayShort(data.dailySpend.lowest.date)}), {money(data.dailySpend.lowest.paise)}
              </p>
            )}
            {data.dailySpend.advancesToRecoverPaise > 0 && (
              <p className="text-sm text-muted">Wage advances of {money(data.dailySpend.advancesToRecoverPaise)} are still to be recovered from pay.</p>
            )}
          </Panel>
        </div>

        {/* ── Page 2 of the design: the expense book, collections ageing, payouts due ── */}
        <div className="grid gap-6 lg:grid-cols-[minmax(0,1.45fr)_minmax(0,1fr)]">
          <Panel
            title="Expense book"
            description="Latest entries. A receipt is filed with each one; a visit link puts the cost on that job's margin."
            action={
              <Link href="/finance/expenses" className="rounded-md px-1 py-1 text-sm font-semibold text-primary hover:underline">
                All {data.entryCount} entries
              </Link>
            }
          >
            <ExpenseTable entries={data.latest} onOpen={openExpense} compact />
          </Panel>

          <div className="flex min-w-0 flex-col gap-6">
            <Panel title="Collections ageing" description={`${money(data.ageing.totalPaise)} outstanding across ${count(data.ageing.count, "invoice")}`}>
              <AgeingBar ageing={data.ageing} />
              <ErrorMessage message={remindError} />
              {data.ageing.overdue.length === 0 ? (
                <p className="text-sm text-muted">Nothing is overdue.</p>
              ) : (
                <table className="w-full text-left text-sm">
                  <thead className="text-muted">
                    <tr className="border-b border-border">
                      <th scope="col" className="py-2 pr-2 font-medium">Overdue invoice</th>
                      <th scope="col" className="hidden py-2 pr-2 font-medium sm:table-cell">Outlet</th>
                      <th scope="col" className="py-2 pr-2 text-right font-medium">Amount</th>
                      <th scope="col" className="py-2 pr-1 text-right font-medium">Days</th>
                      <th scope="col" className="py-2">
                        <span className="sr-only">Remind</span>
                      </th>
                    </tr>
                  </thead>
                  <tbody>
                    {data.ageing.overdue.map((invoice) => (
                      <tr key={invoice.id} className="border-b border-border align-top last:border-0">
                        <td className="py-2 pr-2 sm:max-w-[7.5rem]">
                          <Link href={`/invoices?invoice=${encodeURIComponent(invoice.id)}`} className="font-medium text-primary hover:underline">
                            {/* A long number may break after a slash or hyphen ("ECCS/26-" over "27/00014"), never inside a part. */}
                            {invoice.number.split(/(?<=[/-])/).map((part, index) => (
                              <span key={index}>
                                {index > 0 && <wbr />}
                                {part}
                              </span>
                            ))}
                          </Link>
                          {/* On a phone the outlet goes under the number rather than in a column of its own. */}
                          <span className="block text-muted sm:hidden">{invoice.outletName ?? invoice.organizationName}</span>
                        </td>
                        <td className="hidden min-w-[6rem] py-2 pr-2 sm:table-cell">{invoice.outletName ?? invoice.organizationName}</td>
                        <td className="py-2 pr-2 text-right whitespace-nowrap tabular-nums">{money(invoice.duePaise)}</td>
                        <td className="py-2 pr-1 text-right tabular-nums">{invoice.overdueDays}</td>
                        <td className="py-1 text-right">
                          <Button variant="link" className="text-sm" loading={reminding === invoice.id} disabled={reminding !== null} onClick={() => void remind(invoice.id)}>
                            Remind<span className="sr-only"> about {invoice.number} on WhatsApp</span>
                          </Button>
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              )}
            </Panel>

            <Panel title="Payouts due" description="Bills entered as not yet paid, soonest first.">
              {data.payouts.length === 0 ? (
                <p className="text-sm text-muted">No bills waiting to be paid.</p>
              ) : (
                <ul className="flex flex-col divide-y divide-border text-sm">
                  {data.payouts.map((group) => (
                    <li key={group.key} className="grid grid-cols-[minmax(0,1fr)_auto] items-center gap-x-3 gap-y-0.5 py-2 sm:grid-cols-[minmax(0,1fr)_auto_auto]">
                      <span className="min-w-0">
                        {group.vendor}
                        <span className="text-muted">
                          {group.visitCount > 0 ? ` · ${count(group.visitCount, "visit")}` : group.count > 1 ? ` · ${group.count}` : ""}
                          {group.category === "SALARIES" ? " · salaries" : ""}
                        </span>
                      </span>
                      <span className="tabular-nums">
                        {money(group.totalPaise)}
                        {group.dueDate && <span className="text-muted"> · {dayMonth(group.dueDate)}</span>}
                      </span>
                      <Button variant="link" className="-ml-2 justify-self-start text-sm sm:ml-0 sm:justify-self-end" onClick={() => setPayout(group)}>
                        Mark paid<span className="sr-only">: {group.vendor}</span>
                      </Button>
                    </li>
                  ))}
                </ul>
              )}
            </Panel>
          </div>
        </div>
      </div>

      <ExpenseSheet open={sheet === "expense"} expense={editing} onClose={() => setSheet(null)} onSaved={saved} />
      <BudgetSheet
        open={sheet === "budget"}
        onClose={() => setSheet(null)}
        budgets={data.budgets}
        chosenId={data.budgetId}
        settings={data.settings}
        booksStart={data.booksStart}
        onSaved={saved}
      />
      <FoundersSheet open={sheet === "founders"} onClose={() => setSheet(null)} entries={data.founders.entries} onSaved={saved} />
      <OpeningSheet open={sheet === "opening"} onClose={() => setSheet(null)} opening={data.opening} onSaved={saved} />
      <ExportSheet open={sheet === "export"} onClose={() => setSheet(null)} from={from} to={to} onSaved={notify} />
      <MarkPaidSheet group={payout} onClose={() => setPayout(null)} onSaved={saved} />
    </div>
  );
}

/** One of the six cards: what it is, the figure, and the figure in context underneath. */
function Figure({ label, value, children }: { label: string; value: string; children: ReactNode }) {
  return (
    <div className="flex min-w-0 flex-col gap-1 rounded-xl border border-border bg-surface p-3 sm:p-4">
      <span className="text-sm text-muted">{label}</span>
      {/* One line always: a figure broken after its minus sign misreads. */}
      <span className="text-xl font-bold tracking-tight whitespace-nowrap tabular-nums sm:text-2xl xl:text-[1.375rem]">{value}</span>
      <span className="text-xs text-muted">{children}</span>
    </div>
  );
}

function FoundersPanel({ data, onRecord }: { data: FinanceOverviewDto; onRecord: () => void }) {
  const founders = data.founders;
  const month = monthName(founders.thisMonth);
  const parts = [
    { label: `Spent before ${month}`, paise: founders.spentBeforePaise, color: COLOR.dark },
    { label: `${month} so far`, paise: founders.spentThisMonthPaise, color: COLOR.in },
    { label: "Left", paise: Math.max(0, founders.leftPaise), color: COLOR.light },
  ];
  const total = (pick: (row: (typeof founders.people)[number]) => number) => founders.people.reduce((sum, row) => sum + pick(row), 0);
  const last = founders.lastFullMonth;
  const runway = founders.runway;

  return (
    <Panel
      title="Founders' money"
      description={`What the founders put in, what it has paid for, and what is left. ${founders.takenOutPaise > 0 ? `${money(founders.takenOutPaise)} has been taken out.` : "Nothing has been taken out."}`}
      action={
        <Button variant="link" className="text-sm" onClick={onRecord}>
          Record money in or out
        </Button>
      }
    >
      <StackBar parts={parts} />
      <Legend items={parts.map((part) => ({ label: `${part.label} ${money(part.paise)}`, color: part.color }))} />
      <dl className="grid grid-cols-1 gap-3 min-[420px]:grid-cols-3">
        <div>
          <dt className="text-sm text-muted">Put in</dt>
          <dd className="text-xl font-bold tabular-nums">{money(founders.putInPaise)}</dd>
          {founders.openingPaise > 0 && <dd className="text-xs text-muted">and {money(founders.openingPaise)} in the opening balance</dd>}
        </div>
        <div>
          <dt className="text-sm text-muted">Collected from customers</dt>
          <dd className="text-xl font-bold tabular-nums">{money(founders.collectedPaise)}</dd>
        </div>
        <div>
          <dt className="text-sm text-muted">{founders.unpaidPaise > 0 ? "Left, after bills not yet paid" : "Left"}</dt>
          <dd className={`text-xl font-bold tabular-nums ${founders.leftPaise < 0 ? "text-danger" : ""}`}>{money(founders.leftPaise)}</dd>
        </div>
      </dl>
      {founders.people.length > 0 && (
        <div className="overflow-x-auto">
          <table className="w-full text-left text-sm">
            <thead className="text-muted">
              <tr className="border-b border-border">
                <th scope="col" className="py-2 pr-3 font-medium">Founder</th>
                <th scope="col" className="hidden py-2 pr-3 font-medium sm:table-cell">Date</th>
                <th scope="col" className="py-2 pr-3 text-right font-medium">Put in</th>
                <th scope="col" className="py-2 pr-3 text-right font-medium">Share</th>
                <th scope="col" className="py-2 text-right font-medium">Taken out</th>
              </tr>
            </thead>
            <tbody>
              {founders.people.map((row) => (
                <tr key={row.founder} className="border-b border-border">
                  <td className="py-2 pr-3">{row.founder}</td>
                  <td className="hidden py-2 pr-3 whitespace-nowrap sm:table-cell">{longDay(row.firstDate)}</td>
                  <td className="py-2 pr-3 text-right tabular-nums">{money(row.putInPaise)}</td>
                  <td className="py-2 pr-3 text-right tabular-nums">{row.sharePercent}%</td>
                  <td className="py-2 text-right tabular-nums">{money(row.takenOutPaise)}</td>
                </tr>
              ))}
              <tr className="font-bold">
                <td className="py-2 pr-3">Total</td>
                <td className="hidden sm:table-cell" />
                <td className="py-2 pr-3 text-right tabular-nums">{money(total((row) => row.putInPaise))}</td>
                <td className="py-2 pr-3 text-right tabular-nums">100%</td>
                <td className="py-2 text-right tabular-nums">{money(total((row) => row.takenOutPaise))}</td>
              </tr>
            </tbody>
          </table>
        </div>
      )}
      <p className="text-sm text-muted">
        {runway.kind === "MONTHS" && last ? (
          <>
            At {monthName(last.month)}&apos;s net outflow of {money(last.netOutflowPaise)} a month, what is left lasts <strong className="text-foreground">{runway.words}</strong>; each
            new plan shortens the gap.
          </>
        ) : runway.kind === "NOT_BURNING" && last ? (
          <>In {monthName(last.month)} collections covered spending, so what is left is not running down.</>
        ) : runway.kind === "NOTHING_LEFT" ? (
          <>Nothing is left after the bills entered.</>
        ) : (
          <>How long the money lasts is worked out from the last full month of the books; there is not one yet.</>
        )}{" "}
        Founders draw no salary. The CA may record part of this as a loan to ECCS rather than capital.
      </p>
    </Panel>
  );
}

function CashPanel({ data, onOpening }: { data: FinanceOverviewDto; onOpening: () => void }) {
  const flow = data.cashFlow;
  const due = flow.dueOut;
  const dueWords = [due.salariesPaise > 0 && `salaries ${money(due.salariesPaise)}`, due.payoutsPaise > 0 && `payouts ${money(due.payoutsPaise)}`].filter(Boolean).join(" and ");
  return (
    <Panel
      title={`Daily cash flow, last ${flow.days.length} days`}
      description="Cash in is collections received; cash out is what was paid that day. Salaries are paid at month end, so they are not in these bars."
    >
      <Legend items={[{ label: "Cash in", color: COLOR.in }, { label: "Cash out", color: COLOR.out }]} />
      <GroupedBars
        caption="Daily cash flow"
        height={150}
        barWidth="w-2"
        series={[{ label: "Cash in", color: COLOR.in }, { label: "Cash out", color: COLOR.out }]}
        groups={flow.days.map((day) => ({
          key: day.date,
          title: `${dayMonth(day.date)}: in ${money(day.inPaise)}, out ${money(day.outPaise)}`,
          values: [day.inPaise, day.outPaise],
          label: <span className="tabular-nums">{Number(day.date.slice(8))}</span>,
        }))}
      />
      <p className="text-sm text-muted">
        {flow.days.length} days: in <strong className="text-foreground">{money(flow.inPaise)}</strong> · out <strong className="text-foreground">{money(flow.outPaise)}</strong> · net{" "}
        <strong className="whitespace-nowrap text-foreground">{signed(flow.inPaise - flow.outPaise)}</strong>
      </p>
      <div className="flex flex-col gap-2 border-t border-border pt-4">
        <h3 className="font-bold">Cash balance, day by day</h3>
        <p className="text-sm text-muted">
          Bank plus cash box at close of day.
          {dueWords && ` Still to go out: ${dueWords}${due.firstDueDate ? `, the first due ${dayMonth(due.firstDueDate)}` : ""}.`}
        </p>
        <BalanceLine caption="Cash balance at close of each day" points={flow.days.map((day) => ({ date: day.date, paise: day.balancePaise, label: dayMonth(day.date) }))} />
        <p className="text-sm text-muted">
          {data.opening ? `Counted from ${money(data.opening.bankPaise + data.opening.cashPaise)} in the bank and cash box on ${longDay(data.opening.asOf)}.` : "No opening balance yet, so it is counted from nothing."}{" "}
          <Button variant="link" className="text-sm" onClick={onOpening}>
            {data.opening ? "Change" : "Set the opening balance"}
          </Button>
        </p>
      </div>
    </Panel>
  );
}

function DayCash({ cash }: { cash: { data: CashDayDetailDto | null; error: string | null } | null }) {
  if (!cash) return <Loading />;
  if (!cash.data) return <ErrorMessage message={cash.error} />;
  const day = cash.data;
  const row = (key: string, label: ReactNode, value: string, look: "strong" | "plain" | "inner" = "plain") => (
    <li key={key} className={`flex justify-between gap-4 py-2 ${look === "inner" ? "pl-4 text-muted" : ""} ${look === "strong" ? "font-bold" : ""}`}>
      <span className="min-w-0">{label}</span>
      <span className="text-right whitespace-nowrap tabular-nums">{value}</span>
    </li>
  );
  return (
    <ul className="flex flex-col divide-y divide-border text-sm">
      {row("opening", "Opening balance", day.openingPaise === null ? "Before the books" : money(day.openingPaise), "strong")}
      {row("in", "Cash in: collections", signed(day.inPaise))}
      {day.in.map((line, index) => row(`in-${index}`, line.label, money(line.paise), "inner"))}
      {row("out", "Cash out: operating expenses", day.outPaise > 0 ? `−${money(day.outPaise)}` : money(0))}
      {day.out.map((line, index) => row(`out-${index}`, line.label, money(line.paise), "inner"))}
      {row("closing", "Closing balance", day.closingPaise === null ? "Before the books" : money(day.closingPaise), "strong")}
    </ul>
  );
}

function AgeingBar({ ageing }: { ageing: FinanceOverviewDto["ageing"] }) {
  const colors = ["#8DB4EC", COLOR.in, COLOR.dark, COLOR.over];
  const parts = ageing.buckets.map((bucket, index) => ({ label: bucket.label, paise: bucket.paise, color: colors[index]! }));
  return (
    <>
      <StackBar parts={parts} />
      <Legend items={parts.map((part) => ({ label: `${part.label} ${money(part.paise)}`, color: part.color }))} />
    </>
  );
}

/** The expense book's rows. A row opens its entry to change it; the AI line is worked out by the server and opens nothing. */
export function ExpenseTable({
  entries,
  onOpen,
  showType = false,
  compact = false,
}: {
  entries: readonly ExpenseDto[];
  onOpen: (expense: ExpenseDto) => void;
  /** The kind of day-to-day spend under the category (the full list). */
  showType?: boolean;
  /** Who was paid without what it was for, so the latest entries stay short (the main page). */
  compact?: boolean;
}) {
  if (entries.length === 0) return <p className="text-sm text-muted">Nothing entered yet.</p>;
  const category = (entry: ExpenseDto) => (entry.kind === "WAGE_ADVANCE" ? "Wage advance" : entry.category ? FINANCE_LINE_SHORT[entry.category] : "");
  const linked = (entry: ExpenseDto) =>
    entry.automatic ? (
      "From AI requests"
    ) : entry.team ? (
      "From Team"
    ) : entry.visit ? (
      <Link href={`/visits?state=closed&visit=${encodeURIComponent(entry.visit.id)}`} className="text-primary hover:underline">
        {entry.visit.reference ? `${entry.visit.reference} · ` : "Visit · "}
        {entry.visit.outletName}
      </Link>
    ) : (
      "—"
    );
  const status = (entry: ExpenseDto) =>
    entry.automatic ? null : !entry.paidOn ? (
      <span className="font-semibold text-danger">{entry.dueDate ? `Due ${dayMonth(entry.dueDate)}` : "Not paid"}</span>
    ) : entry.kind === "WAGE_ADVANCE" ? (
      <span className="text-muted">{entry.recoveredOn ? `Recovered ${dayMonth(entry.recoveredOn)}` : "To recover"}</span>
    ) : null;
  const receipt = (entry: ExpenseDto) =>
    entry.receipt ? (
      <a href={api.fileUrl(entry.receipt.path)} target="_blank" rel="noreferrer" className="text-primary hover:underline">
        Filed
      </a>
    ) : (
      "—"
    );
  const vendor = (entry: ExpenseDto) =>
    entry.automatic ? (
      <span>
        {entry.vendor}, {entry.description?.toLowerCase().startsWith("month to date") ? "month to date" : entry.description}
      </span>
    ) : entry.team ? (
      // A salary made from the Team page opens that person's page: it is changed there, and only paid here.
      <Link href={`/team/${encodeURIComponent(entry.team.userId)}`} className="font-medium hover:underline">
        {entry.vendor}
        {!compact && entry.description && <span className="block font-normal text-muted">{entry.description}</span>}
      </Link>
    ) : (
      <button type="button" onClick={() => onOpen(entry)} className="cursor-pointer text-left font-medium hover:underline">
        {entry.vendor}
        {!compact && entry.description && <span className="block font-normal text-muted">{entry.description}</span>}
      </button>
    );

  return (
    <>
      {/* A narrow screen gets one card per entry. */}
      <ul className="flex flex-col divide-y divide-border text-sm sm:hidden">
        {entries.map((entry) => (
          <li key={entry.id} className="flex flex-col gap-1 py-2.5">
            <div className="flex justify-between gap-3">
              <span className="min-w-0">{vendor(entry)}</span>
              <span className="font-semibold whitespace-nowrap tabular-nums">{money(entry.amountPaise)}</span>
            </div>
            <div className="flex flex-wrap gap-x-3 text-muted">
              <span>{dayMonth(entry.date)}</span>
              <span>{category(entry)}</span>
              <span>{linked(entry)}</span>
              {status(entry)}
            </div>
          </li>
        ))}
      </ul>
      <div className="hidden overflow-x-auto sm:block">
        <table className="w-full text-left text-sm">
          <thead className="text-muted">
            <tr className="border-b border-border">
              <th scope="col" className="py-2 pr-3 font-medium">Date</th>
              <th scope="col" className="py-2 pr-3 font-medium">Category</th>
              <th scope="col" className="py-2 pr-3 font-medium">Vendor</th>
              <th scope="col" className="py-2 pr-3 font-medium">Linked to</th>
              <th scope="col" className="py-2 pr-3 text-right font-medium">Amount</th>
              <th scope="col" className="py-2 pr-3 text-right font-medium">GST</th>
              <th scope="col" className="py-2 font-medium">Receipt</th>
            </tr>
          </thead>
          <tbody>
            {entries.map((entry) => (
              <tr key={entry.id} className="border-b border-border align-top last:border-0">
                <td className="py-2.5 pr-3 whitespace-nowrap">{dayMonth(entry.date)}</td>
                <td className="py-2.5 pr-3">
                  {category(entry)}
                  {showType && entry.type && <span className="block text-muted">{EXPENSE_TYPE_LABELS[entry.type]}</span>}
                </td>
                <td className="py-2.5 pr-3">
                  {vendor(entry)}
                  {status(entry) && <span className="block">{status(entry)}</span>}
                </td>
                <td className="py-2.5 pr-3">{linked(entry)}</td>
                <td className="py-2.5 pr-3 text-right whitespace-nowrap tabular-nums">{money(entry.amountPaise)}</td>
                <td className="py-2.5 pr-3 text-right whitespace-nowrap tabular-nums">{entry.gstPaise > 0 ? money(entry.gstPaise) : "—"}</td>
                <td className="py-2.5">{receipt(entry)}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </>
  );
}
