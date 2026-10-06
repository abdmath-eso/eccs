import { BadRequestException, ForbiddenException, Injectable, NotFoundException } from '@nestjs/common';
import type { Prisma } from '@eccs/db';
import {
  accessScope,
  can,
  isEccsRole,
  LICENCE_WARNING_DAYS,
  type Action,
  type DocumentCategory,
  type DocumentDto,
  type LicenceDto,
  type LicenceState,
  type LicenceType,
  type Resource,
} from '@eccs/shared';
import type { AuthUser } from '../auth/auth.types.js';
import { indiaDate } from '../checklists/checklists.service.js';
import { PrismaService } from '../prisma/prisma.service.js';
import { StorageService } from '../storage/storage.service.js';

const licenceInclude = {
  outlet: { select: { name: true, organizationId: true, organization: { select: { name: true } } } },
  document: { include: { attachment: true } },
} as const satisfies Prisma.LicenceInclude;

const documentInclude = { attachment: true } as const satisfies Prisma.DocumentInclude;

type LicenceRow = Prisma.LicenceGetPayload<{ include: typeof licenceInclude }>;
type DocumentRow = Prisma.DocumentGetPayload<{ include: typeof documentInclude }>;

const DEFAULT_NAMES: Record<LicenceType, string> = {
  FSSAI: 'FSSAI licence',
  FIRE_NOC: 'Fire NOC',
  TRADE_LICENCE: 'Trade licence',
  PEST_CONTROL: 'Pest control contract',
  OTHER: 'Licence',
};

const toDbDate = (date: string) => new Date(`${date}T00:00:00.000Z`);
const fromDbDate = (date: Date) => date.toISOString().slice(0, 10);

