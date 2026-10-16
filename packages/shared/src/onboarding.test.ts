import { describe, expect, it } from "vitest";
import {
  ageOn,
  autoChanges,
  autoFacts,
  daysLate,
  detailsMissing,
  dueWords,
  EMPTY_DETAILS,
  idDigitsProblem,
  ifscOk,
  joiningDetailsSchema,
  joiningMessage,
  joinsWords,
  LETTER_DEFAULTS,
  letterChanges,
  letterMissing,
  letterNumber,
  letterParticulars,
  letterRows,
  letterSettingsOf,
  letterText,
  looksLikeAadhaar,
  masked,
  mayTick,
  mergeDetails,
  onboardingProgress,
  onboardingWords,
  panProblem,
  personTaskSchema,
  phaseForDay,
  taskDueOn,
  templateTaskSchema,
  whenWords,
  type JoiningDetails,
  type LetterInput,
  type TaskFacts,
} from "./onboarding.js";
import { concerns, keepAnEyeOn, todaySentence } from "./team.js";

const task = (id: string, phase: TaskFacts["phase"], days: number, doneAt: string | null = null, required = true, position = 0): TaskFacts => ({
  id,
  phase,
  daysFromJoining: days,
  required,
  position,
  doneAt,
});

const full: JoiningDetails = {
  ...EMPTY_DETAILS,
  dateOfBirth: "1996-04-12",
  currentAddress: "4-2-10, Road No. 3, Banjara Hills, Hyderabad 500034",
  permanentSame: true,
  emergencyName: "Lakshmi",
  emergencyRelation: "Mother",
  emergencyPhone: "+919000012345",
  uniformSize: "M",
  idType: "AADHAAR",
  idLast4: "4821",
  bankHolder: "Kiran Kumar",
  bankAccount: "123456789012",
  bankIfsc: "SBIN0001234",
};

describe("due days from the joining day", () => {
  it("counts each task's day from the joining day, before and after", () => {
    expect(taskDueOn("2026-10-19", -2)).toBe("2026-10-17");
    expect(taskDueOn("2026-10-19", 0)).toBe("2026-10-19");
    expect(taskDueOn("2026-10-19", 30)).toBe("2026-11-18");
    expect(whenWords(-2)).toBe("2 days before joining");
    expect(whenWords(0)).toBe("Joining day");
    expect(whenWords(1)).toBe("1 day after joining");
    expect(joinsWords("2026-10-19")).toBe("Joins Mon 19 Oct");
  });

  it("puts a day in its phase", () => {
    expect(phaseForDay(-5)).toBe("BEFORE_JOINING");
    expect(phaseForDay(0)).toBe("FIRST_DAY");
    expect(phaseForDay(3)).toBe("FIRST_WEEK");
    expect(phaseForDay(30)).toBe("FIRST_MONTH");
    expect(phaseForDay(60)).toBe("BY_3_MONTHS");
    expect(phaseForDay(200)).toBe("BY_3_MONTHS");
  });

  it("is late from the day after its due day", () => {
    expect(daysLate({ dueOn: "2026-10-19", done: false }, "2026-10-19", "2026-10-16")).toBe(0);
    expect(daysLate({ dueOn: "2026-10-19", done: false }, "2026-10-21", "2026-10-16")).toBe(2);
    expect(daysLate({ dueOn: "2026-10-19", done: true }, "2026-10-21", "2026-10-16")).toBe(0);
  });

  it("keeps a due day already past when onboarding starts, late only from the day after it starts", () => {
    // Someone who joined on 1 Sep, started on 16 Oct: the "before joining" tasks were due in August.
    expect(daysLate({ dueOn: "2026-08-30", done: false }, "2026-10-16", "2026-10-16")).toBe(0);
    expect(daysLate({ dueOn: "2026-08-30", done: false }, "2026-10-17", "2026-10-16")).toBe(1);
    expect(daysLate({ dueOn: "2026-08-30", done: false }, "2026-10-19", "2026-10-16")).toBe(3);
  });

  it("says when in words", () => {
    expect(dueWords({ dueOn: "2026-10-19", done: false }, "2026-10-21", 2)).toBe("2 days late");
    expect(dueWords({ dueOn: "2026-10-20", done: false }, "2026-10-21", 1)).toBe("1 day late");
    expect(dueWords({ dueOn: "2026-10-16", done: false }, "2026-10-16", 0)).toBe("Due today");
    expect(dueWords({ dueOn: "2026-10-17", done: false }, "2026-10-16", 0)).toBe("Due tomorrow");
    expect(dueWords({ dueOn: "2026-10-19", done: false }, "2026-10-16", 0)).toBe("Due Mon 19 Oct");
    expect(dueWords({ dueOn: "2026-10-19", done: true }, "2026-10-26", 0)).toBe("Done");
  });
});

