// The SOP library: ready-made SOPs an Owner or Manager finds by typing or
// browsing in the app and copies into their own SOPs, where they can then
// change the wording.
//
// Sources, both in prisma/data, English only:
// - sop-library.json       generated from the founder's Excel workbook (pnpm soplibrary:import)
// - sop-library-eccs.json  fuller wording for the SOPs restaurants need most (food
//                          safety, storage, cleaning, pests, waste, fire and gas),
//                          edited by hand. Each entry replaces the purpose, steps and
//                          controls of the workbook SOP with the same name, whose own
//                          steps are shared between many SOPs and say little.
//
// Loading is safe to repeat: entries are matched by code, updated in place,
// and ones no longer in the file are switched off rather than deleted, so
// SOPs already copied from them keep their link.

import { readFileSync } from "node:fs";
import type { PrismaClient } from "../src/index.js";

interface LibraryEntry {
  code: string;
  kind: string;
  name: string;
  category: string;
  section: string;
  role?: string | null;
  area?: string | null;
  frequency?: string | null;
  purpose: string;
  steps: string[];
  controls?: string | null;
  keywords?: string[];
}

interface FullerWording {
  name: string;
  purpose: string;
  steps: string[];
  controls?: string | null;
}

const readJson = <T>(file: string): T => JSON.parse(readFileSync(new URL(`./data/${file}`, import.meta.url), "utf8")) as T;

/** Everything a person might type to find this SOP, in lower case. */
const searchText = (entry: LibraryEntry) =>
  [entry.name, entry.section, entry.area ?? "", entry.role ?? "", ...(entry.keywords ?? [])].join(" ").toLowerCase();

export async function loadSopLibrary(prisma: PrismaClient): Promise<{ total: number; switchedOff: number }> {
  const entries = readJson<LibraryEntry[]>("sop-library.json");

  for (const fuller of readJson<FullerWording[]>("sop-library-eccs.json")) {
    const matches = entries.filter((entry) => entry.kind === "OPERATION" && entry.name === fuller.name);
    // A name that matches nothing, or two SOPs, means the workbook changed: stop rather than guess.
    if (matches.length !== 1) throw new Error(`sop-library-eccs.json: "${fuller.name}" matches ${matches.length} workbook SOPs, expected 1`);
    Object.assign(matches[0]!, { purpose: fuller.purpose, steps: fuller.steps, controls: fuller.controls ?? null });
  }

  // In batches, so several hundred entries do not mean several hundred round trips one after another.
  for (let start = 0; start < entries.length; start += 50) {
    await prisma.$transaction(
      entries.slice(start, start + 50).map((entry) => {
        const data = {
          kind: entry.kind,
          name: entry.name,
          category: entry.category,
          section: entry.section,
          role: entry.role ?? null,
          area: entry.area ?? null,
          frequency: entry.frequency ?? null,
          purpose: entry.purpose,
          steps: entry.steps.join("\n"),
          controls: entry.controls ?? null,
          searchText: searchText(entry),
          isActive: true,
        };
        return prisma.sopLibraryItem.upsert({ where: { code: entry.code }, create: { code: entry.code, ...data }, update: data });
      }),
    );
  }

  const { count } = await prisma.sopLibraryItem.updateMany({
    where: { code: { notIn: entries.map((entry) => entry.code) }, isActive: true },
    data: { isActive: false },
  });
  return { total: entries.length, switchedOff: count };
}
