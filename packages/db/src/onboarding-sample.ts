import { createHash, createHmac, randomUUID } from "node:crypto";
import { deflateSync } from "node:zlib";
import type { PrismaClient } from "../generated/prisma/client.js";

// The onboarding sample (16 Oct 2026), loaded with the team sample (`pnpm team:sample`), so
// the console's onboarding can be seen before the founder writes their own:
// - a checklist template for each team role (Ops Manager, Supervisor, BDE), short and
//   practical, with the documents each role is asked for;
// - a sample staff handbook (version 1);
// - one sample new hire, "Kiran (sample)", a Supervisor joining next Monday with the login
//   +919000000007 and ₹30,000 a month: onboarding started today and part done, some of the
//   joining file filled in, two documents uploaded (generated placeholder pictures, never a
//   real ID) and one sent back, the handbook accepted, the appointment letter made and not
//   yet accepted. The app works the letter's particulars out the first time it is opened.
//
// Nothing is wiped, and loading again adds only what is missing. A template or the handbook
// the Super Admin has changed is theirs and is never touched or removed here (a change clears
// its sample mark). Removing the sample takes out Kiran (login and all), the sample templates
// and the sample handbook, and nothing else.
//
// The keys (roles, phases, owners, kinds) are those of packages/shared/src/onboarding.ts; this
// package does not depend on that one.

type Db = Pick<
  PrismaClient,
  | "user"
  | "teamMember"
  | "teamSalary"
  | "onboardingTemplate"
  | "onboardingTemplateTask"
  | "onboarding"
  | "onboardingTask"
  | "joiningFile"
  | "joiningDocument"
  | "appointmentLetter"
  | "staffHandbook"
  | "handbookAcceptance"
  | "attachment"
>;

type Phase = "BEFORE_JOINING" | "FIRST_DAY" | "FIRST_WEEK" | "FIRST_MONTH" | "BY_3_MONTHS";
type Owner = "SUPER_ADMIN" | "OPS_MANAGER" | "NEW_HIRE";
type Auto = "DETAILS" | "DOCUMENTS" | "LETTER" | "HANDBOOK" | "APP_LOGIN" | "POLICE_CERTIFICATE" | "MEDICAL_CERTIFICATE";
interface SampleTask {
  phase: Phase;
  title: string;
  owner: Owner;
  days: number;
  required?: boolean;
  auto?: Auto;
}

// Every role starts with the same four papers before joining, which tick themselves.
const PAPERS: SampleTask[] = [
  { phase: "BEFORE_JOINING", title: "Joining details filled in", owner: "NEW_HIRE", days: -3, auto: "DETAILS" },
  { phase: "BEFORE_JOINING", title: "Documents uploaded and accepted", owner: "SUPER_ADMIN", days: -2, auto: "DOCUMENTS" },
  { phase: "BEFORE_JOINING", title: "Appointment letter accepted", owner: "NEW_HIRE", days: -2, auto: "LETTER" },
  { phase: "BEFORE_JOINING", title: "Staff handbook read and accepted", owner: "NEW_HIRE", days: -1, auto: "HANDBOOK" },
];
const LATER: SampleTask[] = [
  { phase: "FIRST_MONTH", title: "30-day check-in: how it is going, what they need", owner: "SUPER_ADMIN", days: 30 },
  { phase: "BY_3_MONTHS", title: "60-day check-in", owner: "SUPER_ADMIN", days: 60 },
  { phase: "BY_3_MONTHS", title: "Probation review: confirm in writing, or extend", owner: "SUPER_ADMIN", days: 90 },
];
const POLICE: SampleTask = { phase: "FIRST_MONTH", title: "Police verification certificate accepted", owner: "NEW_HIRE", days: 21, auto: "POLICE_CERTIFICATE" };
const SAFETY: SampleTask = {
  phase: "FIRST_DAY",
  title: "Safety and chemicals briefing: dilution, never mix bleach and ammonia, where the safety data sheets are",
  owner: "OPS_MANAGER",
  days: 0,
};

