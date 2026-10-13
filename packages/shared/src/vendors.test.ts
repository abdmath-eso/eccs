import { describe, expect, it } from "vitest";
import { metresBetween } from "./photo-integrity.js";
import {
  VENDOR_CATEGORIES,
  VENDOR_RULES,
  directionsUrl,
  isNearby,
  readVendorCategories,
  sellsFood,
  sortVendors,
  telUrl,
  vendorActionUrl,
  vendorActions,
  vendorMatches,
  whatsappUrl,
  type VendorCategory,
} from "./vendors.js";

// The Kukatpally sample outlet's saved place.
const outlet = { latitude: 17.4849, longitude: 78.4138 };

const at = (name: string, latitude: number | null, longitude: number | null) => ({ name, latitude, longitude });

describe("VENDOR_CATEGORIES", () => {
  it("has each category once", () => {
    expect(new Set(VENDOR_CATEGORIES).size).toBe(VENDOR_CATEGORIES.length);
    expect(VENDOR_CATEGORIES).toHaveLength(14);
  });

  it("drops a stored category this version does not know", () => {
    expect(readVendorCategories(["DAIRY", "ROBOTS", "MEAT"])).toEqual(["DAIRY", "MEAT"]);
    expect(readVendorCategories([])).toEqual([]);
  });

  it("knows who sells food, and so should have an FSSAI number to show", () => {
    expect(sellsFood({ categories: ["DAIRY"] })).toBe(true);
    expect(sellsFood({ categories: ["WATER_ICE"] })).toBe(true);
    // Packaging with a little grocery on the side still handles food.
    expect(sellsFood({ categories: ["PACKAGING", "GROCERY_STAPLES"] })).toBe(true);
    // A gas agency, a steel fabricator and a packaging shop do not.
    expect(sellsFood({ categories: ["GAS_FUEL"] })).toBe(false);
    expect(sellsFood({ categories: ["KITCHEN_EQUIPMENT", "CLEANING_SUPPLIES"] })).toBe(false);
    expect(sellsFood({ categories: ["PACKAGING"] })).toBe(false);
  });
});

describe("sortVendors", () => {
  const near = at("Zed Dairy", 17.4949, 78.4138); // 0.01 degrees north: about 1.1 km
  const far = at("Alpha Rice", 17.385, 78.4867); // the old city: about 13.5 km
  const middle = at("Mid Gas", 17.4849, 78.4438); // 0.03 degrees east: about 3.2 km
  const unplacedB = at("Bravo Ice", null, null);
  const unplacedA = at("apple Packaging", null, null);

  it("lists the nearest first and says how far each is", () => {
    const sorted = sortVendors([far, unplacedB, near, middle], outlet);
    expect(sorted.map((vendor) => vendor.name)).toEqual(["Zed Dairy", "Mid Gas", "Alpha Rice", "Bravo Ice"]);
    expect(sorted[0]!.distanceMetres).toBe(1112);
    expect(sorted[1]!.distanceMetres).toBe(metresBetween(outlet.latitude, outlet.longitude, middle.latitude!, middle.longitude!));
    expect(sorted[2]!.distanceMetres).toBeGreaterThan(13_000);
    expect(sorted[2]!.distanceMetres).toBeLessThan(14_000);
  });

  it("puts vendors with no saved place last, by name, with no distance", () => {
    const sorted = sortVendors([unplacedB, far, unplacedA], outlet);
    expect(sorted.map((vendor) => vendor.name)).toEqual(["Alpha Rice", "apple Packaging", "Bravo Ice"]);
    expect(sorted.slice(1).map((vendor) => vendor.distanceMetres)).toEqual([null, null]);
    // Half a place is no place.
    expect(sortVendors([at("Half", 17.4, null)], outlet)[0]!.distanceMetres).toBeNull();
  });

  it("lists two at the same distance by name", () => {
    const sorted = sortVendors([at("Beta", 17.4949, 78.4138), at("alpha", 17.4949, 78.4138)], outlet);
    expect(sorted.map((vendor) => vendor.name)).toEqual(["alpha", "Beta"]);
  });

  it("lists by name, with no distances, when the outlet has no saved place", () => {
    const sorted = sortVendors([near, far, unplacedB, middle], null);
    expect(sorted.map((vendor) => vendor.name)).toEqual(["Alpha Rice", "Bravo Ice", "Mid Gas", "Zed Dairy"]);
    expect(sorted.every((vendor) => vendor.distanceMetres === null)).toBe(true);
  });

  it("keeps everything else about a vendor and leaves the list it was given alone", () => {
    const given = [{ ...far, id: "f" }, { ...near, id: "n" }];
    const sorted = sortVendors(given, outlet);
    expect(sorted.map((vendor) => vendor.id)).toEqual(["n", "f"]);
    expect(given.map((vendor) => vendor.id)).toEqual(["f", "n"]);
    expect(given[0]).not.toHaveProperty("distanceMetres");
  });
});

describe("isNearby", () => {
  it("is within 5 km, the edge included, and never a vendor with no distance", () => {
    expect(VENDOR_RULES.nearbyMetres).toBe(5000);
    expect(isNearby({ distanceMetres: 0 })).toBe(true);
    expect(isNearby({ distanceMetres: 5000 })).toBe(true);
    expect(isNearby({ distanceMetres: 5001 })).toBe(false);
    expect(isNearby({ distanceMetres: null })).toBe(false);
    expect(isNearby({ distanceMetres: 900 }, 500)).toBe(false);
  });
});

