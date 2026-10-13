// Loads the vendor directory (today: 24 sample vendors in and around
// Hyderabad) into the database without touching any other data.
// Run from packages/db:  pnpm vendors:load
//
// Safe to run again: vendors are matched by their code and updated in place.

import "dotenv/config";
import { createPrismaClient } from "../src/index.js";
import { loadVendorDirectory } from "./vendors.js";

const prisma = createPrismaClient();

loadVendorDirectory(prisma)
  .then(({ total, sample, switchedOff }) => {
    console.log(`Vendor directory loaded: ${total} vendors (${sample} sample), ${switchedOff} switched off.`);
  })
  .catch((error) => {
    console.error(error);
    process.exitCode = 1;
  })
  .finally(() => prisma.$disconnect());
