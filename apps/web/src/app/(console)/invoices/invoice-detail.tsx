"use client";

import {
  gstStateLabel,
  MANUAL_PAYMENT_METHODS,
  recordPaymentSchema,
  voidInvoiceSchema,
  type InvoiceDto,
  type ManualPaymentMethod,
  type PaymentDto,
} from "@eccs/shared";
import Link from "next/link";
import { useEffect, useState, type FormEvent } from "react";

import { useConfirm } from "@/components/confirm-dialog";
import { useToast } from "@/components/toast";
import { Button, Card, ErrorMessage, Field, Loading, SelectField, TextAreaField } from "@/components/ui";
import { api } from "@/lib/api";
import { checkAgainst, focusFirstError, hasErrors, type FieldErrors } from "@/lib/forms";
import { describe, longDay as day, today, when } from "@/lib/format";

import { methodName, money, StateBadge } from "./invoice-parts";

/** A rate without a needless ".0": 9, 2.5. */
const rate = (percent: number) => `${Number(percent.toFixed(2))}%`;

/** Rupees as typed ("2124" or "2124.50") into whole paise; null when it is not an amount. */
function toPaise(typed: string): number | null {
  const cleaned = typed.replace(/[₹,\s]/g, "");
  return /^\d+(\.\d{1,2})?$/.test(cleaned) ? Math.round(Number(cleaned) * 100) : null;
}

const PAYMENT_STATE: Record<PaymentDto["status"], string> = {
  SUCCEEDED: "✓ Received",
  FAILED: "✕ Failed",
  PENDING: "… Started in the app, not finished",
  REFUNDED: "↩ Refunded",
};

/**
 * One invoice: who it is billed to, its lines with the GST worked out, what
 * has been paid, and what ECCS can do with it: open the PDF, record a payment
 * received outside the app, make it void, and raise a void one again.
 */
