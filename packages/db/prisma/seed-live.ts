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
// The Super Admins' phone numbers and names are given on the command line, never written here.
// The founders can all be made in the first run (20 Oct 2026): repeat --phone and --name for
// each, in the same order. Once a Super Admin exists, this command makes no more; everyone else
// is added from the console.
//
// Safe to run again: every loader adds what is missing and updates its own entries in place,
// and no Super Admin is made twice. Run without --phone once one exists, it only reloads the
// library.

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

const { values } = parseArgs({ options: { phone: { type: "string", multiple: true }, name: { type: "string", multiple: true } } });
const prisma = createPrismaClient();

type NewAdmin = { phone: string; name: string };

/**
 * What to do about the Super Admins, worked out before anything is loaded, so that a wrong
 * phone number or a refusal leaves the database exactly as it was.
 */
async function superAdminPlan(): Promise<{ add: NewAdmin[]; note: string }> {
  const given = values.phone ?? [];
  const phones = given.map((raw) => {
    const phone = normalizePhone(raw);
    if (!phone) throw new Refusal(`"${raw}" is not a 10-digit Indian mobile number. Nothing was changed.`);
    return phone;
  });
  if (new Set(phones).size !== phones.length) throw new Refusal("The same phone number is given twice. Nothing was changed.");

  const admins = await prisma.user.findMany({
    where: { memberships: { some: { role: "SUPER_ADMIN" } } },
    select: { phone: true },
  });
  const listed = admins.map((admin) => (admin.phone ? lastFour(admin.phone) : "no phone")).join(", ");
  if (admins.length > 0) {
    if (phones.every((phone) => admins.some((admin) => admin.phone === phone))) return { add: [], note: `Super Admins: already set up (${listed}); not changed.` };
    // This command must not become a way to make more Super Admins.
    throw new Refusal(`This database already has a Super Admin (${listed}). Add other people from the console instead. Nothing was changed.`);
  }

  const names = (values.name ?? []).map((name) => name.trim());
  if (phones.length === 0) throw new Refusal('The first Super Admin is needed: add --phone 98xxxxxxxx --name "Full name" (repeat both for each founder). Nothing was changed.');
  if (names.length !== phones.length || names.some((name) => !name)) throw new Refusal("Give one --name for each --phone, in the same order. Nothing was changed.");
  if (names.some((name) => name.length > 100)) throw new Refusal("A name is longer than 100 letters. Nothing was changed.");
  const add = phones.map((phone, index) => ({ phone, name: names[index]! }));
  return {
    add,
    note: `Super Admins added: ${add.map((admin) => `${admin.name} (${lastFour(admin.phone)})`).join(", ")}. They log in to the console with their phone number and a one-time code.`,
  };
}

/** All the founders or none, in one transaction. */
async function addSuperAdmins(add: NewAdmin[]) {
  await prisma.$transaction(async (tx) => {
    for (const { phone, name } of add) {
      // A login with this number may exist already (for example from an earlier, interrupted run).
      const user =
        (await tx.user.findUnique({ where: { phone }, select: { id: true } })) ??
        (await tx.user.create({ data: { phone, name, language: "EN" }, select: { id: true } }));
      await tx.user.update({ where: { id: user.id }, data: { isActive: true } });
      await tx.membership.create({ data: { userId: user.id, role: "SUPER_ADMIN" } });
    }
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
  if (admin.add.length > 0) await addSuperAdmins(admin.add);
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