describe("progress and done", () => {
  const dates = { joinedOn: "2026-10-19", startedOn: "2026-10-16", today: "2026-10-21" };

  it("counts done, late and the next few, soonest first", () => {
    const tasks = [
      task("letter", "BEFORE_JOINING", -2, "2026-10-17T05:00:00.000Z"),
      task("kit", "BEFORE_JOINING", -1),
      task("welcome", "FIRST_DAY", 0, "2026-10-19T04:00:00.000Z"),
      task("shadow", "FIRST_WEEK", 5),
      task("check-in", "FIRST_MONTH", 30),
      task("extra", "FIRST_WEEK", 2, null, false),
    ];
    const progress = onboardingProgress(tasks, dates);
    // Only the kit is late: the optional task is due today, the rest later.
    expect(progress).toMatchObject({ done: 2, total: 6, late: 1, requiredLeft: 3, doneOn: null, currentPhase: "BEFORE_JOINING" });
    expect(progress.next.map((entry) => entry.task.id)).toEqual(["kit", "extra", "shadow"]);
    expect(progress.dated.find((entry) => entry.task.id === "kit")!.late).toBe(3);
    expect(onboardingWords(progress)).toBe("Onboarding 2 of 6");
  });

  it("is done when every required task is, on the day the last of them was", () => {
    const tasks = [
      task("a", "BEFORE_JOINING", -2, "2026-10-17T05:00:00.000Z"),
      task("b", "FIRST_DAY", 0, "2026-11-12T10:00:00.000Z"),
      // An optional task left undone does not hold it up.
      task("c", "FIRST_WEEK", 3, null, false),
    ];
    expect(onboardingProgress(tasks, dates).doneOn).toBe("2026-11-12");
    // A task done at 11 pm India time on the 12th is the 12th, though it is the 12th in UTC too only by chance.
    expect(onboardingProgress([task("a", "FIRST_DAY", 0, "2026-11-12T17:45:00.000Z")], dates).doneOn).toBe("2026-11-12");
    expect(onboardingProgress([task("a", "FIRST_DAY", 0, "2026-11-12T19:00:00.000Z")], dates).doneOn).toBe("2026-11-13");
  });

  it("with none required, waits for every task; with none at all, is never done", () => {
    expect(onboardingProgress([task("a", "FIRST_DAY", 0, "2026-10-19T05:00:00.000Z", false), task("b", "FIRST_DAY", 0, null, false)], dates).doneOn).toBeNull();
    expect(onboardingProgress([], dates).doneOn).toBeNull();
  });
});

