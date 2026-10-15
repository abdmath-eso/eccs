import { randomBytes } from "node:crypto";
import type { PrismaClient } from "../generated/prisma/client.js";

// Sample sales for the console's Sales page (15 Oct 2026), so the page can be seen before
// the BDEs log real leads: three sample BDEs (Ravi, Sana and Imran, ECCS logins
// 9000000004 to 9000000006 with the development one-time code), about 155 leads over the
// last four weeks across every stage, source and BDE with their steps, quotes (some
// opened by the owner), a few parked (one "after Diwali") and some lost, and the leads
// of the founder's design (Mehfil Biryani, Paradise Lane Dhaba, Hotel Blue Fox...).
//
// Three leads are linked to the sample clients Spice Route Kitchens and Deccan Biryani
// House. Their First job and On a plan are NOT written here: the Sales page works them
// out from those clients' real approved visits and subscriptions, as it does for real
// leads. Every other lead's first job or plan is written here, as sample history.
//
// Nothing is wiped. Every row is marked `isSample` and has its own `sampleKey`, so
// loading again adds only what is missing and never doubles a row, and
// `removeSalesSample` takes every sample lead (with its steps and quotes), the sample
// targets and the three sample BDE logins out in one go before real use. The sample
// BDEs' logins are recognised by their phone numbers, never by name. Contact numbers
// are in a made-up form (+91 90000 2xxxx) that belongs to no one, and the console never
// dials a sample lead.
//
// The stage, source and kind keys are those of packages/shared/src/sales.ts (this
// package does not depend on that one).

type Db = Pick<PrismaClient, "user" | "membership" | "lead" | "leadActivity" | "quote" | "salesTarget" | "organization" | "serviceCatalogItem" | "plan" | "job" | "subscription" | "session" | "otpChallenge">;

/** The three sample BDEs, by their login. */
export const SAMPLE_BDES = [
  { key: "Ravi", phone: "+919000000004", name: "Ravi" },
  { key: "Sana", phone: "+919000000005", name: "Sana" },
  { key: "Imran", phone: "+919000000006", name: "Imran" },
] as const;
type Seller = (typeof SAMPLE_BDES)[number]["key"] | "FOUNDER";

const FOUNDER_PHONE = "+919000000001";

const DAY_MS = 86_400_000;
const toTime = (date: string) => Date.parse(`${date}T00:00:00.000Z`);
const addDays = (date: string, days: number) => new Date(toTime(date) + days * DAY_MS).toISOString().slice(0, 10);
const indiaToday = (now: Date) => new Intl.DateTimeFormat("en-CA", { timeZone: "Asia/Kolkata" }).format(now);
const moment = (date: string, time: string) => new Date(`${date}T${time}:00.000+05:30`);
const indiaDate = (at: Date) => indiaToday(at);
const weekday = (date: string) => new Date(`${date}T00:00:00Z`).getUTCDay();
const mondayOf = (date: string) => addDays(date, -((weekday(date) + 6) % 7));

