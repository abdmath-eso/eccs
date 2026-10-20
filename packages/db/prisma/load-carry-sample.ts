// Adds the sample "What to carry" lists to the kinds of service that have none yet.
// Run from packages/db:  pnpm carry:sample
//
// Safe to run again: a kind with a list (the sample, or the office's own) is left alone.

import "dotenv/config";
import { createPrismaClient } from "../src/index.js";
import { loadCarrySample } from "./carry-sample.js";

const prisma = createPrismaClient();

loadCarrySample(prisma)
  .then(({ filled }) => console.log(`What to carry: sample lists added to ${filled} kinds of service.`))
  .catch((error) => {
    console.error(error);
    process.exitCode = 1;
  })
  .finally(() => prisma.$disconnect());
