// Notifications: messages the platform sends a person without them asking.
// The register of all of them is docs/NOTIFICATIONS.md.
//
// A notification is stored as a `type` (what happened) and `data` (the names,
// dates and numbers that go into the wording, and where tapping it leads). It
// is not stored as a finished sentence, so each person reads it in the language
// their app is in now. The server also keeps the English wording (`title`,
// `body`) for the console and as a fallback.

import type { LocalizedText } from "./checklists.js";
import type { IssueCategory } from "./issues.js";
import type { VisitSlot } from "./services.js";

/**
 * What goes into the wording of each kind of notification. The comment gives
 * its number in docs/NOTIFICATIONS.md. The app's language files hold one title
 * and one body per kind: "notif.<TYPE>.title" and "notif.<TYPE>.body".
 *
 * Names of values are a convention the wording relies on (see
 * `notificationWordingParams`): `service`, `checklist`, `item` and `plan` are
 * names kept in several languages; `date` is a YYYY-MM-DD date; `slot` is a
 * visit's arrival window and is written into the wording as {time};
 * `category` is an issue category.
 */
export interface NotificationParamsByType {
  /** S1: ECCS approved a signed-off report, so its PDF is ready. */
  REPORT_READY: { outlet: string; service: LocalizedText; reportNumber: string };
  /** S2: a restaurant sent a booking request. */
  BOOKING_REQUESTED: { outlet: string; service: LocalizedText; date: string; slot: VisitSlot | null };
  /** S3: ECCS confirmed a request. */
  BOOKING_CONFIRMED: { outlet: string; service: LocalizedText; date: string; slot: VisitSlot | null };
  /** S4: ECCS turned a request down. */
  BOOKING_DECLINED: { outlet: string; service: LocalizedText; date: string };
  /** S5: ECCS moved a visit to another day or time. */
  VISIT_MOVED: { outlet: string; service: LocalizedText; date: string; slot: VisitSlot | null };
  /** S6: ECCS cancelled a visit. */
  VISIT_CANCELLED: { outlet: string; service: LocalizedText; date: string };
  /** S7: a visit was given to a Supervisor. */
  VISIT_ASSIGNED: { outlet: string; service: LocalizedText; date: string; slot: VisitSlot | null };
  /** S7: a visit was taken away from a Supervisor. */
  VISIT_UNASSIGNED: { outlet: string; service: LocalizedText; date: string };
  /** S8: the day before a visit. */
  VISIT_TOMORROW: { outlet: string; service: LocalizedText; date: string; slot: VisitSlot | null };
  /** S10: the Supervisor checked in at the outlet. */
  VISIT_STARTED: { outlet: string; service: LocalizedText };
  /** S11: the Supervisor finished; the restaurant is to check and sign off. */
  VISIT_FINISHED: { outlet: string; service: LocalizedText };
  /** S12: a finished visit is still not signed off after a day. */
  SIGN_OFF_WAITING: { outlet: string; service: LocalizedText; date: string };
  /** S13: the restaurant signed off. */
  VISIT_SIGNED_OFF: { outlet: string; service: LocalizedText; stars: number };
  /** S14: the restaurant gave one or two stars. */
  VISIT_LOW_RATING: { outlet: string; service: LocalizedText; stars: number; comment: string };
  /** S15: ECCS sent a report back to the Supervisor for correction. */
  REPORT_RETURNED: { outlet: string; service: LocalizedText; note: string };
  /** S16: a visit's day passed and it was never started. */
  VISIT_NOT_DONE: { outlet: string; service: LocalizedText; date: string };
  /** S18: plan visits were added to the diary without a Supervisor. */
  PLAN_VISITS_UNASSIGNED: { count: number };
  /** S19: an outlet was put on a plan, or its plan was changed. */
  PLAN_STARTED: { outlet: string; plan: LocalizedText; date: string };
  /** S19: an outlet's plan was stopped. */
  PLAN_ENDED: { outlet: string; plan: LocalizedText };
  /** C2: a checklist's due time passed and it is not submitted. */
  CHECKLIST_OVERDUE: { outlet: string; checklist: LocalizedText };
  /** C3: a checklist was submitted with a problem reported. */
  CHECKLIST_PROBLEM: { outlet: string; name: string; checklist: LocalizedText; item: LocalizedText };
  /** C4: a day ended with a checklist not submitted. */
  CHECKLIST_MISSED: { outlet: string; checklist: LocalizedText; date: string };
  /** I1: a restaurant raised an issue. */
  ISSUE_RAISED: { outlet: string; reference: string; category: IssueCategory; excerpt: string };
  /** I2: ECCS replied on an issue. */
  ISSUE_REPLY_ECCS: { outlet: string; reference: string; excerpt: string };
  /** I3: the restaurant replied on an issue. */
  ISSUE_REPLY_RESTAURANT: { outlet: string; reference: string; excerpt: string };
  /** I4: ECCS marked an issue in progress. */
  ISSUE_IN_PROGRESS: { outlet: string; reference: string };
  /** I4: ECCS marked an issue resolved. */
  ISSUE_RESOLVED: { outlet: string; reference: string };
  /** I5: the restaurant closed an issue. */
  ISSUE_CLOSED: { outlet: string; reference: string };
  /** I5: the restaurant reopened an issue. */
  ISSUE_REOPENED: { outlet: string; reference: string };
  /** L1: a licence expires soon. `days` is how many days are left. */
  LICENCE_EXPIRING: { outlet: string; licence: string; date: string; days: number };
  /** L2: a licence has expired. */
  LICENCE_EXPIRED: { outlet: string; licence: string; date: string };
  /** L3: ECCS added or replaced a licence or document for the outlet. */
  DOCUMENT_ADDED: { outlet: string; title: string };
  /** A1: a new phone was linked with the outlet's restaurant code. */
  DEVICE_LINKED: { outlet: string };
  /** A2: a phone was locked after five wrong PINs. */
  PIN_LOCKED: { outlet: string };
}

