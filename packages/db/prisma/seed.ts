// Sample data for local development. Everything here is invented:
// company details, prices, SOP wording and people are placeholders
// until the founder supplies real ones (see docs/STATUS.md).
//
// Safe to run repeatedly: it wipes the database first.

import "dotenv/config";
import { randomBytes } from "node:crypto";
import { existsSync } from "node:fs";
import { resolve } from "node:path";
import { createPrismaClient, pinLookup, type Prisma } from "../src/index.js";
import { loadCarrySample } from "./carry-sample.js";
import { loadEccsServices } from "./eccs-services.js";
import { loadInspectionTemplate } from "./inspection-template.js";
import { loadChecklistLibrary } from "./library.js";
import { loadNewServices } from "./new-services.js";
import { addSampleVisits } from "./sample-visits.js";
import { loadSampleSops } from "./sops.js";
import { loadSopLibrary } from "./sop-library.js";
import { translateContent } from "./content-translations.js";
import { loadVendorDirectory } from "./vendors.js";

// PIN_SECRET lives in the repo-root .env, shared with the API.
const rootEnvFile = resolve(import.meta.dirname, "../../../.env");
if (existsSync(rootEnvFile)) process.loadEnvFile(rootEnvFile);
const PIN_SECRET = process.env["PIN_SECRET"];
if (!PIN_SECRET) throw new Error("PIN_SECRET is not set (copy .env.example to .env at the repo root)");
// The server images run with NODE_ENV=production. There, only a test server holding sample data
// (SAMPLE_SERVER=on) may be wiped; the live database starts with seed:live instead.
if (process.env["NODE_ENV"] === "production" && process.env["SAMPLE_SERVER"] !== "on") {
  throw new Error("This seed wipes the whole database, so on a server it runs only with SAMPLE_SERVER=on. For the live database use: npm run seed:live");
}

const prisma = createPrismaClient();

type Text = { en: string; te: string; hi: string };
const t = (en: string, te: string, hi: string): Text => ({ en, te, hi });
const rupees = (amount: number) => Math.round(amount * 100);
const day = (offsetDays: number) => {
  const d = new Date();
  d.setUTCHours(0, 0, 0, 0);
  d.setUTCDate(d.getUTCDate() + offsetDays);
  return d;
};

async function wipe() {
  const tables = await prisma.$queryRaw<{ tablename: string }[]>`
    SELECT tablename FROM pg_tables
    WHERE schemaname = 'public' AND tablename <> '_prisma_migrations'`;
  const names = tables.map((row) => `"public"."${row.tablename}"`).join(", ");
  if (names) {
    await prisma.$executeRawUnsafe(`TRUNCATE TABLE ${names} CASCADE`);
  }
}

async function seedUsers() {
  const make = (phone: string, name: string, language: "EN" | "TE" | "HI" = "EN") =>
    prisma.user.create({ data: { phone, name, language } });

  const superAdmin = await make("+919000000001", "Sample Founder");
  const opsManager = await make("+919000000002", "Sample Ops Manager");
  const supervisor = await make("+919000000003", "Sample Supervisor", "TE");

  await prisma.membership.createMany({
    data: [
      { userId: superAdmin.id, role: "SUPER_ADMIN" },
      { userId: opsManager.id, role: "OPS_MANAGER" },
      { userId: supervisor.id, role: "SUPERVISOR" },
    ],
  });

  return { superAdmin, opsManager, supervisor };
}

