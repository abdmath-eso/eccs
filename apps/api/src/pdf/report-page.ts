import { env } from '../config/env.js';

// What every ECCS report PDF shares: the page size and margins, the fonts, the
// colours, the header with ECCS's name and the report number, and the table of
// facts under it. Each report adds its own styles and body, so the service
// report and the inspection report look like one family. Sample format until
// ECCS supplies its logo, registered address and GSTIN.

/** Noto Sans first, where a server has it, so text typed in any Indian script prints properly. */
export const REPORT_FONTS = '"Noto Sans", "Nirmala UI", "Segoe UI", Arial, sans-serif';

/** A4 margins. The bottom one is deeper: the line with the page number sits in it. */
export const REPORT_MARGIN = { top: '16mm', right: '14mm', bottom: '18mm', left: '14mm' } as const;

export const REPORT_COLORS = { brand: '#0b7a6e', text: '#11181c', muted: '#5b6770', line: '#d5dbdf', danger: '#c62828', warning: '#b45309' } as const;

export const escapeHtml = (text: string) =>
  text.replace(/[&<>"']/g, (char) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[char]!);

/** A calendar day stored as a date, e.g. "Wednesday, 7 October 2026". */
export const day = (date: Date) =>
  new Intl.DateTimeFormat('en-IN', { timeZone: 'UTC', weekday: 'long', day: 'numeric', month: 'long', year: 'numeric' }).format(date);

/** A moment in Indian time, e.g. "7 Oct 2026, 4:15 pm". */
export const moment = (date: Date) =>
  new Intl.DateTimeFormat('en-IN', {
    timeZone: 'Asia/Kolkata',
    day: 'numeric',
    month: 'short',
    year: 'numeric',
    hour: 'numeric',
    minute: '2-digit',
  }).format(date);

/** One line of the facts table; left out when there is nothing to show. */
export const factRow = (label: string, value: string | null | undefined) =>
  value ? `<tr><th>${escapeHtml(label)}</th><td>${escapeHtml(value)}</td></tr>` : '';

const BASE_STYLES = `
  @page { size: A4; margin: ${REPORT_MARGIN.top} ${REPORT_MARGIN.right} ${REPORT_MARGIN.bottom} ${REPORT_MARGIN.left}; }
  * { box-sizing: border-box; }
  body { font-family: ${REPORT_FONTS}; font-size: 11pt; color: ${REPORT_COLORS.text}; margin: 0; }
  header { display: flex; justify-content: space-between; align-items: flex-start; border-bottom: 2px solid ${REPORT_COLORS.brand}; padding-bottom: 10px; }
  .company { font-size: 18pt; font-weight: 700; color: ${REPORT_COLORS.brand}; }
  .muted { color: ${REPORT_COLORS.muted}; font-size: 9.5pt; }
  .title { text-align: right; }
  .title b { font-size: 15pt; }
  h2 { font-size: 12pt; margin: 18px 0 6px; color: ${REPORT_COLORS.brand}; break-after: avoid; }
  table { width: 100%; border-collapse: collapse; }
  .facts th { text-align: left; font-weight: 600; color: ${REPORT_COLORS.muted}; width: 32%; padding: 3px 8px 3px 0; vertical-align: top; }
  .facts td { padding: 3px 0; }
  .box { border: 1px solid ${REPORT_COLORS.brand}; border-radius: 6px; padding: 10px 12px; break-inside: avoid; }
  .photos { display: grid; grid-template-columns: repeat(3, 1fr); gap: 6px; }
  .photos img { width: 100%; aspect-ratio: 4 / 3; object-fit: cover; border-radius: 4px; }
  p { margin: 4px 0; white-space: pre-wrap; }
  footer { margin-top: 22px; border-top: 1px solid ${REPORT_COLORS.line}; padding-top: 6px; }
`;

/**
 * A whole report page: the shared styles and header, then the report's own
 * styles and body. `title` is the kind of report ("Service report"), `number`
 * its report number; both are printed at the top right.
 */
export function reportPage(report: { title: string; number: string; styles?: string; body: string }): string {
  return `<!doctype html><html lang="en"><head><meta charset="utf-8"><title>${escapeHtml(report.title)} ${escapeHtml(report.number)}</title><style>
    ${BASE_STYLES}
    ${report.styles ?? ''}
  </style></head><body>
    <header>
      <div>
        <div class="company">ECCS</div>
        <div class="muted">Eosfera Commercial Cleaning Services, Hyderabad<br>${escapeHtml(env.SUPPORT_PHONE)}</div>
      </div>
      <div class="title"><b>${escapeHtml(report.title)}</b><br>${escapeHtml(report.number)}</div>
    </header>
    ${report.body}
  </body></html>`;
}

/** The line repeated at the foot of every page of a report. */
export const reportFooter = (title: string, number: string) => `${title} ${number} · Sample format`;
