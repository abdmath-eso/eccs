// Onboarding a new member of ECCS's own team (the console, 16 Oct 2026): the founders' staff
// (an Ops Manager, a Supervisor, a BDE), not a restaurant's cooks.
//
// How it works. Each role has a checklist template. Starting someone's onboarding copies their
// role's template into their own checklist; each task has a phase, an owner (the Super Admin,
// the Ops Manager or the new hire) and a due day counted from their joining day. The new hire
// fills in their own joining file and uploads their documents, which the Super Admin accepts
// or sends back with a reason; they read and accept their appointment letter and the staff
// handbook on their own "Joining ECCS" page. Tasks the app can see tick themselves. When every
// required task is done, the onboarding is done.
//
// Everything in this file is plain rules and wording with no database in it, so the server
// and the console agree and every rule is tested on its own (onboarding.test.ts). Dates are
// India dates (YYYY-MM-DD); moments are ISO strings; money is whole paise.
//
// PATTERN FOLLOWED: BambooHR (tasks copied from a template, one owner each, a due date from
// the hire date, tasks added to one person on their own tab); Keka and greytHR (preboarding
// before the joining day: the new hire fills in a form and uploads the documents HR asked
// for; HR accepts or rejects each one with remarks; HR can upload on their behalf); Zoho
// People (a candidate portal before joining, the employee's track from day 1); Rippling and
// Keka (form tasks complete themselves); the 30/60/90-day arc with a probation review at 90
// days; Dayforce's onboarding summary (progress counts, late items counted apart). India's
// labour codes (OSH Code 2020 s.6(1)(f), in force 21 Nov 2025; central rules of 8 May 2026)
// for the appointment letter's particulars; UIDAI's masked Aadhaar and the DPDP Act s.7(i)
// (employment) for keeping only an ID's last 4 digits.

import { z } from "zod";
import { normalizePhone } from "./auth.js";
import { amountInWords } from "./billing.js";
import { addDays, daysFrom } from "./finance.js";
import { indiaDay } from "./food-labels.js";
import { weekdayOf } from "./staff.js";
import { TEAM_ROLE_LABELS, TEAM_ROLES, WEEKDAY_NAMES, type TeamRole } from "./team.js";

// ───────────────────────── Phases, owners, tasks that tick themselves ─────────────────────────

/** The five phases of a checklist, in order: the 30/60/90-day arc, with the days before joining first. */
export const ONBOARDING_PHASES = ["BEFORE_JOINING", "FIRST_DAY", "FIRST_WEEK", "FIRST_MONTH", "BY_3_MONTHS"] as const;
export type OnboardingPhase = (typeof ONBOARDING_PHASES)[number];

export const PHASE_LABELS: Record<OnboardingPhase, string> = {
  BEFORE_JOINING: "Before joining",
  FIRST_DAY: "First day",
  FIRST_WEEK: "First week",
  FIRST_MONTH: "First month",
  BY_3_MONTHS: "By 3 months",
};

/**
 * The days from the joining day a task in each phase can fall due on. The joining day is day
 * 0: "2 days before joining" is -2, the 30-day check-in is 30.
 */
export const PHASE_DAYS: Record<OnboardingPhase, { from: number; to: number }> = {
  BEFORE_JOINING: { from: -60, to: 0 },
  FIRST_DAY: { from: 0, to: 0 },
  FIRST_WEEK: { from: 1, to: 6 },
  FIRST_MONTH: { from: 7, to: 30 },
  BY_3_MONTHS: { from: 31, to: 92 },
};

/** Who does a task. A task belongs to a role, not a named person, so it survives a change of Ops Manager. */
export const ONBOARDING_OWNERS = ["SUPER_ADMIN", "OPS_MANAGER", "NEW_HIRE"] as const;
export type OnboardingOwner = (typeof ONBOARDING_OWNERS)[number];

export const OWNER_LABELS: Record<OnboardingOwner, string> = {
  SUPER_ADMIN: "Super Admin",
  OPS_MANAGER: "Ops Manager",
  NEW_HIRE: "New hire",
};

/**
 * Tasks the app can see for itself, which tick themselves (Rippling and Keka complete form
 * tasks the same way). A task the app ticked unticks itself if what it saw stops being true;
 * one ticked by a person stays as they left it.
 */
export const ONBOARDING_AUTO = ["DETAILS", "DOCUMENTS", "LETTER", "HANDBOOK", "APP_LOGIN", "POLICE_CERTIFICATE", "MEDICAL_CERTIFICATE"] as const;
export type OnboardingAuto = (typeof ONBOARDING_AUTO)[number];

/** "Ticks itself when …". */
export const AUTO_LABELS: Record<OnboardingAuto, string> = {
  DETAILS: "their joining details are filled in",
  DOCUMENTS: "their documents are accepted",
  LETTER: "they accept their appointment letter",
  HANDBOOK: "they accept the staff handbook",
  APP_LOGIN: "they first log in to the ECCS app on their phone",
  POLICE_CERTIFICATE: "their police verification certificate is accepted",
  MEDICAL_CERTIFICATE: "their medical fitness certificate is accepted",
};

export const ONBOARDING_RULES = {
  /** "Next" on a person's page lists this many tasks. */
  nextShown: 3,
  /** The most tasks one checklist (or one template) may hold. */
  maxTasks: 40,
  maxTitle: 120,
  maxNote: 140,
  maxReason: 140,
  /** The digits of an ID kept: never more. */
  idDigitsKept: 4,
  /** ECCS's team is 18 or over. */
  minAge: 18,
  /** A joining document: a photo or a PDF, as the app's other documents (10 MB). */
  maxFileBytes: 10 * 1024 * 1024,
  handbookMaxChars: 20_000,
  /** The device name the console logs in with; any other login is the phone app. */
  consoleDeviceName: "ECCS console",
} as const;

// ───────────────────────── Documents ─────────────────────────

export const JOINING_DOCUMENT_KINDS = [
  "PHOTO",
  "ID_PROOF",
  "ADDRESS_PROOF",
  "BANK_PROOF",
  "POLICE_VERIFICATION",
  "MEDICAL_FITNESS",
  "RELIEVING_LETTER",
  "EDUCATION",
] as const;
export type JoiningDocumentKind = (typeof JOINING_DOCUMENT_KINDS)[number];

