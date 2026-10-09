// The customer QR page, as plain HTML.
//
// This page is not part of the console. A diner opens it from a QR code on a
// table, often on an old phone with a weak signal, outdoors. So it is one small
// HTML document with its own few lines of styling: no JavaScript, no fonts or
// other files to download (the phone's own fonts are used, which also cover
// Telugu, Hindi and Urdu), no cookies, no trackers, and nothing from the
// console's login. The words come from the same dictionaries as the app
// (packages/i18n, keys starting "public.").
//
// The look is deliberately plain black on white with large type, so it reads in
// sunlight, and deliberately unlike FSSAI's own hygiene rating: no smiley faces,
// no stars, no 1 to 5 scale, no government colours or emblem.

import { createTranslator, isRightToLeft, LANGUAGE_NAMES, MESSAGES, type Translator } from "@eccs/i18n";
import {
  INSPECTION_GRADE_FROM,
  localize,
  PUBLIC_PAGE_LANGUAGES,
  PUBLIC_PAGE_PATH,
  PUBLIC_PAGE_RULES,
  type PublicPageDto,
  type PublicPageLanguage,
} from "@eccs/shared";

/** Where this web server finds the API. On a hosted server set API_INTERNAL_URL to the API's address inside the network. */
export const API_URL = (process.env.API_INTERNAL_URL ?? process.env.NEXT_PUBLIC_API_URL ?? "http://localhost:4000/v1").replace(/\/+$/, "");

/** What a link's token looks like; anything else is answered without asking the API. */
export const TOKEN_PATTERN = /^[A-Za-z0-9_-]{10,64}$/;

/** How each language is named to the browser, so dates read naturally and screen readers pick the right voice. */
const LOCALE: Record<PublicPageLanguage, string> = { EN: "en-IN", TE: "te-IN", HI: "hi-IN", UR: "ur-IN" };

/**
 * The languages the switch offers: those from the fixed list whose dictionary
 * already holds the page's text. A language appears by itself once translated.
 */
export function offeredLanguages(): PublicPageLanguage[] {
  return PUBLIC_PAGE_LANGUAGES.filter((code) => code === "EN" || MESSAGES[code]["public.none.title"] !== undefined);
}

/**
 * The language to show: the one asked for in the link (`?lang=te`), else the first
 * of the phone's own preferred languages that the page has, else English.
 */
export function chooseLanguage(asked: string | null, acceptLanguage: string | null): PublicPageLanguage {
  const offered = offeredLanguages();
  const find = (code: string | undefined) => offered.find((entry) => entry === code?.trim().slice(0, 2).toUpperCase());
  const fromLink = find(asked ?? undefined);
  if (fromLink) return fromLink;
  for (const part of (acceptLanguage ?? "").split(",")) {
    const match = find(part.split(";")[0]);
    if (match) return match;
  }
  return "EN";
}

