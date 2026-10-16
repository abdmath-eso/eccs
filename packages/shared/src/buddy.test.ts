import { describe, expect, it } from "vitest";
import {
  BUDDY_RULES,
  BUDDY_TOOLS,
  BUDDY_TOOL_NAMES,
  buddyCardExpiresAt,
  buddyPaused,
  buddyScopeAllows,
  checkBuddyAnswer,
  hideSecrets,
  plainBuddyText,
  secretsIn,
  buddyCardRefusal,
  buddyMessagesLeft,
  buddyScreenFor,
  buddyStarters,
  buddyToolsFor,
  cleanBuddyOpen,
  hidePhoneNumbers,
  mayUseBuddy,
  speechChoices,
  speechLocaleSupported,
  speechTagFor,
  SPEECH_TAGS,
  voiceFor,
  type BuddyStartFacts,
} from "./buddy.js";
import { LANGUAGES, type MembershipScope, type Role } from "./roles.js";

const member = (role: Role, outletId: string | null = "o1"): MembershipScope => ({
  role,
  organizationId: "org1",
  outletId: role === "OWNER" || role === "SUPER_ADMIN" || role === "OPS_MANAGER" || role === "SUPERVISOR" || role === "BDE" ? null : outletId,
});

describe("who may use Buddy", () => {
  it("is the Owner and the Manager only", () => {
    expect(mayUseBuddy([member("OWNER")])).toBe(true);
    expect(mayUseBuddy([member("MANAGER")])).toBe(true);
    for (const role of ["HEAD_CHEF", "SUPER_ADMIN", "OPS_MANAGER", "SUPERVISOR", "BDE"] as Role[]) {
      expect(mayUseBuddy([member(role)])).toBe(false);
    }
    expect(mayUseBuddy([])).toBe(false);
  });

  it("is refused to anyone who also holds an ECCS role", () => {
    expect(mayUseBuddy([member("MANAGER"), member("SUPERVISOR")])).toBe(false);
  });
});

describe("which tools a role gets", () => {
  it("gives the Owner and the Manager every tool their app grants allow", () => {
    expect(buddyToolsFor([member("OWNER")])).toEqual(BUDDY_TOOL_NAMES);
    expect(buddyToolsFor([member("MANAGER")])).toEqual(BUDDY_TOOL_NAMES);
  });

  it("gives everyone else nothing", () => {
    for (const role of ["HEAD_CHEF", "SUPER_ADMIN", "SUPERVISOR", "BDE"] as Role[]) expect(buddyToolsFor([member(role)])).toEqual([]);
  });

  it("has no tool that reads or changes staff, attendance, pay or payments", () => {
    for (const name of BUDDY_TOOL_NAMES) {
      const needs = BUDDY_TOOLS[name].needs as readonly string[] | null;
      expect(["staff", "attendance", "salary", "payments"]).not.toContain(needs?.[0]);
    }
  });

  it("makes every change a card", () => {
    for (const name of BUDDY_TOOL_NAMES) {
      if (name.startsWith("propose_")) expect(BUDDY_TOOLS[name].kind).toBe("change");
      else if (name !== "open_screen") expect(BUDDY_TOOLS[name].kind).toBe("read");
    }
  });
});

describe("a confirmation card", () => {
  const made = new Date("2026-10-16T10:00:00Z");
  const card = { userId: "u1", status: "PENDING" as const, expiresAt: buddyCardExpiresAt(made) };

  it("runs out after the card minutes", () => {
    expect(card.expiresAt.getTime() - made.getTime()).toBe(BUDDY_RULES.cardMinutes * 60_000);
    expect(buddyCardRefusal(card, "u1", new Date(made.getTime() + 60_000))).toBeNull();
    expect(buddyCardRefusal(card, "u1", card.expiresAt)).toBe("EXPIRED");
  });

  it("can be used once, and only by the person it was made for", () => {
    expect(buddyCardRefusal({ ...card, status: "DONE" }, "u1", made)).toBe("USED");
    expect(buddyCardRefusal({ ...card, status: "RUNNING" }, "u1", made)).toBe("BUSY");
    expect(buddyCardRefusal({ ...card, status: "CANCELLED" }, "u1", made)).toBe("CANCELLED");
    expect(buddyCardRefusal(card, "someone else", made)).toBe("NOT_FOUND");
    expect(buddyCardRefusal(null, "u1", made)).toBe("NOT_FOUND");
  });

  it("can be tried again after a failure while it lasts", () => {
    expect(buddyCardRefusal({ ...card, status: "FAILED" }, "u1", made)).toBeNull();
    expect(buddyCardRefusal({ ...card, status: "FAILED" }, "u1", card.expiresAt)).toBe("EXPIRED");
  });
});