export type NotificationType = keyof NotificationParamsByType;

// Written out so the list also exists when the program runs; the compiler checks it is complete.
const TYPE_LIST: Record<NotificationType, true> = {
  REPORT_READY: true,
  BOOKING_REQUESTED: true,
  BOOKING_CONFIRMED: true,
  BOOKING_DECLINED: true,
  VISIT_MOVED: true,
  VISIT_CANCELLED: true,
  VISIT_ASSIGNED: true,
  VISIT_UNASSIGNED: true,
  VISIT_TOMORROW: true,
  VISIT_STARTED: true,
  VISIT_FINISHED: true,
  SIGN_OFF_WAITING: true,
  VISIT_SIGNED_OFF: true,
  VISIT_LOW_RATING: true,
  REPORT_RETURNED: true,
  VISIT_NOT_DONE: true,
  PLAN_VISITS_UNASSIGNED: true,
  PLAN_STARTED: true,
  PLAN_ENDED: true,
  CHECKLIST_OVERDUE: true,
  CHECKLIST_PROBLEM: true,
  CHECKLIST_MISSED: true,
  ISSUE_RAISED: true,
  ISSUE_REPLY_ECCS: true,
  ISSUE_REPLY_RESTAURANT: true,
  ISSUE_IN_PROGRESS: true,
  ISSUE_RESOLVED: true,
  ISSUE_CLOSED: true,
  ISSUE_REOPENED: true,
  LICENCE_EXPIRING: true,
  LICENCE_EXPIRED: true,
  DOCUMENT_ADDED: true,
  DEVICE_LINKED: true,
  PIN_LOCKED: true,
};
export const NOTIFICATION_TYPES = Object.keys(TYPE_LIST) as NotificationType[];

export const isNotificationType = (value: unknown): value is NotificationType =>
  typeof value === "string" && value in TYPE_LIST;