const DOCUMENTS = (medical: boolean) => [
  { kind: "PHOTO", required: true },
  { kind: "ID_PROOF", required: true },
  { kind: "ADDRESS_PROOF", required: false },
  { kind: "BANK_PROOF", required: true },
  { kind: "POLICE_VERIFICATION", required: true },
  ...(medical ? [{ kind: "MEDICAL_FITNESS", required: true }] : []),
  { kind: "RELIEVING_LETTER", required: false },
  { kind: "EDUCATION", required: false },
];

export const SAMPLE_TEMPLATES: readonly { role: string; documents: { kind: string; required: boolean }[]; tasks: SampleTask[] }[] = [
  {
    role: "SUPERVISOR",
    documents: DOCUMENTS(true),
    tasks: [
      ...PAPERS,
      { phase: "BEFORE_JOINING", title: "Uniform and PPE kit ready in their size (from the joining file)", owner: "OPS_MANAGER", days: -1 },
      { phase: "FIRST_DAY", title: "Welcome: meet the Ops Manager and the crew", owner: "OPS_MANAGER", days: 0 },
      { phase: "FIRST_DAY", title: "First login to the ECCS app on the phone", owner: "NEW_HIRE", days: 0, auto: "APP_LOGIN" },
      SAFETY,
      { phase: "FIRST_DAY", title: "Uniform and PPE issued: apron, gloves, goggles, mask, non-slip shoes", owner: "OPS_MANAGER", days: 0 },
      { phase: "FIRST_WEEK", title: "Shadow 3 visits with a senior Supervisor, then run one while they watch", owner: "OPS_MANAGER", days: 5 },
      { phase: "FIRST_WEEK", title: "SOP and inspection training in the app, signed off", owner: "OPS_MANAGER", days: 6 },
      { phase: "FIRST_WEEK", title: "Medical fitness certificate accepted (before working alone in clients' kitchens)", owner: "NEW_HIRE", days: 6, auto: "MEDICAL_CERTIFICATE" },
      { phase: "FIRST_MONTH", title: "First solo visit spot-checked by the Ops Manager", owner: "OPS_MANAGER", days: 14 },
      POLICE,
      ...LATER,
    ],
  },
  {
    role: "BDE",
    documents: DOCUMENTS(false),
    tasks: [
      ...PAPERS,
      { phase: "BEFORE_JOINING", title: "Visiting cards and a free-check kit ready", owner: "OPS_MANAGER", days: -1 },
      { phase: "FIRST_DAY", title: "Welcome: meet the Ops Manager and the other BDEs", owner: "OPS_MANAGER", days: 0 },
      { phase: "FIRST_DAY", title: "First login to the ECCS app on the phone", owner: "NEW_HIRE", days: 0, auto: "APP_LOGIN" },
      { phase: "FIRST_DAY", title: "Pricing and plans: the catalogue, the plans, what a quote holds", owner: "SUPER_ADMIN", days: 0 },
      { ...SAFETY, title: "Safety briefing for clients' kitchens: what not to touch, PPE for a free check" },
      { phase: "FIRST_WEEK", title: "A day in the field with a BDE (ride-along)", owner: "OPS_MANAGER", days: 2 },
      { phase: "FIRST_WEEK", title: "Practice free check with the scorecard, reviewed", owner: "OPS_MANAGER", days: 4 },
      { phase: "FIRST_MONTH", title: "First quote reviewed by a founder before it is sent", owner: "SUPER_ADMIN", days: 14 },
      POLICE,
      ...LATER,
    ],
  },
  {
    role: "OPS_MANAGER",
    documents: DOCUMENTS(false),
    tasks: [
      ...PAPERS,
      { phase: "FIRST_DAY", title: "Welcome: meet the founders", owner: "SUPER_ADMIN", days: 0 },
      { phase: "FIRST_DAY", title: "First login to the ECCS app on the phone", owner: "NEW_HIRE", days: 0, auto: "APP_LOGIN" },
      { ...SAFETY, owner: "SUPER_ADMIN" },
      { phase: "FIRST_DAY", title: "Console walk-through: visits, clients, issues, Team", owner: "SUPER_ADMIN", days: 0 },
      { phase: "FIRST_WEEK", title: "Meet each Supervisor and BDE; go along on 2 visits", owner: "SUPER_ADMIN", days: 4 },
      { phase: "FIRST_WEEK", title: "Handover: open issues, next week's visits, clients to watch", owner: "SUPER_ADMIN", days: 6 },
      { phase: "FIRST_MONTH", title: "Plans the week's visits alone, reviewed by a founder", owner: "SUPER_ADMIN", days: 14 },
      POLICE,
      ...LATER,
    ],
  },
];

