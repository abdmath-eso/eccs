"use client";

import {
  addMonths,
  budgetSchema,
  budgetTotal,
  emptyBudgetLines,
  EXPORT_REGISTER_LABELS,
  EXPORT_REGISTERS,
  FINANCE_LINE_LABELS,
  FINANCE_LINES,
  financeSettingsSchema,
  founderMoneySchema,
  monthLabel,
  monthOf,
  openingBalanceSchema,
  PAID_VIA,
  PAID_VIA_LABELS,
  type BudgetDto,
  type BudgetInput,
  type BudgetLines,
  type CashOpeningDto,
  type ExportRegister,
  type FinanceSettingsDto,
  type FounderMoneyDirection,
  type FounderMoneyDto,
  type PaidVia,
  type PayoutGroupDto,
} from "@eccs/shared";
import { useState, type FormEvent } from "react";

import { useConfirm } from "@/components/confirm-dialog";
import { Button, ErrorMessage, Field, SelectField, Switch } from "@/components/ui";
import { api } from "@/lib/api";
import { checkAgainst, focusFirstError, hasErrors, type FieldErrors } from "@/lib/forms";
import { describe, longDay, today } from "@/lib/format";

import { count, money, paiseField, saveFile, Segmented, Sheet, toPaise } from "./finance-parts";

// The Finance page's smaller forms, each in a panel from the right: the budgets (and the
// page's two settings), the founders' money, the opening balance, the CA's export, and
// marking a payout paid.

type Done = (message: string) => void;

// ───────────────────────── Budgets ─────────────────────────

/** How many months of planned net cash the form offers, from the month the books started. */
const PLAN_MONTHS = 9;

export function BudgetSheet({
  open,
  onClose,
  budgets,
  chosenId,
  settings,
  booksStart,
  onSaved,
}: {
  open: boolean;
  onClose: () => void;
  budgets: readonly BudgetDto[];
  chosenId: string | null;
  settings: FinanceSettingsDto;
  booksStart: string | null;
  onSaved: Done;
}) {
  return (
    <Sheet open={open} title="Budgets" onClose={onClose} wide>
      {open && <BudgetEditor budgets={budgets} chosenId={chosenId} settings={settings} booksStart={booksStart} onSaved={onSaved} />}
    </Sheet>
  );
}

function BudgetEditor({
  budgets,
  chosenId,
  settings,
  booksStart,
  onSaved,
}: {
  budgets: readonly BudgetDto[];
  chosenId: string | null;
  settings: FinanceSettingsDto;
  booksStart: string | null;
  onSaved: Done;
}) {
  const [editing, setEditing] = useState<string>(chosenId ?? budgets[0]?.id ?? "new");
  const budget = budgets.find((entry) => entry.id === editing) ?? null;
  return (
    <div className="flex flex-col gap-6">
      <Segmented
        label="Budget"
        value={editing}
        onChange={setEditing}
        options={[...budgets.map((entry) => ({ value: entry.id, label: entry.name })), { value: "new", label: "+ New budget" }]}
      />
      <BudgetForm key={editing} budget={budget} booksStart={booksStart} onSaved={onSaved} onRemoved={() => setEditing(budgets.find((entry) => entry.id !== editing)?.id ?? "new")} />
      <SettingsForm settings={settings} onSaved={onSaved} />
    </div>
  );
}

