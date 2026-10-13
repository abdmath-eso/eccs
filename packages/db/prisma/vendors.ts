// The vendor directory: wholesalers and distributors that sell in bulk to
// restaurants, kept as data in prisma/data/vendor-directory.json.
//
// Every vendor in that file today is a SAMPLE, invented for trying the app
// (founder, 13 Oct 2026). Nobody in it is real, and the loader below refuses a
// sample that could be mistaken for a real business: its name must end with
// " (sample)", and its phone, WhatsApp and FSSAI numbers must be in the
// made-up forms that belong to no one. The app, for its part, never dials a
// sample vendor.
//
// Loading is safe to repeat and touches nothing but the Vendor table: each
// vendor is found by its code and updated in place, or added. A sample vendor
// dropped from the file is switched off, never deleted. Vendors that did not
// come from this file (real ones, one day) are left exactly as they are.

import { readFileSync } from "node:fs";
import { Prisma, type PrismaClient } from "../src/index.js";

type Text = Record<string, string>;

interface VendorEntry {
  code: string;
  name: string;
  /** Codes from VENDOR_CATEGORIES in packages/shared/src/vendors.ts. */
  categories: string[];
  sells?: Text | null;
  area: string;
  city: string;
  address?: string | null;
  latitude?: number | null;
  longitude?: number | null;
  phone?: string | null;
  whatsapp?: string | null;
  delivers?: boolean;
  minOrderPaise?: number | null;
  hours?: Text | null;
  fssaiNumber?: string | null;
  isSample?: boolean;
}

/** Every sample vendor's code starts with this, so the loader knows which rows are its own to switch off. */
const SAMPLE_CODE_PREFIX = "sample-";
const SAMPLE_NAME_ENDING = " (sample)";
// Made-up forms: a phone number "+91 90000 0xxxx" and an FSSAI number "1360000000xxxx".
const SAMPLE_PHONE = /^\+91 90000 0\d{4}$/;
const SAMPLE_FSSAI = /^1360000000\d{4}$/;

const read = (): VendorEntry[] =>
  JSON.parse(readFileSync(new URL("./data/vendor-directory.json", import.meta.url), "utf8")) as VendorEntry[];

/** Stops the load, naming the vendor, if an entry is incomplete or a sample could pass for a real business. */
function check(entry: VendorEntry, seen: Set<string>) {
  const stop = (problem: string) => {
    throw new Error(`vendor-directory.json, "${entry.code ?? entry.name}": ${problem}`);
  };
  if (!entry.code || !entry.name || !entry.area || !entry.city) stop("code, name, area and city are all needed");
  if (seen.has(entry.code)) stop("this code is used twice");
  if (!Array.isArray(entry.categories) || entry.categories.length === 0) stop("at least one category is needed");
  if ((entry.latitude == null) !== (entry.longitude == null)) stop("give both latitude and longitude, or neither");
  if (entry.minOrderPaise != null && (!Number.isInteger(entry.minOrderPaise) || entry.minOrderPaise <= 0)) {
    stop("the minimum order must be a whole number of paise");
  }

  if (entry.isSample) {
    if (!entry.code.startsWith(SAMPLE_CODE_PREFIX)) stop(`a sample's code must start with "${SAMPLE_CODE_PREFIX}"`);
    if (!entry.name.endsWith(SAMPLE_NAME_ENDING)) stop(`a sample's name must end with "${SAMPLE_NAME_ENDING}"`);
    for (const number of [entry.phone, entry.whatsapp]) {
      if (number != null && !SAMPLE_PHONE.test(number)) stop(`a sample's number must look like "+91 90000 0xxxx", not "${number}"`);
    }
    if (entry.fssaiNumber != null && !SAMPLE_FSSAI.test(entry.fssaiNumber)) {
      stop(`a sample's FSSAI number must look like "1360000000xxxx", not "${entry.fssaiNumber}"`);
    }
  } else if (entry.code.startsWith(SAMPLE_CODE_PREFIX)) {
    stop(`only a sample's code may start with "${SAMPLE_CODE_PREFIX}"`);
  }
}

export async function loadVendorDirectory(prisma: PrismaClient): Promise<{ total: number; sample: number; switchedOff: number }> {
  const entries = read();
  // Everything is checked before anything is written, so a bad file changes nothing.
  const codes = new Set<string>();
  for (const entry of entries) {
    check(entry, codes);
    codes.add(entry.code);
  }

  for (const entry of entries) {
    const data = {
      name: entry.name,
      categories: entry.categories,
      // Prisma wants its own marker (DbNull), not `null`, to leave a JSON column empty.
      sells: entry.sells ?? Prisma.DbNull,
      area: entry.area,
      city: entry.city,
      address: entry.address ?? null,
      latitude: entry.latitude ?? null,
      longitude: entry.longitude ?? null,
      phone: entry.phone ?? null,
      whatsapp: entry.whatsapp ?? null,
      delivers: entry.delivers ?? false,
      minOrderPaise: entry.minOrderPaise ?? null,
      hours: entry.hours ?? Prisma.DbNull,
      fssaiNumber: entry.fssaiNumber ?? null,
      isSample: entry.isSample ?? false,
      isActive: true,
    };
    await prisma.vendor.upsert({ where: { code: entry.code }, create: { code: entry.code, ...data }, update: data });
  }

  // A sample taken out of the file leaves the list. Only this loader's own samples are touched.
  const { count } = await prisma.vendor.updateMany({
    where: { isSample: true, code: { startsWith: SAMPLE_CODE_PREFIX, notIn: [...codes] }, isActive: true },
    data: { isActive: false },
  });
  return { total: entries.length, sample: entries.filter((entry) => entry.isSample).length, switchedOff: count };
}
