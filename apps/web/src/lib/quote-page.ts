// A quote's public page: /q/<token> (15 Oct 2026). What a restaurant owner opens from the
// WhatsApp message a BDE sends: ECCS's company details, what is quoted, the GST and the
// total. Plain HTML like the customer QR page and the legal pages (whose styling it
// shares): no login, none of the console, no JavaScript, no cookies, and not for search
// engines (the robots header and the page's own robots tag both say so). English only,
// as the quote is.
//
// PATTERN FOLLOWED: the online quote of Zoho Books / Zoho CRM and Pipedrive's shared
// documents: the seller and the buyer at the top, one line per item with quantity, price
// and amount, the tax and the total, how long it is valid, and how to reply.

import { CYCLE_WORDS, type PublicQuoteDto } from "@eccs/shared";

import { escapeHtml, pageHeaders, STYLE } from "@/lib/public-page";

const EXTRA_STYLE = `
table{width:100%;border-collapse:collapse;margin:.5rem 0;font-size:1rem}
th,td{padding:.45rem .25rem;border-bottom:1px solid #999;text-align:left;vertical-align:top}
th{font-size:.9rem}
td.n,th.n{text-align:right;white-space:nowrap}
tfoot td{border-bottom:0;padding:.2rem .25rem}
tfoot tr.total td{border-top:2px solid #000;font-weight:800;font-size:1.15rem;padding-top:.5rem}
.preview{border:2px dashed #000;padding:.5rem .7rem;margin:.5rem 0;font-weight:600}
`;

const rupees = (paise: number) =>
  new Intl.NumberFormat("en-IN", { style: "currency", currency: "INR", minimumFractionDigits: 2, maximumFractionDigits: 2 }).format(paise / 100);

const day = (date: string) => new Intl.DateTimeFormat("en-IN-u-nu-latn", { day: "numeric", month: "long", year: "numeric", timeZone: "UTC" }).format(new Date(`${date}T00:00:00.000Z`));

const shell = (title: string, body: string) =>
  `<!doctype html>
<html lang="en-IN" dir="ltr">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width,initial-scale=1">
<meta name="robots" content="noindex, nofollow">
<meta name="referrer" content="no-referrer">
<title>${escapeHtml(title)}</title>
<style>${STYLE}${EXTRA_STYLE}</style>
</head>
<body><main>${body}
<footer><p class="small">ECCS, commercial kitchen cleaning and hygiene, Hyderabad.</p></footer>
</main></body>
</html>`;

/** The quote's page. `preview` is ECCS looking at it: said on the page, and not counted as the owner opening it. */
export function renderQuotePage(quote: PublicQuoteDto, preview: boolean): string {
  const rows = quote.lines
    .map(
      (line) => `<tr>
<td>${escapeHtml(line.name)}${line.cycle ? `<br><span class="small">${escapeHtml(CYCLE_WORDS[line.cycle])} per kitchen, billed each cycle</span>` : ""}</td>
<td class="n">${line.quantity}</td>
<td class="n">${escapeHtml(rupees(line.unitPaise))}</td>
<td class="n">${escapeHtml(rupees(line.amountPaise))}</td>
</tr>`,
    )
    .join("\n");
  const rate = quote.lines[0]?.gstRatePercent ?? 18;
  const sameRate = quote.lines.every((line) => line.gstRatePercent === rate);
  const half = sameRate ? ` ${rate / 2}%` : "";
  const supplier = quote.supplier;
  const body = `
<header>
<p class="kicker">ECCS · Quote ${escapeHtml(quote.number)}</p>
<h1>Quote for ${escapeHtml(quote.businessName)}</h1>
<p class="place">${[quote.contactName && `For ${escapeHtml(quote.contactName)}`, quote.area && escapeHtml(quote.area)].filter(Boolean).join(" · ")}</p>
<p class="small">${quote.sentOn ? `Sent ${escapeHtml(day(quote.sentOn))}` : ""}${quote.validUntil ? ` · valid until ${escapeHtml(day(quote.validUntil))}` : ""}. Prepared by ${escapeHtml(quote.preparedBy)} at ECCS.</p>
</header>
${preview ? `<p class="preview">ECCS preview: opening this page here is not counted as the owner opening it.</p>` : ""}
<section>
<h2>What is quoted</h2>
<table>
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
<p class="small">Prices are before GST; the total includes it.${quote.lines.some((line) => line.cycle) ? " A plan is billed each cycle for every kitchen on it, and its visits come on a fixed schedule." : ""}</p>
</section>
<section>
<h2>To go ahead, or ask anything</h2>
<p>Reply to the WhatsApp message this came with, or call <bdi dir="ltr">${escapeHtml(supplier.phone)}</bdi>.</p>
</section>
<section>
<h2>From</h2>
<p><strong>${escapeHtml(supplier.legalName)}</strong> (${escapeHtml(supplier.name)})<br>${escapeHtml(supplier.address)}<br>GSTIN <bdi dir="ltr">${escapeHtml(supplier.gstin)}</bdi></p>
${supplier.isSample ? `<p class="caveat">Sample company details: not yet ECCS's real address and GSTIN.</p>` : ""}
</section>`;
  return shell(`Quote ${quote.number} · ECCS`, body);
}

/** The page for a link that names no sent quote. */
export function renderQuoteNotFound(unavailable = false): string {
  const body = unavailable
    ? `<header><p class="kicker">ECCS</p><h1>This quote cannot be shown just now</h1></header><p>Please try again in a minute.</p>`
    : `<header><p class="kicker">ECCS</p><h1>This quote is not available</h1></header><p>The link may be mistyped, or the quote has been replaced. Ask the person who sent it for a new link.</p>`;
  return shell("Quote · ECCS", body);
}

/** The customer page's headers (nothing loads from anywhere else, nothing is tracked, not for search engines), never kept by a browser. */
export const quotePageHeaders = () => pageHeaders({ cacheSeconds: 0 });
