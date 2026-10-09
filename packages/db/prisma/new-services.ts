// The services added on 9 Oct 2026 ("in Services to add, all the services"):
// FSSAI hygiene rating readiness, frying oil test, water test, staff medical
// camp, Food Safety Supervisor training, grease trap cleaning and cleaning
// chemicals refill, plus a fuller hood-and-duct item under the existing
// chimney kind.
//
// Everything here is SAMPLE data, like the first four services in the seed:
// every price is a placeholder to be replaced by the founder, and every tax
// code is a best reading of the GST lists to be confirmed by the accountant
// (see docs/STATUS.md).
//
// Safe to repeat. It only adds what is missing: a kind is looked up by its
// code and a bookable service by its English name within its kind. Nothing
// that already exists is changed or removed, so prices or wording the office
// has edited in the console are left alone.

import { readFileSync } from "node:fs";
import type { PrismaClient } from "../src/index.js";

type Localized = Record<string, string>;

/** Telugu and Hindi for the English below, keyed by the English. The other nine languages come from content-translations. */
const teHi = JSON.parse(readFileSync(new URL("./data/new-services.te-hi.json", import.meta.url), "utf8")) as {
  te: Record<string, string>;
  hi: Record<string, string>;
};

const text = (en: string): Localized => ({
  en,
  ...(teHi.te[en] && { te: teHi.te[en] }),
  ...(teHi.hi[en] && { hi: teHi.hi[en] }),
});

const rupees = (amount: number) => Math.round(amount * 100);

interface TaskInput {
  section: string;
  label: string;
  /** Set for a task that records a number (a meter reading) instead of a tick: the limit it is judged against. */
  readingLimit?: number;
}

interface ItemInput {
  name: string;
  description: string;
  /** Before GST. A sample. */
  priceRupees: number;
  durationMinutes: number;
}

interface KindInput {
  code: string;
  name: string;
  category: "CLEANING" | "PEST" | "TESTING" | "COMPLIANCE" | "SUPPLIES";
  /** True when an outside partner (a lab, a clinic, a training partner, an audit agency) delivers part of it. */
  partnerDelivered: boolean;
  /** GST code: an SAC for a service, an HSN for goods. To be confirmed by the accountant. */
  sacCode: string;
  gstRatePercent: number;
  /** Days an ECCS certificate of service is valid for; leave out for kinds that give none. */
  certificateValidDays?: number;
  tasks: TaskInput[];
  items: ItemInput[];
}

/** FSSAI's limit for total polar compounds in frying oil, in percent. */
const OIL_LIMIT = 25;

