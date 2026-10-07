import { randomUUID } from 'node:crypto';
import { existsSync } from 'node:fs';
import { Injectable, Logger, NotFoundException, ServiceUnavailableException } from '@nestjs/common';
import { VISIT_SLOTS, visitSlotWindow, type LocalizedText } from '@eccs/shared';
import puppeteer from 'puppeteer-core';
import { env } from '../config/env.js';
import { PrismaService } from '../prisma/prisma.service.js';
import { StorageService } from '../storage/storage.service.js';

// Where a Chromium-based browser is usually installed. The report is laid out as a web
// page and printed to PDF by a browser, so text in any Indian script comes out right.
const BROWSER_PATHS = [
  'C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe',
  'C:\\Program Files (x86)\\Google\\Chrome\\Application\\chrome.exe',
  'C:\\Program Files\\Microsoft\\Edge\\Application\\msedge.exe',
  'C:\\Program Files (x86)\\Microsoft\\Edge\\Application\\msedge.exe',
  '/usr/bin/chromium',
  '/usr/bin/chromium-browser',
  '/usr/bin/google-chrome',
  '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome',
];

const RATING_WORDS = ['Poor', 'Fair', 'Good', 'Very good', 'Excellent'];

const escapeHtml = (text: string) =>
  text.replace(/[&<>"']/g, (char) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[char]!);

const english = (text: unknown) => {
  const localized = (text ?? {}) as LocalizedText;
  return localized.en ?? Object.values(localized)[0] ?? '';
};

const day = (date: Date) =>
  new Intl.DateTimeFormat('en-IN', { timeZone: 'UTC', weekday: 'long', day: 'numeric', month: 'long', year: 'numeric' }).format(date);

const moment = (date: Date) =>
  new Intl.DateTimeFormat('en-IN', {
    timeZone: 'Asia/Kolkata',
    day: 'numeric',
    month: 'short',
    year: 'numeric',
    hour: 'numeric',
    minute: '2-digit',
  }).format(date);

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
  ) {}

  private get db() {
    return this.prisma.client;
  }

  /**
   * The attachment holding the visit's report PDF, made now if it does not
   * exist yet. Only a signed-off visit has one: before that the report can
   * still change.
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
                items: { where: { isActive: true, outletId: null }, orderBy: { position: 'asc' }, select: { id: true, label: true } },
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
    if (!visit || visit.status !== 'APPROVED' || !visit.serviceReport || !visit.signOff) {
      throw new NotFoundException('The report is ready as a PDF once the visit has been signed off');
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

    const row = (label: string, value: string | null | undefined) =>
      value ? `<tr><th>${escapeHtml(label)}</th><td>${escapeHtml(value)}</td></tr>` : '';
    const gallery = (kind: 'BEFORE' | 'AFTER', title: string) => {
      const shown = photos.filter((photo) => photo.kind === kind);
      if (shown.length === 0) return '';
      return `<h2>${title}</h2><div class="photos">${shown.map((photo) => `<img src="${photo.src}" alt="">`).join('')}</div>`;
    };
    const tasks = (visit.serviceType.checklistTemplate?.items ?? [])
      .map((item) => {
        const answer = answers.get(item.id);
        const done = answer?.valueBool === true;
        return `<tr><td class="mark ${done ? 'done' : 'not'}">${done ? '✓' : '✗'}</td><td>${escapeHtml(english(item.label))}${
          !done ? `<div class="reason">Not done${answer?.note ? `: ${escapeHtml(answer.note)}` : ''}</div>` : ''
        }</td></tr>`;
      })
      .join('');

    const html = `<!doctype html><html lang="en"><head><meta charset="utf-8"><style>
      @page { size: A4; margin: 16mm 14mm; }
      * { box-sizing: border-box; }
      body { font-family: "Noto Sans", "Nirmala UI", "Segoe UI", Arial, sans-serif; font-size: 11pt; color: #11181c; margin: 0; }
      header { display: flex; justify-content: space-between; align-items: flex-start; border-bottom: 2px solid #0b7a6e; padding-bottom: 10px; }
      .company { font-size: 18pt; font-weight: 700; color: #0b7a6e; }
      .muted { color: #5b6770; font-size: 9.5pt; }
      .title { text-align: right; }
      .title b { font-size: 15pt; }
      h2 { font-size: 12pt; margin: 18px 0 6px; color: #0b7a6e; }
      table { width: 100%; border-collapse: collapse; }
      .facts th { text-align: left; font-weight: 600; color: #5b6770; width: 32%; padding: 3px 8px 3px 0; vertical-align: top; }
      .facts td { padding: 3px 0; }
      .tasks td { padding: 5px 6px; border-bottom: 1px solid #d5dbdf; vertical-align: top; }
      .mark { width: 22px; font-weight: 700; }
      .done { color: #0b7a6e; } .not { color: #c62828; }
      .reason { color: #c62828; font-size: 10pt; }
      .photos { display: grid; grid-template-columns: repeat(3, 1fr); gap: 6px; }
      .photos img { width: 100%; aspect-ratio: 4 / 3; object-fit: cover; border-radius: 4px; }
      .box { border: 1px solid #0b7a6e; border-radius: 6px; padding: 10px 12px; break-inside: avoid; }
      .stars { color: #b45309; font-size: 14pt; letter-spacing: 2px; }
      p { margin: 4px 0; white-space: pre-wrap; }
      h2, .tasks tr { break-after: avoid; } .tasks tr { break-inside: avoid; }
      footer { margin-top: 22px; border-top: 1px solid #d5dbdf; padding-top: 6px; }
    </style></head><body>
      <header>
        <div>
          <div class="company">ECCS</div>
          <div class="muted">Eosfera Commercial Cleaning Services, Hyderabad<br>${escapeHtml(env.SUPPORT_PHONE)}</div>
        </div>
        <div class="title"><b>Service report</b><br>${escapeHtml(number)}</div>
      </header>

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
    </body></html>`;

    const pdf = await this.print(html);
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

  /** Makes it in the background, for example right after sign-off. A failure is logged, not shown. */
  ensureLater(visitId: string): void {
    this.ensure(visitId).catch((error) => this.logger.warn(`Could not make the report PDF for visit ${visitId}: ${String(error)}`));
  }

  /** Lays the page out in a browser without a window and prints it to PDF. */
  private async print(html: string): Promise<Buffer> {
    const executablePath = env.PDF_BROWSER_PATH ?? BROWSER_PATHS.find((path) => existsSync(path));
    if (!executablePath) {
      throw new ServiceUnavailableException('PDF reports are not set up on this server yet');
    }
    const browser = await puppeteer.launch({ executablePath, headless: true, args: ['--no-sandbox', '--disable-gpu'] });
    try {
      const page = await browser.newPage();
      await page.setContent(html, { waitUntil: 'load' });
      return Buffer.from(await page.pdf({ format: 'A4', printBackground: true, preferCSSPageSize: true }));
    } finally {
      await browser.close();
    }
  }
}