async function seedClients() {
  const spice = await prisma.organization.create({
    data: {
      name: "Spice Route Kitchens",
      legalName: "Spice Route Kitchens Pvt Ltd (sample)",
      gstin: "36AAAAA0000A1Z5",
      stateCode: "36",
      billingAddress: "Plot 12, Road No. 36, Jubilee Hills, Hyderabad 500033",
      contactPhone: "+919100000001",
      outlets: {
        create: [
          {
            name: "Spice Route, Jubilee Hills",
            code: "SPICE-JH2K7M",
            address: "Plot 12, Road No. 36, Jubilee Hills",
            pincode: "500033",
            latitude: 17.4326,
            longitude: 78.4071,
            fssaiNumber: "13600000000001",
            kitchenType: "Full-service restaurant",
          },
          {
            name: "Spice Route, Gachibowli",
            code: "SPICE-GB4N8P",
            address: "DLF Cyber City Road, Gachibowli",
            pincode: "500032",
            latitude: 17.4401,
            longitude: 78.3489,
            fssaiNumber: "13600000000002",
            kitchenType: "Full-service restaurant",
          },
        ],
      },
    },
    include: { outlets: true },
  });

  const biryani = await prisma.organization.create({
    data: {
      name: "Deccan Biryani House",
      legalName: "Deccan Biryani House (sample)",
      gstin: "36BBBBB0000B1Z3",
      stateCode: "36",
      billingAddress: "Main Road, Kukatpally, Hyderabad 500072",
      contactPhone: "+919100000002",
      outlets: {
        create: [
          {
            name: "Deccan Biryani House, Kukatpally",
            code: "DECCA-KP6R3T",
            address: "Main Road, Kukatpally",
            pincode: "500072",
            latitude: 17.4849,
            longitude: 78.4138,
            fssaiNumber: "13600000000003",
            kitchenType: "Quick-service restaurant",
          },
        ],
      },
    },
    include: { outlets: true },
  });

  const [jubilee, gachibowli] = spice.outlets;
  const [kukatpally] = biryani.outlets;

  // Restaurant users log in with a PIN. Only owners have a phone and email,
  // used once for the one-time code at onboarding. Real PINs are random;
  // these are fixed so the sample logins in docs/STATUS.md keep working.
  const people: {
    pin: string;
    phone?: string;
    email?: string;
    name: string;
    language: "EN" | "TE" | "HI";
    role: "OWNER" | "MANAGER" | "HEAD_CHEF";
    organizationId: string;
    outletId?: string;
  }[] = [
    { pin: "2580", phone: "+919100000001", email: "owner@spiceroute.example", name: "Sample Owner (Spice Route)", language: "EN", role: "OWNER", organizationId: spice.id },
    { pin: "4821", name: "Sample Manager (Jubilee Hills)", language: "EN", role: "MANAGER", organizationId: spice.id, outletId: jubilee!.id },
    { pin: "7306", name: "Sample Head Chef (Jubilee Hills)", language: "TE", role: "HEAD_CHEF", organizationId: spice.id, outletId: jubilee!.id },
    { pin: "1593", name: "Sample Manager (Gachibowli)", language: "HI", role: "MANAGER", organizationId: spice.id, outletId: gachibowli!.id },
    { pin: "6042", name: "Sample Head Chef (Gachibowli)", language: "HI", role: "HEAD_CHEF", organizationId: spice.id, outletId: gachibowli!.id },
    { pin: "3917", phone: "+919100000002", email: "owner@deccanbiryani.example", name: "Sample Owner (Deccan Biryani)", language: "TE", role: "OWNER", organizationId: biryani.id },
    { pin: "8264", name: "Sample Head Chef (Kukatpally)", language: "TE", role: "HEAD_CHEF", organizationId: biryani.id, outletId: kukatpally!.id },
  ];

  for (const person of people) {
    await prisma.user.create({
      data: {
        phone: person.phone ?? null,
        email: person.email ?? null,
        name: person.name,
        language: person.language,
        pinOrganizationId: person.organizationId,
        pinLookup: pinLookup(PIN_SECRET!, person.organizationId, person.pin),
        memberships: {
          create: { role: person.role, organizationId: person.organizationId, outletId: person.outletId ?? null },
        },
      },
    });
  }

  return { outlets: [jubilee!, gachibowli!, kukatpally!] };
}

type ItemInput = {
  section: string;
  label: Text;
  type?: "YES_NO" | "NUMBER" | "TEXT" | "PHOTO";
  photoRequired?: boolean;
  weight?: number;
  minValue?: number;
  maxValue?: number;
};

const items = (list: ItemInput[]): Prisma.ChecklistItemCreateWithoutTemplateInput[] =>
  list.map((item, index) => ({ position: index + 1, ...item }));

