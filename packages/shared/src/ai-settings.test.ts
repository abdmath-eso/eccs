import { describe, expect, it } from "vitest";
import { AI_FEATURES } from "./ai.js";
import {
  AI_ECCS_OWN_FEATURES,
  AI_HELPER_ORDER,
  AI_HELPERS,
  aiModelKeyOf,
  aiModelName,
  aiSettingChangeLine,
  aiSettingsChanges,
  aiSettingsDefaults,
  aiSettingsPatchSchema,
  aiSettingsSchema,
  applyAiSettingsPatch,
  readAiSettings,
} from "./ai-settings.js";

describe("the AI settings' defaults", () => {
  const defaults = aiSettingsDefaults();

  it("are today's .env defaults, so nothing changes on the first start (env.ts in apps/api)", () => {
    // AI_DAILY_LIMIT_USD, AI_OUTLET_DAILY_LIMIT_USD, and every BUDDY_* default.
    expect(defaults.limits).toEqual({ dailyUsd: 2, monthlyUsd: null, outletDailyUsd: 0.25 });
    expect(defaults.buddy).toEqual({ effort: "medium", thinking: "adaptive", dailyMessages: 40, perMinute: 6, blocksBeforePause: 5 });
    expect(defaults.allOn).toBe(true);
    // Every helper on, with the model its code used before this change.
    expect(Object.fromEntries(AI_FEATURES.map((feature) => [feature, defaults.helpers[feature]]))).toEqual({
      "licence-reader": { on: true, model: "haiku" },
      "translate-support": { on: true, model: "haiku" },
      "translate-content": { on: true, model: "haiku" },
      "explain-score": { on: true, model: "haiku" },
      "monitoring-digest": { on: true, model: "sonnet" },
      "inspection-summary": { on: true, model: "sonnet" },
      "photo-check": { on: true, model: "haiku" },
      "photo-standard": { on: true, model: "haiku" },
      "shop-board": { on: true, model: "haiku" },
      buddy: { on: true, model: "haiku" },
      "buddy-screen": { on: true, model: "haiku" },
    });
    // The licence reader tried Sonnet once when Haiku missed the number or expiry.
    expect(defaults.licenceReader).toEqual({ secondTry: true, secondModel: "sonnet" });
    expect(defaults.warnings).toEqual({ dayPercent: 80, monthPercent: 80, creditUnderUsd: 20 });
    expect(defaults.key).toEqual({ creditUsd: 100, loadedOn: "2026-10-14", monthlyCapUsd: null, rupeeRate: 84 });
  });

  it("take what the server's .env says where it says something", () => {
    const fromEnv = aiSettingsDefaults({ dailyLimitUsd: 3, outletDailyLimitUsd: 0.5, buddyModel: "sonnet", buddyEffort: "low", buddyThinking: "off", buddyScreen: false, buddyDailyMessages: 10, buddyPerMinute: 2, buddyBlocksBeforePause: 3 });
    expect(fromEnv.limits).toMatchObject({ dailyUsd: 3, outletDailyUsd: 0.5 });
    expect(fromEnv.helpers.buddy.model).toBe("sonnet");
    expect(fromEnv.buddy).toEqual({ effort: "low", thinking: "off", dailyMessages: 10, perMinute: 2, blocksBeforePause: 3 });
    // BUDDY_SCREEN=off is the scope check helper's own switch: one switch for one thing.
    expect(fromEnv.helpers["buddy-screen"]).toEqual({ on: false, model: "haiku" });
  });

  it("drop the old Buddy scope-check switch from a saved row, keeping the rest", () => {
    const read = readAiSettings({ buddy: { screen: false, dailyMessages: 12 } }, defaults);
    expect(read.buddy).not.toHaveProperty("screen");
    expect(read.buddy.dailyMessages).toBe(12);
  });

  it("pass their own schema", () => {
    expect(aiSettingsSchema.safeParse(defaults).success).toBe(true);
  });

  it("know every helper, and each keeps the model it was built with first", () => {
    expect([...AI_HELPER_ORDER].sort()).toEqual([...AI_FEATURES].sort());
    for (const feature of AI_FEATURES) expect(AI_HELPERS[feature].models).toContain(defaults.helpers[feature].model);
    // ECCS's own work counts against the overall limit only (STATUS, 15 Oct 2026).
    expect([...AI_ECCS_OWN_FEATURES].sort()).toEqual(["inspection-summary", "monitoring-digest", "shop-board"]);
  });
});

