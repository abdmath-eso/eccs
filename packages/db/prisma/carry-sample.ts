// The sample "What to carry" lists for the sample kinds of service (20 Oct 2026, the console
// plan's day's sheet). SAMPLE data: each list is marked `carrySample` and shows as "Sample list"
// in Catalogue until the office saves its own. Safe to repeat: only a kind with no list yet gets
// one, so a list the office has written is never touched.

import { readFileSync } from "node:fs";
import type { PrismaClient } from "../src/index.js";

const lists = JSON.parse(readFileSync(new URL("./data/carry-sample.json", import.meta.url), "utf8")) as Record<string, string[] | string>;

export async function loadCarrySample(prisma: PrismaClient): Promise<{ filled: number }> {
  let filled = 0;
  for (const [code, items] of Object.entries(lists)) {
    if (code.startsWith("_") || !Array.isArray(items)) continue;
    const done = await prisma.serviceType.updateMany({
      where: { code, carryItems: { isEmpty: true }, carrySample: false },
      data: { carryItems: items, carrySample: true },
    });
    filled += done.count;
  }
  return { filled };
}
