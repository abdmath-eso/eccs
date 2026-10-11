import { z } from "zod";
import {
  CORRECTION_REASON_MIN,
  PUNCH_KINDS,
  type DayFlag,
  type MatchResult,
  type PunchFlag,
  type PunchKind,
  type PunchMethod,
} from "./attendance-rules.js";
import { isCalendarDate } from "./licences.js";
import { LANGUAGES, type Language } from "./roles.js";
import { ATTENDANCE_STATUSES, type AttendanceStatus } from "./staff.js";

// Attendance by face: what the apps send and what the server answers.
//
// How it works, in short. On the PIN screen of a phone linked to an outlet
// (nobody logged in) there is "Clock in / Clock out". The phone sends one photo
// with its device token; the server finds the face, compares it with the
// enrolled staff of THAT outlet only, and answers who it thinks it is, with a
// short-lived ticket. Nothing is recorded yet. When the person taps "Yes,
// that's me" the phone sends the ticket back and the punch is written, at the
// server's own time. Nobody marks attendance by hand; the Owner alone can
// correct a day or a punch, and must say why.
//
// The rules that turn punches into a day's status are in attendance-rules.ts.
//
// Privacy, which shapes all of this: only a face template (a list of numbers)
// is kept for each enrolled person, encrypted, and only after that person's own
// consent has been recorded; it is deleted when they withdraw or leave. The
// photo taken at a punch is kept for the Owner and Manager for 35 days and
// then deleted. ECCS staff can read none of it.
//
// Under 18: do not enrol. The app does not hold anyone's age, so this is a rule
// for the Owner, to be stated on the consent screen: a person under 18 clocks
// in through the assisted route only (the law asks for a parent's consent for
// a child's data, which this app does not collect).

// ───────────────────────── Error codes ─────────────────────────

/** Sent as `code` in an error answer, for the app to react to and to word in the person's language. */
export const ATTENDANCE_ERROR = {
  /** The face models are not installed on the server. Use the assisted route. */
  engineUnavailable: "FACE_ENGINE_UNAVAILABLE",
  noFace: "NO_FACE",
  manyFaces: "MANY_FACES",
  faceTooSmall: "FACE_TOO_SMALL",
  tooDarkOrBlurred: "TOO_DARK_OR_BLURRED",
  /** The file sent is not a photo the server can open. */
  photoUnreadable: "PHOTO_UNREADABLE",
  photoTooLarge: "PHOTO_TOO_LARGE",
  /** Enrolment: the photos are not all of the same person. */
  facesDiffer: "FACES_DIFFER",
  /** Enrolment: this face is already enrolled as someone else at the outlet. */
  faceAlreadyEnrolled: "FACE_ALREADY_ENROLLED",
  /** Enrolment: the employee's consent was not sent, or is not valid. */
  consentRequired: "CONSENT_REQUIRED",
  /** This phone is linked to the restaurant as a whole (the Owner's phone), not to one outlet. */
  deviceHasNoOutlet: "DEVICE_HAS_NO_OUTLET",
  ticketInvalid: "TICKET_INVALID",
  ticketExpired: "TICKET_EXPIRED",
  ticketUsed: "TICKET_USED",
  /** Assisted punch: the PIN belongs to someone who is not the Owner or a Manager of this outlet. */
  approverNotAllowed: "APPROVER_NOT_ALLOWED",
  tooManyScans: "TOO_MANY_SCANS",
  /** A correction was sent without its reason. */
  reasonRequired: "REASON_REQUIRED",
  /** The person is not on this outlet's staff, or has left. */
  notOnStaff: "NOT_ON_STAFF",
} as const;

// ───────────────────────── Consent and enrolment ─────────────────────────

/**
 * The version of the consent wording shown to the employee. Change it whenever
 * the wording changes in substance, so each person's record says which text
 * they agreed to.
 */
export const FACE_CONSENT_VERSION = "2026-10";

/**
 * The employee's own agreement to have a face template kept, recorded with the
 * enrolment. The Owner may hold the phone, but the employee reads (or is read)
 * the notice in their language and taps "I agree" themselves: `acceptedBy` can
 * only be the employee.
 */