export const SAMPLE_HANDBOOK = {
  title: "ECCS staff handbook (sample)",
  body: `A sample handbook, to be replaced by ECCS's own. It is short on purpose: read it before your first day, and ask a founder about anything that is not clear.

## On clients' premises
- You work in other people's kitchens. Arrive on time for the visit's window, say who you are, and follow the kitchen's own rules on where you may go.
- Do not eat, drink, smoke or chew anything in a client's kitchen. Never take anything, even food that is to be thrown away.
- Leave the place as you found it or better: put back what you moved, and tell the kitchen's person in charge before you leave.

## Safety and PPE
- Wear the uniform and the PPE the job needs: apron, gloves, goggles, mask and non-slip shoes. If any of it is torn or missing, say so before you start.
- Switch off and unplug equipment before you clean it. Never climb on a counter or a stool: use the ladder.
- Report every accident, cut, burn or near miss to the Ops Manager the same day.

## Chemicals
- Use only ECCS's chemicals, at the dilution on the label. More is not cleaner; it is more dangerous.
- **Never mix bleach with ammonia, or with acid cleaners.** The fumes can kill.
- Keep chemicals in their own labelled bottles, away from food. The safety data sheets are with the Ops Manager and in the app.

## Clients' confidentiality
- What you see and hear in a client's business stays there: their recipes, their problems, their people, their money.
- Never post photos or videos of a client's kitchen on social media. Photos are taken in the ECCS app only, for the visit's record.

## Phone and app
- Record your work in the ECCS app as you do it: check in on arrival, tick the tasks, take the photos the app asks for.
- Do not use your phone for anything else while you work in a kitchen, except to call ECCS.

## Attendance and leave
- Your working hours and weekly day off are in your appointment letter.
- If you cannot come, tell the Ops Manager before your visit's window starts. Ask for leave in advance where you can.

## Respect at work and raising a complaint
- Treat everyone with respect: clients, their staff and your team. ECCS does not accept harassment of any kind, sexual harassment included.
- If anything worries you, at work or about how you are treated, tell a founder, in person or on WhatsApp. You will never be treated worse for raising a complaint.`,
};

const KIRAN = { phone: "+919000000007", name: "Kiran (sample)", area: "Banjara Hills", monthlyPaise: 3_000_000 };
const FOUNDER_PHONE = "+919000000001";
const OPS_PHONE = "+919000000002";

const DAY_MS = 86_400_000;
const toDb = (date: string) => new Date(`${date}T00:00:00.000Z`);
const addDays = (date: string, days: number) => new Date(Date.parse(`${date}T00:00:00.000Z`) + days * DAY_MS).toISOString().slice(0, 10);
const indiaDay = (at: Date) => new Intl.DateTimeFormat("en-CA", { timeZone: "Asia/Kolkata" }).format(at);
const weekday = (date: string) => new Date(`${date}T00:00:00Z`).getUTCDay();
/** The next Monday after today (tomorrow, on a Sunday). */
const nextMonday = (today: string) => addDays(today, ((8 - weekday(today)) % 7) || 7);
const sha256 = (text: string | Buffer) => createHash("sha256").update(text).digest("hex");

/** The fingerprint the app keeps of a handbook version someone accepted: its title and text. */
export const handbookFingerprint = (title: string, body: string) => sha256(`${title}\n\n${body}`);

