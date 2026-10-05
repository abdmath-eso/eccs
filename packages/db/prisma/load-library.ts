// Loads the checklist suggestion library into the database without touching
// any other data. Run from packages/db:  pnpm library:load

import "dotenv/config";
import { createPrismaClient } from "../src/index.js";
import { loadChecklistLibrary } from "./library.js";

const prisma = createPrismaClient();

loadChecklistLibrary(prisma)
  .then(({ total, switchedOff }) => {
    console.log(`Checklist library loaded: ${total} checks active, ${switchedOff} switched off.`);
  })
  .catch((error) => {
    console.error(error);
    process.exitCode = 1;
  })
  .finally(() => prisma.$disconnect());
