import { z } from "zod";
import { AI_FEATURES, AI_OUTCOMES, AI_STATUSES, type AiFeature } from "./ai.js";
import { isEccsRole, ROLES, type Role } from "./roles.js";

// The activity log (15 Oct 2026): one row for everything that happens in the
// restaurant app, the Supervisor's app, the ECCS console, the AI and the server's
// own timed work, for the console's Logs page. Only the Super Admin and the Ops
// Manager read it.
//
// This file is the one list of what can be recorded: the sources, the areas of the
// app (categories), every action with its English label, how an answer's status
// becomes a result, and the small rules that keep private things out of the log.
//
// PRIVACY RULES (they override "record everything"):
// - Never a PIN, a one-time code, a session or device token, a password, an API key,
//   a whole request body or an uploaded file.
// - No free text people typed (messages, notes, problem reasons, SOP text,
//   comments). Short names of records (a checklist's or a service's name) are fine.
// - Checklist problems are the restaurant's own business (founder, 6 Oct 2026): a
//   hand-in may say how many items were reported as problems, never what or why.
// - Staff data is the restaurant's: staff, attendance, pay and face actions are
//   recorded with the restaurant, the outlet and who did it, never the staff
//   member's name, the times, amounts, photos or any value. Clock-ins, clock-outs
//   and face scans are not recorded at all.
// - Phone numbers only as their last four digits.

// ───────────────────────── Sources, results, clients ─────────────────────────

/** Where an event came from. PUBLIC: the customer page and other pages without a login. */
export const ACTIVITY_SOURCES = ["RESTAURANT_APP", "SUPERVISOR_APP", "CONSOLE", "SYSTEM", "PUBLIC"] as const;
export type ActivitySource = (typeof ACTIVITY_SOURCES)[number];

export const ACTIVITY_SOURCE_LABELS: Record<ActivitySource, string> = {
  RESTAURANT_APP: "Restaurant app",
  SUPERVISOR_APP: "Supervisor's app",
  CONSOLE: "ECCS console",
  SYSTEM: "Server",
  PUBLIC: "Public pages",
};

/**
 * How it ended. REFUSED: not allowed (401, 403, or too many tries, 429). REJECTED: bad
 * input or a conflict (400, 404, 409, 413, 422 and the other 4xx). FAILED: a server error.
 */
export const ACTIVITY_RESULTS = ["SUCCESS", "REFUSED", "REJECTED", "FAILED"] as const;
export type ActivityResult = (typeof ACTIVITY_RESULTS)[number];

export const ACTIVITY_RESULT_LABELS: Record<ActivityResult, string> = {
  SUCCESS: "Done",
  REFUSED: "Refused",
  REJECTED: "Rejected",
  FAILED: "Failed",
};

/** The results that count as failures for "only failures" and the summary. */
export const ACTIVITY_FAILURE_RESULTS = ["REFUSED", "REJECTED", "FAILED"] as const satisfies readonly ActivityResult[];

/** Which program sent a request: the phone app, the console, or something else (a browser, a script). */
export const ACTIVITY_CLIENTS = ["mobile", "console", "other"] as const;
export type ActivityClient = (typeof ACTIVITY_CLIENTS)[number];

/** The headers the api-client sends so the server knows which app a request is from. */
export const ACTIVITY_CLIENT_HEADER = "x-eccs-client";
export const ACTIVITY_APP_VERSION_HEADER = "x-eccs-app-version";

export const ACTIVITY_LOG_RULES = {
  /** Rows in one page of the list. */
  pageSize: 50,
  /** The most rows one page may be asked for. */
  maxPageSize: 200,
  /** The most rows in one CSV export. */
  exportMax: 10_000,
  /** "Done offline": the phone's time and the server's differ by more than this. */
  offlineMinutes: 5,
  /** How long rows are kept unless ACTIVITY_LOG_DAYS says otherwise (the Privacy Policy draft says a year). */
  keepDays: 365,
  /** The longest text kept in a detail or a record's label. */
  maxTextLength: 80,
  /** The most items kept in a list inside the details. */
  maxListLength: 12,
  /** The longest free-text search. */
  maxSearchLength: 100,
} as const;

// ───────────────────────── Categories ─────────────────────────

/** The areas of the app. Keys are stored in the database: add new ones, never rename (labels can change). */
export const ACTIVITY_CATEGORIES = {
  auth: "Logins and sessions",
  clients: "Clients and outlets",
  appLogins: "App logins and PINs",
  checklists: "Daily checklists",
  issues: "Issues and support",
  licences: "Licences and documents",
  visits: "Service visits",
  inspections: "Inspections",
  certificates: "Certificates",
  subscriptions: "Plans and subscriptions",
  billing: "Invoices and payments",
  catalogue: "Catalogue and services",
  sops: "SOPs",
  foodLabels: "Food labels",
  publicPage: "Customer page",
  vendors: "Vendors",
  scores: "Hygiene score",
  notifications: "Notifications",
  legal: "Terms and privacy",
  staff: "Staff and attendance",
  profile: "Profile",
  files: "Photos and files",
  ai: "AI",
  system: "System",
} as const;
export type ActivityCategory = keyof typeof ACTIVITY_CATEGORIES;
export const ACTIVITY_CATEGORY_KEYS = Object.keys(ACTIVITY_CATEGORIES) as ActivityCategory[];