describe("vendorMatches", () => {
  const vendor = {
    name: "Bowenpally Fresh Vegetables (sample)",
    area: "Bowenpally",
    city: "Secunderabad",
    sells: { en: "Onions, potatoes and tomatoes, by the sack", te: "ఉల్లిపాయలు, బంగాళదుంపలు" },
    categories: ["VEGETABLES_FRUITS"] as VendorCategory[],
  };
  const matches = (query: string | null, category: VendorCategory | null = null) =>
    vendorMatches(vendor, { query, category, language: "EN" });

  it("matches everyone when nothing is typed and no category is chosen", () => {
    expect(matches(null)).toBe(true);
    expect(matches("")).toBe(true);
    expect(matches("   ")).toBe(true);
  });

  it("looks in the name, the area, the city and what they sell, ignoring capitals", () => {
    expect(matches("fresh")).toBe(true);
    expect(matches("BOWEN")).toBe(true);
    expect(matches("secunder")).toBe(true);
    expect(matches("Potatoes")).toBe(true);
    expect(matches("paneer")).toBe(false);
  });

  it("wants every word typed, in any order", () => {
    expect(matches("onions bowenpally")).toBe(true);
    expect(matches("  sack   fresh ")).toBe(true);
    expect(matches("onions paneer")).toBe(false);
  });

  it("reads what they sell in the language of the screen, falling back to English", () => {
    expect(vendorMatches(vendor, { query: "ఉల్లి", language: "TE" })).toBe(true);
    expect(vendorMatches(vendor, { query: "ఉల్లి", language: "EN" })).toBe(false);
    expect(vendorMatches(vendor, { query: "onions", language: "HI" })).toBe(true);
    expect(vendorMatches({ ...vendor, sells: null }, { query: "onions", language: "EN" })).toBe(false);
  });

  it("also finds the extra words shown on the row, such as the category's name", () => {
    expect(vendorMatches(vendor, { query: "కూరగాయలు", language: "TE" })).toBe(false);
    expect(vendorMatches(vendor, { query: "కూరగాయలు", language: "TE", alsoSearch: ["కూరగాయలు, పండ్లు"] })).toBe(true);
  });

  it("keeps to the chosen category", () => {
    expect(matches(null, "VEGETABLES_FRUITS")).toBe(true);
    expect(matches(null, "DAIRY")).toBe(false);
    expect(matches("onions", "VEGETABLES_FRUITS")).toBe(true);
    expect(matches("onions", "DAIRY")).toBe(false);
    expect(matches("paneer", "VEGETABLES_FRUITS")).toBe(false);
  });
});

describe("the links behind the buttons", () => {
  it("opens directions to the vendor's place", () => {
    expect(directionsUrl(17.4636, 78.4772)).toBe("https://www.google.com/maps/dir/?api=1&destination=17.4636,78.4772");
  });

  it("opens WhatsApp with the digits only", () => {
    expect(whatsappUrl("+91 90000 01234")).toBe("https://wa.me/919000001234");
    expect(whatsappUrl("91-90000-01234")).toBe("https://wa.me/919000001234");
  });

  it("dials the number with its plus and digits", () => {
    expect(telUrl("+91 90000 01234")).toBe("tel:+919000001234");
    expect(telUrl("(040) 5550-1234")).toBe("tel:04055501234");
  });
});

describe("the buttons a vendor gets", () => {
  const real = { phone: "+91 40 5550 1234", whatsapp: "+91 98765 00000", latitude: 17.4636, longitude: 78.4772, isSample: false };
  const sample = { ...real, phone: "+91 90000 01101", whatsapp: "+91 90000 01101", isSample: true };

  it("offers Call, WhatsApp and Directions only for what the vendor has", () => {
    expect(vendorActions(real)).toEqual(["CALL", "WHATSAPP", "DIRECTIONS"]);
    expect(vendorActions({ ...real, whatsapp: null })).toEqual(["CALL", "DIRECTIONS"]);
    expect(vendorActions({ ...real, latitude: null, longitude: null })).toEqual(["CALL", "WHATSAPP"]);
    expect(vendorActions({ ...real, longitude: null })).toEqual(["CALL", "WHATSAPP"]);
    expect(vendorActions({ ...real, phone: null, whatsapp: "", latitude: null })).toEqual([]);
    // A sample has the same buttons; what they do is decided below.
    expect(vendorActions(sample)).toEqual(["CALL", "WHATSAPP", "DIRECTIONS"]);
  });

  it("opens the call, the chat and the map for a real vendor", () => {
    expect(vendorActionUrl(real, "CALL")).toBe("tel:+914055501234");
    expect(vendorActionUrl(real, "WHATSAPP")).toBe("https://wa.me/919876500000");
    expect(vendorActionUrl(real, "DIRECTIONS")).toBe("https://www.google.com/maps/dir/?api=1&destination=17.4636,78.4772");
  });

  it("never gives a number to dial or message for a sample vendor", () => {
    expect(vendorActionUrl(sample, "CALL")).toBeNull();
    expect(vendorActionUrl(sample, "WHATSAPP")).toBeNull();
    // Directions is only a place, so it still opens.
    expect(vendorActionUrl(sample, "DIRECTIONS")).toBe("https://www.google.com/maps/dir/?api=1&destination=17.4636,78.4772");
  });

  it("opens nothing where there is nothing to open", () => {
    expect(vendorActionUrl({ ...real, phone: null }, "CALL")).toBeNull();
    expect(vendorActionUrl({ ...real, whatsapp: null }, "WHATSAPP")).toBeNull();
    expect(vendorActionUrl({ ...real, latitude: null }, "DIRECTIONS")).toBeNull();
  });
});
