import { createHash, randomUUID } from 'node:crypto';
import type { Readable } from 'node:stream';
import { BadRequestException, ConflictException, ForbiddenException, Injectable, Logger, NotFoundException } from '@nestjs/common';
import type { Prisma } from '@eccs/db';
import {
  addDays,
  can,
  DOCUMENT_LABELS,
  detailsMissing,
  documentsDue,
  indiaDay,
  proposedExpiry,
  EMPTY_DETAILS,
  JOINING_DOCUMENT_KINDS,
  LETTER_CLOSING,
  LETTER_NUMBER_PREFIX,
  letterChanges,
  letterMissing,
  letterNumber,
  letterOpening,
  letterParticulars,
  letterRows,
  letterSettingsOf,
  letterText,
  masked,
  mergeDetails,
  ONBOARDING_RULES,
  salaryOn,
  TEAM_ROLES,
  teamRoleOf,
  type AppointmentLetterDto,
  type DocumentAsked,
  type DocumentDue,
  type JoiningDetails,
  type JoiningDetailsValues,
  type JoiningDocumentDto,
  type JoiningDocumentKind,
  type JoiningDocumentStatus,
  type JoiningFileDto,
  type LetterBlockDto,
  type LetterInput,
  type LetterParticulars,
  type LetterSettings,
  type Role,
  type StaffHandbookDto,
  type TeamRole,
} from '@eccs/shared';
import type { AuthUser } from '../auth/auth.types.js';
import { SUPPLIER } from '../billing/supplier.js';
import { indiaDate } from '../checklists/checklists.service.js';
import { PdfPrinterService } from '../pdf/pdf-printer.service.js';
import { escapeHtml, moment, REPORT_COLORS, reportPage } from '../pdf/report-page.js';
import { PrismaService } from '../prisma/prisma.service.js';
import { sniffFile } from '../storage/attachments.controller.js';
import { StorageService } from '../storage/storage.service.js';

// A new team member's papers (onboarding, 16 Oct 2026): the joining file they fill in, the
// documents they upload, their appointment letter and the staff handbook.
//
// Who reaches them: the Super Admin (the "team" A grant) and the person themselves. Nobody
// else, the Ops Manager included: the Ops Manager sees the checklist and its progress only.
// Every route that serves one of these files checks that itself (`openable`); the ordinary
// signed links for photos are never made for them and are refused for them.
//
// What is kept: only the last 4 digits of an ID (the schema refuses a whole Aadhaar number);
// a document sent back loses its file at once (a whole Aadhaar sent by mistake is not kept);
// an accepted letter never changes (a newer letter takes its place and the old one stays).

const toDb = (date: string) => new Date(`${date}T00:00:00.000Z`);
const fromDb = (date: Date) => date.toISOString().slice(0, 10);
const sha256 = (text: string) => createHash('sha256').update(text).digest('hex');

// Any fixed number: the one lock numbering a letter waits for, so two letters never get one number.
const LETTER_LOCK = 710_261_016;

type FileRow = Prisma.JoiningFileGetPayload<object>;
type LetterRow = Prisma.AppointmentLetterGetPayload<object>;
type DocumentRow = Prisma.JoiningDocumentGetPayload<object>;

/** The file as the rules read it, from its database row. */
export function detailsOf(row: FileRow | null): JoiningDetails {
  if (!row) return { ...EMPTY_DETAILS };
  return {
    dateOfBirth: row.dateOfBirth ? fromDb(row.dateOfBirth) : null,
    parentName: row.parentName,
    currentAddress: row.currentAddress,
    permanentSame: row.permanentSame,
    permanentAddress: row.permanentAddress,
    emergencyName: row.emergencyName,
    emergencyRelation: row.emergencyRelation,
    emergencyPhone: row.emergencyPhone,
    bloodGroup: row.bloodGroup,
    uniformSize: row.uniformSize,
    idType: (row.idType as JoiningDetails['idType']) ?? null,
    idLast4: row.idLast4,
    pan: row.pan,
    bankHolder: row.bankHolder,
    bankAccount: row.bankAccount,
    bankIfsc: row.bankIfsc,
    previousEmployer: row.previousEmployer,
    uan: row.uan,
    esiNumber: row.esiNumber,
    education: (row.education as JoiningDetails['education']) ?? null,
  };
}

/** The documents asked for, as kept on an onboarding (or a template). */
export const askedOf = (value: unknown): DocumentAsked[] =>
  (Array.isArray(value) ? value : []).filter(
    (entry): entry is DocumentAsked => !!entry && typeof entry === 'object' && JOINING_DOCUMENT_KINDS.includes((entry as DocumentAsked).kind),
  );