export const DOCUMENT_LABELS: Record<JoiningDocumentKind, { label: string; hint: string }> = {
  PHOTO: { label: "Photo", hint: "A recent, clear photo of your face" },
  ID_PROOF: { label: "ID proof", hint: "Best: the masked Aadhaar from myAadhaar, which shows only the last 4 digits" },
  ADDRESS_PROOF: { label: "Address proof", hint: "Only if your ID proof shows a different address" },
  BANK_PROOF: { label: "Bank proof", hint: "A cancelled cheque or your passbook's first page, for your salary" },
  POLICE_VERIFICATION: { label: "Police verification certificate", hint: "Free at your local police station" },
  MEDICAL_FITNESS: { label: "Medical fitness certificate", hint: "From a registered doctor; clients' kitchens ask for it" },
  RELIEVING_LETTER: { label: "Relieving letter", hint: "From your last job, if you have one" },
  EDUCATION: { label: "Education certificate", hint: "Your highest one" },
};

/** Documents that come later and have a task of their own; "documents accepted" does not wait for them. */
export const LATER_DOCUMENTS: readonly JoiningDocumentKind[] = ["POLICE_VERIFICATION", "MEDICAL_FITNESS"];

/** WAITING: nothing uploaded yet. SENT_BACK: refused with a reason (the file itself is deleted at once). */
export const DOCUMENT_STATUSES = ["WAITING", "UPLOADED", "ACCEPTED", "SENT_BACK"] as const;
export type JoiningDocumentStatus = (typeof DOCUMENT_STATUSES)[number];

export const DOCUMENT_STATUS_WORDS: Record<JoiningDocumentStatus, string> = {
  WAITING: "Waiting",
  UPLOADED: "Uploaded, to be checked",
  ACCEPTED: "Accepted",
  SENT_BACK: "Sent back",
};

/** One document a role asks for. */
export interface DocumentAsked {
  kind: JoiningDocumentKind;
  required: boolean;
}

/**
 * What a role is asked for before its template says otherwise: the photo, ID proof, bank proof
 * and police verification certificate (Hyderabad City Police ask employers to verify workers),
 * with the medical fitness certificate for a Supervisor, who works in clients' kitchens
 * (FSSAI asks food businesses to keep one for their food handlers).
 */
export function defaultDocuments(role: TeamRole): DocumentAsked[] {
  return [
    { kind: "PHOTO", required: true },
    { kind: "ID_PROOF", required: true },
    { kind: "ADDRESS_PROOF", required: false },
    { kind: "BANK_PROOF", required: true },
    { kind: "POLICE_VERIFICATION", required: true },
    ...(role === "SUPERVISOR" ? [{ kind: "MEDICAL_FITNESS" as const, required: true }] : []),
    { kind: "RELIEVING_LETTER", required: false },
    { kind: "EDUCATION", required: false },
  ];
}

export const documentsAskedSchema = z
  .array(z.object({ kind: z.enum(JOINING_DOCUMENT_KINDS), required: z.boolean() }))
  .max(JOINING_DOCUMENT_KINDS.length)
  .refine((list) => new Set(list.map((entry) => entry.kind)).size === list.length, "Each document only once");

// ───────────────────────── Due days and lateness ─────────────────────────

/** The day a task falls due: its days from joining, counted from the joining day. */
export const taskDueOn = (joinedOn: string, daysFromJoining: number) => addDays(joinedOn, daysFromJoining);

/**
 * How many days late a task is today (0 when it is not). A task copied in already past its due
 * day keeps that day, and counts as late only from the day after the onboarding started, so
 * starting onboarding for someone who joined last month does not make it late at once.
 */
export function daysLate(task: { dueOn: string; done: boolean }, today: string, startedOn: string): number {
  if (task.done) return 0;
  const from = task.dueOn > startedOn ? task.dueOn : startedOn;
  return today > from ? daysFrom(from, today) : 0;
}

const shortDate = (date: string) =>
  new Intl.DateTimeFormat("en-IN", { timeZone: "UTC", weekday: "short", day: "numeric", month: "short" }).format(new Date(`${date}T00:00:00Z`)).replace(",", "");
const dayMonthYear = (date: string) =>
  new Intl.DateTimeFormat("en-IN", { timeZone: "UTC", day: "numeric", month: "long", year: "numeric" }).format(new Date(`${date}T00:00:00Z`));
const plural = (count: number, one: string, many = `${one}s`) => `${count} ${count === 1 ? one : many}`;

/** "2 days late", "Due today", "Due tomorrow", "Due Mon 19 Oct", "Done". */
export function dueWords(task: { dueOn: string; done: boolean }, today: string, late: number): string {
  if (task.done) return "Done";
  if (late > 0) return `${plural(late, "day")} late`;
  if (task.dueOn === today) return "Due today";
  if (task.dueOn === addDays(today, 1)) return "Due tomorrow";
  return `Due ${shortDate(task.dueOn)}`;
}

/** "Joining day", "2 days before joining", "5 days after joining": a template task's day, in words. */
export function whenWords(daysFromJoining: number): string {
  if (daysFromJoining === 0) return "Joining day";
  return daysFromJoining < 0 ? `${plural(-daysFromJoining, "day")} before joining` : `${plural(daysFromJoining, "day")} after joining`;
}

/** "Joins Mon 19 Oct", for the Team list's Today column. */
export const joinsWords = (joinedOn: string) => `Joins ${shortDate(joinedOn)}`;

/** The phase a day from joining falls in, for a task added to one person on a date: the joining day itself is the first day. */
export function phaseForDay(daysFromJoining: number): OnboardingPhase {
  if (daysFromJoining < 0) return "BEFORE_JOINING";
  if (daysFromJoining === 0) return "FIRST_DAY";
  return ONBOARDING_PHASES.find((phase) => phase !== "BEFORE_JOINING" && daysFromJoining >= PHASE_DAYS[phase].from && daysFromJoining <= PHASE_DAYS[phase].to) ?? "BY_3_MONTHS";
}

// ───────────────────────── Progress and done ─────────────────────────

/** A task as the rules read it. */
export interface TaskFacts {
  id: string;
  phase: OnboardingPhase;
  daysFromJoining: number;
  required: boolean;
  position: number;
  /** When it was done; null while it is not. */
  doneAt: string | null;
}

export interface DatedTask<T extends TaskFacts> {
  task: T;
  dueOn: string;
  done: boolean;
  late: number;
}

export interface OnboardingProgress<T extends TaskFacts> {
  done: number;
  total: number;
  late: number;
  /** Required tasks not done yet. */
  requiredLeft: number;
  /** The India day the last required task was done, once every one is; null until then. */
  doneOn: string | null;
  /** The next few tasks not done, soonest due first. */
  next: DatedTask<T>[];
  /** The first phase with something left (the one open on the page); the last phase once all is done. */
  currentPhase: OnboardingPhase;
  /** Every task with its due day and lateness, in phase order. */
  dated: DatedTask<T>[];
}

const byPlace = <T extends TaskFacts>(a: DatedTask<T>, b: DatedTask<T>) =>
  ONBOARDING_PHASES.indexOf(a.task.phase) - ONBOARDING_PHASES.indexOf(b.task.phase) || a.task.position - b.task.position;

