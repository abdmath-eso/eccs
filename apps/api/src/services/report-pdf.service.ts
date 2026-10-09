import { randomUUID } from 'node:crypto';
import { Injectable, Logger, NotFoundException } from '@nestjs/common';
import {
  formatReading,
  READING_VERDICT_ENGLISH,
  readingVerdict,
  VISIT_SLOTS,
  visitSlotWindow,
  type LocalizedText,
} from '@eccs/shared';
import { PdfPrinterService } from '../pdf/pdf-printer.service.js';
import { day, escapeHtml, factRow as row, moment, reportFooter, reportPage } from '../pdf/report-page.js';
import { PrismaService } from '../prisma/prisma.service.js';
import { StorageService } from '../storage/storage.service.js';

const RATING_WORDS = ['Poor', 'Fair', 'Good', 'Very good', 'Excellent'];

const english = (text: unknown) => {
  const localized = (text ?? {}) as LocalizedText;
  return localized.en ?? Object.values(localized)[0] ?? '';
};

const clock = (hhmm: string) => {
  const [hours, minutes] = hhmm.split(':').map(Number) as [number, number];
  return new Intl.DateTimeFormat('en-IN', { timeZone: 'UTC', hour: 'numeric', minute: '2-digit' }).format(
    new Date(Date.UTC(2000, 0, 1, hours, minutes)),
  );
};

const slotName = (slot: string | null) => {
  const known = VISIT_SLOTS.find((value) => value === slot);
  if (!known) return null;
  const window = visitSlotWindow(known);
  return window ? `${clock(window.start)} – ${clock(window.end)}` : 'After closing';
};

/**
 * Makes the PDF of a signed-off visit's service report and files it in the
 * outlet's document vault. The format is a sample until ECCS supplies its own.
 */
@Injectable()
export class ReportPdfService {
  private readonly logger = new Logger(ReportPdfService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly storage: StorageService,
    private readonly printer: PdfPrinterService,
  ) {}

  private get db() {
    return this.prisma.client;
  }