function BudgetForm({ budget, booksStart, onSaved, onRemoved }: { budget: BudgetDto | null; booksStart: string | null; onSaved: Done; onRemoved: () => void }) {
  const confirm = useConfirm();
  const [lines, setLines] = useState<Record<string, string>>(() =>
    Object.fromEntries(FINANCE_LINES.map((line) => [line, budget ? paiseField(budget.lines[line]) : ""])),
  );
  const first = monthOf(booksStart ?? today());
  const months = [...new Set([...Array.from({ length: PLAN_MONTHS }, (_, index) => addMonths(first, index)), ...(budget?.plannedNet.map((entry) => entry.month) ?? [])])].sort();
  const [planned, setPlanned] = useState<Record<string, string>>(() =>
    Object.fromEntries(months.map((month) => {
      const entry = budget?.plannedNet.find((item) => item.month === month);
      return [month, entry ? paiseField(entry.paise) : ""];
    })),
  );
  const [isDefault, setIsDefault] = useState(budget?.isDefault ?? false);
  const [busy, setBusy] = useState<"save" | "remove" | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [errors, setErrors] = useState<FieldErrors>({});

  const amounts = Object.fromEntries(FINANCE_LINES.map((line) => [line, toPaise(lines[line] ?? "") ?? 0])) as BudgetLines;

  async function save(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const form = event.currentTarget;
    const found: FieldErrors = {};
    for (const line of FINANCE_LINES) {
      const typed = lines[line] ?? "";
      if (typed.trim() && (toPaise(typed) === null || toPaise(typed)! < 0)) found[`line-${line}`] = "Enter an amount in rupees";
    }
    const plannedNet = months.flatMap((month) => {
      const typed = planned[month] ?? "";
      if (!typed.trim()) return [];
      const paise = toPaise(typed);
      if (paise === null) {
        found[`plan-${month}`] = "Enter an amount in rupees, with a minus sign for money going out";
        return [];
      }
      return [{ month, paise }];
    });
    const input: BudgetInput = { name: String(new FormData(form).get("name") ?? "").trim(), lines: { ...emptyBudgetLines(), ...amounts }, plannedNet, isDefault };
    Object.assign(found, checkAgainst(budgetSchema, input));
    setErrors(found);
    if (hasErrors(found)) {
      focusFirstError(form, found);
      return;
    }
    setBusy("save");
    setError(null);
    try {
      if (budget) await api.finance.updateBudget(budget.id, input);
      else await api.finance.addBudget(input);
      onSaved(budget ? `${input.name} budget saved` : `${input.name} budget added`);
    } catch (e) {
      setError(describe(e));
    } finally {
      setBusy(null);
    }
  }

  async function remove() {
    if (!budget) return;
    const sure = await confirm({
      title: `Remove the ${budget.name} budget?`,
      body: "The page stops comparing with it. Expenses are not touched. This cannot be undone.",
      confirmLabel: "Remove the budget",
      cancelLabel: "Keep it",
    });
    if (!sure) return;
    setBusy("remove");
    setError(null);
    try {
      await api.finance.removeBudget(budget.id);
      onRemoved();
      onSaved(`${budget.name} budget removed`);
    } catch (e) {
      setError(describe(e));
    } finally {
      setBusy(null);
    }
  }

  return (
    <form onSubmit={(event) => void save(event)} noValidate className="flex flex-col gap-4">
      <Field label="Name" name="name" required maxLength={40} defaultValue={budget?.name ?? ""} hint="For example Lean or Full" error={errors.name} wrapperClassName="max-w-xs" />
      <fieldset className="flex flex-col gap-2">
        <legend className="mb-1 font-semibold">A month, by budget line (₹)</legend>
        {FINANCE_LINES.map((line) => (
          <label key={line} className="grid grid-cols-[1fr_9rem] items-center gap-3 text-sm">
            <span>
              {FINANCE_LINE_LABELS[line]}
              {errors[`line-${line}`] && <span className="block font-semibold text-danger">! {errors[`line-${line}`]}</span>}
            </span>
            <input
              name={`line-${line}`}
              inputMode="decimal"
              value={lines[line] ?? ""}
              onChange={(event) => setLines((now) => ({ ...now, [line]: event.target.value }))}
              aria-invalid={errors[`line-${line}`] ? true : undefined}
              className="rounded-lg border border-border-strong bg-surface px-3 py-1.5 text-right tabular-nums"
            />
          </label>
        ))}
        <p className="grid grid-cols-[1fr_9rem] gap-3 border-t border-border pt-2 text-sm font-bold">
          <span>Total a month</span>
          <span className="text-right tabular-nums">{money(budgetTotal(amounts))}</span>
        </p>
      </fieldset>
      <fieldset className="flex flex-col gap-2">
        <legend className="font-semibold">Planned net cash, month by month (₹)</legend>
        <p className="text-sm text-muted">What the plan expects collected less spent; a minus sign while spending more than comes in. The Net cash card compares with it.</p>
        <div className="grid gap-x-6 gap-y-2 sm:grid-cols-2">
          {months.map((month) => (
            <label key={month} className="grid grid-cols-[1fr_8rem] items-center gap-3 text-sm">
              <span>
                {monthLabel(month)}
                {errors[`plan-${month}`] && <span className="block font-semibold text-danger">! {errors[`plan-${month}`]}</span>}
              </span>
              <input
                name={`plan-${month}`}
                inputMode="decimal"
                value={planned[month] ?? ""}
                onChange={(event) => setPlanned((now) => ({ ...now, [month]: event.target.value }))}
                aria-invalid={errors[`plan-${month}`] ? true : undefined}
                className="rounded-lg border border-border-strong bg-surface px-3 py-1.5 text-right tabular-nums"
              />
            </label>
          ))}
        </div>
      </fieldset>
      <Switch label="Compare with this budget when the page opens" checked={isDefault} onChange={setIsDefault} />
      <ErrorMessage message={error} />
      <div className="flex flex-wrap gap-2">
        <Button type="submit" loading={busy === "save"} disabled={busy !== null}>
          {budget ? "Save the budget" : "Add the budget"}
        </Button>
        {budget && (
          <Button type="button" variant="secondary" className="ml-auto text-danger" loading={busy === "remove"} disabled={busy !== null} onClick={() => void remove()}>
            Remove this budget
          </Button>
        )}
      </div>
    </form>
  );
}