describe("tasks that tick themselves", () => {
  const asked = [
    { kind: "PHOTO" as const, required: true },
    { kind: "ID_PROOF" as const, required: true },
    { kind: "EDUCATION" as const, required: false },
    { kind: "POLICE_VERIFICATION" as const, required: true },
  ];
  const facts = (over: Partial<Parameters<typeof autoFacts>[0]> = {}) =>
    autoFacts({ details: null, asked, documents: [], letterAcceptedAt: null, handbookAcceptedAt: null, firstAppLoginAt: null, ...over });

  it("sees the joining file complete only when nothing required is missing", () => {
    expect(facts({ details: { ...full, uniformSize: null, updatedAt: "2026-10-16T05:00:00.000Z" } }).DETAILS).toBeNull();
    expect(facts({ details: { ...full, updatedAt: "2026-10-16T05:00:00.000Z" } }).DETAILS).toBe("2026-10-16T05:00:00.000Z");
  });

  it("sees the documents accepted when every required one is, the police certificate apart", () => {
    const photo = { kind: "PHOTO" as const, status: "ACCEPTED" as const, reviewedAt: "2026-10-16T06:00:00.000Z" };
    const id = { kind: "ID_PROOF" as const, status: "UPLOADED" as const, reviewedAt: null };
    expect(facts({ documents: [photo, id] }).DOCUMENTS).toBeNull();
    const idAccepted = { ...id, status: "ACCEPTED" as const, reviewedAt: "2026-10-17T06:00:00.000Z" };
    expect(facts({ documents: [photo, idAccepted] }).DOCUMENTS).toBe("2026-10-17T06:00:00.000Z");
    expect(facts({ documents: [photo, idAccepted] }).POLICE_CERTIFICATE).toBeNull();
    const police = { kind: "POLICE_VERIFICATION" as const, status: "ACCEPTED" as const, reviewedAt: "2026-11-02T06:00:00.000Z" };
    expect(facts({ documents: [photo, idAccepted, police] }).POLICE_CERTIFICATE).toBe("2026-11-02T06:00:00.000Z");
  });

  it("ticks what became true, unticks what the app ticked and is no longer true, and leaves a person's tick alone", () => {
    const now = facts({ letterAcceptedAt: "2026-10-17T05:00:00.000Z", firstAppLoginAt: null });
    const changes = autoChanges(
      [
        { id: "letter", auto: "LETTER", doneAt: null, doneById: null },
        { id: "login", auto: "APP_LOGIN", doneAt: "2026-10-16T05:00:00.000Z", doneById: null },
        { id: "handbook", auto: "HANDBOOK", doneAt: "2026-10-16T05:00:00.000Z", doneById: "founder" },
        { id: "manual", auto: null, doneAt: null, doneById: null },
      ],
      now,
    );
    expect(changes).toEqual([
      { id: "letter", doneAt: "2026-10-17T05:00:00.000Z" },
      { id: "login", doneAt: null },
    ]);
  });

  it("lets the Super Admin tick anything, the Ops Manager and the new hire only their own", () => {
    const plain = { owner: "OPS_MANAGER" as const, auto: null, doneAt: null, doneById: null };
    expect(mayTick(plain, "SUPER_ADMIN")).toBe(true);
    expect(mayTick(plain, "OPS_MANAGER")).toBe(true);
    expect(mayTick(plain, "NEW_HIRE")).toBe(false);
    expect(mayTick({ ...plain, owner: "NEW_HIRE" }, "NEW_HIRE")).toBe(true);
    expect(mayTick({ ...plain, owner: "SUPER_ADMIN" }, "OPS_MANAGER")).toBe(false);
    // One that ticks itself: only the Super Admin, by hand, while it waits; never unticked once the app ticked it.
    const auto = { owner: "NEW_HIRE" as const, auto: "DETAILS" as const, doneAt: null, doneById: null };
    expect(mayTick(auto, "NEW_HIRE")).toBe(false);
    expect(mayTick(auto, "SUPER_ADMIN")).toBe(true);
    expect(mayTick({ ...auto, doneAt: "2026-10-16T05:00:00.000Z" }, "SUPER_ADMIN")).toBe(false);
    expect(mayTick({ ...auto, doneAt: "2026-10-16T05:00:00.000Z", doneById: "founder" }, "SUPER_ADMIN")).toBe(true);
  });
});