describe("the message cap", () => {
  it("counts down and never below zero", () => {
    expect(buddyMessagesLeft(0, 40)).toBe(40);
    expect(buddyMessagesLeft(39, 40)).toBe(1);
    expect(buddyMessagesLeft(40, 40)).toBe(0);
    expect(buddyMessagesLeft(55, 40)).toBe(0);
  });
});

describe("the speaking language", () => {
  it("is each app language as spoken in India", () => {
    for (const language of LANGUAGES) expect(speechTagFor(language)).toMatch(/^[a-z]{2}-IN$/);
    expect(SPEECH_TAGS.EN).toBe("en-IN");
    expect(SPEECH_TAGS.TE).toBe("te-IN");
    expect(SPEECH_TAGS.UR).toBe("ur-IN");
  });

  it("offers the app language first, then English and Hindi, once each", () => {
    expect(speechChoices("TE")).toEqual(["TE", "EN", "HI"]);
    expect(speechChoices("HI")).toEqual(["HI", "EN"]);
    expect(speechChoices("EN")).toEqual(["EN", "HI"]);
  });

  it("is checked against the phone's list, by language, and is unknown without a list", () => {
    expect(speechLocaleSupported("te-IN", ["en-US", "te_IN"])).toBe(true);
    expect(speechLocaleSupported("te-IN", ["en-IN", "te"])).toBe(true);
    expect(speechLocaleSupported("or-IN", ["en-IN", "hi-IN"])).toBe(false);
    expect(speechLocaleSupported("or-IN", [])).toBeNull();
  });

  it("finds a voice for reading aloud, the exact tag first", () => {
    const voices = [{ language: "te-IN", id: "a" }, { language: "hi-IN", id: "b" }, { language: "en_GB", id: "c" }, { language: "en-IN", id: "d" }];
    expect(voiceFor("en-IN", voices)?.id).toBe("d");
    expect(voiceFor("te-IN", voices)?.id).toBe("a");
    expect(voiceFor("en-AU", voices)?.id).toBe("c");
    expect(voiceFor("or-IN", voices)).toBeNull();
  });
});

describe("the screen Buddy is opened from", () => {
  it("is read from the app's path", () => {
    expect(buddyScreenFor("/")).toBe("home");
    expect(buddyScreenFor("/checklists/setup")).toBe("checklists");
    expect(buddyScreenFor("/history")).toBe("calendar");
    expect(buddyScreenFor("/team/person")).toBe("staff");
    expect(buddyScreenFor("/profile")).toBe("other");
  });
});

describe("suggested prompts", () => {
  const quiet: BuddyStartFacts = { overdueChecklists: 0, openChecklists: 0, nextVisitDate: null, openIssues: 0, licencesToRenew: 0, duePaise: 0 };

  it("start with what is overdue, then suit the screen, four in all", () => {
    const starters = buddyStarters("checklists", { ...quiet, overdueChecklists: 3 });
    expect(starters).toHaveLength(4);
    expect(starters[0]).toEqual({ key: "overdue", params: { count: 3 } });
    expect(starters.slice(1, 3).map((s) => s.key)).toEqual(["addCheck", "newChecklist"]);
    expect(new Set(starters.map((s) => s.key)).size).toBe(4);
  });

  it("change with the screen", () => {
    expect(buddyStarters("sops", quiet)[0]?.key).toBe("writeSop");
    expect(buddyStarters("services", quiet)[0]?.key).toBe("book");
    expect(buddyStarters("staff", quiet)[0]?.key).toBe("howAddStaff");
  });

  it("bring up money and licences on Home when something is due", () => {
    const keys = buddyStarters("home", { ...quiet, duePaise: 500000, licencesToRenew: 1 }).map((s) => s.key);
    expect(keys.slice(0, 2)).toEqual(["licences", "whatsDue"]);
  });
});

