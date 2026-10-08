// Invoices and payments: GST invoices for visits and subscription cycles, what is due, and paying.
//
// Everything here is plain arithmetic and wording with no database in it, so
// the server, the console and the app all work an invoice out the same way and
// the rules can be tested on their own (billing.test.ts).
//
// Money is whole paise everywhere (₹1 = 100 paise). Dates are India dates,
// written YYYY-MM-DD.

import { z } from "zod";

// ───────────────────────── ECCS as the supplier ─────────────────────────

/** ECCS's own GST state: Telangana. A buyer in the same state is charged CGST + SGST; any other state, IGST. */
export const ECCS_STATE_CODE = "36";

/**
 * An invoice is due this many days after the day it is issued.
 * A sample value: the founder has not yet said what ECCS's payment terms are.
 */
export const INVOICE_DUE_DAYS = 7;

/** GST state and union territory codes, as printed on an invoice ("Telangana (36)"). */
export const GST_STATES: Readonly<Record<string, string>> = {
  "01": "Jammu and Kashmir",
  "02": "Himachal Pradesh",
  "03": "Punjab",
  "04": "Chandigarh",
  "05": "Uttarakhand",
  "06": "Haryana",
  "07": "Delhi",
  "08": "Rajasthan",
  "09": "Uttar Pradesh",
  "10": "Bihar",
  "11": "Sikkim",
  "12": "Arunachal Pradesh",
  "13": "Nagaland",
  "14": "Manipur",
  "15": "Mizoram",
  "16": "Tripura",
  "17": "Meghalaya",
  "18": "Assam",
  "19": "West Bengal",
  "20": "Jharkhand",
  "21": "Odisha",
  "22": "Chhattisgarh",
  "23": "Madhya Pradesh",
  "24": "Gujarat",
  "26": "Dadra and Nagar Haveli and Daman and Diu",
  "27": "Maharashtra",
  "29": "Karnataka",
  "30": "Goa",
  "31": "Lakshadweep",
  "32": "Kerala",
  "33": "Tamil Nadu",
  "34": "Puducherry",
  "35": "Andaman and Nicobar Islands",
  "36": "Telangana",
  "37": "Andhra Pradesh",
  "38": "Ladakh",
};

/** "Telangana (36)"; just the code when it is not one we know. */
export const gstStateLabel = (code: string) => (GST_STATES[code] ? `${GST_STATES[code]} (${code})` : code);

// ───────────────────────── GST arithmetic ─────────────────────────

/**
 * The GST on an amount, in whole paise. A half paisa or more rounds up.
 * For showing "what you will pay" beside a price; an invoice itself is worked
 * out by `calculateGst`, which also splits the tax.
 */
export function gstOn(paise: number, ratePercent: number): number {
  return Math.round((paise * ratePercent) / 100);
}

export interface GstLineInput {
  /** The line's value before tax, in paise. */
  taxablePaise: number;
  /** The full GST rate, e.g. 18. */
  gstRatePercent: number;
}

export interface GstLine extends GstLineInput {
  cgstPaise: number;
  sgstPaise: number;
  igstPaise: number;
  /** Taxable value plus its tax. */
  totalPaise: number;
}

export interface GstTotals {
  /** True when the buyer is in another state, so IGST is charged in place of CGST + SGST. */
  interState: boolean;
  /** The GST state code of the place of supply. */
  placeOfSupply: string;
  lines: GstLine[];
  subtotalPaise: number;
  cgstPaise: number;
  sgstPaise: number;
  igstPaise: number;
  /** All the tax together. */
  taxPaise: number;
  totalPaise: number;
}

/**
 * The one place GST is worked out.
 *
 * - A buyer in ECCS's own state (Telangana, 36), or with no state on record,
 *   is charged CGST and SGST, each at half the rate. A buyer in any other
 *   state is charged IGST at the full rate.
 * - The rounding rule: each tax is worked out line by line at its own rate
 *   (9% + 9% for an 18% service, or 18% IGST) and rounded to the nearest
 *   paisa, a half paisa or more rounding up. CGST and SGST on a line are
 *   therefore always equal. The invoice's totals are the sums of its lines,
 *   so the printed columns always add up. The total is not rounded to a whole
 *   rupee: GST returns carry two decimal places.
 */