// ───────────────────────── Actions ─────────────────────────

type ActionEntry = readonly [category: ActivityCategory, label: string];

/**
 * Every action that can be recorded, by a stable key, with its area and an English
 * label for the Logs page. Keys are stored in the database: add new ones and change
 * labels freely, but never rename or reuse a key. The label says what was done; the
 * row's result says whether it worked ("Logged in with a PIN" + Refused).
 */
export const ACTIVITY_ACTIONS = {
  // Logins and sessions
  "auth.otp.requested": ["auth", "Asked for a one-time code"],
  "auth.otp.verified": ["auth", "Logged in with a one-time code"],
  "auth.otp.wrong": ["auth", "Entered a wrong one-time code"],
  "auth.device.linked": ["auth", "Linked a phone with the restaurant code"],
  "auth.device.wrongCode": ["auth", "Typed a restaurant code that was not found"],
  "auth.pin.login": ["auth", "Logged in with a PIN"],
  "auth.pin.wrong": ["auth", "Entered a wrong PIN"],
  "auth.pin.whileLocked": ["auth", "Tried a PIN while the phone was locked"],
  "auth.pin.locked": ["auth", "Phone locked after too many wrong PINs"],
  "auth.session.loggedOut": ["auth", "Logged out"],
  "auth.session.locked": ["auth", "Locked the phone (back to the PIN pad)"],
  "auth.access.refused": ["auth", "Was refused a page"],

  // Clients and outlets
  "clients.client.added": ["clients", "Added a client"],
  "clients.client.changed": ["clients", "Changed a client's details"],
  "clients.outlet.added": ["clients", "Added an outlet"],
  "clients.outlet.changed": ["clients", "Changed an outlet's details"],
  "clients.outlet.newCode": ["clients", "Made a new restaurant code"],
  "clients.phone.unlinked": ["clients", "Unlinked a phone"],
  "clients.owner.changed": ["clients", "Changed an Owner's details"],
  "clients.owner.setupReset": ["clients", "Reset an Owner's PIN set-up"],

  // App logins and PINs
  "appLogins.user.added": ["appLogins", "Added an app login"],
  "appLogins.user.changed": ["appLogins", "Changed an app login"],
  "appLogins.pin.reset": ["appLogins", "Gave someone a new PIN"],

  // Daily checklists
  "checklists.item.answered": ["checklists", "Answered a checklist item"],
  "checklists.item.cleared": ["checklists", "Took back a tick"],
  "checklists.photo.checked": ["checklists", "Had a proof photo checked"],
  "checklists.run.submitted": ["checklists", "Handed in a checklist"],
  "checklists.run.reviewed": ["checklists", "Marked a checklist as reviewed"],
  "checklists.list.added": ["checklists", "Added a checklist"],
  "checklists.list.changed": ["checklists", "Changed a checklist's name or due time"],
  "checklists.list.removed": ["checklists", "Removed a checklist"],
  "checklists.setupItem.added": ["checklists", "Added an item to a checklist"],
  "checklists.setupItem.changed": ["checklists", "Changed a checklist item"],
  "checklists.setupItem.removed": ["checklists", "Removed an item from a checklist"],

  // Issues and support
  "issues.issue.raised": ["issues", "Raised an issue"],
  "issues.comment.added": ["issues", "Wrote in an issue"],
  "issues.issue.statusChanged": ["issues", "Changed an issue's status"],
  "issues.thread.translated": ["issues", "Had an issue thread translated"],

  // Licences and documents
  "licences.licence.added": ["licences", "Added a licence"],
  "licences.licence.changed": ["licences", "Changed or renewed a licence"],
  "licences.licence.removed": ["licences", "Removed a licence"],
  "licences.document.read": ["licences", "Had a licence read into the form"],
  "licences.document.added": ["licences", "Added a document"],
  "licences.document.removed": ["licences", "Removed a document"],

  // Service visits
  "visits.booking.requested": ["visits", "Booked a service"],
  "visits.booking.confirmed": ["visits", "Confirmed a booking"],
  "visits.booking.cancelled": ["visits", "Cancelled a booking"],
  "visits.visit.added": ["visits", "Put a visit in the diary"],
  "visits.visit.changed": ["visits", "Moved or reassigned a visit"],
  "visits.visit.cancelled": ["visits", "Cancelled a visit"],
  "visits.visit.checkedIn": ["visits", "Checked in at a visit"],
  "visits.task.answered": ["visits", "Answered a visit task"],
  "visits.record.changed": ["visits", "Updated a visit's team and notes"],
  "visits.photo.added": ["visits", "Added a photo to a visit"],
  "visits.photo.removed": ["visits", "Removed a photo from a visit"],
  "visits.outletPlace.saved": ["visits", "Saved the outlet's location during a visit"],
  "visits.document.added": ["visits", "Attached a result document to a visit"],
  "visits.document.removed": ["visits", "Removed a result document from a visit"],
  "visits.visit.finished": ["visits", "Finished a visit"],
  "visits.visit.signedOff": ["visits", "Signed off a visit"],
  "visits.report.approved": ["visits", "Approved a service report"],
  "visits.report.returned": ["visits", "Sent a service report back"],
  "visits.report.opened": ["visits", "Opened a service report PDF"],
  "visits.diary.filled": ["visits", "Filled the diary from plans"],
  "visits.plans.ran": ["visits", "Added plan visits to the diary (timed job)"],

  // Inspections
  "inspections.inspection.started": ["inspections", "Started an inspection"],
  "inspections.inspection.changed": ["inspections", "Moved or reassigned an inspection"],
  "inspections.inspection.removed": ["inspections", "Removed an inspection"],
  "inspections.check.answered": ["inspections", "Answered an inspection check"],
  "inspections.photo.added": ["inspections", "Added a photo to an inspection check"],
  "inspections.photo.removed": ["inspections", "Removed a photo from an inspection"],
  "inspections.inspection.finished": ["inspections", "Finished an inspection"],
  "inspections.summary.drafted": ["inspections", "Asked for an AI draft of the summary"],
  "inspections.summary.saved": ["inspections", "Saved an inspection summary"],
  "inspections.inspection.approved": ["inspections", "Approved an inspection report"],
  "inspections.inspection.sentBack": ["inspections", "Sent an inspection back"],
  "inspections.report.opened": ["inspections", "Opened an inspection report PDF"],

  // Certificates
  "certificates.certificate.issued": ["certificates", "Issued a certificate"],
  "certificates.pdf.opened": ["certificates", "Opened a certificate PDF"],
  "certificates.pdf.remade": ["certificates", "Made a certificate PDF again"],

  // Plans and subscriptions
  "subscriptions.plan.added": ["subscriptions", "Added a plan"],
  "subscriptions.plan.changed": ["subscriptions", "Changed a plan"],
  "subscriptions.subscription.started": ["subscriptions", "Started a subscription"],
  "subscriptions.subscription.planChanged": ["subscriptions", "Changed plan from the next cycle"],
  "subscriptions.subscription.planChangeUndone": ["subscriptions", "Undid a plan change"],
  "subscriptions.subscription.paused": ["subscriptions", "Paused a subscription"],
  "subscriptions.subscription.resumed": ["subscriptions", "Resumed a subscription"],
  "subscriptions.subscription.cancelled": ["subscriptions", "Cancelled a subscription"],
  "subscriptions.subscription.kept": ["subscriptions", "Undid a cancellation"],
  "subscriptions.outletPlan.set": ["subscriptions", "Put an outlet on a plan (older screen)"],
  "subscriptions.outletPlan.stopped": ["subscriptions", "Took an outlet off its plan (older screen)"],
  "subscriptions.renewals.ran": ["subscriptions", "Renewed subscriptions (timed job)"],

  // Invoices and payments
  "billing.invoice.issued": ["billing", "Issued an invoice"],
  "billing.invoice.opened": ["billing", "Opened an invoice PDF"],
  "billing.invoice.voided": ["billing", "Made an invoice void"],
  "billing.invoice.raisedAgain": ["billing", "Raised an invoice again after a void"],
  "billing.invoices.raisedDue": ["billing", "Raised the invoices that were due"],
  "billing.payment.started": ["billing", "Started paying an invoice"],
  "billing.payment.confirmed": ["billing", "Reported how a payment ended"],
  "billing.payment.recorded": ["billing", "Recorded a payment received outside the app"],
  "billing.run.ran": ["billing", "Raised plan invoices (timed job)"],

  // Catalogue and services
  "catalogue.item.added": ["catalogue", "Added a bookable service"],
  "catalogue.item.changed": ["catalogue", "Changed a bookable service"],
  "catalogue.kind.added": ["catalogue", "Added a kind of service"],
  "catalogue.kind.changed": ["catalogue", "Changed a kind of service"],
  "catalogue.task.added": ["catalogue", "Added a task to a kind of service"],
  "catalogue.task.changed": ["catalogue", "Changed a service task"],
  "catalogue.task.moved": ["catalogue", "Moved a service task"],

  // SOPs
  "sops.sop.added": ["sops", "Wrote an SOP"],
  "sops.sop.copiedFromLibrary": ["sops", "Added an SOP from the library"],
  "sops.sop.changed": ["sops", "Changed an SOP"],
  "sops.sop.removed": ["sops", "Removed an SOP"],

  // Food labels
  "foodLabels.item.added": ["foodLabels", "Saved a new label"],
  "foodLabels.item.changed": ["foodLabels", "Changed a saved label"],
  "foodLabels.item.removed": ["foodLabels", "Removed a saved label"],
  "foodLabels.label.printed": ["foodLabels", "Printed labels"],
  "foodLabels.label.sent": ["foodLabels", "Sent labels to a printer or shared them"],
  "foodLabels.label.drawn": ["foodLabels", "Drew a label picture for a printer app"],

  // Customer page
  "publicPage.page.opened": ["publicPage", "Opened a customer page"],
  "publicPage.photo.opened": ["publicPage", "Opened a photo on a customer page"],
  "publicPage.page.switched": ["publicPage", "Switched the customer page on or off"],
  "publicPage.page.newLink": ["publicPage", "Made a new customer page link"],
  "publicPage.page.takenDown": ["publicPage", "Took a customer page down"],
  "publicPage.page.restored": ["publicPage", "Put a customer page back up"],
  "publicPage.photo.proposed": ["publicPage", "Put a visit photo forward for the customer page"],
  "publicPage.photo.proposedFromCheck": ["publicPage", "Put a daily-check photo forward for the customer page"],
  "publicPage.photo.taken": ["publicPage", "Took a photo for the customer page"],
  "publicPage.photo.approved": ["publicPage", "Approved a customer page photo"],
  "publicPage.photo.rejected": ["publicPage", "Turned down a customer page photo"],
  "publicPage.photo.removed": ["publicPage", "Took a photo off the customer page"],

  // Hygiene score
  "scores.score.explained": ["scores", "Asked “Why this score?”"],
  "scores.recalculation.ran": ["scores", "Worked out the hygiene scores (timed job)"],

  // Notifications
  "notifications.sent": ["notifications", "Sent a notification"],
  "notifications.one.read": ["notifications", "Marked a notification as read"],
  "notifications.all.read": ["notifications", "Marked all notifications as read"],
  "notifications.push.registered": ["notifications", "Turned on push notifications on a phone"],
  "notifications.push.unregistered": ["notifications", "Turned off push notifications on a phone"],
  "notifications.push.tested": ["notifications", "Sent a test push notification"],
  "notifications.push.failed": ["notifications", "Push notifications not delivered"],
  "notifications.reminders.ran": ["notifications", "Sent reminders (timed job)"],

  // Terms and privacy
  "legal.terms.accepted": ["legal", "Agreed to the terms and privacy policy"],
  "legal.document.opened": ["legal", "Opened a legal document"],
  "legal.documents.listed": ["legal", "Opened the list of legal documents"],

  // Staff and attendance: never a staff member's name, times, amounts, photos or values.
  "staff.person.added": ["staff", "Added a staff member"],
  "staff.person.changed": ["staff", "Changed a staff member's details"],
  "staff.person.removed": ["staff", "Removed a staff member added by mistake"],
  "staff.attendance.marked": ["staff", "Set a day's attendance for the team"],
  "staff.attendance.corrected": ["staff", "Corrected a person's day"],
  "staff.punch.added": ["staff", "Added a missing clock-in or clock-out"],
  "staff.punch.voided": ["staff", "Struck out a wrong clock-in or clock-out"],
  "staff.punch.reviewed": ["staff", "Let a marked clock-in stand"],
  "staff.settings.changed": ["staff", "Changed the attendance settings"],
  "staff.pay.saved": ["staff", "Saved a month's pay figures"],
  "staff.pay.entryAdded": ["staff", "Recorded an advance or payment"],
  "staff.pay.entryRemoved": ["staff", "Removed an advance or payment"],
  "staff.face.added": ["staff", "Added a staff member's face"],
  "staff.face.removed": ["staff", "Removed a staff member's face"],
  "staff.days.settled": ["staff", "Settled ended attendance days (timed job)"],
  // Never written: the routes carry a key so none goes unlabelled, but clock-ins,
  // clock-outs and face scans are each employee's attendance, not ECCS's business.
  "staff.clock.identified": ["staff", "Face scanned at the clock (never recorded)"],
  "staff.clock.confirmed": ["staff", "Clocked in or out (never recorded)"],
  "staff.clock.assisted": ["staff", "Clocked in or out with a PIN (never recorded)"],

  // Profile
  "profile.details.changed": ["profile", "Changed their name or language"],
  "profile.photo.set": ["profile", "Changed their profile photo"],
  "profile.photo.removed": ["profile", "Removed their profile photo"],

  // Photos and files
  "files.upload.added": ["files", "Uploaded a photo or file"],
  "files.document.opened": ["files", "Opened a document by its link"],
  "files.punchPhotos.cleaned": ["files", "Deleted old clock-in photos (timed job)"],

  // AI: one row for every request to the AI, and the person's answer to it.
  "ai.request.licenceReader": ["ai", "AI read a licence document"],
  "ai.request.translateSupport": ["ai", "AI translated support messages"],
  "ai.request.translateContent": ["ai", "AI translated the restaurant's own text"],
  "ai.request.explainScore": ["ai", "AI explained a hygiene score"],
  "ai.request.monitoringDigest": ["ai", "AI wrote the Monitoring digest"],
  "ai.request.inspectionSummary": ["ai", "AI drafted an inspection summary"],
  "ai.request.photoCheck": ["ai", "AI checked a proof photo"],
  "ai.digest.updated": ["ai", "Asked for a fresh Monitoring digest"],
  "ai.outcome.recorded": ["ai", "Said what they did with an AI answer"],

  // System
  "system.server.started": ["system", "The server started"],
  "system.request.failed": ["system", "A page failed with a server error"],
  "system.logs.exported": ["system", "Exported the activity log"],
  "system.logs.pruned": ["system", "Deleted log entries older than the keeping period"],
} as const satisfies Record<string, ActionEntry>;

