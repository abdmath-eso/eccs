// ECCS's first four kinds of service (pest control, kitchen deep clean, chimney and hood
// cleaning, the fire and equipment safety inspection), each with its task list and its
// bookable item, and the two plans built from them (Essential, Complete). The services added
// on 9 Oct 2026 are in new-services.ts.
//
// SAMPLE prices and tax codes, like everything in the seed: to be replaced by the founder and
// confirmed by the accountant (see docs/STATUS.md). They can be changed in the console.
//
// Used by the sample seed (seed.ts) and by the clean live start (seed-live.ts), so both hold
// the same services. Safe to repeat: a kind and a plan are found by their code and a bookable
// item by its English name within its kind; only what is missing is added, and nothing that
// exists is changed, so prices or wording edited in the console are kept.

import type { Prisma, PrismaClient } from "../src/index.js";

type Text = { en: string; te: string; hi: string };
const t = (en: string, te: string, hi: string): Text => ({ en, te, hi });
const rupees = (amount: number) => Math.round(amount * 100);

type TaskInput = { section: string; label: Text; type?: "YES_NO" | "TEXT"; photoRequired?: boolean };

const tasks = (list: TaskInput[]): Prisma.ChecklistItemCreateWithoutTemplateInput[] =>
  list.map((item, index) => ({ position: index + 1, ...item }));

interface KindInput {
  code: "PEST" | "DEEP_CLEAN" | "CHIMNEY" | "SAFETY_INSPECTION";
  name: Text;
  sacCode: string;
  category?: string;
  /** Days ECCS's certificate of service is valid for; left out for kinds that give none. */
  certificateValidDays?: number;
  /** The visit's task list: what the Supervisor ticks. Left out for a kind without one. */
  taskList?: { title: Text; tasks: TaskInput[] };
  item: { name: Text; priceRupees: number; durationMinutes: number };
}

