import { CYCLE_WORDS, type PublicQuoteDto } from '@eccs/shared';
import { escapeHtml, REPORT_COLORS, reportPage } from '../pdf/report-page.js';

// A quote as a PDF (20 Oct 2026, the console plan's Quotes tab): the same content as the
// quote's public page (apps/web/src/lib/quote-page.ts), in the family look of ECCS's report
// PDFs, for a BDE to attach or print beside the WhatsApp link. Keep the two in step: what
// the owner reads on the page and in the PDF must be the same quote in the same words.

const rupees = (paise: number) =>
  new Intl.NumberFormat('en-IN', { style: 'currency', currency: 'INR', minimumFractionDigits: 2, maximumFractionDigits: 2 }).format(paise / 100);

const day = (date: string) => new Intl.DateTimeFormat('en-IN-u-nu-latn', { day: 'numeric', month: 'long', year: 'numeric', timeZone: 'UTC' }).format(new Date(`${date}T00:00:00.000Z`));

const STYLES = `
  .lines { margin-top: 6px; font-size: 10.5pt; }
  .lines th, .lines td { padding: 6px 4px; border-bottom: 1px solid ${REPORT_COLORS.line}; text-align: left; vertical-align: top; }
  .lines th { color: ${REPORT_COLORS.muted}; font-weight: 600; }
  .lines .n { text-align: right; white-space: nowrap; }
  .lines tfoot td { border-bottom: 0; padding: 3px 4px; }
  .lines tfoot tr.total td { border-top: 2px solid ${REPORT_COLORS.text}; font-weight: 700; font-size: 12pt; padding-top: 6px; }
  .draft { border: 2px dashed ${REPORT_COLORS.warning}; color: ${REPORT_COLORS.warning}; border-radius: 6px; padding: 6px 10px; margin-top: 12px; font-weight: 600; }
  .caveat { color: ${REPORT_COLORS.warning}; }
`;

/** The quote's page as a PDF. A draft says so at the top: it has not been offered yet. */
export function quotePdfHtml(quote: PublicQuoteDto, draft: boolean): string {
  const rows = quote.lines
    .map(
      (line) => `<tr>
<td>${escapeHtml(line.name)}${line.cycle ? `<br><span class="muted">${escapeHtml(CYCLE_WORDS[line.cycle])} per kitchen, billed each cycle</span>` : ''}</td>
<td class="n">${line.quantity}</td>
<td class="n">${escapeHtml(rupees(line.unitPaise))}</td>
<td class="n">${escapeHtml(rupees(line.amountPaise))}</td>
</tr>`,
    )
    .join('\n');
  const rate = quote.lines[0]?.gstRatePercent ?? 18;
  const half = quote.lines.every((line) => line.gstRatePercent === rate) ? ` ${rate / 2}%` : '';
  const supplier = quote.supplier;
  const dates = [quote.sentOn && `Sent ${day(quote.sentOn)}`, quote.validUntil && `valid until ${day(quote.validUntil)}`].filter(Boolean).join(' · ');
  const body = `
${draft ? `<p class="draft">Draft: not sent to the owner yet. The prices are today's catalogue.</p>` : ''}
<h2>Quote for ${escapeHtml(quote.businessName)}</h2>
<p>${[quote.contactName && `For ${escapeHtml(quote.contactName)}`, quote.area && escapeHtml(quote.area)].filter(Boolean).join(' · ')}</p>
<p class="muted">${dates ? `${escapeHtml(dates)}. ` : ''}Prepared by ${escapeHtml(quote.preparedBy)} at ECCS.</p>
<h2>What is quoted</h2>
<table class="lines">
<thead><tr><th>Service or plan</th><th class="n">Qty</th><th class="n">Price</th><th class="n">Amount</th></tr></thead>
<tbody>
${rows}
</tbody>
<tfoot>
<tr><td colspan="3">Before GST</td><td class="n">${escapeHtml(rupees(quote.subtotalPaise))}</td></tr>
<tr><td colspan="3">CGST${half}</td><td class="n">${escapeHtml(rupees(quote.cgstPaise))}</td></tr>
<tr><td colspan="3">SGST${half}</td><td class="n">${escapeHtml(rupees(quote.sgstPaise))}</td></tr>
<tr class="total"><td colspan="3">Total</td><td class="n">${escapeHtml(rupees(quote.totalPaise))}</td></tr>
</tfoot>
</table>
<p class="muted">Prices are before GST; the total includes it.${quote.lines.some((line) => line.cycle) ? ' A plan is billed each cycle for every kitchen on it, and its visits come on a fixed schedule.' : ''}</p>
<h2>To go ahead, or ask anything</h2>
<p>Reply to the WhatsApp message this came with, or call ${escapeHtml(supplier.phone)}.</p>
<h2>From</h2>
<p><b>${escapeHtml(supplier.legalName)}</b> (${escapeHtml(supplier.name)})<br>${escapeHtml(supplier.address)}<br>GSTIN ${escapeHtml(supplier.gstin)}</p>
${supplier.isSample ? `<p class="caveat">Sample company details: not yet ECCS's real address and GSTIN.</p>` : ''}`;
  return reportPage({ title: 'Quote', number: quote.number, styles: STYLES, body });
}