export type ActivityAction = keyof typeof ACTIVITY_ACTIONS;
export const ACTIVITY_ACTION_KEYS = Object.keys(ACTIVITY_ACTIONS) as ActivityAction[];

/** The AI log row's action for each AI feature. */
export const AI_FEATURE_ACTIONS: Record<AiFeature, ActivityAction> = {
  "licence-reader": "ai.request.licenceReader",
  "translate-support": "ai.request.translateSupport",
  "translate-content": "ai.request.translateContent",
  "explain-score": "ai.request.explainScore",
  "monitoring-digest": "ai.request.monitoringDigest",
  "inspection-summary": "ai.request.inspectionSummary",
  "photo-check": "ai.request.photoCheck",
};

export const isActivityAction = (key: string): key is ActivityAction => Object.hasOwn(ACTIVITY_ACTIONS, key);
export const isActivityCategory = (key: string): key is ActivityCategory => Object.hasOwn(ACTIVITY_CATEGORIES, key);

/**
 * The English label of an action. A key this version does not know (written by a
 * newer server, or removed since) is shown as readable words rather than failing.
 */
export function activityActionLabel(key: string): string {
  if (isActivityAction(key)) return ACTIVITY_ACTIONS[key][1];
  const words = key
    .split(".")
    .slice(1)
    .join(" ")
    .replace(/([a-z])([A-Z])/g, "$1 $2")
    .toLowerCase()
    .trim();
  return words ? words[0]!.toUpperCase() + words.slice(1) : key;
}