  /**
   * The attachment holding the visit's report PDF, made now if it does not
   * exist yet. Only a visit that is signed off and whose report ECCS has
   * approved has one: before that the report can still change.
   */
  async ensure(visitId: string): Promise<string> {
    const visit = await this.db.job.findUnique({
      where: { id: visitId },
      include: {
        outlet: { include: { organization: { select: { name: true } } } },
        serviceType: {
          select: {
            name: true,
            checklistTemplate: {
              select: {
                // Retired tasks are read too: the report lists what this visit answered (see below).
                items: {
                  where: { outletId: null },
                  orderBy: { position: 'asc' },
                  select: { id: true, label: true, type: true, maxValue: true },
                },
              },
            },
          },
        },
        supervisor: { select: { name: true } },
        taskResponses: true,
        attachments: { where: { kind: { in: ['BEFORE', 'AFTER'] } }, orderBy: { createdAt: 'asc' } },
        signOff: true,
        serviceReport: true,
      },
    });
    if (!visit || visit.status !== 'APPROVED' || !visit.reviewedAt || !visit.serviceReport || !visit.signOff) {
      throw new NotFoundException('The PDF is ready once the visit is signed off and ECCS has approved the report');
    }

    const storageKey = `outlets/${visit.outletId}/reports/${visit.serviceReport.number}.pdf`;
    const existing = await this.db.attachment.findUnique({ where: { storageKey }, select: { id: true } });
    if (existing) return existing.id;

    const photos = await Promise.all(
      visit.attachments.map(async (photo) => ({
        kind: photo.kind,
        src: `data:${photo.mimeType};base64,${(await this.storage.getBuffer(photo.storageKey)).toString('base64')}`,
      })),
    );
    const answers = new Map(visit.taskResponses.map((response) => [response.itemId, response]));
    const service = english(visit.serviceType.name);
    const number = visit.serviceReport.number;
    const signOff = visit.signOff;

    const gallery = (kind: 'BEFORE' | 'AFTER', title: string) => {
      const shown = photos.filter((photo) => photo.kind === kind);
      if (shown.length === 0) return '';
      return `<h2>${title}</h2><div class="photos">${shown.map((photo) => `<img src="${photo.src}" alt="">`).join('')}</div>`;
    };
    // Only the tasks this visit answered: one retired in the Catalogue since still belongs
    // on the report, and one added since was never part of this visit.
    const tasks = (visit.serviceType.checklistTemplate?.items ?? [])
      .filter((item) => answers.has(item.id))
      .map((item) => {
        const answer = answers.get(item.id);
        const done = answer?.valueBool === true;
        // A task that records a meter reading (the frying oil test) prints the number and, in
        // words as well as colour, how it stands against its limit.
        const verdict = item.type === 'NUMBER' && done ? readingVerdict(answer?.valueNumber, item.maxValue) : null;
        const reading =
          item.type === 'NUMBER' && done && answer?.valueNumber != null
            ? `<div class="reading ${verdict ? verdict.toLowerCase() : ''}"><b>${formatReading(answer.valueNumber)}%</b>${
                verdict ? ` · ${READING_VERDICT_ENGLISH[verdict]}` : ''
              }${item.maxValue != null ? ` <span class="muted">(limit ${formatReading(item.maxValue)}%)</span>` : ''}</div>`
            : '';
        return `<tr><td class="mark ${done ? 'done' : 'not'}">${done ? '✓' : '✗'}</td><td>${escapeHtml(english(item.label))}${reading}${
          !done ? `<div class="reason">Not done${answer?.note ? `: ${escapeHtml(answer.note)}` : ''}</div>` : ''
        }</td></tr>`;
      })
      .join('');

    // The page's base styles and header are shared with the inspection report (src/pdf/report-page.ts).
    const styles = `
      .tasks td { padding: 5px 6px; border-bottom: 1px solid #d5dbdf; vertical-align: top; }
      .mark { width: 22px; font-weight: 700; }
      .done { color: #0b7a6e; } .not { color: #c62828; }
      .reason { color: #c62828; font-size: 10pt; }
      .reading { font-size: 10.5pt; margin-top: 2px; }
      .reading.within { color: #0b7a6e; } .reading.close { color: #b45309; } .reading.over { color: #c62828; font-weight: 700; }
      .stars { color: #b45309; font-size: 14pt; letter-spacing: 2px; }
      .tasks tr { break-after: avoid; break-inside: avoid; }
    `;
    const body = `
      <h2>Visit</h2>
      <table class="facts">
        ${row('Service', service)}
        ${row('Client', visit.outlet.organization.name)}
        ${row('Outlet', visit.outlet.name)}
        ${row('Address', [visit.outlet.address, visit.outlet.city, visit.outlet.pincode].filter(Boolean).join(', '))}
        ${row('Date', [day(visit.scheduledDate), slotName(visit.scheduledSlot)].filter(Boolean).join(' · '))}
        ${row('Arrived', visit.checkInAt ? moment(visit.checkInAt) : null)}
        ${row('Finished', visit.completedAt ? moment(visit.completedAt) : null)}
        ${row('Supervisor', visit.supervisor?.name)}
        ${row('Team', visit.technicianNames.join(', '))}
        ${row('Partner', visit.partnerName)}
      </table>

      ${tasks ? `<h2>Work done</h2><table class="tasks">${tasks}</table>` : ''}
      ${visit.notes ? `<h2>Notes for the restaurant</h2><p>${escapeHtml(visit.notes)}</p>` : ''}
      ${gallery('BEFORE', 'Before the work')}
      ${gallery('AFTER', 'After the work')}

      <h2>Signed off by the restaurant</h2>
      <div class="box">
        <p><b>${escapeHtml(signOff.signerName)}</b>${signOff.signerRole ? `, ${escapeHtml(signOff.signerRole === 'OWNER' ? 'Owner' : signOff.signerRole === 'MANAGER' ? 'Manager' : signOff.signerRole)}` : ''} · ${moment(signOff.signedAt)}</p>
        ${
          signOff.rating
            ? `<p><span class="stars">${'★'.repeat(signOff.rating)}${'☆'.repeat(5 - signOff.rating)}</span> ${signOff.rating} out of 5 · ${RATING_WORDS[signOff.rating - 1]}</p>`
            : ''
        }
        ${signOff.comment ? `<p>“${escapeHtml(signOff.comment)}”</p>` : ''}
        <p class="muted">Signed off in the ECCS app under this person's own login.</p>
      </div>

      <footer class="muted">Report ${escapeHtml(number)} · made on ${moment(new Date())} · Sample format</footer>
    `;

    const pdf = await this.printer.print(reportPage({ title: 'Service report', number, styles, body }), {
      footer: reportFooter('Service report', number),
    });
    await this.storage.put(storageKey, pdf, 'application/pdf');

    const id = randomUUID();
    try {
      await this.db.$transaction([
        this.db.attachment.create({
          data: {
            id,
            outletId: visit.outletId,
            jobId: visit.id,
            kind: 'REPORT',
            storageKey,
            mimeType: 'application/pdf',
            sizeBytes: pdf.length,
            capturedAt: new Date(),
            uploadedById: visit.supervisorId,
          },
        }),
        // Filed in the restaurant's document vault, where their other papers are.
        this.db.document.create({
          data: {
            outletId: visit.outletId,
            category: 'report',
            title: `Service report ${number}: ${service}, ${day(visit.scheduledDate)}`,
            attachmentId: id,
            uploadedById: visit.supervisorId,
          },
        }),
        this.db.serviceReport.update({ where: { id: visit.serviceReport.id }, data: { pdfKey: storageKey } }),
      ]);
      return id;
    } catch (error) {
      // Two requests made it at the same moment; the other one's copy is the one on file.
      const other = await this.db.attachment.findUnique({ where: { storageKey }, select: { id: true } });
      if (other) return other.id;
      throw error;
    }
  }

  /** Makes it in the background, right after ECCS approves the report. A failure is logged, not shown. */
  ensureLater(visitId: string): void {
    this.ensure(visitId).catch((error) => this.logger.warn(`Could not make the report PDF for visit ${visitId}: ${String(error)}`));
  }
}