const escapeHtml = (text: string) =>
  text.replace(/[&<>"']/g, (character) => `&#${character.charCodeAt(0)};`);

/** Report numbers, phone numbers and licence numbers always read left to right, also inside Urdu. */
const ltr = (text: string) => `<bdi dir="ltr">${escapeHtml(text)}</bdi>`;

// Ordinary digits (0-9) in every language, as in the app.
const dateFormat = (language: PublicPageLanguage, options: Intl.DateTimeFormatOptions) =>
  new Intl.DateTimeFormat(`${LOCALE[language]}-u-nu-latn`, options);

/** "12 September 2026" from "2026-09-12". */
const day = (date: string, language: PublicPageLanguage) =>
  dateFormat(language, { day: "numeric", month: "long", year: "numeric", timeZone: "UTC" }).format(new Date(`${date}T00:00:00.000Z`));

const STYLE = `
*{box-sizing:border-box}
html{color-scheme:light;-webkit-text-size-adjust:100%}
body{margin:0;background:#fff;color:#000;font:18px/1.5 system-ui,-apple-system,"Segoe UI",Roboto,"Noto Sans",sans-serif}
main{max-width:36rem;margin:0 auto;padding:1rem 1rem 3rem}
h1{font-size:1.6rem;line-height:1.25;margin:.25rem 0 0}
h2{font-size:1.15rem;margin:0 0 .5rem}
p{margin:.4rem 0}
a{color:#000}
.kicker{font-weight:700;margin:0}
.place{margin:.15rem 0 0;color:#333}
.notice{border:2px solid #000;padding:.6rem .75rem;margin:1rem 0;font-weight:600}
.langs{display:flex;flex-wrap:wrap;gap:.5rem;margin:1rem 0 0;padding:0;list-style:none}
.langs a,.langs span{display:block;min-width:3rem;padding:.55rem .8rem;border:2px solid #000;text-align:center;text-decoration:none;font-weight:600}
.langs span{background:#000;color:#fff}
section{border-top:2px solid #000;padding:1rem 0 .5rem;margin-top:1rem}
.score{font-size:3.5rem;line-height:1.1;font-weight:800;margin:0}
.grade{font-size:1.4rem;font-weight:700;margin:.2rem 0 .6rem}
.small{font-size:.95rem;color:#333}
ul{margin:.4rem 0;padding-inline-start:1.2rem}
li{margin:.35rem 0}
.plain{list-style:none;padding:0}
.plain li{padding:.5rem 0;border-bottom:1px solid #999}
.photos{display:grid;grid-template-columns:1fr 1fr;gap:.75rem;margin:.75rem 0 0;padding:0;list-style:none}
figure{margin:0}
img{display:block;width:100%;aspect-ratio:4/3;object-fit:cover;background:#ddd}
figcaption{font-size:.95rem;font-weight:600;margin-top:.25rem}
summary{font-weight:700;font-size:1.15rem;padding:.4rem 0;cursor:pointer}
footer{margin-top:1.5rem;border-top:2px solid #000;padding-top:.75rem}
`;

const shell = (language: PublicPageLanguage, title: string, body: string) =>
  `<!doctype html>
<html lang="${LOCALE[language]}" dir="${isRightToLeft(language) ? "rtl" : "ltr"}">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width,initial-scale=1">
<meta name="robots" content="noindex,nofollow">
<meta name="referrer" content="no-referrer">
<title>${escapeHtml(title)}</title>
<style>${STYLE}</style>
</head>
<body><main>${body}</main></body>
</html>`;

/** The row of languages. The current one is marked in words for screen readers (aria-current), not by colour alone. */
function languageSwitch(token: string, language: PublicPageLanguage, t: Translator, suffix = ""): string {
  const offered = offeredLanguages();
  if (offered.length < 2) return "";
  const items = offered
    .map((code) => {
      const name = escapeHtml(LANGUAGE_NAMES[code]);
      return code === language
        ? `<li><span aria-current="true" lang="${LOCALE[code]}">${name}</span></li>`
        : `<li><a href="${PUBLIC_PAGE_PATH}/${encodeURIComponent(token)}${suffix}?lang=${code.toLowerCase()}" lang="${LOCALE[code]}" hreflang="${LOCALE[code]}">${name}</a></li>`;
    })
    .join("");
  return `<nav aria-label="${escapeHtml(t("public.language"))}"><ul class="langs">${items}</ul></nav>`;
}

/** The page for a link with a current result. */
export function renderPage(page: PublicPageDto, token: string, language: PublicPageLanguage): string {
  const t = createTranslator(language);
  const text = (key: Parameters<Translator>[0], params?: Parameters<Translator>[1]) => escapeHtml(t(key, params));
  const { inspection } = page;

  const services = page.services.length
    ? `<ul class="plain">${page.services
        .map(
          (service) =>
            `<li><strong>${escapeHtml(localize(service.name, language))}</strong><br>${escapeHtml(day(service.date, language))}` +
            (service.certificateNumber && service.certificateValidUntil
              ? `<br><span class="small">${t("public.services.cert", { number: "\u0000", date: day(service.certificateValidUntil, language) })
                  .split("\u0000")
                  .map(escapeHtml)
                  .join(ltr(service.certificateNumber))}</span>`
              : "") +
            `</li>`,
        )
        .join("")}</ul>`
    : `<p>${text("public.services.none")}</p>`;

  const photos = page.photos.length
    ? `<section><h2>${text("public.photos.heading")}</h2><p class="small">${text("public.photos.note")}</p><ul class="photos">${page.photos
        .map((photo) => {
          const caption = text(`public.photo.${photo.caption}`);
          return (
            `<li><figure><img src="${PUBLIC_PAGE_PATH}/${encodeURIComponent(token)}/p/${photo.n}" alt="${caption}" width="400" height="300" loading="lazy" decoding="async">` +
            `<figcaption>${caption}<br><span class="small">${text("public.photos.takenOn", { date: day(photo.date, language) })}</span></figcaption></figure></li>`
          );
        })
        .join("")}</ul></section>`
    : "";

  /** A sentence with one number that must stay left to right (a report number, a phone number). */
  const withNumber = (sentence: string, value: string, link?: string) =>
    sentence
      .split("\u0000")
      .map(escapeHtml)
      .join(link ? `<a href="${escapeHtml(link)}">${ltr(value)}</a>` : ltr(value));

  const updated = new Date(page.updatedAt);
  const body = `
<header>
<p class="kicker">${text("public.kicker")}</p>
<h1>${escapeHtml(page.restaurantName)}</h1>
<p class="place">${escapeHtml([page.outletName, page.city].filter(Boolean).join(", "))}</p>
${languageSwitch(token, language, t)}
<p class="notice">${text("public.private")}</p>
</header>

<section>
<h2>${text("public.inspection.heading")}</h2>
<p class="score">${text("public.inspection.score", { score: inspection.score })}</p>
<p class="grade">${text(`public.inspection.grade.${inspection.grade}`)}</p>
<p>${text("public.inspection.by", { date: day(inspection.date, language) })}</p>
<p>${withNumber(t("public.inspection.report", { number: "\u0000" }), inspection.reportNumber)}</p>
<p class="small">${withNumber(t("public.inspection.verify", { phone: "\u0000" }), page.eccsPhone, `tel:${page.eccsPhone.replace(/[^+\d]/g, "")}`)}</p>
<p class="small">${text("public.inspection.until", { date: day(inspection.shownUntil, language) })}</p>
</section>

<section>
<h2>${text("public.self.heading")}</h2>
<p><strong>${page.selfChecks ? text("public.self.line", { done: page.selfChecks.handedIn, days: page.selfChecks.days }) : text("public.self.none")}</strong></p>
<p class="small">${text("public.self.note")}</p>
</section>

<section>
<h2>${text("public.services.heading")}</h2>
${services}
</section>
${photos}
<section>
<h2>${text("public.not.heading")}</h2>
<ul><li>${text("public.not.1")}</li><li>${text("public.not.2")}</li><li>${text("public.not.3")}</li><li>${text("public.not.4")}</li></ul>
</section>

<section>
<h2>${text("public.gov.heading")}</h2>
<p>${text("public.gov.body")}</p>
${page.fssaiNumber ? `<p>${withNumber(t("public.gov.licence", { number: "\u0000" }), page.fssaiNumber)}</p>` : ""}
<p>${text("public.gov.check")}</p>
</section>

<section>
<details>
<summary>${text("public.how.heading")}</summary>
<ul><li>${text("public.how.1")}</li><li>${text("public.how.2")}</li><li>${text("public.how.3", {
    aPlus: INSPECTION_GRADE_FROM.A_PLUS,
    a: INSPECTION_GRADE_FROM.A,
    b: INSPECTION_GRADE_FROM.B,
  })}</li><li>${text("public.how.4", { days: PUBLIC_PAGE_RULES.inspectionValidDays })}</li></ul>
</details>
</section>

<footer>
<p class="small">${text("public.updated", {
    date: dateFormat(language, { day: "numeric", month: "long", year: "numeric", timeZone: "Asia/Kolkata" }).format(updated),
    time: dateFormat(language, { hour: "numeric", minute: "2-digit", timeZone: "Asia/Kolkata" }).format(updated),
  })}</p>
<p class="small">${text("public.footer")}</p>
</footer>`;

  return shell(language, t("public.title", { restaurant: page.restaurantName }), body);
}

/**
 * The one page for every link with nothing to show: unknown, old, switched off,
 * taken down, or past its inspection. It says the same thing in each case, so
 * nobody can learn from it whether a restaurant has a page or why it is not showing.
 * `down` is the different case of our own server not answering.
 */
export function renderNothing(token: string, language: PublicPageLanguage, down = false): string {
  const t = createTranslator(language);
  const body = `
<header>
<p class="kicker">${escapeHtml(t("public.kicker"))}</p>
<h1>${escapeHtml(t("public.none.title"))}</h1>
${TOKEN_PATTERN.test(token) ? languageSwitch(token, language, t) : ""}
</header>
<section>
<p>${escapeHtml(t(down ? "public.down" : "public.none.body"))}</p>
<p class="notice">${escapeHtml(t("public.private"))}</p>
<p>${escapeHtml(t("public.none.gov"))}</p>
</section>
<footer><p class="small">${escapeHtml(t("public.footer"))}</p></footer>`;
  return shell(language, t("public.none.title"), body);
}

/**
 * The small poster the restaurant prints: the QR code, one line, and who is behind
 * it. It carries no restaurant details at all, so it needs nothing from the server
 * and gives nothing away. `qr` is the SVG picture of the code.
 */
export function renderPoster(token: string, language: PublicPageLanguage, qr: string): string {
  const t = createTranslator(language);
  const style = `
.poster{border:3px solid #000;padding:1.5rem 1rem;text-align:center;margin-top:1rem}
.poster svg{width:min(70vw,16rem);height:auto}
.poster h1{font-size:1.5rem;margin:0 0 1rem}
button{font:inherit;font-weight:700;padding:.7rem 1.4rem;border:2px solid #000;background:#000;color:#fff;margin-top:1rem}
@media print{.noprint{display:none}main{padding:0}.poster{border-width:2pt;break-inside:avoid}.poster svg{width:9cm}}
`;
  const body = `
<div class="noprint">${languageSwitch(token, language, t, "/poster")}
<button type="button" onclick="window.print()">${escapeHtml(t("public.poster.print"))}</button></div>
<div class="poster">
<h1>${escapeHtml(t("public.poster.line"))}</h1>
${qr}
<p><strong>${escapeHtml(t("public.poster.scan"))}</strong></p>
<p class="small">${escapeHtml(t("public.poster.by"))}</p>
</div>`;
  return shell(language, t("public.poster.line"), body).replace("</style>", `${style}</style>`);
}

/** The headers every one of these pages is sent with: nothing may load from anywhere else, and nothing is tracked. */
export function pageHeaders(options: { cacheSeconds: number; script?: boolean }): Record<string, string> {
  return {
    "Content-Type": "text/html; charset=utf-8",
    "Cache-Control": options.cacheSeconds > 0 ? `public, max-age=${options.cacheSeconds}` : "no-store",
    // No scripts at all on the page a diner sees; the poster has its one Print button.
    "Content-Security-Policy": `default-src 'none'; img-src 'self'; style-src 'unsafe-inline'; ${options.script ? "script-src 'unsafe-inline'; " : ""}base-uri 'none'; form-action 'none'; frame-ancestors 'none'`,
    "Referrer-Policy": "no-referrer",
    "X-Content-Type-Options": "nosniff",
    "X-Robots-Tag": "noindex, nofollow",
  };
}