/** The same "random" choices every time, so the sample reads the same on every machine. */
function numbers(seed: number) {
  let state = seed >>> 0;
  return () => {
    state = (state + 0x6d2b79f5) >>> 0;
    let t = state;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

const STAGES = ["NEW", "CONTACTED", "CHECK_BOOKED", "CHECK_DONE", "QUOTED", "FIRST_JOB", "ON_PLAN"] as const;
type Stage = (typeof STAGES)[number];
const rank = (stage: Stage) => STAGES.indexOf(stage);
const STEP_STAGE: Record<string, Stage> = { CALL: "CONTACTED", VISIT: "CONTACTED", ASKED: "CONTACTED", CHECK_BOOKED: "CHECK_BOOKED", CHECK_DONE: "CHECK_DONE", QUOTE_SENT: "QUOTED" };
const BY_THE_APP = new Set(["WON", "QUOTE_OPENED"]);

interface Step {
  kind: string;
  at: Date;
  note?: string;
  fromStage?: Stage;
  toStage?: Stage;
  checkAt?: Date;
  checkWith?: string;
  findings?: number;
  amountPaise?: number;
  quoteKey?: string;
  signal?: string;
  rating?: number;
  sameDay?: boolean;
}

interface QuotePlan {
  key: string;
  lines: { kind: "SERVICE" | "PLAN"; pick: number; quantity: number }[];
  sentAt: Date;
  opens: Date[];
}

/** One sample lead and the story of what happened to it, step by step. */
class Story {
  stage: Stage = "NEW";
  status: "OPEN" | "PARKED" | "LOST" = "OPEN";
  steps: Step[] = [];
  quotes: QuotePlan[] = [];
  lastActivity: Date;
  fields: Record<string, unknown> = {};
  readonly created: Date;

  constructor(
    readonly key: string,
    readonly lead: { name: string; area: string; address: string; contactName: string; contactPhone: string; kitchens: number; source: string; referrerName: string | null; owner: Seller; organization?: "SPICE" | "DECCAN" },
    created: Date,
    private readonly now: Date,
  ) {
    this.created = this.past(created);
    this.lastActivity = this.created;
    this.steps.push({ kind: "CREATED", at: this.created });
  }

  /** Never after the moment the sample is loaded. */
  past(at: Date) {
    return at.getTime() > this.now.getTime() - 10 * 60_000 ? new Date(this.now.getTime() - 10 * 60_000) : at;
  }

  step(kind: string, at: Date, extra: Omit<Step, "kind" | "at"> = {}) {
    const when = this.past(at);
    const target = STEP_STAGE[kind] ?? (extra.toStage as Stage | undefined);
    const entry: Step = { kind, at: when, ...extra };
    if (target && rank(target) > rank(this.stage)) {
      entry.fromStage = this.stage;
      entry.toStage = target;
      this.stage = target;
    } else {
      delete entry.toStage;
    }
    this.steps.push(entry);
    if (!BY_THE_APP.has(kind)) this.lastActivity = when;
    return when;
  }

  quote(key: string, lines: QuotePlan["lines"], sentAt: Date, opens: Date[] = []) {
    const sent = this.step("QUOTE_SENT", sentAt, { quoteKey: key });
    const opened = opens.map((at) => this.past(at)).filter((at) => at > sent);
    this.quotes.push({ key, lines, sentAt: sent, opens: opened });
    for (const at of opened) this.step("QUOTE_OPENED", at, { quoteKey: key });
  }
}

// ───────────────────────── Invented names in real Hyderabad localities ─────────────────────────

const AREAS = [
  "Banjara Hills", "Jubilee Hills", "Gachibowli", "Madhapur", "Kondapur", "Kukatpally", "Ameerpet", "Begumpet", "Secunderabad",
  "Tolichowki", "Mehdipatnam", "Himayatnagar", "Abids", "Koti", "Dilsukhnagar", "LB Nagar", "Uppal", "Tarnaka", "Somajiguda",
  "Panjagutta", "Manikonda", "Miyapur", "Chandanagar", "Attapur", "Masab Tank", "Narayanguda", "Malakpet", "Nampally",
  "Habsiguda", "AS Rao Nagar", "Sainikpuri", "Kompally",
];
const NAME_FIRST = [
  "Saffron", "Golconda", "Deccan Pearl", "Nizami", "Charcoal", "Lakeview", "Hitech", "Moonlight", "Sunrise", "Silver Spoon", "Green Chilli",
  "Royal Tandoor", "Coastal", "Andhra Ruchi", "Kakatiya", "Malabar Coast", "Udupi Grand", "Chettinad Spice", "Punjab Rasoi", "Mughal Darbar",
  "Irani Chai", "Hyderabad Grill", "Dum Pukht", "Mirchi Masala", "Banana Leaf", "Tamarind", "Curry Leaf", "Spice Garden", "Kebab Corner",
  "Lotus", "Peacock", "Cinnamon", "Cardamom", "Pepper Pot", "Ginger Garlic", "Tiffin Box", "Rasam", "Pulao Point", "Haleem Hut", "Biryani Bay",
];
const NAME_KIND = ["Kitchen", "Biryani House", "Dhaba", "Mess", "Tiffins", "Cafe", "Grill", "Restaurant", "Family Restaurant", "Bakery", "Food Court", "Bistro"];
const CONTACTS = [
  "Faisal", "Suresh", "Lakshmi", "Venkat", "Ayesha", "Ramesh", "Priya", "Arjun", "Salma", "Kiran", "Naresh", "Anjali", "Imtiaz", "Deepa",
  "Srinivas", "Zoya", "Mahesh", "Kavitha", "Rafiq", "Swathi", "Ravinder", "Nikhil", "Farah", "Gopal",
];
const CHEFS = ["Chef Raju", "Chef Salim", "Chef Anand", "Chef Farhan", "Chef Mary"];
const PARTNERS = ["Deccan Pest Partners (sample)", "AquaTest Labs (sample)", "Hyderabad Hotel Suppliers (sample)"];
const CHECKERS = ["Naveen", "Prakash", "Ramesh"];
const PARK_REASONS = ["owner travelling", "renovating the kitchen", "budget next month", "after Sankranti", "new manager joining", "busy wedding season"];
const LOST_REASONS = ["went with another vendor", "too expensive for now", "closed down", "own staff cleans", "not interested"];
const NEXT_ACTIONS = ["Call back", "Visit the owner", "Book the free check", "Follow up on the quote", "Meet the partner"];
const SOURCES: [string, number][] = [
  ["FIELD_VISIT", 0.5],
  ["CHEF_REFERRAL", 0.15],
  ["PARTNER_REFERRAL", 0.1],
  ["DRIVE", 0.1],
  ["WHATSAPP_GROUP", 0.08],
  ["AGGREGATOR_HUB", 0.05],
  ["OTHER", 0.02],
];

/** The made-up form of a sample contact's number: +91 90000 2xxxx. */
const samplePhone = (index: number) => `+9190000${String(20_000 + index).padStart(5, "0")}`;

// ───────────────────────── The leads ─────────────────────────

/** How many leads of each kind the sample makes besides the design's own, and how old each kind can be (days). */
const MIX: { stage: Stage; status: "OPEN" | "PARKED" | "LOST"; count: number; age: [number, number] }[] = [
  { stage: "ON_PLAN", status: "OPEN", count: 8, age: [15, 27] },
  { stage: "FIRST_JOB", status: "OPEN", count: 9, age: [9, 25] },
  { stage: "QUOTED", status: "LOST", count: 6, age: [8, 27] },
  { stage: "CONTACTED", status: "LOST", count: 8, age: [5, 27] },
  { stage: "CONTACTED", status: "PARKED", count: 15, age: [4, 27] },
  { stage: "QUOTED", status: "PARKED", count: 9, age: [8, 27] },
  { stage: "QUOTED", status: "OPEN", count: 13, age: [4, 20] },
  { stage: "CHECK_DONE", status: "OPEN", count: 2, age: [3, 9] },
  { stage: "CHECK_BOOKED", status: "OPEN", count: 8, age: [1, 8] },
  { stage: "CONTACTED", status: "OPEN", count: 33, age: [0, 20] },
  { stage: "NEW", status: "OPEN", count: 26, age: [0, 5] },
];

/** Every sample lead's story up to `now`. Exported for the test that checks them. */
export function sampleStories(now: Date, linked: { spice: LinkedFacts | null; deccan: LinkedFacts | null } = { spice: null, deccan: null }): Story[] {
  const today = indiaToday(now);
  const random = numbers(1510);
  const pick = <T>(list: readonly T[]) => list[Math.floor(random() * list.length)]!;
  const between = (low: number, high: number) => low + Math.floor(random() * (high - low + 1));
  const day = (offset: number) => addDays(today, offset);
  const clock = () => `${String(between(9, 18)).padStart(2, "0")}:${pick(["00", "10", "20", "30", "40", "50"])}`;
  const at = (offset: number, time = clock()) => moment(day(offset), time);
  const stories: Story[] = [];
  let phones = 0;
  const contact = () => ({ contactName: pick(CONTACTS), contactPhone: samplePhone(++phones) });

  // ── The leads of the founder's design ──
  const designLead = (key: string, name: string, owner: Seller, area: string, kitchens: number, ageDays: number, source = "FIELD_VISIT", referrerName: string | null = null) =>
    new Story(`sample-lead-${key}`, { name: `${name} (sample)`, area, address: `${area}, Hyderabad`, ...contact(), kitchens, source, referrerName, owner }, at(-ageDays, "10:30"), now);

  {
    // Parked on 28 Oct "after Diwali"; the date passed three days ago.
    const story = designLead("mehfil", "Mehfil Biryani", "Imran", "Tolichowki", 1, 32);
    story.step("VISIT", at(-31, "12:00"));
    const parked = story.step("PARKED", at(-29, "16:10"), { note: "after Diwali" });
    story.status = "PARKED";
    story.fields = { parkedAt: parked, parkedUntil: day(-3), parkedReason: "after Diwali" };
    stories.push(story);
  }
  {
    // A quote sent five days ago, opened twice by the owner, no reply since.
    const story = designLead("paradise-lane", "Paradise Lane Dhaba", "Ravi", "Banjara Hills", 1, 12);
    story.step("CALL", at(-11, "11:00"));
    story.step("CHECK_BOOKED", at(-10, "15:00"), { checkAt: at(-9, "11:00"), checkWith: "Naveen" });
    story.step("CHECK_DONE", at(-9, "12:15"), { findings: 4 });
    story.quote("sample-quote-paradise-lane", [{ kind: "SERVICE", pick: 7, quantity: 1 }, { kind: "SERVICE", pick: 6, quantity: 1 }], at(-5, "18:20"), [at(-2, "09:40"), at(-1, "20:10")]);
    story.fields = { checkDoneAt: at(-9, "12:15"), checkFindings: 4 };
    stories.push(story);
  }
  {
    // A free check done eight days ago and no quote yet; the BDE meant to send it at ten.
    const story = designLead("blue-fox", "Hotel Blue Fox", "Imran", "Jubilee Hills", 1, 11);
    story.step("VISIT", at(-10, "12:30"));
    story.step("CHECK_BOOKED", at(-10, "12:40"), { checkAt: at(-8, "15:00"), checkWith: "Prakash" });
    story.step("CHECK_DONE", at(-8, "16:00"), { findings: 6 });
    story.fields = { checkDoneAt: at(-8, "16:00"), checkFindings: 6, nextAction: "Send the quote", nextActionAt: at(0, "10:00") };
    stories.push(story);
  }
  {
    // Today's free check at eleven, with Naveen.
    const story = designLead("tandoori-nights", "Tandoori Nights, Gachibowli", "Sana", "Gachibowli", 1, 3);
    story.step("CALL", at(-2, "11:30"));
    story.step("CHECK_BOOKED", at(-1, "17:00"), { checkAt: at(0, "11:00"), checkWith: "Naveen" });
    story.fields = { checkAt: at(0, "11:00"), checkWith: "Naveen" };
    stories.push(story);
  }
  {
    // The first job was ten days ago: the day-10 call is today at half past twelve.
    const story = designLead("cafe-nilgiri", "Cafe Nilgiri", "FOUNDER", "Himayatnagar", 1, 22);
    story.step("CALL", at(-21, "10:00"));
    story.step("CHECK_BOOKED", at(-21, "10:10"), { checkAt: at(-19, "11:00"), checkWith: "Prakash" });
    story.step("CHECK_DONE", at(-19, "12:30"), { findings: 3 });
    story.quote("sample-quote-cafe-nilgiri", [{ kind: "SERVICE", pick: 9, quantity: 1 }], at(-17, "17:00"), [at(-16, "09:15")]);
    story.step("CALL", at(-14, "12:00"));
    const won = story.step("WON", at(-10, "18:00"), { toStage: "FIRST_JOB", amountPaise: 950_000, rating: 4, sameDay: true });
    story.quote("sample-quote-cafe-nilgiri-plan", [{ kind: "PLAN", pick: 0, quantity: 1 }], at(-8, "11:00"));
    story.fields = { wonAt: won, nextAction: "Day-10 call", nextActionAt: at(0, "12:30") };
    stories.push(story);
  }
  {
    // On the Complete plan for three of their five kitchens: pitch the other two at four.
    const story = designLead("hyderabad-kitchen", "Hyderabad Kitchen Co", "Sana", "Madhapur", 5, 27, "PARTNER_REFERRAL", "Hyderabad Hotel Suppliers (sample)");
    story.step("VISIT", at(-27, "15:00"));
    story.step("CHECK_BOOKED", at(-26, "10:00"), { checkAt: at(-25, "10:00"), checkWith: "Naveen" });
    story.step("CHECK_DONE", at(-25, "11:30"), { findings: 5 });
    story.quote("sample-quote-hkc", [{ kind: "SERVICE", pick: 9, quantity: 3 }], at(-24, "12:00"), [at(-24, "20:30")]);
    const won = story.step("WON", at(-21, "17:30"), { toStage: "FIRST_JOB", amountPaise: 2_850_000, rating: 5, sameDay: true });
    story.quote("sample-quote-hkc-plan", [{ kind: "PLAN", pick: 1, quantity: 3 }], at(-20, "11:00"), [at(-20, "15:00")]);
    const plan = story.step("WON", at(-18, "12:00"), { toStage: "ON_PLAN", amountPaise: 4_500_000 });
    story.step("CALL", at(-10, "11:00"));
    story.step("ASKED", at(-3, "16:30"), { signal: "QUOTE" });
    story.fields = { wonAt: won, planAt: plan, nextAction: "Pitch the other two kitchens", nextActionAt: at(0, "16:00") };
    stories.push(story);
  }
  {
    // First job on Tuesday, signed off the same day and rated 5: offer the Essential plan.
    const story = designLead("green-leaf", "Green Leaf Tiffins", "Ravi", "Ameerpet", 1, 9, "CHEF_REFERRAL", "Chef Raju");
    story.step("CALL", at(-9, "10:30"));
    story.step("CHECK_BOOKED", at(-9, "10:40"), { checkAt: at(-7, "16:00"), checkWith: "Ramesh" });
    story.step("CHECK_DONE", at(-7, "17:00"), { findings: 5 });
    story.quote("sample-quote-green-leaf", [{ kind: "SERVICE", pick: 9, quantity: 1 }], at(-6, "12:00"), [at(-6, "19:00")]);
    const won = story.step("WON", at(-2, "15:30"), { toStage: "FIRST_JOB", amountPaise: 950_000, rating: 5, sameDay: true });
    story.step("ASKED", at(-1, "11:00"), { signal: "MONTHLY_PRICE" });
    story.fields = { wonAt: won };
    stories.push(story);
  }
  // Imran's leads waiting for a next step (the Team design's "What the app found").
  for (const [key, name, area, ago] of [
    ["tandoori-hut", "Tandoori Hut", "Kukatpally", 9],
    ["sri-krishna", "Sri Krishna Tiffins", "Ameerpet", 10],
    ["cafe-mocha", "Cafe Mocha Road No. 10", "Banjara Hills", 12],
  ] as const) {
    const story = designLead(key, name, "Imran", area, 1, ago + 1);
    story.step("VISIT", at(-ago, "12:00"));
    stories.push(story);
  }

  // ── The leads linked to the sample clients: their first job and plan come from the app ──
  const linkedStory = (key: string, name: string, owner: Seller, area: string, kitchens: number, facts: LinkedFacts, organization: "SPICE" | "DECCAN") => {
    const created = moment(facts.createdOn, "11:00");
    const story = new Story(`sample-lead-${key}`, { name: `${name} (sample)`, area, address: `${area}, Hyderabad`, ...contact(), kitchens, source: "FIELD_VISIT", referrerName: null, owner, organization }, created, now);
    const after = (days: number, time: string) => moment(addDays(facts.createdOn, days), time);
    story.step("VISIT", after(0, "12:00"));
    story.step("CHECK_BOOKED", after(1, "10:00"), { checkAt: after(2, "11:00"), checkWith: "Naveen" });
    story.step("CHECK_DONE", after(2, "12:30"), { findings: 4 });
    story.quote(`sample-quote-${key}`, facts.withPlan ? [{ kind: "PLAN", pick: 1, quantity: kitchens }] : [{ kind: "SERVICE", pick: 9, quantity: 1 }], after(3, "17:00"), [after(3, "21:00")]);
    // Once the app shows the client paying: the plan offer and the day-10 call, as a BDE would have logged them.
    if (!facts.withPlan) story.quote(`sample-quote-${key}-plan`, [{ kind: "PLAN", pick: 0, quantity: 1 }], moment(addDays(facts.firstEventOn, 2), "12:00"));
    if (addDays(facts.firstEventOn, 10) < today) story.step("CALL", moment(addDays(facts.firstEventOn, 10), "11:30"));
    story.fields = { checkDoneAt: after(2, "12:30"), checkFindings: 4 };
    return story;
  };
  if (linked.spice) stories.push(linkedStory("spice-route", "Spice Route Kitchens", "Ravi", "Jubilee Hills", 2, linked.spice, "SPICE"));
  if (linked.deccan) stories.push(linkedStory("deccan-biryani", "Deccan Biryani House", "Sana", "Kukatpally", 1, linked.deccan, "DECCAN"));
  if (linked.spice) {
    // Two new outlets of a client already on two plans: quoted, and the owner asked for the quote.
    const story = new Story(
      "sample-lead-spice-route-new-outlets",
      { name: "Spice Route Kitchens, new outlets (sample)", area: "Gachibowli", address: "Gachibowli, Hyderabad", ...contact(), kitchens: 4, source: "OTHER", referrerName: null, owner: "Ravi", organization: "SPICE" },
      at(-6, "11:00"),
      now,
    );
    story.step("VISIT", at(-5, "12:00"));
    story.step("ASKED", at(-5, "12:20"), { signal: "QUOTE" });
    story.quote("sample-quote-spice-new-outlets", [{ kind: "PLAN", pick: 1, quantity: 2 }], at(-3, "17:30"), [at(-2, "10:20")]);
    story.step("CALL", at(-1, "12:00"), { note: "Owner decides after the weekend" });
    stories.push(story);
  }

  // ── Everyone else ──
  const owners: Seller[] = ["Ravi", "Sana", "Imran"];
  const usedNames = new Set(stories.map((story) => story.lead.name));
  let nameIndex = 0;
  const nextName = () => {
    for (;;) {
      const first = NAME_FIRST[nameIndex % NAME_FIRST.length]!;
      const kind = NAME_KIND[(nameIndex * 7 + Math.floor(nameIndex / NAME_FIRST.length)) % NAME_KIND.length]!;
      nameIndex += 1;
      const name = `${first} ${kind} (sample)`;
      if (!usedNames.has(name)) {
        usedNames.add(name);
        return name;
      }
    }
  };
  const source = () => {
    let roll = random();
    for (const [key, share] of SOURCES) {
      roll -= share;
      if (roll <= 0) return key;
    }
    return "FIELD_VISIT";
  };
  // ── This week's work, so the week's figures and the BDEs' targets have something to read ──
  // Each BDE: free checks done this week (quoted the same day), first jobs won this week (a
  // plan offered straight after), and one client going on a plan this week. Ravi's is in
  // Banjara Hills, near Paradise Lane Dhaba (the design's "near a plan customer"). Made after
  // everyone else (see the end), so it never changes the other leads' names or story.
  const thisWeek = () => {
  const daysIn = Math.round((Date.parse(`${today}T00:00:00Z`) - Date.parse(`${mondayOf(today)}T00:00:00Z`)) / DAY_MS);
  /** Today's offset for this week's day `index` (Monday is 0), never after today. */
  const onDay = (index: number) => Math.min(0, -daysIn + index);
  const MOMENTUM: [owner: Seller, checks: number, jobs: number, area: string][] = [
    ["Ravi", 4, 2, "Banjara Hills"],
    ["Sana", 2, 2, "Kondapur"],
    ["Imran", 2, 2, "Jubilee Hills"],
  ];
  let week = 0;
  for (const [owner, checks, jobs, planArea] of MOMENTUM) {
    const make = (age: number, area: string) => {
      week += 1;
      return new Story(`sample-lead-week-${String(week).padStart(2, "0")}`, { name: nextName(), area, address: `${area}, Hyderabad`, ...contact(), kitchens: 1, source: source(), referrerName: null, owner }, at(-age, "10:15"), now);
    };
    const quoteKey = () => `sample-quote-week-${String(week).padStart(2, "0")}`;
    for (let index = 0; index < checks; index += 1) {
      const story = make(daysIn + 2, pick(AREAS));
      story.step("VISIT", at(-daysIn - 2, "11:00"));
      story.step("CHECK_BOOKED", at(-daysIn - 2, "11:20"), { checkAt: at(onDay(index % 3), "11:00"), checkWith: pick(CHECKERS) });
      const findings = between(2, 6);
      const done = story.step("CHECK_DONE", at(onDay(index % 3), "12:30"), { findings });
      story.quote(quoteKey(), [{ kind: "SERVICE", pick: between(5, 9), quantity: 1 }], at(onDay(index % 3), "17:30"));
      story.fields = { checkDoneAt: done, checkFindings: findings };
      stories.push(story);
    }
    for (let index = 0; index < jobs; index += 1) {
      const story = make(daysIn + 10, pick(AREAS));
      story.step("CALL", at(-daysIn - 10, "12:00"));
      story.step("CHECK_BOOKED", at(-daysIn - 9, "10:00"), { checkAt: at(-daysIn - 8, "11:00"), checkWith: pick(CHECKERS) });
      const done = story.step("CHECK_DONE", at(-daysIn - 8, "12:30"), { findings: between(2, 6) });
      story.quote(quoteKey(), [{ kind: "SERVICE", pick: between(5, 9), quantity: 1 }], at(-daysIn - 7, "17:00"), [at(-daysIn - 6, "20:00")]);
      story.step("CALL", at(-daysIn - 5, "11:00"));
      const won = story.step("WON", at(onDay(1 + index), "16:00"), { toStage: "FIRST_JOB", amountPaise: 450_000, rating: 5 - index, sameDay: true });
      story.quote(`${quoteKey()}-plan`, [{ kind: "PLAN", pick: 0, quantity: 1 }], at(onDay(1 + index), "18:00"));
      story.fields = { checkDoneAt: done, wonAt: won };
      stories.push(story);
    }
    {
      const story = make(daysIn + 18, planArea);
      story.step("VISIT", at(-daysIn - 18, "11:30"));
      story.step("CHECK_BOOKED", at(-daysIn - 17, "10:00"), { checkAt: at(-daysIn - 16, "11:00"), checkWith: pick(CHECKERS) });
      const done = story.step("CHECK_DONE", at(-daysIn - 16, "12:30"), { findings: between(3, 6) });
      story.quote(quoteKey(), [{ kind: "SERVICE", pick: 9, quantity: 1 }], at(-daysIn - 15, "17:00"), [at(-daysIn - 15, "21:00")]);
      const won = story.step("WON", at(-daysIn - 12, "15:00"), { toStage: "FIRST_JOB", amountPaise: 950_000, rating: 5, sameDay: true });
      story.quote(`${quoteKey()}-plan`, [{ kind: "PLAN", pick: 0, quantity: 1 }], at(-daysIn - 11, "12:00"), [at(-daysIn - 10, "19:30")]);
      story.step("CALL", at(-daysIn - 2, "11:00"));
      const plan = story.step("WON", at(onDay(2), "12:00"), { toStage: "ON_PLAN", amountPaise: 600_000 });
      story.fields = { checkDoneAt: done, wonAt: won, planAt: plan };
      stories.push(story);
    }
  }
  };

  let parkedDue = 0;
  let serial = 0;
  for (const group of MIX) {
    for (let index = 0; index < group.count; index += 1) {
      serial += 1;
      const age = between(group.age[0], group.age[1]);
      const from = source();
      const owner = owners[serial % 3]!;
      const area = pick(AREAS);
      const kitchens = random() < 0.2 ? between(2, 4) : 1;
      const referrerName = from === "CHEF_REFERRAL" ? pick(CHEFS) : from === "PARTNER_REFERRAL" ? pick(PARTNERS) : null;
      const created = at(-age, `${String(between(9, 17)).padStart(2, "0")}:${pick(["05", "25", "45"])}`);
      const story = new Story(`sample-lead-${String(serial).padStart(3, "0")}`, { name: nextName(), area, address: `${area}, Hyderabad`, ...contact(), kitchens, source: from, referrerName, owner }, created, now);
      // Day offsets from today for each step, spread over the lead's age.
      let cursor = -age;
      const advance = (low: number, high: number) => {
        cursor = Math.min(0, cursor + between(low, high));
        return cursor;
      };
      const target = group.stage;
      if (rank(target) >= rank("CONTACTED")) story.step(random() < 0.55 ? "VISIT" : "CALL", at(advance(0, 1)));
      if (rank(target) >= rank("CHECK_BOOKED")) {
        const checkDay = target === "CHECK_BOOKED" ? between(1, 4) : Math.min(0, cursor + between(1, 2));
        const checkWith = pick(CHECKERS);
        const checkAt = at(checkDay, pick(["10:00", "11:30", "15:00", "16:30"]));
        story.step("CHECK_BOOKED", at(advance(0, 1)), { checkAt, checkWith });
        if (target === "CHECK_BOOKED") story.fields = { checkAt, checkWith };
        else cursor = Math.max(cursor, checkDay);
      }
      if (rank(target) >= rank("CHECK_DONE")) {
        const findings = between(1, 7);
        const done = story.step("CHECK_DONE", at(cursor, "17:00"), { findings });
        story.fields = { checkDoneAt: done, checkFindings: findings };
      }
      if (rank(target) >= rank("QUOTED")) {
        const opened = random() < 0.5;
        const sent = advance(1, 2);
        const lines = [{ kind: "SERVICE" as const, pick: between(1, 9), quantity: 1 }, ...(random() < 0.4 ? [{ kind: "SERVICE" as const, pick: between(1, 9), quantity: 1 }] : [])];
        // Each service once on a quote.
        const unique = lines.filter((line, position) => lines.findIndex((other) => other.pick === line.pick) === position);
        story.quote(`sample-quote-${String(serial).padStart(3, "0")}`, unique, at(sent, "18:00"), opened ? [at(Math.min(0, sent + 1), "20:15")] : []);
        // The owner opened it, and the BDE called back the next day.
        if (opened && sent + 2 <= 0) story.step("CALL", at(sent + 2, "11:00"));
      }
      if (rank(target) >= rank("FIRST_JOB")) {
        const wonDay = advance(2, 4);
        // The sale's value is the quote's, worked out when the rows are written; this is only for a sale with no quote.
        const won = story.step("WON", at(wonDay, "17:00"), { toStage: "FIRST_JOB", amountPaise: 450_000, rating: between(3, 5), sameDay: random() < 0.6 });
        story.fields = { ...story.fields, wonAt: won };
        // A client on a plan has every kitchen on it.
        const planLine = { kind: "PLAN" as const, pick: random() < 0.7 ? 0 : 1, quantity: target === "ON_PLAN" ? kitchens : 1 };
        if (wonDay + 1 <= 0) story.quote(`sample-quote-${String(serial).padStart(3, "0")}-plan`, [planLine], at(wonDay + 1, "12:00"));
        if (target === "ON_PLAN") {
          const planDay = Math.min(0, wonDay + between(2, 4));
          const plan = story.step("WON", at(planDay, "13:00"), { toStage: "ON_PLAN", amountPaise: 600_000 * kitchens });
          story.fields = { ...story.fields, planAt: plan };
        }
        if (wonDay + 10 <= 0) story.step("CALL", at(wonDay + 10, "12:00"));
      }
      if (group.status === "PARKED") {
        const parkedOn = advance(0, 2);
        const due = parkedDue < 1 && age > 12;
        if (due) parkedDue += 1;
        const reason = pick(PARK_REASONS);
        const parked = story.step("PARKED", at(parkedOn, "17:30"), { note: reason });
        story.status = "PARKED";
        story.fields = { ...story.fields, parkedAt: parked, parkedUntil: due ? day(-1) : day(between(4, 40)), parkedReason: reason };
      }
      if (group.status === "LOST") {
        const reason = pick(LOST_REASONS);
        const lost = story.step("LOST", at(advance(1, 3), "18:00"), { note: reason });
        story.status = "LOST";
        story.fields = { ...story.fields, lostAt: lost, lostReason: reason };
      }
      // About a third of the open leads still in the early stages have a next step in the diary.
      if (group.status === "OPEN" && (target === "CONTACTED" || target === "QUOTED") && random() < 0.35) {
        const offset = random() < 0.08 ? 0 : between(1, 6);
        story.fields = { ...story.fields, nextAction: pick(NEXT_ACTIONS), nextActionAt: at(offset, pick(["10:30", "12:00", "15:00", "17:30"])) };
      }
      stories.push(story);
    }
  }
  thisWeek();
  return stories;
}

/** What the loader read about a sample client, to date its linked lead before the client's own visits and plans. */
interface LinkedFacts {
  /** The day the lead is logged: a few days before what it should catch. */
  createdOn: string;
  /** The first approved visit or plan on or after that day. */
  firstEventOn: string;
  /** True when a plan starts after the lead (so the quote is for a plan). */
  withPlan: boolean;
}

/**
 * Dates a linked lead so the client's real history moves it on: for Spice Route, a few
 * days before its plans started (so it reaches On a plan); for Deccan Biryani House, a
 * few days before its latest approved visit (so it reaches First job). Null when the
 * client is not there or has nothing recent enough.
 */
async function linkedFacts(db: Db, organizationId: string, today: string, aim: "plan" | "job"): Promise<LinkedFacts | null> {
  const [jobs, plans] = await Promise.all([
    db.job.findMany({ where: { status: "APPROVED", outlet: { organizationId } }, select: { approvedAt: true, completedAt: true, scheduledDate: true } }),
    db.subscription.findMany({ where: { status: "ACTIVE", outlet: { organizationId } }, select: { startDate: true } }),
  ]);
  const earliest = addDays(today, -45);
  const approvals = jobs.map((job) => indiaDate(job.approvedAt ?? job.completedAt ?? job.scheduledDate)).filter((date) => date >= earliest && date < today).sort();
  const starts = plans.map((plan) => plan.startDate.toISOString().slice(0, 10)).filter((date) => date >= earliest && date < today).sort();
  if (aim === "plan" && starts.length > 0) {
    const createdOn = addDays(starts[0]!, -4);
    const firstJob = approvals.find((date) => date >= createdOn);
    return { createdOn, firstEventOn: firstJob && firstJob < starts[0]! ? firstJob : starts[0]!, withPlan: true };
  }
  const latest = approvals[approvals.length - 1];
  if (!latest) return null;
  return { createdOn: addDays(latest, -4), firstEventOn: latest, withPlan: false };
}

// ───────────────────────── Loading and removing ─────────────────────────

const gstHalf = (amountPaise: number, ratePercent: number) => Math.round((amountPaise * (ratePercent / 2)) / 100);

/** A sample quote's number from its key: "Q-S-" and five digits (FNV-1a), the same on every load. */
function sampleQuoteNumber(key: string): string {
  let hash = 0x811c9dc5;
  for (let index = 0; index < key.length; index += 1) hash = Math.imul(hash ^ key.charCodeAt(index), 0x01000193) >>> 0;
  return `Q-S-${10_000 + (hash % 90_000)}`;
}

/**
 * Adds the sample sales for the four weeks up to `now` (this moment unless given),
 * leaving everything else alone. Rows already loaded are kept as they are.
 */
export async function loadSalesSample(db: Db, options: { now?: Date } = {}) {
  const now = options.now ?? new Date();
  const today = indiaToday(now);
  const added = { bdes: 0, leads: 0, activities: 0, quotes: 0, targets: 0 };

  // ── The three sample BDEs, with an ECCS login each ──
  const people = new Map<Seller, string>();
  for (const bde of SAMPLE_BDES) {
    const existing = await db.user.findUnique({ where: { phone: bde.phone }, include: { memberships: true } });
    if (existing) {
      // A number already used by someone who is not a BDE is left alone, and so are their leads.
      if (!existing.memberships.some((m) => m.role === "BDE")) continue;
      people.set(bde.key, existing.id);
      continue;
    }
    const user = await db.user.create({ data: { phone: bde.phone, name: bde.name, language: "EN", memberships: { create: [{ role: "BDE" }] } } });
    people.set(bde.key, user.id);
    added.bdes += 1;
  }
  const founder = await db.user.findUnique({ where: { phone: FOUNDER_PHONE }, select: { id: true } });
  if (founder) people.set("FOUNDER", founder.id);

  // ── The sample clients the linked leads point at ──
  const [spice, deccan] = await Promise.all([
    db.organization.findFirst({ where: { name: "Spice Route Kitchens" }, select: { id: true } }),
    db.organization.findFirst({ where: { name: "Deccan Biryani House" }, select: { id: true } }),
  ]);
  const linked = {
    spice: spice ? await linkedFacts(db, spice.id, today, "plan") : null,
    deccan: deccan ? await linkedFacts(db, deccan.id, today, "job") : null,
  };
  const clientIds = { SPICE: spice?.id ?? null, DECCAN: deccan?.id ?? null };

  // ── What quotes are priced from: the catalogue and the plans, cheapest first ──
  const [services, plans] = await Promise.all([
    db.serviceCatalogItem.findMany({ where: { isActive: true }, orderBy: { pricePaise: "asc" }, select: { id: true, name: true, pricePaise: true, serviceType: { select: { gstRatePercent: true } } } }),
    db.plan.findMany({ where: { isActive: true }, orderBy: { pricePaise: "asc" }, select: { id: true, name: true, pricePaise: true, billingCycle: true } }),
  ]);
  const english = (text: unknown) => {
    const localized = (text ?? {}) as Record<string, string>;
    return localized["en"] ?? Object.values(localized)[0] ?? "";
  };

  const stories = sampleStories(now, linked).filter((story) => people.has(story.lead.owner));

  // ── Leads ──
  added.leads = (
    await db.lead.createMany({
      data: stories.map((story) => {
        const fields = story.fields as Record<string, Date | string | number | null | undefined>;
        const date = (key: string) => (fields[key] instanceof Date ? (fields[key] as Date) : null);
        return {
          sampleKey: story.key,
          isSample: true,
          businessName: story.lead.name,
          area: story.lead.area,
          address: story.lead.address,
          contactName: story.lead.contactName,
          contactPhone: story.lead.contactPhone,
          kitchens: story.lead.kitchens,
          source: story.lead.source,
          referrerName: story.lead.referrerName,
          ownerId: people.get(story.lead.owner)!,
          createdById: people.get(story.lead.owner)!,
          organizationId: story.lead.organization ? clientIds[story.lead.organization] : null,
          // A linked lead's First job and On a plan come from the app, never from here.
          stage: story.lead.organization ? (rank(story.stage) > rank("QUOTED") ? "QUOTED" : story.stage) : story.stage,
          status: story.status,
          parkedAt: date("parkedAt"),
          parkedUntil: typeof fields["parkedUntil"] === "string" ? new Date(`${fields["parkedUntil"]}T00:00:00.000Z`) : null,
          parkedReason: (fields["parkedReason"] as string | undefined) ?? null,
          lostAt: date("lostAt"),
          lostReason: (fields["lostReason"] as string | undefined) ?? null,
          nextAction: (fields["nextAction"] as string | undefined) ?? null,
          nextActionAt: date("nextActionAt"),
          checkAt: date("checkAt"),
          checkWith: (fields["checkWith"] as string | undefined) ?? null,
          checkDoneAt: date("checkDoneAt"),
          checkFindings: (fields["checkFindings"] as number | undefined) ?? null,
          wonAt: story.lead.organization ? null : date("wonAt"),
          planAt: story.lead.organization ? null : date("planAt"),
          lastActivityAt: story.lastActivity,
          createdAt: story.created,
        };
      }),
      skipDuplicates: true,
    })
  ).count;
  const leadIds = new Map(
    (await db.lead.findMany({ where: { sampleKey: { in: stories.map((story) => story.key) } }, select: { id: true, sampleKey: true } })).map((lead) => [lead.sampleKey!, lead.id]),
  );

  // ── Quotes, priced from the catalogue as a real quote is ──
  // A type, not an interface, so it counts as plain JSON for the `lines` column.
  type Line = {
    kind: "SERVICE" | "PLAN";
    refId: string;
    name: string;
    quantity: number;
    unitPaise: number;
    gstRatePercent: number;
    cycle: string | null;
    amountPaise: number;
  };
  const quoteRows = stories.flatMap((story) =>
    story.quotes.flatMap((quote) => {
      const lines = quote.lines.flatMap((line): Line[] => {
        if (line.kind === "SERVICE") {
          const item = services[Math.min(line.pick, services.length - 1)];
          if (!item) return [];
          return [{ kind: "SERVICE", refId: item.id, name: english(item.name), quantity: line.quantity, unitPaise: item.pricePaise, gstRatePercent: item.serviceType.gstRatePercent, cycle: null, amountPaise: item.pricePaise * line.quantity }];
        }
        const plan = plans[Math.min(line.pick, plans.length - 1)];
        if (!plan) return [];
        return [{ kind: "PLAN", refId: plan.id, name: english(plan.name), quantity: line.quantity, unitPaise: plan.pricePaise, gstRatePercent: 18, cycle: plan.billingCycle, amountPaise: plan.pricePaise * line.quantity }];
      });
      if (lines.length === 0) return [];
      const subtotalPaise = lines.reduce((sum, line) => sum + line.amountPaise, 0);
      const gstPaise = lines.reduce((sum, line) => sum + 2 * gstHalf(line.amountPaise, line.gstRatePercent), 0);
      return [
        {
          sampleKey: quote.key,
          isSample: true,
          leadId: leadIds.get(story.key)!,
          lines,
          subtotalPaise,
          gstPaise,
          totalPaise: subtotalPaise + gstPaise,
          status: "SENT",
          token: randomBytes(24).toString("base64url"),
          sentAt: quote.sentAt,
          validUntil: new Date(`${addDays(indiaDate(quote.sentAt), 15)}T00:00:00.000Z`),
          openCount: quote.opens.length,
          firstOpenedAt: quote.opens[0] ?? null,
          lastOpenedAt: quote.opens[quote.opens.length - 1] ?? null,
          createdById: people.get(story.lead.owner)!,
          createdAt: quote.sentAt,
        },
      ];
    }),
  );
  // A series of their own ("Q-S-12345"), each number worked out from the quote's own key, so
  // it never changes when the sample grows: numbering by position would shift, clash with the
  // rows already loaded, and quietly skip new ones.
  const taken = new Set<string>();
  const numbered = [...quoteRows]
    .sort((a, b) => a.sampleKey.localeCompare(b.sampleKey))
    .map((row) => {
      let number = sampleQuoteNumber(row.sampleKey);
      for (let extra = 1; taken.has(number); extra += 1) number = sampleQuoteNumber(`${row.sampleKey}#${extra}`);
      taken.add(number);
      return { ...row, number };
    });
  added.quotes = (await db.quote.createMany({ data: numbered, skipDuplicates: true })).count;
  const quotes = new Map(
    (await db.quote.findMany({ where: { sampleKey: { in: quoteRows.map((row) => row.sampleKey) } }, select: { id: true, sampleKey: true, totalPaise: true } })).map((quote) => [
      quote.sampleKey!,
      quote,
    ]),
  );
  const quoted = new Map(quoteRows.map((row) => [row.sampleKey, { subtotalPaise: row.subtotalPaise, plan: row.lines.some((line) => line.kind === "PLAN") }]));

  // ── Each lead's timeline ──
  added.activities = (
    await db.leadActivity.createMany({
      data: stories.flatMap((story) => {
        // A sale is worth what its quote said, before GST: the latest services quote for a first job, the latest plan quote for a plan.
        let services: number | null = null;
        let plan: number | null = null;
        return story.steps.map((step, index) => {
          const quote = step.quoteKey ? quotes.get(step.quoteKey) : undefined;
          const facts = step.quoteKey ? quoted.get(step.quoteKey) : undefined;
          if (step.kind === "QUOTE_SENT" && facts) {
            if (facts.plan) plan = facts.subtotalPaise;
            else services = facts.subtotalPaise;
          }
          const won = step.kind === "WON" ? ((step.toStage === "ON_PLAN" ? plan : services) ?? step.amountPaise ?? null) : null;
          return {
            sampleKey: `${story.key}:${index}`,
            isSample: true,
            leadId: leadIds.get(story.key)!,
            kind: step.kind,
            at: step.at,
            byId: BY_THE_APP.has(step.kind) ? null : people.get(story.lead.owner)!,
            note: step.note ?? null,
            fromStage: step.fromStage ?? null,
            toStage: step.toStage ?? null,
            checkAt: step.checkAt ?? null,
            checkWith: step.checkWith ?? null,
            findings: step.findings ?? null,
            amountPaise: step.kind === "WON" ? won : step.kind === "QUOTE_SENT" ? (quote?.totalPaise ?? null) : (step.amountPaise ?? null),
            quoteId: quote?.id ?? null,
            signal: step.signal ?? null,
            rating: step.rating ?? null,
            sameDay: step.sameDay ?? null,
            createdAt: step.at,
          };
        });
      }),
      skipDuplicates: true,
    })
  ).count;

  // ── One target set by hand: Imran's free checks this week ──
  const imran = people.get("Imran");
  if (imran) {
    const weekStart = mondayOf(today);
    added.targets = (
      await db.salesTarget.createMany({
        data: [{ sampleKey: `sample-target-imran-${weekStart}`, isSample: true, userId: imran, weekStart: new Date(`${weekStart}T00:00:00.000Z`), checks: 7 }],
        skipDuplicates: true,
      })
    ).count;
  }
  return added;
}

/**
 * Takes every sample lead out (with its steps and quotes), the sample targets, and the
 * three sample BDE logins (found by their numbers). A sample BDE who has since been given
 * real leads is kept, so nothing real loses its owner. Real leads are never touched.
 */
export async function removeSalesSample(db: Db) {
  const removed = { leads: 0, targets: 0, bdes: 0, keptBdes: 0 };
  removed.leads = (await db.lead.deleteMany({ where: { isSample: true } })).count;
  removed.targets = (await db.salesTarget.deleteMany({ where: { isSample: true } })).count;
  for (const bde of SAMPLE_BDES) {
    const user = await db.user.findUnique({ where: { phone: bde.phone }, include: { memberships: true, _count: { select: { ownedLeads: true } } } });
    if (!user || !user.memberships.every((m) => m.role === "BDE") || user.memberships.length === 0) continue;
    if (user._count.ownedLeads > 0) {
      removed.keptBdes += 1;
      continue;
    }
    await db.session.deleteMany({ where: { userId: user.id } });
    await db.otpChallenge.deleteMany({ where: { phone: bde.phone } });
    await db.user.delete({ where: { id: user.id } });
    removed.bdes += 1;
  }
  return removed;
}
