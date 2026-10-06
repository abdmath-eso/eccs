// Adds sample past service visits without touching any other data.
// Run from packages/db:  pnpm visits:load

import "dotenv/config";
import { createPrismaClient } from "../src/index.js";
import { addSampleVisits } from "./sample-visits.js";

const prisma = createPrismaClient();

addSampleVisits(prisma)
  .then(({ added }) => {
    console.log(`Sample past visits added: ${added}.`);
  })
  .catch((error) => {
    console.error(error);
    process.exitCode = 1;
  })
  .finally(() => prisma.$disconnect());