/**
 * "9 of 16 done", how many are late, the next few due, and whether it is done: every required
 * task done (or, with none marked required, every task), the day being when the last of them
 * was done. A checklist with no tasks is never done.
 */
export function onboardingProgress<T extends TaskFacts>(tasks: readonly T[], input: { joinedOn: string; startedOn: string; today: string; nextShown?: number }): OnboardingProgress<T> {
  const dated = tasks
    .map((task): DatedTask<T> => {
      const dueOn = taskDueOn(input.joinedOn, task.daysFromJoining);
      const done = task.doneAt !== null;
      return { task, dueOn, done, late: daysLate({ dueOn, done }, input.today, input.startedOn) };
    })
    .sort(byPlace);
  const counted = dated.some((entry) => entry.task.required) ? dated.filter((entry) => entry.task.required) : dated;
  const left = counted.filter((entry) => !entry.done);
  const doneOn = counted.length > 0 && left.length === 0 ? indiaDay(counted.map((entry) => entry.task.doneAt!).sort().at(-1)!) : null;
  const open = dated.filter((entry) => !entry.done);
  const next = [...open].sort((a, b) => a.dueOn.localeCompare(b.dueOn) || byPlace(a, b)).slice(0, input.nextShown ?? ONBOARDING_RULES.nextShown);
  return {
    done: dated.filter((entry) => entry.done).length,
    total: dated.length,
    late: dated.filter((entry) => entry.late > 0).length,
    requiredLeft: dated.filter((entry) => entry.task.required && !entry.done).length,
    doneOn,
    next,
    currentPhase: open[0]?.task.phase ?? "BY_3_MONTHS",
    dated,
  };
}

/** "Onboarding 9 of 16". */
export const onboardingWords = (progress: { done: number; total: number }) => `Onboarding ${progress.done} of ${progress.total}`;

// ───────────────────────── Tasks that tick themselves ─────────────────────────

/** When each thing the app can see became true; null while it is not. */
export type AutoFacts = Record<OnboardingAuto, string | null>;

const latest = (moments: readonly (string | null)[]) => (moments.length === 0 || moments.some((moment) => !moment) ? null : [...(moments as string[])].sort().at(-1)!);

/** The current document of each kind, as the rule reads it. */
export interface DocumentFacts {
  kind: JoiningDocumentKind;
  status: JoiningDocumentStatus;
  reviewedAt: string | null;
}

/**
 * What the app can see: the joining file complete (when last saved); every required document
 * other than the later ones accepted (when the last was); the police and medical certificates
 * accepted; the appointment letter and the handbook accepted; the first login on the phone app.
 */
export function autoFacts(input: {
  details: (JoiningDetails & { updatedAt: string }) | null;
  asked: readonly DocumentAsked[];
  documents: readonly DocumentFacts[];
  letterAcceptedAt: string | null;
  handbookAcceptedAt: string | null;
  firstAppLoginAt: string | null;
}): AutoFacts {
  const accepted = (kind: JoiningDocumentKind) => {
    const document = input.documents.find((entry) => entry.kind === kind);
    return document?.status === "ACCEPTED" ? (document.reviewedAt ?? null) : null;
  };
  const early = input.asked.filter((entry) => entry.required && !LATER_DOCUMENTS.includes(entry.kind));
  return {
    DETAILS: input.details && detailsMissing(input.details).length === 0 ? input.details.updatedAt : null,
    DOCUMENTS: early.length > 0 ? latest(early.map((entry) => accepted(entry.kind))) : null,
    LETTER: input.letterAcceptedAt,
    HANDBOOK: input.handbookAcceptedAt,
    APP_LOGIN: input.firstAppLoginAt,
    POLICE_CERTIFICATE: accepted("POLICE_VERIFICATION"),
    MEDICAL_CERTIFICATE: accepted("MEDICAL_FITNESS"),
  };
}

/**
 * The ticks the app makes or takes back: a task that ticks itself is ticked, at the moment
 * what it waits for became true; one the app ticked is unticked when that stops being true;
 * one a person ticked (doneById set) is left alone.
 */
export function autoChanges(
  tasks: readonly { id: string; auto: OnboardingAuto | null; doneAt: string | null; doneById: string | null }[],
  facts: AutoFacts,
): { id: string; doneAt: string | null }[] {
  const changes: { id: string; doneAt: string | null }[] = [];
  for (const task of tasks) {
    if (!task.auto) continue;
    const met = facts[task.auto];
    if (met && !task.doneAt) changes.push({ id: task.id, doneAt: met });
    else if (!met && task.doneAt && task.doneById === null) changes.push({ id: task.id, doneAt: null });
  }
  return changes;
}

/**
 * Who may tick or untick a task by hand: the Super Admin any task; the Ops Manager the tasks
 * the Ops Manager owns; the new hire their own (owner "New hire"), on their own checklist only.
 * A task that ticks itself and is ticked by the app cannot be unticked by hand (it would tick
 * itself again); one still waiting may be ticked by the Super Admin (papers seen in person).
 */
export function mayTick(task: { owner: OnboardingOwner; auto: OnboardingAuto | null; doneAt: string | null; doneById: string | null }, viewer: "SUPER_ADMIN" | "OPS_MANAGER" | "NEW_HIRE"): boolean {
  if (task.auto) return viewer === "SUPER_ADMIN" && !(task.doneAt && task.doneById === null);
  if (viewer === "SUPER_ADMIN") return true;
  return task.owner === viewer;
}

// ───────────────────────── The joining file ─────────────────────────

export const ID_TYPES = ["AADHAAR", "VOTER_ID", "DRIVING_LICENCE", "PASSPORT"] as const;
export type IdType = (typeof ID_TYPES)[number];
export const ID_TYPE_LABELS: Record<IdType, string> = { AADHAAR: "Aadhaar", VOTER_ID: "Voter ID", DRIVING_LICENCE: "Driving licence", PASSPORT: "Passport" };

export const BLOOD_GROUPS = ["A+", "A-", "B+", "B-", "AB+", "AB-", "O+", "O-"] as const;
export const UNIFORM_SIZES = ["XS", "S", "M", "L", "XL", "XXL", "XXXL"] as const;
export const RELATIONS = ["Spouse", "Father", "Mother", "Brother", "Sister", "Son", "Daughter", "Other relative", "Friend"] as const;
export const EDUCATION_LEVELS = ["BELOW_10", "CLASS_10", "CLASS_12", "ITI_DIPLOMA", "GRADUATE", "POSTGRADUATE"] as const;
export type EducationLevel = (typeof EDUCATION_LEVELS)[number];
export const EDUCATION_LABELS: Record<EducationLevel, string> = {
  BELOW_10: "Below 10th",
  CLASS_10: "10th",
  CLASS_12: "12th (intermediate)",
  ITI_DIPLOMA: "ITI or diploma",
  GRADUATE: "Graduate",
  POSTGRADUATE: "Postgraduate",
};