export function InvoiceDetail({
  invoiceId,
  backHref,
  onBack,
  onOpen,
  onChanged,
}: {
  invoiceId: string;
  /** The address of the list, so the link also works in a new tab. */
  backHref: string;
  onBack: () => void;
  /** Opens another invoice (the one raised in place of a void one). */
  onOpen: (invoiceId: string) => void;
  /** Called after a payment, a void or a new invoice, so the list and totals are fetched again. */
  onChanged: () => void;
}) {
  const notify = useToast();
  const confirm = useConfirm();

  const [invoice, setInvoice] = useState<InvoiceDto | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [attempt, setAttempt] = useState(0);
  const [panel, setPanel] = useState<"pay" | "void" | null>(null);
  const [busy, setBusy] = useState<"pdf" | "pay" | "void" | "again" | null>(null);
  const [actionError, setActionError] = useState<string | null>(null);
  const [fieldErrors, setFieldErrors] = useState<FieldErrors>({});
  // Chosen when the payment form opens and sent with it, so pressing Save twice records one payment.
  const [paymentId, setPaymentId] = useState("");

  useEffect(() => {
    let cancelled = false;
    api.billing
      .invoice(invoiceId)
      .then((fresh) => {
        if (cancelled) return;
        setInvoice(fresh);
        setError(null);
      })
      .catch((e) => !cancelled && setError(describe(e)));
    return () => {
      cancelled = true;
    };
  }, [invoiceId, attempt]);

  const back = (
    <a
      href={backHref}
      onClick={(event) => {
        event.preventDefault();
        onBack();
      }}
      className="self-start rounded-md px-2 py-1 font-semibold text-primary hover:underline"
    >
      ← All invoices
    </a>
  );

  if (!invoice) {
    return (
      <div className="flex flex-col items-start gap-4">
        {back}
        <ErrorMessage message={error} />
        {error ? (
          <Button variant="secondary" onClick={() => setAttempt((value) => value + 1)}>
            Try again
          </Button>
        ) : (
          <Loading />
        )}
      </div>
    );
  }

  const isVoid = invoice.status === "VOID";
  const owing = invoice.duePaise > 0;
  const received = invoice.payments.some((payment) => payment.status === "SUCCEEDED");

  function open(which: "pay" | "void" | null) {
    setPanel(which);
    setActionError(null);
    setFieldErrors({});
    if (which === "pay") setPaymentId(crypto.randomUUID());
  }

  /** Opens the invoice as a PDF in a new tab. The server makes it, or makes it again after a change, which takes a few seconds. */
  async function openPdf() {
    setBusy("pdf");
    setActionError(null);
    // Opened straight away, while the click still counts, so the browser does not block it as a pop-up.
    const tab = window.open("", "_blank");
    try {
      const { path } = await api.billing.pdf(invoiceId);
      if (tab) tab.location.href = api.fileUrl(path);
      else window.location.assign(api.fileUrl(path));
      setInvoice((current) => (current ? { ...current, pdfReady: true } : current));
    } catch (e) {
      tab?.close();
      setActionError(describe(e));
    } finally {
      setBusy(null);
    }
  }

  async function recordPayment(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!invoice) return;
    const form = event.currentTarget;
    const values = new FormData(form);
    const amountPaise = toPaise(String(values.get("amount") ?? ""));
    const input = {
      id: paymentId,
      method: String(values.get("method")) as ManualPaymentMethod,
      amountPaise: amountPaise ?? 0,
      paidOn: String(values.get("paidOn") ?? ""),
      reference: String(values.get("reference") ?? "").trim() || undefined,
    };
    // The same rules the server checks, plus the two only this form can word well.
    const errors = checkAgainst(recordPaymentSchema, input);
    if (amountPaise === null) errors.amountPaise = "Enter the amount in rupees, for example 2124 or 2124.50";
    else if (amountPaise > invoice.duePaise) errors.amountPaise = `That is more than what is due on this invoice (${money(invoice.duePaise)})`;
    if (!errors.paidOn && input.paidOn > today()) errors.paidOn = "The payment date cannot be in the future";
    // The form's boxes are named for what is typed in them.
    const shown: FieldErrors = { ...errors, ...(errors.amountPaise && { amount: errors.amountPaise }) };
    setFieldErrors(shown);
    if (hasErrors(shown)) {
      focusFirstError(form, shown);
      return;
    }

    setBusy("pay");
    setActionError(null);
    try {
      const result = await api.billing.recordPayment(invoice.id, input);
      setInvoice(result.invoice);
      setPanel(null);
      notify(
        result.invoice.duePaise > 0
          ? `Payment of ${money(input.amountPaise)} recorded. ${money(result.invoice.duePaise)} is still due`
          : `Payment of ${money(input.amountPaise)} recorded. ${invoice.number} is paid in full`,
      );
      onChanged();
    } catch (e) {
      setActionError(describe(e));
    } finally {
      setBusy(null);
    }
  }

  async function makeVoid(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!invoice) return;
    const form = event.currentTarget;
    const input = { reason: String(new FormData(form).get("reason") ?? "") };
    const errors = checkAgainst(voidInvoiceSchema, input);
    setFieldErrors(errors);
    if (hasErrors(errors)) {
      focusFirstError(form, errors);
      return;
    }
    const sure = await confirm({
      title: `Make ${invoice.number} void?`,
      body: "The invoice is cancelled and nothing more is owed on it. It stays on record as void with your reason, and its number is never used again. This cannot be undone; the same visit or plan cycle can be invoiced again afterwards under a new number.",
      confirmLabel: "Make it void",
      cancelLabel: "Keep the invoice",
    });
    if (!sure) return;

    setBusy("void");
    setActionError(null);
    try {
      setInvoice(await api.billing.void(invoice.id, input));
      setPanel(null);
      notify(`${invoice.number} is now void`);
      onChanged();
    } catch (e) {
      setActionError(describe(e));
    } finally {
      setBusy(null);
    }
  }

  async function raiseAgain() {
    if (!invoice) return;
    setBusy("again");
    setActionError(null);
    try {
      const raised = await api.billing.raiseAgain(invoice.id);
      notify(`${raised.number} raised in place of ${invoice.number}`);
      onChanged();
      onOpen(raised.id);
    } catch (e) {
      setActionError(describe(e));
    } finally {
      setBusy(null);
    }
  }

  const fact = (label: string, value: string | null | undefined) =>
    value ? (
      <div className="flex gap-3">
        <dt className="w-36 shrink-0 text-muted">{label}</dt>
        <dd>{value}</dd>
      </div>
    ) : null;
  const sum = (label: string, paise: number, strong = false) => (
    <div className={`flex justify-between gap-6 ${strong ? "border-t border-border pt-1 font-bold" : ""}`}>
      <dt className={strong ? "" : "text-muted"}>{label}</dt>
      <dd className="tabular-nums">{money(paise)}</dd>
    </div>
  );

  return (
    <div className="flex flex-col gap-6">
      {back}

      <div className="flex flex-wrap items-start justify-between gap-4">
        <div>
          <h1 className="flex flex-wrap items-center gap-3 text-2xl font-bold">
            Invoice {invoice.number}
            <StateBadge invoice={invoice} />
          </h1>
          <p className="text-muted">
            {invoice.organizationName}
            {invoice.outletName ? ` · ${invoice.outletName}` : ""} · {invoice.kind === "SUBSCRIPTION" ? "Plan" : "One-time visit"}
          </p>
        </div>
        <div className="flex flex-wrap items-center gap-2">
          <Button variant="secondary" loading={busy === "pdf"} disabled={busy !== null} onClick={() => void openPdf()}>
            Open the PDF
          </Button>
          {owing && (
            <Button disabled={busy !== null} aria-expanded={panel === "pay"} onClick={() => open(panel === "pay" ? null : "pay")}>
              Record a payment
            </Button>
          )}
          {!isVoid && !received && (
            <Button variant="secondary" disabled={busy !== null} aria-expanded={panel === "void"} onClick={() => open(panel === "void" ? null : "void")}>
              Void
            </Button>
          )}
          {isVoid && (
            <Button loading={busy === "again"} disabled={busy !== null} onClick={() => void raiseAgain()}>
              Raise it again
            </Button>
          )}
        </div>
      </div>

      {panel === null && <ErrorMessage message={actionError} />}
      {!invoice.pdfReady && (
        <p className="text-sm text-muted">
          The PDF on file is {isVoid || received ? "out of date or " : ""}not made yet. A current one is made when the invoice is next
          opened as a PDF, here or in the app.
        </p>
      )}

      {isVoid && (
        <Card className="border-danger/40">
          <p className="font-semibold">
            <span aria-hidden>✕ </span>Void{invoice.voidedAt ? ` since ${when(invoice.voidedAt)}` : ""}. Nothing is owed on this invoice.
          </p>
          <p className="text-muted">Reason: {invoice.voidReason}</p>
          <p className="mt-2 text-sm text-muted">
            &ldquo;Raise it again&rdquo; issues a new invoice, under a new number, for the same{" "}
            {invoice.kind === "SUBSCRIPTION" ? "cycle of the plan (at the price the outlet's plan has now)" : "visit"}, billed to the
            client as its details stand today. If that has already been done, it opens the invoice that replaced this one.
          </p>
        </Card>
      )}

      {panel === "pay" && (
        <Card>
          <form onSubmit={(event) => void recordPayment(event)} noValidate className="flex flex-col gap-4">
            <div>
              <h2 className="text-lg font-bold">Record a payment</h2>
              <p className="text-muted">
                For money ECCS received outside the app. {money(invoice.duePaise)} is due; part of it may be recorded, never more.
              </p>
            </div>
            <div className="grid gap-4 sm:grid-cols-2">
              <Field
                label="Amount received (₹)"
                name="amount"
                required
                inputMode="decimal"
                defaultValue={(invoice.duePaise / 100).toFixed(2)}
                error={fieldErrors.amount}
              />
              <SelectField label="How it was paid" name="method" defaultValue={MANUAL_PAYMENT_METHODS[0]} error={fieldErrors.method}>
                {MANUAL_PAYMENT_METHODS.map((method) => (
                  <option key={method} value={method}>
                    {methodName(method)}
                  </option>
                ))}
              </SelectField>
              <Field label="Date received" name="paidOn" type="date" required defaultValue={today()} max={today()} error={fieldErrors.paidOn} />
              <Field
                label="Reference"
                name="reference"
                hint="The bank's UTR, the UPI reference or the cheque number. Not needed for cash."
                maxLength={80}
                error={fieldErrors.reference}
              />
            </div>
            <ErrorMessage message={actionError} />
            <div className="flex flex-wrap gap-2">
              <Button type="submit" loading={busy === "pay"}>
                Save the payment
              </Button>
              <Button type="button" variant="secondary" disabled={busy !== null} onClick={() => open(null)}>
                Cancel
              </Button>
            </div>
          </form>
        </Card>
      )}

      {panel === "void" && (
        <Card>
          <form onSubmit={(event) => void makeVoid(event)} noValidate className="flex flex-col gap-4">
            <div>
              <h2 className="text-lg font-bold">Make this invoice void</h2>
              <p className="text-muted">
                For an invoice raised wrongly. It is not deleted: it stays on record marked void, the restaurant still sees it, and its
                PDF is stamped VOID.
              </p>
            </div>
            <TextAreaField label="Reason" name="reason" required rows={2} maxLength={300} hint="Printed on the void invoice." error={fieldErrors.reason} />
            <ErrorMessage message={actionError} />
            <div className="flex flex-wrap gap-2">
              <Button type="submit" variant="danger" loading={busy === "void"}>
                Make it void
              </Button>
              <Button type="button" variant="secondary" disabled={busy !== null} onClick={() => open(null)}>
                Keep the invoice
              </Button>
            </div>
          </form>
        </Card>
      )}

      <div className="grid gap-6 lg:grid-cols-2">
        <Card>
          <h2 className="mb-2 text-lg font-bold">Invoice</h2>
          <dl className="flex flex-col gap-1 text-sm">
            {fact("Invoice date", day(invoice.issueDate))}
            {fact("Due date", day(invoice.dueDate))}
            {fact("For the period", invoice.periodStart && invoice.periodEnd ? `${day(invoice.periodStart)} to ${day(invoice.periodEnd)}` : null)}
            {fact("Place of supply", gstStateLabel(invoice.placeOfSupply))}
            {fact("Tax", invoice.interState ? "IGST (the buyer is in another State)" : "CGST and SGST (the buyer is in Telangana, or has no State on record)")}
          </dl>
          {invoice.visitId && (
            <Link href={`/visits?state=closed&visit=${encodeURIComponent(invoice.visitId)}`} className="mt-2 inline-block py-0.5 text-sm font-medium text-primary hover:underline">
              The visit this invoice is for
            </Link>
          )}
        </Card>
        <Card>
          <h2 className="mb-2 text-lg font-bold">Billed to</h2>
          <dl className="flex flex-col gap-1 text-sm">
            {fact("Name", invoice.billTo.legalName || invoice.billTo.name)}
            {fact("Trading as", invoice.billTo.legalName && invoice.billTo.legalName !== invoice.billTo.name ? invoice.billTo.name : null)}
            {fact("Address", invoice.billTo.address ?? "None on record")}
            {fact("GSTIN", invoice.billTo.gstin ?? "None on record")}
            {fact("State", invoice.billTo.stateCode ? gstStateLabel(invoice.billTo.stateCode) : "None on record")}
          </dl>
          <p className="mt-2 text-sm text-muted">As printed on the invoice. Changing the client&apos;s details later does not alter it.</p>
        </Card>
      </div>

      <Card className="flex flex-col gap-4">
        <h2 className="text-lg font-bold">Lines</h2>
        <div className="-mx-4 overflow-x-auto px-4">
          <table className="w-full text-left text-sm">
            <thead className="text-muted">
              <tr className="border-b border-border">
                <th scope="col" className="py-2 pr-4 font-medium">
                  Description
                </th>
                <th scope="col" className="py-2 pr-4 font-medium">
                  SAC
                </th>
                <th scope="col" className="py-2 pr-4 text-right font-medium">
                  Qty
                </th>
                <th scope="col" className="py-2 pr-4 text-right font-medium">
                  Taxable value
                </th>
                {invoice.interState ? (
                  <th scope="col" className="py-2 pr-4 text-right font-medium">
                    IGST
                  </th>
                ) : (
                  <>
                    <th scope="col" className="py-2 pr-4 text-right font-medium">
                      CGST
                    </th>
                    <th scope="col" className="py-2 pr-4 text-right font-medium">
                      SGST
                    </th>
                  </>
                )}
                <th scope="col" className="py-2 text-right font-medium">
                  Total
                </th>
              </tr>
            </thead>
            <tbody>
              {invoice.lines.map((line, index) => (
                <tr key={index} className="border-b border-border align-top last:border-0">
                  <td className="max-w-md py-2.5 pr-4">{line.description}</td>
                  <td className="py-2.5 pr-4">{line.sacCode}</td>
                  <td className="py-2.5 pr-4 text-right tabular-nums">{line.quantity}</td>
                  <td className="py-2.5 pr-4 text-right whitespace-nowrap tabular-nums">{money(line.taxablePaise)}</td>
                  {invoice.interState ? (
                    <td className="py-2.5 pr-4 text-right whitespace-nowrap tabular-nums">
                      {money(line.igstPaise)}
                      <div className="text-muted">{rate(line.gstRatePercent)}</div>
                    </td>
                  ) : (
                    <>
                      <td className="py-2.5 pr-4 text-right whitespace-nowrap tabular-nums">
                        {money(line.cgstPaise)}
                        <div className="text-muted">{rate(line.gstRatePercent / 2)}</div>
                      </td>
                      <td className="py-2.5 pr-4 text-right whitespace-nowrap tabular-nums">
                        {money(line.sgstPaise)}
                        <div className="text-muted">{rate(line.gstRatePercent / 2)}</div>
                      </td>
                    </>
                  )}
                  <td className="py-2.5 text-right whitespace-nowrap tabular-nums">{money(line.totalPaise)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
        <dl className="flex w-full max-w-xs flex-col gap-1 self-end text-sm">
          {sum("Taxable value", invoice.subtotalPaise)}
          {invoice.interState ? (
            sum("IGST", invoice.igstPaise)
          ) : (
            <>
              {sum("CGST", invoice.cgstPaise)}
              {sum("SGST", invoice.sgstPaise)}
            </>
          )}
          {sum("Invoice total", invoice.totalPaise, true)}
          {sum("Paid", invoice.paidPaise)}
          {!isVoid && sum("Still due", invoice.duePaise, true)}
        </dl>
        <p className="text-sm text-muted">{invoice.amountInWords}</p>
      </Card>

      <Card className="flex flex-col gap-3">
        <h2 className="text-lg font-bold">Payments</h2>
        {invoice.payments.length === 0 ? (
          <p className="text-muted">No payment has been made or recorded on this invoice.</p>
        ) : (
          <div className="-mx-4 overflow-x-auto px-4">
            <table className="w-full text-left text-sm">
              <thead className="text-muted">
                <tr className="border-b border-border">
                  <th scope="col" className="py-2 pr-4 font-medium">
                    When
                  </th>
                  <th scope="col" className="py-2 pr-4 font-medium">
                    How
                  </th>
                  <th scope="col" className="py-2 pr-4 font-medium">
                    Reference
                  </th>
                  <th scope="col" className="py-2 pr-4 text-right font-medium">
                    Amount
                  </th>
                  <th scope="col" className="py-2 font-medium">
                    Status
                  </th>
                </tr>
              </thead>
              <tbody>
                {invoice.payments.map((payment) => (
                  <tr key={payment.id} className="border-b border-border align-top last:border-0">
                    <td className="py-2.5 pr-4 whitespace-nowrap">{when(payment.paidAt ?? payment.createdAt)}</td>
                    <td className="py-2.5 pr-4">
                      {methodName(payment.method)}
                      <div className="text-muted">
                        {payment.gateway === "sample"
                          ? `Sample payment in the app${payment.recordedByName ? `, by ${payment.recordedByName}` : ""}. No money moved.`
                          : payment.recordedByName
                            ? `Recorded by ${payment.recordedByName}`
                            : ""}
                      </div>
                    </td>
                    <td className="py-2.5 pr-4">{payment.reference ?? <span className="text-muted">None</span>}</td>
                    <td className="py-2.5 pr-4 text-right whitespace-nowrap tabular-nums">{money(payment.amountPaise)}</td>
                    <td className="py-2.5">
                      <span className={payment.status === "FAILED" ? "font-semibold text-danger" : payment.status === "SUCCEEDED" ? "font-semibold" : "text-muted"}>
                        {PAYMENT_STATE[payment.status]}
                      </span>
                      {payment.failureReason && <div className="text-muted">{payment.failureReason}</div>}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
        {received && !isVoid && (
          <p className="text-sm text-muted">An invoice on which a payment has been received can no longer be made void.</p>
        )}
      </Card>
    </div>
  );
}