export const NEW_SERVICE_KINDS: KindInput[] = [
  {
    // ECCS prepares the kitchen and the records; the official audit and the rating belong to the
    // recognised agency. So no ECCS certificate: the agency's audit report is attached instead.
    code: "RATING_READINESS",
    name: "FSSAI hygiene rating readiness",
    category: "COMPLIANCE",
    partnerDelivered: true,
    sacCode: "998349",
    gstRatePercent: 18,
    tasks: [
      { section: "Gap check", label: "Kitchen checked against the FSSAI hygiene rating checklist" },
      { section: "Gap check", label: "Gaps listed with the manager, with who will fix each one and by when" },
      { section: "Fixes", label: "Cleaning and pest control gaps put right" },
      { section: "Records", label: "Licences, staff medical certificates and training certificates checked and filed" },
      { section: "Records", label: "Water test report and pest control records checked and filed" },
      { section: "Records", label: "Daily records for the last 30 days checked (temperature, cleaning, frying oil)" },
      { section: "Audit", label: "Audit by the recognised agency booked, and the date told to the manager" },
    ],
    items: [
      {
        name: "FSSAI hygiene rating readiness package",
        description:
          "ECCS checks your kitchen against the FSSAI hygiene rating checklist, fixes the gaps and puts your records in order. The official audit is then done by an audit agency recognised by FSSAI: the agency alone decides and gives the rating, not ECCS. You get our readiness report and the agency's audit report in your documents.",
        priceRupees: 25000,
        durationMinutes: 480,
      },
    ],
  },
  {
    // The readings themselves are the result, printed on the service report. No certificate.
    code: "OIL_TEST",
    name: "Frying oil test",
    category: "TESTING",
    partnerDelivered: false,
    sacCode: "998346",
    gstRatePercent: 18,
    tasks: [
      { section: "Before testing", label: "Meter checked with the reference oil before testing" },
      { section: "Readings", label: "Fryer 1: total polar compounds reading (%)", readingLimit: OIL_LIMIT },
      { section: "Readings", label: "Fryer 2: total polar compounds reading (%)", readingLimit: OIL_LIMIT },
      { section: "Readings", label: "Fryer 3: total polar compounds reading (%)", readingLimit: OIL_LIMIT },
      { section: "Readings", label: "Fryer 4: total polar compounds reading (%)", readingLimit: OIL_LIMIT },
      { section: "Close-out", label: "Readings shown to the manager or chef, with what to do for each fryer" },
    ],
    items: [
      {
        name: "Frying oil test, up to 4 fryers",
        description:
          "Our technician tests the oil in each fryer with a meter and records the reading (total polar compounds). The FSSAI limit is 25%. You get every reading on the service report, with a clear note for any oil that must be changed.",
        priceRupees: 500,
        durationMinutes: 30,
      },
    ],
  },
  {
    // ECCS only draws the sample. The laboratory tests and reports; its report is attached to the visit.
    code: "WATER_TEST",
    name: "Water test",
    category: "TESTING",
    partnerDelivered: true,
    sacCode: "998346",
    gstRatePercent: 18,
    tasks: [
      { section: "Sample", label: "Sampling point agreed with the manager (kitchen tap or tank)" },
      { section: "Sample", label: "Tap cleaned and water run before the sample was taken" },
      { section: "Sample", label: "Sample taken in the laboratory's sterile bottle and sealed" },
      { section: "Sample", label: "Bottle labelled with the outlet, sampling point, date and time" },
      { section: "Hand-over", label: "Sample kept cool and handed to the laboratory the same day" },
      { section: "Hand-over", label: "Manager told when the laboratory's report is expected" },
    ],
    items: [
      {
        name: "Drinking water test by a recognised laboratory",
        description:
          "Our technician takes a sample of the water your kitchen uses and sends it to a recognised laboratory. The laboratory does the test and writes the report; ECCS does not test the water itself. You get the laboratory's report in your documents.",
        priceRupees: 2200,
        durationMinutes: 45,
      },
    ],
  },
  {
    // The clinic's doctor examines and certifies. ECCS arranges the camp and files the list of staff seen.
    code: "STAFF_MEDICAL",
    name: "Staff medical check-up camp",
    category: "COMPLIANCE",
    partnerDelivered: true,
    sacCode: "998599",
    gstRatePercent: 18,
    tasks: [
      { section: "Before the camp", label: "List of staff to be seen agreed with the manager" },
      { section: "Before the camp", label: "Clean, private place set up for the check-ups" },
      { section: "Check-ups", label: "Each staff member on the list examined by the clinic's doctor" },
      { section: "Check-ups", label: "Samples for laboratory tests collected and labelled by the clinic" },
      { section: "Check-ups", label: "Vaccinations given where due, and recorded" },
      { section: "Close-out", label: "Staff not seen today listed with the manager" },
    ],
    items: [
      {
        name: "Staff medical check-up camp, up to 10 staff",
        description:
          "A doctor from our partner clinic examines your food handlers at your restaurant. The clinic does the check-ups and signs the medical fitness certificates; ECCS arranges the camp and keeps the records. You get the list of staff seen and their certificates in your documents.",
        priceRupees: 13500,
        durationMinutes: 180,
      },
    ],
  },
  {
    // FoSTaC training is given and certified by a training partner approved by FSSAI, never by ECCS.
    code: "FSS_TRAINING",
    name: "Food Safety Supervisor training",
    category: "COMPLIANCE",
    partnerDelivered: true,
    sacCode: "999293",
    gstRatePercent: 18,
    tasks: [
      { section: "Before the training", label: "Name and ID of the person attending checked against the booking" },
      { section: "Before the training", label: "Person registered for the course with the training partner" },
      { section: "Training", label: "Training attended in full" },
      { section: "Training", label: "Assessment taken at the end of the training" },
      { section: "Close-out", label: "Attendance sheet signed by the trainer" },
      { section: "Close-out", label: "Manager told when the certificate is expected" },
    ],
    items: [
      {
        name: "Food Safety Supervisor training (FoSTaC), one seat",
        description:
          "One day of FSSAI's FoSTaC training for the person in charge of food safety in your kitchen. A training partner approved by FSSAI gives the training and the certificate; ECCS books the seat and keeps the record. You get the attendance sheet and, once it is issued, the certificate in your documents.",
        priceRupees: 2000,
        durationMinutes: 480,
      },
    ],
  },
  {
    // ECCS's own work, so it carries ECCS's own dated certificate of service (30 days, a sample period).
    code: "GREASE_TRAP",
    name: "Grease trap cleaning",
    category: "CLEANING",
    partnerDelivered: false,
    sacCode: "998533",
    gstRatePercent: 18,
    certificateValidDays: 30,
    tasks: [
      { section: "Before cleaning", label: "Lid opened and the trap checked before cleaning" },
      { section: "Cleaning", label: "Floating fat and oil skimmed off" },
      { section: "Cleaning", label: "Settled solids removed from the bottom" },
      { section: "Cleaning", label: "Baffles, walls, inlet and outlet scraped and washed" },
      { section: "Close-out", label: "Water flow checked after cleaning, with no leak at the lid" },
      { section: "Close-out", label: "Waste sealed in closed containers and taken away for proper disposal" },
      { section: "Close-out", label: "Dated service sticker placed near the trap" },
    ],
    items: [
      {
        name: "Grease trap cleaning",
        description:
          "We empty and clean your kitchen's grease trap so that fat and food waste do not block the drain or reach the sewer. The waste is taken away, never poured into a drain or manhole. You get a service report with photos and a dated ECCS certificate of service.",
        priceRupees: 3500,
        durationMinutes: 120,
      },
    ],
  },
  {
    // A sale of goods, not a service: the code is an HSN (3402, washing and cleaning preparations), not an SAC.
    // Only cleaning preparations are in this kind, so that one code is right for the whole line.
    // Sanitisers and disinfectants fall under another HSN (3808) and need their own kind.
    code: "CHEMICAL_REFILL",
    name: "Cleaning chemicals refill",
    category: "SUPPLIES",
    partnerDelivered: false,
    sacCode: "3402",
    gstRatePercent: 18,
    tasks: [
      { section: "Refill", label: "Stock left in the kitchen checked with the manager" },
      { section: "Refill", label: "Containers refilled and closed tightly" },
      { section: "Refill", label: "Every container labelled with the product name and how to dilute it" },
      { section: "Safety", label: "Dilution chart put up near the wash area" },
      { section: "Safety", label: "Safety data sheet for each product handed to the manager" },
      { section: "Safety", label: "Chemicals stored away from food" },
    ],
    items: [
      {
        name: "Kitchen cleaning chemicals refill: degreaser 5 litres and dishwashing liquid 5 litres",
        description:
          "We refill your kitchen's degreaser and dishwashing liquid during a visit and label every container. This is a sale of goods, billed under its own tax code. You get labelled containers, a dilution chart for the wall and the safety sheet for each product.",
        priceRupees: 1800,
        durationMinutes: 20,
      },
    ],
  },
];

