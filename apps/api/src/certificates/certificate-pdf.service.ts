import { randomUUID } from 'node:crypto';
import { Injectable, Logger, NotFoundException } from '@nestjs/common';
import type { LocalizedText } from '@eccs/shared';
import { PdfPrinterService } from '../pdf/pdf-printer.service.js';
import { escapeHtml, factRow as row, moment, REPORT_COLORS, reportFooter, reportPage } from '../pdf/report-page.js';
import { PrismaService } from '../prisma/prisma.service.js';
import { StorageService } from '../storage/storage.service.js';

const TITLE = 'Certificate of service';

const english = (text: unknown) => {
  const localized = (text ?? {}) as LocalizedText;
  return localized.en ?? Object.values(localized)[0] ?? '';
};

/** A calendar day stored as a date, e.g. "7 October 2026". */
const date = (value: Date) =>
  new Intl.DateTimeFormat('en-IN', { timeZone: 'UTC', day: 'numeric', month: 'long', year: 'numeric' }).format(value);

const plural = (count: number, one: string, many: string) => `${count} ${count === 1 ? one : many}`;

// What the certificate adds to the styles every ECCS report shares (src/pdf/report-page.ts).
const STYLES = `
  .lead { text-align: center; margin: 22px 0 6px; }
  .lead .service { font-size: 20pt; font-weight: 700; color: ${REPORT_COLORS.brand}; margin: 4px 0; }
  .lead .place { font-size: 14pt; font-weight: 700; margin: 4px 0 0; }
  .validity { display: flex; border: 2px solid ${REPORT_COLORS.brand}; border-radius: 8px; margin: 16px 0 4px; break-inside: avoid; }
  .validity div { flex: 1; text-align: center; padding: 10px 8px; }
  .validity div + div { border-left: 1px solid ${REPORT_COLORS.line}; }
  .validity span { display: block; color: ${REPORT_COLORS.muted}; font-size: 9.5pt; }
  .validity b { display: block; font-size: 13pt; margin-top: 2px; }
  .work { margin: 0; padding: 0; list-style: none; display: grid; grid-template-columns: 1fr 1fr; gap: 3px 18px; }
  .work li { display: flex; gap: 6px; break-inside: avoid; }
  .work li::before { content: '✓'; color: ${REPORT_COLORS.brand}; font-weight: 700; }
  .nowrap { white-space: nowrap; }
  .statement { border: 1px solid ${REPORT_COLORS.line}; border-left: 4px solid ${REPORT_COLORS.warning}; border-radius: 4px; padding: 9px 12px; margin-top: 16px; break-inside: avoid; }
  .statement b { display: block; margin-bottom: 2px; }
`;

/**
 * Makes the PDF of a service certificate and files it in the outlet's
 * document vault under Certificate. The layout follows what service
 * certificates (pest control treatment certificates and the like) commonly
 * carry: who issued it and its number, the premises, the service and the day
 * it was done, the dates it is valid between, the work done, who did it and
 * who approved it. It says plainly that it is ECCS's own certificate and not a
 * government document. One page; the format is a sample until ECCS supplies
 * its own.
 */
@Injectable()
export class CertificatePdfService {
  private readonly logger = new Logger(CertificatePdfService.name);
  /** PDFs being made right now, so two requests for the same one share the work. */
  private readonly making = new Map<string, Promise<string>>();

  constructor(
    private readonly prisma: PrismaService,
    private readonly storage: StorageService,
    private readonly printer: PdfPrinterService,
  ) {}

  private get db() {
    return this.prisma.client;
  }

  /**
   * The attachment holding the certificate's PDF, made now if it does not
   * exist yet. One PDF per certificate number; asking again returns the same file.
   */
  ensure(certificateId: string): Promise<string> {
    return this.once(certificateId, false);
  }

  /** Makes the PDF again and puts it in place of the one on file, under the same document. */
  remake(certificateId: string): Promise<string> {
    return this.once(certificateId, true);
  }

  /** Makes it in the background, right after the certificate is issued. A failure is logged, not shown. */
  ensureLater(certificateId: string): void {
    this.ensure(certificateId).catch((error) =>
      this.logger.warn(`Could not make the PDF for certificate ${certificateId}: ${String(error)}`),
    );
  }

  private once(certificateId: string, again: boolean): Promise<string> {
    const waiting = this.making.get(certificateId);
    // A fresh copy asked for while one is being made: wait for that one, then make the fresh one.
    if (waiting) return again ? waiting.catch(() => undefined).then(() => this.once(certificateId, true)) : waiting;
    const job = this.make(certificateId, again).finally(() => this.making.delete(certificateId));
    this.making.set(certificateId, job);
    return job;
  }

