import { bn } from "./bn.js";
import { en, type MessageKey, type Messages } from "./en.js";
import { gu } from "./gu.js";
import { hi } from "./hi.js";
import { kn } from "./kn.js";
import { ml } from "./ml.js";
import { mr } from "./mr.js";
import { or } from "./or.js";
import { pa } from "./pa.js";
import { ta } from "./ta.js";
import { te } from "./te.js";
import { ur } from "./ur.js";

export type { MessageKey, Messages };

// The codes match the Language list in @eccs/shared and the database.
export type LanguageCode = "EN" | "HI" | "TE" | "TA" | "KN" | "ML" | "MR" | "BN" | "GU" | "PA" | "OR" | "UR";

export const MESSAGES: Record<LanguageCode, Partial<Messages>> = {
  EN: en,
  HI: hi,
  TE: te,
  TA: ta,
  KN: kn,
  ML: ml,
  MR: mr,
  BN: bn,
  GU: gu,
  PA: pa,
  OR: or,
  UR: ur,
};

/** Each language's name written in that language, for the language picker. */
export const LANGUAGE_NAMES: Record<LanguageCode, string> = {
  EN: "English",
  HI: "हिन्दी",
  TE: "తెలుగు",
  TA: "தமிழ்",
  KN: "ಕನ್ನಡ",
  ML: "മലയാളം",
  MR: "मराठी",
  BN: "বাংলা",
  GU: "ગુજરાતી",
  PA: "ਪੰਜਾਬੀ",
  OR: "ଓଡ଼ିଆ",
  UR: "اردو",
};

/** Each language's name in English, shown under its own name for whoever is helping set the phone up. */
export const LANGUAGE_ENGLISH_NAMES: Record<LanguageCode, string> = {
  EN: "English",
  HI: "Hindi",
  TE: "Telugu",
  TA: "Tamil",
  KN: "Kannada",
  ML: "Malayalam",
  MR: "Marathi",
  BN: "Bengali",
  GU: "Gujarati",
  PA: "Punjabi",
  OR: "Odia",
  UR: "Urdu",
};

/** The order languages are listed in. */
export const LANGUAGE_CODES: LanguageCode[] = ["EN", "HI", "TE", "TA", "KN", "ML", "MR", "BN", "GU", "PA", "OR", "UR"];

/** Languages written from right to left. */
export const isRightToLeft = (language: LanguageCode) => language === "UR";

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