async function seedSopsAndChecklists() {
  const dailySop = await prisma.sopTemplate.create({
    data: {
      code: "SOP-KIT-001",
      category: "Kitchen hygiene",
      isPublished: true,
      title: t("Daily kitchen hygiene", "రోజువారీ వంటగది పరిశుభ్రత", "दैनिक रसोई स्वच्छता"),
      body: t(
        "Sample SOP. Wash hands before handling food. Sanitise prep surfaces before and after each shift. Keep raw and cooked food apart. Record fridge and freezer temperatures twice a day. Empty and clean bins at closing.",
        "నమూనా SOP. ఆహారాన్ని తాకే ముందు చేతులు కడుక్కోండి. ప్రతి షిఫ్ట్‌కు ముందు, తర్వాత ఉపరితలాలను శుభ్రపరచండి. పచ్చి మరియు వండిన ఆహారాన్ని వేరుగా ఉంచండి. ఫ్రిజ్ ఉష్ణోగ్రతలను రోజుకు రెండుసార్లు నమోదు చేయండి. మూసే సమయంలో చెత్త డబ్బాలను ఖాళీ చేసి శుభ్రం చేయండి.",
        "नमूना SOP. खाना छूने से पहले हाथ धोएं। हर शिफ्ट से पहले और बाद में सतहों को सैनिटाइज़ करें। कच्चा और पका खाना अलग रखें। फ्रिज का तापमान दिन में दो बार दर्ज करें। बंद करते समय कूड़ेदान खाली करके साफ करें।",
      ),
    },
  });

  // The basic daily lists ECCS gives every restaurant. Deliberately short:
  // each restaurant adds its own items in the app. Every item needs a photo.
  // Drawn from the Daily Opening and Closing Checks in
  // docs/FSSAI 2026 KITCHEN SAFETY CHECKLIST.docx.
  const opening = await prisma.checklistTemplate.create({
    data: {
      sopTemplateId: dailySop.id,
      kind: "DAILY",
      title: t("Opening checklist", "ప్రారంభ చెక్‌లిస్ట్", "ओपनिंग चेकलिस्ट"),
      items: {
        create: items([
          { section: "Opening", photoRequired: true, label: t("Kitchen floor and counters are clean", "వంటగది నేల మరియు కౌంటర్లు శుభ్రంగా ఉన్నాయి", "रसोई का फर्श और काउंटर साफ हैं") },
          { section: "Opening", photoRequired: true, label: t("Handwash station has soap and water", "చేతులు కడుక్కునే చోట సబ్బు, నీరు ఉన్నాయి", "हाथ धोने की जगह पर साबुन और पानी है") },
          { section: "Opening", photoRequired: true, label: t("Staff in clean uniform, hair covered", "సిబ్బంది శుభ్రమైన యూనిఫాంలో, జుట్టు కప్పి ఉన్నారు", "स्टाफ साफ यूनिफॉर्म में, बाल ढके हुए") },
          { section: "Opening", photoRequired: true, label: t("Fridge and freezer working, food covered", "ఫ్రిజ్, ఫ్రీజర్ పనిచేస్తున్నాయి, ఆహారం కప్పి ఉంది", "फ्रिज और फ्रीज़र चल रहे हैं, खाना ढका हुआ है") },
          { section: "Opening", photoRequired: true, label: t("No signs of pests", "పురుగుల ఆనవాళ్లు లేవు", "कीटों के कोई निशान नहीं") },
        ]),
      },
    },
  });

  const closing = await prisma.checklistTemplate.create({
    data: {
      sopTemplateId: dailySop.id,
      kind: "DAILY",
      title: t("Closing checklist", "ముగింపు చెక్‌లిస్ట్", "क्लोज़िंग चेकलिस्ट"),
      items: {
        create: items([
          { section: "Closing", photoRequired: true, label: t("All food covered, labelled and stored", "ఆహారం అంతా కప్పి, లేబుల్ వేసి, నిల్వ చేయబడింది", "सारा खाना ढका, लेबल किया और रखा गया है") },
          { section: "Closing", photoRequired: true, label: t("Counters and equipment cleaned", "కౌంటర్లు మరియు పరికరాలు శుభ్రం చేయబడ్డాయి", "काउंटर और उपकरण साफ किए गए") },
          { section: "Closing", photoRequired: true, label: t("Floor and drains cleaned", "నేల మరియు డ్రైన్‌లు శుభ్రం చేయబడ్డాయి", "फर्श और नालियां साफ की गईं") },
          { section: "Closing", photoRequired: true, label: t("Waste bins emptied", "చెత్త డబ్బాలు ఖాళీ చేయబడ్డాయి", "कूड़ेदान खाली किए गए") },
          { section: "Closing", photoRequired: true, label: t("Gas and equipment switched off", "గ్యాస్ మరియు పరికరాలు ఆఫ్ చేయబడ్డాయి", "गैस और उपकरण बंद किए गए") },
        ]),
      },
    },
  });

  // The service visits' task lists (pest control, deep clean, chimney) are in eccs-services.ts.

  const inspection = await prisma.checklistTemplate.create({
    data: {
      kind: "INSPECTION",
      title: t("Hygiene inspection (FSSAI Schedule 4 style, sample)", "పరిశుభ్రత తనిఖీ (నమూనా)", "स्वच्छता निरीक्षण (नमूना)"),
      items: {
        create: items([
          { section: "Design and facilities", weight: 2, label: t("Floors, walls and ceilings in good repair and clean", "నేలలు, గోడలు, పైకప్పు బాగున్నాయి మరియు శుభ్రంగా ఉన్నాయి", "फर्श, दीवारें और छत ठीक और साफ हैं") },
          { section: "Design and facilities", weight: 2, label: t("Potable water supply available", "తాగునీటి సరఫరా ఉంది", "पीने योग्य पानी उपलब्ध है") },
          { section: "Control of operation", weight: 4, label: t("Cold food held at or below 5°C", "చల్లని ఆహారం 5°C లేదా అంతకంటే తక్కువలో ఉంది", "ठंडा खाना 5°C या उससे कम पर रखा गया है") },
          { section: "Control of operation", weight: 4, label: t("Raw and cooked food separated", "పచ్చి, వండిన ఆహారం వేరుగా ఉన్నాయి", "कच्चा और पका खाना अलग है") },
          { section: "Maintenance and sanitation", weight: 4, label: t("Pest control records up to date", "పెస్ట్ కంట్రోల్ రికార్డులు తాజాగా ఉన్నాయి", "पेस्ट कंट्रोल रिकॉर्ड अद्यतन हैं") },
          { section: "Maintenance and sanitation", weight: 2, label: t("Exhaust hood and filters free of grease build-up", "ఎగ్జాస్ట్ హుడ్, ఫిల్టర్లపై జిడ్డు పేరుకోలేదు", "एग्ज़ॉस्ट हुड और फ़िल्टर पर ग्रीस जमा नहीं है") },
          { section: "Personal hygiene", weight: 2, label: t("Food handlers medically fit and in clean protective clothing", "ఆహార సిబ్బంది ఆరోగ్యంగా, శుభ్రమైన దుస్తుల్లో ఉన్నారు", "खाद्य कर्मी स्वस्थ और साफ सुरक्षात्मक कपड़ों में हैं") },
          { section: "Training and records", weight: 2, label: t("FSSAI licence displayed and valid", "FSSAI లైసెన్స్ ప్రదర్శించబడింది మరియు చెల్లుబాటులో ఉంది", "FSSAI लाइसेंस प्रदर्शित और वैध है") },
        ]),
      },
    },
  });

  return { opening, closing, inspection };
}

