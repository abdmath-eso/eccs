"use client";

import {
  EXPENSE_TYPE_LABELS,
  expenseSchema,
  FINANCE_LINE_LABELS,
  FINANCE_LINES,
  PAID_VIA,
  PAID_VIA_LABELS,
  typesForLine,
  type ExpenseDto,
  type ExpenseInput,
  type ExpenseKind,
  type ExpenseType,
  type FinanceLine,
  type FinanceVisitOptionDto,
  type PaidVia,
} from "@eccs/shared";
import { useEffect, useState, type ChangeEvent, type FormEvent } from "react";

import { useConfirm } from "@/components/confirm-dialog";
import { Button, ErrorMessage, Field, SelectField, TextAreaField } from "@/components/ui";
import { api } from "@/lib/api";
import { checkAgainst, focusFirstError, hasErrors, type FieldErrors } from "@/lib/forms";
import { describe, longDay, today } from "@/lib/format";

import { dayMonth, paiseField, Segmented, Sheet, toPaise } from "./finance-parts";

// Adding or changing one entry of the expense book (15 Oct 2026).
//
// PATTERN FOLLOWED: Zoho Books' "Record expense" form (date, the account it is booked to,
// amount with its tax, what it was paid through, the vendor, a receipt photo or PDF
// attached to the record, and an optional customer or project it is billable to) and
// the payables "bill" of the same books: a bill not yet paid has a due date and shows
// as a payout to make. Fields are in the order a receipt is read: when, what kind,
// who, how much, how paid.

type Paid = "paid" | "owed";

interface Receipt {
  id: string;
  path: string;
  pdf: boolean;
  name: string;
}

const visitText = (visit: { date: string; outletName: string; reference: string | null; serviceName?: string }) =>
  [visit.reference, visit.outletName, visit.serviceName, dayMonth(visit.date)].filter(Boolean).join(" · ");

export function ExpenseSheet({
  open,
  expense,
  onClose,
  onSaved,
}: {
  open: boolean;
  /** The entry to change; null to add a new one. */
  expense: ExpenseDto | null;
  onClose: () => void;
  /** After a save or a removal: the page fetches its figures again. */
  onSaved: (message: string) => void;
}) {
  return (
    <Sheet open={open} title={expense ? (expense.kind === "WAGE_ADVANCE" ? "Wage advance" : "Expense") : "Add expense"} onClose={onClose}>
      {/* A fresh form each time the sheet opens on another entry. */}
      {open && <ExpenseForm key={expense?.id ?? "new"} expense={expense} onClose={onClose} onSaved={onSaved} />}
    </Sheet>
  );
}

