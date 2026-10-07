// Service certificates: the numbered, dated document ECCS issues after certain kinds of visit.
//
// Some kinds of service (pest control, deep clean, chimney and hood cleaning)
// end with a certificate the restaurant can show to an inspector or a customer.
// It is issued when ECCS approves the visit's report, at the same moment the
// report PDF is made, and it is valid from the day of the visit for the number
// of days set on that kind of service in the console's Catalogue.

import type { LocalizedText } from "./checklists.js";

/** How close a certificate is to running out. The same three words as for licences. */
export type CertificateState = "VALID" | "EXPIRING" | "EXPIRED";
export const CERTIFICATE_STATES = ["VALID", "EXPIRING", "EXPIRED"] as const satisfies readonly CertificateState[];

/** The longest a kind of service's certificate may be set to last: five years. */
export const CERTIFICATE_MAX_VALID_DAYS = 1825;

// A certificate lasts anything from two weeks to several months, so one fixed
// warning period would not fit them all: thirty days' warning on a 15-day
// certificate would mean "expiring soon" from the day it is issued. The
// warning is the last fifth of its life instead, never under 3 days and never
// over 30. (15 days: the last 3. 30 days: the last 6. 90 days: the last 18.)
const WARNING_SHARE = 0.2;
const WARNING_MIN_DAYS = 3;
const WARNING_MAX_DAYS = 30;

const DAY_MS = 86_400_000;
const toTime = (date: string) => Date.parse(`${date}T00:00:00.000Z`);

/** Whole days from one YYYY-MM-DD date to another. Negative when `to` is the earlier one. */
const daysBetween = (from: string, to: string) => Math.round((toTime(to) - toTime(from)) / DAY_MS);

/**
 * The last day a certificate is valid: the day of the visit plus the number
 * of days it lasts. A 15-day certificate for a visit on 1 October runs to the
 * end of 16 October, so a visit every 15 days leaves no day uncovered.
 */
export function certificateValidUntil(validFrom: string, validDays: number): string {
  return new Date(toTime(validFrom) + validDays * DAY_MS).toISOString().slice(0, 10);
}

/** How many days before its last day a certificate starts to count as "expiring soon". */
export function certificateWarningDays(validFrom: string, validUntil: string): number {
  const life = Math.max(0, daysBetween(validFrom, validUntil));
  return Math.min(WARNING_MAX_DAYS, Math.max(WARNING_MIN_DAYS, Math.round(life * WARNING_SHARE)));
}

/**
 * Where a certificate stands on a given day (`today`, YYYY-MM-DD in India).
 * It is valid up to and including its last day; `daysLeft` is 0 on that day
 * and negative afterwards.
 */
export function certificateValidity(
  validFrom: string,
  validUntil: string,
  today: string,
): { state: CertificateState; daysLeft: number } {
  const daysLeft = daysBetween(today, validUntil);
  if (daysLeft < 0) return { state: "EXPIRED", daysLeft };
  return { state: daysLeft <= certificateWarningDays(validFrom, validUntil) ? "EXPIRING" : "VALID", daysLeft };
}

/** The certificate of a visit, as carried on the visit itself so a screen can link to it. */
export interface VisitCertificateDto {
  id: string;
  /** e.g. "CERT-2026-00001" */
  number: string;
  /** YYYY-MM-DD */
  validFrom: string;
  /** YYYY-MM-DD, the last day it is valid. */
  validUntil: string;
  state: CertificateState;
  /** Days until the last valid day, counted in India. Negative once expired. */
  daysLeft: number;
}

/** One certificate, as shown in lists and on its own. */
export interface CertificateDto extends VisitCertificateDto {
  outletId: string;
  outletName: string;
  organizationName: string;
  /** The kind of service it certifies, e.g. "PEST". */
  serviceCode: string;
  serviceName: LocalizedText;
  /** The visit it was issued for. */
  visitId: string | null;
  /** That visit's service report, e.g. "SR-2026-00001". */
  reportNumber: string | null;
  issuedAt: string;
  /** False while the PDF has not been made yet (it is made when first opened). */
  pdfReady: boolean;
}