const KINDS: KindInput[] = [
  {
    code: "PEST",
    sacCode: "998531",
    category: "PEST",
    certificateValidDays: 15,
    name: t("Pest control", "పెస్ట్ కంట్రోల్", "पेस्ट कंट्रोल"),
    taskList: {
      title: t("Pest control visit", "పెస్ట్ కంట్రోల్ సందర్శన", "पेस्ट कंट्रोल विज़िट"),
      tasks: [
        { section: "Inspection", label: t("Entry points inspected", "ప్రవేశ మార్గాలు తనిఖీ చేయబడ్డాయి", "प्रवेश बिंदुओं की जांच की गई") },
        { section: "Inspection", label: t("Activity found (describe)", "కనుగొన్న కార్యకలాపం (వివరించండి)", "पाई गई गतिविधि (वर्णन करें)"), type: "TEXT" },
        { section: "Treatment", label: t("Gel bait applied in kitchen", "వంటగదిలో జెల్ బైట్ వేయబడింది", "रसोई में जेल बेट लगाया गया") },
        { section: "Treatment", label: t("Rodent stations checked and refilled", "ఎలుకల స్టేషన్లు తనిఖీ చేసి నింపబడ్డాయి", "चूहा स्टेशनों की जांच और रीफिल") },
        { section: "Treatment", label: t("Fly traps serviced", "ఈగల ట్రాప్‌లు సర్వీస్ చేయబడ్డాయి", "मक्खी ट्रैप की सर्विस की गई") },
        { section: "Close-out", label: t("Food contact surfaces protected during treatment", "చికిత్స సమయంలో ఆహార ఉపరితలాలు రక్షించబడ్డాయి", "उपचार के दौरान खाद्य सतहें सुरक्षित रखी गईं") },
      ],
    },
    item: { name: t("Pest control, single visit", "పెస్ట్ కంట్రోల్, ఒక సందర్శన", "पेस्ट कंट्रोल, एक विज़िट"), priceRupees: 1800, durationMinutes: 60 },
  },
  {
    code: "DEEP_CLEAN",
    sacCode: "998533",
    certificateValidDays: 30,
    name: t("Kitchen deep clean", "వంటగది డీప్ క్లీన్", "रसोई डीप क्लीन"),
    taskList: {
      title: t("Kitchen deep clean", "వంటగది డీప్ క్లీన్", "रसोई डीप क्लीन"),
      tasks: [
        { section: "Cooking line", label: t("Ranges, grills and fryers degreased", "స్టవ్‌లు, గ్రిల్‌లు, ఫ్రయర్‌లు శుభ్రం చేయబడ్డాయి", "रेंज, ग्रिल और फ्रायर की ग्रीस हटाई गई"), photoRequired: true },
        { section: "Cooking line", label: t("Walls and splashbacks cleaned", "గోడలు శుభ్రం చేయబడ్డాయి", "दीवारें साफ की गईं") },
        { section: "Floors and drains", label: t("Floors scrubbed, drains cleared", "నేలలు రుద్ది, డ్రైన్‌లు శుభ్రం చేయబడ్డాయి", "फर्श रगड़े गए, नालियां साफ की गईं"), photoRequired: true },
        { section: "Cold storage", label: t("Fridges and freezers cleaned inside", "ఫ్రిజ్‌లు, ఫ్రీజర్‌లు లోపల శుభ్రం చేయబడ్డాయి", "फ्रिज और फ्रीज़र अंदर से साफ किए गए") },
        { section: "Close-out", label: t("All surfaces sanitised and rinsed", "అన్ని ఉపరితలాలు శానిటైజ్ చేసి కడగబడ్డాయి", "सभी सतहें सैनिटाइज़ करके धोई गईं") },
      ],
    },
    item: { name: t("Kitchen deep clean", "వంటగది డీప్ క్లీన్", "रसोई डीप क्लीन"), priceRupees: 9500, durationMinutes: 360 },
  },
  {
    code: "CHIMNEY",
    sacCode: "998533",
    certificateValidDays: 90,
    name: t("Chimney and hood cleaning", "చిమ్నీ మరియు హుడ్ క్లీనింగ్", "चिमनी और हुड की सफाई"),
    taskList: {
      title: t("Chimney and hood cleaning", "చిమ్నీ మరియు హుడ్ క్లీనింగ్", "चिमनी और हुड की सफाई"),
      tasks: [
        { section: "Hood", label: t("Filters removed, soaked and degreased", "ఫిల్టర్లు తీసి, నానబెట్టి, శుభ్రం చేయబడ్డాయి", "फ़िल्टर निकालकर भिगोए और साफ किए गए"), photoRequired: true },
        { section: "Hood", label: t("Hood interior scraped and washed", "హుడ్ లోపలి భాగం శుభ్రం చేయబడింది", "हुड का अंदरूनी भाग साफ किया गया"), photoRequired: true },
        { section: "Duct", label: t("Duct cleaned to accessible length", "డక్ట్ అందుబాటులో ఉన్నంత వరకు శుభ్రం చేయబడింది", "डक्ट पहुंच योग्य लंबाई तक साफ की गई") },
        { section: "Fan", label: t("Exhaust fan running without noise or vibration", "ఎగ్జాస్ట్ ఫ్యాన్ శబ్దం లేకుండా నడుస్తోంది", "एग्ज़ॉस्ट फैन बिना आवाज़ के चल रहा है") },
      ],
    },
    item: { name: t("Chimney and hood cleaning", "చిమ్నీ మరియు హుడ్ క్లీనింగ్", "चिमनी और हुड की सफाई"), priceRupees: 4500, durationMinutes: 180 },
  },
  {
    code: "SAFETY_INSPECTION",
    sacCode: "998349",
    category: "TESTING",
    name: t("Fire and equipment safety inspection", "అగ్ని మరియు పరికరాల భద్రతా తనిఖీ", "अग्नि और उपकरण सुरक्षा निरीक्षण"),
    item: { name: t("Safety inspection", "భద్రతా తనిఖీ", "सुरक्षा निरीक्षण"), priceRupees: 2500, durationMinutes: 90 },
  },
];

interface PlanInput {
  code: "ESSENTIAL" | "COMPLETE";
  name: Text;
  description: Text;
  /** Per month, before GST. A sample. */
  priceRupees: number;
  lines: { kind: KindInput["code"]; intervalDays: number }[];
}