export function calculateGst(
  lines: readonly GstLineInput[],
  buyerStateCode: string | null | undefined,
  supplierStateCode: string = ECCS_STATE_CODE,
): GstTotals {
  const placeOfSupply = buyerStateCode?.trim() || supplierStateCode;
  const interState = placeOfSupply !== supplierStateCode;

  const worked = lines.map((line): GstLine => {
    const half = interState ? 0 : gstOn(line.taxablePaise, line.gstRatePercent / 2);
    const igstPaise = interState ? gstOn(line.taxablePaise, line.gstRatePercent) : 0;
    return {
      taxablePaise: line.taxablePaise,
      gstRatePercent: line.gstRatePercent,
      cgstPaise: half,
      sgstPaise: half,
      igstPaise,
      totalPaise: line.taxablePaise + half + half + igstPaise,
    };
  });

  const sum = (pick: (line: GstLine) => number) => worked.reduce((total, line) => total + pick(line), 0);
  const cgstPaise = sum((line) => line.cgstPaise);
  const sgstPaise = sum((line) => line.sgstPaise);
  const igstPaise = sum((line) => line.igstPaise);
  const subtotalPaise = sum((line) => line.taxablePaise);
  return {
    interState,
    placeOfSupply,
    lines: worked,
    subtotalPaise,
    cgstPaise,
    sgstPaise,
    igstPaise,
    taxPaise: cgstPaise + sgstPaise + igstPaise,
    totalPaise: subtotalPaise + cgstPaise + sgstPaise + igstPaise,
  };
}

// ───────────────────────── Amount in words ─────────────────────────

const ONES = [
  "Zero", "One", "Two", "Three", "Four", "Five", "Six", "Seven", "Eight", "Nine", "Ten", "Eleven", "Twelve",
  "Thirteen", "Fourteen", "Fifteen", "Sixteen", "Seventeen", "Eighteen", "Nineteen",
];
const TENS = ["", "", "Twenty", "Thirty", "Forty", "Fifty", "Sixty", "Seventy", "Eighty", "Ninety"];

/** 0 to 99 in words. */
const underHundred = (value: number) =>
  value < 20 ? ONES[value]! : [TENS[Math.floor(value / 10)]!, value % 10 ? ONES[value % 10]! : ""].filter(Boolean).join(" ");

/** A whole number in words the Indian way: thousand, lakh (1,00,000), crore (1,00,00,000). */
function numberInWords(value: number): string {
  if (value === 0) return ONES[0]!;
  const parts: string[] = [];
  const crore = Math.floor(value / 10_000_000);
  const lakh = Math.floor((value % 10_000_000) / 100_000);
  const thousand = Math.floor((value % 100_000) / 1000);
  const hundred = Math.floor((value % 1000) / 100);
  const rest = value % 100;
  // Above 99 crore the crores are themselves read as a number ("One Hundred Crore").
  if (crore) parts.push(`${numberInWords(crore)} Crore`);
  if (lakh) parts.push(`${underHundred(lakh)} Lakh`);
  if (thousand) parts.push(`${underHundred(thousand)} Thousand`);
  if (hundred) parts.push(`${ONES[hundred]!} Hundred`);
  if (rest) parts.push(underHundred(rest));
  return parts.join(" ");
}

/**
 * An amount as it is written on an Indian invoice:
 * 12345678 paise is "Rupees One Lakh Twenty Three Thousand Four Hundred Fifty Six and Seventy Eight Paise Only".
 */
export function amountInWords(paise: number): string {
  const whole = Math.max(0, Math.round(paise));
  const rupees = Math.floor(whole / 100);
  const rest = whole % 100;
  return `Rupees ${numberInWords(rupees)}${rest ? ` and ${underHundred(rest)} Paise` : ""} Only`;
}

// ───────────────────────── Numbers and dates ─────────────────────────

const DAY_MS = 86_400_000;
const toTime = (date: string) => Date.parse(`${date}T00:00:00.000Z`);
const addDays = (date: string, days: number) => new Date(toTime(date) + days * DAY_MS).toISOString().slice(0, 10);

/**
 * The financial year a date falls in. India's runs from 1 April to 31 March,
 * so 31 March 2027 is still "26-27" and 1 April 2027 is "27-28".
 */
export function financialYear(date: string): { startYear: number; label: string } {
  const year = Number(date.slice(0, 4));
  const startYear = Number(date.slice(5, 7)) >= 4 ? year : year - 1;
  const two = (value: number) => String(value % 100).padStart(2, "0");
  return { startYear, label: `${two(startYear)}-${two(startYear + 1)}` };
}

/** What every invoice number of that date's financial year starts with: "ECCS/26-27/". */
export const invoiceNumberPrefix = (issueDate: string) => `ECCS/${financialYear(issueDate).label}/`;

