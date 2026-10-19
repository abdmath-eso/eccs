import { z } from "zod";
import { AI_FEATURES, AI_MODELS, type AiFeature, type AiModelId, type AiModelKey } from "./ai.js";
import { isCalendarDate } from "./licences.js";

// The AI settings (Stage F, 19 Oct 2026): what the founder can change in the console
// (Business > AI usage > Settings) instead of in the server's .env. Each helper's switch
// and model, the limits that refuse requests, the warnings that only tell, ECCS Buddy's
// own limits, and the facts about the key that the page's cards are worked out from.
//
// One schema checks every save, on the server and in the console's form alike. The
// defaults are today's .env values, so the first time the server starts with this
// version nothing changes. The server's AI_FEATURES=off stays the master switch above
// all of it, and a helper named in AI_DISABLED_FEATURES stays off whatever is saved here:
// the server can always switch AI off; the console can never switch it on past that.
//
// PATTERN FOLLOWED: hard spend limits that refuse requests kept apart from soft alerts
// that only warn (OpenAI's spend limits and alerts; Portkey's budget limits with a
// separate alert threshold); a model chosen per job from the models that job supports.

// ───────────────────────── Models ─────────────────────────

export const AI_MODEL_KEYS = ["haiku", "sonnet", "opus"] as const satisfies readonly AiModelKey[];

/** "Haiku 5.5": how the console names each model. */
export const AI_MODEL_LABELS: Record<AiModelKey, string> = { haiku: "Haiku 5.5", sonnet: "Sonnet 5.5", opus: "Opus 5.5" };

/** The short name of a model id ("claude-haiku-5-5" → "haiku"); null for one this version does not know. */
export function aiModelKeyOf(model: string): AiModelKey | null {
  const found = (Object.entries(AI_MODELS) as [AiModelKey, AiModelId][]).find(([, id]) => id === model);
  return found ? found[0] : null;
}

/** "Haiku 5.5" for a model id; anything unknown as it is. */
export const aiModelName = (model: string) => {
  const key = aiModelKeyOf(model);
  return key ? AI_MODEL_LABELS[key] : model;
};

// ───────────────────────── The helpers ─────────────────────────

/** What the console says about each helper, and which models its code works with. */
export interface AiHelperInfo {
  /** Its name on the page: "Camera nudge". */
  name: string;
  /** A few words under the name: "\"looks blurred, retake?\"". */
  about: string;
  /** Where it runs: "App · daily checklists". */
  where: string;
  /**
   * The models it may use, the default first. Every helper keeps the model it was built
   * and measured with; another is allowed only where the helper's code works with it.
   * Opus 5.5 cannot switch its thinking off (claude-engine.ts), so it is slower and pays
   * for thinking: it is offered only where the person is not waiting on a camera or a chat.
   */
  models: readonly AiModelKey[];
  /** ECCS's own work, not a restaurant's: it counts against the overall daily limit only, never an outlet's. */
  eccsOwn: boolean;
  /** Why it costs what it costs, for the page's plain findings ("it runs on every proof photo"). */
  why: string;
}

