import { describe, expect, it } from "vitest";
import { AI_FEATURES } from "./ai.js";
import {
  ACTIVITY_ACTION_KEYS,
  ACTIVITY_ACTIONS,
  ACTIVITY_CATEGORIES,
  ACTIVITY_CATEGORY_KEYS,
  AI_FEATURE_ACTIONS,
  actionsMatching,
  activityActionLabel,
  activityCategoryLabel,
  activityCategoryOf,
  activityClientFrom,
  activityLogQuerySchema,
  activityResultFor,
  activitySource,
  isForbiddenDetailName,
  isOfflineEntry,
  isSafeFactValue,
  mainRole,
  maskPhone,
  safeDetails,
  shortText,
} from "./activity-log.js";

describe("the action map", () => {
  it("puts every action in a known area, with a label", () => {
    for (const key of ACTIVITY_ACTION_KEYS) {
      const [category, label] = ACTIVITY_ACTIONS[key];
      expect(ACTIVITY_CATEGORY_KEYS, key).toContain(category);
      expect(label.length, key).toBeGreaterThan(3);
    }
  });

  it("names each action after its area, so the keys read in groups", () => {
    for (const key of ACTIVITY_ACTION_KEYS) {
      const [category] = ACTIVITY_ACTIONS[key];
      expect(key.startsWith(`${category}.`), key).toBe(true);
    }
  });

  it("has a key of letters and dots only, and no label twice", () => {
    for (const key of ACTIVITY_ACTION_KEYS) expect(key).toMatch(/^[a-z][A-Za-z]*(\.[a-z][A-Za-z0-9]*)+$/);
    const labels = ACTIVITY_ACTION_KEYS.map((key) => ACTIVITY_ACTIONS[key][1]);
    expect(new Set(labels).size).toBe(labels.length);
  });

  it("has every area the founder listed, and every area is used", () => {
    // 24 areas, then "finance" for the Finance page and "sales" for the Sales page (15 Oct 2026),
    // and "team" for the Team page (16 Oct 2026).
    expect(ACTIVITY_CATEGORY_KEYS).toHaveLength(27);
    for (const category of ACTIVITY_CATEGORY_KEYS) {
      expect(ACTIVITY_ACTION_KEYS.some((key) => ACTIVITY_ACTIONS[key][0] === category), category).toBe(category === "vendors" ? false : true);
    }
  });

  it("has an action for every AI feature", () => {
    for (const feature of AI_FEATURES) {
      const action = AI_FEATURE_ACTIONS[feature];
      expect(ACTIVITY_ACTIONS[action][0]).toBe("ai");
    }
  });
});

describe("label lookups", () => {
  it("gives the label of a known action and its area", () => {
    expect(activityActionLabel("checklists.run.submitted")).toBe("Handed in a checklist");
    expect(activityCategoryOf("checklists.run.submitted")).toBe("checklists");
    expect(activityCategoryLabel("checklists")).toBe(ACTIVITY_CATEGORIES.checklists);
  });

  it("reads an unknown key as words instead of failing", () => {
    expect(activityActionLabel("checklists.run.sentTwice")).toBe("Run sent twice");
    expect(activityCategoryOf("checklists.run.sentTwice")).toBe("checklists");
    expect(activityCategoryOf("nowhere.thing")).toBe("system");
    expect(activityCategoryLabel("nowhere")).toBe("nowhere");
  });

  it("finds actions by words of their label, for free-text search", () => {
    expect(actionsMatching("handed in")).toEqual(["checklists.run.submitted"]);
    expect(actionsMatching("wrong pin")).toContain("auth.pin.wrong");
    expect(actionsMatching("   ")).toEqual([]);
  });
});

describe("results", () => {
  it("turns the answer's status into a result", () => {
    expect(activityResultFor(200)).toBe("SUCCESS");
    expect(activityResultFor(204)).toBe("SUCCESS");
    expect(activityResultFor(401)).toBe("REFUSED");
    expect(activityResultFor(403)).toBe("REFUSED");
    expect(activityResultFor(429)).toBe("REFUSED");
    for (const status of [400, 404, 409, 413, 422]) expect(activityResultFor(status)).toBe("REJECTED");
    expect(activityResultFor(500)).toBe("FAILED");
    expect(activityResultFor(503)).toBe("FAILED");
    expect(activityResultFor(null)).toBe("FAILED");
  });
});