/** GST Rule 46 allows an invoice number at most this long. */
export const INVOICE_NUMBER_MAX_LENGTH = 16;

/**
 * The invoice number for the nth invoice of a financial year: "ECCS/26-27/00001".
 * Exactly 16 characters up to invoice 99,999 of a year, which is the most
 * Rule 46 allows; it throws rather than issue a longer one.
 */
export function invoiceNumber(issueDate: string, sequence: number): string {
  const number = `${invoiceNumberPrefix(issueDate)}${String(sequence).padStart(5, "0")}`;
  if (number.length > INVOICE_NUMBER_MAX_LENGTH) throw new Error(`Invoice number ${number} is longer than GST allows`);
  return number;
}

/** The day an invoice issued on `issueDate` must be paid by. */
export const invoiceDueDate = (issueDate: string) => addDays(issueDate, INVOICE_DUE_DAYS);

/**
 * How many days past its due date an invoice is on `today`: 0 while it is not
 * overdue (it is not overdue on the due date itself) or once nothing is owed.
 */
export function invoiceOverdueDays(dueDate: string, today: string, duePaise: number): number {
  if (duePaise <= 0) return 0;
  return Math.max(0, Math.round((toTime(today) - toTime(dueDate)) / DAY_MS));
}

// ───────────────────────── What the API sends ─────────────────────────

/** VOID means cancelled by ECCS: it stays on record with its number, and nothing is owed on it. */
export type InvoiceStatus = "ISSUED" | "PARTIALLY_PAID" | "PAID" | "VOID";
export const INVOICE_STATUSES = ["ISSUED", "PARTIALLY_PAID", "PAID", "VOID"] as const satisfies readonly InvoiceStatus[];

/** What an invoice is for: one cycle of a plan, or one booked visit. */
export type InvoiceKind = "SUBSCRIPTION" | "VISIT";

export type PaymentStatus = "PENDING" | "SUCCEEDED" | "FAILED" | "REFUNDED";

/** How a restaurant can pay in the app. */
export const ONLINE_PAYMENT_METHODS = ["upi", "card", "netbanking"] as const;
export type OnlinePaymentMethod = (typeof ONLINE_PAYMENT_METHODS)[number];

/** How ECCS can have been paid outside the app, recorded by hand in the console. */
export const MANUAL_PAYMENT_METHODS = ["bank-transfer", "upi", "cheque", "cash"] as const;
export type ManualPaymentMethod = (typeof MANUAL_PAYMENT_METHODS)[number];

export type PaymentMethod = OnlinePaymentMethod | ManualPaymentMethod;

/** The buyer exactly as printed on the invoice, kept with it so later changes to the client do not alter it. */
export interface InvoiceBillTo {
  name: string;
  legalName: string | null;
  gstin: string | null;
  address: string | null;
  /** GST state code, null when the client has none on record. */
  stateCode: string | null;
}

export interface InvoiceLineDto extends GstLine {
  description: string;
  sacCode: string;
  quantity: number;
  unitPricePaise: number;
}

export interface PaymentDto {
  id: string;
  invoiceId: string;
  invoiceNumber: string;
  amountPaise: number;
  method: string;
  status: PaymentStatus;
  /** "sample" for the pretend online payment, "manual" for one ECCS recorded by hand. */
  gateway: string | null;
  reference: string | null;
  failureReason: string | null;
  /** When the money was received (for a manual payment, the day ECCS says it was). */
  paidAt: string | null;
  createdAt: string;
  /** For a manual payment: the ECCS person who recorded it. Only ECCS is told. */
  recordedByName: string | null;
}

/** One invoice in a list. */
export interface InvoiceSummaryDto {
  id: string;
  /** e.g. "ECCS/26-27/00001" */
  number: string;
  kind: InvoiceKind;
  organizationId: string;
  organizationName: string;
  outletId: string | null;
  outletName: string | null;
  /** What it is for, in a line (the first line of the invoice). */
  description: string;
  /** YYYY-MM-DD */
  issueDate: string;
  dueDate: string;
  /** For a plan's invoice: the cycle it covers. */
  periodStart: string | null;
  periodEnd: string | null;
  status: InvoiceStatus;
  totalPaise: number;
  paidPaise: number;
  /** What is still owed: nothing on a paid or void invoice. */
  duePaise: number;
  /** Days past the due date with money still owed; 0 when not overdue. */
  overdueDays: number;
}