export const AI_HELPERS: Record<AiFeature, AiHelperInfo> = {
  "photo-check": {
    name: "Camera nudge",
    about: "“looks blurred, retake?”",
    where: "App · daily checklists",
    // The phone waits at most 8 seconds for it: Opus is too slow for that.
    models: ["haiku", "sonnet"],
    eccsOwn: false,
    why: "it runs on every checklist proof photo",
  },
  "explain-score": {
    name: "Why this score?",
    about: "two plain sentences",
    where: "App · Owner's and Manager's Home",
    models: ["haiku", "sonnet"],
    eccsOwn: false,
    why: "it is written each time a score's facts change",
  },
  "monitoring-digest": {
    name: "Daily digest",
    about: "which outlets need attention",
    where: "Console · Monitoring",
    models: ["sonnet", "opus", "haiku"],
    eccsOwn: true,
    why: "it reads the whole board, once a day and on Update",
  },
  "licence-reader": {
    name: "Read a licence",
    about: "licence photo or PDF into the form",
    where: "App and console · Licences",
    models: ["haiku", "sonnet"],
    eccsOwn: false,
    why: "a photo or PDF is a large request, and a hard one is read twice",
  },
  "translate-support": {
    name: "Translate support",
    about: "support messages, for the reader",
    where: "App and console · Support",
    models: ["haiku", "sonnet"],
    eccsOwn: false,
    why: "each message is translated once per language",
  },
  "translate-content": {
    name: "Translate own text",
    about: "checklist items, SOPs, labels",
    where: "App, and hourly in the background",
    models: ["haiku", "sonnet"],
    eccsOwn: false,
    why: "each text is filled in for eleven languages",
  },
  "inspection-summary": {
    name: "Inspection write-up",
    about: "“Draft with AI”",
    where: "Supervisor's app · inspection",
    models: ["sonnet", "opus", "haiku"],
    eccsOwn: true,
    why: "it is the dearest per use, on the stronger model",
  },
  "photo-standard": {
    name: "Photo standard",
    about: "what each item's photo must show",
    where: "Background · checklist items",
    models: ["haiku", "sonnet"],
    eccsOwn: false,
    why: "it is written once for each new photo item",
  },
  "shop-board": {
    name: "Shop-board reader",
    about: "a BDE's new lead from a photo",
    where: "BDE's app · Log a lead",
    models: ["haiku", "sonnet"],
    eccsOwn: true,
    why: "each board photo is a large request",
  },
  buddy: {
    name: "ECCS Buddy",
    about: "the helper's answers",
    where: "App · ECCS Buddy",
    // Measured on Haiku and Sonnet only (16 Oct 2026); Opus cannot switch thinking off, which Buddy's "Thinking off" needs.
    models: ["haiku", "sonnet"],
    eccsOwn: false,
    why: "each message takes a few steps, with the app guide sent each time",
  },
  "buddy-screen": {
    name: "Buddy's scope check",
    about: "is the message about the restaurant?",
    where: "App · ECCS Buddy",
    // It must answer within 8 seconds, beside Buddy's first step.
    models: ["haiku", "sonnet"],
    eccsOwn: false,
    why: "it checks every message sent to Buddy",
  },
};

/** The helpers in the order the page lists them when nothing has been spent: the design's order, then the rest. */
export const AI_HELPER_ORDER: readonly AiFeature[] = [
  "photo-check",
  "explain-score",
  "monitoring-digest",
  "licence-reader",
  "translate-support",
  "translate-content",
  "inspection-summary",
  "photo-standard",
  "shop-board",
  "buddy",
  "buddy-screen",
];

/** ECCS's own work: counts against the overall daily limit only (15 Oct 2026). */
export const AI_ECCS_OWN_FEATURES: readonly AiFeature[] = AI_FEATURES.filter((feature) => AI_HELPERS[feature].eccsOwn);

/** The models the licence reader may try again with when the first could not read the number or the expiry date. */
export const LICENCE_SECOND_MODELS = ["sonnet", "opus"] as const satisfies readonly AiModelKey[];

// ───────────────────────── The settings ─────────────────────────

/** The bounds every limit is checked against: wide enough for real use, narrow enough to catch a slip of the keyboard. */
export const AI_SETTINGS_RULES = {
  dailyUsd: { min: 0, max: 200 },
  monthlyUsd: { min: 1, max: 5000 },
  outletDailyUsd: { min: 0, max: 50 },
  percent: { min: 10, max: 100 },
  creditUnderUsd: { min: 0, max: 1000 },
  creditUsd: { min: 0, max: 100_000 },
  monthlyCapUsd: { min: 0, max: 100_000 },
  rupeeRate: { min: 50, max: 200 },
  buddyDailyMessages: { min: 0, max: 500 },
  buddyPerMinute: { min: 1, max: 60 },
  buddyBlocks: { min: 1, max: 50 },
  /** How many changes the settings keep for the page's "Latest changes". */
  historyKept: 30,
} as const;