  private async make(certificateId: string, again: boolean): Promise<string> {
    const certificate = await this.db.certificate.findUnique({
      where: { id: certificateId },
      include: {
        outlet: { include: { organization: { select: { name: true } } } },
        serviceType: {
          select: {
            name: true,
            checklistTemplate: {
              select: { items: { where: { outletId: null }, orderBy: { position: 'asc' }, select: { id: true, label: true } } },
            },
          },
        },
        job: {
          select: {
            supervisorId: true,
            supervisor: { select: { name: true } },
            technicianNames: true,
            reviewedAt: true,
            reviewedById: true,
            taskResponses: { select: { itemId: true, valueBool: true } },
            serviceReport: { select: { number: true } },
          },
        },
      },
    });
    if (!certificate) throw new NotFoundException('Certificate not found');

    const number = certificate.number;
    const storageKey = `outlets/${certificate.outletId}/certificates/${number}.pdf`;
    const existing = await this.db.attachment.findUnique({ where: { storageKey }, select: { id: true } });
    if (existing && !again) return existing.id;

    const visit = certificate.job;
    const approver = visit?.reviewedById
      ? await this.db.user.findUnique({ where: { id: visit.reviewedById }, select: { name: true } })
      : null;
    const service = english(certificate.serviceType.name);
    const outlet = certificate.outlet;
    const address = [outlet.address, outlet.city, outlet.pincode].filter(Boolean).join(', ');

    // The tasks of the visit that were done. A task marked "not done" is on the service
    // report with its reason; the certificate lists only what it can vouch for.
    const done = new Set((visit?.taskResponses ?? []).filter((answer) => answer.valueBool === true).map((answer) => answer.itemId));
    const answered = visit?.taskResponses.length ?? 0;
    const work = (certificate.serviceType.checklistTemplate?.items ?? []).filter((item) => done.has(item.id));
    const reportNumber = visit?.serviceReport?.number ?? null;

    const days = Math.round((certificate.validUntil.getTime() - certificate.validFrom.getTime()) / 86_400_000);

    const body = `
      <div class="lead">
        <p>This is to certify that ECCS carried out</p>
        <p class="service">${escapeHtml(service)}</p>
        <p>at the kitchen of</p>
        <p class="place">${escapeHtml(outlet.name)}</p>
        <p class="muted">${escapeHtml([outlet.organization.name, address].filter(Boolean).join(' · '))}</p>
      </div>

      <div class="validity">
        <div><span>Date of service · valid from</span><b>${date(certificate.validFrom)}</b></div>
        <div><span>Valid until</span><b>${date(certificate.validUntil)}</b></div>
      </div>
      <p class="muted" style="text-align:center">Valid for ${plural(days, 'day', 'days')} from the date of service, up to and including the last date shown.</p>

      <h2>Details</h2>
      <table class="facts">
        ${row('Certificate number', number)}
        ${row('Premises', [outlet.name, address].filter(Boolean).join(', '))}
        ${row('Service report', reportNumber)}
        ${row('Supervisor', visit?.supervisor?.name ? `${visit.supervisor.name}, ECCS` : null)}
        ${row('Team', visit?.technicianNames.join(', '))}
      </table>

      ${
        work.length > 0
          ? `<h2>Work carried out</h2>
             <ul class="work">${work.map((item) => `<li>${escapeHtml(english(item.label))}</li>`).join('')}</ul>
             ${
               answered > work.length && reportNumber
                 ? `<p class="muted">${plural(answered - work.length, 'task was', 'tasks were')} not done on this visit; the reason is in service report ${escapeHtml(reportNumber)}.</p>`
                 : ''
             }`
          : ''
      }

      <h2>Issued by ECCS</h2>
      <div class="box">
        <p><b>${escapeHtml(approver?.name ?? 'ECCS')}</b>${visit?.reviewedAt ? ` · ${moment(visit.reviewedAt)}` : ''}</p>
        <p>Issued after the restaurant signed off the visit and ECCS checked and approved its service report${
          reportNumber ? ` (<span class="nowrap">${escapeHtml(reportNumber)}</span>)` : ''
        }.</p>
        <p class="muted">Approved in the ECCS console under this person's own login.</p>
      </div>

      <div class="statement">
        <b>What this certificate is</b>
        This is ECCS's own certificate of service. It records that the service named above was carried out at these premises on the date shown. It is not a licence, permit, rating or certificate issued by FSSAI or any other government authority, and it does not replace one. It does not certify the condition of the premises after the date of service.
      </div>

      <footer class="muted">Certificate ${escapeHtml(number)} · made on ${moment(new Date())} · Sample format</footer>
    `;

    const pdf = await this.printer.print(reportPage({ title: TITLE, number, styles: STYLES, body }), {
      footer: reportFooter(TITLE, number),
    });
    await this.storage.put(storageKey, pdf, 'application/pdf');

    const filedBy = visit?.reviewedById ?? visit?.supervisorId ?? null;
    // Filed in the restaurant's document vault under Certificate, where their other papers are.
    const document = {
      outletId: certificate.outletId,
      category: 'certificate',
      title: `Certificate ${number}: ${service}, valid until ${date(certificate.validUntil)}`,
      uploadedById: filedBy,
    };

    if (existing) {
      // Made again: the new file has taken the old one's place in storage under the same
      // name, so the attachment and the document in the vault stay the ones they were.
      const filed = await this.db.document.findFirst({ where: { attachmentId: existing.id }, select: { id: true } });
      await this.db.$transaction([
        this.db.attachment.update({ where: { id: existing.id }, data: { sizeBytes: pdf.length, capturedAt: new Date() } }),
        // Put back in the vault if someone had deleted it from there.
        ...(filed ? [] : [this.db.document.create({ data: { ...document, attachmentId: existing.id } })]),
        this.db.certificate.update({ where: { id: certificate.id }, data: { pdfKey: storageKey } }),
      ]);
      return existing.id;
    }

    const id = randomUUID();
    try {
      await this.db.$transaction([
        this.db.attachment.create({
          data: {
            id,
            outletId: certificate.outletId,
            // Tied to the visit like the report PDF; the visit's own photo lists read only BEFORE and AFTER.
            jobId: certificate.jobId,
            kind: 'REPORT',
            storageKey,
            mimeType: 'application/pdf',
            sizeBytes: pdf.length,
            capturedAt: new Date(),
            uploadedById: filedBy,
          },
        }),
        this.db.document.create({ data: { ...document, attachmentId: id } }),
        this.db.certificate.update({ where: { id: certificate.id }, data: { pdfKey: storageKey } }),
      ]);
      return id;
    } catch (error) {
      // Two requests made it at the same moment; the other one's copy is the one on file.
      const other = await this.db.attachment.findUnique({ where: { storageKey }, select: { id: true } });
      if (other) return other.id;
      throw error;
    }
  }
}
