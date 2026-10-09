import { randomUUID } from 'node:crypto';
import { Injectable, Logger, NotFoundException } from '@nestjs/common';
import { amountInWords, calculateGst, ECCS_STATE_CODE, gstStateLabel, type InvoiceBillTo } from '@eccs/shared';
import { env } from '../config/env.js';
import { PdfPrinterService } from '../pdf/pdf-printer.service.js';
import { escapeHtml, moment, REPORT_COLORS, reportFooter, reportPage } from '../pdf/report-page.js';
import { PrismaService } from '../prisma/prisma.service.js';
import { StorageService } from '../storage/storage.service.js';
import { SUPPLIER } from './supplier.js';

const TITLE = 'Tax invoice';

/** A calendar day stored as a date, e.g. "8 October 2026". */
const date = (value: Date) =>
  new Intl.DateTimeFormat('en-IN', { timeZone: 'UTC', day: 'numeric', month: 'long', year: 'numeric' }).format(value);
/** The India day of a moment, e.g. "8 October 2026". */
const dayOf = (value: Date) =>
  new Intl.DateTimeFormat('en-IN', { timeZone: 'Asia/Kolkata', day: 'numeric', month: 'long', year: 'numeric' }).format(value);

/** Paise as rupees with two decimals and Indian digit grouping: 1,23,456.78. */
const money = (paise: number) =>
  new Intl.NumberFormat('en-IN', { minimumFractionDigits: 2, maximumFractionDigits: 2 }).format(paise / 100);
/** A rate without a needless ".0": 9, 2.5. */
const rate = (percent: number) => `${Number(percent.toFixed(2))}%`;
const quantity = (value: number) => String(Number(value.toFixed(3)));

const METHODS: Record<string, string> = {
  upi: 'UPI',
  card: 'Card',
  netbanking: 'Net banking',
  cash: 'Cash',
  cheque: 'Cheque',
  'bank-transfer': 'Bank transfer',
};

// What the invoice adds to the styles every ECCS report shares (src/pdf/report-page.ts).
const STYLES = `
  body { font-size: 9.5pt; }
  .copy { text-align: right; margin: 4px 0 0; }
  .parties { display: grid; grid-template-columns: 1fr 1fr; gap: 10px; margin-top: 12px; }
  .party { border: 1px solid ${REPORT_COLORS.line}; border-radius: 6px; padding: 8px 10px; break-inside: avoid; }
  .party h3 { margin: 0 0 4px; font-size: 8.5pt; text-transform: uppercase; letter-spacing: 0.04em; color: ${REPORT_COLORS.muted}; }
  .party b.name { font-size: 11.5pt; }
  .party p { margin: 2px 0; }
  .party .facts th { width: 44%; padding: 1px 8px 1px 0; }
  .party .facts td { padding: 1px 0; }
  .lines { margin-top: 14px; }
  .lines th, .lines td { border: 1px solid ${REPORT_COLORS.line}; padding: 5px 6px; vertical-align: top; }
  .lines thead th { background: #eef3f2; font-size: 8.5pt; text-align: center; font-weight: 600; }
  .lines td.num, .lines th.num { text-align: right; white-space: nowrap; }
  .lines tfoot td { font-weight: 700; }
  .lines .sub { display: block; color: ${REPORT_COLORS.muted}; font-size: 8pt; font-weight: 400; }
  .after { display: grid; grid-template-columns: 1fr 250px; gap: 14px; margin-top: 12px; align-items: start; }
  .totals td { padding: 3px 0; }
  .totals td:last-child { text-align: right; white-space: nowrap; }
  .totals tr.grand td { border-top: 2px solid ${REPORT_COLORS.brand}; font-size: 12pt; font-weight: 700; padding-top: 6px; }
  .totals tr.due td { font-weight: 700; }
  .words { border: 1px solid ${REPORT_COLORS.line}; border-radius: 6px; padding: 8px 10px; }
  .words span { display: block; color: ${REPORT_COLORS.muted}; font-size: 8.5pt; }
  .stamp { display: inline-block; margin-top: 10px; border: 3px solid; border-radius: 6px; padding: 4px 14px; font-weight: 700; transform: rotate(-4deg); }
  .stamp b { display: block; font-size: 20pt; line-height: 1.1; }
  .stamp.paid { color: ${REPORT_COLORS.brand}; border-color: ${REPORT_COLORS.brand}; }
  .stamp.void { color: ${REPORT_COLORS.danger}; border-color: ${REPORT_COLORS.danger}; }
  .payments th, .payments td { text-align: left; padding: 3px 8px 3px 0; border-bottom: 1px solid ${REPORT_COLORS.line}; }
  .payments th { color: ${REPORT_COLORS.muted}; font-weight: 600; font-size: 8.5pt; }
  .payments td.num, .payments th.num { text-align: right; padding-right: 0; }
  .close { break-inside: avoid; }
  .sign { margin-top: 12px; display: flex; justify-content: flex-end; }
  .sign div { width: 250px; text-align: center; }
  .sign .space { height: 28px; border-bottom: 1px solid ${REPORT_COLORS.text}; margin-bottom: 4px; }
  .terms { margin-top: 8px; }
  footer { margin-top: 8px; font-size: 8pt; }
  h2 { margin-top: 12px; }
`;