/** The latest upload of each kind, newest first. */
export function currentDocuments<T extends { kind: string; uploadedAt: Date }>(rows: readonly T[]): Map<string, T> {
  const current = new Map<string, T>();
  for (const row of [...rows].sort((a, b) => b.uploadedAt.getTime() - a.uploadedAt.getTime())) if (!current.has(row.kind)) current.set(row.kind, row);
  return current;
}

/** The member a person is, with what the papers need. */
interface Member {
  id: string;
  userId: string;
  name: string;
  role: TeamRole | null;
  area: string | null;
  joinedOn: string;
  weeklyOff: number;
  monthlyPaise: number | null;
}

@Injectable()
export class OnboardingPapersService {
  private readonly logger = new Logger(OnboardingPapersService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly storage: StorageService,
    private readonly printer: PdfPrinterService,
  ) {}

  private get db() {
    return this.prisma.client;
  }

  /** The team member behind a login, or why not. */
  async member(where: { userId: string } | { id: string }): Promise<Member> {
    const row = await this.db.teamMember.findUnique({
      where,
      include: { user: { select: { name: true, memberships: { select: { role: true } } } }, salaries: { select: { from: true, monthlyPaise: true } } },
    });
    if (!row) throw new NotFoundException('That person is not on the team');
    const role = teamRoleOf(row.user.memberships.map((m) => m.role as Role));
    const joinedOn = fromDb(row.joinedOn);
    return {
      id: row.id,
      userId: row.userId,
      name: row.user.name,
      role: role && (TEAM_ROLES as readonly string[]).includes(role) ? (role as TeamRole) : null,
      area: row.area,
      joinedOn,
      weeklyOff: row.weeklyOff,
      monthlyPaise: salaryOn(
        row.salaries.map((step) => ({ from: fromDb(step.from), monthlyPaise: step.monthlyPaise })),
        joinedOn,
      ),
    };
  }

  /** May this person open the member's papers? The Super Admin, and the person themselves. */
  openable(user: AuthUser, memberUserId: string): boolean {
    return can(user.memberships, 'team', 'approve') || user.id === memberUserId;
  }

  private names(ids: readonly (string | null | undefined)[]) {
    const wanted = [...new Set(ids.filter((id): id is string => Boolean(id)))];
    return wanted.length === 0
      ? Promise.resolve(new Map<string, string>())
      : this.db.user.findMany({ where: { id: { in: wanted } }, select: { id: true, name: true } }).then((rows) => new Map(rows.map((row) => [row.id, row.name])));
  }

  // ───────────────────────── The joining file ─────────────────────────

  async fileRow(memberId: string) {
    return this.db.joiningFile.findUnique({ where: { memberId } });
  }

  /** The file as shown: the bank account and the PAN masked. */
  async fileDto(memberId: string): Promise<JoiningFileDto> {
    const row = await this.fileRow(memberId);
    const details = detailsOf(row);
    const missing = detailsMissing(details);
    const by = row?.updatedById ? (await this.names([row.updatedById])).get(row.updatedById) ?? null : null;
    return {
      shown: { ...details, bankAccount: masked(details.bankAccount), pan: masked(details.pan) },
      missing,
      complete: missing.length === 0,
      updatedAt: row?.updatedAt.toISOString() ?? null,
      updatedBy: by,
    };
  }

  /** The whole file, the account number and PAN included: only for the Super Admin's edit form. */
  async fullFile(memberId: string): Promise<JoiningDetails> {
    return detailsOf(await this.fileRow(memberId));
  }

  /** Saves the file (the new hire, or the Super Admin for them). A field left out keeps its value. */
  async saveDetails(user: AuthUser, memberId: string, input: JoiningDetailsValues): Promise<void> {
    const saved = detailsOf(await this.fileRow(memberId));
    const next = mergeDetails(saved, input);
    const data = {
      ...next,
      dateOfBirth: next.dateOfBirth ? toDb(next.dateOfBirth) : null,
      updatedById: user.id,
    };
    await this.db.joiningFile.upsert({ where: { memberId }, create: { memberId, ...data }, update: data });
  }

  // ───────────────────────── Documents ─────────────────────────

  /** The documents a person's onboarding asks for. */
  async askedFor(memberId: string): Promise<DocumentAsked[]> {
    const row = await this.db.onboarding.findUnique({ where: { memberId }, select: { documents: true } });
    if (!row) throw new BadRequestException('Their onboarding has not started');
    return askedOf(row.documents);
  }

  async documentRows(memberId: string): Promise<DocumentRow[]> {
    return this.db.joiningDocument.findMany({ where: { memberId }, orderBy: { uploadedAt: 'desc' } });
  }

