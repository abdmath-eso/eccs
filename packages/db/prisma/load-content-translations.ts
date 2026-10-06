// Adds the other languages to ECCS's checklists, standard SOPs and service
// names, without touching anything else. Run from packages/db:  pnpm content:translate

import "dotenv/config";
import { createPrismaClient } from "../src/index.js";
import { translateContent } from "./content-translations.js";

const prisma = createPrismaClient();

translateContent(prisma)
  .then(({ languages, filled }) => {
    console.log(`Content translated: ${filled} pieces of text filled in from ${languages} languages.`);
  })
  .catch((error) => {
    console.error(error);
    process.exitCode = 1;
  })
  .finally(() => prisma.$disconnect());
