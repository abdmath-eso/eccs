import { randomUUID } from 'node:crypto';
import { BadRequestException, ConflictException, ForbiddenException, Injectable, NotFoundException } from '@nestjs/common';
import type { Prisma } from '@eccs/db';
import {
  accessScope,
  can,
  INSPECTION_MAX_PHOTOS,
  INSPECTION_TEMPLATE_NAME,
  isCriticalCheck,
  isEccsRole,
  readPhotoFlags,
  scoreInspection,
  type InspectionAnswer,
  type InspectionAnswerResultDto,
  type InspectionCheckDto,
  type InspectionDto,
  type InspectionGrade,
  type InspectionOutletDto,
  type InspectionSeverity,
  type InspectionStatus,
  type InspectionSummaryDto,
  type LocalizedText,
} from '@eccs/shared';
import type { AuthUser } from '../auth/auth.types.js';
import { indiaDate } from '../checklists/checklists.service.js';
import { PrismaService } from '../prisma/prisma.service.js';
import { phoneTime, sameMoment } from '../services/services.service.js';
import { sniffFile } from '../storage/attachments.controller.js';
import { PhotoIntegrityService, type PhotoFacts } from '../storage/photo-integrity.service.js';
import { StorageService } from '../storage/storage.service.js';
import { InspectionPdfService } from './inspection-pdf.service.js';

const MAX_LISTED = 200;
const MAX_PHOTO_BYTES = 5 * 1024 * 1024;
const MAX_DAYS_AHEAD = 365;

const toDbDate = (date: string) => new Date(`${date}T00:00:00.000Z`);
const fromDbDate = (date: Date) => date.toISOString().slice(0, 10);

const outletSelect = {
  select: { id: true, name: true, address: true, city: true, organizationId: true, organization: { select: { name: true } } },
} as const;

const summaryInclude = {
  outlet: outletSelect,
  supervisor: { select: { id: true, name: true } },
  responses: { select: { answer: true } },
  template: { select: { _count: { select: { items: { where: { isActive: true, outletId: null } } } } } },
} as const satisfies Prisma.InspectionInclude;

const detailInclude = {
  outlet: outletSelect,
  supervisor: { select: { id: true, name: true } },
  template: {
    select: {
      items: {
        where: { outletId: null },
        orderBy: { position: 'asc' },
        select: { id: true, position: true, section: true, label: true, weight: true, isActive: true },
      },
    },
  },
  responses: {
    include: { finding: { include: { attachments: { orderBy: { createdAt: 'asc' } } } } },
  },
} as const satisfies Prisma.InspectionInclude;

type SummaryRow = Prisma.InspectionGetPayload<{ include: typeof summaryInclude }>;
type DetailRow = Prisma.InspectionGetPayload<{ include: typeof detailInclude }>;
type ResponseRow = DetailRow['responses'][number];
type ItemRow = DetailRow['template']['items'][number];

/**
 * Scored inspections. ECCS puts an inspection of an outlet in a Supervisor's
 * list; the Supervisor answers every check on site (each answer is saved as it
 * is given); finishing works out the scores and the grade and gives the report
 * its number; an ECCS admin approves it or sends it back with a note. Only an
 * approved report is final, and only then can the restaurant read it.
 */
