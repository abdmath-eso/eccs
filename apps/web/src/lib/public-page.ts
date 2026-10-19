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
// The order of the page (13 Oct 2026) follows how public hygiene results are
// shown elsewhere, and what a private scheme has to say about itself:
// - The score comes first, on the first screen, with the day it is for: the way the
//   UK Food Standards Agency's page for a business opens with the rating and its date,
//   and only then the areas it is made of. (The first version put a long disclaimer box
//   above it; the founder, on a phone, had to scroll for "the main part".)
// - The disclaimer stays joined to the score instead of sitting above it: "Not a
//   government rating" in bold over the number, and two full-size sentences in a box
//   directly under it, with a link to the full words at the end of the page. Guidance
//   on disclosures asks for exactly this: as close to the claim as possible, seen
//   without scrolling, in the claim's language, not small print (the US FTC's ".com
//   Disclosures"; India's 2022 guidelines on misleading advertisements; ASCI's rule that
//   a disclaimer be short enough to read, about two lines).
// - A score with no ECCS inspection in it says so above the number, as a named
//   state of its own (New York's "Grade Pending" card, the UK's "awaiting inspection").
// - Then the evidence in the order a diner cares: photos, the daily checklists, ECCS's
//   inspection, ECCS's services. Explanations of how things are worked out are closed
//   lines that open when tapped (the browser's own <details>, which needs no script),
//   so they are there for whoever wants them and nobody else scrolls past them.
//   What the page does NOT cover, and the full disclaimer, are never folded away.
//
// The look is deliberately plain black on white with large type, so it reads in
// sunlight, and deliberately unlike FSSAI's own hygiene rating: no smiley faces,
// no stars, no 1 to 5 scale, no government colours or emblem.

import { createTranslator, isRightToLeft, LANGUAGE_NAMES, MESSAGES, type MessageKey, type Translator } from "@eccs/i18n";
import {
  INSPECTION_GRADE_FROM,
  localize,
  PUBLIC_PAGE_LANGUAGES,
  PUBLIC_PAGE_PATH,
  PUBLIC_PAGE_RULES,
  SCORE_WEIGHTS,
  type PublicCheckResult,
  type PublicPageDto,
  type PublicPageLanguage,
  type PublicPageScoreDto,
} from "@eccs/shared";

/** Where this web server finds the API. On a hosted server set API_INTERNAL_URL to the API's address inside the network. */
export const API_URL = (process.env.API_INTERNAL_URL ?? process.env.NEXT_PUBLIC_API_URL ?? "http://localhost:4000/v1").replace(/\/+$/, "");

/**
 * The visitor's own address, passed on when this server asks the API for a public page. The
 * API limits how often one caller may ask; on a server it trusts this header from inside the
 * network (TRUST_PROXY), so without it every diner would count as this web server.
 */
export function visitorHeaders(request: Request): Record<string, string> {
  const forwarded = request.headers.get("x-forwarded-for");
  return forwarded ? { "X-Forwarded-For": forwarded } : {};
}

/** What a link's token looks like; anything else is answered without asking the API. */
export const TOKEN_PATTERN = /^[A-Za-z0-9_-]{10,64}$/;

/** How each language is named to the browser, so dates read naturally and screen readers pick the right voice. */
const LOCALE: Record<PublicPageLanguage, string> = { EN: "en-IN", TE: "te-IN", HI: "hi-IN", UR: "ur-IN" };

/**
 * The sentences a language must have before the page is offered in it: the
 * disclaimer, and what is said when a score has no ECCS inspection in it. These
 * must never fall back to English in the middle of a page in another language,
 * because a disclaimer has to be in the language of the claim it goes with.
 */
const MUST_BE_TRANSLATED: readonly MessageKey[] = [
  "public.none.title",
  "public.disclaimer.private",
  "public.disclaimer.notGov",
  "public.disclaimer.own",
  "public.disclaimer.short",
  "public.gov.heading",
  "public.score.noInspection.NOT_INSPECTED",
  "public.score.noInspection.NO_CURRENT_RESULT",
  "public.score.noInspection.NOT_IN_THIS_SCORE",
  "public.score.onlyOwn",
];

/**
 * The languages the switch offers: those from the fixed list whose dictionary
 * already holds the page's text. A language appears by itself once translated.
 */
