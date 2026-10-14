import { z } from "zod";
import { isCalendarDate, LICENCE_TYPES, type LicenceType } from "./licences.js";
import { SOP_LANGUAGES, type SopLanguage } from "./sops.js";

// The AI part of the platform (the Claude API, 14 Oct 2026): the models, their
// prices, the names of the features, and the fixed shapes the answers must have.
// Everything here is plain data and small rules, so it is easy to read and change
// in one place, and the cost sum is unit-tested (ai.test.ts).
//
// The server does the calling (apps/api/src/ai). AI only ever suggests: a person
// checks a filled-in form, a translation keeps its original, and an explanation of
// the score uses the app's own numbers.

// ───────────────────────── Models and prices ─────────────────────────

/**
 * The models the app may use, by a short name. Checked on Anthropic's models page
 * (platform.claude.com/docs/en/about-claude/models/overview) on 14 Oct 2026.
 * Haiku is the cheap, fast one every feature starts with; Sonnet is the step up
 * when Haiku is unsure; Opus is listed for the inspection write-up (feature 5).
 */
export const AI_MODELS = {
  haiku: "claude-haiku-5-5",
  sonnet: "claude-sonnet-5-5",
  opus: "claude-opus-5-5",
} as const;
export type AiModelKey = keyof typeof AI_MODELS;
export type AiModelId = (typeof AI_MODELS)[AiModelKey];

/** US dollars per million tokens. */
export interface AiPrice {
  input: number;
  output: number;
  /** Writing to the 5-minute prompt cache. */
  cacheWrite: number;
  /** Reading from the prompt cache. */
  cacheRead: number;
}

export interface AiModelPricing {
  base: AiPrice;
  /** Haiku 5.5 only: a request whose prompt is over this many tokens pays the higher prices. */
  longPrompt?: { overTokens: number; price: AiPrice };
}

/**
 * The price list, from Anthropic's pricing page
 * (platform.claude.com/docs/en/about-claude/pricing), read on 14 Oct 2026.
 * Haiku 5.5's "from $0.10" is the price for prompts up to 100,000 tokens; a longer
 * prompt (all input tokens, cache reads and writes included) pays $0.50 / $2.50.
 * Nothing the app sends today comes near 100,000 tokens. Change the numbers here
 * if Anthropic changes its prices; every cost in the AiRequest table comes from them.
 */
export const AI_PRICES: Record<AiModelId, AiModelPricing> = {
  "claude-haiku-5-5": {
    base: { input: 0.1, output: 0.5, cacheWrite: 0.125, cacheRead: 0.01 },
    longPrompt: { overTokens: 100_000, price: { input: 0.5, output: 2.5, cacheWrite: 0.625, cacheRead: 0.05 } },
  },
  "claude-sonnet-5-5": { base: { input: 2, output: 10, cacheWrite: 2.5, cacheRead: 0.1 } },
  "claude-opus-5-5": { base: { input: 4, output: 20, cacheWrite: 5, cacheRead: 0.2 } },
};

/** The token counts Anthropic returns with each answer. */
export interface AiUsage {
  /** Input tokens after the last cache breakpoint (all of them when nothing is cached). */
  inputTokens: number;
  /** Output tokens, thinking included. */
  outputTokens: number;
  cacheWriteTokens?: number;
  cacheReadTokens?: number;
}

/**
 * What a request cost, in millionths of a US dollar, rounded up. A price in dollars
 * per million tokens is exactly millionths of a dollar per token, so the sum is
 * tokens × price. It is worked out in whole thousandths to avoid rounding errors.
 * `batch` halves it (the Batch API is 50% off), for work that can wait overnight.
 */
export function aiCostMicroUsd(model: AiModelId, usage: AiUsage, options: { batch?: boolean } = {}): number {
  const pricing = AI_PRICES[model];
  const cacheWrite = usage.cacheWriteTokens ?? 0;
  const cacheRead = usage.cacheReadTokens ?? 0;
  const prompt = usage.inputTokens + cacheWrite + cacheRead;
  const price = pricing.longPrompt && prompt > pricing.longPrompt.overTokens ? pricing.longPrompt.price : pricing.base;
  const milli = (dollarsPerMTok: number) => Math.round(dollarsPerMTok * 1000);
  const thousandths =
    usage.inputTokens * milli(price.input) +
    usage.outputTokens * milli(price.output) +
    cacheWrite * milli(price.cacheWrite) +
    cacheRead * milli(price.cacheRead);
  return Math.ceil((options.batch ? thousandths / 2 : thousandths) / 1000);
}

/** Millionths of a dollar as dollars, for showing. */
export const microUsdToUsd = (micro: number) => micro / 1_000_000;