  /** Each document asked for, with where it stands, its date and whether it is due. */
  async documentsDto(memberId: string, asked: readonly DocumentAsked[]): Promise<JoiningDocumentDto[]> {
    const rows = await this.documentRows(memberId);
    const current = currentDocuments(rows);
    const attachments = await this.db.attachment.findMany({ where: { id: { in: rows.map((row) => row.attachmentId).filter((id): id is string => Boolean(id)) } }, select: { id: true, mimeType: true } });
    const pdf = new Set(attachments.filter((entry) => entry.mimeType === 'application/pdf').map((entry) => entry.id));
    const names = await this.names(rows.flatMap((row) => [row.uploadedById, row.reviewedById]));
    const due = (await this.dueFor([memberId])).get(memberId) ?? [];
    return asked.map((entry) => {
      const row = current.get(entry.kind);
      const onFile = row && row.status !== 'SENT_BACK';
      return {
        kind: entry.kind,
        ...DOCUMENT_LABELS[entry.kind],
        required: entry.required,
        status: (row?.status as JoiningDocumentStatus | undefined) ?? 'WAITING',
        documentId: row && row.attachmentId ? row.id : null,
        pdf: Boolean(row?.attachmentId && pdf.has(row.attachmentId)),
        uploadedAt: row?.uploadedAt.toISOString() ?? null,
        uploadedBy: row?.uploadedById ? (names.get(row.uploadedById) ?? null) : null,
        reviewedAt: row?.reviewedAt?.toISOString() ?? null,
        reviewedBy: row?.reviewedById ? (names.get(row.reviewedById) ?? null) : null,
        reason: row?.status === 'SENT_BACK' ? row.reason : null,
        expiresOn: onFile && row.expiresOn ? fromDb(row.expiresOn) : null,
        proposedExpiry: onFile ? proposedExpiry(entry.kind, indiaDay(row.uploadedAt)) : null,
        due: due.find((found) => found.kind === entry.kind) ?? null,
      };
    });
  }

  /**
   * The documents due for these members (every open member when none are given): past their
   * date or within 30 days of it, or required and missing past the day they were expected
   * (documentsDue in packages/shared/src/onboarding.ts). Only people with an onboarding have
   * documents asked for; someone who has left has nothing due.
   */
  async dueFor(memberIds?: readonly string[], today = indiaDate()): Promise<Map<string, DocumentDue[]>> {
    const onboardings = await this.db.onboarding.findMany({
      where: { ...(memberIds && { memberId: { in: [...memberIds] } }), member: { leftOn: null } },
      select: { memberId: true, documents: true, member: { select: { joinedOn: true } }, tasks: { where: { auto: { in: ['POLICE_CERTIFICATE', 'MEDICAL_CERTIFICATE'] } }, select: { auto: true, daysFromJoining: true } } },
    });
    if (onboardings.length === 0) return new Map();
    const rows = await this.db.joiningDocument.findMany({ where: { memberId: { in: onboardings.map((entry) => entry.memberId) } }, orderBy: { uploadedAt: 'desc' } });
    const due = new Map<string, DocumentDue[]>();
    for (const onboarding of onboardings) {
      const joinedOn = fromDb(onboarding.member.joinedOn);
      // A later document is expected by the due day of the task that waits for it, where the checklist has one.
      const taskDueOn: Partial<Record<JoiningDocumentKind, string>> = {};
      for (const task of onboarding.tasks) {
        const kind: JoiningDocumentKind = task.auto === 'POLICE_CERTIFICATE' ? 'POLICE_VERIFICATION' : 'MEDICAL_FITNESS';
        const day = addDays(joinedOn, task.daysFromJoining);
        if (!taskDueOn[kind] || day < taskDueOn[kind]!) taskDueOn[kind] = day;
      }
      const current = currentDocuments(rows.filter((row) => row.memberId === onboarding.memberId));
      const found = documentsDue({
        asked: askedOf(onboarding.documents),
        documents: [...current.values()]
          .filter((row): row is DocumentRow & { kind: JoiningDocumentKind } => (JOINING_DOCUMENT_KINDS as readonly string[]).includes(row.kind))
          .map((row) => ({ kind: row.kind, status: row.status as JoiningDocumentStatus, expiresOn: row.expiresOn ? fromDb(row.expiresOn) : null })),
        joinedOn,
        taskDueOn,
        today,
      });
      if (found.length > 0) due.set(onboarding.memberId, found);
    }
    return due;
  }

  /** Files a photo or PDF in the person's own folder of the file store, as a JOINING attachment only they and the Super Admin can open. */
  private async storeFile(user: AuthUser, memberId: string, file: { buffer: Buffer; size: number } | undefined): Promise<string> {
    if (!file) throw new BadRequestException('Choose a photo or a PDF');
    const type = sniffFile(file.buffer, true);
    if (!type) throw new BadRequestException('Only a photo (JPEG, PNG or WebP) or a PDF can be uploaded');
    if (file.size > ONBOARDING_RULES.maxFileBytes) throw new BadRequestException('That file is too large: up to 10 MB');
    const id = randomUUID();
    const storageKey = `team/${memberId}/joining/${id}.${type.extension}`;
    await this.storage.put(storageKey, file.buffer, type.mimeType);
    await this.db.attachment.create({ data: { id, kind: 'JOINING', storageKey, mimeType: type.mimeType, sizeBytes: file.size, capturedAt: new Date(), uploadedById: user.id } });
    return id;
  }