function ExpenseForm({ expense, onClose, onSaved }: { expense: ExpenseDto | null; onClose: () => void; onSaved: (message: string) => void }) {
  const confirm = useConfirm();
  // Chosen when the form opens and sent with it, so pressing Save twice adds one entry.
  const [newId] = useState(() => crypto.randomUUID());
  const [kind, setKind] = useState<ExpenseKind>(expense?.kind ?? "EXPENSE");
  const [category, setCategory] = useState<FinanceLine | "">(expense?.category ?? "");
  const [type, setType] = useState<string>(expense?.type ?? "");
  const [paid, setPaid] = useState<Paid>(expense && !expense.paidOn ? "owed" : "paid");
  const [receipt, setReceipt] = useState<Receipt | null>(expense?.receipt ? { ...expense.receipt, name: expense.receipt.pdf ? "Receipt (PDF)" : "Receipt photo" } : null);
  const [visits, setVisits] = useState<FinanceVisitOptionDto[] | null>(null);
  const [uploading, setUploading] = useState(false);
  const [busy, setBusy] = useState<"save" | "remove" | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [errors, setErrors] = useState<FieldErrors>({});

  const advance = kind === "WAGE_ADVANCE";
  const types = category ? typesForLine(category) : [];

  useEffect(() => {
    let cancelled = false;
    api.finance
      .visits()
      .then((list) => !cancelled && setVisits(list))
      .catch(() => !cancelled && setVisits([]));
    return () => {
      cancelled = true;
    };
  }, []);

  // The visit already linked stays a choice even when it is older than the list goes back.
  const visitChoices =
    expense?.visit && visits && !visits.some((visit) => visit.id === expense.visit!.id)
      ? [{ ...expense.visit, serviceName: "" }, ...visits]
      : (visits ?? []);

  async function attach(event: ChangeEvent<HTMLInputElement>) {
    const file = event.target.files?.[0];
    event.target.value = "";
    if (!file) return;
    setUploading(true);
    setError(null);
    try {
      const filed = await api.finance.uploadReceipt(file, file.name);
      setReceipt({ ...filed, name: file.name });
    } catch (e) {
      setError(describe(e));
    } finally {
      setUploading(false);
    }
  }

  async function save(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const form = event.currentTarget;
    const values = new FormData(form);
    const text = (name: string) => String(values.get(name) ?? "").trim();
    const amountPaise = toPaise(text("amount"));
    const gstPaise = advance ? 0 : (toPaise(text("gst")) ?? 0);
    const isPaid = advance || paid === "paid";
    const input: ExpenseInput = {
      ...(!expense && { id: newId }),
      kind,
      date: text("date"),
      category: advance ? null : category || null,
      type: advance ? null : ((type || null) as ExpenseType | null),
      vendor: text("vendor"),
      description: text("description") || null,
      amountPaise: amountPaise ?? 0,
      gstPaise,
      paidVia: isPaid ? (text("paidVia") as PaidVia) : null,
      paidOn: isPaid ? text("paidOn") : null,
      dueDate: isPaid ? null : text("dueDate") || null,
      recoveredOn: advance ? text("recoveredOn") || null : null,
      receiptId: receipt?.id ?? null,
      visitId: advance ? null : text("visitId") || null,
    };

    // The same rules the server checks, with the boxes named for what is typed in them.
    const found = checkAgainst(expenseSchema, input);
    if (amountPaise === null || amountPaise <= 0) found.amountPaise = "Enter the amount in rupees, for example 2360 or 2360.50";
    if (!advance && text("gst") && toPaise(text("gst")) === null) found.gstPaise = "Enter the GST in rupees, or leave it empty";
    const now = today();
    if (input.date > now) found.date = "The date cannot be in the future";
    if (input.paidOn && input.paidOn > now) found.paidOn = "The day it was paid cannot be in the future";
    if (input.recoveredOn && input.recoveredOn > now) found.recoveredOn = "The day it was recovered cannot be in the future";
    const shown: FieldErrors = { ...found };
    if (found.amountPaise) shown.amount = found.amountPaise;
    if (found.gstPaise) shown.gst = found.gstPaise;
    setErrors(shown);
    if (hasErrors(shown)) {
      focusFirstError(form, shown);
      return;
    }

    setBusy("save");
    setError(null);
    try {
      if (expense) await api.finance.updateExpense(expense.id, input);
      else await api.finance.addExpense(input);
      onSaved(expense ? "Entry saved" : advance ? "Wage advance added" : "Expense added");
      onClose();
    } catch (e) {
      setError(describe(e));
    } finally {
      setBusy(null);
    }
  }

  async function remove() {
    if (!expense) return;
    const sure = await confirm({
      title: "Remove this entry?",
      body: "It comes out of the expense book, the budget and the cash figures, and its receipt is deleted. This cannot be undone.",
      confirmLabel: "Remove the entry",
      cancelLabel: "Keep it",
    });
    if (!sure) return;
    setBusy("remove");
    setError(null);
    try {
      await api.finance.removeExpense(expense.id);
      onSaved("Entry removed");
      onClose();
    } catch (e) {
      setError(describe(e));
    } finally {
      setBusy(null);
    }
  }

  return (
    <form onSubmit={(event) => void save(event)} noValidate className="flex flex-col gap-4">
      {!expense && (
        <Segmented
          label="Kind of entry"
          showLabel={false}
          value={kind}
          onChange={(next) => {
            setKind(next);
            setErrors({});
          }}
          options={[
            { value: "EXPENSE", label: "Expense" },
            { value: "WAGE_ADVANCE", label: "Wage advance" },
          ]}
        />
      )}
      {advance && <p className="text-sm text-muted">Cash given to a staff member ahead of pay. It counts as cash out, not as an expense, and comes back when it is taken out of their pay.</p>}
      {expense?.isSample && <p className="text-sm text-muted">A sample entry. Change or remove it freely; all sample rows can be removed in one go before real use.</p>}

      <div className="grid gap-4 sm:grid-cols-2">
        <Field label="Date" name="date" type="date" required defaultValue={expense?.date ?? today()} max={today()} error={errors.date} />
        {!advance && (
          <SelectField
            label="Budget line"
            name="category"
            value={category}
            onChange={(event) => {
              setCategory(event.target.value as FinanceLine | "");
              setType("");
            }}
            error={errors.category}
          >
            <option value="">Choose…</option>
            {/* Salaries come from the Team page (16 Oct 2026); only a salary typed in before then can still be corrected here. */}
            {FINANCE_LINES.filter((line) => line !== "SALARIES" || expense?.category === "SALARIES").map((line) => (
              <option key={line} value={line}>
                {FINANCE_LINE_LABELS[line]}
              </option>
            ))}
          </SelectField>
        )}
      </div>
      {!advance && types.length > 0 && (
        <SelectField
          label="Day-to-day spend"
          name="type"
          hint="Shown in daily operating expenses by type. Leave it for a monthly bill."
          value={type}
          onChange={(event) => setType(event.target.value)}
          error={errors.type}
        >
          <option value="">Not day-to-day spend</option>
          {types.map((entry) => (
            <option key={entry} value={entry}>
              {EXPENSE_TYPE_LABELS[entry]}
            </option>
          ))}
        </SelectField>
      )}

      <Field
        label={advance ? "Staff member" : "Paid to"}
        name="vendor"
        required
        maxLength={80}
        defaultValue={expense?.vendor}
        hint={advance ? undefined : "The shop, supplier or person, as on the bill"}
        error={errors.vendor}
      />
      <TextAreaField label="What it was for" name="description" rows={2} maxLength={200} defaultValue={expense?.description ?? ""} error={errors.description} />

      <div className="grid gap-4 sm:grid-cols-2">
        <Field
          label="Amount (₹)"
          name="amount"
          required
          inputMode="decimal"
          hint={advance ? undefined : "What was paid, GST included"}
          defaultValue={expense ? paiseField(expense.amountPaise) : ""}
          error={errors.amount}
        />
        {!advance && (
          <Field
            label="GST in it (₹)"
            name="gst"
            inputMode="decimal"
            hint="From the bill, for the CA"
            defaultValue={expense && expense.gstPaise > 0 ? paiseField(expense.gstPaise) : ""}
            error={errors.gst}
          />
        )}
      </div>

      {!advance && (
        <Segmented
          label="Paid?"
          value={paid}
          onChange={setPaid}
          options={[
            { value: "paid", label: "Paid" },
            { value: "owed", label: "Not yet paid" },
          ]}
        />
      )}
      {advance || paid === "paid" ? (
        <div className="grid gap-4 sm:grid-cols-2">
          <SelectField label={advance ? "Given as" : "How it was paid"} name="paidVia" defaultValue={expense?.paidVia ?? (advance ? "cash" : "upi")} error={errors.paidVia}>
            {PAID_VIA.map((via) => (
              <option key={via} value={via}>
                {PAID_VIA_LABELS[via]}
              </option>
            ))}
          </SelectField>
          <Field label={advance ? "Given on" : "Paid on"} name="paidOn" type="date" required defaultValue={expense?.paidOn ?? today()} max={today()} error={errors.paidOn} />
        </div>
      ) : (
        <Field label="Due on" name="dueDate" type="date" required hint="It shows under Payouts due until it is marked paid." defaultValue={expense?.dueDate ?? ""} error={errors.dueDate} />
      )}
      {advance && (
        <Field
          label="Recovered from pay on"
          name="recoveredOn"
          type="date"
          hint="Leave empty until it is taken out of their pay."
          defaultValue={expense?.recoveredOn ?? ""}
          max={today()}
          error={errors.recoveredOn}
        />
      )}

      {!advance && (
        <SelectField label="Linked visit" name="visitId" hint="Puts the cost on that job's margin." defaultValue={expense?.visit?.id ?? ""} error={errors.visitId}>
          <option value="">{visits === null ? "Loading visits…" : "No visit"}</option>
          {visitChoices.map((visit) => (
            <option key={visit.id} value={visit.id}>
              {visitText(visit)}
            </option>
          ))}
        </SelectField>
      )}

      <div className="flex flex-col gap-1 text-sm font-medium">
        <span>
          Receipt <span className="font-normal text-muted">(optional)</span>
        </span>
        {receipt ? (
          <div className="flex flex-wrap items-center gap-2">
            <span className="font-normal">✓ Filed: {receipt.name}</span>
            <a href={api.fileUrl(receipt.path)} target="_blank" rel="noreferrer" className="rounded-md px-2 py-1 font-semibold text-primary hover:underline">
              Open
            </a>
            <Button type="button" variant="link" onClick={() => setReceipt(null)}>
              Remove
            </Button>
          </div>
        ) : (
          <label className="w-fit cursor-pointer rounded-lg border border-border-strong px-3 py-2 font-semibold hover:bg-background">
            {uploading ? "Filing the receipt…" : "Add a photo or PDF"}
            <input type="file" accept="image/jpeg,image/png,image/webp,application/pdf" className="sr-only" disabled={uploading} onChange={(event) => void attach(event)} />
          </label>
        )}
      </div>

      <ErrorMessage message={error} />
      <div className="flex flex-wrap items-center gap-2 border-t border-border pt-4">
        <Button type="submit" loading={busy === "save"} disabled={uploading || busy !== null}>
          {expense ? "Save" : advance ? "Add the advance" : "Add the expense"}
        </Button>
        <Button type="button" variant="secondary" disabled={busy !== null} onClick={onClose}>
          Cancel
        </Button>
        {expense && (
          <Button type="button" variant="secondary" className="ml-auto text-danger" loading={busy === "remove"} disabled={busy !== null} onClick={() => void remove()}>
            Remove
          </Button>
        )}
      </div>
      {expense?.enteredByName && <p className="text-xs text-muted">Entered by {expense.enteredByName}{expense.date ? `, dated ${longDay(expense.date)}` : ""}.</p>}
    </form>
  );
}
