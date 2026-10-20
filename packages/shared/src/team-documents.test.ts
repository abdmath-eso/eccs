import { describe, expect, it } from "vitest";
import {
  acceptDocumentSchema,
  documentDateSchema,
  documentDue,
  documentsDue,
  expiryWords,
  proposedExpiry,
  yearsAfter,
  type DocumentAsked,
} from "./onboarding.js";
import { concerns, consoleAccessGroups, documentsConcern, lastLoginWords } from "./team.js";

// Document dates and the console access card (20 Oct 2026, the console plan's Team part).

const TODAY = "2026-10-20";
const ASKED: DocumentAsked[] = [
  { kind: "PHOTO", required: true },
  { kind: "ID_PROOF", required: true },
  { kind: "POLICE_VERIFICATION", required: true },
  { kind: "MEDICAL_FITNESS", required: true },
  { kind: "EDUCATION", required: false },
];

describe("document dates", () => {
  it("proposes a year from the upload for medical fitness, and nothing for the others", () => {
    expect(proposedExpiry("MEDICAL_FITNESS", "2026-10-20")).toBe("2027-10-20");
    expect(proposedExpiry("POLICE_VERIFICATION", "2026-10-20")).toBeNull();
    expect(proposedExpiry("PHOTO", "2026-10-20")).toBeNull();
    // A leap day becomes the last day of February.
    expect(yearsAfter("2028-02-29")).toBe("2029-02-28");
  });

  it("says the date in words", () => {
    expect(expiryWords("2026-11-03", TODAY)).toBe("Runs out on Tue 3 Nov");
    expect(expiryWords("2026-10-01", TODAY)).toBe("Ran out on Thu 1 Oct");
    expect(expiryWords(TODAY, TODAY)).toBe("Runs out today");
  });

  it("is due within 30 days of its date and after it, and not before", () => {
    const medical = (expiresOn: string | null, status: "ACCEPTED" | "UPLOADED" | "SENT_BACK" = "ACCEPTED") => documentDue({ kind: "MEDICAL_FITNESS", status, expiresOn }, TODAY);
    expect(medical("2026-11-19")).toMatchObject({ state: "EXPIRING", days: 30, words: "Medical fitness certificate runs out on Thu 19 Nov" });
    expect(medical("2026-11-20")).toBeNull();
    expect(medical(TODAY)).toMatchObject({ state: "EXPIRING", days: 0, words: "Medical fitness certificate runs out today" });
    expect(medical("2026-10-19")).toMatchObject({ state: "EXPIRED", days: -1 });
    expect(medical(null)).toBeNull();
    // Only a document on file: one sent back has no date to keep.
    expect(medical("2026-10-25", "UPLOADED")).not.toBeNull();
    expect(medical("2026-10-25", "SENT_BACK")).toBeNull();
  });

  it("counts a required document missing from the day it was expected, never an optional one", () => {
    const joined = "2026-10-10";
    const due = documentsDue({ asked: ASKED, documents: [{ kind: "PHOTO", status: "ACCEPTED", expiresOn: null }], joinedOn: joined, today: TODAY });
    // ID proof was expected on the joining day; the later documents 30 days after it (not yet).
    expect(due.map((entry) => [entry.kind, entry.state, entry.date])).toEqual([["ID_PROOF", "MISSING", joined]]);
    expect(due[0]!.words).toBe("ID proof missing");
    // Not before the joining day.
    expect(documentsDue({ asked: ASKED, documents: [], joinedOn: TODAY, today: TODAY })).toEqual([]);
    // A later document by the due day of its own onboarding task.
    const withTask = documentsDue({ asked: ASKED, documents: [], joinedOn: joined, taskDueOn: { MEDICAL_FITNESS: "2026-10-16" }, today: TODAY });
    expect(withTask.map((entry) => entry.kind)).toEqual(["ID_PROOF", "PHOTO", "MEDICAL_FITNESS"]);
    // Uploaded and waiting to be checked is on file; sent back is not.
    const waiting = documentsDue({
      asked: ASKED,
      documents: [
        { kind: "PHOTO", status: "UPLOADED", expiresOn: null },
        { kind: "ID_PROOF", status: "SENT_BACK", expiresOn: null },
      ],
      joinedOn: joined,
      today: TODAY,
    });
    expect(waiting.map((entry) => entry.kind)).toEqual(["ID_PROOF"]);
  });

  it("puts the most urgent first: the earliest date", () => {
    const due = documentsDue({
      asked: ASKED,
      documents: [
        { kind: "PHOTO", status: "ACCEPTED", expiresOn: null },
        { kind: "ID_PROOF", status: "ACCEPTED", expiresOn: "2026-11-05" },
        { kind: "MEDICAL_FITNESS", status: "ACCEPTED", expiresOn: "2026-10-15" },
      ],
      joinedOn: "2026-08-01",
      today: TODAY,
    });
    expect(due.map((entry) => [entry.kind, entry.state])).toEqual([
      ["POLICE_VERIFICATION", "MISSING"],
      ["MEDICAL_FITNESS", "EXPIRED"],
      ["ID_PROOF", "EXPIRING"],
    ]);
  });

  it("reads a date given, none, or the proposed one when left out", () => {
    expect(acceptDocumentSchema.parse(undefined)).toEqual({});
    expect(acceptDocumentSchema.parse({ expiresOn: null })).toEqual({ expiresOn: null });
    expect(acceptDocumentSchema.parse({ expiresOn: "2027-10-20" })).toEqual({ expiresOn: "2027-10-20" });
    expect(acceptDocumentSchema.safeParse({ expiresOn: "20/10/2027" }).success).toBe(false);
    expect(documentDateSchema.safeParse({}).success).toBe(false);
  });
});