/** The joining file as kept. Every field may still be empty until it is filled in. */
export interface JoiningDetails {
  dateOfBirth: string | null;
  parentName: string | null;
  currentAddress: string | null;
  permanentSame: boolean | null;
  permanentAddress: string | null;
  emergencyName: string | null;
  emergencyRelation: string | null;
  emergencyPhone: string | null;
  bloodGroup: string | null;
  uniformSize: string | null;
  idType: IdType | null;
  idLast4: string | null;
  pan: string | null;
  bankHolder: string | null;
  bankAccount: string | null;
  bankIfsc: string | null;
  previousEmployer: string | null;
  uan: string | null;
  esiNumber: string | null;
  education: EducationLevel | null;
}

export const EMPTY_DETAILS: JoiningDetails = {
  dateOfBirth: null,
  parentName: null,
  currentAddress: null,
  permanentSame: null,
  permanentAddress: null,
  emergencyName: null,
  emergencyRelation: null,
  emergencyPhone: null,
  bloodGroup: null,
  uniformSize: null,
  idType: null,
  idLast4: null,
  pan: null,
  bankHolder: null,
  bankAccount: null,
  bankIfsc: null,
  previousEmployer: null,
  uan: null,
  esiNumber: null,
  education: null,
};

export const DETAIL_LABELS: Record<keyof JoiningDetails, string> = {
  dateOfBirth: "Date of birth",
  parentName: "Father's or mother's name",
  currentAddress: "Current address",
  permanentSame: "Permanent address",
  permanentAddress: "Permanent address",
  emergencyName: "Emergency contact's name",
  emergencyRelation: "Emergency contact's relation",
  emergencyPhone: "Emergency contact's phone",
  bloodGroup: "Blood group",
  uniformSize: "Uniform size",
  idType: "ID proof",
  idLast4: "Last 4 digits of the ID",
  pan: "PAN",
  bankHolder: "Account holder's name",
  bankAccount: "Bank account number",
  bankIfsc: "IFSC",
  previousEmployer: "Previous employer",
  uan: "UAN",
  esiNumber: "ESI number",
  education: "Highest education",
};

/** What the joining file still needs, in the form's order (labels); empty when it is complete. Optional fields are never asked for. */
export function detailsMissing(details: JoiningDetails): string[] {
  const missing: (keyof JoiningDetails)[] = [];
  const need = (key: keyof JoiningDetails) => {
    if (details[key] === null || details[key] === "") missing.push(key);
  };
  need("dateOfBirth");
  need("currentAddress");
  if (details.permanentSame !== true) need("permanentAddress");
  need("emergencyName");
  need("emergencyRelation");
  need("emergencyPhone");
  need("uniformSize");
  need("idType");
  need("idLast4");
  need("bankHolder");
  need("bankAccount");
  need("bankIfsc");
  return missing.map((key) => DETAIL_LABELS[key]);
}

/** "•••• 4821": all but the last 4 characters hidden. */
export const masked = (value: string | null | undefined) => (value ? `•••• ${value.slice(-4)}` : null);

/** Whole years of age on a day. */
export function ageOn(dateOfBirth: string, day: string): number {
  const years = Number(day.slice(0, 4)) - Number(dateOfBirth.slice(0, 4));
  return day.slice(5) < dateOfBirth.slice(5) ? years - 1 : years;
}

/** A 12-digit run, as an Aadhaar number is written ("1234 5678 9012"). */
const AADHAAR_LIKE = /(^|\D)\d{4}[\s-]?\d{4}[\s-]?\d{4}(\D|$)/;
export const looksLikeAadhaar = (text: string) => AADHAAR_LIKE.test(text);
const NO_AADHAAR = "This looks like an Aadhaar number. ECCS does not keep one: take it out.";

/** A PAN: 5 letters, 4 digits, a letter; the 4th letter is P for a person. Returns the problem, or null when it is a person's PAN. */
export function panProblem(pan: string): string | null {
  if (!/^[A-Z]{5}\d{4}[A-Z]$/.test(pan)) return "A PAN has 10 characters: 5 letters, 4 digits and a letter, for example ABCPK1234L";
  if (pan[3] !== "P") return "That is not a person's PAN: a person's has P as its 4th letter";
  return null;
}

/** An IFSC: 4 letters (the bank), a zero, then 6 letters or digits (the branch). */
export const ifscOk = (ifsc: string) => /^[A-Z]{4}0[A-Z0-9]{6}$/.test(ifsc);

/** The last 4 digits of an ID, or why not: a whole Aadhaar number is refused in plain words, never kept. */
export function idDigitsProblem(typed: string, idType: IdType | null): string | null {
  const digits = typed.replace(/\D/g, "");
  if (digits.length >= 8) {
    return idType === "AADHAAR" || digits.length === 12
      ? "Type only the last 4 digits. ECCS never keeps a whole Aadhaar number."
      : "Type only the last 4 digits of the ID.";
  }
  if (!/^\d{4}$/.test(typed.trim())) return "Type the last 4 digits of the ID";
  return null;
}

const upper = (value: string) => value.replace(/\s+/g, "").toUpperCase();

/** Free text that must not carry an Aadhaar number. Empty clears it. */
const text = (max: number, message: string) =>
  z
    .string()
    .trim()
    .max(max, message)
    .refine((value) => !looksLikeAadhaar(value), NO_AADHAAR)
    .transform((value) => value || null)
    .nullable()
    .optional();

const choice = <T extends readonly [string, ...string[]]>(values: T, message: string) =>
  z.preprocess((value) => (value === "" ? null : value), z.enum(values, message).nullable()).optional();

const dateField = z
  .string()
  .trim()
  .regex(/^\d{4}-\d{2}-\d{2}$/, "Enter the date as YYYY-MM-DD")
  .refine((value) => !Number.isNaN(Date.parse(`${value}T00:00:00.000Z`)), "That date does not exist");

/**
 * Saving the joining file (by the new hire, or the Super Admin on their behalf). A field left
 * out is kept as it was; sent empty it is cleared. It can be saved half-filled; what is still
 * needed is listed (detailsMissing), and the "details filled in" task ticks itself once
 * nothing is. The bank account number is typed twice; only the Super Admin's form shows the
 * whole of it and the PAN again.
 */