async function seedServices() {
  // The services, their task lists and the two plans are shared with the live start (seed-live.ts).
  const { plans } = await loadEccsServices(prisma);

  await prisma.chemical.createMany({
    data: [
      { name: "Cockroach gel bait (sample)", activeIngredient: "Imidacloprid 2.15%", unit: "g", safetyNotes: "Apply in cracks and crevices only. Keep away from food contact surfaces." },
      { name: "Rodent bait block (sample)", activeIngredient: "Bromadiolone 0.005%", unit: "g", safetyNotes: "Use only inside tamper-resistant stations." },
      { name: "Alkaline degreaser (sample)", activeIngredient: "Sodium hydroxide blend", unit: "ml", safetyNotes: "Wear gloves and goggles. Rinse surfaces with clean water." },
      { name: "Food-safe surface sanitiser (sample)", activeIngredient: "Quaternary ammonium", unit: "ml", safetyNotes: "Dilute as per label. Allow contact time before wiping." },
    ],
  });

  return { plans };
}

async function seedOutletData(
  outlets: { id: string; name: string }[],
  templates: Awaited<ReturnType<typeof seedSopsAndChecklists>>,
  services: Awaited<ReturnType<typeof seedServices>>,
  supervisorId: string,
) {
  for (const [index, outlet] of outlets.entries()) {
    await prisma.outletChecklist.createMany({
      data: [
        { outletId: outlet.id, templateId: templates.opening.id, frequency: "DAILY", dueTime: "10:30" },
        { outletId: outlet.id, templateId: templates.closing.id, frequency: "DAILY", dueTime: "23:30" },
      ],
    });

    const plan = index === 0 ? services.plans.complete : services.plans.essential;
    const subscription = await prisma.subscription.create({
      data: { outletId: outlet.id, planId: plan.id, startDate: day(-20), nextBillingDate: day(10) },
    });

    for (const [lineIndex, line] of plan.lines.entries()) {
      const nextDue = day(2 + lineIndex * 3);
      const schedule = await prisma.serviceSchedule.create({
        data: {
          outletId: outlet.id,
          serviceTypeId: line.serviceTypeId,
          subscriptionId: subscription.id,
          intervalDays: line.intervalDays,
          nextDueDate: nextDue,
        },
      });
      await prisma.job.create({
        data: {
          outletId: outlet.id,
          serviceTypeId: line.serviceTypeId,
          scheduleId: schedule.id,
          plannedFor: nextDue,
          scheduledDate: nextDue,
          scheduledSlot: "AFTER_CLOSING",
          status: "ASSIGNED",
          supervisorId,
        },
      });
    }

    await prisma.licence.createMany({
      data: [
        { outletId: outlet.id, type: "FSSAI", name: "FSSAI licence", number: `1360000000000${index + 1}`, issuedOn: day(-340), expiresOn: day(25) },
        { outletId: outlet.id, type: "FIRE_NOC", name: "Fire NOC", number: `FIRE-SAMPLE-${index + 1}`, issuedOn: day(-200), expiresOn: day(165) },
        { outletId: outlet.id, type: "TRADE_LICENCE", name: "GHMC trade licence", number: `TL-SAMPLE-${index + 1}`, issuedOn: day(-100), expiresOn: day(265) },
      ],
    });

    await prisma.staffMember.createMany({
      data: [
        { outletId: outlet.id, name: "Sample Cook A", jobTitle: "Line cook", monthlySalaryPaise: rupees(22000), overtimeRatePaise: rupees(120), joinedOn: day(-400) },
        { outletId: outlet.id, name: "Sample Cook B", jobTitle: "Tandoor cook", monthlySalaryPaise: rupees(24000), overtimeRatePaise: rupees(130), joinedOn: day(-250) },
        { outletId: outlet.id, name: "Sample Helper", jobTitle: "Kitchen helper", monthlySalaryPaise: rupees(14000), overtimeRatePaise: rupees(80), joinedOn: day(-90) },
        { outletId: outlet.id, name: "Sample Steward", jobTitle: "Dishwashing", monthlySalaryPaise: rupees(13000), overtimeRatePaise: rupees(75), joinedOn: day(-30) },
      ],
    });

    await prisma.foodItem.createMany({
      data: [
        { outletId: outlet.id, shelfLifeHours: 48, storage: "CHILLED", name: t("Onion-tomato gravy base", "ఉల్లి-టమాటా గ్రేవీ బేస్", "प्याज़-टमाटर ग्रेवी बेस") },
        { outletId: outlet.id, shelfLifeHours: 24, storage: "CHILLED", name: t("Marinated chicken", "మేరినేట్ చేసిన చికెన్", "मैरीनेट किया हुआ चिकन") },
        { outletId: outlet.id, shelfLifeHours: 72, storage: "CHILLED", name: t("Ginger-garlic paste", "అల్లం-వెల్లుల్లి పేస్ట్", "अदरक-लहसुन पेस्ट") },
        { outletId: outlet.id, shelfLifeHours: 24, storage: "CHILLED", name: t("Cut vegetables", "తరిగిన కూరగాయలు", "कटी हुई सब्ज़ियां") },
        { outletId: outlet.id, shelfLifeHours: 720, storage: "FROZEN", name: t("Frozen paneer", "ఫ్రోజెన్ పనీర్", "फ्रोज़न पनीर") },
      ],
    });

    await prisma.publicProfile.create({
      data: { outletId: outlet.id, token: randomBytes(9).toString("base64url") },
    });
  }
}

