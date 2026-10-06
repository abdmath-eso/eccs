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
// - sop-translations/      Telugu and Hindi for the SOPs in sop-library-eccs.json, in
//                          files named te.*.json and hi.*.json. Each entry is matched
//                          by the SOP's English name and must have the same number
//                          of steps as the English.
//
// Loading is safe to repeat: entries are matched by code, updated in place,
// and ones no longer in the file are switched off rather than deleted, so
// SOPs already copied from them keep their link.

import { readdirSync, readFileSync } from "node:fs";
import { Prisma, type PrismaClient } from "../src/index.js";

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
  translations?: Partial<Record<TranslatedLanguage, { name: string; purpose: string; steps: string; controls: string | null }>>;
}

const TRANSLATED_LANGUAGES = ["te", "hi"] as const;
type TranslatedLanguage = (typeof TRANSLATED_LANGUAGES)[number];

interface Translation {
  /** The SOP's English name, which is how it is matched. */
  name: string;
  title: string;
  purpose: string;
  steps: string[];
  controls?: string | null;
}

interface FullerWording {
  name: string;
  purpose: string;
  steps: string[];
  controls?: string | null;
}

const readJson = <T>(file: string): T => JSON.parse(readFileSync(new URL(`./data/${file}`, import.meta.url), "utf8")) as T;

/** Everything a person might type to find this SOP, in lower case, in every language it has. */
const searchText = (entry: LibraryEntry) =>
  [
    entry.name,
    entry.section,
    entry.area ?? "",
    entry.role ?? "",
    ...(entry.keywords ?? []),
    ...Object.values(entry.translations ?? {}).map((translation) => translation.name),
  ]
    .join(" ")
    .toLowerCase();

/** Reads every translation file for a language and attaches each entry to its SOP. */
function attachTranslations(entries: LibraryEntry[], fuller: FullerWording[]) {
  const folder = new URL("./data/sop-translations/", import.meta.url);
  let files: string[];
  try {
    files = readdirSync(folder);
  } catch {
    return; // No translations yet.
  }
  for (const language of TRANSLATED_LANGUAGES) {
    for (const file of files.filter((name) => name.startsWith(`${language}.`) && name.endsWith(".json")).sort()) {
      for (const translation of JSON.parse(readFileSync(new URL(file, folder), "utf8")) as Translation[]) {
        const english = fuller.find((entry) => entry.name === translation.name);
        const target = entries.find((entry) => entry.kind === "OPERATION" && entry.name === translation.name);
        if (!english || !target) throw new Error(`${file}: "${translation.name}" is not an SOP in sop-library-eccs.json`);
        // A missing or extra step would put the wrong instruction against a number: stop rather than load it.
        if (translation.steps.length !== english.steps.length) {
          throw new Error(`${file}: "${translation.name}" has ${translation.steps.length} steps, the English has ${english.steps.length}`);
        }
        (target.translations ??= {})[language] = {
          name: translation.title,
          purpose: translation.purpose,
          steps: translation.steps.map((step) => step.replace(/\s+/g, " ").trim()).join("\n"),
          controls: translation.controls ?? null,
        };
      }
    }
  }
}

export async function loadSopLibrary(prisma: PrismaClient): Promise<{ total: number; switchedOff: number }> {
  const entries = readJson<LibraryEntry[]>("sop-library.json");

  const fullerWording = readJson<FullerWording[]>("sop-library-eccs.json");
  for (const fuller of fullerWording) {
    const matches = entries.filter((entry) => entry.kind === "OPERATION" && entry.name === fuller.name);
    // A name that matches nothing, or two SOPs, means the workbook changed: stop rather than guess.
    if (matches.length !== 1) throw new Error(`sop-library-eccs.json: "${fuller.name}" matches ${matches.length} workbook SOPs, expected 1`);
    Object.assign(matches[0]!, { purpose: fuller.purpose, steps: fuller.steps, controls: fuller.controls ?? null });
  }
  attachTranslations(entries, fullerWording);

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
          translations: entry.translations ?? Prisma.DbNull,
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