/** The area an action belongs to; "system" for a key this version does not know. */
export function activityCategoryOf(key: string): ActivityCategory {
  if (isActivityAction(key)) return ACTIVITY_ACTIONS[key][0];
  const first = key.split(".")[0] ?? "";
  return isActivityCategory(first) ? first : "system";
}

export function activityCategoryLabel(key: string): string {
  return isActivityCategory(key) ? ACTIVITY_CATEGORIES[key] : key;
}

/** Action keys whose label contains the search words, for free-text search. */
export function actionsMatching(search: string): ActivityAction[] {
  const words = search.trim().toLowerCase();
  if (!words) return [];
  return ACTIVITY_ACTION_KEYS.filter((key) => ACTIVITY_ACTIONS[key][1].toLowerCase().includes(words) || key.toLowerCase().includes(words));
}

/** How an HTTP status becomes a result. A request that never got an answer counts as failed. */
export function activityResultFor(statusCode: number | null | undefined): ActivityResult {
  if (!statusCode || statusCode >= 500) return "FAILED";
  if (statusCode < 400) return "SUCCESS";
  if (statusCode === 401 || statusCode === 403 || statusCode === 429) return "REFUSED";
  return "REJECTED";
}

// ───────────────────────── Who and where from ─────────────────────────

const ROLE_ORDER: readonly Role[] = ["SUPER_ADMIN", "OPS_MANAGER", "SUPERVISOR", "OWNER", "MANAGER", "HEAD_CHEF"];