@Injectable()
export class InspectionsService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly storage: StorageService,
    private readonly pdfs: InspectionPdfService,
    private readonly integrity: PhotoIntegrityService,
  ) {}

  private get db() {
    return this.prisma.client;
  }

  // ───────────────────────── Lists ─────────────────────────

  /**
   * Inspections the user may see, newest first. ECCS admins see all of them, a
   * Supervisor only their own, a restaurant only approved reports of its outlets.
   */
  async list(user: AuthUser, filter: { outletId?: string | undefined }): Promise<InspectionSummaryDto[]> {
    const scope = accessScope(user.memberships, 'inspections');
    if (!scope) return [];

    let where: Prisma.InspectionWhereInput;
    if (scope.kind === 'all') where = {};
    else if (scope.kind === 'assigned') where = { supervisorId: user.id };
    else {
      where = {
        status: 'APPROVED',
        OR: [{ outlet: { organizationId: { in: scope.organizationIds } } }, { outletId: { in: scope.outletIds } }],
      };
    }

    const inspections = await this.db.inspection.findMany({
      where: { AND: [where, filter.outletId ? { outletId: filter.outletId } : {}] },
      include: summaryInclude,
      orderBy: [{ conductedAt: 'desc' }, { createdAt: 'desc' }],
      take: MAX_LISTED,
    });
    // A finished inspection is made of the checks that were answered, whatever the template holds now.
    return inspections.map((inspection) =>
      toSummary(
        inspection,
        inspection.responses,
        inspection.status === 'DRAFT' ? inspection.template._count.items : inspection.responses.length,
      ),
    );
  }

  /** Outlets the user may start an inspection for: all for ECCS admins, their assigned ones for a Supervisor. */
  async outlets(user: AuthUser): Promise<InspectionOutletDto[]> {
    if (!can(user.memberships, 'inspections', 'create')) return [];
    const outlets = await this.db.outlet.findMany({
      where: { isActive: true, ...(this.isEccsAdmin(user) ? {} : this.assignedOutlets(user)) },
      select: outletSelect.select,
      orderBy: [{ organization: { name: 'asc' } }, { name: 'asc' }],
    });
    return outlets.map((outlet) => ({
      id: outlet.id,
      name: outlet.name,
      organizationName: outlet.organization.name,
      address: [outlet.address, outlet.city].filter(Boolean).join(', ') || null,
    }));
  }

  async get(user: AuthUser, inspectionId: string): Promise<InspectionDto> {
    return this.toDto(user, await this.requireInspection(user, inspectionId));
  }

  // ───────────────────────── Planning ─────────────────────────

  /**
   * Puts an inspection of an outlet in the list. An ECCS admin may give it to a
   * Supervisor and a day; a Supervisor starts one for themselves.
   */
  async start(
    user: AuthUser,
    input: { outletId: string; supervisorId?: string | null | undefined; date?: string | undefined },
  ): Promise<InspectionDto> {
    const admin = this.isEccsAdmin(user);
    const outlet = await this.db.outlet.findFirst({
      where: { id: input.outletId, isActive: true, ...(admin ? {} : this.assignedOutlets(user)) },
      select: { id: true },
    });
    if (!outlet) throw new BadRequestException('Outlet not found');
    if (!admin && input.supervisorId && input.supervisorId !== user.id) {
      throw new ForbiddenException('Only ECCS can give an inspection to someone else');
    }
    const supervisorId = admin && input.supervisorId ? await this.requireSupervisor(input.supervisorId) : user.id;
    const date = input.date ?? indiaDate();
    this.requireUpcomingDate(date);

    const template = await this.db.checklistTemplate.findFirst({
      where: { kind: 'INSPECTION', isActive: true, outletId: null, title: { path: ['en'], equals: INSPECTION_TEMPLATE_NAME } },
      select: { id: true },
    });
    if (!template) throw new ConflictException('The inspection checklist has not been loaded yet');

    const inspection = await this.db.inspection.create({
      data: {
        outletId: outlet.id,
        templateId: template.id,
        supervisorId,
        plannedDate: toDbDate(date),
        // Until it is carried out, the list sorts it by the day it is planned for.
        conductedAt: toDbDate(date),
        createdById: user.id,
      },
    });
    return this.get(user, inspection.id);
  }

  /** ECCS moves an inspection or gives it to someone else, until the first check is answered. */
  async update(
    user: AuthUser,
    inspectionId: string,
    input: { supervisorId?: string | undefined; date?: string | undefined },
  ): Promise<InspectionDto> {
    const inspection = await this.requirePlanned(user, inspectionId);
    if (input.date !== undefined) this.requireUpcomingDate(input.date);
    const supervisorId =
      input.supervisorId === undefined ? inspection.supervisorId : await this.requireSupervisor(input.supervisorId);
    await this.db.inspection.update({
      where: { id: inspection.id },
      data: {
        supervisorId,
        ...(input.date !== undefined && { plannedDate: toDbDate(input.date), conductedAt: toDbDate(input.date) }),
      },
    });
    return this.get(user, inspection.id);
  }

  /** ECCS takes an inspection that has not been started off the list. */
  async remove(user: AuthUser, inspectionId: string): Promise<void> {
    const inspection = await this.requirePlanned(user, inspectionId);
    await this.db.inspection.delete({ where: { id: inspection.id } });
  }

  // ───────────────────────── On site ─────────────────────────

  /**
   * Saves the answer to one check. A non-compliance keeps its details (and its
   * photos) in a finding; changing the answer away from "not compliant" removes them.
   */
  async answer(
    user: AuthUser,
    inspectionId: string,
    itemId: string,
    input: {
      answer: InspectionAnswer;
      note?: string | undefined;
      severity?: InspectionSeverity | null | undefined;
      correctiveAction?: string | undefined;
      dueDate?: string | null | undefined;
      /** When it was answered on the phone, if that was earlier than now (no signal at the time). */
      at?: string | undefined;
    },
  ): Promise<InspectionAnswerResultDto> {
    const inspection = await this.requireRecordable(user, inspectionId);
    const item = this.activeItems(inspection).find((entry) => entry.id === itemId);
    if (!item) throw new NotFoundException('That check is not part of this inspection');

    const failed = input.answer === 'NON_COMPLIANT';
    const now = phoneTime(input.at);
    const started = inspection.startedAt ?? now;
    if (failed && input.dueDate && input.dueDate < indiaDate(started)) {
      throw new BadRequestException('The date to fix it by cannot be before the inspection');
    }

    const previous = inspection.responses.find((response) => response.itemId === itemId);
    const data = {
      answer: input.answer,
      passed: input.answer === 'NOT_APPLICABLE' ? null : !failed,
      score: input.answer === 'NOT_APPLICABLE' ? null : failed ? 0 : item.weight,
      note: failed ? input.note || null : null,
      answeredAt: now,
    };
    const response = await this.db.inspectionResponse.upsert({
      where: { inspectionId_itemId: { inspectionId: inspection.id, itemId } },
      create: { inspectionId: inspection.id, itemId, ...data },
      update: data,
    });

    if (failed) {
      const finding = {
        severity: input.severity ?? null,
        description: input.note ?? '',
        correctiveAction: input.correctiveAction || null,
        dueDate: input.dueDate ? toDbDate(input.dueDate) : null,
      };
      await this.db.inspectionFinding.upsert({
        where: { responseId: response.id },
        create: { inspectionId: inspection.id, responseId: response.id, ...finding },
        update: finding,
      });
    } else if (previous?.finding) {
      await this.removeFinding(previous.finding);
    }

    // The first answer is when the inspection starts, and the day it is dated by from then on.
    if (!inspection.startedAt) {
      await this.db.inspection.update({ where: { id: inspection.id }, data: { startedAt: now, conductedAt: now } });
    }
    return this.answerResult(inspection.id, itemId);
  }

  /** Adds a photo to a check answered "not compliant". */
  async addPhoto(
    user: AuthUser,
    inspectionId: string,
    itemId: string,
    file: { buffer: Buffer; size: number },
    /** Chosen by the phone: the photo's id, so sending it twice stores it once, and when it was taken. */
    phone: { id?: string | undefined; capturedAt?: string | undefined } = {},
    /** What the phone said about the photo besides the picture: where it was, and whether the camera took it. */
    facts?: PhotoFacts,
  ): Promise<InspectionAnswerResultDto> {
    if (phone.id) {
      const earlier = await this.db.attachment.findUnique({
        where: { id: phone.id },
        select: { inspectionFinding: { select: { inspectionId: true } } },
      });
      // The same photo sent again after its first reply was lost: it is already on the check.
      if (earlier?.inspectionFinding?.inspectionId === inspectionId) {
        await this.requireInspection(user, inspectionId);
        return this.answerResult(inspectionId, itemId);
      }
      if (earlier) throw new ConflictException('That photo has already been used elsewhere');
    }
    const inspection = await this.requireRecordable(user, inspectionId);
    const finding = inspection.responses.find((response) => response.itemId === itemId)?.finding;
    if (!finding) throw new ConflictException('Mark the check as not compliant before adding a photo');
    const image = sniffFile(file.buffer, false);
    if (!image) throw new BadRequestException('Only JPEG, PNG or WebP photos are accepted');
    if (file.size > MAX_PHOTO_BYTES) throw new BadRequestException('That photo is too large');
    if (finding.attachments.length >= INSPECTION_MAX_PHOTOS) {
      throw new BadRequestException(`A check can have up to ${INSPECTION_MAX_PHOTOS} photos`);
    }

    const id = phone.id ?? randomUUID();
    const now = new Date();
    const month = String(now.getUTCMonth() + 1).padStart(2, '0');
    const storageKey = `outlets/${inspection.outletId}/${now.getUTCFullYear()}/${month}/${id}.${image.extension}`;
    await this.storage.put(storageKey, file.buffer, image.mimeType);
    await this.db.attachment.create({
      data: {
        id,
        outletId: inspection.outletId,
        inspectionFindingId: finding.id,
        kind: 'PROOF',
        storageKey,
        mimeType: image.mimeType,
        sizeBytes: file.size,
        capturedAt: phoneTime(phone.capturedAt, now),
        uploadedById: user.id,
        ...this.integrity.captureColumns({ buffer: file.buffer, mimeType: image.mimeType }, phone.capturedAt, now, facts),
      },
    });
    // Look at the photo once (time, place, used before). This only marks it for ECCS; it cannot refuse it.
    await this.integrity.assess(id);
    return this.answerResult(inspection.id, itemId);
  }

  /**
   * `itemId` is the check the photo belonged to. A phone sends it so that the same
   * removal sent twice is not an error: the photo is gone, which is what was wanted.
   */
  async removePhoto(
    user: AuthUser,
    inspectionId: string,
    photoId: string,
    itemId?: string,
  ): Promise<InspectionAnswerResultDto> {
    const inspection = await this.requireRecordable(user, inspectionId);
    const response = inspection.responses.find((entry) => entry.finding?.attachments.some((photo) => photo.id === photoId));
    const photo = response?.finding?.attachments.find((entry) => entry.id === photoId);
    if ((!response || !photo) && itemId && this.activeItems(inspection).some((item) => item.id === itemId)) {
      return this.answerResult(inspection.id, itemId);
    }
    if (!response || !photo) throw new NotFoundException('Photo not found');
    await this.db.attachment.delete({ where: { id: photo.id } });
    await this.storage.remove(photo.storageKey).catch(() => undefined);
    return this.answerResult(inspection.id, response.itemId);
  }

  /**
   * The Supervisor finishes. Every check must be answered and every
   * non-compliance must have its details and a photo. The scores and the grade
   * are worked out here, the report gets its number, and it waits for ECCS.
   */
  async finish(user: AuthUser, inspectionId: string, at?: string): Promise<InspectionDto> {
    if (at) {
      // `at` is when Finish was pressed on the phone. The same Finish sent again (its first
      // reply was lost on a weak signal) is not an error: the inspection is already finished.
      const earlier = await this.requireInspection(user, inspectionId);
      if (earlier.status !== 'DRAFT' && this.mayRecord(user, earlier) && sameMoment(earlier.completedAt, at)) {
        return this.toDto(user, earlier);
      }
    }
    const inspection = await this.requireRecordable(user, inspectionId);
    const checks = this.checks(inspection);
    if (checks.some((check) => check.answer === null)) {
      throw new BadRequestException('Answer every check before finishing');
    }
    if (checks.some((check) => !check.complete)) {
      throw new BadRequestException(
        'Every non-compliance needs a note, a severity, a corrective action, a date to fix it by and a photo',
      );
    }
    const score = scoreInspection(this.scored(inspection));
    if (score.possible === 0) throw new BadRequestException('At least one check must apply to the outlet');

    const now = phoneTime(at);
    for (let attempt = 0; ; attempt++) {
      try {
        await this.db.$transaction(async (tx) => {
          // A report sent back for correction keeps the number it was first given.
          let reportNumber = inspection.reportNumber;
          if (!reportNumber) {
            const prefix = `IR-${indiaDate(now).slice(0, 4)}-`;
            const issued = await tx.inspection.count({ where: { reportNumber: { startsWith: prefix } } });
            reportNumber = `${prefix}${String(issued + 1 + attempt).padStart(5, '0')}`;
          }
          await tx.inspection.update({
            where: { id: inspection.id },
            data: {
              status: 'SUBMITTED',
              completedAt: now,
              overallScore: score.overallScore,
              grade: score.grade,
              sectionScores: score.sections as unknown as Prisma.InputJsonValue,
              reportNumber,
            },
          });
        });
        break;
      } catch (error) {
        // Two inspections finished at the same moment can pick the same number; take the next.
        if (attempt >= 3 || (error as { code?: string }).code !== 'P2002') throw error;
      }
    }
    return this.get(user, inspection.id);
  }

  // ───────────────────────── Review by ECCS ─────────────────────────

  /** ECCS has checked the report. It is final from here and the restaurant can read it. */
  async approve(user: AuthUser, inspectionId: string): Promise<InspectionDto> {
    const inspection = await this.requireInReview(user, inspectionId);
    await this.db.inspection.update({
      where: { id: inspection.id },
      data: { status: 'APPROVED', approvedById: user.id, approvedAt: new Date(), reviewNote: null },
    });
    // The PDF takes a few seconds, so the approval does not wait for it.
    this.pdfs.ensureLater(inspection.id);
    return this.get(user, inspection.id);
  }

  /** A link to the approved report as a PDF. Makes the PDF first if it is not there yet. */
  async reportPdf(user: AuthUser, inspectionId: string): Promise<{ path: string }> {
    const inspection = await this.requireInspection(user, inspectionId);
    if (inspection.status !== 'APPROVED') {
      throw new ConflictException('The PDF is ready once ECCS has approved the inspection report');
    }
    return { path: this.storage.signedPath(await this.pdfs.ensure(inspection.id)) };
  }

  /**
   * ECCS finds something wrong or missing and gives the inspection back to the
   * Supervisor, who corrects it and finishes again under the same report number.
   */
  async sendBack(user: AuthUser, inspectionId: string, note: string): Promise<InspectionDto> {
    const inspection = await this.requireInReview(user, inspectionId);
    await this.db.inspection.update({
      where: { id: inspection.id },
      data: { status: 'DRAFT', completedAt: null, overallScore: null, grade: null, reviewNote: note },
    });
    return this.get(user, inspection.id);
  }

  // ───────────────────────── Helpers ─────────────────────────

  /** Super Admin and Operations Manager: the people who plan inspections and approve reports. */
  private isEccsAdmin(user: AuthUser): boolean {
    return accessScope(user.memberships, 'inspections')?.kind === 'all' && can(user.memberships, 'inspections', 'approve');
  }

  /** The outlets a Supervisor works at: those with a visit or an inspection given to them. */
  private assignedOutlets(user: AuthUser): Prisma.OutletWhereInput {
    return { OR: [{ jobs: { some: { supervisorId: user.id } } }, { inspections: { some: { supervisorId: user.id } } }] };
  }

  /** The person carrying it out, or an ECCS admin standing in. */
  private mayRecord(user: AuthUser, inspection: { supervisorId: string }): boolean {
    if (!can(user.memberships, 'inspections', 'update')) return false;
    return this.isEccsAdmin(user) || inspection.supervisorId === user.id;
  }

  private async requireRecordable(user: AuthUser, inspectionId: string): Promise<DetailRow> {
    const inspection = await this.requireInspection(user, inspectionId);
    if (!this.mayRecord(user, inspection)) throw new ForbiddenException('This inspection is not assigned to you');
    if (inspection.status !== 'DRAFT') {
      throw new ConflictException('This inspection is finished and can no longer be changed');
    }
    return inspection;
  }

  private async requireInReview(user: AuthUser, inspectionId: string): Promise<DetailRow> {
    const inspection = await this.requireInspection(user, inspectionId);
    if (!this.isEccsAdmin(user)) throw new ForbiddenException('Only ECCS can check an inspection report');
    if (inspection.status !== 'SUBMITTED') throw new ConflictException('This report is not waiting to be checked');
    return inspection;
  }

  private async requirePlanned(user: AuthUser, inspectionId: string): Promise<DetailRow> {
    const inspection = await this.requireInspection(user, inspectionId);
    if (!this.isEccsAdmin(user)) throw new ForbiddenException('Only ECCS can change an inspection');
    if (inspection.status !== 'DRAFT' || inspection.startedAt) {
      throw new ConflictException('This inspection has already been started');
    }
    return inspection;
  }

  private requireUpcomingDate(date: string) {
    const today = indiaDate();
    if (date < today) throw new BadRequestException('Choose today or a later date');
    const latest = new Date(toDbDate(today).getTime() + MAX_DAYS_AHEAD * 86_400_000);
    if (toDbDate(date) > latest) throw new BadRequestException(`Choose a date within the next ${MAX_DAYS_AHEAD} days`);
  }

  private async requireSupervisor(supervisorId: string): Promise<string> {
    const person = await this.db.user.findFirst({
      where: { id: supervisorId, isActive: true, memberships: { some: { role: 'SUPERVISOR' } } },
      select: { id: true },
    });
    if (!person) throw new BadRequestException('Choose one of the Supervisors');
    return person.id;
  }

  /**
   * Loads an inspection if the user may see it. "Not found" and "not yours" look
   * the same. A restaurant is only ever shown an approved report.
   */
  private async requireInspection(user: AuthUser, inspectionId: string): Promise<DetailRow> {
    const inspection = await this.db.inspection.findUnique({ where: { id: inspectionId }, include: detailInclude });
    if (!inspection) throw new NotFoundException('Inspection not found');
    let allowed = can(user.memberships, 'inspections', 'read', {
      organizationId: inspection.outlet.organizationId,
      outletId: inspection.outletId,
    });
    const scope = accessScope(user.memberships, 'inspections');
    if (allowed && scope?.kind === 'assigned') allowed = inspection.supervisorId === user.id;
    if (allowed && scope?.kind === 'restaurant') allowed = inspection.status === 'APPROVED';
    if (!allowed) throw new NotFoundException('Inspection not found');
    return inspection;
  }

  private async removeFinding(finding: NonNullable<ResponseRow['finding']>) {
    await this.db.attachment.deleteMany({ where: { inspectionFindingId: finding.id } });
    await this.db.inspectionFinding.delete({ where: { id: finding.id } });
    await Promise.all(finding.attachments.map((photo) => this.storage.remove(photo.storageKey).catch(() => undefined)));
  }

  /**
   * The checks this inspection is made of. While it is being filled in these are
   * the template's current checks; once finished, the ones that were answered, so
   * a later change to the template never alters a report.
   */
  private activeItems(inspection: DetailRow): ItemRow[] {
    if (inspection.status === 'DRAFT') return inspection.template.items.filter((item) => item.isActive);
    const answered = new Set(inspection.responses.map((response) => response.itemId));
    return inspection.template.items.filter((item) => answered.has(item.id));
  }

  /** `withFlags`: also say why a photo is doubtful. Only for the ECCS office, never the restaurant or the Supervisor. */
  private checks(inspection: DetailRow, withFlags = false): (InspectionCheckDto & { section: string })[] {
    const responses = new Map(inspection.responses.map((response) => [response.itemId, response]));
    return this.activeItems(inspection).map((item) => ({
      section: item.section ?? '',
      ...this.toCheck(item, responses.get(item.id), withFlags),
    }));
  }

  private scored(inspection: DetailRow) {
    return this.checks(inspection).map((check) => ({ section: check.section, marks: check.marks, answer: check.answer }));
  }

  private toCheck(item: ItemRow, response: ResponseRow | undefined, withFlags = false): InspectionCheckDto {
    const finding = response?.answer === 'NON_COMPLIANT' ? response.finding : null;
    const photos = (finding?.attachments ?? []).map((photo) => ({
      id: photo.id,
      path: this.storage.signedPath(photo.id),
      ...(withFlags && photo.doubtful && { flags: readPhotoFlags(photo.integrityFlags) }),
    }));
    const complete =
      response !== undefined &&
      (response.answer !== 'NON_COMPLIANT' ||
        Boolean(finding?.description && finding.severity && finding.correctiveAction && finding.dueDate && photos.length > 0));
    return {
      itemId: item.id,
      number: item.position,
      label: item.label as LocalizedText,
      critical: isCriticalCheck(item.weight),
      marks: item.weight,
      answer: response?.answer ?? null,
      note: finding?.description || null,
      severity: finding?.severity ?? null,
      correctiveAction: finding?.correctiveAction ?? null,
      dueDate: finding?.dueDate ? fromDbDate(finding.dueDate) : null,
      photos,
      complete,
    };
  }

  private async answerResult(inspectionId: string, itemId: string): Promise<InspectionAnswerResultDto> {
    const inspection = await this.db.inspection.findUniqueOrThrow({ where: { id: inspectionId }, include: detailInclude });
    const checks = this.checks(inspection);
    const check = checks.find((entry) => entry.itemId === itemId);
    if (!check) throw new NotFoundException('That check is not part of this inspection');
    return {
      check: stripSection(check),
      status: stage(inspection),
      answered: checks.filter((check) => check.answer !== null).length,
      complete: checks.filter((check) => check.complete).length,
      total: checks.length,
    };
  }

  private toDto(user: AuthUser, inspection: DetailRow): InspectionDto {
    const checks = this.checks(inspection, this.isEccsAdmin(user));
    const score = scoreInspection(checks.map((check) => ({ section: check.section, marks: check.marks, answer: check.answer })));
    const forRestaurant = !user.memberships.some((m) => isEccsRole(m.role));
    const status = stage(inspection);
    return {
      ...toSummary(inspection, inspection.responses, checks.length),
      sections: score.sections.map((section, index) => ({
        key: String(index + 1),
        title: section.section,
        score: section.score,
        earned: section.earned,
        possible: section.possible,
        checks: checks.filter((check) => check.section === section.section).map(stripSection),
      })),
      complete: checks.filter((check) => check.complete).length,
      criticalFailed: score.criticalFailed,
      startedAt: inspection.startedAt?.toISOString() ?? null,
      correctionNote: forRestaurant ? null : inspection.reviewNote,
      canRecord: inspection.status === 'DRAFT' && this.mayRecord(user, inspection),
      canReview: status === 'SUBMITTED' && this.isEccsAdmin(user),
      canManage: status === 'PLANNED' && this.isEccsAdmin(user),
    };
  }
}