  /** Deletes a file from the store and its record. Never throws: a file left over is only a file. */
  private async dropFile(attachmentId: string | null) {
    if (!attachmentId) return;
    try {
      const attachment = await this.db.attachment.findUnique({ where: { id: attachmentId }, select: { storageKey: true } });
      if (attachment) await this.storage.remove(attachment.storageKey).catch(() => undefined);
      await this.db.attachment.deleteMany({ where: { id: attachmentId } });
    } catch (error) {
      this.logger.warn(`Could not remove a joining file: ${String(error)}`);
    }
  }

  /**
   * Uploads a document of a kind asked for. One already uploaded and not yet checked is
   * replaced (its file deleted); one sent back stays as a record with its reason. The new hire
   * cannot replace one already accepted; the Super Admin can.
   */
  async upload(user: AuthUser, memberId: string, asked: readonly DocumentAsked[], kind: string, file: { buffer: Buffer; size: number } | undefined, byHire: boolean): Promise<void> {
    if (!asked.some((entry) => entry.kind === kind)) throw new BadRequestException('That document is not asked for');
    const current = currentDocuments(await this.documentRows(memberId)).get(kind);
    if (byHire && current?.status === 'ACCEPTED') throw new ConflictException('This one is accepted already. Ask ECCS if it needs changing.');
    const attachmentId = await this.storeFile(user, memberId, file);
    if (current && current.status !== 'SENT_BACK') {
      await this.db.joiningDocument.delete({ where: { id: current.id } });
      await this.dropFile(current.attachmentId);
    }
    await this.db.joiningDocument.create({ data: { memberId, kind, status: 'UPLOADED', attachmentId, uploadedById: user.id } });
  }

  async document(documentId: string) {
    const row = await this.db.joiningDocument.findUnique({ where: { id: documentId }, include: { member: { select: { userId: true } } } });
    if (!row) throw new NotFoundException('That document is no longer on file');
    return row;
  }

  /**
   * The Super Admin accepts an uploaded document, with the day it runs out if it does. Left out,
   * the proposed day is kept (medical fitness: a year from its upload); `null` means none.
   */
  async accept(user: AuthUser, documentId: string, expiresOn?: string | null): Promise<string> {
    const row = await this.document(documentId);
    if (row.status !== 'UPLOADED') throw new ConflictException(row.status === 'ACCEPTED' ? 'It is accepted already' : 'It was sent back; wait for a new upload');
    const kind = row.kind as JoiningDocumentKind;
    const date = expiresOn === undefined ? proposedExpiry(kind, indiaDay(row.uploadedAt)) : expiresOn;
    if (date) this.checkDate(date, row.uploadedAt);
    await this.db.joiningDocument.update({ where: { id: row.id }, data: { status: 'ACCEPTED', reviewedAt: new Date(), reviewedById: user.id, reason: null, expiresOn: date ? toDb(date) : null } });
    return row.memberId;
  }

  /** The Super Admin changes or clears the day a document on file runs out. */
  async setDate(documentId: string, expiresOn: string | null): Promise<string> {
    const row = await this.document(documentId);
    if (row.status === 'SENT_BACK') throw new ConflictException('It was sent back; there is nothing on file to date');
    if (expiresOn) this.checkDate(expiresOn, row.uploadedAt);
    await this.db.joiningDocument.update({ where: { id: row.id }, data: { expiresOn: expiresOn ? toDb(expiresOn) : null } });
    return row.memberId;
  }

  /** A document cannot run out before it was uploaded. */
  private checkDate(date: string, uploadedAt: Date) {
    if (date < indiaDay(uploadedAt)) throw new BadRequestException('That date is before the document was uploaded');
  }

  /** The Super Admin sends a document back with a reason. Its file is deleted at once. */
  async sendBack(user: AuthUser, documentId: string, reason: string): Promise<string> {
    const row = await this.document(documentId);
    if (row.status === 'SENT_BACK') throw new ConflictException('It was sent back already');
    await this.db.joiningDocument.update({ where: { id: row.id }, data: { status: 'SENT_BACK', reason, reviewedAt: new Date(), reviewedById: user.id, attachmentId: null } });
    await this.dropFile(row.attachmentId);
    return row.memberId;
  }