const money = (bounds: { min: number; max: number }, what: string) =>
  z
    .number({ error: `Enter ${what} in US dollars` })
    .finite()
    .min(bounds.min, `${what[0]!.toUpperCase()}${what.slice(1)} must be at least US$${bounds.min}`)
    .max(bounds.max, `${what[0]!.toUpperCase()}${what.slice(1)} can be at most US$${bounds.max}`)
    // Cents are the finest a limit is set in.
    .transform((value) => Math.round(value * 100) / 100);

const whole = (bounds: { min: number; max: number }, what: string) =>
  z
    .number({ error: `Enter ${what} as a number` })
    .int(`Enter ${what} as a whole number`)
    .min(bounds.min, `${what[0]!.toUpperCase()}${what.slice(1)} must be at least ${bounds.min}`)
    .max(bounds.max, `${what[0]!.toUpperCase()}${what.slice(1)} can be at most ${bounds.max}`);

const helperSchema = z.object({ on: z.boolean(), model: z.enum(AI_MODEL_KEYS) });

export const BUDDY_EFFORTS = ["low", "medium", "high"] as const;
export const BUDDY_THINKING_CHOICES = ["adaptive", "off"] as const;

const sectionShapes = {
  helpers: z.record(z.enum(AI_FEATURES), helperSchema),
  licenceReader: z.object({ secondTry: z.boolean(), secondModel: z.enum(LICENCE_SECOND_MODELS) }),
  buddy: z.object({
    effort: z.enum(BUDDY_EFFORTS),
    thinking: z.enum(BUDDY_THINKING_CHOICES),
    // Buddy's scope check has no switch here: it is the "Buddy's scope check" helper's own
    // switch (one switch for one thing, 19 Oct 2026; BUDDY_SCREEN=off in .env is its default).
    dailyMessages: whole(AI_SETTINGS_RULES.buddyDailyMessages, "messages a person a day"),
    perMinute: whole(AI_SETTINGS_RULES.buddyPerMinute, "messages a minute"),
    blocksBeforePause: whole(AI_SETTINGS_RULES.buddyBlocks, "refusals before the pause"),
  }),
  limits: z.object({
    dailyUsd: money(AI_SETTINGS_RULES.dailyUsd, "the daily limit"),
    /** Empty: no monthly limit. */
    monthlyUsd: money(AI_SETTINGS_RULES.monthlyUsd, "the monthly limit").nullable(),
    outletDailyUsd: money(AI_SETTINGS_RULES.outletDailyUsd, "the per-outlet limit"),
  }),
  warnings: z.object({
    dayPercent: whole(AI_SETTINGS_RULES.percent, "the share of the daily limit"),
    monthPercent: whole(AI_SETTINGS_RULES.percent, "the share of the monthly limit"),
    creditUnderUsd: money(AI_SETTINGS_RULES.creditUnderUsd, "the credit warning"),
  }),
  key: z.object({
    creditUsd: money(AI_SETTINGS_RULES.creditUsd, "the credit loaded"),
    loadedOn: z.string().regex(/^\d{4}-\d{2}-\d{2}$/, "Enter the date as YYYY-MM-DD").refine(isCalendarDate, "That date does not exist"),
    /** The monthly spend cap set in Anthropic's console: shown only, never enforced here (Anthropic enforces it). */
    monthlyCapUsd: money(AI_SETTINGS_RULES.monthlyCapUsd, "the monthly cap").nullable(),
    /** Rupees to one US dollar, for showing costs in ₹. */
    rupeeRate: z
      .number({ error: "Enter the rupee rate as a number" })
      .finite()
      .min(AI_SETTINGS_RULES.rupeeRate.min, `The rate must be at least ₹${AI_SETTINGS_RULES.rupeeRate.min}`)
      .max(AI_SETTINGS_RULES.rupeeRate.max, `The rate can be at most ₹${AI_SETTINGS_RULES.rupeeRate.max}`)
      .transform((value) => Math.round(value * 100) / 100),
  }),
};