export const joiningDetailsSchema = z
  .object({
    dateOfBirth: z.preprocess((value) => (value === "" ? null : value), dateField.nullable()).optional(),
    parentName: text(80, "Keep the name under 80 characters"),
    currentAddress: text(300, "Keep the address under 300 characters"),
    permanentSame: z.boolean().nullable().optional(),
    permanentAddress: text(300, "Keep the address under 300 characters"),
    emergencyName: text(80, "Keep the name under 80 characters"),
    emergencyRelation: text(40, "Keep it under 40 characters"),
    emergencyPhone: z
      .string()
      .trim()
      .transform((value, context) => {
        if (!value) return null;
        const phone = normalizePhone(value);
        if (!phone) {
          context.addIssue({ code: "custom", message: "Enter a 10-digit mobile number" });
          return z.NEVER;
        }
        return phone;
      })
      .nullable()
      .optional(),
    bloodGroup: choice(BLOOD_GROUPS, "Choose a blood group"),
    uniformSize: choice(UNIFORM_SIZES, "Choose a uniform size"),
    idType: choice(ID_TYPES, "Choose the ID"),
    idLast4: z
      .string()
      .trim()
      .transform((value) => value || null)
      .nullable()
      .optional(),
    pan: z
      .string()
      .transform((value) => upper(value) || null)
      .nullable()
      .optional(),
    bankHolder: text(80, "Keep the name under 80 characters"),
    bankAccount: z
      .string()
      .transform((value) => value.replace(/[\s-]/g, "") || null)
      .nullable()
      .optional(),
    /** The account number typed a second time, to be sure; never kept. */
    bankAccountAgain: z
      .string()
      .transform((value) => value.replace(/[\s-]/g, "") || null)
      .nullable()
      .optional(),
    bankIfsc: z
      .string()
      .transform((value) => upper(value) || null)
      .nullable()
      .optional(),
    previousEmployer: text(80, "Keep it under 80 characters"),
    uan: z
      .string()
      .transform((value) => value.replace(/\s/g, "") || null)
      .nullable()
      .optional(),
    esiNumber: z
      .string()
      .transform((value) => value.replace(/\s/g, "") || null)
      .nullable()
      .optional(),
    education: choice(EDUCATION_LEVELS, "Choose the level"),
  })
  .superRefine((value, context) => {
    const issue = (path: string, message: string) => context.addIssue({ code: "custom", path: [path], message });
    if (value.dateOfBirth) {
      const today = indiaDay(new Date());
      if (value.dateOfBirth > today || value.dateOfBirth < "1940-01-01") issue("dateOfBirth", "Check the year of birth");
      else if (ageOn(value.dateOfBirth, today) < ONBOARDING_RULES.minAge) issue("dateOfBirth", `ECCS's team members are ${ONBOARDING_RULES.minAge} or over`);
    }
    if (value.idLast4) {
      const problem = idDigitsProblem(value.idLast4, value.idType ?? null);
      if (problem) issue("idLast4", problem);
    }
    if (value.pan) {
      const problem = panProblem(value.pan);
      if (problem) issue("pan", problem);
    }
    if (value.bankAccount) {
      if (!/^\d{9,18}$/.test(value.bankAccount)) issue("bankAccount", "An account number has 9 to 18 digits");
      else if (value.bankAccountAgain !== value.bankAccount) issue("bankAccountAgain", "The two account numbers are not the same. Type it again carefully.");
    }
    if (value.bankIfsc && !ifscOk(value.bankIfsc)) issue("bankIfsc", "An IFSC has 11 characters: 4 letters, a zero, then 6 letters or digits (for example SBIN0001234). It is on your cheque book.");
    if (value.uan && !/^\d{12}$/.test(value.uan)) issue("uan", "A UAN has 12 digits");
    if (value.esiNumber && !/^\d{10}$/.test(value.esiNumber)) issue("esiNumber", "An ESI number has 10 digits");
  });
export type JoiningDetailsInput = z.input<typeof joiningDetailsSchema>;
export type JoiningDetailsValues = z.output<typeof joiningDetailsSchema>;

/** The saved file with what was sent laid over it: a field left out keeps its value. */
export function mergeDetails(saved: JoiningDetails, input: JoiningDetailsValues): JoiningDetails {
  const next: JoiningDetails = { ...saved };
  for (const key of Object.keys(EMPTY_DETAILS) as (keyof JoiningDetails)[]) {
    const value = (input as Record<string, unknown>)[key];
    if (value !== undefined) (next as unknown as Record<string, unknown>)[key] = value;
  }
  if (next.permanentSame) next.permanentAddress = null;
  return next;
}

// ───────────────────────── The appointment letter ─────────────────────────

/**
 * The letter's terms the Super Admin can change (Team > Onboarding checklist > Letter terms).
 * The defaults are Claude's reading of the labour codes and common Indian appointment letters,
 * for a lawyer or CA to check before real use.
 */
export interface LetterSettings {
  hoursPerDay: number;
  hoursPerWeek: number;
  probationMonths: number;
  noticeDays: number;
  probationNoticeDays: number;
  city: string;
  /** How the wages are made up and paid. */
  wagesNote: string;
  leave: string;
  socialSecurity: string;
  skill: Record<TeamRole, string>;
  duties: Record<TeamRole, string>;
}

export const LETTER_DEFAULTS: LetterSettings = {
  hoursPerDay: 8,
  hoursPerWeek: 48,
  probationMonths: 3,
  noticeDays: 30,
  probationNoticeDays: 7,
  city: "Hyderabad",
  wagesNote: "All of it is basic pay; there is no dearness or other allowance at present. Paid into your bank account each month, by the 7th of the following month at the latest.",
  leave: "Days of leave agreed with ECCS are paid at your monthly salary. Annual leave with wages as the law provides, once it applies to ECCS.",
  socialSecurity: "EPF and ESI: not applicable to ECCS at present. ECCS will enrol you when they apply.",
  skill: { OPS_MANAGER: "Highly skilled", SUPERVISOR: "Skilled", BDE: "Skilled" },
  duties: {
    OPS_MANAGER:
      "Plan and run ECCS's daily operations: schedule the visits, give them to the Supervisors, check service reports, look after clients' issues, and keep the team's work to ECCS's standards and safety rules.",
    SUPERVISOR:
      "Lead ECCS's cleaning and hygiene visits at clients' kitchens: direct and check the crew's work against ECCS's SOPs and task lists, use chemicals and equipment safely, record the work and photos in the ECCS app, and carry out scored inspections.",
    BDE: "Find restaurants that may become ECCS's clients and follow them up: visit them, log each lead and step in the ECCS app, carry out free hygiene checks with the scorecard, and send quotes at ECCS's prices.",
  },
};

const roleTexts = (max: number) => z.object({ OPS_MANAGER: z.string().trim().min(1).max(max), SUPERVISOR: z.string().trim().min(1).max(max), BDE: z.string().trim().min(1).max(max) });