  /** A document's file, for the Super Admin or the person themselves only. */
  async openDocument(user: AuthUser, documentId: string): Promise<{ body: Readable; mimeType: string; name: string }> {
    const row = await this.document(documentId);
    if (!this.openable(user, row.member.userId)) throw new ForbiddenException('Only the Super Admin and the person themselves can open joining documents');
    if (!row.attachmentId) throw new NotFoundException('This document has no file: it was sent back');
    const attachment = await this.db.attachment.findUnique({ where: { id: row.attachmentId } });
    if (!attachment || attachment.kind !== 'JOINING') throw new NotFoundException('This document has no file');
    const kind = row.kind as JoiningDocumentKind;
    const extension = attachment.mimeType === 'application/pdf' ? 'pdf' : attachment.mimeType.split('/')[1];
    return { body: await this.storage.get(attachment.storageKey), mimeType: attachment.mimeType, name: `${DOCUMENT_LABELS[kind]?.label ?? 'document'}.${extension}` };
  }

  // ───────────────────────── The staff handbook ─────────────────────────

  async handbook(): Promise<StaffHandbookDto | null> {
    const row = await this.db.staffHandbook.findFirst({ orderBy: { version: 'desc' } });
    if (!row) return null;
    const by = row.createdById ? ((await this.names([row.createdById])).get(row.createdById) ?? null) : null;
    return { version: row.version, title: row.title, body: row.body, publishedAt: row.createdAt.toISOString(), publishedBy: by, isSample: row.isSample };
  }

  /** Publishes a new version; earlier ones stay, with whoever accepted them. */
  async publishHandbook(user: AuthUser, input: { title: string; body: string }): Promise<StaffHandbookDto> {
    const last = await this.db.staffHandbook.findFirst({ orderBy: { version: 'desc' }, select: { version: true } });
    await this.db.staffHandbook.create({ data: { version: (last?.version ?? 0) + 1, title: input.title, body: input.body, createdById: user.id } });
    return (await this.handbook())!;
  }

  /** The person accepts the current version (the one they read). */
  async acceptHandbook(user: AuthUser, memberId: string, version: number): Promise<void> {
    const current = await this.db.staffHandbook.findFirst({ orderBy: { version: 'desc' } });
    if (!current) throw new NotFoundException('There is no staff handbook yet');
    if (current.version !== version) throw new ConflictException(`The handbook has a newer version (${current.version}). Read it again before accepting.`);
    await this.db.handbookAcceptance.upsert({
      where: { memberId_version: { memberId, version } },
      create: { memberId, version, acceptedById: user.id, sha256: sha256(`${current.title}\n\n${current.body}`) },
      update: {},
    });
  }

  async handbookAccepted(memberId: string): Promise<{ version: number; acceptedAt: string } | null> {
    const row = await this.db.handbookAcceptance.findFirst({ where: { memberId }, orderBy: { version: 'desc' } });
    return row ? { version: row.version, acceptedAt: row.acceptedAt.toISOString() } : null;
  }

  // ───────────────────────── The appointment letter ─────────────────────────

  async letterSettings(): Promise<LetterSettings> {
    return letterSettingsOf((await this.db.onboardingSettings.findUnique({ where: { id: 'default' } }))?.letter);
  }

  async saveLetterSettings(settings: LetterSettings): Promise<LetterSettings> {
    await this.db.onboardingSettings.upsert({ where: { id: 'default' }, create: { id: 'default', letter: settings as object }, update: { letter: settings as object } });
    return this.letterSettings();
  }

  /** What a letter is made from, now: Team's records, the joining file, the settings. */
  private async letterInput(member: Member, letter: { number: string; madeAt: Date; madeById: string | null }): Promise<{ input: LetterInput | null; missing: string[] }> {
    const [file, settings, handbook, maker] = await Promise.all([
      this.fileRow(member.id),
      this.letterSettings(),
      this.db.staffHandbook.findFirst({ orderBy: { version: 'desc' }, select: { version: true } }),
      letter.madeById ? this.db.user.findUnique({ where: { id: letter.madeById }, select: { name: true } }) : Promise.resolve(null),
    ]);
    const details = detailsOf(file);
    const missing = letterMissing({ monthlyPaise: member.monthlyPaise, details });
    if (!member.role) missing.unshift('a team role (Ops Manager, Supervisor or BDE)');
    if (missing.length > 0 || !member.role) return { input: null, missing };
    return {
      missing,
      input: {
        number: letter.number,
        madeOn: indiaDate(letter.madeAt),
        name: member.name,
        role: member.role,
        area: member.area,
        joinedOn: member.joinedOn,
        weeklyOff: member.weeklyOff,
        monthlyPaise: member.monthlyPaise,
        details,
        handbookVersion: handbook?.version ?? null,
        settings,
        company: { legalName: SUPPLIER.legalName, address: SUPPLIER.address, lin: null, isSample: SUPPLIER.isSample },
        signedBy: maker?.name ?? 'ECCS',
      },
    };
  }