describe("the joining file", () => {
  const parse = (input: Record<string, unknown>) => joiningDetailsSchema.safeParse(input);
  const message = (input: Record<string, unknown>, field: string) => {
    const result = parse(input);
    return result.success ? null : (result.error.issues.find((issue) => issue.path[0] === field)?.message ?? null);
  };

  it("lists what is still needed, never the optional fields", () => {
    expect(detailsMissing(EMPTY_DETAILS)).toContain("Date of birth");
    expect(detailsMissing(full)).toEqual([]);
    expect(detailsMissing({ ...full, permanentSame: false })).toEqual(["Permanent address"]);
    expect(detailsMissing({ ...full, pan: null, bloodGroup: null, uan: null, education: null })).toEqual([]);
  });

  it("keeps only the last 4 digits of an ID and refuses a whole Aadhaar number in plain words", () => {
    expect(idDigitsProblem("4821", "AADHAAR")).toBeNull();
    expect(idDigitsProblem("1234 5678 4821", "AADHAAR")).toBe("Type only the last 4 digits. ECCS never keeps a whole Aadhaar number.");
    expect(idDigitsProblem("123456784821", null)).toBe("Type only the last 4 digits. ECCS never keeps a whole Aadhaar number.");
    expect(idDigitsProblem("12345678", "PASSPORT")).toBe("Type only the last 4 digits of the ID.");
    expect(idDigitsProblem("482", "AADHAAR")).toBe("Type the last 4 digits of the ID");
    expect(message({ idType: "AADHAAR", idLast4: "1234 5678 4821" }, "idLast4")).toBe("Type only the last 4 digits. ECCS never keeps a whole Aadhaar number.");
    expect(parse({ idType: "AADHAAR", idLast4: "4821" }).success).toBe(true);
  });

  it("refuses an Aadhaar number typed into any free text", () => {
    expect(looksLikeAadhaar("H.No 4-2-10, 1234 5678 9012")).toBe(true);
    expect(looksLikeAadhaar("Road No. 12, Banjara Hills 500034, phone 9000012345")).toBe(false);
    expect(message({ currentAddress: "Aadhaar 1234-5678-9012" }, "currentAddress")).toMatch(/looks like an Aadhaar number/);
  });

  it("checks a PAN's form, and that it is a person's", () => {
    expect(panProblem("ABCPK1234L")).toBeNull();
    expect(panProblem("ABCCK1234L")).toBe("That is not a person's PAN: a person's has P as its 4th letter");
    expect(panProblem("ABCP1234L")).toMatch(/10 characters/);
    expect(parse({ pan: " abcpk 1234 l" }).data?.pan).toBe("ABCPK1234L");
    expect(message({ pan: "1234567890" }, "pan")).toMatch(/10 characters/);
  });

  it("checks an IFSC's form, and the account number typed twice", () => {
    expect(ifscOk("SBIN0001234")).toBe(true);
    expect(ifscOk("HDFC0ABC123")).toBe(true);
    expect(ifscOk("SBIN1001234")).toBe(false);
    expect(ifscOk("SBI0001234")).toBe(false);
    expect(parse({ bankIfsc: "sbin 0001234" }).data?.bankIfsc).toBe("SBIN0001234");
    expect(message({ bankIfsc: "SBIN000123" }, "bankIfsc")).toMatch(/11 characters/);
    expect(message({ bankAccount: "1234 5678 9012", bankAccountAgain: "123456789013" }, "bankAccountAgain")).toMatch(/not the same/);
    expect(message({ bankAccount: "1234" , bankAccountAgain: "1234" }, "bankAccount")).toMatch(/9 to 18 digits/);
    expect(parse({ bankAccount: "1234 5678 9012", bankAccountAgain: "123456789012" }).data?.bankAccount).toBe("123456789012");
  });

  it("checks the UAN, the ESI number, the phone and the age", () => {
    expect(message({ uan: "12345" }, "uan")).toBe("A UAN has 12 digits");
    expect(parse({ uan: "1001 2345 6789" }).data?.uan).toBe("100123456789");
    expect(message({ esiNumber: "123" }, "esiNumber")).toBe("An ESI number has 10 digits");
    expect(message({ emergencyPhone: "12345" }, "emergencyPhone")).toBe("Enter a 10-digit mobile number");
    expect(parse({ emergencyPhone: "90000 12345" }).data?.emergencyPhone).toBe("+919000012345");
    expect(ageOn("2008-10-17", "2026-10-16")).toBe(17);
    expect(ageOn("2008-10-16", "2026-10-16")).toBe(18);
    expect(message({ dateOfBirth: "2030-01-01" }, "dateOfBirth")).toBe("Check the year of birth");
  });

  it("keeps a field left out, clears one sent empty, and shows the account and PAN masked", () => {
    const parsed = joiningDetailsSchema.parse({ currentAddress: "New address", bloodGroup: "", pan: "" });
    const next = mergeDetails({ ...full, pan: "ABCPK1234L", bloodGroup: "O+" }, parsed);
    expect(next).toMatchObject({ currentAddress: "New address", bloodGroup: null, pan: null, bankAccount: "123456789012", idLast4: "4821" });
    expect(masked("123456784821")).toBe("•••• 4821");
    expect(masked(null)).toBeNull();
  });
});