// ───────────────────────── Features ─────────────────────────

/**
 * Every feature that uses AI, by the name used in AI_DISABLED_FEATURES, the
 * AiRequest table and the spending report. A new feature adds its name here.
 */
export const AI_FEATURES = [
  "licence-reader", // reads a licence photo or PDF into the licence form
  "translate-support", // translates the messages of a support thread for the reader
  "translate-content", // fills in the other languages of the restaurant's own checklist items, SOPs and label names
  "explain-score", // "Why this score?": three sentences from the score's own numbers
] as const;
export type AiFeature = (typeof AI_FEATURES)[number];

/** How a request ended. OFF and LIMIT never reached Anthropic. INVALID: an answer came back but failed the checks. */
export const AI_STATUSES = ["OK", "ERROR", "OFF", "LIMIT", "INVALID"] as const;
export type AiStatus = (typeof AI_STATUSES)[number];

/** What the person did with the answer, set later by the feature. */
export const AI_OUTCOMES = ["ACCEPTED", "EDITED", "DISCARDED", "HELPFUL", "NOT_HELPFUL"] as const;
export type AiOutcome = (typeof AI_OUTCOMES)[number];

/** The codes a feature answers with when AI steps aside. The app then carries on without it. */
export const AI_ERROR = {
  /** Switched off (AI_FEATURES=off, the feature named in AI_DISABLED_FEATURES, or no API key). */
  off: "AI_OFF",
  /** Today's spending limit for the whole platform or for the outlet has been reached. */
  limit: "AI_LIMIT",
  /** The call failed, or the answer did not pass the checks. */
  failed: "AI_FAILED",
} as const;
export type AiErrorCode = (typeof AI_ERROR)[keyof typeof AI_ERROR];

export const aiOutcomeSchema = z.object({ outcome: z.enum(AI_OUTCOMES) });
export type AiOutcomeInput = z.input<typeof aiOutcomeSchema>;

/** Which AI features this server has switched on, for the apps to show or hide them. */
export interface AiStatusDto {
  features: Record<AiFeature, boolean>;
}

/** Spending for a period, from the AiRequest table. */
export interface AiUsageTotalsDto {
  /** India date (YYYY-MM-DD) the period starts on. */
  from: string;
  requests: number;
  costUsd: number;
  byFeature: { feature: string; requests: number; costUsd: number; inputTokens: number; outputTokens: number }[];
}

/** ECCS's view of what AI has cost: today and this month, by feature, with the limits in force. */
export interface AiUsageDto {
  today: AiUsageTotalsDto;
  month: AiUsageTotalsDto;
  limits: { dailyUsd: number; outletDailyUsd: number };
}

// ───────────────────────── Languages ─────────────────────────

/** The app's twelve languages, lower case, as stored text is keyed. */
export const AI_LANGUAGES = SOP_LANGUAGES;
export type AiLanguage = SopLanguage;

/** A language the text may be detected as: one of the twelve, or something else. */
export const AI_SOURCE_LANGUAGES = [...SOP_LANGUAGES, "other"] as const;
export type AiSourceLanguage = (typeof AI_SOURCE_LANGUAGES)[number];

/** Each language's name in English, as the instructions to the model name it. */
export const AI_LANGUAGE_NAMES: Record<AiLanguage, string> = {
  en: "English",
  hi: "Hindi",
  te: "Telugu",
  ta: "Tamil",
  kn: "Kannada",
  ml: "Malayalam",
  mr: "Marathi",
  bn: "Bengali",
  gu: "Gujarati",
  pa: "Punjabi (Gurmukhi script)",
  or: "Odia",
  ur: "Urdu",
};

/** A translation the reader sees, with the language it was translated from. */
export interface AiTranslationDto {
  text: string;
  from: AiSourceLanguage;
}

/**
 * How a support message's translations are kept (a JSON column on the message): the
 * language it was detected as, and the translation into each reader's language.
 * Each message is translated at most once per language.
 */
export interface StoredTranslations {
  source?: AiSourceLanguage;
  to?: Partial<Record<AiLanguage, string>>;
}

/**
 * What a reader in `target` sees for a stored message: its translation, null when
 * none is needed (it is already in their language), or "missing" when it has not
 * been translated into their language yet.
 */
export function storedTranslationFor(
  stored: StoredTranslations | null | undefined,
  target: AiLanguage,
): AiTranslationDto | null | "missing" {
  if (stored?.source === target) return null;
  const text = stored?.to?.[target];
  if (text) return { text, from: stored?.source ?? "other" };
  return "missing";
}