/** The collection target and the dollar rate the AI's cost is shown at. */
function SettingsForm({ settings, onSaved }: { settings: FinanceSettingsDto; onSaved: Done }) {
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [errors, setErrors] = useState<FieldErrors>({});

  async function save(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const form = event.currentTarget;
    const values = new FormData(form);
    const rate = toPaise(String(values.get("rate") ?? ""));
    const input = { collectedTargetPercent: Number(String(values.get("target") ?? "").trim() || NaN), usdToInrPaise: rate ?? 0 };
    const found = checkAgainst(financeSettingsSchema, input);
    const shown: FieldErrors = { ...(found.collectedTargetPercent && { target: found.collectedTargetPercent }), ...(found.usdToInrPaise && { rate: found.usdToInrPaise }) };
    setErrors(shown);
    if (hasErrors(shown)) {
      focusFirstError(form, shown);
      return;
    }
    setBusy(true);
    setError(null);
    try {
      await api.finance.saveSettings(input);
      onSaved("Settings saved");
    } catch (e) {
      setError(describe(e));
    } finally {
      setBusy(false);
    }
  }

  return (
    <form onSubmit={(event) => void save(event)} noValidate className="flex flex-col gap-3 border-t border-border pt-5">
      <h3 className="font-semibold">Targets and rates</h3>
      <div className="grid gap-4 sm:grid-cols-2">
        <Field label="Collection target (%)" name="target" required inputMode="numeric" defaultValue={String(settings.collectedTargetPercent)} hint="Collected is shown against this share of what was invoiced" error={errors.target} />
        <Field label="Rupees to the US dollar" name="rate" required inputMode="decimal" defaultValue={paiseField(settings.usdToInrPaise)} hint="The AI's cost is kept in dollars" error={errors.rate} />
      </div>
      <ErrorMessage message={error} />
      <Button type="submit" variant="secondary" className="self-start" loading={busy}>
        Save targets and rates
      </Button>
    </form>
  );
}

// ───────────────────────── Founders' money ─────────────────────────