/** Licences with expiry dates, and the document vault, for each outlet. */
@Injectable()
export class LicencesService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly storage: StorageService,
  ) {}

  private get db() {
    return this.prisma.client;
  }

  // ───────────────────────── Licences ─────────────────────────

  /**
   * Licences the user may see, soonest expiry first. `attentionOnly` keeps
   * just those expired or expiring within the warning period.
   */
  async listLicences(
    user: AuthUser,
    filter: { outletId?: string | undefined; attentionOnly: boolean },
  ): Promise<LicenceDto[]> {
    const where = await this.outletScope(user, 'licences');
    if (!where) return [];

    const today = indiaDate();
    const cutoff = new Date(toDbDate(today).getTime() + LICENCE_WARNING_DAYS * 86_400_000);
    const licences = await this.db.licence.findMany({
      where: {
        outlet: where,
        ...(filter.outletId && { outletId: filter.outletId }),
        ...(filter.attentionOnly && { expiresOn: { lte: cutoff } }),
      },
      include: licenceInclude,
      orderBy: { expiresOn: 'asc' },
    });
    return licences.map((licence) => this.toLicenceDto(licence, today));
  }

  async createLicence(
    user: AuthUser,
    input: {
      outletId: string;
      type: LicenceType;
      name?: string | undefined;
      number?: string | undefined;
      issuedOn?: string | undefined;
      expiresOn: string;
      attachmentId?: string | undefined;
    },
  ): Promise<LicenceDto> {
    await this.requireOutlet(user, 'licences', 'create', input.outletId);
    const name = input.name ?? DEFAULT_NAMES[input.type];
    const documentId = input.attachmentId
      ? await this.fileDocument(user, input.outletId, input.attachmentId, 'licence', name)
      : null;

    const licence = await this.db.licence.create({
      data: {
        outletId: input.outletId,
        type: input.type,
        name,
        number: input.number ?? null,
        issuedOn: input.issuedOn ? toDbDate(input.issuedOn) : null,
        expiresOn: toDbDate(input.expiresOn),
        documentId,
      },
      include: licenceInclude,
    });
    return this.toLicenceDto(licence, indiaDate());
  }

  /** Updates a licence, typically after renewal: a new expiry date and a new copy of the document. */
  async updateLicence(
    user: AuthUser,
    licenceId: string,
    input: {
      name?: string | undefined;
      number?: string | undefined;
      issuedOn?: string | undefined;
      expiresOn?: string | undefined;
      attachmentId?: string | undefined;
    },
  ): Promise<LicenceDto> {
    const existing = await this.requireLicence(user, 'update', licenceId);
    const name = input.name ?? existing.name ?? DEFAULT_NAMES[existing.type];
    const documentId = input.attachmentId
      ? await this.fileDocument(user, existing.outletId, input.attachmentId, 'licence', name)
      : undefined;

    const licence = await this.db.licence.update({
      where: { id: licenceId },
      data: {
        ...(input.name !== undefined && { name: input.name }),
        ...(input.number !== undefined && { number: input.number }),
        ...(input.issuedOn !== undefined && { issuedOn: toDbDate(input.issuedOn) }),
        ...(input.expiresOn !== undefined && { expiresOn: toDbDate(input.expiresOn) }),
        // The earlier copy stays in the vault as a record; the licence points at the new one.
        ...(documentId !== undefined && { documentId }),
      },
      include: licenceInclude,
    });
    return this.toLicenceDto(licence, indiaDate());
  }

  /** Removes a licence entry. Its document, if any, stays in the vault. */
  async removeLicence(user: AuthUser, licenceId: string): Promise<void> {
    await this.requireLicence(user, 'update', licenceId);
    await this.db.licence.delete({ where: { id: licenceId } });
  }

  // ───────────────────────── Document vault ─────────────────────────

  async listDocuments(user: AuthUser, outletId: string): Promise<DocumentDto[]> {
    await this.requireOutlet(user, 'documents', 'read', outletId);
    const documents = await this.db.document.findMany({
      where: { outletId },
      include: documentInclude,
      orderBy: { createdAt: 'desc' },
    });

    const uploaderIds = [...new Set(documents.map((d) => d.uploadedById).filter((id): id is string => id !== null))];
    const uploaders = uploaderIds.length
      ? await this.db.user.findMany({
          where: { id: { in: uploaderIds } },
          select: { id: true, name: true, memberships: { select: { role: true } } },
        })
      : [];
    const byId = new Map(uploaders.map((uploader) => [uploader.id, uploader]));

    return documents.map((document) => {
      const uploader = document.uploadedById ? byId.get(document.uploadedById) : undefined;
      return {
        ...this.toDocumentBase(document),
        uploadedByName: uploader?.name ?? null,
        uploadedByEccs: uploader?.memberships.some((m) => isEccsRole(m.role)) ?? false,
      };
    });
  }

  async createDocument(
    user: AuthUser,
    input: { outletId: string; category: Exclude<DocumentCategory, 'licence'>; title: string; attachmentId: string },
  ): Promise<DocumentDto[]> {
    await this.requireOutlet(user, 'documents', 'create', input.outletId);
    await this.fileDocument(user, input.outletId, input.attachmentId, input.category, input.title);
    return this.listDocuments(user, input.outletId);
  }

  /** Removes a document from the vault. A licence that pointed at it keeps its details but loses the file. */
  async removeDocument(user: AuthUser, documentId: string): Promise<DocumentDto[]> {
    const document = await this.db.document.findUnique({ where: { id: documentId } });
    if (!document) throw new NotFoundException('Document not found');
    await this.requireOutlet(user, 'documents', 'update', document.outletId, true);

    await this.db.$transaction([
      this.db.licence.updateMany({ where: { documentId }, data: { documentId: null } }),
      this.db.document.delete({ where: { id: documentId } }),
    ]);
    return this.listDocuments(user, document.outletId);
  }

  // ───────────────────────── Helpers ─────────────────────────

  /** Turns an uploaded file into a vault document for the outlet and returns the document's id. */
  private async fileDocument(
    user: AuthUser,
    outletId: string,
    attachmentId: string,
    category: DocumentCategory,
    title: string,
  ): Promise<string> {
    // Only a file this person uploaded for this outlet as a document, not already filed.
    const attachment = await this.db.attachment.findFirst({
      where: { id: attachmentId, outletId, uploadedById: user.id, kind: 'DOCUMENT', documents: { none: {} } },
    });
    if (!attachment) throw new BadRequestException('The file could not be attached. Upload it again.');

    const document = await this.db.document.create({
      data: { outletId, category, title, attachmentId, uploadedById: user.id },
    });
    return document.id;
  }

  /** Which outlets the user may see for a resource, as a database filter; null if none. */
  private async outletScope(user: AuthUser, resource: Resource): Promise<Prisma.OutletWhereInput | null> {
    const scope = accessScope(user.memberships, resource);
    if (!scope) return null;
    if (scope.kind === 'all') return {};
    if (scope.kind === 'assigned') return { jobs: { some: { supervisorId: user.id } } };
    return { OR: [{ organizationId: { in: scope.organizationIds } }, { id: { in: scope.outletIds } }] };
  }

  /** Checks the user may do this at the outlet. "Not found" and "not yours" look the same. */
  private async requireOutlet(user: AuthUser, resource: Resource, action: Action, outletId: string, asNotFound = false) {
    const outlet = await this.db.outlet.findUnique({ where: { id: outletId }, select: { id: true, organizationId: true } });
    let allowed =
      outlet !== null && can(user.memberships, resource, action, { organizationId: outlet.organizationId, outletId });
    // A Supervisor is limited to outlets where they have visits assigned.
    if (allowed && accessScope(user.memberships, resource)?.kind === 'assigned') {
      allowed = (await this.db.job.count({ where: { outletId, supervisorId: user.id } })) > 0;
    }
    if (!allowed) {
      throw asNotFound ? new NotFoundException('Not found') : new ForbiddenException('You cannot do this at this outlet');
    }
  }

  private async requireLicence(user: AuthUser, action: Action, licenceId: string): Promise<LicenceRow> {
    const licence = await this.db.licence.findUnique({ where: { id: licenceId }, include: licenceInclude });
    if (!licence) throw new NotFoundException('Licence not found');
    await this.requireOutlet(user, 'licences', action, licence.outletId, true);
    return licence;
  }

  private toLicenceDto(licence: LicenceRow, today: string): LicenceDto {
    const daysLeft = Math.round((licence.expiresOn.getTime() - toDbDate(today).getTime()) / 86_400_000);
    const state: LicenceState = daysLeft < 0 ? 'EXPIRED' : daysLeft <= LICENCE_WARNING_DAYS ? 'EXPIRING' : 'VALID';
    const attachment = licence.document?.attachment;
    return {
      id: licence.id,
      outletId: licence.outletId,
      outletName: licence.outlet.name,
      organizationName: licence.outlet.organization.name,
      type: licence.type,
      name: licence.name,
      number: licence.number,
      issuedOn: licence.issuedOn ? fromDbDate(licence.issuedOn) : null,
      expiresOn: fromDbDate(licence.expiresOn),
      daysLeft,
      state,
      file: attachment ? { path: this.storage.signedPath(attachment.id), mimeType: attachment.mimeType } : null,
    };
  }

  private toDocumentBase(document: DocumentRow): Omit<DocumentDto, 'uploadedByName' | 'uploadedByEccs'> {
    return {
      id: document.id,
      outletId: document.outletId,
      category: document.category as DocumentCategory,
      title: document.title,
      file: { path: this.storage.signedPath(document.attachment.id), mimeType: document.attachment.mimeType },
      createdAt: document.createdAt.toISOString(),
    };
  }
}