  /**
   * A waiting letter brought in line with the records: made again (a new version, the same
   * number, today's date) when any of its particulars changed, saying which. A letter accepted
   * or replaced is never touched. A sample letter gets its particulars the first time.
   */
  private async refresh(letter: LetterRow, member: Member): Promise<LetterRow> {
    if (letter.acceptedAt || letter.replacedAt) return letter;
    const { input } = await this.letterInput(member, letter);
    if (!input) return letter;
    const before = letter.particulars as LetterParticulars | null;
    const same = letterParticulars(input);
    if (!before) return this.db.appointmentLetter.update({ where: { id: letter.id }, data: { particulars: same as object } });
    const changes = letterChanges(before, same);
    if (changes.length === 0) return letter;
    const now = new Date();
    const again = letterParticulars({ ...input, madeOn: indiaDate(now) });
    if (letter.pdfKey) await this.storage.remove(letter.pdfKey).catch(() => undefined);
    return this.db.appointmentLetter.update({ where: { id: letter.id }, data: { particulars: again as object, version: { increment: 1 }, remadeFor: changes, madeAt: now, pdfKey: null } });
  }

  private async letterDto(letter: LetterRow, names: Map<string, string>, all: readonly LetterRow[]): Promise<AppointmentLetterDto | null> {
    const particulars = letter.particulars as LetterParticulars | null;
    if (!particulars) return null;
    return {
      id: letter.id,
      number: letter.number,
      version: letter.version,
      status: letter.replacedAt ? 'REPLACED' : letter.acceptedAt ? 'ACCEPTED' : 'WAITING',
      madeAt: letter.madeAt.toISOString(),
      madeBy: letter.madeById ? (names.get(letter.madeById) ?? null) : null,
      remadeFor: Array.isArray(letter.remadeFor) ? (letter.remadeFor as string[]) : [],
      acceptedAt: letter.acceptedAt?.toISOString() ?? null,
      acceptedBy: letter.acceptedById ? (names.get(letter.acceptedById) ?? null) : null,
      acceptedHow: (letter.acceptedHow as 'CLICK' | 'PAPER' | null) ?? null,
      replacedBy: letter.replacedById ? (all.find((other) => other.id === letter.replacedById)?.number ?? null) : null,
      particulars,
      rows: letterRows(particulars),
      opening: letterOpening(particulars),
      closing: LETTER_CLOSING,
    };
  }

  /**
   * The letter in force or waiting (brought up to date first), the earlier ones kept in the
   * file, and what is still needed before one can be made.
   */
  async letterBlock(memberId: string): Promise<LetterBlockDto> {
    const member = await this.member({ id: memberId });
    let rows = await this.db.appointmentLetter.findMany({ where: { memberId }, orderBy: { createdAt: 'asc' } });
    const latest = rows.at(-1);
    if (latest) {
      const fresh = await this.refresh(latest, member);
      rows = rows.map((row) => (row.id === fresh.id ? fresh : row));
    }
    const names = await this.names(rows.flatMap((row) => [row.madeById, row.acceptedById]));
    // The latest is the one shown; an earlier accepted one stays in force (and in the file) until the latest is accepted.
    const current = rows.at(-1) ?? null;
    const { missing } = await this.letterInput(member, { number: '', madeAt: new Date(), madeById: null });
    return {
      current: current ? await this.letterDto(current, names, rows) : null,
      earlier: rows
        .filter((row) => row !== current && (row.acceptedAt || row.replacedAt))
        .map((row) => ({ id: row.id, number: row.number, acceptedAt: row.acceptedAt?.toISOString() ?? null, replacedAt: row.replacedAt?.toISOString() ?? null })),
      missing,
    };
  }

  /** After a change on the Team page (a salary, the role, the joining day): a waiting letter is made again at once. Never throws. */
  async refreshWaiting(memberId: string): Promise<void> {
    try {
      const latest = await this.db.appointmentLetter.findFirst({ where: { memberId }, orderBy: { createdAt: 'desc' } });
      if (latest) await this.refresh(latest, await this.member({ id: memberId }));
    } catch (error) {
      this.logger.warn(`Could not bring a waiting letter up to date: ${String(error)}`);
    }
  }

