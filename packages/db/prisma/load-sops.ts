// Loads ECCS's sample standard SOPs without touching any other data.
// Run from packages/db:  pnpm sops:load

import "dotenv/config";
import { createPrismaClient } from "../src/index.js";
import { loadSampleSops } from "./sops.js";

const prisma = createPrismaClient();

loadSampleSops(prisma)
  .then(({ total }) => {
    console.log(`Sample SOPs loaded: ${total}.`);
  })
  .catch((error) => {
    console.error(error);
    process.exitCode = 1;
  })
  .finally(() => prisma.$disconnect());