/** One invoice in full. */
export interface InvoiceDto extends InvoiceSummaryDto {
  billTo: InvoiceBillTo;
  /** GST state code of the place of supply. */
  placeOfSupply: string;
  interState: boolean;
  subtotalPaise: number;
  cgstPaise: number;
  sgstPaise: number;
  igstPaise: number;
  amountInWords: string;
  lines: InvoiceLineDto[];
  /** The newest first. A restaurant sees only payments that went through or failed, not ones left unfinished. */
  payments: PaymentDto[];
  notes: string | null;
  voidedAt: string | null;
  voidReason: string | null;
  /** For a booked visit's invoice: the visit. */
  visitId: string | null;
  /** False while the PDF on file is missing or out of date (it is made when next opened). */
  pdfReady: boolean;
}

/** What is owed, for one outlet or one client. */
export interface DuesLineDto {
  duePaise: number;
  /** The part of it that is past its due date. */
  overduePaise: number;
  unpaidCount: number;
  overdueCount: number;
  /** Days the oldest unpaid invoice is past its due date; 0 when none is overdue. */
  oldestOverdueDays: number;
  /** The due date of the oldest unpaid invoice, null when nothing is owed. */
  oldestDueDate: string | null;
}

export interface OutletDuesDto extends DuesLineDto {
  outletId: string;
  outletName: string;
  organizationId: string;
}

export interface ClientDuesDto extends DuesLineDto {
  organizationId: string;
  organizationName: string;
}

/** What is owed across everything the person may see, then by client and by outlet (only those owing something). */
export interface DuesDto extends DuesLineDto {
  clients: ClientDuesDto[];
  outlets: OutletDuesDto[];
}

/** The totals at the top of the console's Invoices page. */
export interface BillingTotalsDto {
  duePaise: number;
  unpaidCount: number;
  overduePaise: number;
  overdueCount: number;
  /** Payments received since the first of this month, in India. */
  collectedThisMonthPaise: number;
}

/** A payment that has been started and what the app must show to finish it. */
export interface PaymentSessionDto {
  payment: PaymentDto;
  /** Which screen takes the payment: "sample" is the pretend one built into the app. */
  gateway: string;
  /** Whatever that gateway's screen needs (nothing for the sample). */
  checkout: Record<string, unknown>;
}

/** How a payment ended, with the invoice as it stands afterwards: the receipt. */
export interface PaymentResultDto {
  payment: PaymentDto;
  invoice: InvoiceDto;
}

// ───────────────────────── What the API accepts ─────────────────────────

const dateSchema = z
  .string()
  .trim()
  .regex(/^\d{4}-\d{2}-\d{2}$/, "Enter the date as YYYY-MM-DD")
  .refine((value) => !Number.isNaN(Date.parse(`${value}T00:00:00.000Z`)), "That date does not exist");

/** The Owner starts paying an invoice in the app. The amount is always everything still owed on it. */
export const startPaymentSchema = z.object({
  method: z.enum(ONLINE_PAYMENT_METHODS, "Choose how to pay"),
});
export type StartPaymentInput = z.input<typeof startPaymentSchema>;

/**
 * What the payment screen sends back when the person has finished there. Each
 * gateway reads its own proof out of it: the sample gateway only looks at
 * `outcome` ("success", or "fail" to try a failed payment).
 */
export const confirmPaymentSchema = z.record(z.string(), z.unknown());
export type ConfirmPaymentInput = Record<string, unknown>;

/** ECCS records a payment it received outside the app. */
export const recordPaymentSchema = z
  .object({
    /** Chosen by the console when the form opens, so that pressing Save twice records one payment. */
    id: z.uuid().optional(),
    method: z.enum(MANUAL_PAYMENT_METHODS, "Choose how it was paid"),
    amountPaise: z.number("Enter the amount").int("Enter the amount in rupees and paise").positive("Enter an amount above zero"),
    paidOn: dateSchema,
    reference: z.string().trim().max(80, "Keep the reference under 80 characters").optional(),
  })
  // Cash has no reference of its own; everything else can be traced by one.
  .refine((value) => value.method === "cash" || Boolean(value.reference), {
    path: ["reference"],
    message: "Enter the reference: the UTR, the UPI reference or the cheque number",
  });
export type RecordPaymentInput = z.input<typeof recordPaymentSchema>;

export const voidInvoiceSchema = z.object({
  reason: z.string().trim().min(3, "Say why this invoice is being made void").max(300, "Keep the reason under 300 characters"),
});
export type VoidInvoiceInput = z.input<typeof voidInvoiceSchema>;
