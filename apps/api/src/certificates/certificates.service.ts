import { Injectable, Logger, NotFoundException } from '@nestjs/common';
import type { Prisma } from '@eccs/db';
import {
  accessScope,
  can,
  certificateValidity,
  certificateValidUntil,
  type CertificateDto,
  type LocalizedText,
  type VisitCertificateDto,
} from '@eccs/shared';
import type { AuthUser } from '../auth/auth.types.js';
import { indiaDate } from '../checklists/checklists.service.js';
import { PrismaService } from '../prisma/prisma.service.js';
import { StorageService } from '../storage/storage.service.js';
import { CertificatePdfService } from './certificate-pdf.service.js';

const MAX_LISTED = 300;

// Any fixed number: it names the one lock that issuing a certificate waits for, so two
// certificates are never numbered, or issued for the same visit, at the same moment.
const ISSUE_LOCK = 710_261_007;

const toDbDate = (date: string) => new Date(`${date}T00:00:00.000Z`);
const fromDbDate = (date: Date) => date.toISOString().slice(0, 10);

const certificateInclude = {
  outlet: { select: { name: true, organizationId: true, organization: { select: { name: true } } } },
  serviceType: { select: { code: true, name: true } },
  job: { select: { supervisorId: true, serviceReport: { select: { number: true } } } },
} as const satisfies Prisma.CertificateInclude;

type CertificateRow = Prisma.CertificateGetPayload<{ include: typeof certificateInclude }>;

/** The part of a certificate a visit carries, with where it stands today. */
export function toVisitCertificate(certificate: {
  id: string;
  number: string;
  validFrom: Date;
  validUntil: Date;
}): VisitCertificateDto {
  const validFrom = fromDbDate(certificate.validFrom);
  const validUntil = fromDbDate(certificate.validUntil);
  return {
    id: certificate.id,
    number: certificate.number,
    validFrom,
    validUntil,
    ...certificateValidity(validFrom, validUntil, indiaDate()),
  };
}

/**
 * Service certificates. Some kinds of service (pest control, deep clean,
 * chimney and hood cleaning) end with a numbered certificate that is valid for
 * a set number of days. It is issued when ECCS approves the visit's report,
 * the same moment the report PDF is made, and its own PDF is filed in the
 * outlet's documents.
 *
 * Who may read one follows the "reports" row of the permission table: the
 * restaurant's Owner and Manager for their own outlets, ECCS admins for all,
 * a Supervisor for the visits given to them, and the Head Chef not at all.
 */
@Injectable()
export class CertificatesService {
  private readonly logger = new Logger(CertificatesService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly storage: StorageService,
    private readonly pdfs: CertificatePdfService,
  ) {}

  private get db() {
    return this.prisma.client;
  }

  // ───────────────────────── Issuing ─────────────────────────

  /**
   * Called when ECCS approves a visit's report. Issues the visit's certificate
   * if its kind of service carries one, and starts making the PDF.
   *
   * It never throws: a certificate that could not be issued must not undo or
   * fail the approval. The reason is logged, and `issueForVisit` can simply be
   * called again. The PDF is made in the background; if that fails the
   * certificate is still on record and the PDF is made when someone opens it.
   */
  async issueOnApproval(visitId: string): Promise<void> {
    try {
      const certificateId = await this.issueForVisit(visitId);
      if (certificateId) this.pdfs.ensureLater(certificateId);
    } catch (error) {
      this.logger.warn(`Could not issue the certificate for visit ${visitId}: ${String(error)}`);
    }
  }