/** The role a person is shown under when they hold several: the highest. */
export function mainRole(roles: readonly Role[]): Role | null {
  return ROLE_ORDER.find((role) => roles.includes(role)) ?? null;
}

export const ROLE_LABELS: Record<Role, string> = {
  SUPER_ADMIN: "Super Admin",
  OPS_MANAGER: "Ops Manager",
  SUPERVISOR: "Supervisor",
  OWNER: "Owner",
  MANAGER: "Manager",
  HEAD_CHEF: "Head Chef",
};

/**
 * Which program sent a request. The apps say so in the X-ECCS-Client header. Until
 * every phone has an APK that sends it, the browser's own User-Agent decides: a
 * browser means the console (or the app's browser preview), the phone's own network
 * library means the app, anything else is "other".
 */
export function activityClientFrom(header: string | null | undefined, userAgent: string | null | undefined): ActivityClient {
  const said = (header ?? "").trim().toLowerCase();
  if (said === "mobile" || said === "console") return said;
  const agent = userAgent ?? "";
  if (/okhttp|Dalvik|CFNetwork|Expo|ReactNative|React-Native/i.test(agent)) return "mobile";
  if (/Mozilla\//.test(agent)) return "console";
  return "other";
}

/**
 * Where an event came from. A restaurant role is always the restaurant app (restaurants
 * have no console). An ECCS role on the phone is the Supervisor's app, in the console
 * the console. Without a known person: what the route or the server says (`side`),
 * else the program that sent it, and a request from neither app is PUBLIC.
 */
export function activitySource(input: {
  role: Role | null;
  client: ActivityClient;
  /** Without a person: "restaurant" (PIN screens), "eccs" (an ECCS staff phone number), "public" (the customer and legal pages). */
  side?: "restaurant" | "eccs" | "public" | null;
}): ActivitySource {
  const { role, client, side } = input;
  if (role) {
    if (!isEccsRole(role)) return "RESTAURANT_APP";
    if (client === "mobile") return "SUPERVISOR_APP";
    if (client === "console") return "CONSOLE";
    return role === "SUPERVISOR" ? "SUPERVISOR_APP" : "CONSOLE";
  }
  if (side === "public") return "PUBLIC";
  if (client === "console") return "CONSOLE";
  if (side === "restaurant") return "RESTAURANT_APP";
  if (side === "eccs") return client === "mobile" ? "SUPERVISOR_APP" : "CONSOLE";
  if (client === "mobile") return "RESTAURANT_APP";
  return "PUBLIC";
}

/** A phone number as its last four digits only, e.g. "…4321". Never more. */
export function maskPhone(phone: string | null | undefined): string | null {
  const digits = (phone ?? "").replace(/\D/g, "");
  if (digits.length < 4) return null;
  return `…${digits.slice(-4)}`;
}

/** "Done offline": sent later from the phone's outbox, the phone's time more than five minutes from the server's. */
export function isOfflineEntry(at: Date, phoneAt: Date | null | undefined): boolean {
  if (!phoneAt) return false;
  return Math.abs(at.getTime() - phoneAt.getTime()) > ACTIVITY_LOG_RULES.offlineMinutes * 60_000;
}

// ───────────────────────── Keeping secrets and free text out ─────────────────────────

/**
 * Detail names that are never kept, whatever the value: secrets of every kind and the
 * fields people type freely into. Matched against the name with case and punctuation
 * ignored, as a whole word or a word part ("deviceToken", "approver_pin", "note").
 */
const FORBIDDEN_DETAIL_PARTS = [
  "pin",
  "otp",
  "code",
  "token",
  "password",
  "passcode",
  "secret",
  "key",
  "signature",
  "sig",
  "authorization",
  "cookie",
  "session",
  "note",
  "notes",
  "reason",
  "message",
  "body",
  "text",
  "comment",
  "comments",
  "description",
  "steps",
  "summary",
  "photo",
  "photos",
  "file",
  "files",
  "image",
  "buffer",
  "phone",
  "email",
  "address",
  "name",
  "names",
  "salary",
] as const;

/** Detail names that end in an allowed word although a part above would bar them. */
const ALLOWED_DETAIL_NAMES = new Set([
  "plancode",
  "servicecode",
  "statuscode",
  "errorcode",
  "phonelast4",
  "planname",
  "servicename",
  "kindname",
  "documentkeys",
  "documents",
  "keys",
  "changed",
]);

/** True when a detail with this name may never be kept (see FORBIDDEN_DETAIL_PARTS). */
export function isForbiddenDetailName(name: string): boolean {
  const flat = name.replace(/[^a-zA-Z0-9]/g, "").toLowerCase();
  if (ALLOWED_DETAIL_NAMES.has(flat)) return false;
  const words = name
    .replace(/([a-z0-9])([A-Z])/g, "$1 $2")
    .split(/[^a-zA-Z0-9]+/)
    .map((word) => word.toLowerCase())
    .filter(Boolean);
  return words.some((word) => (FORBIDDEN_DETAIL_PARTS as readonly string[]).includes(word));
}

export type ActivityDetailValue = string | number | boolean | null | string[];
export type ActivityDetails = Record<string, ActivityDetailValue>;

/**
 * Keeps only safe facts: names that are not barred, and values that are numbers, true
 * or false, short text (cut to 80 characters) or short lists of short text. Nested
 * objects, long lists and anything else are dropped. Returns null when nothing is left.
 */
export function safeDetails(input: Record<string, unknown> | null | undefined): ActivityDetails | null {
  if (!input) return null;
  const out: ActivityDetails = {};
  for (const [name, value] of Object.entries(input)) {
    if (isForbiddenDetailName(name)) continue;
    const kept = safeValue(value);
    if (kept !== undefined) out[name] = kept;
  }
  return Object.keys(out).length > 0 ? out : null;
}

function safeValue(value: unknown): ActivityDetailValue | undefined {
  if (value === null) return null;
  if (typeof value === "boolean") return value;
  if (typeof value === "number") return Number.isFinite(value) ? value : undefined;
  if (typeof value === "string") return shortText(value);
  if (Array.isArray(value)) {
    const items = value.filter((item): item is string | number => typeof item === "string" || typeof item === "number");
    if (items.length !== value.length || items.length > ACTIVITY_LOG_RULES.maxListLength) return undefined;
    return items.map((item) => shortText(String(item)));
  }
  return undefined;
}

/** Text cut to the longest kept, on one line. */
export function shortText(value: string, max: number = ACTIVITY_LOG_RULES.maxTextLength): string {
  const flat = value.replace(/\s+/g, " ").trim();
  return flat.length > max ? `${flat.slice(0, max - 1)}…` : flat;
}

/**
 * A value from a request body that may be kept as a fact: a short code (letters,
 * digits, "_" and "-", at most 40), a number, or true or false. Free text never passes.
 */
export function isSafeFactValue(value: unknown): value is string | number | boolean {
  if (typeof value === "boolean") return true;
  if (typeof value === "number") return Number.isFinite(value);
  return typeof value === "string" && /^[A-Za-z0-9_-]{1,40}$/.test(value);
}

// ───────────────────────── Reading the log ─────────────────────────

/** "a,b" or ["a","b"] or ["a,b","c"] → ["a","b","c"]; nothing → undefined. */
const listParam = <T extends z.ZodType<string, string>>(item: T) =>
  z
    .union([z.string(), z.array(z.string())])
    .optional()
    .transform((value) =>
      value === undefined
        ? []
        : (Array.isArray(value) ? value : [value])
            .flatMap((entry) => entry.split(","))
            .map((entry) => entry.trim())
            .filter(Boolean),
    )
    .pipe(z.array(item).max(100))
    .transform((list) => (list.length > 0 ? list : undefined));

const flag = z
  .union([z.literal("1"), z.literal("true"), z.literal("0"), z.literal("false"), z.literal("")])
  .optional()
  .transform((value) => value === "1" || value === "true");

const text = (max: number) =>
  z
    .string()
    .trim()
    .max(max)
    .optional()
    .transform((value) => (value ? value : undefined));

/** A moment: a full ISO date-time, or a day "YYYY-MM-DD" (India time; the start of it for `from`, its end for `to`). */
const moment = (end: boolean) =>
  z
    .string()
    .trim()
    .optional()
    .transform((value, context) => {
      if (!value) return undefined;
      if (/^\d{4}-\d{2}-\d{2}$/.test(value)) {
        const start = new Date(`${value}T00:00:00.000+05:30`);
        if (Number.isNaN(start.getTime())) {
          context.addIssue({ code: "custom", message: "Not a date" });
          return z.NEVER;
        }
        return end ? new Date(start.getTime() + 86_400_000 - 1) : start;
      }
      const parsed = new Date(value);
      if (Number.isNaN(parsed.getTime()) || !/^\d{4}-\d{2}-\d{2}T/.test(value)) {
        context.addIssue({ code: "custom", message: "Not a date or time" });
        return z.NEVER;
      }
      return parsed;
    });

/**
 * The filters of the Logs page, all optional and combinable, as query parameters.
 * Lists take "a,b" or the parameter repeated. See the reading API in the activity-log
 * module of the API for what each does.
 */
export const activityLogQuerySchema = z.object({
  from: moment(false),
  to: moment(true),
  source: listParam(z.enum(ACTIVITY_SOURCES)),
  organizationId: listParam(z.string().max(64)),
  outletId: listParam(z.string().max(64)),
  actorUserId: listParam(z.string().max(64)),
  role: listParam(z.enum(ROLES)),
  category: listParam(z.enum(ACTIVITY_CATEGORY_KEYS as [ActivityCategory, ...ActivityCategory[]])),
  action: listParam(z.string().max(80)),
  result: listParam(z.enum(ACTIVITY_RESULTS)),
  failuresOnly: flag,
  entityType: text(40),
  entityId: text(64),
  reference: text(60),
  ip: text(64),
  deviceId: text(64),
  client: listParam(z.enum(ACTIVITY_CLIENTS)),
  requestId: text(64),
  offline: flag,
  aiFeature: listParam(z.enum(AI_FEATURES)),
  aiModel: listParam(z.string().max(60)),
  aiStatus: listParam(z.enum(AI_STATUSES)),
  aiOutcome: listParam(z.enum(AI_OUTCOMES)),
  q: text(ACTIVITY_LOG_RULES.maxSearchLength),
  cursor: text(200),
  limit: z.coerce.number().int().min(1).max(ACTIVITY_LOG_RULES.maxPageSize).optional(),
});
export type ActivityLogQuery = z.output<typeof activityLogQuerySchema>;
/** The same filters as the console sends them (strings). */
export type ActivityLogQueryInput = z.input<typeof activityLogQuerySchema>;

/** The AI facts of an AI row. */
export interface ActivityAiDto {
  feature: string;
  model: string | null;
  status: string | null;
  outcome: string | null;
  costUsd: number;
}

/** One row of the log, as the console reads it. */
export interface ActivityLogEntryDto {
  id: string;
  /** The server's time, ISO. */
  at: string;
  /** When the phone says it happened (work sent later from the offline outbox); null otherwise. */
  phoneAt: string | null;
  /** The phone's time and the server's differ by more than five minutes. */
  offline: boolean;
  source: ActivitySource;
  sourceLabel: string;
  actorUserId: string | null;
  actorName: string | null;
  actorRole: Role | null;
  actorRoleLabel: string | null;
  organizationId: string | null;
  organizationName: string | null;
  outletId: string | null;
  outletName: string | null;
  category: string;
  categoryLabel: string;
  action: string;
  actionLabel: string;
  entityType: string | null;
  entityId: string | null;
  /** A short safe name of the record: a checklist's or service's name, a licence type. */
  entityLabel: string | null;
  /** The record's own reference: ECCS-0042, IR-2026-00012, an invoice or certificate number. */
  reference: string | null;
  result: ActivityResult;
  resultLabel: string;
  method: string | null;
  /** The route's pattern, e.g. "/checklists/runs/:runId/submit". */
  route: string | null;
  statusCode: number | null;
  durationMs: number | null;
  /** Safe facts chosen per action (a status, a count, a rating, an amount). */
  details: ActivityDetails | null;
  ip: string | null;
  deviceId: string | null;
  client: ActivityClient | null;
  appVersion: string | null;
  requestId: string | null;
  ai: ActivityAiDto | null;
}

export interface ActivityLogPageDto {
  entries: ActivityLogEntryDto[];
  /** Pass as `cursor` for the next (older) page; null on the last page. */
  nextCursor: string | null;
}

/** One event in full, with the other rows written for the same request (the AI request of a licence read, an invoice the server issued). */
export interface ActivityLogEventDto extends ActivityLogEntryDto {
  related: ActivityLogEntryDto[];
}

/** One choice in a filter menu, with how many rows have it under the other filters. */
export interface ActivityFacetOption {
  value: string;
  label: string;
  count: number;
}
export interface ActivityOutletFacetOption extends ActivityFacetOption {
  organizationId: string | null;
  organizationName: string | null;
}
export interface ActivityPersonFacetOption extends ActivityFacetOption {
  role: Role | null;
}
export interface ActivityActionFacetOption extends ActivityFacetOption {
  category: string;
}

export interface ActivityLogFacetsDto {
  sources: ActivityFacetOption[];
  results: ActivityFacetOption[];
  categories: ActivityFacetOption[];
  actions: ActivityActionFacetOption[];
  roles: ActivityFacetOption[];
  organizations: ActivityFacetOption[];
  outlets: ActivityOutletFacetOption[];
  people: ActivityPersonFacetOption[];
  clients: ActivityFacetOption[];
  entityTypes: ActivityFacetOption[];
  aiFeatures: ActivityFacetOption[];
  aiModels: ActivityFacetOption[];
  aiStatuses: ActivityFacetOption[];
  aiOutcomes: ActivityFacetOption[];
}

export interface ActivityLogSummaryDto {
  events: number;
  /** Refused, rejected and failed together. */
  failures: number;
  refused: number;
  rejected: number;
  failed: number;
  /** Different people. */
  people: number;
  organizations: number;
  outlets: number;
  offline: number;
  aiCalls: number;
  aiCostUsd: number;
}

/** The names of the kinds of record a row can be about, for the Logs page. */
export const ACTIVITY_ENTITY_LABELS: Record<string, string> = {
  aiRequest: "AI request",
  attachment: "Photo or file",
  booking: "Booking",
  catalogItem: "Bookable service",
  certificate: "Certificate",
  checklistItem: "Checklist item",
  checklistRun: "Daily checklist",
  document: "Document",
  foodItem: "Saved label",
  foodLabel: "Label printing",
  inspection: "Inspection",
  invoice: "Invoice",
  issue: "Issue",
  licence: "Licence",
  linkedDevice: "Linked phone",
  notification: "Notification",
  organization: "Client",
  outlet: "Outlet",
  outletChecklist: "Checklist",
  payment: "Payment",
  plan: "Plan",
  publicPhoto: "Customer page photo",
  serviceKind: "Kind of service",
  serviceTask: "Service task",
  sop: "SOP",
  sopLibraryItem: "Library SOP",
  user: "App login",
  visit: "Service visit",
};