export function FoundersSheet({ open, onClose, entries, onSaved }: { open: boolean; onClose: () => void; entries: readonly FounderMoneyDto[]; onSaved: Done }) {
  return (
    <Sheet open={open} title="Founders' money" onClose={onClose}>
      {open && <FoundersForm entries={entries} onSaved={onSaved} />}
    </Sheet>
  );
}

function FoundersForm({ entries, onSaved }: { entries: readonly FounderMoneyDto[]; onSaved: Done }) {
  const confirm = useConfirm();
  const [formId, setFormId] = useState(() => crypto.randomUUID());
  const [direction, setDirection] = useState<FounderMoneyDirection>("IN");
  const [busy, setBusy] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [errors, setErrors] = useState<FieldErrors>({});
  const founders = [...new Set(entries.map((entry) => entry.founder))];

  async function save(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const form = event.currentTarget;
    const values = new FormData(form);
    const text = (name: string) => String(values.get(name) ?? "").trim();
    const amountPaise = toPaise(text("amount"));
    const input = { id: formId, founder: text("founder"), date: text("date"), amountPaise: amountPaise ?? 0, direction, label: text("label") || null };
    const found = checkAgainst(founderMoneySchema, input);
    if (amountPaise === null || amountPaise <= 0) found.amountPaise = "Enter the amount in rupees";
    if (!found.date && input.date > today()) found.date = "The date cannot be in the future";
    const shown: FieldErrors = { ...found, ...(found.amountPaise && { amount: found.amountPaise }) };
    setErrors(shown);
    if (hasErrors(shown)) {
      focusFirstError(form, shown);
      return;
    }
    setBusy("save");
    setError(null);
    try {
      await api.finance.addFounderMoney(input);
      form.reset();
      setFormId(crypto.randomUUID());
      onSaved(direction === "IN" ? `${money(input.amountPaise)} put in by ${input.founder} recorded` : `${money(input.amountPaise)} taken out by ${input.founder} recorded`);
    } catch (e) {
      setError(describe(e));
    } finally {
      setBusy(null);
    }
  }

  async function remove(entry: FounderMoneyDto) {
    const sure = await confirm({
      title: "Remove this entry?",
      body: `${money(entry.amountPaise)} ${entry.direction === "IN" ? "put in" : "taken out"} by ${entry.founder} on ${longDay(entry.date)} comes out of the founders' money and the cash balance.`,
      confirmLabel: "Remove the entry",
      cancelLabel: "Keep it",
    });
    if (!sure) return;
    setBusy(entry.id);
    setError(null);
    try {
      await api.finance.removeFounderMoney(entry.id);
      onSaved("Entry removed");
    } catch (e) {
      setError(describe(e));
    } finally {
      setBusy(null);
    }
  }

  return (
    <div className="flex flex-col gap-6">
      <form onSubmit={(event) => void save(event)} noValidate className="flex flex-col gap-4">
        <Segmented
          label="Money"
          showLabel={false}
          value={direction}
          onChange={setDirection}
          options={[
            { value: "IN", label: "Put in" },
            { value: "OUT", label: "Taken out" },
          ]}
        />
        <div className="grid gap-4 sm:grid-cols-2">
          <Field label="Founder" name="founder" required maxLength={60} list="finance-founders" error={errors.founder} />
          <datalist id="finance-founders">
            {founders.map((name) => (
              <option key={name} value={name} />
            ))}
          </datalist>
          <Field label="Date" name="date" type="date" required defaultValue={today()} max={today()} error={errors.date} />
          <Field label="Amount (₹)" name="amount" required inputMode="decimal" error={errors.amount} />
          <Field label="Note" name="label" maxLength={80} hint="For example Starting capital" error={errors.label} />
        </div>
        <ErrorMessage message={error} />
        <Button type="submit" className="self-start" loading={busy === "save"} disabled={busy !== null}>
          {direction === "IN" ? "Record money put in" : "Record money taken out"}
        </Button>
      </form>

      <div className="flex flex-col gap-2 border-t border-border pt-5">
        <h3 className="font-semibold">Entries</h3>
        {entries.length === 0 ? (
          <p className="text-sm text-muted">Nothing recorded yet.</p>
        ) : (
          <ul className="flex flex-col divide-y divide-border text-sm">
            {entries.map((entry) => (
              <li key={entry.id} className="flex flex-wrap items-center justify-between gap-2 py-2">
                <span>
                  <span className="font-semibold">{entry.founder}</span> · {entry.direction === "IN" ? "put in" : "took out"} {money(entry.amountPaise)} on {longDay(entry.date)}
                  {entry.label && <span className="block text-muted">{entry.label}</span>}
                </span>
                <Button type="button" variant="link" className="text-danger" disabled={busy !== null} onClick={() => void remove(entry)}>
                  Remove
                </Button>
              </li>
            ))}
          </ul>
        )}
      </div>
    </div>
  );
}

