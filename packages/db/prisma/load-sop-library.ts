// Loads the SOP library into the database without touching any other data.
// Run from packages/db:  pnpm soplibrary:load

import "dotenv/config";
import { createPrismaClient } from "../src/index.js";
import { loadSopLibrary } from "./sop-library.js";

const prisma = createPrismaClient();

loadSopLibrary(prisma)
  .then(({ total, switchedOff }) => {
    console.log(`SOP library loaded: ${total} SOPs active, ${switchedOff} switched off.`);
  })
  .catch((error) => {
    console.error(error);
    process.exitCode = 1;
  })
  .finally(() => prisma.$disconnect());