export const faceConsentSchema = z.object({
  consentVersion: z.string().trim().min(1).max(20),
  /** The language the notice was shown in. */
  language: z.enum(LANGUAGES),
  /** The moment the employee tapped "I agree", from the phone. */
  acceptedAt: z.iso.datetime(),
  acceptedBy: z.literal("EMPLOYEE"),
});
export type FaceConsentInput = z.input<typeof faceConsentSchema>;

/** Where a person's face enrolment stands. The template itself is never sent to any app. */
export interface FaceStatusDto {
  staffId: string;
  enrolled: boolean;
  /** How many templates are held (one per enrolment photo). */
  templates: number;
  enrolledAt: string | null;
  /** The consent the present enrolment rests on; or, when not enrolled, the last one given. */
  consentAt: string | null;
  consentVersion: string | null;
  consentLanguage: Language | null;
  /** When the last consent was ended (withdrawn, or the person left), if it was. */
  withdrawnAt: string | null;
}

// ───────────────────────── Clocking in and out ─────────────────────────

const deviceToken = z.string().min(1);
const reason = z.string().trim().min(CORRECTION_REASON_MIN, `Say why, in at least ${CORRECTION_REASON_MIN} characters`).max(300);

export const clockConfirmSchema = z.object({ deviceToken, ticket: z.string().min(1).max(400) });
export type ClockConfirmInput = z.input<typeof clockConfirmSchema>;

/** The text parts of an assisted punch; the photo, if any, travels beside them. */
export const clockAssistedSchema = z.object({
  deviceToken,
  /** The PIN of the Owner or a Manager of this outlet, who vouches that the person is there. */
  approverPin: z.string().regex(/^\d{4}$/, "PIN must be 4 digits"),
  staffId: z.string().min(1),
});
export type ClockAssistedInput = z.input<typeof clockAssistedSchema>;

export interface ClockIdentifyDto {
  /**
   * MATCH: the server is sure. UNSURE: it has a guess; confirming is allowed and
   * the punch is marked for the Owner. NO_MATCH: nobody; try again or use the
   * assisted route.
   */
  result: MatchResult;
  candidate: { staffId: string; name: string } | null;
  /** What confirming will record. Null when there is no candidate. */
  nextKind: PunchKind | null;
  /** The candidate's last punch of this attendance day. */
  lastPunchAt: string | null;
  lastPunchKind: PunchKind | null;
  /** True when that last punch was moments ago: confirming records nothing new ("already clocked in"). */
  already: boolean;
  /** Send this back to `confirm` within two minutes. Null when there is no candidate. */
  ticket: string | null;
  ticketExpiresAt: string | null;
}

export interface ClockPunchResultDto {
  /** ALREADY: a scan too soon after the last one; `at` and `kind` are that earlier punch's. */
  result: "RECORDED" | "ALREADY";
  punchId: string;
  staffId: string;
  name: string;
  kind: PunchKind;
  /** The server's time for the punch. */
  at: string;
  /** The attendance day it belongs to, YYYY-MM-DD. */
  day: string;
  /** Minutes worked so far in this attendance day, counting a shift still running up to now. */
  workedMinutesToday: number;
  flag: PunchFlag | null;
}

/** The outlet's staff, for the name picker of the assisted route. Names only: no pay, no phone numbers. */
export interface ClockRosterDto {
  outletId: string;
  outletName: string;
  /** False when the server cannot recognise faces at the moment (the models are missing): offer the assisted route straight away. */
  faceReady: boolean;
  people: { staffId: string; name: string; jobTitle: string | null; enrolled: boolean }[];
}

// ───────────────────────── The Owner's corrections ─────────────────────────

const dateSchema = z
  .string()
  .regex(/^\d{4}-\d{2}-\d{2}$/, "Enter the date as YYYY-MM-DD")
  .refine(isCalendarDate, "That date does not exist");

/**
 * Sets one person's status for a day by hand (leave, the weekly off, or a
 * correction of what the punches gave). A null status takes the Owner's entry
 * away again, and the day goes back to what the punches say.
 */
export const correctDaySchema = z.object({
  outletId: z.string().min(1),
  staffId: z.string().min(1),
  date: dateSchema,
  status: z.enum(ATTENDANCE_STATUSES).nullable(),
  reason,
});
export type CorrectDayInput = z.input<typeof correctDaySchema>;