// ───────────────────────── Opening balance ─────────────────────────

export function OpeningSheet({ open, onClose, opening, onSaved }: { open: boolean; onClose: () => void; opening: CashOpeningDto | null; onSaved: Done }) {
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [errors, setErrors] = useState<FieldErrors>({});

  async function save(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const form = event.currentTarget;
    const values = new FormData(form);
    const text = (name: string) => String(values.get(name) ?? "").trim();
    const bank = toPaise(text("bank") || "0");
    const cash = toPaise(text("cash") || "0");
    const input = { asOf: text("asOf"), bankPaise: bank ?? -1, cashPaise: cash ?? -1 };
    const found = checkAgainst(openingBalanceSchema, input);
    if (!found.asOf && input.asOf > today()) found.asOf = "The day cannot be in the future";
    const shown: FieldErrors = { ...(found.asOf && { asOf: found.asOf }), ...(found.bankPaise && { bank: "Enter the bank balance in rupees" }), ...(found.cashPaise && { cash: "Enter the cash in the box in rupees" }) };
    setErrors(shown);
    if (hasErrors(shown)) {
      focusFirstError(form, shown);
      return;
    }
    setBusy(true);
    setError(null);
    try {
      await api.finance.saveOpening(input);
      onSaved("Opening balance saved");
      onClose();
    } catch (e) {
      setError(describe(e));
    } finally {
      setBusy(false);
    }
  }

  return (
    <Sheet open={open} title="Opening balance" onClose={onClose}>
      {open && (
        <form onSubmit={(event) => void save(event)} noValidate className="flex flex-col gap-4">
          <p className="text-sm text-muted">The money in the bank and the cash box at the start of a day. The daily cash balance is counted from it: payments and founders&apos; money in, bills, advances and money taken out.</p>
          <Field label="On the morning of" name="asOf" type="date" required defaultValue={opening?.asOf ?? today()} max={today()} error={errors.asOf} wrapperClassName="max-w-xs" />
          <div className="grid gap-4 sm:grid-cols-2">
            <Field label="In the bank (₹)" name="bank" inputMode="decimal" defaultValue={opening ? paiseField(opening.bankPaise) : ""} error={errors.bank} />
            <Field label="In the cash box (₹)" name="cash" inputMode="decimal" defaultValue={opening ? paiseField(opening.cashPaise) : ""} error={errors.cash} />
          </div>
          <ErrorMessage message={error} />
          <Button type="submit" className="self-start" loading={busy}>
            Save the opening balance
          </Button>
        </form>
      )}
    </Sheet>
  );
}

// ───────────────────────── The CA's export ─────────────────────────

/**
 * The three files a chartered accountant works from, for the period on the page:
 * expenses, sales (invoices with their GST split) and receipts (payments).
 */
export function ExportSheet({ open, onClose, from, to, onSaved }: { open: boolean; onClose: () => void; from: string; to: string; onSaved: Done }) {
  return (
    <Sheet open={open} title="Export for the CA" onClose={onClose}>
      {/* Mounted on opening, so it starts from the period on the page each time. */}
      {open && <ExportForm from={from} to={to} onSaved={onSaved} />}
    </Sheet>
  );
}