describe("the appointment letter", () => {
  const input: LetterInput = {
    number: letterNumber("2026", 1),
    madeOn: "2026-10-16",
    name: "Kiran (sample)",
    role: "SUPERVISOR",
    area: "Banjara Hills",
    joinedOn: "2026-10-19",
    weeklyOff: 0,
    monthlyPaise: 3_000_000,
    details: { dateOfBirth: "1996-04-12", parentName: "Ramesh", currentAddress: "4-2-10, Banjara Hills, Hyderabad", uan: null, esiNumber: null },
    handbookVersion: 1,
    settings: LETTER_DEFAULTS,
    company: { legalName: "Eosfera Commercial Cleaning Services", address: "Sample address, Hyderabad", lin: null, isSample: true },
    signedBy: "Sample Founder",
  };

  it("is numbered by year", () => {
    expect(letterNumber("2026", 1)).toBe("ECCS/AL/2026/0001");
    expect(letterNumber("2027", 123)).toBe("ECCS/AL/2027/0123");
  });

  it("needs the salary, the date of birth and the address first", () => {
    expect(letterMissing(input)).toEqual([]);
    expect(letterMissing({ monthlyPaise: null, details: null })).toEqual([
      "their monthly salary (Change their details)",
      "their date of birth (joining file)",
      "their address (joining file)",
    ]);
  });

  it("carries the codes' particulars from Team's records and the joining file", () => {
    const p = letterParticulars(input);
    expect(p).toMatchObject({
      name: "Kiran (sample)",
      dateOfBirth: "12 April 1996",
      parentName: "Ramesh",
      designation: "Supervisor",
      skill: "Skilled",
      joining: "Monday 19 October 2026",
      weeklyOff: "Sunday, every week.",
      lin: "Not yet issued; added once ECCS has one",
    });
    expect(p.wages).toMatch(/^₹30,000 a month \(Rupees Thirty Thousand Only\)\. All of it is basic pay/);
    expect(p.place).toBe("Hyderabad (Banjara Hills), and clients' premises in and around Hyderabad as ECCS assigns.");
    expect(p.employment).toMatch(/on probation for 3 months from the joining day, then permanent/);
    expect(p.hours).toMatch(/^8 hours a day and 48 hours a week/);
    expect(p.notice).toMatch(/^30 days on either side once confirmed; 7 days during probation/);
    expect(p.socialSecurity).toBe("EPF and ESI: not applicable to ECCS at present. ECCS will enrol you when they apply.");
    expect(letterParticulars({ ...input, details: { ...input.details!, uan: "100123456789", esiNumber: "1234567890" } }).socialSecurity).toMatch(/Your UAN: 100123456789\. Your ESI number: 1234567890\.$/);
    expect(p.handbook).toMatch(/version 1/);
    const labels = letterRows(p).map((row) => row.label);
    for (const label of ["Name", "Date of birth", "Designation", "Category of skill", "Nature of employment", "Date of joining", "Wages", "Social security", "Nature of duties"]) {
      expect(labels).toContain(label);
    }
  });

  it("says what changed when it is made again before acceptance", () => {
    const before = letterParticulars(input);
    const after = letterParticulars({ ...input, monthlyPaise: 3_200_000, role: "OPS_MANAGER" });
    expect(letterChanges(before, after)).toEqual(["Designation", "Category of skill", "Wages", "Nature of duties"]);
    expect(letterChanges(before, letterParticulars(input))).toEqual([]);
    expect(letterText(before)).not.toBe(letterText(after));
  });

  it("takes the Super Admin's own terms over the defaults", () => {
    const settings = letterSettingsOf({ probationMonths: 6, noticeDays: 60 });
    expect(settings.probationMonths).toBe(6);
    expect(settings.hoursPerDay).toBe(8);
    expect(letterParticulars({ ...input, settings }).probation).toMatch(/^6 months from the joining day/);
    expect(letterSettingsOf({ probationMonths: "x" }).probationMonths).toBe(3);
  });
});