/** Checks that apply across fields: a model the helper allows, a second try on another model, the outlet's limit within everyone's. */
function crossChecks(settings: Partial<AiSettingsShape>, context: z.RefinementCtx) {
  for (const feature of AI_FEATURES) {
    const chosen = settings.helpers?.[feature]?.model;
    if (chosen && !AI_HELPERS[feature].models.includes(chosen)) {
      context.addIssue({
        code: "custom",
        path: ["helpers", feature, "model"],
        message: `${AI_HELPERS[feature].name} cannot use ${AI_MODEL_LABELS[chosen]}: choose ${AI_HELPERS[feature].models.map((key) => AI_MODEL_LABELS[key]).join(" or ")}`,
      });
    }
  }
  const reader = settings.licenceReader;
  if (reader?.secondTry && settings.helpers?.["licence-reader"]?.model === reader.secondModel) {
    context.addIssue({ code: "custom", path: ["licenceReader", "secondModel"], message: "The second try must use a different model from the first" });
  }
  const limits = settings.limits;
  if (limits && limits.outletDailyUsd > limits.dailyUsd) {
    context.addIssue({ code: "custom", path: ["limits", "outletDailyUsd"], message: "The per-outlet limit cannot be more than the daily limit for everything" });
  }
}

const settingsObject = z.object({
  /** The console's own main switch for every helper (below the server's AI_FEATURES). */
  allOn: z.boolean(),
  ...sectionShapes,
});
type AiSettingsShape = z.output<typeof settingsObject>;

/** Every AI setting, as kept in the AiSettings row and changed from the console. */
export const aiSettingsSchema = settingsObject.superRefine(crossChecks);
export type AiSettings = z.output<typeof aiSettingsSchema>;
export type AiHelperSetting = AiSettings["helpers"][AiFeature];

/**
 * A change from the console: any part of the settings. It is laid over what is saved,
 * and the whole is then checked with `aiSettingsSchema`, so a change can never leave a
 * combination the schema refuses.
 */
const patchShape = z.object({
  allOn: z.boolean().optional(),
  helpers: z.partialRecord(z.enum(AI_FEATURES), helperSchema.partial()).optional(),
  licenceReader: sectionShapes.licenceReader.partial().optional(),
  buddy: sectionShapes.buddy.partial().optional(),
  limits: sectionShapes.limits.partial().optional(),
  warnings: sectionShapes.warnings.partial().optional(),
  key: sectionShapes.key.partial().optional(),
});
/** Unknown fields are refused, so a misspelt setting is never silently ignored. */
export const aiSettingsPatchSchema = patchShape.strict();
export type AiSettingsPatch = z.input<typeof aiSettingsPatchSchema>;

/** The saved settings with a change laid over them (not yet checked). */
export function applyAiSettingsPatch(current: AiSettings, patch: z.output<typeof aiSettingsPatchSchema>): AiSettings {
  const helpers = { ...current.helpers };
  for (const [feature, change] of Object.entries(patch.helpers ?? {}) as [AiFeature, Partial<AiHelperSetting>][]) {
    helpers[feature] = { ...helpers[feature], ...change };
  }
  return {
    allOn: patch.allOn ?? current.allOn,
    helpers,
    licenceReader: { ...current.licenceReader, ...patch.licenceReader },
    buddy: { ...current.buddy, ...patch.buddy },
    limits: { ...current.limits, ...patch.limits },
    warnings: { ...current.warnings, ...patch.warnings },
    key: { ...current.key, ...patch.key },
  };
}

/**
 * What the server's .env says, for the defaults. Each is optional: what is left out takes
 * the value .env would give when it is not set (env.ts in apps/api).
 */
export interface AiSettingsServerDefaults {
  dailyLimitUsd?: number;
  outletDailyLimitUsd?: number;
  buddyModel?: "haiku" | "sonnet";
  buddyEffort?: (typeof BUDDY_EFFORTS)[number];
  buddyThinking?: (typeof BUDDY_THINKING_CHOICES)[number];
  buddyScreen?: boolean;
  buddyDailyMessages?: number;
  buddyPerMinute?: number;
  buddyBlocksBeforePause?: number;
}

/** When the founder loaded the US$100 of credit for testing (STATUS, 14 Oct 2026). */
export const AI_KEY_DEFAULTS = { creditUsd: 100, loadedOn: "2026-10-14", rupeeRate: 84 } as const;