/**
 * Bookable services added under kinds that already exist. "Hood and duct
 * cleaning on a schedule, with a dated certificate" is the existing chimney
 * kind, which already has a duct task, a 90-day certificate and can be put in
 * any plan at any interval: a second kind would only be a confusing
 * near-duplicate. What was missing is a bookable item for the full duct run.
 */
export const NEW_ITEMS_FOR_EXISTING_KINDS: (ItemInput & { serviceCode: string })[] = [
  {
    serviceCode: "CHIMNEY",
    name: "Hood and duct cleaning, full duct run, with certificate",
    description:
      "The hood, the filters, the whole duct up to the exhaust fan, and the fan itself are cleaned of grease. You get before and after photos, a service report that says which parts of the duct were reached, and a dated ECCS certificate of service. Repeat it every one to three months, depending on how much you cook.",
    priceRupees: 8500,
    durationMinutes: 300,
  },
];

export async function loadNewServices(prisma: PrismaClient): Promise<{ kinds: number; items: number }> {
  let kinds = 0;
  let items = 0;

  const addItem = async (serviceTypeId: string, item: ItemInput) => {
    const existing = await prisma.serviceCatalogItem.findFirst({
      where: { serviceTypeId, name: { path: ["en"], equals: item.name } },
      select: { id: true },
    });
    if (existing) return;
    await prisma.serviceCatalogItem.create({
      data: {
        serviceTypeId,
        name: text(item.name),
        description: text(item.description),
        pricePaise: rupees(item.priceRupees),
        durationMinutes: item.durationMinutes,
      },
    });
    items++;
  };

  for (const kind of NEW_SERVICE_KINDS) {
    let row = await prisma.serviceType.findUnique({ where: { code: kind.code }, select: { id: true } });
    if (!row) {
      // The kind, its task list and the tasks are made together, or not at all.
      row = await prisma.$transaction(async (tx) => {
        const template = await tx.checklistTemplate.create({
          data: {
            kind: "SERVICE",
            title: text(kind.name),
            items: {
              create: kind.tasks.map((task, index) => ({
                position: index + 1,
                section: task.section,
                label: text(task.label),
                ...(task.readingLimit !== undefined && { type: "NUMBER" as const, minValue: 0, maxValue: task.readingLimit }),
              })),
            },
          },
        });
        return tx.serviceType.create({
          data: {
            code: kind.code,
            name: text(kind.name),
            category: kind.category,
            partnerDelivered: kind.partnerDelivered,
            sacCode: kind.sacCode,
            gstRatePercent: kind.gstRatePercent,
            checklistTemplateId: template.id,
            issuesCertificate: kind.certificateValidDays !== undefined,
            certificateValidDays: kind.certificateValidDays ?? null,
          },
          select: { id: true },
        });
      });
      kinds++;
    }
    for (const item of kind.items) await addItem(row.id, item);
  }

  for (const { serviceCode, ...item } of NEW_ITEMS_FOR_EXISTING_KINDS) {
    const kind = await prisma.serviceType.findUnique({ where: { code: serviceCode }, select: { id: true } });
    if (kind) await addItem(kind.id, item);
  }

  return { kinds, items };
}

/** Every piece of English text above, for the translators and the checks. */
export function newServicesEnglish(): string[] {
  const all = [...NEW_SERVICE_KINDS.flatMap((kind) => [kind.name, ...kind.tasks.map((task) => task.label), ...kind.items.flatMap((item) => [item.name, item.description])]), ...NEW_ITEMS_FOR_EXISTING_KINDS.flatMap((item) => [item.name, item.description])];
  return [...new Set(all)];
}