const stripSection = ({ section: _section, ...check }: InspectionCheckDto & { section: string }): InspectionCheckDto => check;

/** A draft nobody has answered a check of is still only planned. */
function stage(inspection: { status: string; startedAt: Date | null }): InspectionStatus {
  if (inspection.status === 'DRAFT') return inspection.startedAt ? 'IN_PROGRESS' : 'PLANNED';
  return inspection.status as InspectionStatus;
}

function toSummary(
  inspection: SummaryRow | DetailRow,
  responses: readonly { answer: InspectionAnswer }[],
  total: number,
): InspectionSummaryDto {
  return {
    id: inspection.id,
    outletId: inspection.outletId,
    outletName: inspection.outlet.name,
    outletAddress: [inspection.outlet.address, inspection.outlet.city].filter(Boolean).join(', ') || null,
    organizationName: inspection.outlet.organization.name,
    status: stage(inspection),
    date: inspection.startedAt
      ? indiaDate(inspection.conductedAt)
      : fromDbDate(inspection.plannedDate ?? inspection.conductedAt),
    supervisorId: inspection.supervisor.id,
    supervisorName: inspection.supervisor.name,
    answered: responses.length,
    total,
    overallScore: inspection.overallScore,
    grade: (inspection.grade as InspectionGrade | null) ?? null,
    nonCompliant: responses.filter((response) => response.answer === 'NON_COMPLIANT').length,
    reportNumber: inspection.reportNumber,
    completedAt: inspection.completedAt?.toISOString() ?? null,
    approvedAt: inspection.approvedAt?.toISOString() ?? null,
  };
}
