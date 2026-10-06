// Translations of ECCS's own content that lives in the database: checklist
// names and items, the standard SOPs, and service and plan names.
//
// English, Telugu and Hindi are written where the content is defined (the
// seed, sops.ts). The other languages come from dictionaries in
// prisma/data/content-translations/<language>.json, each mapping an English
// string to its translation. This fills in whichever languages a piece of
// content is missing and has a dictionary entry for.
//
// Safe to repeat. It only adds; it never changes a translation already there,
// and it never touches content a restaurant wrote for itself.

import { readdirSync, readFileSync } from "node:fs";
import type { Prisma, PrismaClient } from "../src/index.js";

type Localized = Record<string, string>;

function readDictionaries(): Map<string, Map<string, string>> {
  const folder = new URL("./data/content-translations/", import.meta.url);
  const dictionaries = new Map<string, Map<string, string>>();
  let files: string[];
  try {
    files = readdirSync(folder);
  } catch {
    return dictionaries;
  }
  for (const file of files.filter((name) => /^[a-z]{2}\.json$/.test(name))) {
    const entries = JSON.parse(readFileSync(new URL(file, folder), "utf8")) as Record<string, string>;
    dictionaries.set(file.slice(0, 2), new Map(Object.entries(entries)));
  }
  return dictionaries;
}

export async function translateContent(prisma: PrismaClient): Promise<{ languages: number; filled: number }> {
  const dictionaries = readDictionaries();
  let filled = 0;

  /** The value with any missing languages added, or null if there is nothing to add. */
  const complete = (value: unknown, byLine = false): Prisma.InputJsonValue | null => {
    const text = value as Localized | null;
    if (!text?.en) return null;
    const next: Localized = { ...text };
    let changed = false;
    for (const [language, dictionary] of dictionaries) {
      if (next[language]) continue;
      // An SOP's steps are one per line; all of them must translate or none is used.
      const parts = (byLine ? text.en.split("\n") : [text.en]).map((part) => dictionary.get(part.trim()));
      if (parts.some((part) => !part)) continue;
      next[language] = parts.join("\n");
      changed = true;
      filled++;
    }
    return changed ? next : null;
  };

  // ECCS's own rows only: outletId is empty.
  for (const row of await prisma.checklistTemplate.findMany({ where: { outletId: null } })) {
    const title = complete(row.title);
    if (title) await prisma.checklistTemplate.update({ where: { id: row.id }, data: { title } });
  }
  for (const row of await prisma.checklistItem.findMany({ where: { outletId: null } })) {
    const label = complete(row.label);
    if (label) await prisma.checklistItem.update({ where: { id: row.id }, data: { label } });
  }
  for (const row of await prisma.sopTemplate.findMany({ where: { outletId: null } })) {
    const title = complete(row.title);
    const body = complete(row.body, true);
    if (title || body) {
      await prisma.sopTemplate.update({ where: { id: row.id }, data: { ...(title && { title }), ...(body && { body }) } });
    }
  }
  for (const row of await prisma.serviceType.findMany()) {
    const name = complete(row.name);
    if (name) await prisma.serviceType.update({ where: { id: row.id }, data: { name } });
  }
  for (const row of await prisma.serviceCatalogItem.findMany()) {
    const name = complete(row.name);
    const description = complete(row.description);
    if (name || description) {
      await prisma.serviceCatalogItem.update({ where: { id: row.id }, data: { ...(name && { name }), ...(description && { description }) } });
    }
  }
  for (const row of await prisma.plan.findMany()) {
    const name = complete(row.name);
    const description = complete(row.description);
    if (name || description) {
      await prisma.plan.update({ where: { id: row.id }, data: { ...(name && { name }), ...(description && { description }) } });
    }
  }
  return { languages: dictionaries.size, filled };
}