export const letterSettingsSchema = z.object({
  hoursPerDay: z.number("Enter the hours").int().min(1, "1 to 12").max(12, "1 to 12"),
  hoursPerWeek: z.number("Enter the hours").int().min(1, "1 to 72").max(72, "1 to 72"),
  probationMonths: z.number("Enter the months").int().min(0, "0 to 12").max(12, "0 to 12"),
  noticeDays: z.number("Enter the days").int().min(0, "0 to 90").max(90, "0 to 90"),
  probationNoticeDays: z.number("Enter the days").int().min(0, "0 to 90").max(90, "0 to 90"),
  city: z.string().trim().min(1, "Enter the city").max(40),
  wagesNote: z.string().trim().min(1, "Write a line").max(300),
  leave: z.string().trim().min(1, "Write a line").max(400),
  socialSecurity: z.string().trim().min(1, "Write a line").max(300),
  skill: roleTexts(40),
  duties: roleTexts(500),
});
export type LetterSettingsInput = z.input<typeof letterSettingsSchema>;

/** Saved settings laid over the defaults, so a setting added later still has a value. */
export function letterSettingsOf(saved: unknown): LetterSettings {
  const parsed = letterSettingsSchema.partial().safeParse(saved ?? {});
  const value = parsed.success ? parsed.data : {};
  return {
    ...LETTER_DEFAULTS,
    ...value,
    skill: { ...LETTER_DEFAULTS.skill, ...value.skill },
    duties: { ...LETTER_DEFAULTS.duties, ...value.duties },
  } as LetterSettings;
}

/** ECCS as the employer on the letter (sample details until the founder supplies real ones). */
export interface LetterCompany {
  legalName: string;
  address: string;
  /** The Labour Identification Number of the establishment, once ECCS has one. */
  lin: string | null;
  isSample: boolean;
}

/** Everything a letter is made from: Team's records, the joining file, the settings. */
export interface LetterInput {
  number: string;
  madeOn: string;
  name: string;
  role: TeamRole;
  area: string | null;
  joinedOn: string;
  weeklyOff: number;
  /** The monthly salary on the joining day (Team's). */
  monthlyPaise: number | null;
  details: Pick<JoiningDetails, "dateOfBirth" | "parentName" | "currentAddress" | "uan" | "esiNumber"> | null;
  handbookVersion: number | null;
  settings: LetterSettings;
  company: LetterCompany;
  signedBy: string;
}

/** What is needed before a letter can be made (words to show); empty when it can be. */
export function letterMissing(input: Pick<LetterInput, "monthlyPaise" | "details">): string[] {
  const missing: string[] = [];
  if (!input.monthlyPaise || input.monthlyPaise <= 0) missing.push("their monthly salary (Change their details)");
  if (!input.details?.dateOfBirth) missing.push("their date of birth (joining file)");
  if (!input.details?.currentAddress) missing.push("their address (joining file)");
  return missing;
}

/** The particulars printed on the letter, each in words, in the labour codes' order. */
export interface LetterParticulars {
  number: string;
  madeOn: string;
  name: string;
  dateOfBirth: string;
  parentName: string | null;
  address: string;
  designation: string;
  skill: string;
  employment: string;
  joining: string;
  place: string;
  wages: string;
  hours: string;
  weeklyOff: string;
  probation: string;
  notice: string;
  leave: string;
  socialSecurity: string;
  duties: string;
  handbook: string;
  employer: string;
  lin: string;
  signedBy: string;
  isSample: boolean;
}

const rupees = (paise: number) => new Intl.NumberFormat("en-IN", { style: "currency", currency: "INR", maximumFractionDigits: 0 }).format(paise / 100);
const weekdayLong = (date: string) => `${WEEKDAY_NAMES[weekdayOf(date)]} ${dayMonthYear(date)}`;

/** Works out the letter's particulars from Team's records and the joining file. Call letterMissing first. */
export function letterParticulars(input: LetterInput): LetterParticulars {
  const s = input.settings;
  const months = plural(s.probationMonths, "month");
  const social = [s.socialSecurity, input.details?.uan ? `Your UAN: ${input.details.uan}.` : null, input.details?.esiNumber ? `Your ESI number: ${input.details.esiNumber}.` : null]
    .filter(Boolean)
    .join(" ");
  return {
    number: input.number,
    madeOn: dayMonthYear(input.madeOn),
    name: input.name,
    dateOfBirth: input.details?.dateOfBirth ? dayMonthYear(input.details.dateOfBirth) : "",
    parentName: input.details?.parentName ?? null,
    address: input.details?.currentAddress ?? "",
    designation: TEAM_ROLE_LABELS[input.role],
    skill: s.skill[input.role],
    employment:
      s.probationMonths > 0
        ? `Regular and full-time: on probation for ${months} from the joining day, then permanent once ECCS confirms you in writing.`
        : "Regular, full-time and permanent.",
    joining: weekdayLong(input.joinedOn),
    place: `${s.city}${input.area ? ` (${input.area})` : ""}, and clients' premises in and around ${s.city} as ECCS assigns.`,
    wages: `${rupees(input.monthlyPaise ?? 0)} a month (${amountInWords(input.monthlyPaise ?? 0)}). ${s.wagesNote}`,
    hours: `${s.hoursPerDay} hours a day and ${s.hoursPerWeek} hours a week, with a rest break. Work beyond these is overtime, paid at twice the ordinary rate.`,
    weeklyOff: `${WEEKDAY_NAMES[input.weeklyOff] ?? "Sunday"}, every week.`,
    probation:
      s.probationMonths > 0
        ? `${months} from the joining day. ECCS will then confirm you in writing, or extend the probation once, by up to ${months}, saying why.`
        : "None.",
    notice:
      s.probationMonths > 0
        ? `${plural(s.noticeDays, "day")} on either side once confirmed; ${plural(s.probationNoticeDays, "day")} during probation. Either side may pay the wages for the notice instead.`
        : `${plural(s.noticeDays, "day")} on either side. Either side may pay the wages for the notice instead.`,
    leave: s.leave,
    socialSecurity: social,
    duties: s.duties[input.role],
    handbook: input.handbookVersion
      ? `The ECCS staff handbook (version ${input.handbookVersion}), which you read and accept separately, is part of these terms: conduct on clients' premises, safety and PPE, chemicals, clients' confidentiality, phone and app use, attendance and leave, respect at work and how to raise a complaint.`
      : "The ECCS staff handbook, which you read and accept separately, is part of these terms.",
    employer: `${input.company.legalName}, ${input.company.address}`,
    lin: input.company.lin ?? "Not yet issued; added once ECCS has one",
    signedBy: input.signedBy,
    isSample: input.company.isSample,
  };
}