const PLANS: PlanInput[] = [
  {
    code: "ESSENTIAL",
    priceRupees: 6000,
    name: t("Essential", "ఎసెన్షియల్", "एसेंशियल"),
    description: t("Pest control every 15 days and a quarterly chimney clean.", "ప్రతి 15 రోజులకు పెస్ట్ కంట్రోల్, మూడు నెలలకు ఒకసారి చిమ్నీ క్లీన్.", "हर 15 दिन पेस्ट कंट्रोल और हर तिमाही चिमनी सफाई।"),
    lines: [
      { kind: "PEST", intervalDays: 15 },
      { kind: "CHIMNEY", intervalDays: 90 },
    ],
  },
  {
    code: "COMPLETE",
    priceRupees: 15000,
    name: t("Complete", "కంప్లీట్", "कम्प्लीट"),
    description: t("Pest control every 15 days, monthly deep clean, chimney clean every 45 days and a quarterly safety inspection.", "ప్రతి 15 రోజులకు పెస్ట్ కంట్రోల్, నెలవారీ డీప్ క్లీన్, 45 రోజులకు చిమ్నీ క్లీన్, మూడు నెలలకు భద్రతా తనిఖీ.", "हर 15 दिन पेस्ट कंट्रोल, मासिक डीप क्लीन, हर 45 दिन चिमनी सफाई और तिमाही सुरक्षा निरीक्षण।"),
    lines: [
      { kind: "PEST", intervalDays: 15 },
      { kind: "DEEP_CLEAN", intervalDays: 30 },
      { kind: "CHIMNEY", intervalDays: 45 },
      { kind: "SAFETY_INSPECTION", intervalDays: 90 },
    ],
  },
];

export async function loadEccsServices(prisma: PrismaClient) {
  const added = { kinds: 0, items: 0, plans: 0 };
  const kindIds = {} as Record<KindInput["code"], string>;

  for (const kind of KINDS) {
    let row = await prisma.serviceType.findUnique({ where: { code: kind.code }, select: { id: true } });
    if (!row) {
      // The kind and its task list are made together, or not at all.
      row = await prisma.$transaction(async (tx) => {
        const template = kind.taskList
          ? await tx.checklistTemplate.create({ data: { kind: "SERVICE", title: kind.taskList.title, items: { create: tasks(kind.taskList.tasks) } } })
          : null;
        return tx.serviceType.create({
          data: {
            code: kind.code,
            sacCode: kind.sacCode,
            ...(kind.category && { category: kind.category }),
            checklistTemplateId: template?.id ?? null,
            issuesCertificate: kind.certificateValidDays !== undefined,
            certificateValidDays: kind.certificateValidDays ?? null,
            name: kind.name,
          },
          select: { id: true },
        });
      });
      added.kinds++;
    }
    kindIds[kind.code] = row.id;

    const item = await prisma.serviceCatalogItem.findFirst({
      where: { serviceTypeId: row.id, name: { path: ["en"], equals: kind.item.name.en } },
      select: { id: true },
    });
    if (!item) {
      await prisma.serviceCatalogItem.create({
        data: { serviceTypeId: row.id, pricePaise: rupees(kind.item.priceRupees), durationMinutes: kind.item.durationMinutes, name: kind.item.name },
      });
      added.items++;
    }
  }

  for (const plan of PLANS) {
    if (await prisma.plan.findUnique({ where: { code: plan.code }, select: { id: true } })) continue;
    await prisma.plan.create({
      data: {
        code: plan.code,
        pricePaise: rupees(plan.priceRupees),
        billingCycle: "MONTHLY",
        name: plan.name,
        description: plan.description,
        lines: { create: plan.lines.map((line) => ({ serviceTypeId: kindIds[line.kind], intervalDays: line.intervalDays })) },
      },
    });
    added.plans++;
  }

  const plan = (code: PlanInput["code"]) => prisma.plan.findUniqueOrThrow({ where: { code }, include: { lines: true } });
  return {
    added,
    plans: { essential: await plan("ESSENTIAL"), complete: await plan("COMPLETE") },
  };
}