/**
 * Makes the PDF of a tax invoice and files it in the outlet's document vault
 * under Invoice.
 *
 * The layout is the one Indian GST invoices commonly use, carrying every
 * particular Rule 46 of the CGST Rules asks for: the heading "Tax invoice";
 * the supplier's name, address and GSTIN; the invoice's number and date; the
 * buyer's name, address, GSTIN and State with its code; the place of supply;
 * for each line its description, SAC, quantity, taxable value, and the rate
 * and amount of each tax (CGST and SGST, or IGST); the total in figures and in
 * words; whether tax is payable on reverse charge; and the signature block of
 * the supplier. Sample format and sample ECCS details (see supplier.ts) until
 * the founder supplies the real ones.
 *
 * The PDF says how the invoice stands (PAID with the date, or VOID), so it is
 * made again whenever that changes: `Invoice.pdfKey` is cleared by whatever
 * changed the invoice, and the next `current()` puts a fresh file in place of
 * the old one, under the same document in the vault.
 */
@Injectable()
export class InvoicePdfService {
  private readonly logger = new Logger(InvoicePdfService.name);
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
   * The attachment holding the invoice's PDF as the invoice stands now: made
   * if there is none, made again if the invoice has changed since, and simply
   * returned otherwise.
   */
  async current(invoiceId: string): Promise<string> {
    // One being made may have started before the latest change: let it finish, then look again.
    const waiting = this.making.get(invoiceId);
    if (waiting) await waiting.catch(() => undefined);
    const started = this.making.get(invoiceId);
    if (started) return started;
    const job = this.make(invoiceId).finally(() => this.making.delete(invoiceId));
    this.making.set(invoiceId, job);
    return job;
  }

  /**
   * Makes it in the background, right after an invoice is raised, paid or
   * made void. A failure is logged, not shown: the PDF is then made when
   * someone opens it. Off under tests, like the timers: each PDF starts a
   * browser, so tests ask for the ones they want by name.
   */
  makeLater(invoiceId: string): void {
    if (env.NODE_ENV === 'test') return;
    this.current(invoiceId).catch((error) =>
      this.logger.warn(`Could not make the PDF for invoice ${invoiceId}: ${String(error)}`),
    );
  }