/** The letter's lines as the page and the PDF print them: a label and its words. */
export function letterRows(p: LetterParticulars): { label: string; value: string }[] {
  return [
    { label: "Name", value: p.name },
    { label: "Date of birth", value: p.dateOfBirth },
    ...(p.parentName ? [{ label: "Father's or mother's name", value: p.parentName }] : []),
    { label: "Address", value: p.address },
    { label: "Designation", value: p.designation },
    { label: "Category of skill", value: p.skill },
    { label: "Nature of employment", value: p.employment },
    { label: "Date of joining", value: p.joining },
    { label: "Place of work", value: p.place },
    { label: "Wages", value: p.wages },
    { label: "Working hours", value: p.hours },
    { label: "Weekly day off", value: p.weeklyOff },
    { label: "Probation", value: p.probation },
    { label: "Notice period", value: p.notice },
    { label: "Leave", value: p.leave },
    { label: "Social security", value: p.socialSecurity },
    { label: "Nature of duties", value: p.duties },
    { label: "Staff handbook", value: p.handbook },
    { label: "Employer", value: p.employer },
    { label: "Labour Identification Number", value: p.lin },
  ];
}

/** The opening and closing lines around the particulars. */
export const letterOpening = (p: LetterParticulars) =>
  `Dear ${p.name}, ECCS is pleased to appoint you as ${/^[AEIOU]/.test(p.designation) ? "an" : "a"} ${p.designation} on the terms below, from ${p.joining}.`;
export const LETTER_CLOSING =
  "Please read this letter and accept it on your Joining ECCS page, or sign a printed copy and give it back to ECCS. Keep a copy: it is your record of these terms.";

/** The whole text, as one string: what an acceptance's fingerprint is taken of. */
export function letterText(p: LetterParticulars): string {
  return [`Letter of appointment ${p.number}`, p.madeOn, letterOpening(p), ...letterRows(p).map((row) => `${row.label}: ${row.value}`), LETTER_CLOSING, `For ECCS: ${p.signedBy}`].join("\n");
}

/** Which particulars differ between two versions of a waiting letter ("Wages", "Date of joining"), for "made again because …". */
export function letterChanges(before: LetterParticulars, after: LetterParticulars): string[] {
  const old = new Map(letterRows(before).map((row) => [row.label, row.value]));
  const changed = letterRows(after)
    .filter((row) => old.get(row.label) !== row.value)
    .map((row) => row.label);
  for (const label of old.keys()) if (!letterRows(after).some((row) => row.label === label)) changed.push(label);
  return [...new Set(changed)];
}

/** "ECCS/AL/2026/0001": the letter's number, by the year it is made and its place in that year. */
export const letterNumber = (year: string, sequence: number) => `ECCS/AL/${year}/${String(sequence).padStart(4, "0")}`;
export const LETTER_NUMBER_PREFIX = (year: string) => `ECCS/AL/${year}/`;

export const acceptLetterSchema = z.object({ letterId: z.uuid(), version: z.number().int().min(1) });
export type AcceptLetterInput = z.input<typeof acceptLetterSchema>;

// ───────────────────────── The staff handbook ─────────────────────────

export const handbookSchema = z.object({
  title: z.string("Give it a title").trim().min(1, "Give it a title").max(80),
  body: z.string("Write the handbook").trim().min(20, "Write the handbook").max(ONBOARDING_RULES.handbookMaxChars, "Keep it under 20,000 characters"),
});
export type HandbookInput = z.input<typeof handbookSchema>;

export const acceptHandbookSchema = z.object({ version: z.number().int().min(1) });

// ───────────────────────── Templates and tasks ─────────────────────────

const taskFields = {
  title: z
    .string("Write the task")
    .trim()
    .min(1, "Write the task")
    .max(ONBOARDING_RULES.maxTitle, `Keep it under ${ONBOARDING_RULES.maxTitle} characters`)
    .refine((value) => !looksLikeAadhaar(value), NO_AADHAAR),
  phase: z.enum(ONBOARDING_PHASES, "Choose the phase"),
  owner: z.enum(ONBOARDING_OWNERS, "Choose who does it"),
  daysFromJoining: z.number("Enter the day").int("Enter a whole number of days"),
  required: z.boolean().default(true),
  auto: z.enum(ONBOARDING_AUTO).nullable().optional(),
};

const dayInPhase = (value: { phase: OnboardingPhase; daysFromJoining: number }) =>
  value.daysFromJoining >= PHASE_DAYS[value.phase].from && value.daysFromJoining <= PHASE_DAYS[value.phase].to;
const dayMessage = (phase: OnboardingPhase) => {
  const { from, to } = PHASE_DAYS[phase];
  return from === to ? `${PHASE_LABELS[phase]} is the joining day itself (0)` : `${PHASE_LABELS[phase]} runs from day ${from} to day ${to}`;
};

/** A task of a role's template (the Super Admin). Its day must fall within its phase. */
export const templateTaskSchema = z.object(taskFields).superRefine((value, context) => {
  if (!dayInPhase(value)) context.addIssue({ code: "custom", path: ["daysFromJoining"], message: dayMessage(value.phase) });
});
export type TemplateTaskInput = z.input<typeof templateTaskSchema>;
export type TemplateTaskValues = z.output<typeof templateTaskSchema>;

/** A task added to one person's checklist, on a date (the Super Admin). */
export const personTaskSchema = z.object({
  title: taskFields.title,
  owner: taskFields.owner,
  dueOn: dateField,
  required: z.boolean().default(true),
});
export type PersonTaskInput = z.input<typeof personTaskSchema>;

export const moveSchema = z.object({ direction: z.enum(["up", "down"]) });

export const tickSchema = z.object({
  done: z.boolean(),
  note: z
    .string()
    .trim()
    .max(ONBOARDING_RULES.maxNote, `Keep the note under ${ONBOARDING_RULES.maxNote} characters`)
    .refine((value) => !looksLikeAadhaar(value), NO_AADHAAR)
    .transform((value) => value || null)
    .nullable()
    .optional(),
});
export type TickInput = z.input<typeof tickSchema>;

export const sendBackSchema = z.object({
  reason: z
    .string("Say why, so they know what to upload")
    .trim()
    .min(3, "Say why, so they know what to upload")
    .max(ONBOARDING_RULES.maxReason, `Keep it under ${ONBOARDING_RULES.maxReason} characters`)
    .refine((value) => !looksLikeAadhaar(value), NO_AADHAAR),
});

export const templateRoleSchema = z.enum(TEAM_ROLES);

/** Which documents a role asks for. */
export const templateDocumentsSchema = z.object({ documents: documentsAskedSchema });

// ───────────────────────── The joining link ─────────────────────────

/**
 * "Send joining link": WhatsApp opened on a chat with the new hire with a message typed in, the
 * console's address and the number they log in with. The server sends nothing. A sample member's
 * made-up number is left out, so WhatsApp asks whom to write to.
 */