// ───────────────────────── Placeholder pictures ─────────────────────────

const CRC_TABLE = Array.from({ length: 256 }, (_, n) => {
  let c = n;
  for (let k = 0; k < 8; k += 1) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
  return c >>> 0;
});
const crc32 = (bytes: Buffer) => {
  let c = 0xffffffff;
  for (const byte of bytes) c = CRC_TABLE[(c ^ byte) & 0xff]! ^ (c >>> 8);
  return (c ^ 0xffffffff) >>> 0;
};
const chunk = (type: string, data: Buffer) => {
  const length = Buffer.alloc(4);
  length.writeUInt32BE(data.length);
  const body = Buffer.concat([Buffer.from(type, "ascii"), data]);
  const crc = Buffer.alloc(4);
  crc.writeUInt32BE(crc32(body));
  return Buffer.concat([length, body, crc]);
};

/** A grey silhouette of a head and shoulders on a light card, as a PNG: a placeholder photo, never a person. */
export function placeholderPhoto(width = 240, height = 300): Buffer {
  const rows: Buffer[] = [];
  for (let y = 0; y < height; y += 1) {
    const row = Buffer.alloc(1 + width * 3);
    for (let x = 0; x < width; x += 1) {
      const head = (x - width / 2) ** 2 + (y - height * 0.38) ** 2 < (width * 0.2) ** 2;
      const shoulders = y > height * 0.62 && ((x - width / 2) / (width * 0.42)) ** 2 + ((y - height) / (height * 0.36)) ** 2 < 1;
      const [r, g, b] = head || shoulders ? [154, 167, 180] : [232, 237, 242];
      row.writeUInt8(r!, 1 + x * 3);
      row.writeUInt8(g!, 2 + x * 3);
      row.writeUInt8(b!, 3 + x * 3);
    }
    rows.push(row);
  }
  const header = Buffer.alloc(13);
  header.writeUInt32BE(width, 0);
  header.writeUInt32BE(height, 4);
  header.writeUInt8(8, 8); // 8 bits a colour
  header.writeUInt8(2, 9); // red, green, blue
  return Buffer.concat([Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]), chunk("IHDR", header), chunk("IDAT", deflateSync(Buffer.concat(rows))), chunk("IEND", Buffer.alloc(0))]);
}

/** A one-page PDF saying plainly that it is a sample, standing in for a masked Aadhaar. */
export function placeholderPdf(lines: readonly string[]): Buffer {
  const text = lines.map((line, index) => `BT /F1 ${index === 0 ? 20 : 13} Tf 60 ${760 - index * 30} Td (${line.replace(/[()\\]/g, "")}) Tj ET`).join("\n");
  const objects = [
    "<< /Type /Catalog /Pages 2 0 R >>",
    "<< /Type /Pages /Kids [3 0 R] /Count 1 >>",
    "<< /Type /Page /Parent 2 0 R /MediaBox [0 0 595 842] /Resources << /Font << /F1 5 0 R >> >> /Contents 4 0 R >>",
    `<< /Length ${Buffer.byteLength(text)} >>\nstream\n${text}\nendstream`,
    "<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica >>",
  ];
  let pdf = "%PDF-1.4\n";
  const offsets: number[] = [];
  objects.forEach((object, index) => {
    offsets.push(Buffer.byteLength(pdf));
    pdf += `${index + 1} 0 obj\n${object}\nendobj\n`;
  });
  const xref = Buffer.byteLength(pdf);
  pdf += `xref\n0 ${objects.length + 1}\n0000000000 65535 f \n${offsets.map((offset) => `${String(offset).padStart(10, "0")} 00000 n \n`).join("")}`;
  pdf += `trailer\n<< /Size ${objects.length + 1} /Root 1 0 R >>\nstartxref\n${xref}\n%%EOF\n`;
  return Buffer.from(pdf, "latin1");
}

// ───────────────────────── The file store ─────────────────────────