export function offeredLanguages(): PublicPageLanguage[] {
  return PUBLIC_PAGE_LANGUAGES.filter((code) => code === "EN" || MUST_BE_TRANSLATED.every((key) => MESSAGES[code][key] !== undefined));
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

export const escapeHtml = (text: string) =>
  text.replace(/[&<>"']/g, (character) => `&#${character.charCodeAt(0)};`);

/** Report numbers, phone numbers and licence numbers always read left to right, also inside Urdu. */
const ltr = (text: string) => `<bdi dir="ltr">${escapeHtml(text)}</bdi>`;

/**
 * "TG-SAFE" is a name, so it stays on one line and reads left to right. Without this
 * it broke at its hyphen in the narrow disclaimer box, and in Urdu the hyphen moved.
 * Takes text that is already escaped.
 */
const wholeNames = (html: string) => html.replace(/TG-SAFE/g, `<bdi dir="ltr" class="nb">TG-SAFE</bdi>`);

// Ordinary digits (0-9) in every language, as in the app.
const dateFormat = (language: PublicPageLanguage, options: Intl.DateTimeFormatOptions) =>
  new Intl.DateTimeFormat(`${LOCALE[language]}-u-nu-latn`, options);

/** "12 September 2026" from "2026-09-12". */
const day = (date: string, language: PublicPageLanguage) =>
  dateFormat(language, { day: "numeric", month: "long", year: "numeric", timeZone: "UTC" }).format(new Date(`${date}T00:00:00.000Z`));

/** "Monday, 12 October 2026": the day a score or a result is for, with its weekday so nobody has to work it out. */
const weekday = (date: string, language: PublicPageLanguage) =>
  dateFormat(language, { weekday: "long", day: "numeric", month: "long", year: "numeric", timeZone: "UTC" }).format(new Date(`${date}T00:00:00.000Z`));

/** Points as they are: a whole number, or one decimal place when there is one ("51.8"). */
const points = (value: number, language: PublicPageLanguage) =>
  new Intl.NumberFormat(`${LOCALE[language]}-u-nu-latn`, { maximumFractionDigits: 1 }).format(value);

/** The page's own few lines of styling. The public legal pages (legal-page.ts) use them too. */
export const STYLE = `
*{box-sizing:border-box}
html{color-scheme:light;-webkit-text-size-adjust:100%}
body{margin:0;background:#fff;color:#000;font:18px/1.5 system-ui,-apple-system,"Segoe UI",Roboto,"Noto Sans",sans-serif}
main{max-width:36rem;margin:0 auto;padding:1rem 1rem 3rem}
h1{font-size:1.6rem;line-height:1.25;margin:.25rem 0 0}
h2{font-size:1.15rem;margin:0 0 .5rem}
h3{font-size:1rem;margin:1rem 0 .25rem}
p{margin:.4rem 0}
a{color:#000}
.kicker{font-weight:700;margin:0}
.place{margin:.15rem 0 0;color:#333}
.notgov{font-weight:700;margin:0 0 .4rem}
.notice{border:2px solid #000;padding:.5rem .7rem;margin:.75rem 0;font-weight:600}
.notice p{margin:.3rem 0}
.caveat{border:2px solid #000;border-inline-start-width:8px;padding:.5rem .75rem;margin:.6rem 0;font-weight:600}
.langs{display:flex;flex-wrap:wrap;gap:.5rem;margin:.6rem 0 0;padding:0;list-style:none}
.langs a,.langs span{display:block;min-width:2.75rem;padding:.4rem .7rem;border:2px solid #000;text-align:center;text-decoration:none;font-weight:600}
.langs span{background:#000;color:#fff}
section{border-top:2px solid #000;padding:.8rem 0 .4rem;margin-top:.8rem}
section h2+.notgov{margin-top:-.4rem}
.score{font-size:1.5rem;line-height:1.1;font-weight:800;margin:0}
.score .num{font-size:3.5rem}
.grade{font-size:1.4rem;font-weight:700;margin:.2rem 0 .6rem}
.small{font-size:.95rem;color:#333}
ul{margin:.4rem 0;padding-inline-start:1.2rem}
li{margin:.35rem 0}
.plain{list-style:none;padding:0}
.plain li{padding:.5rem 0;border-bottom:1px solid #999}
.part{display:flex;flex-wrap:wrap;justify-content:space-between;gap:.25rem 1rem}
.part b{white-space:nowrap}
.bar{height:.5rem;border:1px solid #000;margin-top:.3rem}
.bar i{display:block;height:100%;background:#000}
.check{display:flex;gap:.75rem;align-items:flex-start}
.check svg{flex:none;width:2rem;height:2rem;border:2px solid #000;padding:.2rem}
.photos{display:grid;grid-template-columns:minmax(0,1fr) minmax(0,1fr);gap:.75rem;margin:.75rem 0 0;padding:0;list-style:none}
.photos li{min-width:0}
figure{margin:0}
img{display:block;width:100%;height:auto;aspect-ratio:4/3;object-fit:cover;background:#ddd}
.nb{white-space:nowrap}
figcaption{font-size:.95rem;font-weight:600;margin-top:.25rem;overflow-wrap:anywhere}
summary{font-weight:700;padding:.55rem 0;cursor:pointer}
details{border-top:1px solid #999}
details:last-of-type{border-bottom:1px solid #999}
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

/**
 * The disclaimer in full: who ECCS is to this restaurant, that it is no part of any
 * government body, and that nothing here is a government rating. These three sentences
 * are under "About this page"; a short form of them ("public.disclaimer.short") sits
 * in a box directly under the score, with a link down to these.
 * "FSSAI", "TG-SAFE" and "ECCS" stay in Latin letters in every language.
 */
const DISCLAIMER = ["public.disclaimer.private", "public.disclaimer.notGov", "public.disclaimer.own"] as const;

/**
 * The picture beside each checklist's result. Four different shapes drawn in black,
 * so the result never depends on colour: a tick, a clock, a cross and a dash. Drawn
 * here as tiny inline pictures, since cheap phones draw symbol characters differently
 * or not at all. The words beside it say the same thing; the picture is skipped by screen readers.
 */
const RESULT_PICTURE: Record<PublicCheckResult, string> = {
  ON_TIME: `<path d="M4 13l5 5L20 6"/>`,
  LATE: `<circle cx="12" cy="12" r="9"/><path d="M12 7v5l4 2"/>`,
  NOT_DONE: `<path d="M5 5l14 14M19 5L5 19"/>`,
  NOT_DUE: `<path d="M5 12h14"/>`,
};
const picture = (result: PublicCheckResult) =>
  `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="3" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true" focusable="false">${RESULT_PICTURE[result]}</svg>`;

/** The page for a link that is showing. */
export function renderPage(page: PublicPageDto, token: string, language: PublicPageLanguage): string {
  const t = createTranslator(language);
  const text = (key: Parameters<Translator>[0], params?: Parameters<Translator>[1]) => escapeHtml(t(key, params));
  const { inspection } = page;

  /** A sentence with one number that must stay left to right (a report number, a phone number). */
  const withNumber = (sentence: string, value: string, link?: string) =>
    sentence
      .split("\u0000")
      .map(escapeHtml)
      .join(link ? `<a href="${escapeHtml(link)}">${ltr(value)}</a>` : ltr(value));
  const phoneLink = `tel:${page.eccsPhone.replace(/[^+\d]/g, "")}`;

  const disclaimer = DISCLAIMER.map((key) => `<p>${wholeNames(text(key))}</p>`).join("");
  // The disclaimer in short, at full size, joined to the score it is about, with a way down to the full words.
  const shortDisclaimer = `<p class="notice" role="note">${wholeNames(text("public.disclaimer.short"))} <a href="#about">${text("public.about.more")}</a></p>`;

  // ── Yesterday's score. What is not in it is said above the number, never under it. ──
  const scoreBlock = (score: PublicPageScoreDto) => {
    const parts = score.parts
      .map((part) => {
        const label = part.key === "inspection" ? "score.part.inspection" : part.key === "licences" ? "score.part.licences" : "public.score.part.checklists";
        const value = part.measured
          ? text("score.points", { earned: points(part.earned, language), max: points(part.max, language) })
          : text("public.score.notCounted");
        // The bar repeats the two numbers as a picture; it adds nothing a screen reader needs.
        const bar = part.measured
          ? `<div class="bar" aria-hidden="true"><i style="width:${Math.max(0, Math.min(100, Math.round((part.earned / part.max) * 100)))}%"></i></div>`
          : "";
        return `<li><div class="part"><span>${text(label)}</span> <b>${value}</b></div>${bar}</li>`;
      })
      .join("");
    const caveat =
      score.provisional && score.inspection !== "COUNTED"
        ? `<p class="caveat">${text(`public.score.noInspection.${score.inspection}`)} ${text("public.score.onlyOwn")}</p>`
        : "";
    return `
<p class="small">${text(score.isYesterday ? "public.score.forYesterday" : "public.score.forEarlier", { date: weekday(score.date, language) })}</p>
${caveat}
<p class="score">${t("public.inspection.score", { score: "\u0000" })
        .split("\u0000")
        .map(escapeHtml)
        // The number is drawn large and the words round it smaller, so "81 out of 100" stays on one line on a narrow phone.
        .join(`<span class="num">${ltr(String(score.score))}</span>`)}</p>
<p class="grade">${text(`score.band.${score.band}`)}</p>
${shortDisclaimer}
<h3>${text("public.score.partsHeading")}</h3>
<ul class="plain">${parts}</ul>`;
  };
  const score = page.score
    ? scoreBlock(page.score)
    : `<p><strong>${text("public.score.none", { days: PUBLIC_PAGE_RULES.scoreWithinDays })}</strong></p>${shortDisclaimer}`;

  // ── The daily checklists: a name, yesterday's result and a count. Never the checks themselves. ──
  const checklists = page.checklists.length
    ? `<p class="small">${text("public.checks.intro", { date: weekday(page.yesterday, language) })}</p><ul class="plain">${page.checklists
        .map(
          (list) =>
            `<li class="check">${picture(list.result)}<div><strong>${escapeHtml(localize(list.name, language))}</strong><br>${text(`public.checks.result.${list.result}`)}` +
            ` <span class="small">· ${text("public.checks.count", { count: list.checks })}</span></div></li>`,
        )
        .join("")}</ul>`
    : `<p>${text("public.checks.none")}</p>`;

  // ── Photos: the pictures first, and how they were chosen in a line under them. ──
  const photos = page.photos.length
    ? `<section><h2>${text("public.photos.heading")}</h2><ul class="photos">${page.photos
        .map((photo) => {
          const caption = text(`public.photo.${photo.caption}`);
          return (
            `<li><figure><img src="${PUBLIC_PAGE_PATH}/${encodeURIComponent(token)}/p/${photo.n}" alt="${caption}" width="400" height="300" loading="lazy" decoding="async">` +
            `<figcaption>${caption}<br><span class="small">${text("public.photos.takenOn", { date: day(photo.date, language) })}<br>${text(`public.photos.by.${photo.by}`)}</span></figcaption></figure></li>`
          );
        })
        .join("")}</ul><p class="small">${text("public.photos.note", { days: PUBLIC_PAGE_RULES.photoShownDays })}</p></section>`
    : "";

  // ── ECCS's own inspection, only while there is an approved one inside its validity. ──
  // The result, whose it is and its number are in view; how it is worked out and how to check it open when tapped.
  const inspected = inspection
    ? `
<section>
<h2>${text("public.inspection.heading")}</h2>
<p class="grade">${text("public.inspection.score", { score: inspection.score })} · ${text(`public.inspection.grade.${inspection.grade}`)}</p>
<p>${text("public.inspection.by", { date: day(inspection.date, language) })}</p>
<p class="small">${withNumber(t("public.inspection.report", { number: "\u0000" }), inspection.reportNumber)}</p>
<details>
<summary>${text("public.how.heading")}</summary>
<ul><li>${text("public.how.1")}</li><li>${text("public.how.2")}</li><li>${text("public.how.3", {
        aPlus: INSPECTION_GRADE_FROM.A_PLUS,
        a: INSPECTION_GRADE_FROM.A,
        b: INSPECTION_GRADE_FROM.B,
      })}</li><li>${text("public.how.4", { days: PUBLIC_PAGE_RULES.inspectionValidDays })}</li></ul>
<p class="small">${text("public.inspection.until", { date: day(inspection.shownUntil, language) })}</p>
<p class="small">${withNumber(t("public.inspection.verify", { phone: "\u0000" }), page.eccsPhone, phoneLink)}</p>
</details>
</section>`
    : "";

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

  const updated = new Date(page.updatedAt);
  const body = `
<header>
<p class="kicker">${text("public.kicker")}</p>
<h1>${escapeHtml(page.restaurantName)}</h1>
<p class="place">${escapeHtml([page.outletName, page.city].filter(Boolean).join(", "))}</p>
${languageSwitch(token, language, t)}
</header>

<section>
<h2>${text("public.score.heading")}</h2>
<p class="notgov">${text("public.gov.heading")}</p>
${score}
</section>
${photos}
<section>
<h2>${text("public.checks.heading")}</h2>
${checklists}
<p><strong>${page.selfChecks ? text("public.self.line", { done: page.selfChecks.handedIn, days: page.selfChecks.days }) : text("public.self.none")}</strong></p>
<p class="small">${text("public.score.selfNote")}</p>
</section>
${inspected}
<section>
<h2>${text("public.services.heading")}</h2>
${services}
</section>

<section id="about">
<h2>${text("public.about.heading")}</h2>
${disclaimer}
<p>${text("public.about.notRating")}</p>
<h3>${text("public.not.heading")}</h3>
<ul><li>${text("public.not.1")}</li><li>${text("public.not.2")}</li><li>${text("public.not.3")}</li><li>${text("public.not.4")}</li></ul>
<details>
<summary>${text("public.score.partsHeading")}</summary>
<p>${text("public.about.score", {
    inspection: SCORE_WEIGHTS.inspection,
    licences: SCORE_WEIGHTS.licences,
    checklists: SCORE_WEIGHTS.checklists,
    days: PUBLIC_PAGE_RULES.inspectionValidDays,
  })}</p>
</details>
<details>
<summary>${text("public.about.checkHeading")}</summary>
${page.fssaiNumber ? `<p>${withNumber(t("public.gov.licence", { number: "\u0000" }), page.fssaiNumber)}</p>` : ""}
<p>${text("public.gov.check")}</p>
<p>${withNumber(t("public.about.verify", { phone: "\u0000" }), page.eccsPhone, phoneLink)}</p>
</details>
</section>

<footer>
<p class="small">${text("public.updated", {
    date: dateFormat(language, { day: "numeric", month: "long", year: "numeric", timeZone: "Asia/Kolkata" }).format(updated),
    time: dateFormat(language, { hour: "numeric", minute: "2-digit", timeZone: "Asia/Kolkata" }).format(updated),
  })}</p>
<p class="small">${text("public.footer")}</p>
${privacyLink(t)}
</footer>`;

  return shell(language, t("public.title", { restaurant: page.restaurantName }), body);
}

/**
 * The one page for every link with nothing to show: unknown, old, switched off,
 * or taken down. It says the same thing in each case, so nobody can learn from it
 * whether a restaurant has a page or why it is not showing. For the same reason it
 * says what ECCS is in general, not that any restaurant has engaged it.
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
<div class="notice" role="note"><p>${escapeHtml(t("public.none.about"))}</p><p>${escapeHtml(t("public.disclaimer.notGov"))}</p></div>
<p>${escapeHtml(t("public.none.gov"))}</p>
</section>
<footer><p class="small">${escapeHtml(t("public.footer"))}</p>${privacyLink(t)}</footer>`;
  return shell(language, t("public.none.title"), body);
}

/** ECCS's Privacy Policy, on its public page (app/legal/[key]/route.ts). */
const privacyLink = (t: Translator) => `<p class="small"><a href="/legal/privacy">${escapeHtml(t("public.privacyLink"))}</a></p>`;

/**
 * The small poster the restaurant prints: the QR code, what scanning it shows, and
 * who is behind it, with the disclaimer in short at full size (not small print). It
 * carries no restaurant details at all, so it needs nothing from the server and
 * gives nothing away. `qr` is the SVG picture of the code.
 */
export function renderPoster(token: string, language: PublicPageLanguage, qr: string): string {
  const t = createTranslator(language);
  const style = `
.poster{border:3px solid #000;padding:1.5rem 1rem;text-align:center;margin-top:1rem}
.poster svg{width:min(70vw,16rem);height:auto}
.poster h1{font-size:1.5rem;margin:0 0 .5rem}
.poster .by{border-top:2px solid #000;margin-top:1rem;padding-top:.75rem;font-weight:600}
button{font:inherit;font-weight:700;padding:.7rem 1.4rem;border:2px solid #000;background:#000;color:#fff;margin-top:1rem}
@media print{.noprint{display:none}main{padding:0}.poster{border-width:2pt;break-inside:avoid}.poster svg{width:9cm}}
`;
  const body = `
<div class="noprint">${languageSwitch(token, language, t, "/poster")}
<button type="button" onclick="window.print()">${escapeHtml(t("public.poster.print"))}</button></div>
<div class="poster">
<h1>${escapeHtml(t("public.poster.line"))}</h1>
<p>${escapeHtml(t("public.poster.what"))}</p>
${qr}
<p><strong>${escapeHtml(t("public.poster.scan"))}</strong></p>
<p class="by">${wholeNames(escapeHtml(t("public.poster.by")))}</p>
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
