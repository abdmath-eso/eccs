// ECCS's legal documents as public web pages: /legal/terms, /legal/privacy,
// /legal/refunds, /legal/dataProcessing, /legal/disclaimer.
//
// Google Play asks for the privacy policy at a public web address as well as inside
// the app (with the way to ask for an account to be deleted), and a payment provider
// asks for the terms and the refund policy the same way. So these pages are plain
// HTML like the customer QR page (public-page.ts, whose styling they share): no
// login, none of the console, no JavaScript, no cookies. The words are the same
// Markdown the app shows and people agree to (LEGAL_DOCUMENTS in packages/shared),
// read by the same parseLegalMarkdown, so the two can never differ. The documents
// are in English for now, so the pages are too.

import { createTranslator } from "@eccs/i18n";
import {
  LEGAL_DOCUMENTS,
  legalPlainText,
  parseLegalMarkdown,
  type LegalBlock,
  type LegalDocument,
  type LegalInline,
} from "@eccs/shared";

import { escapeHtml, pageHeaders, STYLE } from "@/lib/public-page";

/** Where the pages are. Printed in the Play Store listing; keep it lasting. */
export const LEGAL_PAGE_PATH = "/legal";

const t = createTranslator("EN");

const EXTRA_STYLE = `
article h2{margin:1.4rem 0 .4rem}
article h3{margin:1rem 0 .25rem}
ol{margin:.4rem 0;padding-inline-start:1.6rem}
nav{margin-top:2rem;border-top:2px solid #000;padding-top:.75rem}
nav h2{font-size:1rem}
`;

/** The document a link names, ignoring capitals ("/legal/dataprocessing" works too). */
export function findLegalDocument(key: string): LegalDocument | null {
  return LEGAL_DOCUMENTS.find((document) => document.key.toLowerCase() === key.toLowerCase()) ?? null;
}

const inline = (content: readonly LegalInline[]) =>
  content
    .map((run) =>
      run.type === "bold"
        ? `<strong>${escapeHtml(run.text)}</strong>`
        : run.type === "link"
          ? `<a href="${escapeHtml(run.href)}">${escapeHtml(run.text)}</a>`
          : escapeHtml(run.text),
    )
    .join("");

/** The document's blocks as HTML; its title is drawn separately as the page heading. */
const blockHtml = (block: LegalBlock): string => {
  switch (block.type) {
    case "title":
      return "";
    case "h2":
    case "h3":
    case "p":
      return `<${block.type}>${inline(block.content)}</${block.type}>`;
    case "ul":
      return `<ul>${block.items.map((item) => `<li>${inline(item)}</li>`).join("")}</ul>`;
    case "ol":
      return `<ol${block.start === 1 ? "" : ` start="${block.start}"`}>${block.items.map((item) => `<li>${inline(item)}</li>`).join("")}</ol>`;
  }
};

/** "14 October 2026" from a version such as "2026-10-14"; anything else as it is. */
function versionDate(version: string): string {
  const date = new Date(`${version}T00:00:00.000Z`);
  if (Number.isNaN(date.getTime())) return version;
  return new Intl.DateTimeFormat("en-IN-u-nu-latn", { day: "numeric", month: "long", year: "numeric", timeZone: "UTC" }).format(date);
}

/** The list of all five at the foot of each page. The one being read is named, not linked. */
function documentList(current: LegalDocument | null): string {
  const items = LEGAL_DOCUMENTS.map((document) => {
    const title = escapeHtml(t(document.titleKey));
    return document === current
      ? `<li><strong aria-current="page">${title}</strong></li>`
      : `<li><a href="${LEGAL_PAGE_PATH}/${document.key}">${title}</a></li>`;
  }).join("");
  return `<nav aria-label="${escapeHtml(t("legal.list"))}"><h2>${escapeHtml(t("legal.list"))}</h2><ul class="plain">${items}</ul></nav>`;
}

const shell = (title: string, body: string) =>
  `<!doctype html>
<html lang="en-IN" dir="ltr">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width,initial-scale=1">
<meta name="referrer" content="no-referrer">
<title>${escapeHtml(title)} · ${escapeHtml(t("app.name"))}</title>
<style>${STYLE}${EXTRA_STYLE}</style>
</head>
<body><main>${body}
<footer><p class="small">${escapeHtml(t("public.footer"))}</p></footer>
</main></body>
</html>`;

/** One document's page. */
export function renderLegalPage(document: LegalDocument): string {
  const blocks = parseLegalMarkdown(document.markdown);
  const first = blocks[0];
  // The document's own "# " title, or the name it has in the app if it has none.
  const title = first?.type === "title" ? legalPlainText(first.content) : t(document.titleKey);
  const body = `
<header>
<p class="kicker">${escapeHtml(t("app.name"))}</p>
<h1>${escapeHtml(title)}</h1>
<p class="small">${escapeHtml(t("legal.version", { date: versionDate(document.version) }))}</p>
</header>
<article>${blocks.map(blockHtml).join("\n")}</article>
${documentList(document)}`;
  return shell(title, body);
}

/** The page for an address that names no document. */
export function renderLegalNotFound(): string {
  const body = `
<header><p class="kicker">${escapeHtml(t("app.name"))}</p><h1>${escapeHtml(t("legal.notFound"))}</h1></header>
${documentList(null)}`;
  return shell(t("legal.notFound"), body);
}

/**
 * The headers: those of the customer page (nothing loads from anywhere else, nothing is
 * tracked), except that these pages may be found by search engines, like any company's
 * terms and privacy policy.
 */
export function legalPageHeaders(cacheSeconds: number): Record<string, string> {
  const headers = pageHeaders({ cacheSeconds });
  delete headers["X-Robots-Tag"];
  return headers;
}