/**
 * One request to the S3 file store (SeaweedFS on this PC, Amazon S3 later), signed the way S3
 * asks (Signature Version 4), with the settings the API uses (S3_* in the repo's .env). This
 * package has no S3 library, and a sample needs only to put and remove a few small files.
 */
async function s3(method: "PUT" | "DELETE", key: string, body: Buffer = Buffer.alloc(0), contentType?: string): Promise<boolean> {
  const endpoint = process.env["S3_ENDPOINT"];
  const bucket = process.env["S3_BUCKET"];
  const region = process.env["S3_REGION"] ?? "us-east-1";
  const access = process.env["S3_ACCESS_KEY"] ?? "";
  const secret = process.env["S3_SECRET_KEY"] ?? "";
  if (!endpoint || !bucket) return false;
  const url = new URL(`${endpoint.replace(/\/+$/, "")}/${bucket}/${key.split("/").map(encodeURIComponent).join("/")}`);
  const amzDate = new Date().toISOString().replace(/[-:]/g, "").replace(/\.\d{3}/, "");
  const dateStamp = amzDate.slice(0, 8);
  const payloadHash = sha256(body);
  const canonical = [method, url.pathname, "", `host:${url.host}`, `x-amz-content-sha256:${payloadHash}`, `x-amz-date:${amzDate}`, "", "host;x-amz-content-sha256;x-amz-date", payloadHash].join("\n");
  const scope = `${dateStamp}/${region}/s3/aws4_request`;
  const toSign = ["AWS4-HMAC-SHA256", amzDate, scope, sha256(canonical)].join("\n");
  const hmac = (keyBytes: string | Buffer, data: string) => createHmac("sha256", keyBytes).update(data).digest();
  const signing = hmac(hmac(hmac(hmac(`AWS4${secret}`, dateStamp), region), "s3"), "aws4_request");
  const signature = createHmac("sha256", signing).update(toSign).digest("hex");
  const response = await fetch(url, {
    method,
    headers: {
      "x-amz-date": amzDate,
      "x-amz-content-sha256": payloadHash,
      Authorization: `AWS4-HMAC-SHA256 Credential=${access}/${scope}, SignedHeaders=host;x-amz-content-sha256;x-amz-date, Signature=${signature}`,
      ...(contentType && { "Content-Type": contentType }),
    },
    ...(method === "PUT" && { body: new Uint8Array(body) }),
  });
  return response.ok || response.status === 404;
}

// ───────────────────────── Loading ─────────────────────────

/**
 * Adds the onboarding sample (India's today unless given), leaving everything else alone:
 * the templates of roles that have none, the handbook if there is none, and Kiran.
 */
