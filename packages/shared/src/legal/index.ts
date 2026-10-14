// The documents restaurant users agree to before using the app (founder, 14 Oct 2026):
// who must agree to which, the version in force, and the words themselves.
//
// How it is built follows clickwrap practice for India (King Stubb & Kasiva; iPleaders;
// Mondaq on SaaS contracts): the person takes an active step (ticks an unticked box, then
// presses a button), the documents can be read at the moment of agreeing, the words say
// plainly that this is a binding agreement, and the record keeps who, when, which version
// and from what device. Section 10A of the IT Act 2000 makes such electronic contracts
// valid. The Privacy Policy is a notice of its own in plain language (DPDP Rules 2025,
// Rule 3), reachable inside the app and at a public web address (Google Play's User Data
// policy). The set of documents is what an Indian food-compliance software company
// publishes (TrustPlate: Privacy Policy, Terms, a Disclaimer), plus refunds, which a
// payment provider asks for, and data-processing terms for the staff data a restaurant
// puts in.

import { z } from "zod";
import { LANGUAGES, type Role } from "../roles.js";
import { DATA_PROCESSING_MD } from "./content/dataProcessing.js";
import { DISCLAIMER_MD } from "./content/disclaimer.js";
import { PRIVACY_MD } from "./content/privacy.js";
import { REFUNDS_MD } from "./content/refunds.js";
import { TERMS_MD } from "./content/terms.js";

export * from "./markdown.js";

export const LEGAL_DOCUMENT_KEYS = ["terms", "privacy", "refunds", "dataProcessing", "disclaimer"] as const;
export type LegalDocumentKey = (typeof LEGAL_DOCUMENT_KEYS)[number];

/**
 * Which tick box on the acceptance screen covers a document: "terms" is "I agree to
 * the Terms of Service" (with, for the Owner, the refund and data-processing terms);
 * "privacy" is "I have read the Privacy Policy...".
 */
export type LegalCheckbox = "terms" | "privacy";

export interface LegalDocument {
  key: LegalDocumentKey;
  /** The title, as a key of the app's dictionaries (packages/i18n). */
  titleKey: `legal.doc.${LegalDocumentKey}`;
  /** The date this wording came into force, "YYYY-MM-DD". See LEGAL_VERSION_NOTE. */
  version: string;
  /** The roles that must agree to it before using the app. */
  mustAgree: readonly Role[];
  /** Null when nobody agrees to it on its own. */
  checkbox: LegalCheckbox | null;
  /** The document itself, in the Markdown described in markdown.ts. */
  markdown: string;
}

/**
 * How versions work. Kept beside the documents so whoever edits one reads it.
 */
export const LEGAL_VERSION_NOTE =
  "A document's version is the date its wording came into force. Changing the version " +
  "asks everyone who must agree to that document to agree again at their next login " +
  "(or at once, if they are using the app): that is how a material change is made. " +
  "Correcting a typing mistake does not need a new version. Each agreement stores a " +
  "fingerprint (SHA-256) of the exact words agreed to, so keep every published wording " +
  "in git history.";

// ECCS's own staff (Super Admin, Ops Manager, Supervisor) are not asked: these are the
// customer's documents. The Owner agrees for the restaurant as a business.
export const LEGAL_DOCUMENTS: readonly LegalDocument[] = [
  {
    key: "terms",
    titleKey: "legal.doc.terms",
    version: "2026-10-14",
    mustAgree: ["OWNER", "MANAGER", "HEAD_CHEF"],
    checkbox: "terms",
    markdown: TERMS_MD,
  },
  {
    key: "privacy",
    titleKey: "legal.doc.privacy",
    version: "2026-10-14",
    mustAgree: ["OWNER", "MANAGER", "HEAD_CHEF"],
    checkbox: "privacy",
    markdown: PRIVACY_MD,
  },
  {
    key: "refunds",
    titleKey: "legal.doc.refunds",
    version: "2026-10-14",
    mustAgree: ["OWNER"],
    checkbox: "terms",
    markdown: REFUNDS_MD,
  },
  {
    key: "dataProcessing",
    titleKey: "legal.doc.dataProcessing",
    version: "2026-10-14",
    mustAgree: ["OWNER"],
    checkbox: "terms",
    markdown: DATA_PROCESSING_MD,
  },
  {
    // Part of the Terms of Service; listed so anyone can read it on its own.
    key: "disclaimer",
    titleKey: "legal.doc.disclaimer",
    version: "2026-10-14",
    mustAgree: [],
    checkbox: null,
    markdown: DISCLAIMER_MD,
  },
];

export const isLegalDocumentKey = (key: string): key is LegalDocumentKey =>
  (LEGAL_DOCUMENT_KEYS as readonly string[]).includes(key);

/** The documents a person with these roles must agree to, in the order they are listed. */
export function documentsToAccept(
  role: Role | readonly Role[],
  documents: readonly LegalDocument[] = LEGAL_DOCUMENTS,
): LegalDocument[] {
  const roles: readonly Role[] = typeof role === "string" ? [role] : role;
  return documents.filter((document) => document.mustAgree.some((needed) => roles.includes(needed)));
}

/**
 * What a person must still agree to: each document their role needs whose CURRENT
 * version they have not agreed to. An agreement to an older version does not count,
 * which is what makes a new version be asked for again.
 */
export function pendingDocuments(
  role: Role | readonly Role[],
  accepted: readonly { key: string; version: string }[],
  documents: readonly LegalDocument[] = LEGAL_DOCUMENTS,
): LegalDocument[] {
  return documentsToAccept(role, documents).filter(
    (document) => !accepted.some((done) => done.key === document.key && done.version === document.version),
  );
}

// ───────── What the API sends and takes ─────────

/** Error codes the apps react to, sent as `code` in an error response. */
export const LEGAL_ERROR = {
  /** The person has documents to agree to first. The app opens the acceptance screen. */
  notAccepted: "TERMS_NOT_ACCEPTED",
} as const;

export interface LegalDocumentDto {
  key: LegalDocumentKey;
  /** In English; the apps word the title from `key`. */
  title: string;
  version: string;
  markdown: string;
}

export interface LegalPendingDto {
  key: LegalDocumentKey;
  version: string;
  title: string;
  /** The version agreed to before, if any: then the document has changed since. */
  acceptedVersion: string | null;
}

export interface LegalAcceptedDto {
  key: LegalDocumentKey;
  version: string;
  acceptedAt: string;
  /** The day in India it was agreed, "YYYY-MM-DD". */
  acceptedOn: string;
}

export interface LegalStatusDto {
  /** What the person must agree to now, before anything else. Empty when there is nothing. */
  pending: LegalPendingDto[];
  /** The latest agreement to each document, whatever its version. */
  accepted: LegalAcceptedDto[];
}

export const acceptLegalSchema = z.object({
  /** Exactly the documents pending for the person, at their current versions. */
  documents: z
    .array(z.object({ key: z.enum(LEGAL_DOCUMENT_KEYS), version: z.string().min(1).max(20) }))
    .min(1)
    .max(LEGAL_DOCUMENT_KEYS.length),
  /** The language the app was in when they agreed. The documents themselves are in English for now. */
  language: z.enum(LANGUAGES),
  appVersion: z.string().trim().max(40).optional(),
});
export type AcceptLegalInput = z.input<typeof acceptLegalSchema>;