  private async make(invoiceId: string): Promise<string> {
    const invoice = await this.db.invoice.findUnique({
      where: { id: invoiceId },
      include: {
        organization: { select: { name: true } },
        outlet: { select: { name: true, address: true, city: true, pincode: true } },
        lines: true,
        payments: { where: { status: 'SUCCEEDED' }, orderBy: { paidAt: 'asc' } },
      },
    });
    if (!invoice || !invoice.outletId) throw new NotFoundException('Invoice not found');

    const number = invoice.number;
    // The number has slashes in it, which would read as folders in storage.
    const storageKey = `outlets/${invoice.outletId}/invoices/${number.replaceAll('/', '-')}.pdf`;
    const existing = await this.db.attachment.findUnique({ where: { storageKey }, select: { id: true } });
    if (existing && invoice.pdfKey === storageKey) return existing.id;

    const billTo = (invoice.billTo ?? { name: invoice.organization.name, legalName: null, gstin: null, address: null, stateCode: null }) as unknown as InvoiceBillTo;
    const gst = calculateGst(
      invoice.lines.map((line) => ({ taxablePaise: line.amountPaise, gstRatePercent: line.gstRatePercent })),
      invoice.placeOfSupply ?? ECCS_STATE_CODE,
    );
    const isVoid = invoice.status === 'VOID';
    const isPaid = invoice.status === 'PAID';
    const due = isVoid ? 0 : Math.max(0, invoice.totalPaise - invoice.paidPaise);
    const lastPaid = invoice.payments.at(-1)?.paidAt ?? null;
    const outlet = invoice.outlet;
    const sample = SUPPLIER.isSample ? ' (sample)' : '';

    const fact = (label: string, value: string | null | undefined) =>
      value ? `<tr><th>${escapeHtml(label)}</th><td>${escapeHtml(value)}</td></tr>` : '';

    // CGST and SGST each take a column for a buyer in Telangana; IGST alone for any other State.
    const taxHead = gst.interState
      ? '<th class="num">IGST<span class="sub">rate · amount (₹)</span></th>'
      : '<th class="num">CGST<span class="sub">rate · amount (₹)</span></th><th class="num">SGST<span class="sub">rate · amount (₹)</span></th>';
    const taxCells = (line: (typeof gst.lines)[number]) =>
      gst.interState
        ? `<td class="num">${rate(line.gstRatePercent)}<br>${money(line.igstPaise)}</td>`
        : `<td class="num">${rate(line.gstRatePercent / 2)}<br>${money(line.cgstPaise)}</td><td class="num">${rate(line.gstRatePercent / 2)}<br>${money(line.sgstPaise)}</td>`;
    const taxTotals = gst.interState
      ? `<td class="num">${money(invoice.igstPaise)}</td>`
      : `<td class="num">${money(invoice.cgstPaise)}</td><td class="num">${money(invoice.sgstPaise)}</td>`;

    const stamp = isVoid
      ? `<div class="stamp void"><b>VOID</b>${invoice.voidedAt ? `Cancelled on ${dayOf(invoice.voidedAt)}` : 'Cancelled'}</div>`
      : isPaid
        ? `<div class="stamp paid"><b>PAID</b>${lastPaid ? `Paid in full on ${dayOf(lastPaid)}` : 'Paid in full'}</div>`
        : '';

    const body = `
      <p class="muted copy">Original for recipient</p>

      <div class="parties">
        <div class="party">
          <h3>Supplier</h3>
          <p><b class="name">${escapeHtml(SUPPLIER.legalName)}</b></p>
          <p>${escapeHtml(SUPPLIER.address)}</p>
          <table class="facts">
            ${fact('GSTIN', `${SUPPLIER.gstin}${sample}`)}
            ${fact('State', gstStateLabel(SUPPLIER.stateCode))}
            ${fact('Phone', env.SUPPORT_PHONE)}
          </table>
        </div>
        <div class="party">
          <h3>Invoice</h3>
          <table class="facts">
            ${fact('Invoice number', number)}
            ${fact('Invoice date', date(invoice.issueDate))}
            ${fact('Due date', date(invoice.dueDate))}
            ${fact('Place of supply', gstStateLabel(gst.placeOfSupply))}
            ${fact('For the period', invoice.periodStart && invoice.periodEnd ? `${date(invoice.periodStart)} to ${date(invoice.periodEnd)}` : null)}
            ${fact('Reverse charge', 'No')}
          </table>
        </div>
        <div class="party">
          <h3>Bill to</h3>
          <p><b class="name">${escapeHtml(billTo.legalName || billTo.name)}</b></p>
          ${billTo.legalName && billTo.legalName !== billTo.name ? `<p>${escapeHtml(billTo.name)}</p>` : ''}
          ${billTo.address ? `<p>${escapeHtml(billTo.address)}</p>` : ''}
          <table class="facts">
            ${fact('GSTIN', billTo.gstin ?? 'Not registered / not provided')}
            ${fact('State', gstStateLabel(billTo.stateCode ?? gst.placeOfSupply))}
          </table>
        </div>
        <div class="party">
          <h3>Service at</h3>
          <p><b class="name">${escapeHtml(outlet?.name ?? '')}</b></p>
          <p>${escapeHtml([outlet?.address, outlet?.city, outlet?.pincode].filter(Boolean).join(', '))}</p>
        </div>
      </div>

      <table class="lines">
        <thead>
          <tr>
            <th>#</th>
            <th style="text-align:left">Description</th>
            <th>HSN/SAC</th>
            <th class="num">Qty</th>
            <th class="num">Rate (₹)</th>
            <th class="num">Taxable value (₹)</th>
            ${taxHead}
            <th class="num">Total (₹)</th>
          </tr>
        </thead>
        <tbody>
          ${invoice.lines
            .map(
              (line, index) => `<tr>
                <td class="num">${index + 1}</td>
                <td>${escapeHtml(line.description)}</td>
                <td>${escapeHtml(line.sacCode)}</td>
                <td class="num">${quantity(line.quantity)}</td>
                <td class="num">${money(line.unitPricePaise)}</td>
                <td class="num">${money(line.amountPaise)}</td>
                ${taxCells(gst.lines[index]!)}
                <td class="num">${money(gst.lines[index]!.totalPaise)}</td>
              </tr>`,
            )
            .join('')}
        </tbody>
        <tfoot>
          <tr>
            <td colspan="5" class="num">Total</td>
            <td class="num">${money(invoice.subtotalPaise)}</td>
            ${taxTotals}
            <td class="num">${money(invoice.totalPaise)}</td>
          </tr>
        </tfoot>
      </table>

      <div class="after">
        <div>
          <div class="words"><span>Total amount in words</span><b>${escapeHtml(amountInWords(invoice.totalPaise))}</b></div>
          ${stamp}
          ${isVoid && invoice.voidReason ? `<p><b>Reason:</b> ${escapeHtml(invoice.voidReason)}</p><p class="muted">This invoice has been cancelled. Nothing is payable on it.</p>` : ''}
        </div>
        <table class="totals">
          <tr><td>Taxable value</td><td>₹${money(invoice.subtotalPaise)}</td></tr>
          ${
            gst.interState
              ? `<tr><td>IGST</td><td>₹${money(invoice.igstPaise)}</td></tr>`
              : `<tr><td>CGST</td><td>₹${money(invoice.cgstPaise)}</td></tr><tr><td>SGST</td><td>₹${money(invoice.sgstPaise)}</td></tr>`
          }
          <tr class="grand"><td>Invoice total</td><td>₹${money(invoice.totalPaise)}</td></tr>
          ${invoice.paidPaise > 0 ? `<tr><td>Paid</td><td>₹${money(invoice.paidPaise)}</td></tr>` : ''}
          ${isVoid ? '' : `<tr class="due"><td>Balance due</td><td>₹${money(due)}</td></tr>`}
        </table>
      </div>

      ${
        invoice.payments.length > 0
          ? `<h2>Payments received</h2>
             <table class="payments">
               <thead><tr><th>Date</th><th>How</th><th>Reference</th><th class="num">Amount (₹)</th></tr></thead>
               <tbody>
                 ${invoice.payments
                   .map(
                     (payment) => `<tr>
                       <td>${payment.paidAt ? dayOf(payment.paidAt) : ''}</td>
                       <td>${escapeHtml(METHODS[payment.method] ?? payment.method)}${payment.gateway === 'sample' ? ' (sample payment, no money moved)' : ''}</td>
                       <td>${escapeHtml(payment.reference ?? '')}</td>
                       <td class="num">${money(payment.amountPaise)}</td>
                     </tr>`,
                   )
                   .join('')}
               </tbody>
             </table>`
          : ''
      }

      <div class="close">
      <div class="sign">
        <div>
          <p>For ${escapeHtml(SUPPLIER.legalName)}</p>
          <div class="space"></div>
          <p class="muted">Authorised signatory</p>
        </div>
      </div>

      <div class="terms muted">
        ${isVoid || isPaid ? '' : `<p>Payment is due by ${date(invoice.dueDate)}. Pay in the ECCS app under Invoices, or to ECCS directly quoting the invoice number.</p>`}
        <p>Tax is not payable on reverse charge. Amounts are in Indian rupees.</p>
      </div>

      <footer class="muted">Tax invoice ${escapeHtml(number)} · made on ${moment(new Date())} · Sample format${
        SUPPLIER.isSample ? '. ECCS&#39;s GSTIN and address shown are samples.' : ''
      }</footer>
      </div>
    `;

    const pdf = await this.printer.print(reportPage({ title: TITLE, number, styles: STYLES, body }), {
      footer: reportFooter(TITLE, number),
    });
    await this.storage.put(storageKey, pdf, 'application/pdf');

    // Filed in the restaurant's document vault under Invoice, where their other papers are.
    const document = {
      outletId: invoice.outletId,
      category: 'invoice',
      title: `Tax invoice ${number}${isVoid ? ' (void)' : isPaid ? ' (paid)' : ''}`,
    };
    // Marked as up to date only if the invoice has not changed again while this was being
    // printed; if it has, the next person to open it gets a fresh one.
    const markCurrent = this.db.invoice.updateMany({
      where: { id: invoice.id, updatedAt: invoice.updatedAt },
      data: { pdfKey: storageKey },
    });

    if (existing) {
      // Made again: the new file has taken the old one's place in storage under the same
      // name, so the attachment and the document in the vault stay the ones they were.
      const filed = await this.db.document.findFirst({ where: { attachmentId: existing.id }, select: { id: true } });
      await this.db.$transaction([
        this.db.attachment.update({ where: { id: existing.id }, data: { sizeBytes: pdf.length, capturedAt: new Date() } }),
        // Put back in the vault if someone had deleted it from there; otherwise its title follows the invoice.
        filed
          ? this.db.document.update({ where: { id: filed.id }, data: { title: document.title } })
          : this.db.document.create({ data: { ...document, attachmentId: existing.id } }),
        markCurrent,
      ]);
      return existing.id;
    }

    const id = randomUUID();
    try {
      await this.db.$transaction([
        this.db.attachment.create({
          data: {
            id,
            outletId: invoice.outletId,
            kind: 'DOCUMENT',
            storageKey,
            mimeType: 'application/pdf',
            sizeBytes: pdf.length,
            capturedAt: new Date(),
          },
        }),
        this.db.document.create({ data: { ...document, attachmentId: id } }),
        markCurrent,
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
