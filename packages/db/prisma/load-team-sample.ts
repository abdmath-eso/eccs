// Loads the sample team for the console's Team page (team details for the sample ECCS
// logins 9000000002 to 9000000006: areas, joining dates, salaries, a few days of leave;
// the history of the sample BDEs' next steps; this morning's first sample lead of each
// sample BDE; the months of salary already over, as paid) without touching any other data.
// It also takes out the Finance sample's two hand-entered salary rows, which Team replaces.
// And the onboarding sample (16 Oct 2026): a checklist template per role, the staff
// handbook, and one new hire, Kiran (sample), a Supervisor joining next Monday, who logs in
// with 9000000007 (src/onboarding-sample.ts).
// Run from packages/db:  pnpm team:sample
//
// Safe to run again: each sample row has its own key and is added only once.
// To take the sample team out again before real use (the seed's logins stay; Kiran's goes):
//   pnpm team:sample:remove

import "dotenv/config";
import { config } from "dotenv";
import { createPrismaClient } from "../src/index.js";
import { loadTeamSample, removeTeamSample } from "../src/team-sample.js";

// The file store's settings (for Kiran's two placeholder documents) are in the repo's own .env, as the API's are.
config({ path: "../../.env", quiet: true });

const prisma = createPrismaClient();
const remove = process.argv.includes("--remove");

(remove
  ? removeTeamSample(prisma).then(
      (counts) =>
        `Sample team removed: ${counts.members} team members with their salaries and leave, ${counts.salaryRows} salary rows, ${counts.followUps} follow-up records, ${counts.leads} sample leads of this morning; ` +
        `onboarding: ${counts.onboarding.newHire} sample new hire with their login and ${counts.onboarding.files} files, ${counts.onboarding.templates} sample templates, ${counts.onboarding.handbook} sample handbook versions. The seed's logins stay.`,
    )
  : loadTeamSample(prisma).then(
      (counts) =>
        `Sample team added: ${counts.members} team members, ${counts.salaries} salaries, ${counts.leave} leave records, ${counts.paidMonths} past months of salary (paid), ${counts.leads} leads logged this morning, ${counts.followUps} follow-up records; ${counts.financeSalariesRemoved} hand-entered sample salary rows taken out of Finance; ` +
        `onboarding: ${counts.onboarding.templates} templates (${counts.onboarding.templateTasks} tasks), ${counts.onboarding.handbook} handbook, ${counts.onboarding.newHire} new hire (Kiran, 9000000007), ${counts.onboarding.documents} placeholder documents, ${counts.onboarding.letter} letter (rows already there are kept as they are).`,
    )
)
  .then((words) => console.log(words))
  .catch((error) => {
    console.error(error);
    process.exitCode = 1;
  })
  .finally(() => prisma.$disconnect());
