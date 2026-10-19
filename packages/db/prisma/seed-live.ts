// The clean start for the live database (Stage H, 19 Oct 2026): ECCS's own library and the
// first Super Admin, and nothing else. Run once, after the migrations, on an empty database:
//
//   On the server:  docker compose run --rm migrate npm run seed:live -- --phone 98xxxxxxxx --name "Full name"
//   Here:           pnpm seed:live -- --phone 98xxxxxxxx --name "Full name"      (from packages/db)
//
// It loads the library:
// - the services, their task lists and bookable items, and the plans (eccs-services.ts, new-services.ts);
// - ECCS's standard SOPs (sops.ts) and the SOP library (sop-library.ts);
// - the inspection checklist (inspection-template.ts);
// - the checklist suggestion library (library.ts);
// - the other languages of all of it (content-translations.ts).
// The prices, tax codes and SOP wording in them are still the samples, to be changed in the console.
//
// It loads NO sample restaurants, outlets, logins, visits, vendors, finance, sales, team or
// onboarding (those are seed.ts and the *-sample loaders), and none of the seed's sample-only
// content: the opening and closing checklists it gives the sample outlets, its short sample
// inspection list, and its sample chemicals.
//
// The Super Admin's phone number and name are given on the command line, never written here.
// Once a Super Admin exists, everyone else is added from the console.
//
// Safe to run again: every loader adds what is missing and updates its own entries in place,
// and the Super Admin is not made twice. Run without --phone once one exists, it only reloads
// the library.

import "dotenv/config";
import { parseArgs } from "node:util";
import { createPrismaClient } from "../src/index.js";
import { translateContent } from "./content-translations.js";
import { loadEccsServices } from "./eccs-services.js";
import { loadInspectionTemplate } from "./inspection-template.js";
import { loadChecklistLibrary } from "./library.js";
import { loadNewServices } from "./new-services.js";
import { loadSopLibrary } from "./sop-library.js";
import { loadSampleSops } from "./sops.js";

/** A plain sentence for the person running it, then stop. */
class Refusal extends Error {}

/** The same rule as normalizePhone in packages/shared/src/auth.ts, which this package does not depend on. */
function normalizePhone(input: string): string | null {
  const digits = input.replace(/\D/g, "");
  const local = digits.length === 12 && digits.startsWith("91") ? digits.slice(2) : digits.length === 11 && digits.startsWith("0") ? digits.slice(1) : digits;
  return /^[6-9]\d{9}$/.test(local) ? `+91${local}` : null;
}

/** The last four digits only, for what is printed. */
const lastFour = (phone: string) => `…${phone.slice(-4)}`;

const { values } = parseArgs({ options: { phone: { type: "string" }, name: { type: "string" } } });
const prisma = createPrismaClient();

/**
 * What to do about the Super Admin, worked out before anything is loaded, so that a wrong
 * phone number or a refusal leaves the database exactly as it was.
 */
async function superAdminPlan(): Promise<{ add: { phone: string; name: string } | null; note: string }> {
  const phone = values.phone === undefined ? null : normalizePhone(values.phone);
  if (values.phone !== undefined && !phone) throw new Refusal(`"${values.phone}" is not a 10-digit Indian mobile number. Nothing was changed.`);

  const admins = await prisma.user.findMany({
    where: { memberships: { some: { role: "SUPER_ADMIN" } } },
    select: { phone: true },
  });
  const listed = admins.map((admin) => (admin.phone ? lastFour(admin.phone) : "no phone")).join(", ");
  if (admins.length > 0) {
    if (!phone || admins.some((admin) => admin.phone === phone)) return { add: null, note: `Super Admin: already set up (${listed}); not changed.` };
    // This command must not become a way to make more Super Admins.
    throw new Refusal(`This database already has a Super Admin (${listed}). Add other people from the console instead. Nothing was changed.`);
  }

  const name = values.name?.trim() ?? "";
  if (!phone || !name) throw new Refusal('The first Super Admin is needed: add --phone 98xxxxxxxx --name "Full name". Nothing was changed.');
  if (name.length > 100) throw new Refusal("The name is longer than 100 letters. Nothing was changed.");
  return {
    add: { phone, name },
    note: `Super Admin: ${name} (${lastFour(phone)}) added. They log in to the console with their phone number and a one-time code.`,
  };
}

async function addSuperAdmin({ phone, name }: { phone: string; name: string }) {
  await prisma.$transaction(async (tx) => {
    // A login with this number may exist already (for example from an earlier, interrupted run).
    const user =
      (await tx.user.findUnique({ where: { phone }, select: { id: true } })) ??
      (await tx.user.create({ data: { phone, name, language: "EN" }, select: { id: true } }));
    await tx.user.update({ where: { id: user.id }, data: { isActive: true } });
    await tx.membership.create({ data: { userId: user.id, role: "SUPER_ADMIN" } });
  });
}

async function main() {
  const admin = await superAdminPlan();

  const services = await loadEccsServices(prisma);
  const newServices = await loadNewServices(prisma);
  const sops = await loadSampleSops(prisma);
  const sopLibrary = await loadSopLibrary(prisma);
  const inspection = await loadInspectionTemplate(prisma);
  const checklistLibrary = await loadChecklistLibrary(prisma);
  // Last, so everything above gets its other languages.
  const translated = await translateContent(prisma);

  console.log("Library loaded:");
  console.log(`- services: ${await prisma.serviceType.count()} kinds, ${await prisma.serviceCatalogItem.count()} bookable items, ${await prisma.plan.count()} plans (added now: ${services.added.kinds + newServices.kinds} kinds, ${services.added.items + newServices.items} items, ${services.added.plans} plans)`);
  console.log(`- ECCS standard SOPs: ${sops.total}; SOP library: ${sopLibrary.total} active, ${sopLibrary.switchedOff} switched off`);
  console.log(`- inspection checklist: ${inspection.checks} checks in ${inspection.sections} sections (${inspection.critical} critical)`);
  console.log(`- checklist suggestion library: ${checklistLibrary.total} entries, ${checklistLibrary.switchedOff} switched off`);
  console.log(`- other languages: ${translated.filled} pieces of text filled in from ${translated.languages} dictionaries`);
  if (admin.add) await addSuperAdmin(admin.add);
  console.log(admin.note);
  const sample = { restaurants: await prisma.organization.count(), outlets: await prisma.outlet.count(), vendors: await prisma.vendor.count(), logins: await prisma.user.count() };
  console.log(`In the database now: ${sample.restaurants} restaurants, ${sample.outlets} outlets, ${sample.vendors} vendors, ${sample.logins} logins.`);
}

main()
  .catch((error) => {
    if (error instanceof Refusal) console.error(error.message);
    else console.error(error);
    process.exitCode = 1;
  })
  .finally(() => prisma.$disconnect());