  /**
   * Makes the letter (the Super Admin). A letter already waiting is brought up to date; once
   * the latest is accepted, a new one with a new number is made (the accepted one stays in
   * force until the new one is accepted).
   */
  async makeLetter(user: AuthUser, memberId: string): Promise<void> {
    const member = await this.member({ id: memberId });
    const latest = await this.db.appointmentLetter.findFirst({ where: { memberId }, orderBy: { createdAt: 'desc' } });
    const check = await this.letterInput(member, { number: '', madeAt: new Date(), madeById: user.id });
    if (!check.input) throw new BadRequestException(`Before the letter can be made, fill in ${check.missing.join(', ')}.`);
    if (latest && !latest.acceptedAt && !latest.replacedAt) {
      await this.refresh(latest, member);
      return;
    }
    const now = new Date();
    await this.db.$transaction(async (tx) => {
      // One at a time, until this transaction ends: see LETTER_LOCK.
      await tx.$executeRawUnsafe(`SELECT pg_advisory_xact_lock(${LETTER_LOCK})`);
      const year = indiaDate(now).slice(0, 4);
      const prefix = LETTER_NUMBER_PREFIX(year);
      const last = await tx.appointmentLetter.findFirst({ where: { number: { startsWith: prefix } }, orderBy: { number: 'desc' }, select: { number: true } });
      const number = letterNumber(year, (last ? Number(last.number.slice(prefix.length)) || 0 : 0) + 1);
      const particulars = letterParticulars({ ...check.input!, number, madeOn: indiaDate(now) });
      await tx.appointmentLetter.create({ data: { memberId, number, particulars: particulars as object, madeAt: now, madeById: user.id } });
    });
  }

  async letter(letterId: string) {
    const row = await this.db.appointmentLetter.findUnique({ where: { id: letterId }, include: { member: { select: { userId: true } } } });
    if (!row) throw new NotFoundException('That letter is not on file');
    return row;
  }

  /**
   * Records the acceptance: on the Joining ECCS page by the person ("I accept", a click-to-accept
   * is a valid electronic record), or signed on paper with the scan filed (the Super Admin).
   * The version read must be the one in place; the fingerprint of the exact text is kept; an
   * earlier accepted letter is marked replaced by this one.
   */
  async acceptLetter(user: AuthUser, letterId: string, how: { kind: 'CLICK'; version: number; ip: string | null } | { kind: 'PAPER'; scanId: string }): Promise<string> {
    const row = await this.letter(letterId);
    if (row.acceptedAt) throw new ConflictException('This letter is accepted already');
    if (row.replacedAt) throw new ConflictException('This letter has been replaced by a newer one');
    const latest = await this.db.appointmentLetter.findFirst({ where: { memberId: row.memberId }, orderBy: { createdAt: 'desc' }, select: { id: true } });
    if (latest?.id !== row.id) throw new ConflictException('There is a newer letter. Read that one.');
    const fresh = await this.refresh(row, await this.member({ id: row.memberId }));
    const particulars = fresh.particulars as LetterParticulars | null;
    if (!particulars) throw new BadRequestException('The letter is not ready yet. Ask ECCS.');
    if (how.kind === 'CLICK' && how.version !== fresh.version) {
      const changed = Array.isArray(fresh.remadeFor) ? (fresh.remadeFor as string[]).join(', ').toLowerCase() : 'its terms';
      throw new ConflictException({ message: `The letter was made again just now (${changed} changed). Read it again before accepting.`, code: 'LETTER_CHANGED' });
    }
    const now = new Date();
    await this.db.$transaction([
      this.db.appointmentLetter.update({
        where: { id: fresh.id },
        data: {
          acceptedAt: now,
          acceptedById: user.id,
          acceptedHow: how.kind,
          acceptedIp: how.kind === 'CLICK' ? how.ip : null,
          acceptedSha256: sha256(letterText(particulars)),
          signedScanId: how.kind === 'PAPER' ? how.scanId : null,
          // Printed again with the acceptance on it the next time it is opened.
          pdfKey: null,
        },
      }),
      this.db.appointmentLetter.updateMany({ where: { memberId: row.memberId, id: { not: fresh.id }, acceptedAt: { not: null }, replacedAt: null }, data: { replacedAt: now, replacedById: fresh.id } }),
    ]);
    if (fresh.pdfKey) await this.storage.remove(fresh.pdfKey).catch(() => undefined);
    return row.memberId;
  }

  /** "Signed on paper": the Super Admin files the signed scan and records the acceptance. */
  async signedOnPaper(user: AuthUser, letterId: string, file: { buffer: Buffer; size: number } | undefined): Promise<string> {
    const row = await this.letter(letterId);
    if (row.acceptedAt) throw new ConflictException('This letter is accepted already');
    const scanId = await this.storeFile(user, row.memberId, file);
    try {
      return await this.acceptLetter(user, letterId, { kind: 'PAPER', scanId });
    } catch (error) {
      await this.dropFile(scanId);
      throw error;
    }
  }

