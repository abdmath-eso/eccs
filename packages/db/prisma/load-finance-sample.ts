// Loads the sample books for the console's Finance page (six weeks of expenses, two
// wage advances, the Lean and Full budgets, the founders' money and an opening cash
// balance) without touching any other data.
// Run from packages/db:  pnpm finance:sample
//
// Safe to run again: each sample row has its own key and is added only once.
// To take every sample row out again before real use:  pnpm finance:sample:remove

import "dotenv/config";
import { createPrismaClient } from "../src/index.js";
import { loadFinanceSample, removeFinanceSample } from "../src/finance-sample.js";

const prisma = createPrismaClient();
const remove = process.argv.includes("--remove");

(remove ? removeFinanceSample(prisma) : loadFinanceSample(prisma))
  .then((counts) => {
    const words = `${counts.expenses} expenses and wage advances, ${counts.budgets} budgets, ${counts.founderMoney} founders' money entries, ${counts.openings} opening balance`;
    console.log(remove ? `Sample finance rows removed: ${words}.` : `Sample finance rows added: ${words} (rows already there are kept as they are).`);
  })
  .catch((error) => {
    console.error(error);
    process.exitCode = 1;
  })
  .finally(() => prisma.$disconnect());
