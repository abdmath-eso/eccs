// Adds the services of 9 Oct 2026 (rating readiness, oil test, water test,
// staff medical camp, supervisor training, grease trap cleaning, chemicals
// refill, and the full hood-and-duct item) without touching anything else,
// then fills in their other languages.
// Run from packages/db:  pnpm services:load
//
// Safe to run again: it adds nothing the second time.

import "dotenv/config";
import { createPrismaClient } from "../src/index.js";
import { translateContent } from "./content-translations.js";
import { loadNewServices } from "./new-services.js";

const prisma = createPrismaClient();

loadNewServices(prisma)
  .then(async ({ kinds, items }) => {
    const { filled } = await translateContent(prisma);
    console.log(`New services: ${kinds} kinds and ${items} bookable services added; ${filled} pieces of text translated.`);
  })
  .catch((error) => {
    console.error(error);
    process.exitCode = 1;
  })
  .finally(() => prisma.$disconnect());
