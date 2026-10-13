// The vendor directory: the wholesalers and distributors a restaurant buys from
// (vegetables, rice and dal, dairy, meat, packaging, gas and so on), listed for
// the Owner and the Manager with the nearest to their outlet first.
//
// This file holds the rules with no database or phone code in it, so they can
// be unit-tested: the categories, how the list is sorted and searched, and the
// links behind the Call, WhatsApp and Directions buttons.
//
// The pattern is the one store locators use (the guides by MetaLocator,
// TravelTime, Storepoint and Bullseye agree on it): nearest first by default,
// the distance on every row, filters that match how people choose, and Call
// and Directions as buttons so nobody copies a number out by hand.
//
// ECCS lists these vendors for convenience and does not vouch for them. Every
// vendor loaded so far is a sample (`isSample`), and the app never dials one.

import { localize, type LocalizedText } from "./checklists.js";
import { metresBetween } from "./photo-integrity.js";
import type { Language } from "./roles.js";

/**
 * What a vendor sells. The groups are the ones restaurants already think in:
 * they follow the sections of Zomato's Hyperpure, the supplies app for
 * restaurants (fruits and vegetables, groceries, dairy, poultry, meats and
 * seafood, frozen, packaging, kitchen essentials), with the things a kitchen
 * also buys locally added (spices, bakery, cleaning supplies, gas and
 * charcoal, water and ice).
 *
 * These codes are stored in the database: add new ones, never rename one (the
 * words shown for them are in packages/i18n and can change freely).
 */
export const VENDOR_CATEGORIES = [
  "VEGETABLES_FRUITS",
  "GROCERY_STAPLES", // rice, dal, atta, oil
  "SPICES",
  "DAIRY",
  "POULTRY_EGGS",
  "MEAT",
  "SEAFOOD",
  "FROZEN",
  "BAKERY",
  "PACKAGING",
  "CLEANING_SUPPLIES",
  "GAS_FUEL", // cylinders, charcoal
  "KITCHEN_EQUIPMENT",
  "WATER_ICE",
] as const;
export type VendorCategory = (typeof VENDOR_CATEGORIES)[number];

/**
 * The categories that are food. FSSAI's licence is for whoever handles food, so
 * "No FSSAI number on file" is only said of a vendor with at least one of these:
 * a gas agency or a steel fabricator has no such number to give, and a warning
 * on them would be noise. Water and ice count: drinking water and ice that goes
 * into a glass are food.
 */
export const VENDOR_FOOD_CATEGORIES: readonly VendorCategory[] = [
  "VEGETABLES_FRUITS",
  "GROCERY_STAPLES",
  "SPICES",
  "DAIRY",
  "POULTRY_EGGS",
  "MEAT",
  "SEAFOOD",
  "FROZEN",
  "BAKERY",
  "WATER_ICE",
];

/** True when the vendor sells any food at all, and so should have an FSSAI number to show. */
export const sellsFood = (vendor: { categories: readonly VendorCategory[] }) =>
  vendor.categories.some((category) => VENDOR_FOOD_CATEGORIES.includes(category));

/** Keeps only the categories this version knows, in the order they were stored. */
export function readVendorCategories(stored: readonly string[]): VendorCategory[] {
  return stored.filter((code): code is VendorCategory => (VENDOR_CATEGORIES as readonly string[]).includes(code));
}

/** The numbers the directory depends on, in one place. Sample values chosen while building. */
export const VENDOR_RULES = {
  /**
   * A vendor within this distance of the outlet, in a straight line, counts as
   * "near your restaurant" and is listed in the first group. 5 km is about a
   * quarter of an hour by road in Hyderabad, close enough to collect from.
   */
  nearbyMetres: 5000,
  /**
   * The most vendors sent to the app in one list. The whole directory is sent
   * and the phone searches it, which stays quick up to a few hundred rows;
   * beyond this the search must move to the server.
   */
  maxListed: 500,
} as const;

/** One vendor as the app shows it. */
export interface VendorDto {
  id: string;
  name: string;
  categories: VendorCategory[];
  /** What they sell, in a line: "Onions, potatoes, tomatoes and leafy vegetables, by the sack". */
  sells: LocalizedText | null;
  /** The locality, e.g. "Bowenpally". */
  area: string;
  city: string;
  address: string | null;
  /** Where the shop is. Both empty when nobody has saved its place: there is then no distance and no Directions. */
  latitude: number | null;
  longitude: number | null;
  phone: string | null;
  whatsapp: string | null;
  /** True if they bring the goods to the restaurant; false if the restaurant collects. */
  delivers: boolean;
  /** The smallest order they deliver, in paise; empty when they set none. */
  minOrderPaise: number | null;
  /** When they are open, in words: "4 am to 11 am, closed on Sunday". */
  hours: LocalizedText | null;
  /** Their FSSAI licence or registration number as they gave it. ECCS has not checked it. */
  fssaiNumber: string | null;
  /** True for an invented vendor loaded for trying the app. Its numbers are not real and are never dialled. */
  isSample: boolean;
  /** Metres from the outlet in view, in a straight line; empty when either place is not known. */
  distanceMetres: number | null;
}

/** The directory as seen from one outlet. */
export interface VendorDirectoryDto {
  outletId: string;
  /** False when ECCS has not saved where the outlet is: the list is then in name order, with no distances. */
  outletHasPlace: boolean;
  /** `VENDOR_RULES.nearbyMetres`, sent along so the app and the server never disagree on what "near" is. */
  nearbyMetres: number;
  /** Nearest first; in name order when the outlet has no saved place. */
  vendors: VendorDto[];
}

/** A point on the map. */
export interface VendorPlace {
  latitude: number;
  longitude: number;
}