  /** The letter as a PDF, for the Super Admin or the person only; printed the first time and kept. */
  async letterPdf(user: AuthUser, letterId: string): Promise<{ body: Readable; name: string }> {
    let row: LetterRow = await this.letter(letterId);
    const owner = (await this.db.teamMember.findUnique({ where: { id: row.memberId }, select: { userId: true } }))?.userId ?? '';
    if (!this.openable(user, owner)) throw new ForbiddenException('Only the Super Admin and the person themselves can open an appointment letter');
    row = await this.refresh(row, await this.member({ id: row.memberId }));
    const name = `Appointment letter ${row.number.replace(/\//g, '-')}.pdf`;
    if (row.pdfKey) {
      try {
        return { body: await this.storage.get(row.pdfKey), name };
      } catch {
        // Gone from the store: printed again below.
      }
    }
    const particulars = row.particulars as LetterParticulars | null;
    if (!particulars) throw new BadRequestException('The letter is not ready yet');
    const names = await this.names([row.acceptedById]);
    const pdf = await this.printer.print(letterHtml(particulars, row, row.acceptedById ? (names.get(row.acceptedById) ?? null) : null), { footer: `Letter of appointment ${row.number} · version ${row.version}${particulars.isSample ? ' · Sample format' : ''}` });
    const key = `team/${row.memberId}/letters/${row.number.replace(/\//g, '-')}-v${row.version}.pdf`;
    await this.storage.put(key, pdf, 'application/pdf');
    await this.db.appointmentLetter.update({ where: { id: row.id }, data: { pdfKey: key } });
    return { body: await this.storage.get(key), name };
  }

  /** The person's first login on the phone app (any login not made in the console). */
  async firstAppLogin(userIds: readonly string[]): Promise<Map<string, string>> {
    if (userIds.length === 0) return new Map();
    const rows = await this.db.session.groupBy({
      by: ['userId'],
      where: { userId: { in: [...userIds] }, OR: [{ deviceName: null }, { deviceName: { not: ONBOARDING_RULES.consoleDeviceName } }] },
      _min: { createdAt: true },
    });
    return new Map(rows.filter((row) => row._min.createdAt).map((row) => [row.userId, row._min.createdAt!.toISOString()]));
  }
}

const LETTER_STYLES = `
  .to { margin: 16px 0 10px; }
  .facts th { width: 30%; }
  .facts td, .facts th { padding: 4px 8px 4px 0; border-bottom: 1px solid ${REPORT_COLORS.line}; }
  .sign { margin-top: 22px; break-inside: avoid; }
  .accept { margin-top: 18px; }
  .lines { margin-top: 22px; display: flex; gap: 40px; }
  .lines span { flex: 1; border-top: 1px solid ${REPORT_COLORS.text}; padding-top: 4px; font-size: 9.5pt; color: ${REPORT_COLORS.muted}; }
`;

/** The letter as a page to print: the codes' particulars in a table, the signature, the acceptance. */
function letterHtml(p: LetterParticulars, row: LetterRow, acceptedBy: string | null): string {
  const rows = letterRows(p)
    .map((entry) => `<tr><th>${escapeHtml(entry.label)}</th><td>${escapeHtml(entry.value)}</td></tr>`)
    .join('');
  const accepted = row.acceptedAt
    ? `<div class="box accept"><b>Accepted</b><p>${
        row.acceptedHow === 'PAPER'
          ? `Signed on paper; the signed copy is filed with ECCS (recorded by ${escapeHtml(acceptedBy ?? 'ECCS')}, ${moment(row.acceptedAt)}).`
          : `Accepted by ${escapeHtml(acceptedBy ?? p.name)} on the Joining ECCS page, ${moment(row.acceptedAt)}.`
      }</p><p class="muted">Fingerprint of the text accepted: ${escapeHtml((row.acceptedSha256 ?? '').slice(0, 16))}</p></div>`
    : `<div class="accept"><p>I have read this letter and I accept these terms.</p><div class="lines"><span>Signature of ${escapeHtml(p.name)}</span><span>Date</span></div></div>`;
  const body = `
    <p class="muted">Date: ${escapeHtml(p.madeOn)}</p>
    <p class="to"><b>To</b><br>${escapeHtml(p.name)}<br>${escapeHtml(p.address)}</p>
    <p>${escapeHtml(letterOpening(p))}</p>
    <table class="facts">${rows}</table>
    <p style="margin-top:12px">${escapeHtml(LETTER_CLOSING)}</p>
    <div class="sign">For ECCS (${escapeHtml(p.employer.split(',')[0] ?? 'ECCS')})<br><b>${escapeHtml(p.signedBy)}</b>, founder</div>
    ${accepted}
    <footer class="muted">Letter ${escapeHtml(p.number)}, version ${row.version}${p.isSample ? ' · Sample format: ECCS\'s company details and terms are samples until a lawyer and the founder settle them.' : ''}</footer>`;
  return reportPage({ title: 'Letter of appointment', number: p.number, styles: LETTER_STYLES, body });
}