export async function loadOnboardingSample(db: Db, options: { now?: Date } = {}) {
  const now = options.now ?? new Date();
  const today = indiaDay(now);
  const added = { templates: 0, templateTasks: 0, handbook: 0, newHire: 0, documents: 0, letter: 0 };

  // ── The templates ──
  for (const template of SAMPLE_TEMPLATES) {
    if (await db.onboardingTemplate.findUnique({ where: { role: template.role }, select: { id: true } })) continue;
    await db.onboardingTemplate.create({
      data: {
        role: template.role,
        documents: template.documents,
        isSample: true,
        sampleKey: `sample-onb-template-${template.role}`,
        tasks: {
          create: template.tasks.map((task, position) => ({
            phase: task.phase,
            title: task.title,
            owner: task.owner,
            daysFromJoining: task.days,
            required: task.required ?? true,
            auto: task.auto ?? null,
            position,
          })),
        },
      },
    });
    added.templates += 1;
    added.templateTasks += template.tasks.length;
  }

  // ── The handbook ──
  if ((await db.staffHandbook.count()) === 0) {
    const founder = await db.user.findUnique({ where: { phone: FOUNDER_PHONE }, select: { id: true } });
    await db.staffHandbook.create({ data: { version: 1, title: SAMPLE_HANDBOOK.title, body: SAMPLE_HANDBOOK.body, createdById: founder?.id ?? null, isSample: true } });
    added.handbook = 1;
  }

  // ── Kiran, a Supervisor joining next Monday ──
  const existing = await db.user.findUnique({ where: { phone: KIRAN.phone }, select: { id: true, teamMember: { select: { id: true, isSample: true } } } });
  // A real login already holding the number is left alone.
  if (existing && !existing.teamMember?.isSample) return added;
  const [founder, ops] = await Promise.all([
    db.user.findUnique({ where: { phone: FOUNDER_PHONE }, select: { id: true } }),
    db.user.findUnique({ where: { phone: OPS_PHONE }, select: { id: true } }),
  ]);
  const joinedOn = nextMonday(today);
  const userId =
    existing?.id ??
    (await db.user.create({ data: { phone: KIRAN.phone, name: KIRAN.name, language: "EN", memberships: { create: [{ role: "SUPERVISOR" }] } }, select: { id: true } })).id;
  let memberId = existing?.teamMember?.id ?? null;
  if (!memberId) {
    memberId = (
      await db.teamMember.create({
        data: { userId, area: KIRAN.area, joinedOn: toDb(joinedOn), weeklyOff: 0, createdById: founder?.id ?? null, isSample: true, sampleKey: "sample-team-kiran" },
        select: { id: true },
      })
    ).id;
    await db.teamSalary.create({ data: { memberId, from: toDb(joinedOn), monthlyPaise: KIRAN.monthlyPaise, setById: founder?.id ?? null, isSample: true } });
    added.newHire = 1;
  }

  // Their checklist, from the Supervisor's template as it is now.
  if (!(await db.onboarding.findUnique({ where: { memberId }, select: { id: true } }))) {
    const template = await db.onboardingTemplate.findUnique({ where: { role: "SUPERVISOR" }, include: { tasks: { orderBy: { position: "asc" } } } });
    await db.onboarding.create({
      data: {
        memberId,
        role: "SUPERVISOR",
        startedOn: toDb(today),
        startedById: founder?.id ?? null,
        documents: (template?.documents ?? DOCUMENTS(true)) as object,
        isSample: true,
        sampleKey: "sample-onb-kiran",
        tasks: {
          create: (template?.tasks ?? []).map((task) => {
            // The kit is ready: the Ops Manager has ticked it.
            const kit = /uniform and ppe kit ready/i.test(task.title);
            return {
              phase: task.phase,
              title: task.title,
              owner: task.owner,
              daysFromJoining: task.daysFromJoining,
              required: task.required,
              auto: task.auto,
              position: task.position,
              ...(kit && { doneAt: now, doneById: ops?.id ?? founder?.id ?? null, note: "Size M, from the joining file" }),
            };
          }),
        },
      },
    });
  }

  // Part of the joining file: everything but the bank details.
  await db.joiningFile.upsert({
    where: { memberId },
    create: {
      memberId,
      dateOfBirth: toDb("1996-04-12"),
      parentName: "Ramesh (sample)",
      currentAddress: "Sample address: 4-2-10, Road No. 3, Banjara Hills, Hyderabad 500034",
      permanentSame: true,
      emergencyName: "Lakshmi (sample)",
      emergencyRelation: "Mother",
      // A made-up number in the Sales sample's form; never dialled.
      emergencyPhone: "+919000029999",
      bloodGroup: "O+",
      uniformSize: "M",
      idType: "AADHAAR",
      idLast4: "4821",
      updatedById: userId,
      isSample: true,
    },
    update: {},
  });

  // Documents: the photo accepted, the ID proof waiting to be checked, the bank proof sent back.
  if ((await db.joiningDocument.count({ where: { memberId } })) === 0) {
    const files = [
      { kind: "PHOTO", status: "ACCEPTED", bytes: placeholderPhoto(), mimeType: "image/png", extension: "png" },
      {
        kind: "ID_PROOF",
        status: "UPLOADED",
        bytes: placeholderPdf(["SAMPLE: not a real document", "A placeholder for a masked Aadhaar", "Kiran (sample)", "Aadhaar: XXXX XXXX 4821", "Made by the ECCS sample loader."]),
        mimeType: "application/pdf",
        extension: "pdf",
      },
    ];
    for (const file of files) {
      const id = randomUUID();
      const storageKey = `team/${memberId}/joining/${id}.${file.extension}`;
      if (!(await s3("PUT", storageKey, file.bytes, file.mimeType))) continue;
      await db.attachment.create({ data: { id, kind: "JOINING", storageKey, mimeType: file.mimeType, sizeBytes: file.bytes.length, capturedAt: now, uploadedById: userId } });
      await db.joiningDocument.create({
        data: {
          memberId,
          kind: file.kind,
          status: file.status,
          attachmentId: id,
          uploadedAt: now,
          uploadedById: userId,
          ...(file.status === "ACCEPTED" && { reviewedAt: now, reviewedById: founder?.id ?? null }),
          isSample: true,
        },
      });
      added.documents += 1;
    }
    await db.joiningDocument.create({
      data: {
        memberId,
        kind: "BANK_PROOF",
        status: "SENT_BACK",
        reason: "The cheque photo is blurred. Take it again in daylight.",
        uploadedAt: now,
        uploadedById: userId,
        reviewedAt: now,
        reviewedById: founder?.id ?? null,
        isSample: true,
      },
    });
  }

  // The handbook read and accepted.
  const handbook = await db.staffHandbook.findFirst({ orderBy: { version: "desc" } });
  if (handbook) {
    await db.handbookAcceptance.upsert({
      where: { memberId_version: { memberId, version: handbook.version } },
      create: { memberId, version: handbook.version, acceptedAt: now, acceptedById: userId, sha256: handbookFingerprint(handbook.title, handbook.body), isSample: true },
      update: {},
    });
  }

  // The appointment letter, made today and waiting: the app works out its particulars when it is first opened.
  if (!(await db.appointmentLetter.findFirst({ where: { memberId }, select: { id: true } }))) {
    const year = today.slice(0, 4);
    const prefix = `ECCS/AL/${year}/`;
    const last = await db.appointmentLetter.findFirst({ where: { number: { startsWith: prefix } }, orderBy: { number: "desc" }, select: { number: true } });
    const next = (last ? Number(last.number.slice(prefix.length)) || 0 : 0) + 1;
    await db.appointmentLetter.create({
      data: { memberId, number: `${prefix}${String(next).padStart(4, "0")}`, madeAt: now, madeById: founder?.id ?? null, isSample: true, sampleKey: "sample-onb-kiran-letter" },
    });
    added.letter = 1;
  }
  return added;
}