const byName = (a: { name: string }, b: { name: string }) => a.name.localeCompare(b.name, "en", { sensitivity: "base" });

/**
 * Puts vendors in the order they are listed, and works out how far each is.
 *
 * With a place (the outlet's): nearest first, which is what every store
 * locator does by default, because distance is the first thing people choose
 * by. Two at the same distance go by name. A vendor whose own place is not
 * known cannot be measured, so it goes after all the measured ones, by name,
 * with no distance.
 *
 * With no place: by name, and nobody gets a distance.
 */
export function sortVendors<T extends { name: string; latitude: number | null; longitude: number | null }>(
  vendors: readonly T[],
  place: VendorPlace | null,
): (T & { distanceMetres: number | null })[] {
  const measured = vendors.map((vendor) => ({
    ...vendor,
    distanceMetres:
      place && vendor.latitude !== null && vendor.longitude !== null
        ? metresBetween(place.latitude, place.longitude, vendor.latitude, vendor.longitude)
        : null,
  }));
  return measured.sort((a, b) => {
    if (a.distanceMetres === null || b.distanceMetres === null) {
      if (a.distanceMetres !== null) return -1;
      if (b.distanceMetres !== null) return 1;
      return byName(a, b);
    }
    return a.distanceMetres - b.distanceMetres || byName(a, b);
  });
}

/** True for a vendor close enough to count as "near your restaurant". */
export const isNearby = (vendor: { distanceMetres: number | null }, nearbyMetres: number = VENDOR_RULES.nearbyMetres) =>
  vendor.distanceMetres !== null && vendor.distanceMetres <= nearbyMetres;

export interface VendorFilter {
  /** What was typed in the search box. Empty matches everyone. */
  query?: string | null;
  /** The category chip chosen; empty for "All". */
  category?: VendorCategory | null;
  /** The language the screen is in, for the "sells" line. */
  language: Language;
  /**
   * Other words shown on the vendor's row that should be findable too: the
   * names of its categories in the reader's language, which only the app's
   * dictionary knows. Without them someone typing in Telugu finds nothing,
   * because a vendor's name and area are kept in English.
   */
  alsoSearch?: readonly string[];
}

/**
 * Does this vendor belong in the list for what was typed and the chip chosen?
 *
 * The search ignores capitals and looks in the name, the area, the city and
 * the "sells" line. Every word typed must be found somewhere, in any order, so
 * "rice begum" finds the rice merchant in Begum Bazaar.
 */
export function vendorMatches(
  vendor: Pick<VendorDto, "name" | "area" | "city" | "sells" | "categories">,
  filter: VendorFilter,
): boolean {
  if (filter.category && !vendor.categories.includes(filter.category)) return false;
  const words = (filter.query ?? "").toLowerCase().split(/\s+/).filter(Boolean);
  if (words.length === 0) return true;
  const text = [vendor.name, vendor.area, vendor.city, localize(vendor.sells, filter.language), ...(filter.alsoSearch ?? [])]
    .join(" ")
    .toLowerCase();
  return words.every((word) => text.includes(word));
}

// ───────────────────────── The buttons on a row ─────────────────────────

/**
 * Opens directions to a point in Google Maps (the app if the phone has it,
 * the website otherwise), starting from wherever the phone is. This is the
 * address Google documents for it ("Maps URLs").
 */
export const directionsUrl = (latitude: number, longitude: number) =>
  `https://www.google.com/maps/dir/?api=1&destination=${latitude},${longitude}`;

/** Opens a WhatsApp chat with a number. WhatsApp wants the digits only, country code first, with no "+" or spaces. */
export const whatsappUrl = (number: string) => `https://wa.me/${number.replace(/\D/g, "")}`;

/** Starts a phone call. Spaces and dashes are dropped; a leading "+" is kept. */
export const telUrl = (number: string) => `tel:${number.replace(/[^\d+]/g, "")}`;

/** The three things a row offers, in the order the buttons are shown. */
export const VENDOR_ACTIONS = ["CALL", "WHATSAPP", "DIRECTIONS"] as const;
export type VendorAction = (typeof VENDOR_ACTIONS)[number];

type VendorContact = Pick<VendorDto, "phone" | "whatsapp" | "latitude" | "longitude" | "isSample">;

/** The buttons a vendor gets: Call with a phone number, WhatsApp with a WhatsApp number, Directions with a saved place. */
export function vendorActions(vendor: VendorContact): VendorAction[] {
  return VENDOR_ACTIONS.filter((action) =>
    action === "CALL"
      ? Boolean(vendor.phone)
      : action === "WHATSAPP"
        ? Boolean(vendor.whatsapp)
        : vendor.latitude !== null && vendor.longitude !== null,
  );
}

/**
 * The link a button opens, or `null` when it must open nothing.
 *
 * A SAMPLE VENDOR IS NEVER DIALLED. Its numbers are invented, so a made-up
 * number could turn out to be a stranger's phone: for a sample, Call and
 * WhatsApp give no link at all, and the app says "this is a sample vendor"
 * instead. Directions is only a place on the map, so it still opens.
 * This is the one place that rule is decided; the screens only ask here.
 */
export function vendorActionUrl(vendor: VendorContact, action: VendorAction): string | null {
  if (action === "DIRECTIONS") {
    return vendor.latitude !== null && vendor.longitude !== null ? directionsUrl(vendor.latitude, vendor.longitude) : null;
  }
  if (vendor.isSample) return null;
  if (action === "CALL") return vendor.phone ? telUrl(vendor.phone) : null;
  return vendor.whatsapp ? whatsappUrl(vendor.whatsapp) : null;
}
