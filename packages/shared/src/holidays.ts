import type { LocalizedText } from "./checklists.js";

// Public holidays and festivals shown on the restaurant's calendar.
//
// SAMPLE LIST, to be checked against the Telangana government's holiday
// list before going live. Fixed-date holidays are reliable. Festival dates
// follow the lunar calendar, and Islamic holidays depend on the sighting of
// the moon and can move by a day. Kept here, in one place, until ECCS
// manages the list from the console.

export interface Holiday {
  /** YYYY-MM-DD */
  date: string;
  name: LocalizedText;
}

const h = (date: string, en: string, te: string, hi: string): Holiday => ({ date, name: { en, te, hi } });

const NEW_YEAR = ["New Year's Day", "నూతన సంవత్సరం", "नव वर्ष"] as const;
const BHOGI = ["Bhogi", "భోగి", "भोगी"] as const;
const SANKRANTI = ["Sankranti", "సంక్రాంతి", "संक्रांति"] as const;
const REPUBLIC = ["Republic Day", "గణతంత్ర దినోత్సవం", "गणतंत्र दिवस"] as const;
const SHIVARATRI = ["Maha Shivaratri", "మహా శివరాత్రి", "महाशिवरात्रि"] as const;
const HOLI = ["Holi", "హోలీ", "होली"] as const;
const UGADI = ["Ugadi", "ఉగాది", "उगादि"] as const;
const RAMZAN = ["Ramzan (Eid ul-Fitr)", "రంజాన్", "ईद-उल-फ़ित्र"] as const;
const RAMA_NAVAMI = ["Sri Rama Navami", "శ్రీరామ నవమి", "राम नवमी"] as const;
const GOOD_FRIDAY = ["Good Friday", "గుడ్ ఫ్రైడే", "गुड फ्राइडे"] as const;
const AMBEDKAR = ["Dr Ambedkar Jayanti", "డా. అంబేద్కర్ జయంతి", "डॉ. अंबेडकर जयंती"] as const;
const MAY_DAY = ["May Day", "మే డే", "मई दिवस"] as const;
const BAKRID = ["Bakrid (Eid al-Adha)", "బక్రీద్", "बकरीद"] as const;
const FORMATION = ["Telangana Formation Day", "తెలంగాణ ఆవిర్భావ దినోత్సవం", "तेलंगाना स्थापना दिवस"] as const;
const MUHARRAM = ["Muharram", "మొహర్రం", "मुहर्रम"] as const;
const INDEPENDENCE = ["Independence Day", "స్వాతంత్ర్య దినోత్సవం", "स्वतंत्रता दिवस"] as const;
const MILAD = ["Eid Milad-un-Nabi", "మిలాద్-ఉన్-నబీ", "ईद मिलाद-उन-नबी"] as const;
const JANMASHTAMI = ["Sri Krishna Janmashtami", "శ్రీకృష్ణ జన్మాష్టమి", "कृष्ण जन्माष्टमी"] as const;
const CHAVITHI = ["Vinayaka Chavithi", "వినాయక చవితి", "गणेश चतुर्थी"] as const;
const GANDHI = ["Gandhi Jayanti", "గాంధీ జయంతి", "गांधी जयंती"] as const;
const DUSSEHRA = ["Dussehra (Vijayadashami)", "దసరా (విజయదశమి)", "दशहरा"] as const;
const DIWALI = ["Diwali", "దీపావళి", "दीवाली"] as const;
const GURU_NANAK = ["Guru Nanak Jayanti", "గురునానక్ జయంతి", "गुरु नानक जयंती"] as const;
const CHRISTMAS = ["Christmas", "క్రిస్మస్", "क्रिसमस"] as const;

export const HOLIDAYS: readonly Holiday[] = [
  h("2025-10-02", ...GANDHI),
  h("2025-10-02", ...DUSSEHRA),
  h("2025-10-20", ...DIWALI),
  h("2025-11-05", ...GURU_NANAK),
  h("2025-12-25", ...CHRISTMAS),

  h("2026-01-01", ...NEW_YEAR),
  h("2026-01-14", ...BHOGI),
  h("2026-01-15", ...SANKRANTI),
  h("2026-01-26", ...REPUBLIC),
  h("2026-02-15", ...SHIVARATRI),
  h("2026-03-04", ...HOLI),
  h("2026-03-19", ...UGADI),
  h("2026-03-21", ...RAMZAN),
  h("2026-03-27", ...RAMA_NAVAMI),
  h("2026-04-03", ...GOOD_FRIDAY),
  h("2026-04-14", ...AMBEDKAR),
  h("2026-05-01", ...MAY_DAY),
  h("2026-05-27", ...BAKRID),
  h("2026-06-02", ...FORMATION),
  h("2026-06-26", ...MUHARRAM),
  h("2026-08-15", ...INDEPENDENCE),
  h("2026-08-26", ...MILAD),
  h("2026-09-04", ...JANMASHTAMI),
  h("2026-09-14", ...CHAVITHI),
  h("2026-10-02", ...GANDHI),
  h("2026-10-20", ...DUSSEHRA),
  h("2026-11-08", ...DIWALI),
  h("2026-11-24", ...GURU_NANAK),
  h("2026-12-25", ...CHRISTMAS),

  h("2027-01-01", ...NEW_YEAR),
  h("2027-01-14", ...BHOGI),
  h("2027-01-15", ...SANKRANTI),
  h("2027-01-26", ...REPUBLIC),
  h("2027-03-06", ...SHIVARATRI),
  h("2027-03-10", ...RAMZAN),
  h("2027-03-22", ...HOLI),
  h("2027-03-26", ...GOOD_FRIDAY),
  h("2027-04-07", ...UGADI),
  h("2027-04-14", ...AMBEDKAR),
  h("2027-04-15", ...RAMA_NAVAMI),
  h("2027-05-01", ...MAY_DAY),
  h("2027-05-17", ...BAKRID),
  h("2027-06-02", ...FORMATION),
  h("2027-08-15", ...INDEPENDENCE),
  h("2027-09-04", ...CHAVITHI),
  h("2027-10-02", ...GANDHI),
  h("2027-10-09", ...DUSSEHRA),
  h("2027-10-29", ...DIWALI),
  h("2027-12-25", ...CHRISTMAS),
];

/** Holidays from one date to another, both included. */
export const holidaysBetween = (from: string, to: string): Holiday[] =>
  HOLIDAYS.filter((holiday) => holiday.date >= from && holiday.date <= to);