/**
 * Takes the onboarding sample out: Kiran (the login, the team details, the checklist, the
 * file, the documents and their files, the letter), the sample templates and the sample
 * handbook. A template or handbook version the Super Admin has changed is not a sample and stays.
 */
export async function removeOnboardingSample(db: Db) {
  const removed = { newHire: 0, files: 0, templates: 0, handbook: 0 };
  const kiran = await db.teamMember.findUnique({ where: { sampleKey: "sample-team-kiran" }, select: { id: true, userId: true } });
  if (kiran) {
    const files = await db.attachment.findMany({ where: { kind: "JOINING", storageKey: { startsWith: `team/${kiran.id}/` } }, select: { id: true, storageKey: true } });
    for (const file of files) await s3("DELETE", file.storageKey).catch(() => false);
    removed.files = (await db.attachment.deleteMany({ where: { id: { in: files.map((file) => file.id) } } })).count;
    await db.teamMember.delete({ where: { id: kiran.id } });
    try {
      await db.user.delete({ where: { id: kiran.userId } });
    } catch {
      // The login was used for work that keeps a record of it (a visit): it is switched off instead.
      await db.user.update({ where: { id: kiran.userId }, data: { isActive: false } });
    }
    removed.newHire = 1;
  }
  removed.templates = (await db.onboardingTemplate.deleteMany({ where: { isSample: true } })).count;
  removed.handbook = (await db.staffHandbook.deleteMany({ where: { isSample: true } })).count;
  return removed;
}