describe("checking the AI settings", () => {
  const defaults = aiSettingsDefaults();
  // As the server checks a change: the change itself, then the whole once it is laid over what is saved.
  const check = (change: object) => {
    const patch = aiSettingsPatchSchema.safeParse(change);
    return patch.success ? aiSettingsSchema.safeParse(applyAiSettingsPatch(defaults, patch.data)) : patch;
  };
  const message = (change: object) => {
    const result = check(change);
    return result.success ? null : result.error.issues[0]!.message;
  };

  it("refuses a model the helper does not allow", () => {
    expect(message({ helpers: { "photo-check": { model: "opus" } } })).toBe("Camera nudge cannot use Opus 5.5: choose Haiku 5.5 or Sonnet 5.5");
    expect(message({ helpers: { buddy: { model: "opus" } } })).toMatch(/^ECCS Buddy cannot use Opus 5.5/);
    // The digest and the write-up may use any of the three.
    expect(check({ helpers: { "monitoring-digest": { model: "opus" }, "inspection-summary": { model: "haiku" } } }).success).toBe(true);
  });

  it("refuses limits out of their bounds, and an outlet's limit above everyone's", () => {
    expect(message({ limits: { dailyUsd: -1 } })).toBe("The daily limit must be at least US$0");
    expect(message({ limits: { dailyUsd: 5000 } })).toBe("The daily limit can be at most US$200");
    expect(message({ limits: { monthlyUsd: 0.5 } })).toBe("The monthly limit must be at least US$1");
    expect(message({ limits: { outletDailyUsd: 3 } })).toBe("The per-outlet limit cannot be more than the daily limit for everything");
    expect(message({ warnings: { dayPercent: 5 } })).toBe("The share of the daily limit must be at least 10");
    expect(message({ buddy: { perMinute: 0 } })).toBe("Messages a minute must be at least 1");
    expect(message({ buddy: { dailyMessages: 2.5 } })).toBe("Enter messages a person a day as a whole number");
    expect(message({ key: { loadedOn: "2026-02-30" } })).toBe("That date does not exist");
    expect(message({ key: { rupeeRate: 10 } })).toBe("The rate must be at least ₹50");
    // An empty monthly limit is no monthly limit; amounts keep cents only.
    const ok = check({ limits: { monthlyUsd: null, dailyUsd: 3.456 } });
    expect(ok.success && ok.data.limits).toEqual({ dailyUsd: 3.46, monthlyUsd: null, outletDailyUsd: 0.25 });
  });

  it("refuses a second licence try on the same model as the first, and anything it does not know", () => {
    expect(message({ helpers: { "licence-reader": { model: "sonnet" } } })).toBe("The second try must use a different model from the first");
    expect(check({ helpers: { "licence-reader": { model: "sonnet" } }, licenceReader: { secondModel: "opus" } }).success).toBe(true);
    expect(check({ helpers: { "licence-reader": { model: "sonnet" } }, licenceReader: { secondTry: false } }).success).toBe(true);
    expect(aiSettingsPatchSchema.safeParse({ limitz: { dailyUsd: 1 } }).success).toBe(false);
    expect(aiSettingsPatchSchema.safeParse({ helpers: { "no-such-helper": { on: false } } }).success).toBe(false);
  });

  it("reads a stored row back safely: missing parts and models no longer allowed come from the defaults", () => {
    expect(readAiSettings(null, defaults)).toEqual(defaults);
    const stored = { allOn: false, helpers: { "photo-check": { on: false, model: "opus" } }, limits: { dailyUsd: 5 }, someday: true };
    const read = readAiSettings(stored, defaults);
    expect(read.allOn).toBe(false);
    expect(read.helpers["photo-check"]).toEqual({ on: false, model: "haiku" });
    expect(read.limits).toEqual({ dailyUsd: 5, monthlyUsd: null, outletDailyUsd: 0.25 });
    expect(read.helpers.buddy).toEqual(defaults.helpers.buddy);
  });
});

describe("what changed", () => {
  it("lists every change in words, from and to", () => {
    const before = aiSettingsDefaults();
    const after = applyAiSettingsPatch(before, aiSettingsPatchSchema.parse({ helpers: { "photo-check": { on: false, model: "sonnet" } }, limits: { dailyUsd: 3, monthlyUsd: 40 } }));
    const changes = aiSettingsChanges(before, after);
    expect(changes.map(aiSettingChangeLine)).toEqual([
      "Camera nudge: on → off",
      "Camera nudge's model: Haiku 5.5 → Sonnet 5.5",
      "Daily limit, everything: US$2.00 → US$3.00",
      "Monthly limit, everything: none → US$40.00",
    ]);
    expect(changes.map((change) => change.section)).toEqual(["helpers", "helpers", "limits", "limits"]);
    expect(aiSettingsChanges(before, before)).toEqual([]);
  });

  it("names models", () => {
    expect(aiModelKeyOf("claude-sonnet-5-5")).toBe("sonnet");
    expect(aiModelKeyOf("gpt-4")).toBeNull();
    expect(aiModelName("claude-opus-5-5")).toBe("Opus 5.5");
  });
});