  /**
   * The id of the visit's certificate, issued now if it is due and not there
   * yet; null when this visit gets none. One visit never gets two, however
   * many times this is called.
   */
  async issueForVisit(visitId: string): Promise<string | null> {
    const visit = await this.db.job.findUnique({
      where: { id: visitId },
      select: {
        id: true,
        outletId: true,
        serviceTypeId: true,
        status: true,
        reviewedAt: true,
        scheduledDate: true,
        checkInAt: true,
        serviceType: { select: { issuesCertificate: true, certificateValidDays: true } },
      },
    });
    // Only a signed-off visit whose report ECCS has approved, of a kind that carries a certificate.
    if (!visit || visit.status !== 'APPROVED' || !visit.reviewedAt) return null;
    const validDays = visit.serviceType.certificateValidDays;
    if (!visit.serviceType.issuesCertificate || !validDays || validDays < 1) return null;

    // Valid from the day the work was actually done (the day in India the Supervisor
    // checked in), which is the visit's planned date unless it was done on another day.
    const validFrom = visit.checkInAt ? indiaDate(visit.checkInAt) : fromDbDate(visit.scheduledDate);
    const validUntil = certificateValidUntil(validFrom, validDays);

    return this.db.$transaction(async (tx) => {
      // One at a time, until this transaction ends: see ISSUE_LOCK.
      await tx.$executeRawUnsafe(`SELECT pg_advisory_xact_lock(${ISSUE_LOCK})`);

      const existing = await tx.certificate.findFirst({ where: { jobId: visit.id }, select: { id: true } });
      if (existing) return existing.id;

      // The next number of the year, in the style of the report numbers: CERT-2026-00001.
      const prefix = `CERT-${indiaDate().slice(0, 4)}-`;
      const last = await tx.certificate.findFirst({
        where: { number: { startsWith: prefix } },
        orderBy: { number: 'desc' },
        select: { number: true },
      });
      const next = (last ? Number(last.number.slice(prefix.length)) || 0 : 0) + 1;

      const created = await tx.certificate.create({
        data: {
          outletId: visit.outletId,
          serviceTypeId: visit.serviceTypeId,
          jobId: visit.id,
          number: `${prefix}${String(next).padStart(5, '0')}`,
          validFrom: toDbDate(validFrom),
          validUntil: toDbDate(validUntil),
        },
        select: { id: true },
      });
      return created.id;
    });
  }

  // ───────────────────────── Reading ─────────────────────────

  /** The certificates the person may see, the newest first. */
  async list(user: AuthUser, filter: { outletId?: string | undefined }): Promise<CertificateDto[]> {
    const scope = accessScope(user.memberships, 'reports');
    if (!scope) return [];

    let where: Prisma.CertificateWhereInput;
    if (scope.kind === 'all') where = {};
    else if (scope.kind === 'assigned') where = { job: { supervisorId: user.id } };
    else {
      where = {
        OR: [{ outlet: { organizationId: { in: scope.organizationIds } } }, { outletId: { in: scope.outletIds } }],
      };
    }

    const certificates = await this.db.certificate.findMany({
      where: { AND: [where, filter.outletId ? { outletId: filter.outletId } : {}] },
      include: certificateInclude,
      orderBy: [{ validFrom: 'desc' }, { number: 'desc' }],
      take: MAX_LISTED,
    });
    return certificates.map(toDto);
  }

  async get(user: AuthUser, certificateId: string): Promise<CertificateDto> {
    return toDto(await this.require(user, certificateId));
  }

  /** A link to the certificate as a PDF. Makes the PDF first if it is not there yet. */
  async pdf(user: AuthUser, certificateId: string): Promise<{ path: string }> {
    const certificate = await this.require(user, certificateId);
    return { path: this.storage.signedPath(await this.pdfs.ensure(certificate.id)) };
  }

  /**
   * Makes the PDF again from what is on record now and puts it in place of the
   * old one. For ECCS admins: for when a PDF came out wrong, or ECCS's details
   * or the wording of the certificate have changed. The number and the dates
   * do not change. (The controller lets only those who may approve reports in.)
   */
  async remakePdf(user: AuthUser, certificateId: string): Promise<{ path: string }> {
    const certificate = await this.require(user, certificateId);
    return { path: this.storage.signedPath(await this.pdfs.remake(certificate.id)) };
  }

  /** Loads a certificate if the user may see it. "Not found" and "not yours" look the same. */
  private async require(user: AuthUser, certificateId: string): Promise<CertificateRow> {
    const certificate = await this.db.certificate.findUnique({ where: { id: certificateId }, include: certificateInclude });
    if (!certificate) throw new NotFoundException('Certificate not found');
    let allowed = can(user.memberships, 'reports', 'read', {
      organizationId: certificate.outlet.organizationId,
      outletId: certificate.outletId,
    });
    // A Supervisor reads only the certificates of visits given to them.
    if (allowed && accessScope(user.memberships, 'reports')?.kind === 'assigned') {
      allowed = certificate.job?.supervisorId === user.id;
    }
    if (!allowed) throw new NotFoundException('Certificate not found');
    return certificate;
  }
}

function toDto(certificate: CertificateRow): CertificateDto {
  return {
    ...toVisitCertificate(certificate),
    outletId: certificate.outletId,
    outletName: certificate.outlet.name,
    organizationName: certificate.outlet.organization.name,
    serviceCode: certificate.serviceType.code,
    serviceName: certificate.serviceType.name as LocalizedText,
    visitId: certificate.jobId,
    reportNumber: certificate.job?.serviceReport?.number ?? null,
    issuedAt: certificate.createdAt.toISOString(),
    pdfReady: certificate.pdfKey !== null,
  };
}