/**
 * Where tapping a notification leads. `outletId` is there so an Owner with
 * several branches lands on the right one.
 */
export type NotificationLink =
  | { kind: "visit"; visitId: string }
  /** The list of visits and requests (for a request that has no visit yet, or a plan). */
  | { kind: "services"; outletId?: string }
  | { kind: "issue"; issueId: string }
  /** One day's checklist, or the outlet's checklists for today when there is no `runId`. */
  | { kind: "checklist"; outletId: string; runId?: string }
  /** Licences and documents. */
  | { kind: "documents"; outletId: string }
  /** Staff logins. */
  | { kind: "staff" };

export type NotificationParamValue = string | number | LocalizedText | null;

/** What is stored with a notification besides its type. */
export interface NotificationData<T extends NotificationType = NotificationType> {
  params: NotificationParamsByType[T];
  link: NotificationLink | null;
}

/** How long the piece of an issue or reply quoted in a notification may be. */
export const NOTIFICATION_EXCERPT_LENGTH = 80;

/** How many notifications one page of the list holds, and the most that can be asked for. */
export const NOTIFICATIONS_PAGE_SIZE = 30;
export const NOTIFICATIONS_MAX_PAGE_SIZE = 100;

/** How many days before a licence expires its Owner and Manager are reminded. */
export const LICENCE_REMINDER_DAYS = [30, 15, 7, 1] as const;

/** A rating this low, or lower, is brought to ECCS's attention on its own. */
export const LOW_RATING_STARS = 2;

/** One notification as the apps receive it. */
export interface NotificationDto {
  id: string;
  /** Null for a kind this version of the app does not know; show `title` and `body` then. */
  type: NotificationType | null;
  /** The English wording, for the console and as a fallback. */
  title: string;
  body: string;
  params: Record<string, NotificationParamValue>;
  link: NotificationLink | null;
  createdAt: string;
  readAt: string | null;
}

/** One page of a person's notifications, newest first. */
export interface NotificationPageDto {
  items: NotificationDto[];
  /** Pass as `before` to get the next, older page; null when there are no more. */
  nextCursor: string | null;
  unreadCount: number;
}

export interface UnreadCountDto {
  unreadCount: number;
}

/** How many of the newest notifications the answer to "anything new?" carries. */
export const NOTIFICATIONS_NEWS_SIZE = 20;

/**
 * The answer to "anything new?" (`GET /notifications/wait`): the person's
 * newest notifications as they stand now. The asker compares them with the
 * ones it has already shown to find what has just arrived.
 */
export interface NotificationNewsDto {
  /** The newest few, newest first. */
  items: NotificationDto[];
  /** The id of the newest one, or null when the person has none. Pass it back as `latest` to wait for the next. */
  latestId: string | null;
  unreadCount: number;
}

/** How the values that are not plain text are written out in one language. */
export interface NotificationFormatters {
  /** A name kept in several languages. */
  text: (value: LocalizedText) => string;
  /** A YYYY-MM-DD date. */
  date: (value: string) => string;
  /** A visit's arrival window; null when no time was set. */
  slot: (value: string | null) => string;
  category: (value: string) => string;
}

/**
 * The values of a notification, ready to drop into its wording: names in the
 * reader's language, dates and times as people read them. Used by the app with
 * the reader's language and by the server for the English fallback, so both
 * read the stored values the same way.
 */
export function notificationWordingParams(
  params: Record<string, NotificationParamValue>,
  format: NotificationFormatters,
): Record<string, string | number> {
  const out: Record<string, string | number> = {};
  for (const [key, value] of Object.entries(params)) {
    if (key === "slot") out.time = format.slot(typeof value === "string" ? value : null);
    else if (value === null) out[key] = "";
    else if (typeof value === "object") out[key] = format.text(value);
    else if (key === "date" && typeof value === "string") out[key] = format.date(value);
    else if (key === "category" && typeof value === "string") out[key] = format.category(value);
    else out[key] = value;
  }
  return out;
}