describe("templates, tasks and the joining link", () => {
  it("keeps a task's day within its phase", () => {
    expect(templateTaskSchema.safeParse({ title: "Welcome", phase: "FIRST_DAY", owner: "OPS_MANAGER", daysFromJoining: 0 }).success).toBe(true);
    const wrong = templateTaskSchema.safeParse({ title: "Welcome", phase: "FIRST_DAY", owner: "OPS_MANAGER", daysFromJoining: 3 });
    expect(wrong.success ? null : wrong.error.issues[0]!.message).toBe("First day is the joining day itself (0)");
    expect(templateTaskSchema.safeParse({ title: "Check-in", phase: "FIRST_MONTH", owner: "SUPER_ADMIN", daysFromJoining: 30 }).success).toBe(true);
    expect(personTaskSchema.safeParse({ title: "Extra", owner: "NEW_HIRE", dueOn: "2026-10-20" }).success).toBe(true);
  });

  it("writes the WhatsApp message with the console's address and the login number", () => {
    expect(joiningMessage({ name: "Kiran Kumar", consoleUrl: "https://console.eccs.in", phone: "+919000000007", joinedOn: "2026-10-19", today: "2026-10-16" })).toBe(
      "Welcome to ECCS, Kiran. Before you join on Mon 19 Oct, please fill in your details, upload your documents and accept your appointment letter here: https://console.eccs.in/joining . Log in with 9000000007 and the one-time code.",
    );
  });
});

describe("the Team page's keep-an-eye-on pick", () => {
  it("puts late onboarding tasks last, after everything else", () => {
    const found = concerns({ missedDays: ["2026-10-13", "2026-10-14"], onTimeTargetPercent: 90, onboardingLate: 3 });
    expect(found.map((entry) => entry.kind)).toEqual(["MISSED_DAYS", "ONBOARDING_LATE"]);
    expect(found[1]).toEqual({ kind: "ONBOARDING_LATE", words: "3 onboarding tasks late.", short: "3 onboarding tasks late" });
    expect(concerns({ missedDays: [], onTimeTargetPercent: 90, onboardingLate: 1 })[0]!.words).toBe("1 onboarding task late.");
    expect(keepAnEyeOn(concerns({ missedDays: [], onTimeTargetPercent: 90, onboardingLate: 3 }), "").pick?.kind).toBe("ONBOARDING_LATE");
  });

  it("judges only the onboarding of someone not yet joined", () => {
    const behind = [{ label: "leads", done: 0, target: 10 }];
    expect(concerns({ missedDays: [], behind, onTimeTargetPercent: 90, joinsLater: true })).toEqual([]);
    expect(concerns({ missedDays: [], behind, onTimeTargetPercent: 90, joinsLater: true, onboardingLate: 2 }).map((entry) => entry.kind)).toEqual(["ONBOARDING_LATE"]);
  });

  it("says when someone joins", () => {
    const day = { date: "2026-10-16", state: "NOT_ON_TEAM" as const, firstAt: null, what: null, dayOff: false, onLeave: false, leaveReason: null };
    expect(todaySentence(day, { name: "Kiran", joinedOn: "2026-10-19" })).toBe("Joins on Monday 19 October.");
    expect(todaySentence(day, { name: "Kiran" })).toBe("Not on the team yet.");
  });
});