describe("an Open button", () => {
  it("keeps only known screens and the details each takes", () => {
    expect(cleanBuddyOpen("staff_add", { name: " Ravi ", pin: "1234" })).toEqual({ target: "staff_add", params: { name: "Ravi" } });
    expect(cleanBuddyOpen("invoice", { invoiceId: "i1", amount: 5 })).toEqual({ target: "invoice", params: { invoiceId: "i1" } });
    expect(cleanBuddyOpen("rm -rf", {})).toBeNull();
    expect(cleanBuddyOpen("constructor", {})).toBeNull();
  });
});

describe("phone numbers", () => {
  it("are hidden, in every way they are written", () => {
    expect(hidePhoneNumbers("Call 98480 22338 or +91-98480-22338 or 040 2345 6789")).toBe("Call [number hidden] or [number hidden] or [number hidden]");
  });

  it("leave other numbers alone", () => {
    expect(hidePhoneNumbers("Keep below 5°C for 2 days, batch 2026-10-16, ₹4,720")).toBe("Keep below 5°C for 2 days, batch 2026-10-16, ₹4,720");
  });
});

describe("security rules", () => {
  const canary = "ECCS-CANARY-abc123";
  const ok = (text: string, extra: Parameters<typeof checkBuddyAnswer>[1] = { canary }) => checkBuddyAnswer(text, extra);

  it("let an ordinary answer through, numbers in it included", () => {
    expect(ok("Two checklists are overdue: Opening (due 9 am) and Closing. Fire NOC FIRE/HYD/2026/00999 expires on 2026-11-05. ₹11,210 with GST. Call 112.")).toBeNull();
    expect(ok("Your FSSAI licence 13622012000456 is valid.")).toBeNull();
  });

  it("replace code, links, long answers and leaks", () => {
    expect(ok("```js\nconsole.log(1)\n```")).toBe("CODE");
    expect(ok("function reverse(s) { return s }")).toBe("CODE");
    expect(ok("Use =VLOOKUP(A2, B:C, 2, FALSE)")).toBe("CODE");
    expect(ok("See https://example.com for more")).toBe("LINK");
    expect(ok("Check foscos.fssai.gov.in")).toBe("LINK");
    expect(ok("x".repeat(BUDDY_RULES.maxAnswerChars + 1))).toBe("LENGTH");
    expect(ok(`My marker is ${canary}`)).toBe("LEAK");
    expect(ok("I would call propose_booking for that")).toBe("LEAK");
    expect(ok("The <app_context> says")).toBe("LEAK");
  });

  it("allow only ECCS's own numbers and the emergency numbers", () => {
    expect(ok("Call 98480 22338")).toBe("NUMBER");
    expect(ok("Call ECCS on +91 90000 00000 or 112", { canary, allowedNumbers: ["+919000000000"] })).toBeNull();
    expect(ok("Your PIN 4821 is set", { canary, secrets: ["4821"] })).toBe("NUMBER");
  });

  it("hide PINs, codes and phone numbers before the model or the database sees them", () => {
    expect(hideSecrets("My PIN is 4821, call 98480 22338")).toBe("My PIN is [hidden], call [number hidden]");
    expect(hideSecrets("मेरा OTP 123456 है")).toBe("मेरा OTP [hidden] है");
    expect(hideSecrets("Book 2 deep cleans for 18 October 2026")).toBe("Book 2 deep cleans for 18 October 2026");
    expect(secretsIn("my pin is 4821 and otp 559911")).toEqual(["4821", "559911"]);
    expect(secretsIn("book for 2026")).toEqual([]);
  });

  it("show answers as plain text", () => {
    expect(plainBuddyText("**Note:** see [the guide](http://x.y) ![img](http://x/y.png)\n## Steps")).toBe("Note: see the guide \nSteps");
  });

  it("let the screen's own kinds through and refuse the rest", () => {
    for (const kind of ["app", "restaurant", "emergency", "greeting", "followup"] as const) expect(buddyScopeAllows(kind)).toBe(true);
    expect(buddyScopeAllows("offtopic")).toBe(false);
    expect(buddyScopeAllows("abuse")).toBe(false);
    expect(buddyPaused(BUDDY_RULES.blocksBeforePause - 1)).toBe(false);
    expect(buddyPaused(BUDDY_RULES.blocksBeforePause)).toBe(true);
  });
});