/**
 * The settings before anything is saved: every helper on with the model it was built
 * with, and today's .env values (AI_DAILY_LIMIT_USD 2, AI_OUTLET_DAILY_LIMIT_USD 0.25,
 * BUDDY_* as in env.ts), so the first start with this version changes nothing.
 */
export function aiSettingsDefaults(server: AiSettingsServerDefaults = {}): AiSettings {
  const helpers = Object.fromEntries(AI_FEATURES.map((feature) => [feature, { on: true, model: AI_HELPERS[feature].models[0]! }])) as AiSettings["helpers"];
  if (server.buddyModel) helpers.buddy = { on: true, model: server.buddyModel };
  if (server.buddyScreen === false) helpers["buddy-screen"] = { ...helpers["buddy-screen"], on: false };
  return {
    allOn: true,
    helpers,
    licenceReader: { secondTry: true, secondModel: "sonnet" },
    buddy: {
      effort: server.buddyEffort ?? "medium",
      thinking: server.buddyThinking ?? "adaptive",
      dailyMessages: server.buddyDailyMessages ?? 40,
      perMinute: server.buddyPerMinute ?? 6,
      blocksBeforePause: server.buddyBlocksBeforePause ?? 5,
    },
    limits: { dailyUsd: server.dailyLimitUsd ?? 2, monthlyUsd: null, outletDailyUsd: server.outletDailyLimitUsd ?? 0.25 },
    warnings: { dayPercent: 80, monthPercent: 80, creditUnderUsd: 20 },
    key: { creditUsd: AI_KEY_DEFAULTS.creditUsd, loadedOn: AI_KEY_DEFAULTS.loadedOn, monthlyCapUsd: null, rupeeRate: AI_KEY_DEFAULTS.rupeeRate },
  };
}

/**
 * Settings read back from the database: checked, with anything missing or no longer
 * valid (a helper added since, a model a helper no longer allows) taken from the
 * defaults, so a stored row can never stop the AI from working.
 */
export function readAiSettings(stored: unknown, defaults: AiSettings): AiSettings {
  if (!stored || typeof stored !== "object") return defaults;
  // Fields this version does not know (written by a newer one) are left aside.
  const parsed = patchShape.safeParse(stored);
  if (!parsed.success) return defaults;
  const merged = applyAiSettingsPatch(defaults, parsed.data);
  for (const feature of AI_FEATURES) {
    if (!AI_HELPERS[feature].models.includes(merged.helpers[feature].model)) merged.helpers[feature] = { ...merged.helpers[feature], model: defaults.helpers[feature].model };
  }
  const checked = aiSettingsSchema.safeParse(merged);
  return checked.success ? checked.data : defaults;
}

// ───────────────────────── What changed ─────────────────────────

/** The groups of the Settings section, each with its own "last changed". */
export const AI_SETTINGS_SECTIONS = ["all", "helpers", "limits", "warnings", "buddy", "key"] as const;
export type AiSettingsSection = (typeof AI_SETTINGS_SECTIONS)[number];

export const AI_SETTINGS_SECTION_LABELS: Record<AiSettingsSection, string> = {
  all: "All helpers",
  helpers: "Each helper",
  limits: "Limits",
  warnings: "Warnings",
  buddy: "ECCS Buddy",
  key: "About the key",
};

/** One setting changed: which, and from what to what, in words. */
export interface AiSettingChange {
  section: AiSettingsSection;
  label: string;
  from: string;
  to: string;
}

const dollars = (value: number | null) => (value === null ? "none" : `US$${value.toFixed(2)}`);
const onOff = (value: boolean) => (value ? "on" : "off");

/**
 * Every setting that differs between two versions, in words for the activity log and the
 * page's "Latest changes" ("Camera nudge: model Haiku 5.5 → Sonnet 5.5"). Nothing here is
 * secret: switches, models, amounts and dates.
 */