// Scripts used by one of the app's languages only, so text written in it needs no
// call to know it is in that language. Devanagari (Hindi and Marathi) and the Latin
// alphabet (English, and Hindi or Telugu typed in English letters) are shared, so
// text in them is always sent to be detected.
const OWN_SCRIPT: Partial<Record<AiLanguage, RegExp>> = {
  te: /\p{Script=Telugu}/u,
  ta: /\p{Script=Tamil}/u,
  kn: /\p{Script=Kannada}/u,
  ml: /\p{Script=Malayalam}/u,
  bn: /\p{Script=Bengali}/u,
  gu: /\p{Script=Gujarati}/u,
  pa: /\p{Script=Gurmukhi}/u,
  or: /\p{Script=Oriya}/u,
  ur: /\p{Script=Arabic}/u,
};

/** True when the text has letters and at least 80% of them are in the script only `language` uses. */
export function writtenInOwnScript(text: string, language: AiLanguage): boolean {
  const script = OWN_SCRIPT[language];
  const letters = [...text].filter((ch) => /\p{L}/u.test(ch));
  if (!script || letters.length === 0) return false;
  return letters.filter((ch) => script.test(ch)).length / letters.length >= 0.8;
}

/**
 * True when there is something to translate: at least two letters. A number, a time
 * or an emoji alone is left as it is. (Indian scripts put vowel signs between
 * letters, so the letters are counted rather than matched side by side.)
 */
export const hasWords = (text: string) => [...text].filter((ch) => /\p{L}/u.test(ch)).length >= 2;

// ───────────────────────── Answer shapes ─────────────────────────
//
// Each answer comes back as JSON in a fixed shape (Anthropic's structured outputs,
// `output_config.format`). The JSON schema is what Anthropic is given; the Zod
// schema is what the server checks the answer against before using it, and an
// answer that does not fit is rejected. Structured outputs need every property
// listed in `required` and `additionalProperties: false`; they do not support
// minLength, maximum and the like, so those limits live in the Zod schemas.

/** A JSON schema as sent to Anthropic. */
export type AiJsonSchema = Record<string, unknown>;

const nullableString = { type: ["string", "null"] } as const;
const nullableDate = { anyOf: [{ type: "string", format: "date" }, { type: "null" }] } as const;
const isoDate = z.string().regex(/^\d{4}-\d{2}-\d{2}$/);

/** Feature 1: what was read off a licence document. null = could not read. */
export const licenceAnswerSchema = z.object({
  type: z.enum(LICENCE_TYPES).nullable(),
  number: z.string().max(200).nullable(),
  issuedTo: z.string().max(300).nullable(),
  issuedOn: isoDate.nullable(),
  expiresOn: isoDate.nullable(),
});
export type LicenceAnswer = z.infer<typeof licenceAnswerSchema>;

export const LICENCE_ANSWER_JSON_SCHEMA: AiJsonSchema = {
  type: "object",
  properties: {
    type: { enum: [...LICENCE_TYPES, null] },
    number: nullableString,
    issuedTo: nullableString,
    issuedOn: nullableDate,
    expiresOn: nullableDate,
  },
  required: ["type", "number", "issuedTo", "issuedOn", "expiresOn"],
  additionalProperties: false,
};

/**
 * Makes a licence answer safe to put in the form: a date that does not exist, or is
 * outside 1990 to 2100, becomes "could not read"; an issue date on or after the
 * expiry is dropped; spaces inside a 14-digit FSSAI number are taken out; and
 * text is cut to what the form holds.
 */
export function cleanLicenceAnswer(answer: LicenceAnswer): LicenceAnswer & { type: LicenceType | null } {
  const date = (value: string | null) =>
    value && isCalendarDate(value) && value >= "1990-01-01" && value <= "2100-12-31" ? value : null;
  const text = (value: string | null, max: number) => {
    const trimmed = value?.replace(/\s+/g, " ").trim();
    return trimmed ? trimmed.slice(0, max) : null;
  };
  let number = text(answer.number, 60);
  if (number && /^(?:\d\s?){14}$/.test(number)) number = number.replace(/\s/g, "");
  const expiresOn = date(answer.expiresOn);
  let issuedOn = date(answer.issuedOn);
  if (issuedOn && expiresOn && issuedOn >= expiresOn) issuedOn = null;
  return { type: answer.type, number, issuedTo: text(answer.issuedTo, 120), issuedOn, expiresOn };
}

/** Feature 2a: the messages of a support thread, each with the language it was in and its translation. */
export const supportTranslationSchema = z.object({
  items: z.array(
    z.object({
      id: z.string(),
      source: z.enum(AI_SOURCE_LANGUAGES),
      text: z.string().max(8000),
    }),
  ),
});
export type SupportTranslationAnswer = z.infer<typeof supportTranslationSchema>;

