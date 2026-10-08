import type { InvoiceSummaryDto } from "@eccs/shared";

// What the invoice list and the invoice detail share: how money is written,
// the words for where an invoice stands, and the names of the ways of paying.

/** An amount held in paise, to the paisa: "₹2,124.00". Invoices are exact, so the paise are always shown. */
export const money = (paise: number) =>
  new Intl.NumberFormat("en-IN", { style: "currency", currency: "INR", minimumFractionDigits: 2, maximumFractionDigits: 2 }).format(
    paise / 100,
  );

/** Where an invoice stands, as ECCS thinks of it. "Overdue" is an unpaid invoice past its due date. */
export type Standing = "overdue" | "due" | "paid" | "void";

export const standingOf = (invoice: InvoiceSummaryDto): Standing =>
  invoice.status === "VOID" ? "void" : invoice.status === "PAID" ? "paid" : invoice.overdueDays > 0 ? "overdue" : "due";

// Each has its own mark as well as its colour, so the table reads the same in black and white.
const STANDING: Record<Standing, { mark: string; style: string }> = {
  overdue: { mark: "!", style: "border-danger text-danger" },
  due: { mark: "○", style: "border-amber-600 text-amber-700" },
  paid: { mark: "✓", style: "border-primary text-primary" },
  void: { mark: "✕", style: "border-border-strong text-muted" },
};

/** The state in words: "Overdue by 3 days", "Part paid", "To pay", "Paid", "Void". */
export function standingLabel(invoice: InvoiceSummaryDto): string {
  const standing = standingOf(invoice);
  if (standing === "void") return "Void";
  if (standing === "paid") return "Paid";
  const part = invoice.status === "PARTIALLY_PAID";
  if (standing === "overdue") {
    return `${part ? "Part paid, overdue" : "Overdue"} by ${invoice.overdueDays} day${invoice.overdueDays === 1 ? "" : "s"}`;
  }
  return part ? "Part paid" : "To pay";
}

export function StateBadge({ invoice }: { invoice: InvoiceSummaryDto }) {
  const { mark, style } = STANDING[standingOf(invoice)];
  return (
    <span className={`inline-block rounded-full border px-2.5 py-0.5 text-xs font-semibold whitespace-nowrap ${style}`}>
      <span aria-hidden>{mark} </span>
      {standingLabel(invoice)}
    </span>
  );
}

const METHODS: Record<string, string> = {
  upi: "UPI",
  card: "Card",
  netbanking: "Net banking",
  cash: "Cash",
  cheque: "Cheque",
  "bank-transfer": "Bank transfer",
};

export const methodName = (method: string) => METHODS[method] ?? method;
