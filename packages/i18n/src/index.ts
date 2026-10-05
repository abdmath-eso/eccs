import { en, type MessageKey, type Messages } from "./en.js";
import { hi } from "./hi.js";
import { te } from "./te.js";

export type { MessageKey, Messages };

export type LanguageCode = "EN" | "TE" | "HI";

export const MESSAGES: Record<LanguageCode, Messages> = { EN: en, TE: te, HI: hi };

/** Each language's name written in that language, for the language picker. */
export const LANGUAGE_NAMES: Record<LanguageCode, string> = {
  EN: "English",
  TE: "తెలుగు",
  HI: "हिन्दी",
};

export const LANGUAGE_CODES: LanguageCode[] = ["EN", "TE", "HI"];

export type TranslateParams = Record<string, string | number>;

/** Looks up a message and fills in {placeholders}. Falls back to English. */
export function translate(language: LanguageCode, key: MessageKey, params?: TranslateParams): string {
  const template = MESSAGES[language][key] ?? en[key];
  if (!params) return template;
  return template.replace(/\{(\w+)\}/g, (match, name: string) =>
    name in params ? String(params[name]) : match,
  );
}

export type Translator = (key: MessageKey, params?: TranslateParams) => string;

export const createTranslator = (language: LanguageCode): Translator => (key, params) =>
  translate(language, key, params);
