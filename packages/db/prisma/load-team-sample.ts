// Loads the sample team for the console's Team page (team details for the sample ECCS
// logins 9000000002 to 9000000006: areas, joining dates, salaries, a few days of leave;
// the history of the sample BDEs' next steps; this morning's first sample lead of each
// sample BDE; the months of salary already over, as paid) without touching any other data.
// It also takes out the Finance sample's two hand-entered salary rows, which Team replaces.
// Run from packages/db:  pnpm team:sample
//
// Safe to run again: each sample row has its own key and is added only once.
// To take the sample team out again before real use (the logins stay):
//   pnpm team:sample:remove

import "dotenv/config";
import { createPrismaClient } from "../src/index.js";
import { loadTeamSample, removeTeamSample } from "../src/team-sample.js";

const prisma = createPrismaClient();
const remove = process.argv.includes("--remove");

(remove
  ? removeTeamSample(prisma).then(
      (counts) =>
        `Sample team removed: ${counts.members} team members with their salaries and leave, ${counts.salaryRows} salary rows, ${counts.followUps} follow-up records, ${counts.leads} sample leads of this morning. The logins stay.`,
    )
  : loadTeamSample(prisma).then(
      (counts) =>
        `Sample team added: ${counts.members} team members, ${counts.salaries} salaries, ${counts.leave} leave records, ${counts.paidMonths} past months of salary (paid), ${counts.leads} leads logged this morning, ${counts.followUps} follow-up records; ${counts.financeSalariesRemoved} hand-entered sample salary rows taken out of Finance (rows already there are kept as they are).`,
    )
)
  .then((words) => console.log(words))
  .catch((error) => {
    console.error(error);
    process.exitCode = 1;
  })
  .finally(() => prisma.$disconnect());