describe("documents on the Team list", () => {
  it("is the last thing to keep an eye on, in words", () => {
    const one = [{ words: "Medical fitness certificate runs out on Tue 3 Nov" }];
    expect(documentsConcern(one)).toEqual({ kind: "DOCUMENTS_DUE", words: "Medical fitness certificate runs out on Tue 3 Nov.", short: "medical fitness certificate runs out on Tue 3 Nov" });
    const three = [{ words: "ID proof missing" }, { words: "Police verification certificate missing" }, { words: "Photo missing" }];
    expect(documentsConcern(three)!.words).toBe("3 documents due: ID proof missing, police verification certificate missing and 1 more.");
    expect(documentsConcern([])).toBeNull();
    const found = concerns({ missedDays: [], onTimeTargetPercent: 90, onboardingLate: 2, documentsDue: one });
    expect(found.map((entry) => entry.kind)).toEqual(["ONBOARDING_LATE", "DOCUMENTS_DUE"]);
    // Before the joining day too.
    expect(concerns({ missedDays: [], onTimeTargetPercent: 90, joinsLater: true, documentsDue: one }).map((entry) => entry.kind)).toEqual(["DOCUMENTS_DUE"]);
  });
});

describe("console access", () => {
  it("says what a Supervisor's role opens, grouped as the menu, with the tabs it does not", () => {
    expect(consoleAccessGroups("SUPERVISOR")).toEqual([
      { label: null, sections: [{ label: "Today", about: "what needs doing today", note: null }] },
      {
        label: "Daily work",
        sections: [
          { label: "Visits", about: "the visit diary and the week board", note: null },
          { label: "Inspections", about: "inspection reports", note: null },
          { label: "Issues", about: "issues raised by restaurants", note: null },
        ],
      },
      {
        label: "Clients",
        sections: [
          { label: "Clients", about: "how each outlet is doing", note: "Health only" },
          { label: "Certificates", about: "service certificates", note: null },
        ],
      },
      { label: "Set-up", sections: [{ label: "SOPs", about: "standard procedures", note: null }] },
    ]);
  });

  it("gives a BDE Sales alone", () => {
    expect(consoleAccessGroups("BDE")).toEqual([{ label: "Business", sections: [{ label: "Sales", about: "leads and quotes", note: null }] }]);
  });

  it("says the last login in words, India time", () => {
    const now = new Date("2026-10-20T06:30:00.000Z"); // 12:00 pm in India
    expect(lastLoginWords(null, now)).toBe("Never");
    expect(lastLoginWords("2026-10-20T04:10:00.000Z", now)).toBe("Today, 9:40 am");
    expect(lastLoginWords("2026-10-19T12:40:00.000Z", now)).toBe("Yesterday, 6:10 pm");
    expect(lastLoginWords("2026-10-17T04:10:00.000Z", now)).toBe("3 days ago");
    expect(lastLoginWords("2026-10-02T04:10:00.000Z", now)).toBe("2 Oct");
    expect(lastLoginWords("2025-12-02T04:10:00.000Z", now)).toBe("2 Dec 2025");
  });
});