export const SUPPORT_TRANSLATION_JSON_SCHEMA: AiJsonSchema = {
  type: "object",
  properties: {
    items: {
      type: "array",
      items: {
        type: "object",
        properties: {
          id: { type: "string" },
          source: { enum: [...AI_SOURCE_LANGUAGES] },
          text: { type: "string" },
        },
        required: ["id", "source", "text"],
        additionalProperties: false,
      },
    },
  },
  required: ["items"],
  additionalProperties: false,
};

/**
 * Feature 2b: text the restaurant typed (an item, a checklist name, an SOP's title
 * and steps, a label name) as a list of strings, and the same list in each of the
 * languages asked for. The lists must keep the same length, so an SOP keeps one
 * step per line in every language.
 */
export function contentTranslationSchema(languages: readonly AiLanguage[]) {
  return z.object({
    source: z.enum(AI_SOURCE_LANGUAGES),
    languages: z.object(Object.fromEntries(languages.map((language) => [language, z.array(z.string().max(2000))]))),
  });
}
export interface ContentTranslationAnswer {
  source: AiSourceLanguage;
  languages: Record<string, string[]>;
}

export function contentTranslationJsonSchema(languages: readonly AiLanguage[]): AiJsonSchema {
  return {
    type: "object",
    properties: {
      source: { enum: [...AI_SOURCE_LANGUAGES] },
      languages: {
        type: "object",
        properties: Object.fromEntries(languages.map((language) => [language, { type: "array", items: { type: "string" } }])),
        required: [...languages],
        additionalProperties: false,
      },
    },
    required: ["source", "languages"],
    additionalProperties: false,
  };
}

/** Feature 3: "Why this score?" in three short sentences. */
export const scoreExplanationSchema = z.object({
  /** What pulled the score down most. */
  pulledDown: z.string().trim().min(1).max(400),
  /** The first thing to do. */
  doFirst: z.string().trim().min(1).max(400),
  /** The second thing to do, or empty when there is only one. */
  doNext: z.string().trim().max(400),
});
export type ScoreExplanationAnswer = z.infer<typeof scoreExplanationSchema>;

export const SCORE_EXPLANATION_JSON_SCHEMA: AiJsonSchema = {
  type: "object",
  properties: {
    pulledDown: { type: "string" },
    doFirst: { type: "string" },
    doNext: { type: "string" },
  },
  required: ["pulledDown", "doFirst", "doNext"],
  additionalProperties: false,
};

/** The explanation of an outlet's score as the apps show it. */
export interface ScoreExplanationDto {
  outletId: string;
  /** The India date it was written for. */
  date: string;
  /** Up to three short sentences, in the reader's language. */
  sentences: string[];
  /** The AiRequest it came from, for "Helpful?". */
  aiRequestId: string;
  /** True when it was kept from an earlier opening today (it cost nothing this time). */
  stored: boolean;
  /** What someone at the outlet answered to "Helpful?", or null. */
  helpful: boolean | null;
}

// ───────────────────────── Checking numbers ─────────────────────────

// Where each script's digit zero is in Unicode. Indian languages have digits of their
// own, and the model may write them; they are read as ordinary digits before checking.
const DIGIT_ZEROS = [0x30, 0x660, 0x6f0, 0x966, 0x9e6, 0xa66, 0xae6, 0xb66, 0xbe6, 0xc66, 0xce6, 0xd66];

/** The text with every decimal digit, in any of the scripts above, turned into 0 to 9. */
export function westernDigits(text: string): string {
  return [...text]
    .map((ch) => {
      const code = ch.codePointAt(0)!;
      const zero = DIGIT_ZEROS.find((start) => code >= start && code <= start + 9);
      return zero === undefined ? ch : String(code - zero);
    })
    .join("");
}

/** Every number written in the text, in whatever digits, as numbers ("7.5" and "7,5" are both 7.5). */
export function numbersIn(text: string): number[] {
  return [...westernDigits(text).matchAll(/\d+(?:[.,]\d+)?/g)].map((match) => Number(match[0].replace(",", ".")));
}

/**
 * The numbers in `text` that are not among `allowed`. An explanation of the score
 * must use only the app's own numbers; one that writes any other number is
 * rejected and the plain list of what is costing points is shown instead.
 */
export function unknownNumbers(text: string, allowed: readonly number[]): number[] {
  return numbersIn(text).filter((value) => !allowed.some((known) => Math.abs(known - value) < 1e-9));
}