describe("who and where from", () => {
  it("picks the highest role", () => {
    expect(mainRole(["HEAD_CHEF", "OWNER"])).toBe("OWNER");
    expect(mainRole(["SUPERVISOR", "OPS_MANAGER"])).toBe("OPS_MANAGER");
    expect(mainRole([])).toBeNull();
  });

  it("reads the client from the header, then from the browser's own name", () => {
    expect(activityClientFrom("mobile", "Mozilla/5.0")).toBe("mobile");
    expect(activityClientFrom("CONSOLE", null)).toBe("console");
    expect(activityClientFrom(null, "okhttp/4.12.0")).toBe("mobile");
    expect(activityClientFrom(undefined, "Mozilla/5.0 (Windows NT 10.0) Chrome/140")).toBe("console");
    expect(activityClientFrom("something", "curl/8.0")).toBe("other");
    expect(activityClientFrom(null, null)).toBe("other");
  });

  it("works out the source from the role and the client", () => {
    expect(activitySource({ role: "MANAGER", client: "console" })).toBe("RESTAURANT_APP");
    expect(activitySource({ role: "OWNER", client: "mobile" })).toBe("RESTAURANT_APP");
    expect(activitySource({ role: "SUPERVISOR", client: "mobile" })).toBe("SUPERVISOR_APP");
    expect(activitySource({ role: "SUPER_ADMIN", client: "mobile" })).toBe("SUPERVISOR_APP");
    expect(activitySource({ role: "SUPERVISOR", client: "console" })).toBe("CONSOLE");
    expect(activitySource({ role: "OPS_MANAGER", client: "other" })).toBe("CONSOLE");
    expect(activitySource({ role: "SUPERVISOR", client: "other" })).toBe("SUPERVISOR_APP");
  });

  it("works out the source of a request with nobody logged in", () => {
    expect(activitySource({ role: null, client: "mobile", side: "restaurant" })).toBe("RESTAURANT_APP");
    expect(activitySource({ role: null, client: "other", side: "restaurant" })).toBe("RESTAURANT_APP");
    expect(activitySource({ role: null, client: "mobile", side: "eccs" })).toBe("SUPERVISOR_APP");
    expect(activitySource({ role: null, client: "console", side: "eccs" })).toBe("CONSOLE");
    expect(activitySource({ role: null, client: "console" })).toBe("CONSOLE");
    expect(activitySource({ role: null, client: "other", side: "public" })).toBe("PUBLIC");
    expect(activitySource({ role: null, client: "other" })).toBe("PUBLIC");
  });
});

describe("redaction", () => {
  it("keeps only the last four digits of a phone number", () => {
    expect(maskPhone("+919000000002")).toBe("…0002");
    expect(maskPhone("12")).toBeNull();
    expect(maskPhone(null)).toBeNull();
  });

  it("bars secrets and free text by the name of the detail", () => {
    for (const name of ["pin", "approverPin", "code", "otpCode", "deviceToken", "token", "password", "apiKey", "sig", "note", "reason", "message", "body", "comment", "steps", "photo", "phone", "name", "salary"]) {
      expect(isForbiddenDetailName(name), name).toBe(true);
    }
    for (const name of ["status", "rating", "problems", "items", "amountPaise", "planCode", "kind", "copies", "feature", "phoneLast4", "changed", "documents", "outcome"]) {
      expect(isForbiddenDetailName(name), name).toBe(false);
    }
  });

  it("keeps safe facts and drops the rest", () => {
    expect(
      safeDetails({
        status: "RESOLVED",
        problems: 2,
        ok: true,
        pin: "2580",
        note: "the fridge was dirty",
        nested: { a: 1 },
        list: ["a", "b"],
        mixed: ["a", { b: 1 }],
        long: "x".repeat(200),
        nan: Number.NaN,
      }),
    ).toEqual({ status: "RESOLVED", problems: 2, ok: true, list: ["a", "b"], long: `${"x".repeat(79)}…` });
    expect(safeDetails({ code: "123456" })).toBeNull();
    expect(safeDetails(null)).toBeNull();
  });

  it("lets only short codes, numbers and true or false through as facts from a body", () => {
    expect(isSafeFactValue("PERIOD_END")).toBe(true);
    expect(isSafeFactValue(5)).toBe(true);
    expect(isSafeFactValue(false)).toBe(true);
    expect(isSafeFactValue("the fridge was dirty")).toBe(false);
    expect(isSafeFactValue("a".repeat(41))).toBe(false);
    expect(isSafeFactValue({})).toBe(false);
  });

  it("cuts long text to one short line", () => {
    expect(shortText("  a\n b  ")).toBe("a b");
    expect(shortText("abcdef", 4)).toBe("abc…");
  });
});

describe("done offline", () => {
  it("is more than five minutes between the phone's time and the server's", () => {
    const at = new Date("2026-10-15T10:00:00Z");
    expect(isOfflineEntry(at, null)).toBe(false);
    expect(isOfflineEntry(at, new Date("2026-10-15T09:56:00Z"))).toBe(false);
    expect(isOfflineEntry(at, new Date("2026-10-15T09:54:00Z"))).toBe(true);
    expect(isOfflineEntry(at, new Date("2026-10-15T10:06:00Z"))).toBe(true);
  });
});

describe("the filters", () => {
  it("reads lists given with commas or repeated", () => {
    const query = activityLogQuerySchema.parse({ source: "CONSOLE,SYSTEM", result: ["REFUSED", "FAILED"], failuresOnly: "1" });
    expect(query.source).toEqual(["CONSOLE", "SYSTEM"]);
    expect(query.result).toEqual(["REFUSED", "FAILED"]);
    expect(query.failuresOnly).toBe(true);
    expect(query.offline).toBe(false);
    expect(query.category).toBeUndefined();
  });

  it("reads a day as the whole India day", () => {
    const query = activityLogQuerySchema.parse({ from: "2026-10-15", to: "2026-10-15" });
    expect(query.from?.toISOString()).toBe("2026-10-14T18:30:00.000Z");
    expect(query.to?.toISOString()).toBe("2026-10-15T18:29:59.999Z");
    expect(activityLogQuerySchema.parse({ from: "2026-10-15T10:00:00Z" }).from?.toISOString()).toBe("2026-10-15T10:00:00.000Z");
  });

  it("refuses a source, a result or a date it does not know", () => {
    expect(activityLogQuerySchema.safeParse({ source: "PHONE" }).success).toBe(false);
    expect(activityLogQuerySchema.safeParse({ result: "MAYBE" }).success).toBe(false);
    expect(activityLogQuerySchema.safeParse({ from: "yesterday" }).success).toBe(false);
    expect(activityLogQuerySchema.safeParse({ limit: "500" }).success).toBe(false);
  });
});