export function aiSettingsChanges(before: AiSettings, after: AiSettings): AiSettingChange[] {
  const changes: AiSettingChange[] = [];
  const add = (section: AiSettingsSection, label: string, from: string, to: string) => {
    if (from !== to) changes.push({ section, label, from, to });
  };
  add("all", "All AI helpers", onOff(before.allOn), onOff(after.allOn));
  for (const feature of AI_HELPER_ORDER) {
    const name = AI_HELPERS[feature].name;
    add("helpers", name, onOff(before.helpers[feature].on), onOff(after.helpers[feature].on));
    add("helpers", `${name}'s model`, AI_MODEL_LABELS[before.helpers[feature].model], AI_MODEL_LABELS[after.helpers[feature].model]);
  }
  add("helpers", "Read a licence: second try", onOff(before.licenceReader.secondTry), onOff(after.licenceReader.secondTry));
  add("helpers", "Read a licence: second try's model", AI_MODEL_LABELS[before.licenceReader.secondModel], AI_MODEL_LABELS[after.licenceReader.secondModel]);
  add("limits", "Daily limit, everything", dollars(before.limits.dailyUsd), dollars(after.limits.dailyUsd));
  add("limits", "Monthly limit, everything", dollars(before.limits.monthlyUsd), dollars(after.limits.monthlyUsd));
  add("limits", "Daily limit, per outlet", dollars(before.limits.outletDailyUsd), dollars(after.limits.outletDailyUsd));
  add("warnings", "Warn when a day passes", `${before.warnings.dayPercent}%`, `${after.warnings.dayPercent}%`);
  add("warnings", "Warn when the month passes", `${before.warnings.monthPercent}%`, `${after.warnings.monthPercent}%`);
  add("warnings", "Warn when credit falls under", dollars(before.warnings.creditUnderUsd), dollars(after.warnings.creditUnderUsd));
  add("buddy", "Buddy: effort", before.buddy.effort, after.buddy.effort);
  add("buddy", "Buddy: thinking", before.buddy.thinking, after.buddy.thinking);
  add("buddy", "Buddy: messages a person a day", String(before.buddy.dailyMessages), String(after.buddy.dailyMessages));
  add("buddy", "Buddy: messages a minute", String(before.buddy.perMinute), String(after.buddy.perMinute));
  add("buddy", "Buddy: refusals before the pause", String(before.buddy.blocksBeforePause), String(after.buddy.blocksBeforePause));
  add("key", "Credit loaded", dollars(before.key.creditUsd), dollars(after.key.creditUsd));
  add("key", "Credit loaded on", before.key.loadedOn, after.key.loadedOn);
  add("key", "Monthly cap in Anthropic's console", dollars(before.key.monthlyCapUsd), dollars(after.key.monthlyCapUsd));
  add("key", "Rupee rate", `₹${before.key.rupeeRate}`, `₹${after.key.rupeeRate}`);
  return changes;
}

/** A change as one short line: "Daily limit, everything: US$2.00 → US$3.00". */
export const aiSettingChangeLine = (change: Pick<AiSettingChange, "label" | "from" | "to">) => `${change.label}: ${change.from} → ${change.to}`;

// ───────────────────────── What the console is sent ─────────────────────────

export interface AiSettingsHistoryEntryDto {
  at: string;
  by: string;
  role: string | null;
  changes: AiSettingChange[];
}

/** The Settings section: what is saved, what the server allows, and who changed what. */
export interface AiSettingsDto {
  settings: AiSettings;
  /** The Super Admin may change them; the Ops Manager sees them read-only. */
  canChange: boolean;
  server: {
    /** AI_FEATURES in the server's .env: "off" switches every helper off, whatever is set here. */
    aiOn: boolean;
    /** Whether the server has an API key (without one every helper is off). Never the key. */
    keySet: boolean;
    /** "fake" on a test server. */
    engine: "real" | "fake";
    /** Helpers switched off in the server's .env (AI_DISABLED_FEATURES), which the console cannot switch on. */
    disabled: AiFeature[];
    /** A test copy of the server that takes its limits and Buddy settings from its own .env (AI_SETTINGS_FROM_ENV). */
    fromEnv: boolean;
  };
  /** Who last changed each group, or null when it is still at its defaults. */
  sections: Record<AiSettingsSection, { at: string; by: string } | null>;
  /** The latest changes, newest first. */
  history: AiSettingsHistoryEntryDto[];
}