function ExportForm({ from, to, onSaved }: { from: string; to: string; onSaved: Done }) {
  const [busy, setBusy] = useState<ExportRegister | "all" | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [period, setPeriod] = useState({ from, to });

  async function download(registers: readonly ExportRegister[], which: ExportRegister | "all") {
    if (period.from > period.to) {
      setError("The end comes before the start");
      return;
    }
    setBusy(which);
    setError(null);
    try {
      for (const register of registers) {
        const file = await api.finance.exportCsv(register, period);
        saveFile(file.blob, file.fileName);
      }
      onSaved(registers.length === 1 ? `${EXPORT_REGISTER_LABELS[registers[0]!]} downloaded` : "The three files downloaded");
    } catch (e) {
      setError(describe(e));
    } finally {
      setBusy(null);
    }
  }

  return (
    <div className="flex flex-col gap-4">
      <p className="text-sm text-muted">Three CSV files that open in Excel or Google Sheets, for the chartered accountant.</p>
      <div className="grid gap-4 sm:grid-cols-2">
        <Field label="From" type="date" plainLabel value={period.from} max={today()} onChange={(event) => setPeriod((now) => ({ ...now, from: event.target.value }))} />
        <Field label="To" type="date" plainLabel value={period.to} onChange={(event) => setPeriod((now) => ({ ...now, to: event.target.value }))} />
      </div>
      <ul className="flex flex-col divide-y divide-border rounded-lg border border-border">
        {EXPORT_REGISTERS.map((register) => (
          <li key={register} className="flex items-center justify-between gap-3 px-3 py-2.5">
            <span className="text-sm font-semibold">{EXPORT_REGISTER_LABELS[register]}</span>
            <Button type="button" variant="secondary" size="sm" loading={busy === register} disabled={busy !== null} onClick={() => void download([register], register)}>
              Download
            </Button>
          </li>
        ))}
      </ul>
      <ErrorMessage message={error} />
      <Button type="button" className="self-start" loading={busy === "all"} disabled={busy !== null} onClick={() => void download(EXPORT_REGISTERS, "all")}>
        Download all three
      </Button>
    </div>
  );
}

// ───────────────────────── Mark a payout paid ─────────────────────────

export function MarkPaidSheet({ group, onClose, onSaved }: { group: PayoutGroupDto | null; onClose: () => void; onSaved: Done }) {
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function save(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!group) return;
    const values = new FormData(event.currentTarget);
    const paidOn = String(values.get("paidOn") ?? "");
    if (!paidOn || paidOn > today()) {
      setError("Enter the day it was paid, today or before");
      return;
    }
    setBusy(true);
    setError(null);
    try {
      const { updated } = await api.finance.markPaid({ ids: group.ids, paidVia: String(values.get("paidVia")) as PaidVia, paidOn });
      onSaved(`${count(updated, "bill")} to ${group.vendor} marked paid`);
      onClose();
    } catch (e) {
      setError(describe(e));
    } finally {
      setBusy(false);
    }
  }

  return (
    <Sheet open={group !== null} title="Mark paid" onClose={onClose}>
      {group && (
        <form onSubmit={(event) => void save(event)} noValidate className="flex flex-col gap-4">
          <p>
            <span className="font-semibold">{group.vendor}</span> · {count(group.count, "bill")} · {money(group.totalPaise)}
          </p>
          <div className="grid gap-4 sm:grid-cols-2">
            <SelectField label="How it was paid" name="paidVia" defaultValue="upi">
              {PAID_VIA.map((via) => (
                <option key={via} value={via}>
                  {PAID_VIA_LABELS[via]}
                </option>
              ))}
            </SelectField>
            <Field label="Paid on" name="paidOn" type="date" required defaultValue={today()} max={today()} />
          </div>
          <ErrorMessage message={error} />
          <Button type="submit" className="self-start" loading={busy}>
            Mark {group.count === 1 ? "it" : "them"} paid
          </Button>
        </form>
      )}
    </Sheet>
  );
}