async function main() {
  await wipe();
  const { supervisor } = await seedUsers();
  const { outlets } = await seedClients();
  const templates = await seedSopsAndChecklists();
  const services = await seedServices();
  await seedOutletData(outlets, templates, services, supervisor.id);
  await addSampleVisits(prisma);
  // The services added on 9 Oct 2026. Not in the two sample plans, so they come after the plan visits.
  await loadNewServices(prisma);
  // The sample "What to carry" lists for the day's sheet (20 Oct 2026).
  await loadCarrySample(prisma);
  await loadSampleSops(prisma);
  await loadSopLibrary(prisma);
  await loadInspectionTemplate(prisma);
  await translateContent(prisma);
  const library = await loadChecklistLibrary(prisma);
  // The vendor directory's sample vendors (13 Oct 2026). They belong to no outlet.
  const vendors = await loadVendorDirectory(prisma);

  const counts = {
    users: await prisma.user.count(),
    organizations: await prisma.organization.count(),
    outlets: await prisma.outlet.count(),
    checklistTemplates: await prisma.checklistTemplate.count(),
    checklistItems: await prisma.checklistItem.count(),
    serviceTypes: await prisma.serviceType.count(),
    plans: await prisma.plan.count(),
    subscriptions: await prisma.subscription.count(),
    jobs: await prisma.job.count(),
    licences: await prisma.licence.count(),
    staffMembers: await prisma.staffMember.count(),
    foodItems: await prisma.foodItem.count(),
    checklistLibraryItems: library.total,
    vendors: vendors.total,
  };
  console.log("Seeded sample data:", counts);
}

main()
  .catch((error) => {
    console.error(error);
    process.exitCode = 1;
  })
  .finally(() => prisma.$disconnect());