/** Adds a punch the camera never recorded (someone forgot to clock out). */
export const addPunchSchema = z.object({
  staffId: z.string().min(1),
  /** The moment it should have been recorded, with its time zone ("2026-10-09T22:30:00+05:30"). */
  at: z.iso.datetime({ offset: true }),
  kind: z.enum(PUNCH_KINDS),
  reason,
});
export type AddPunchInput = z.input<typeof addPunchSchema>;

export const voidPunchSchema = z.object({ reason });
export type VoidPunchInput = z.input<typeof voidPunchSchema>;

export const attendanceSettingsSchema = z
  .object({
    /** Minutes worked that count as a full day. */
    fullDayMinutes: z.number().int().min(60).max(16 * 60),
    /** Minutes worked that count as a half day. */
    halfDayMinutes: z.number().int().min(30).max(12 * 60),
  })
  .refine((settings) => settings.halfDayMinutes < settings.fullDayMinutes, { message: "A half day must be shorter than a full day" });
export type AttendanceSettingsInput = z.input<typeof attendanceSettingsSchema>;

export interface AttendanceSettingsDto {
  outletId: string;
  fullDayMinutes: number;
  halfDayMinutes: number;
  /** The hour the attendance day starts, India time. Fixed for everyone for now. */
  dayStartsAtHour: number;
  /** True while the outlet is on the standard figures and the Owner has saved none. */
  isDefault: boolean;
}

// ───────────────────────── Reading ─────────────────────────

/** Where a day's status came from: worked out from the punches, or entered by the Owner. */
export type AttendanceSource = "PUNCHES" | "OWNER";

/** What the punches say about one person's day, carried beside the status wherever a day is shown. */
export interface AttendanceDayFactsDto {
  /** Null when the day has no status yet. */
  source: AttendanceSource | null;
  firstInAt: string | null;
  lastOutAt: string | null;
  /** Null when not known (a punch is missing) or there is nothing to count. */
  workedMinutes: number | null;
  flags: DayFlag[];
  /** True when the status is a stand-in: the day is still running, or the Owner has something to settle. */
  provisional: boolean;
  /** True when the person is clocked in right now. */
  onDuty: boolean;
  /** How many punches the day has, voided ones left out. */
  punches: number;
  /** True when a punch photo exists that this reader may open. Always false for the Head Chef. */
  hasPhoto: boolean;
  /** The Owner's reason, when the Owner set the status. */
  note: string | null;
}

/** One day of a month view: its status and what the punches say. */
export interface AttendanceDayCellDto extends AttendanceDayFactsDto {
  status: AttendanceStatus | null;
}

export interface PunchDto {
  id: string;
  staffId: string;
  staffName: string;
  outletId: string;
  /** The attendance day it belongs to. */
  day: string;
  at: string;
  kind: PunchKind;
  method: PunchMethod;
  flag: PunchFlag | null;
  /** How alike the face was to the person's template, and to the next most alike person. Null for assisted and corrected punches. */
  score: number | null;
  secondScore: number | null;
  /** The reason typed with a correction. */
  note: string | null;
  /** Who vouched (assisted) or corrected. Null for a face punch. */
  createdByName: string | null;
  /** A signed link to the punch photo, good for an hour. Null when there is none, it has been deleted, or the reader may not see photos. */
  photoPath: string | null;
  voided: boolean;
  voidedAt: string | null;
  voidedByName: string | null;
  voidReason: string | null;
  /** When the Owner looked at a flagged punch and let it stand. */
  reviewedAt: string | null;
}

export interface PunchDayDto extends AttendanceDayFactsDto {
  date: string;
  status: AttendanceStatus | null;
  /** Every punch of the day, voided ones included, oldest first. */
  entries: PunchDto[];
}

/** One person's punches for a month, grouped by attendance day, newest day first. Days with no punch are left out. */
export interface StaffPunchesDto {
  staffId: string;
  name: string;
  outletId: string;
  /** YYYY-MM */
  month: string;
  today: string;
  /** The earliest day the Owner may still correct. */
  earliestDate: string;
  days: PunchDayDto[];
}

export interface ReviewDayDto extends AttendanceDayFactsDto {
  staffId: string;
  name: string;
  date: string;
  status: AttendanceStatus | null;
}

/** What is waiting for the Owner: marked punches not yet looked at, and days whose status is a stand-in. */
export interface AttendanceReviewDto {
  outletId: string;
  today: string;
  earliestDate: string;
  punches: PunchDto[];
  days: ReviewDayDto[];
}
