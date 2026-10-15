// Loads the sample sales for the console's Sales page (three sample BDEs with ECCS
// logins 9000000004 to 9000000006, about 155 leads over the last four weeks with their
// steps and quotes, and one target set by hand) without touching any other data.
// Run from packages/db:  pnpm sales:sample
//
// Safe to run again: each sample row has its own key and is added only once.
// To take every sample lead, target and sample BDE login out again before real use:
//   pnpm sales:sample:remove

import "dotenv/config";
import { createPrismaClient } from "../src/index.js";
import { loadSalesSample, removeSalesSample } from "../src/sales-sample.js";

const prisma = createPrismaClient();
const remove = process.argv.includes("--remove");

(remove
  ? removeSalesSample(prisma).then(
      (counts) =>
        `Sample sales removed: ${counts.leads} leads with their steps and quotes, ${counts.targets} targets, ${counts.bdes} sample BDE logins` +
        (counts.keptBdes > 0 ? ` (${counts.keptBdes} kept: they own real leads now).` : "."),
    )
  : loadSalesSample(prisma).then(
      (counts) =>
        `Sample sales added: ${counts.bdes} BDE logins, ${counts.leads} leads, ${counts.activities} steps, ${counts.quotes} quotes, ${counts.targets} targets (rows already there are kept as they are).`,
    )
)
  .then((words) => console.log(words))
  .catch((error) => {
    console.error(error);
    process.exitCode = 1;
  })
  .finally(() => prisma.$disconnect());
