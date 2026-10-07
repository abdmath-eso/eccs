// Loads the standard inspection template (ten sections, 92 checks) without
// touching any other data. Run from packages/db:  pnpm inspection:load

import "dotenv/config";
import { createPrismaClient } from "../src/index.js";
import { loadInspectionTemplate } from "./inspection-template.js";

const prisma = createPrismaClient();

loadInspectionTemplate(prisma)
  .then(({ sections, checks, critical, switchedOff }) => {
    console.log(
      `Inspection template loaded: ${sections} sections, ${checks} checks (${critical} critical), ${switchedOff} switched off.`,
    );
  })
  .catch((error) => {
    console.error(error);
    process.exitCode = 1;
  })
  .finally(() => prisma.$disconnect());