export function joiningMessage(input: { name: string; consoleUrl: string; phone: string | null; joinedOn: string; today: string }): string {
  const first = input.name.trim().split(/\s+/)[0] ?? input.name;
  const when = input.joinedOn > input.today ? `Before you join on ${shortDate(input.joinedOn)}, please` : "Please";
  const number = input.phone ? input.phone.replace(/^\+91/, "") : "your mobile number";
  return `Welcome to ECCS, ${first}. ${when} fill in your details, upload your documents and accept your appointment letter here: ${input.consoleUrl}/joining . Log in with ${number} and the one-time code.`;
}

// ───────────────────────── What the API sends ─────────────────────────

export interface OnboardingTaskDto {
  id: string;
  phase: OnboardingPhase;
  title: string;
  owner: OnboardingOwner;
  dueOn: string;
  /** "2 days late", "Due Mon 19 Oct", "Done". */
  dueWords: string;
  daysLate: number;
  required: boolean;
  auto: OnboardingAuto | null;
  done: boolean;
  doneAt: string | null;
  /** Who ticked it; "the app" for one that ticked itself. */
  doneBy: string | null;
  note: string | null;
  /** Added to this person alone, not copied from the template. */
  custom: boolean;
  /** Whether the person looking may tick or untick it. */
  canTick: boolean;
}

export interface OnboardingPhaseDto {
  phase: OnboardingPhase;
  label: string;
  done: number;
  total: number;
  late: number;
  tasks: OnboardingTaskDto[];
}

/** The joining file as shown: the bank account and PAN masked. */
export interface JoiningFileDto {
  shown: Omit<JoiningDetails, "bankAccount" | "pan"> & { bankAccount: string | null; pan: string | null };
  /** Required fields still empty (labels). */
  missing: string[];
  complete: boolean;
  updatedAt: string | null;
  updatedBy: string | null;
}

export interface JoiningDocumentDto {
  kind: JoiningDocumentKind;
  label: string;
  hint: string;
  required: boolean;
  status: JoiningDocumentStatus;
  /** The upload's id, to open or review it; null while waiting or once sent back. */
  documentId: string | null;
  pdf: boolean;
  uploadedAt: string | null;
  uploadedBy: string | null;
  reviewedAt: string | null;
  reviewedBy: string | null;
  /** Why it was sent back. */
  reason: string | null;
}

export type LetterStatus = "WAITING" | "ACCEPTED" | "REPLACED";

export interface AppointmentLetterDto {
  id: string;
  number: string;
  version: number;
  status: LetterStatus;
  madeAt: string;
  madeBy: string | null;
  /** What changed when it was last made again, before it was accepted. */
  remadeFor: string[];
  acceptedAt: string | null;
  acceptedBy: string | null;
  acceptedHow: "CLICK" | "PAPER" | null;
  /** The letter that took its place, once a newer one was accepted. */
  replacedBy: string | null;
  particulars: LetterParticulars;
  rows: { label: string; value: string }[];
  opening: string;
  closing: string;
}

export interface LetterBlockDto {
  /** The letter in force or waiting; null before one is made. */
  current: AppointmentLetterDto | null;
  /** Earlier letters kept in the file (accepted, then replaced). */
  earlier: { id: string; number: string; acceptedAt: string | null; replacedAt: string | null }[];
  /** What is needed before a letter can be made. */
  missing: string[];
}

export interface StaffHandbookDto {
  version: number;
  title: string;
  body: string;
  publishedAt: string;
  publishedBy: string | null;
  isSample: boolean;
}

export interface OnboardingDto {
  id: string;
  role: TeamRole;
  startedOn: string;
  joinedOn: string;
  progress: { done: number; total: number; late: number; requiredLeft: number; doneOn: string | null };
  next: OnboardingTaskDto[];
  phases: OnboardingPhaseDto[];
  currentPhase: OnboardingPhase;
  /** The Super Admin adds and removes tasks. */
  canEdit: boolean;
  /** Only for the Super Admin: the joining file, the documents, the letter, the handbook and the joining link. */
  file: JoiningFileDto | null;
  documents: JoiningDocumentDto[] | null;
  letter: LetterBlockDto | null;
  handbook: { version: number | null; acceptedVersion: number | null; acceptedAt: string | null } | null;
}

export interface PersonOnboardingDto {
  onboarding: OnboardingDto | null;
  /** The Super Admin may start one (none yet, on the team, not a founder, not left). */
  canStart: boolean;
}

/** One thing the new hire has to do on their own page. */
export interface JoiningTodoDto {
  key: "DETAILS" | "DOCUMENTS" | "LETTER" | "HANDBOOK";
  title: string;
  done: boolean;
  /** "3 things still to fill in", "2 of 5 accepted, 1 sent back", "Accepted on 17 Oct". */
  words: string;
}

/** The new hire's own "Joining ECCS" page. Only ever their own. */
export interface JoiningPageDto {
  name: string;
  role: TeamRole;
  roleLabel: string;
  area: string | null;
  joinedOn: string;
  /** "You join on Monday 19 October", "You joined on 1 October". */
  joiningWords: string;
  todo: JoiningTodoDto[];
  /** How many of the four are left. */
  left: number;
  progress: { done: number; total: number };
  doneOn: string | null;
  file: JoiningFileDto;
  documents: JoiningDocumentDto[];
  letter: AppointmentLetterDto | null;
  handbook: StaffHandbookDto | null;
  handbookAccepted: { version: number; acceptedAt: string } | null;
  /** The first day's and first week's tasks, whoever does them. */
  firstWeek: OnboardingTaskDto[];
  /** Tasks the new hire does themselves (other than the four above). */
  myTasks: OnboardingTaskDto[];
}

export interface TemplateTaskDto {
  id: string;
  phase: OnboardingPhase;
  title: string;
  owner: OnboardingOwner;
  daysFromJoining: number;
  required: boolean;
  auto: OnboardingAuto | null;
  position: number;
}

export interface OnboardingTemplateDto {
  role: TeamRole;
  label: string;
  tasks: TemplateTaskDto[];
  documents: (DocumentAsked & { label: string })[];
  isSample: boolean;
  updatedAt: string | null;
}

export interface OnboardingTemplatesDto {
  templates: OnboardingTemplateDto[];
  settings: LetterSettings;
  handbook: StaffHandbookDto | null;
}

/** Role labels for the templates page (the team roles only: a founder is not onboarded here). */
export const TEMPLATE_ROLE_LABELS: Record<TeamRole, string> = { OPS_MANAGER: TEAM_ROLE_LABELS.OPS_MANAGER, SUPERVISOR: TEAM_ROLE_LABELS.SUPERVISOR, BDE: TEAM_ROLE_LABELS.BDE };
