// The checklist suggestion library: ready-made checks an Owner or Manager
// finds by typing in the app.
//
// Sources, both in prisma/data:
// - checklist-library.json       generated from the founder's Excel sheet (pnpm library:import)
// - checklist-library-eccs.json  ECCS's own additions for Indian commercial kitchens, edited by hand
//
// Loading is safe to repeat: entries are matched by code, updated in place,
// and ones no longer in the files are switched off rather than deleted, so
// checklist items already created from them keep their link.

import { readFileSync } from "node:fs";
import type { PrismaClient } from "../src/index.js";

interface LibraryEntry {
  code: string;
  checklistName: string;
  category: string;
  area?: string | null;
  frequency?: string | null;
  role?: string | null;
  priority: string;
  text: string;
  keywords?: string[];
}

const read = (file: string): LibraryEntry[] =>
  JSON.parse(readFileSync(new URL(`./data/${file}`, import.meta.url), "utf8")) as LibraryEntry[];

/** Everything a person might type to find this check, in lower case. */
const searchText = (entry: LibraryEntry) =>
  [entry.text, entry.checklistName, entry.category, entry.area ?? "", ...(entry.keywords ?? [])].join(" ").toLowerCase();

export async function loadChecklistLibrary(prisma: PrismaClient): Promise<{ total: number; switchedOff: number }> {
  const sources: [string, LibraryEntry[]][] = [
    ["sheet", read("checklist-library.json")],
    ["eccs", read("checklist-library-eccs.json")],
  ];

  const codes: string[] = [];
  for (const [source, entries] of sources) {
    for (const entry of entries) {
      const data = {
        source,
        checklistName: entry.checklistName,
        category: entry.category,
        area: entry.area ?? null,
        frequency: entry.frequency ?? null,
        role: entry.role ?? null,
        priority: entry.priority === "HIGH" ? "HIGH" : "MEDIUM",
        text: { en: entry.text },
        searchText: searchText(entry),
        isActive: true,
      };
      await prisma.checklistLibraryItem.upsert({ where: { code: entry.code }, create: { code: entry.code, ...data }, update: data });
      codes.push(entry.code);
    }
  }

  const { count } = await prisma.checklistLibraryItem.updateMany({
    where: { code: { notIn: codes }, isActive: true },
    data: { isActive: false },
  });
  return { total: codes.length, switchedOff: count };
}
