// Makes the legal pack for ECCS's lawyer: every legal document and every consent or notice the
// app shows, one PDF each, with a brief and a list of the personal data ECCS asks for and gives.
//
// Run from the repository's folder, after building the two packages the texts come from:
//
//     pnpm build --filter=@eccs/shared --filter=@eccs/i18n
//     node docs/legal-pack/build-pack.mjs
//
// The PDFs are written next to this file, with a zip of them all for sending. The documents'
// words are read from the app's own sources (packages/shared/src/legal, packages/i18n, the
// onboarding letter and handbook), so each PDF shows exactly the words the app shows. What the
// brief and the data list say about the app was checked against the code on 23 Oct 2026; read
// them again before sending a new pack. Microsoft Edge prints the pages, as the API's PDFs are made.

import { execFileSync } from 'node:child_process';
import fs from 'node:fs';
import { createRequire } from 'node:module';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

const here = path.dirname(fileURLToPath(import.meta.url));
const repo = path.resolve(here, '../..');
const require = createRequire(path.join(repo, 'package.json'));
const puppeteer = require('puppeteer-core');
const EDGE = 'C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe';

const shared = await import(pathToFileURL(path.join(repo, 'packages/shared/dist/index.js')).href);
const i18n = await import(pathToFileURL(path.join(repo, 'packages/i18n/dist/index.js')).href);
const appJson = JSON.parse(fs.readFileSync(path.join(repo, 'apps/mobile/app.json'), 'utf8'));
const legalNotes = fs.readFileSync(path.join(repo, 'docs/LEGAL_NOTES.md'), 'utf8');
const handbookSource = fs.readFileSync(path.join(repo, 'packages/db/src/onboarding-sample.ts'), 'utf8');

const PACK_DAY = '23 October 2026';
const PACK_FILE_DAY = '2026-10-23';
const EN = i18n.MESSAGES.EN;

// ───────────────────────── Text helpers ─────────────────────────

const esc = (text) => String(text).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');

/** Escaped text with blanks ("[Registered company name]") in yellow and "[to confirm]" in orange. */
const marked = (text) =>
  esc(text).replace(/\[([^\]\n]{1,90})\]/g, (whole, inner) => `<mark class="${inner.trim() === 'to confirm' ? 'confirm' : 'blank'}">${whole}</mark>`);

/** An app text in English, word for word, with its {placeholders} filled in. */
function say(key, params = {}, messages = EN) {
  const text = messages[key];
  if (text === undefined) throw new Error(`No text "${key}"`);
  return text.replace(/\{(\w+)\}/g, (whole, name) => (params[name] !== undefined ? String(params[name]) : whole));
}

const inline = (runs) =>
  runs
    .map((run) => (run.type === 'bold' ? `<strong>${marked(run.text)}</strong>` : run.type === 'link' ? `<a href="${esc(run.href)}">${marked(run.text)}</a>` : marked(run.text)))
    .join('');

/** A legal document's Markdown as HTML, read by the same reader the app uses. */
function markdownHtml(markdown, { skipTitle = true } = {}) {
  return shared
    .parseLegalMarkdown(markdown)
    .filter((block, index) => !(skipTitle && index === 0 && block.type === 'title'))
    .map((block) => {
      if (block.type === 'ul') return `<ul>${block.items.map((item) => `<li>${inline(item)}</li>`).join('')}</ul>`;
      if (block.type === 'ol') return `<ol start="${block.start}">${block.items.map((item) => `<li>${inline(item)}</li>`).join('')}</ol>`;
      const tag = { title: 'h2', h2: 'h2', h3: 'h3', p: 'p' }[block.type];
      return `<${tag}>${inline(block.content)}</${tag}>`;
    })
    .join('\n');
}

const words = (markdown) => markdown.split(/\s+/).filter(Boolean).length;
const count = (markdown, needle) => markdown.split(needle).length - 1;
const blanksIn = (markdown) => new Set((markdown.match(/\[[^\]\n]{1,90}\]/g) ?? []).filter((m) => m !== '[to confirm]')).size;

/** Wording as the app shows it: a simple box with the screen's title, its lines and its buttons. */
function screen({ caption, title, subtitle, lines = [], buttons = [], note }) {
  return `<figure class="screen">
  <figcaption>${esc(caption)}</figcaption>
  <div class="screen-body">
    ${title ? `<p class="screen-title">${marked(title)}</p>` : ''}
    ${subtitle ? `<p class="screen-sub">${marked(subtitle)}</p>` : ''}
    ${lines.map((line) => (typeof line === 'string' ? `<p>${marked(line)}</p>` : line.html)).join('\n')}
    ${buttons.length ? `<div class="buttons">${buttons.map((b) => `<span class="btn${b.main ? ' main' : ''}">${marked(b.label)}</span>`).join('')}</div>` : ''}
  </div>
  ${note ? `<p class="screen-note">${note}</p>` : ''}
</figure>`;
}

const tick = (label) => ({ html: `<p class="tickbox"><span class="box"></span><span>${marked(label)}</span></p>` });
const muted = (text) => ({ html: `<p class="muted">${marked(text)}</p>` });
const facts = (rows) => `<table class="facts">${rows.map(([k, v]) => `<tr><th>${esc(k)}</th><td>${v}</td></tr>`).join('')}</table>`;
const table = (head, rows, cls = '') =>
  `<table class="grid ${cls}"><thead><tr>${head.map((h) => `<th>${esc(h)}</th>`).join('')}</tr></thead><tbody>${rows
    .map((row) => `<tr>${row.map((cell) => `<td>${cell}</td>`).join('')}</tr>`)
    .join('')}</tbody></table>`;
const forLawyer = (items) => `<section class="lawyer"><h2>Points for the lawyer</h2><ol>${items.map((i) => `<li>${i}</li>`).join('')}</ol></section>`;

// ───────────────────────── The page ─────────────────────────

const CSS = `
:root { --ink:#1d2430; --muted:#5b6573; --rule:#d5dbe3; --accent:#1f4e79; --soft:#f3f6f9; --blank:#fff0a0; --confirm:#ffd2a1; }
* { box-sizing:border-box; }
html { -webkit-print-color-adjust:exact; print-color-adjust:exact; }
body { margin:0; background:#fff; color:var(--ink); font:10.2pt/1.5 Cambria, Georgia, serif; }
h1, h2, h3, .masthead, .docno, .facts, .grid, .legend, .screen, figcaption, .callout, .toc { font-family:"Segoe UI", "Nirmala UI", Arial, sans-serif; }
.masthead { display:flex; justify-content:space-between; font-size:8pt; color:var(--muted); border-bottom:1px solid var(--rule); padding-bottom:5px; letter-spacing:.02em; }
.docno { margin:22px 0 2px; font-size:8.5pt; font-weight:600; color:var(--accent); text-transform:uppercase; letter-spacing:.08em; }
h1 { margin:0 0 6px; font-size:21pt; line-height:1.15; font-weight:600; color:#14202e; }
.lede { margin:0 0 12px; font-size:10.6pt; color:#333c48; }
h2 { margin:20px 0 6px; font-size:12.2pt; font-weight:600; color:var(--accent); break-after:avoid; }
h3 { margin:14px 0 4px; font-size:10.6pt; font-weight:600; color:#14202e; break-after:avoid; }
p { margin:0 0 7px; }
ul, ol { margin:0 0 8px; padding-left:20px; }
li { margin:0 0 3px; }
a { color:var(--accent); text-decoration:none; overflow-wrap:anywhere; }
mark.blank { background:var(--blank); color:inherit; padding:0 1px; border-radius:2px; }
mark.confirm { background:var(--confirm); color:inherit; padding:0 1px; border-radius:2px; }
.facts { width:100%; border-collapse:collapse; font-size:8.8pt; margin:6px 0 10px; }
.facts th { width:27%; text-align:left; vertical-align:top; color:var(--muted); font-weight:600; padding:4px 10px 4px 0; border-top:1px solid var(--rule); }
.facts td { vertical-align:top; padding:4px 0; border-top:1px solid var(--rule); }
.legend { font-size:8pt; color:var(--muted); margin:0 0 6px; }
hr { border:0; border-top:2px solid var(--accent); margin:12px 0 4px; }
.grid { width:100%; border-collapse:collapse; font-size:8.5pt; line-height:1.4; margin:6px 0 12px; }
.grid thead { display:table-header-group; }
.grid th { text-align:left; background:var(--soft); color:#14202e; font-weight:600; padding:5px 6px; border:1px solid var(--rule); vertical-align:bottom; }
.grid td { padding:5px 6px; border:1px solid var(--rule); vertical-align:top; }
.grid tr { break-inside:avoid; }
.grid td p { margin:0 0 3px; }
.grid.narrow-first td:first-child { width:22%; font-weight:600; }
.grid.no td:first-child { width:6%; white-space:nowrap; color:var(--accent); font-weight:600; }
.callout { background:var(--soft); border-left:3px solid var(--accent); padding:9px 12px; margin:10px 0 12px; font-size:9.2pt; break-inside:avoid; }
.callout h3 { margin-top:0; }
.callout ol, .callout ul { margin-bottom:0; }
.screen { margin:10px 0 14px; break-inside:avoid; }
.screen figcaption { font-size:8pt; color:var(--muted); margin-bottom:4px; font-weight:600; text-transform:uppercase; letter-spacing:.05em; }
.screen-body { border:1.5px solid #9aa6b5; border-radius:12px; padding:12px 14px 10px; max-width:118mm; font-size:9.6pt; line-height:1.45; background:#fff; }
.screen-body p { margin:0 0 6px; }
.screen-title { font-size:12pt; font-weight:600; margin-bottom:2px !important; }
.screen-sub { color:var(--muted); }
.screen .muted, .muted { color:var(--muted); }
.tickbox { display:flex; gap:8px; align-items:flex-start; }
.tickbox .box { flex:none; width:12px; height:12px; border:1.5px solid #5b6573; border-radius:2px; margin-top:3px; }
.buttons { display:flex; gap:8px; margin-top:8px; flex-wrap:wrap; }
.btn { flex:1 1 0; text-align:center; border:1.5px solid #6c7a8c; border-radius:999px; padding:5px 12px; font-weight:600; font-size:9pt; white-space:nowrap; }
.btn.main { background:var(--accent); border-color:var(--accent); color:#fff; }
.screen-note { font-size:8.3pt; color:var(--muted); margin:4px 0 0; max-width:150mm; }
.lawyer { border-top:2px solid var(--accent); margin-top:18px; }
.lawyer ol li { margin-bottom:5px; }
.lang { border-top:1px solid var(--rule); padding-top:6px; margin-top:8px; font-family:"Nirmala UI", "Segoe UI", sans-serif; font-size:8.6pt; line-height:1.42; }
.lang p { margin:0 0 4px; }
.lang .screen-title { font-size:10pt; }
.lang .btn { font-size:8.2pt; padding:3px 10px; }
.lang h3 { margin:0 0 4px; }
.lang[dir=rtl] { font-family:"Segoe UI", "Arial", sans-serif; }
.letter { border:1px solid var(--rule); padding:12px 14px; margin:8px 0 14px; }
.letter .grid td:first-child { width:28%; font-weight:600; }
.toc, .keep { break-inside:avoid; }
.toc td:first-child { width:7%; }
.small { font-size:8.6pt; color:var(--muted); }
article > h2:first-child { margin-top:8px; }
`;

function page({ no, kind, title, lede, factsHtml = '', legend = true, body }) {
  return `<!doctype html><html lang="en"><head><meta charset="utf-8"><title>${esc(`ECCS: ${title}`)}</title><style>${CSS}</style></head><body>
<div class="masthead"><span>ECCS · Legal pack for review · Draft, not yet reviewed by a lawyer</span><span>${PACK_DAY}</span></div>
<p class="docno">${esc(no)} · ${esc(kind)}</p>
<h1>${esc(title)}</h1>
${lede ? `<p class="lede">${lede}</p>` : ''}
${factsHtml}
${legend ? `<p class="legend"><mark class="blank">[In yellow]</mark> blanks to fill in before launch &nbsp;·&nbsp; <mark class="confirm">[to confirm]</mark> choices the drafter marked for confirmation</p>` : ''}
<hr>
<article>${body}</article>
</body></html>`;
}

// ───────────────────────── The five customer documents ─────────────────────────

const docOf = (key) => shared.LEGAL_DOCUMENTS.find((d) => d.key === key);
const ROLE_WORDS = { OWNER: 'Owner', MANAGER: 'Manager', HEAD_CHEF: 'Head Chef' };
const agreesWords = (doc) =>
  doc.mustAgree.length === 0
    ? 'Nobody ticks it separately: it is part of the Terms of Service (Terms section 21) and can be read on its own.'
    : doc.mustAgree.length === 1
      ? 'The Owner, on behalf of the restaurant, at first login (with the Terms of Service box).'
      : `${doc.mustAgree.map((r) => ROLE_WORDS[r]).join(', ').replace(/, ([^,]*)$/, ' and $1')}, each at their first login. The Owner agrees on behalf of the restaurant.`;

const LEGAL_PAGES = [
  { no: '02', key: 'terms', lede: 'The contract between ECCS and each restaurant: services, fees, data, liability, termination and disputes.' },
  { no: '03', key: 'privacy', lede: 'The notice of what personal data ECCS collects, why, who sees it, how long it is kept, and people\u2019s rights. It has its own tick box, apart from the Terms.' },
  { no: '04', key: 'refunds', lede: 'How Plans, visits, partner services and chemical refills are cancelled, rescheduled and refunded. Payment providers ask for it to be published.' },
  { no: '05', key: 'dataProcessing', lede: 'The restaurant\u2019s instructions to ECCS for its employees\u2019 data (staff records, attendance, face attendance, salary), where the restaurant is the Data Fiduciary and ECCS its Data Processor.' },
  { no: '06', key: 'disclaimer', lede: 'What ECCS is not (a government body), what its score and inspections are not, and what it does not guarantee. Part of the Terms of Service.' },
];

function legalPage({ no, key, lede }) {
  const doc = docOf(key);
  const title = say(doc.titleKey);
  const md = doc.markdown;
  return {
    no,
    file: `${no} ${title}.pdf`,
    title,
    html: page({
      no,
      kind: 'Customer document',
      title,
      lede: esc(lede),
      factsHtml: facts([
        ['Who agrees', esc(agreesWords(doc))],
        ['Where it is shown', `On the agreement screen at first login (document 07), in the app under Profile &gt; Legal, and on ECCS\u2019s website at /legal/${esc(key)}.`],
        ['Version in force', `${esc(doc.version)} (the date its wording came into force; a new version asks everyone to agree again)`],
        ['Length', `About ${words(md).toLocaleString('en-IN')} words; ${count(md, '\n## ')} sections`],
        ['Open items', `${count(md, '[to confirm]')} choices marked [to confirm]; ${blanksIn(md)} different blanks such as <mark class="blank">[Registered company name]</mark>`],
        ['Language', 'English only for now. The app itself works in 12 languages.'],
      ]),
      body: markdownHtml(md),
    }),
  };
}

// ───────────────────────── 07 The agreement screen ─────────────────────────

function agreementPage() {
  const restaurant = '[Restaurant name]';
  const ownerDocs = ['terms', 'refunds', 'dataProcessing'].map((k) => say(`legal.doc.${k}`));
  const ownerList = `${ownerDocs.slice(0, -1).join(', ')} ${say('legal.accept.and')} ${ownerDocs.at(-1)}`;
  const docRows = (keys) => ({ html: `<ul class="muted">${keys.map((k) => `<li>${esc(say(`legal.doc.${k}`))} (opens the full text)</li>`).join('')}</ul>` });
  const body = `
<h2>What the person sees</h2>
<p>The screen comes straight after logging in and before anything else, the Owner\u2019s new PIN included. The server refuses every other request from the person until they have agreed (the "legal gate"), so nothing in the app can be used first. Each document in the list opens its full text. The boxes start unticked. "Agree and continue" is never greyed out: tapped before every box is ticked, it marks the box still to tick and says so.</p>
${screen({
  caption: 'Owner, first login (wording as shown; layout simplified)',
  title: say('legal.accept.title'),
  subtitle: say('legal.accept.introOwner', { restaurant }),
  lines: [docRows(['terms', 'privacy', 'refunds', 'dataProcessing']), tick(say('legal.accept.agreeTermsOwner', { restaurant, documents: ownerList })), tick(say('legal.accept.agreePrivacy')), muted(say('legal.accept.englishOnlyOwner'))],
  buttons: [{ label: say('legal.accept.continue'), main: true }, { label: say('legal.accept.notNow') }],
  note: `Under "Not now": "${esc(say('legal.accept.notNowNote'))}" Tapping it logs the person out.`,
})}
${screen({
  caption: 'Manager or Head Chef, first login',
  title: say('legal.accept.title'),
  subtitle: say('legal.accept.intro'),
  lines: [docRows(['terms', 'privacy']), tick(say('legal.accept.agreeTerms', { documents: say('legal.doc.terms') })), tick(say('legal.accept.agreePrivacy')), muted(say('legal.accept.englishOnly'))],
  buttons: [{ label: say('legal.accept.continue'), main: true }, { label: say('legal.accept.notNow') }],
})}
<h3>Other messages on this screen</h3>
${table(
  ['When', 'The words'],
  [
    ['A document has a new version', esc(say('legal.accept.titleUpdated')) + ' (as the title)'],
    ['A document changes while the screen is open', esc(say('legal.accept.changed')) + ' The boxes are unticked again.'],
    ['"Agree and continue" with both boxes empty', esc(say('legal.accept.tickBoth'))],
    ['With one box empty', esc(say('legal.accept.tickOne')) + ' Beside the box: ' + esc(say('legal.accept.tickThis'))],
    ['Later, in Profile', `${esc(say('legal.list'))}: each document with "${esc(say('legal.agreedOn', { date: '[date]' }))}", and "${esc(say('legal.deleteAccount'))}", which opens Privacy Policy section 18.`],
  ],
  'narrow-first',
)}
<h2>Who is asked</h2>
${table(
  ['Person', 'Agrees to', 'How'],
  [
    ['Owner', 'Terms of Service, Refund and Cancellation Policy, Data Processing Terms (one box, on behalf of the restaurant); Privacy Policy (own box)', 'Two boxes'],
    ['Manager, Head Chef', 'Terms of Service (one box); Privacy Policy (own box)', 'Two boxes'],
    ['ECCS\u2019s own staff (Super Admin, Ops Manager, Supervisor, sales)', 'Nothing on this screen: these are the customer\u2019s documents', '\u2014'],
    ['Restaurant employees without a login', 'Nothing on this screen. Face attendance has its own consent (document 08).', '\u2014'],
  ],
)}
<h2>What is recorded for each document agreed</h2>
<p>One record per document, kept by the server: the person, the document and its version, a SHA-256 fingerprint of the exact words agreed to, the time, the person\u2019s role, the restaurant and outlet, the language the app was in, the IP address, the browser or app identification string, the phone\u2019s name and the app\u2019s version. A record is never changed; agreeing to a new version adds a new one.</p>
<h2>How versions work (the note kept beside the documents in the code)</h2>
<p>${esc(shared.LEGAL_VERSION_NOTE)}</p>`;
  return {
    no: '07',
    file: '07 Agreement screen at first login.pdf',
    title: 'Agreement screen at first login',
    html: page({
      no: '07',
      kind: 'In-app agreement',
      title: 'Agreement screen at first login',
      lede: 'The click-to-agree screen where restaurant users accept documents 02 to 06. It follows Indian clickwrap practice: an active tick by the person, the documents readable at that moment, plain words that the agreement is binding, and a record of who, when, which version and from which device.',
      factsHtml: facts([
        ['Who sees it', 'Owner, Manager and Head Chef: at their first login, and again at their next login after any document gets a new version.'],
        ['Where', 'Restaurant app, straight after login. The documents are also in Profile &gt; Legal and on the website.'],
        ['Language', 'The screen\u2019s own words are in the app\u2019s language (12 languages); the documents themselves are in English only.'],
      ]),
      body,
    }),
  };
}

// ───────────────────────── 08 Face attendance consent ─────────────────────────

const NOTICE_KEYS = ['face.consent.who', 'face.consent.what', 'face.consent.why', 'face.consent.not', 'face.consent.choice', 'face.consent.withdraw', 'face.consent.ask'];

function consentScreen(messages, params) {
  return [
    `<p class="screen-title">${marked(say('face.consent.title', params, messages))}</p>`,
    `<p class="screen-sub">${marked(say('face.consent.for', params, messages))}</p>`,
    `<p><strong>${marked(say('face.consent.intro', params, messages))}</strong></p>`,
    ...NOTICE_KEYS.map((key) => `<p>${marked(say(key, params, messages))}</p>`),
    `<p class="muted">${marked(say('face.consent.under18', params, messages))}</p>`,
    `<div class="buttons"><span class="btn">${esc(say('face.consent.disagree', params, messages))}</span><span class="btn">${esc(say('face.consent.agree', params, messages))}</span></div>`,
  ].join('\n');
}

function facePage() {
  const days = shared.FACE_RULES.punchPhotoDays;
  const enParams = { name: '[Employee\u2019s name]', employer: '[Restaurant name]', days };
  const others = i18n.LANGUAGE_CODES.filter((code) => code !== 'EN')
    .map((code) => {
      const params = { name: '[\u2026]', employer: '[\u2026]', days };
      const rtl = i18n.isRightToLeft(code);
      return `<section class="lang"${rtl ? ' dir="rtl"' : ''}><h3>${esc(i18n.LANGUAGE_ENGLISH_NAMES[code])} \u00b7 ${esc(i18n.LANGUAGE_NAMES[code])}</h3>${consentScreen(i18n.MESSAGES[code], params)}</section>`;
    })
    .join('\n');
  const body = `
<h2>The notice, word for word</h2>
<p>The Owner opens Team, chooses the person and taps to add their face. Before the camera opens, the phone shows this notice, which <strong>the employee</strong> reads (or has read to them) and answers with their own tap. The two answers are the same size, side by side, and neither is chosen in advance. Only "I agree" opens the camera.</p>
<figure class="screen"><figcaption>English (wording as shown; layout simplified)</figcaption><div class="screen-body">${consentScreen(EN, enParams)}</div>
<p class="screen-note">The app fills in the restaurant\u2019s and the employee\u2019s names; ${days} days is the setting in force.</p></figure>
<h2>Related messages</h2>
${table(
  ['When', 'The words'],
  [
    ['The employee chose "I do not agree"', esc(say('face.declinedHelp'))],
    ['A Manager tries to add a face', esc(say('face.ownerOnly'))],
    ['The Owner removes a face (on the employee\u2019s request, for example)', esc(say('face.removeConfirm', { name: '[name]' })) + ` Then: "${esc(say('face.withdrawnOn', { date: '[date]' }))}"`],
    ['The person is recorded as having left', esc(say('face.leftHelp'))],
    ['Clocking in without a face (the alternative)', esc(say('clock.assist.help'))],
    ['Someone tries to clock themselves in with their own PIN', esc(say('clock.assist.self'))],
  ],
  'narrow-first',
)}
<h2>What is recorded, and what happens to the face</h2>
<ul>
<li><strong>The consent record:</strong> the notice\u2019s version (${esc(shared.FACE_CONSENT_VERSION)}), the language it was shown in, the time, that the employee answered it, and who was logged in. A withdrawal adds the time, the reason and who recorded it. The record is kept with the staff record.</li>
<li><strong>Enrolment:</strong> three to five photos are taken and turned into face templates (lists of numbers). The photos are not kept. Each template is encrypted (AES-256-GCM) with a key kept outside the database.</li>
<li><strong>Matching:</strong> the phone only finds a face in the picture. Recognising who it is happens on ECCS\u2019s own server in Mumbai, with openly licensed face-recognition models, against the people enrolled at that outlet only. No face is sent to any other company, the AI provider included.</li>
<li><strong>Clock-in photos:</strong> one small photo at each clock-in and clock-out, kept ${days} days for the Owner and Manager to check, then deleted automatically by a daily job (built).</li>
<li><strong>Deletion:</strong> the templates are deleted at once when the Owner records a withdrawal or the person\u2019s leaving (built), and are to be deleted when the restaurant\u2019s account closes.</li>
<li><strong>Under 18s:</strong> the notice asks them to choose "I do not agree"; the app has no date of birth for restaurant staff, so it relies on that.</li>
</ul>
${forLawyer([
  '<strong>ECCS\u2019s role.</strong> The drafts make ECCS the restaurant\u2019s Data Processor for this data. ECCS designed the feature and wrote this notice: is processor still right?',
  '<strong>Basis.</strong> Is consent truly free when the employer asks? Or should the restaurant rely on the employment "legitimate use" (DPDP Act section 7(i)), with consent as an extra safeguard?',
  '<strong>"Consent in writing"</strong> for biometric data under SPDI Rule 5: is a tap in the app enough? MeitY\u2019s press note of 24 August 2011 says consent includes any electronic communication; the drafter found no court decision.',
  '<strong>Withdrawal and rights.</strong> The notice says only "tell the Owner". The Privacy Policy (section 7) also lets the employee write to ECCS, and Data Processing Terms section 10 lets ECCS delete a template on the employee\u2019s direct request. From May 2027, DPDP Rule 3 needs the notice to say how to withdraw, how to use rights and how to complain to the Data Protection Board. What should be added, and should it link to the Privacy Policy?',
  '<strong>Translations.</strong> The other 11 languages (appendix below) were written by an AI assistant and checked by program only. No native speaker has read them. Should a certified translation be required for this notice?',
  '<strong>Minors.</strong> Restaurants may employ 15 to 17 year olds in some jobs. The app relies on the employee\u2019s own answer to stay out of enrolment. Is that enough?',
])}
<h2 style="break-before:page">Appendix: the same notice in the app\u2019s other 11 languages</h2>
<p class="small">Shown in the language the app is set to at that moment. Written by an AI assistant; not checked by a native speaker. [\u2026] is the employee\u2019s or the restaurant\u2019s name.</p>
${others}`;
  return {
    no: '08',
    file: '08 Face attendance consent.pdf',
    title: 'Face attendance consent',
    html: page({
      no: '08',
      kind: 'In-app consent',
      title: 'Face attendance consent',
      lede: 'The notice an employee answers before their face can be added for clocking in and out. Face templates are biometric data: the highest-risk feature in the app.',
      factsHtml: facts([
        ['Who answers it', 'The restaurant employee, with their own tap, on the outlet\u2019s phone. Only the Owner can start it.'],
        ['Where', 'Restaurant app: Team &gt; the person &gt; Face.'],
        ['Version in force', esc(shared.FACE_CONSENT_VERSION)],
        ['Languages', 'English and 11 Indian languages (the app\u2019s language at that moment)'],
        ['If they say no', 'Nothing changes for them: the Owner or Manager clocks them in and out with their own PIN.'],
      ]),
      legend: false,
      body,
    }),
  };
}

// ───────────────────────── 09 Permission requests ─────────────────────────

function permissionTexts() {
  const wanted = { microphonePermission: 'Microphone', speechRecognitionPermission: 'Speech recognition', cameraPermission: 'Camera', photosPermission: 'Photos', locationWhenInUsePermission: 'Location while using the app' };
  const seen = new Map();
  for (const plugin of appJson.expo.plugins) {
    if (!Array.isArray(plugin)) continue;
    for (const [key, value] of Object.entries(plugin[1])) {
      if (!(key in wanted) || typeof value !== 'string') continue;
      const id = `${key}|${value}`;
      if (!seen.has(id)) seen.set(id, { what: wanted[key], text: value });
    }
  }
  return [...seen.values()];
}

function permissionsPage() {
  const body = `
<p>Android and iPhone show their own permission box the first time the app needs a sensor. For the two that may surprise people (location and the microphone) and for notifications, the app first asks its own plain question, and the phone\u2019s box comes only after "Allow". Saying no never stops the rest of the app working.</p>
<h2>1. Location on proof photos</h2>
${screen({
  caption: 'The app\u2019s own question, before the phone\u2019s box (restaurant users and staff)',
  title: say('place.ask.title'),
  lines: [say('place.ask.body'), say('place.ask.when'), muted(say('place.ask.optional'))],
  buttons: [{ label: say('place.ask.notNow') }, { label: say('place.ask.yes'), main: true }],
})}
<p><strong>What is saved:</strong> with each proof photo, where the phone was, how accurate that was, the distance from the outlet, and whether Android reported the location as coming from a "mock location" app. Never in the background: the app does not ask for background location at all.</p>
<p><strong>ECCS\u2019s Supervisors</strong> also save an outlet\u2019s location once ("${esc(say('visit.place.help'))}"), and the app records where the Supervisor\u2019s phone was when they tap "${esc(say('visit.checkIn'))}" at a visit, with the distance from the outlet. The check-in button\u2019s hint does not mention location: "${esc(say('visit.checkInHint'))}"</p>
<h2>2. Notifications</h2>
${screen({
  caption: 'The app\u2019s own question, before the phone\u2019s box',
  title: say('push.ask.title'),
  lines: [say('push.ask.body'), muted(say('push.ask.shared'))],
  buttons: [{ label: say('push.ask.notNow') }, { label: say('push.ask.yes'), main: true }],
})}
<p>Notification text can include an outlet\u2019s name, a task, or an employee\u2019s name in an attendance alert. It is delivered through Expo\u2019s push service and Google\u2019s Firebase Cloud Messaging (Apple\u2019s push service for iPhones), which may process it outside India.</p>
<h2>3. Microphone and speech recognition (ECCS Buddy only)</h2>
${screen({
  caption: 'The app\u2019s own question, the first time someone taps "Speak" in ECCS Buddy',
  title: say('buddy.mic.askTitle'),
  lines: [say('buddy.mic.askBody')],
  buttons: [{ label: say('common.cancel') }, { label: say('buddy.mic.askYes'), main: true }],
})}
<p>The phone\u2019s own speech recognition turns speech into text in the message box: on Android usually Google\u2019s service, on an iPhone Apple\u2019s, which may process the voice on their servers. ECCS receives only the text, and only if the person taps Send.</p>
<h2>4. The phone\u2019s own permission boxes: the app\u2019s reason lines</h2>
<p>iPhones show these words in the system box. Android shows its standard box without them, which is why the app asks its own question first for location, notifications and the microphone.</p>
${table(['Permission', 'The reason the app gives, word for word'], permissionTexts().map((p) => [esc(p.what), esc(p.text)]), 'narrow-first')}
<p class="small">Background location ("always"), motion sensors and Android background location are switched off in the app\u2019s settings, so the app cannot ask for them.</p>
${forLawyer([
  'Google Play requires a clear explanation inside the app before Android\u2019s own box when collecting data may surprise the user. Are the questions above enough?',
  'The Supervisor\u2019s visit check-in records their location (ECCS staff data), and the check-in wording does not say so. Should it, or is the staff notice (document 12) the place?',
  'Notification text may include an employee\u2019s name and passes through US push services. The drafter suggested wording attendance alerts without names if staff names must stay in India.',
])}`;
  return {
    no: '09',
    file: '09 Permission requests (location, camera, microphone, notifications).pdf',
    title: 'Permission requests',
    html: page({
      no: '09',
      kind: 'In-app notices',
      title: 'Permission requests: location, camera, microphone, notifications',
      lede: 'Every question the app asks before it uses the phone\u2019s location, camera, photos, microphone or notifications, with the reasons it gives in the phone\u2019s own permission boxes.',
      legend: false,
      body,
    }),
  };
}

// ───────────────────────── 10 AI notices ─────────────────────────

function aiPage() {
  const keep = shared.BUDDY_RULES.keepDays;
  const body = `
<p>Some features send data to Anthropic, the company that makes the Claude AI models, which processes it in the USA. None of this is in the Privacy Policy or the Data Processing Terms yet (see the brief, section 5). Below: what each feature sends, and what the person is told on screen.</p>
<h2>1. ECCS Buddy, the helper for Owners and Managers</h2>
${screen({
  caption: 'Buddy\u2019s welcome, with "What Buddy can do" opened',
  title: say('buddy.welcome.title'),
  subtitle: say('buddy.welcome.body'),
  lines: [say('buddy.welcome.can'), say('buddy.welcome.reads'), say('buddy.welcome.changes'), say('buddy.welcome.cannot'), muted(say('buddy.welcome.ai', { days: keep }))],
})}
<p>Under Buddy’s latest answer: "${esc(say('buddy.byAi'))}" What is sent to Anthropic: the person\u2019s messages, and what Buddy looks up to answer them (checklists, visits, bookings, the score, licences, invoices, the plan, issues, inspections, SOPs, food labels, vendors). Never phone numbers, PINs, staff names, attendance, pay or faces. Chats are kept in ECCS\u2019s database for ${keep} days after their last message, then deleted automatically (built).</p>
<p><strong>Messages about harm.</strong> If someone writes that they want to die or to hurt themselves or someone else, Buddy answers with India\u2019s free Tele-MANAS line (14416 or 1-800-891-4416) and 112, and tells no one. Such a message is information about a person\u2019s health; it is sent to Anthropic and kept ${keep} days like any chat.</p>
<h2>2. The other AI features</h2>
${table(
  ['Feature', 'What is sent to Anthropic', 'What the person sees'],
  [
    ['Reading a licence or document', 'The photo or PDF of a licence or document (may show a holder\u2019s name, address or photo)', esc(say('ai.readByAi'))],
    ['Proof-photo check (daily checklists)', 'A small copy of each checklist proof photo. Staff-hygiene checks ("staff in clean uniform") show staff, faces included; the AI is told never to identify anyone', esc(say('ai.nudge.BLURRED')) + ' \u2026 ' + esc(say('ai.nudge.mayBeWrong'))],
    ['Photo standard', 'The restaurant\u2019s checklist item, once, to write what its photo must show', 'Nothing separate'],
    ['Translating support messages', 'Messages between a restaurant and ECCS (may name people)', esc(say('ai.translatedByAi')) + ', with "' + esc(say('ai.seeOriginal')) + '"'],
    ['Translating the restaurant\u2019s own content', 'Its typed checklist items, SOPs and food-label names', esc(say('ai.translatedByAi'))],
    ['"Why this score?"', 'The facts behind the outlet\u2019s hygiene score, without numbers', esc(say('ai.writtenFromScore'))],
    ['Inspection report summary (ECCS Supervisors)', 'The inspection\u2019s answers and the Supervisor\u2019s notes', `While editing: "${esc(say('ai.summary.draftNote'))}" On the printed report: "${esc(say('ai.summary.checkedNote'))}"`],
    ['Monitoring digest (ECCS console)', 'Facts about outlets on ECCS\u2019s monitoring board', 'For ECCS staff only'],
    ['Shop-board reader (ECCS sales staff)', 'A photo of a prospect\u2019s shop board, to read the name, address and phone number', esc(say('bde.photo.takeHint'))],
  ],
)}
<p><strong>Never sent to any AI service:</strong> attendance, clock-in photos, face templates or enrolment photos, salaries and pay, PINs, and ECCS employees\u2019 joining files.</p>
<p><strong>Anthropic\u2019s terms</strong> (as read on 14 October 2026, to be checked): under its commercial terms it deletes what is sent within 30 days by default (longer for anything flagged under its usage policy); a "zero data retention" arrangement can be agreed with its sales team.</p>
${forLawyer([
  'What must the Privacy Policy (sections 13 and 14) and the Data Processing Terms (section 9, sub-processors) say about Anthropic, the purposes and the transfer to the USA? Changing them means everyone agrees again at their next login.',
  'Proof photos of staff go to Anthropic for the hygiene check. Do staff need a notice through the restaurant?',
  'Prospects\u2019 shop-board photos are read by AI before any agreement with that business. Is a notice needed?',
  'Messages about self-harm are health information sent abroad. Should ECCS do more, or less, with them?',
  'Is "Drafted with AI help and checked by the inspector" enough on an inspection report?',
])}`;
  return {
    no: '10',
    file: '10 AI notices (ECCS Buddy and other AI features).pdf',
    title: 'AI notices',
    html: page({
      no: '10',
      kind: 'In-app notices',
      title: 'AI notices: ECCS Buddy and the other AI features',
      lede: 'What the app tells people where AI is used, and what each AI feature sends outside India.',
      factsHtml: facts([
        ['AI provider', 'Anthropic (the Claude API), USA'],
        ['Buddy chats kept', `${keep} days after the chat\u2019s last message, then deleted (built)`],
        ['Who uses Buddy', 'The restaurant\u2019s Owner and Managers'],
      ]),
      legend: false,
      body,
    }),
  };
}

// ───────────────────────── 11 The customer page ─────────────────────────

function customerPage() {
  const rules = shared.PUBLIC_PAGE_RULES;
  const w = shared.SCORE_WEIGHTS;
  const body = `
<h2>1. The Owner\u2019s switch (restaurant app)</h2>
${screen({
  caption: 'Customer page settings',
  title: say('cpage.switch.label'),
  lines: [
    say('cpage.switch.publishes'),
    { html: `<ul>${[1, 2, 3, 4, 5, 6].map((n) => `<li>${marked(say(`cpage.switch.item${n}`))}</li>`).join('')}</ul>` },
    say('cpage.switch.never'),
    muted(say('cpage.switch.lapse', { days: rules.inspectionValidDays, photoDays: rules.photoShownDays })),
    muted(say('cpage.switch.ownerOnly')),
  ],
  buttons: [{ label: say('cpage.switch.turnOn'), main: true }],
})}
${screen({ caption: 'The confirmation before the page goes live', lines: [say('cpage.on.confirm')], buttons: [{ label: say('common.cancel') }, { label: say('cpage.switch.turnOn'), main: true }] })}
<h2>2. Photos proposed for the page</h2>
${screen({ caption: 'When a restaurant user proposes a photo', title: say('cpage.propose.title'), lines: [say('cpage.propose.help'), say('cpage.propose.rule')] })}
<p>${esc(say('cpage.photos.help', { days: rules.photoShownDays }))}</p>
<h2>3. What the public page says about itself</h2>
<p>The page is opened by scanning the restaurant\u2019s QR code. It sets no cookies, uses no trackers or analytics, and asks search engines not to list it.</p>
${screen({
  caption: 'Right under the score',
  lines: [say('public.disclaimer.short')],
})}
${screen({
  caption: 'At the end of the page: "' + say('public.about.heading') + '"',
  lines: [
    say('public.disclaimer.private'),
    say('public.disclaimer.notGov'),
    say('public.disclaimer.own'),
    say('public.about.notRating'),
    { html: `<p><strong>${esc(say('public.not.heading'))}</strong></p><ul>${[1, 2, 3, 4].map((n) => `<li>${esc(say(`public.not.${n}`))}</li>`).join('')}</ul>` },
    say('public.about.score', { inspection: w.inspection, licences: w.licences, checklists: w.checklists, days: rules.inspectionValidDays }),
    { html: `<p><strong>${esc(say('public.gov.heading'))}</strong></p>` },
    say('public.gov.licence', { number: '[FSSAI number]' }),
    say('public.gov.check'),
    say('public.about.verify', { phone: '[support phone]' }),
  ],
})}
${forLawyer([
  'The page publishes ECCS\u2019s score and grade (A+, A, B) of a named restaurant. Risks: a restaurant disputing a low grade (defamation, negligent misstatement), and diners or authorities confusing it with FSSAI\u2019s Hygiene Rating (one to five smileys, by agencies FSSAI recognises). Should the grade letters stay?',
  'Photos could show people. The rule above forbids it and ECCS approves every photo. Is that enough?',
  'Is the wording above enough to make clear that ECCS is private, paid by the restaurant, and not associated with FSSAI or TG-SAFE?',
])}`;
  return {
    no: '11',
    file: '11 Customer page (public QR page) notices.pdf',
    title: 'Customer page notices',
    html: page({
      no: '11',
      kind: 'Public notices',
      title: 'Customer page: what the public sees, and the Owner\u2019s switch',
      lede: 'A public web page, opened from a QR code at the restaurant, showing ECCS\u2019s hygiene score and inspection result. Off until the Owner turns it on.',
      factsHtml: facts([
        ['Who controls it', 'The Owner turns it on or off; ECCS approves every photo and can take a page down.'],
        ['Time limits', `An inspection drops off after ${rules.inspectionValidDays} days; a photo after ${rules.photoShownDays} days.`],
        ['Data about visitors', 'None asked for. No cookies, trackers or analytics. Server logs keep the IP address, browser and time.'],
      ]),
      legend: false,
      body,
    }),
  };
}

// ───────────────────────── 12 ECCS's own employees ─────────────────────────

function handbookMarkdown() {
  const match = handbookSource.match(/SAMPLE_HANDBOOK = \{\s*title: "([^"]+)",\s*body: `([\s\S]*?)`,\s*\};/);
  if (!match) throw new Error('The sample handbook was not found in packages/db/src/onboarding-sample.ts');
  return { title: match[1], body: match[2] };
}

function employeesPage() {
  const sample = shared.letterParticulars({
    number: 'ECCS/AL/2026/0001',
    madeOn: PACK_FILE_DAY,
    name: '[Employee\u2019s name]',
    role: 'SUPERVISOR',
    area: 'Banjara Hills',
    joinedOn: '2026-11-02',
    weeklyOff: 0,
    monthlyPaise: 2_500_000,
    details: { dateOfBirth: '1998-05-14', parentName: '[Father\u2019s or mother\u2019s name]', currentAddress: '[Address]', uan: null, esiNumber: null },
    handbookVersion: 1,
    settings: shared.LETTER_DEFAULTS,
    company: { legalName: '[Registered company name]', address: '[Registered address]', lin: null, isSample: true },
    signedBy: '[Founder\u2019s name], Founder',
  });
  const rows = shared.letterRows(sample);
  const handbook = handbookMarkdown();
  const details = Object.entries(shared.DETAIL_LABELS)
    .filter(([key]) => key !== 'permanentSame')
    .map(([, label]) => label);
  const documents = Object.values(shared.DOCUMENT_LABELS);
  const duties = Object.entries(shared.LETTER_DEFAULTS.duties).map(([role, text]) => [esc(shared.TEAM_ROLE_LABELS[role]), esc(shared.LETTER_DEFAULTS.skill[role]), esc(text)]);
  const body = `
<p>ECCS\u2019s own employees (Ops Manager, Supervisors, sales staff) are not covered by the Privacy Policy, which says they get "a separate staff notice [to confirm]". Today the only notice is the short one on their "Joining ECCS" page, below. ECCS relies on the employment "legitimate use" (DPDP Act section 7(i)), so there is no consent form.</p>
<h2>1. The notice on the joining page</h2>
${screen({
  caption: 'Joining ECCS page, "What ECCS keeps about you" (opened)',
  lines: [
    { html: '<p><strong>What:</strong> the details on this page, the documents you upload, your appointment letter and the handbook you accept. Of your ID, only its type and last 4 digits; never a whole Aadhaar number.</p>' },
    { html: '<p><strong>Why:</strong> to employ you and pay your salary, to keep the records the law asks of an employer, and for the security of the clients whose kitchens you work in.</p>' },
    { html: '<p><strong>Who sees it:</strong> the founders. The Ops Manager sees only which steps are done. A document sent back to you is deleted at once.</p>' },
    { html: '<p><strong>To see or correct it:</strong> change your details here, or ask a founder.</p>' },
  ],
})}
<h2>2. What the new employee is asked for</h2>
<p><strong>Details:</strong> ${details.map(esc).join('; ')}. Of an ID only its type and last 4 digits are kept; the form refuses anything that looks like a whole Aadhaar number. The bank account number and PAN are shown masked, but are not separately encrypted in the database.</p>
${table(['Document', 'What the page asks'], documents.map((d) => [esc(d.label), esc(d.hint)]), 'narrow-first')}
<p>Also kept for each employee: their phone number (to log in), role, area, joining date, weekly day off, salary history and leave; for Supervisors, their visit check-ins with location, and the photos they take; for sales staff, their leads and follow-ups. Nothing is removed by itself when someone leaves.</p>
<h2>3. The appointment letter (template, with example figures)</h2>
<p>Made from the employee\u2019s record and the joining file, in the order of particulars the labour codes publish. The employee accepts it on their joining page with a click (or signs a printed copy); the app keeps the letter\u2019s version and a SHA-256 fingerprint of its text. An accepted letter never changes: a newer letter takes its place and the old one is kept.</p>
<div class="letter">
<p><strong>Letter of appointment ${esc(sample.number)}</strong><br>${esc(sample.madeOn)}</p>
<p>${marked(shared.letterOpening(sample))}</p>
${table(['Particular', 'Terms'], rows.map((r) => [esc(r.label), marked(r.value)]))}
<p>${esc(shared.LETTER_CLOSING)}</p>
<p>For ECCS: ${marked(sample.signedBy)}</p>
</div>
<p class="small">Example figures: a Supervisor joining on Monday 2 November 2026 at \u20b925,000 a month. The hours, probation, notice, leave, wages and social-security lines are ECCS\u2019s current settings, which the founder can change.</p>
${table(['Role', 'Category of skill', 'Nature of duties (as set now)'], duties)}
<h2>4. The staff handbook (sample, version 1)</h2>
<p>Accepted separately on the joining page; the letter makes it part of the terms. The app keeps the version accepted and a fingerprint of its words. This is a sample, to be replaced by ECCS\u2019s own.</p>
<div class="letter"><h3>${esc(handbook.title)}</h3>${markdownHtml(handbook.body, { skipTitle: false })}</div>
<h2>5. The joining link</h2>
<p>A founder sends the new hire a WhatsApp message from their own phone (ECCS\u2019s server sends nothing):</p>
<p class="callout">${esc(shared.joiningMessage({ name: 'Kiran', consoleUrl: 'https://console.eosfera.in', phone: null, joinedOn: '2026-11-02', today: PACK_FILE_DAY }))}</p>
${forLawyer([
  'Is the short joining-page notice enough, or does ECCS need a full staff privacy notice (and, from May 2027, the DPDP Rule 3 items)? It does not mention Supervisors\u2019 location at check-in, or that staff photos may go to the AI provider.',
  'How long should a leaver\u2019s file, documents (police verification, medical fitness) and salary records be kept? Nothing is removed by itself today.',
  'The appointment letter follows the labour codes\u2019 published format but was written by an AI assistant: are its terms (probation, notice, overtime at twice the rate, leave, EPF and ESI "not applicable at present") right for ECCS?',
  'Is click-to-accept on the joining page enough as the employee\u2019s acceptance of the letter and the handbook?',
  'The bank account and PAN are not separately encrypted. Is that acceptable under SPDI Rule 8 ("reasonable security") for financial information?',
])}`;
  return {
    no: '12',
    file: '12 ECCS employees (joining notice, appointment letter, handbook).pdf',
    title: 'ECCS employees',
    html: page({
      no: '12',
      kind: 'Employee documents',
      title: 'ECCS\u2019s own employees: joining notice, appointment letter, staff handbook',
      lede: 'What a new ECCS employee is told, asked for and asked to accept when they join.',
      factsHtml: facts([
        ['Who', 'ECCS\u2019s Ops Manager, Supervisors and sales staff (not restaurant staff)'],
        ['Where', 'ECCS web console: the employee\u2019s own "Joining ECCS" page'],
        ['Who sees the file', 'The Super Admin (the founders) and the person. The Ops Manager sees only which steps are done.'],
      ]),
      body,
    }),
  };
}

// ───────────────────────── 13 The drafter's notes ─────────────────────────

function notesPage() {
  const cleaned = legalNotes
    .replace(/`/g, '')
    .replace(/^\*(.+)\*$/m, '$1')
    .replace(/(?<![*\w])\*(?!\*)([^*\n]+?)\*(?![*\w])/g, '$1')
    .replace(/^# .*\n/, '');
  return {
    no: '13',
    file: '13 Drafter notes (blanks, choices to confirm, sources).pdf',
    title: 'Drafter\u2019s notes',
    html: page({
      no: '13',
      kind: 'Background',
      title: 'Drafter\u2019s notes: blanks, choices to confirm, open points and sources',
      lede: 'The notes written with the five drafts on 14 October 2026 and added to up to 23 October, as they stand. Section 3 explains each of the 72 [to confirm] choices with a suggested default; section 8 lists the sources relied on. Section 4 is summarised, with newer points, in the brief (document 00).',
      body: markdownHtml(cleaned, { skipTitle: false }),
    }),
  };
}

// ───────────────────────── 01 The data inventory ─────────────────────────

function inventoryPage() {
  const keep = shared.BUDDY_RULES.keepDays;
  const photoDays = shared.FACE_RULES.punchPhotoDays;
  const logDays = shared.ACTIVITY_LOG_RULES.keepDays;
  const collected = [
    [
      'Restaurant users: Owner, Manager, Head Chef',
      'Name; role and outlets; the Owner\u2019s mobile number and one-time login codes; PIN (kept only as a keyed hash); each linked phone\u2019s name, failed PIN attempts and login sessions; app language; optional email and profile photo; the record of each agreement (document 07: version, fingerprint, time, IP address, device, app version).',
      'Accounts and secure login; showing each role only what it may see; proof of the contract',
      'Restaurant\u2019s own users; ECCS staff as needed',
      'While the login is active. Draft: delete within 1 year after removal [to confirm]; not built',
    ],
    [
      'The restaurant business and its outlets',
      'Business name, GSTIN, billing address; each outlet\u2019s name, address and map location; contact people\u2019s names and phone numbers.',
      'Visits, invoices, contact; checking where photos were taken',
      'Restaurant users; ECCS staff',
      'While the account is active (nothing deletes it yet)',
    ],
    [
      'Restaurant employees (ECCS processes this for the restaurant)',
      'Name, job title, phone, joining and leaving dates, pay type, salary or daily wage, overtime rate, weekly day off; clock-in and clock-out times, how (face or PIN), flags and corrections with reasons; salary record entries (days, pay, overtime, bonuses, advances, deductions, payments).',
      'The restaurant\u2019s attendance and salary records',
      'Owner, and Managers as allowed. Never ECCS staff',
      'While the account is active',
    ],
    [
      'Face attendance (biometric), only with the employee\u2019s consent (document 08)',
      'Face templates (encrypted); the consent record (version, language, time) and any withdrawal; a small photo at each clock-in and clock-out.',
      'Knowing it is the employee who clocks in',
      'Matching only on ECCS\u2019s server; photos seen by Owner and Manager',
      `Templates: until withdrawal or leaving (built). Clock-in photos: ${photoDays} days (built)`,
    ],
    [
      'Daily checklists and proof photos',
      'Ticks, notes, times and who filled them in; proof photos (staff-hygiene checks show staff, faces included); if allowed, the phone\u2019s location, its accuracy and distance from the outlet; each photo\u2019s fingerprints (exact and near-identical), the phone\u2019s time against the server\u2019s, and Android\u2019s "mock location" flag.',
      'The kitchen\u2019s own hygiene record; the score; spotting doubtful photos',
      'Restaurant users. ECCS\u2019s Super Admin and Ops Manager can open doubtful ones (since 20 Oct)',
      'While the account is active',
    ],
    [
      'Service visits, inspections, support',
      'Bookings, visit times, tasks, chemicals; ECCS\u2019s before and after photos; the sign-off (name, role, signature where asked, rating, comment); reports, certificates, inspection findings, scores; issues and messages with ECCS, with photos.',
      'Delivering and proving the work; complaints',
      'Restaurant users; ECCS staff',
      'While the account is active. Draft: 3 years after closure for visit records [to confirm]',
    ],
    [
      'Licences and documents',
      'Licence numbers (FSSAI, trade, fire), expiry dates and copies, which may show a holder\u2019s name, address or photo.',
      'Storage and expiry reminders; the score',
      'Restaurant users; ECCS staff',
      'While the account is active',
    ],
    [
      'Food labels',
      'Item names and times, and the name of the person who printed the label.',
      'The kitchen\u2019s own records',
      'Restaurant users',
      'While the account is active',
    ],
    [
      'Billing',
      'Plan, invoices, GST details, amounts, payment status, payment references and the type of method. No card or bank login details (none are taken: online payment is not connected yet).',
      'Billing and GST law',
      'Owner; ECCS staff',
      'At least as long as GST law requires (about 7 to 8 years)',
    ],
    [
      'ECCS Buddy (AI helper)',
      'The Owner\u2019s and Managers\u2019 chat messages (typed, or spoken and turned into text by the phone), and what Buddy looked up to answer.',
      'Answering questions about the app and the kitchen',
      'The person who chatted',
      `${keep} days after the chat\u2019s last message (built)`,
    ],
    [
      'Notifications',
      'Each phone\u2019s push token; the notifications sent and whether they were read.',
      'Telling people about visits, reports, reminders and replies',
      'The person',
      'While the login is active',
    ],
    [
      'Technical and activity log',
      'For each action: who, what, when, the result, the IP address, the device\u2019s ID, the app or browser, the app\u2019s version. Includes visits to customer pages.',
      'Security, fraud prevention, fixing faults, legal duties (CERT-In)',
      'ECCS\u2019s Super Admin',
      `${logDays} days, then deleted by a daily job (built)`,
    ],
    [
      'Diners and website visitors',
      'Nothing asked. The server receives the IP address, browser type, page and time with each request.',
      'Delivering the page, security',
      'ECCS (logs)',
      `As the activity log, ${logDays} days`,
    ],
    [
      'Prospects (sales leads, before any agreement)',
      'Business name, area, address and map location; contact\u2019s name and phone; who referred them; a photo of the shop board; calls, visits, notes and follow-ups; the free hygiene check\u2019s findings; quotes, and how often and when a quote\u2019s link was opened.',
      'Selling ECCS\u2019s services',
      'ECCS\u2019s sales staff and founders',
      'Nothing deletes it. Not covered by the Privacy Policy',
    ],
    [
      'Partners and vendors',
      'Names, roles, phones and emails of people at partners; the vendor directory (business name, area, address, phone and WhatsApp, hours, FSSAI number).',
      'Arranging partner services; showing nearby vendors',
      'Restaurant users see vendors; ECCS staff',
      'Draft: up to 1 year after the relationship ends [to confirm]',
    ],
    [
      'ECCS\u2019s own employees (document 12)',
      'Phone, name, role, area, joining date, salary, leave; joining file (date of birth, parent\u2019s name, addresses, emergency contact, blood group, uniform size, ID type and last 4 digits, PAN, bank account and IFSC, previous employer, UAN, ESI number, education); documents (photo, ID and address proof, bank proof, police verification, medical fitness, relieving letter, education); letter and handbook acceptances; Supervisors\u2019 check-in location at each visit.',
      'Employment, salary, legal records, clients\u2019 security',
      'The founders and the person; the Ops Manager sees progress only',
      'Nothing deletes it. Not covered by the Privacy Policy',
    ],
  ];
  const given = [
    ['Amazon Web Services (AWS)', 'Everything: the server and its database, and the file store (photos, documents, PDFs)', 'India (Mumbai)', 'Hosting and storage', 'Live since 20 Oct 2026'],
    ['Anthropic (Claude AI)', 'For the AI features (document 10): documents and licences, support messages, the restaurant\u2019s own checklist items, SOPs and labels, score facts, inspection notes, checklist proof photos, prospects\u2019 shop-board photos, Buddy chats. Never attendance, pay, faces, clock-in photos, PINs or phone numbers', 'USA', 'AI features', 'Live. Not yet in the Privacy Policy'],
    ['Expo (push service) and Google Firebase Cloud Messaging; Apple\u2019s push service for iPhones', 'Each phone\u2019s push token, and each notification\u2019s text (may name an outlet, a task or an employee)', 'Outside India (USA)', 'Delivering notifications', 'Live. The Privacy Policy names Firebase only'],
    ['Google or Apple speech recognition', 'What an Owner or Manager says to Buddy after tapping Speak', 'Possibly outside India', 'Turning speech into text, on the phone', 'Live, on the person\u2019s phone'],
    ['The public', 'Only if the Owner turns the customer page on: the restaurant\u2019s name and city, ECCS\u2019s inspection score, grade, date and report number, how many days the checklists were done, recent service dates and certificate numbers, the FSSAI number, approved kitchen photos. Never staff names, prices or bills', 'Web', 'The customer page (document 11)', 'Live'],
    ['ECCS partners (laboratories, training, medical camps)', 'For a booked partner service: the outlet\u2019s name, address, contact person and booking details', 'India', 'Delivering that service', 'The app sends nothing to partners itself'],
    ['WhatsApp, Google Maps and the phone\u2019s share sheet, when a person taps them', 'What that person chooses to send from their own phone: a quote to a prospect, a reminder, the joining link to a new hire, a chat with ECCS support, a staff member\u2019s new PIN, a staff pay record; or an outlet\u2019s location opened in Google Maps', 'The person\u2019s own apps', 'Convenience', 'ECCS\u2019s server sends nothing'],
    ['Authorities', 'What the law requires, when it requires it (for example CERT-In incident reports, a court order, tax authorities)', 'India', 'Legal duties', 'Nothing automatic'],
    ['SMS provider (MSG91, planned)', 'The Owner\u2019s and staff\u2019s phone numbers and one-time login codes', 'India', 'Login codes', 'Not connected: a fixed test code is used'],
    ['Payment provider (Razorpay, planned)', 'Payment details, collected by the provider directly', 'India', 'Online payments', 'Not connected: no payments are taken'],
  ];
  const sensitive = [
    ['Passwords', 'PINs of restaurant users (kept only as keyed hashes)', 'SPDI Rule 3(i)'],
    ['Financial information', 'ECCS employees\u2019 bank account number and IFSC, and their PAN. Salary records (restaurant staff\u2019s and ECCS employees\u2019) may also count', 'SPDI Rule 3(ii)'],
    ['Health condition, medical records', 'ECCS employees\u2019 blood group and medical fitness certificates; restaurant staff\u2019s certificates if a restaurant uploads them; Buddy messages about self-harm', 'SPDI Rule 3(iii), (v)'],
    ['Biometric information', 'Face templates of consenting restaurant employees', 'SPDI Rule 3(vi)'],
  ];
  const body = `
<h2>1. What we ask for or collect</h2>
<p>Grouped by whose data it is. "Kept for" says what the app does today; where the Privacy Policy\u2019s draft promises something not yet built, it says so.</p>
${table(['Whose data', 'What', 'Why', 'Who can see it', 'Kept for'], collected.map((row) => row.map((cell, i) => (i === 0 ? `<strong>${marked(cell)}</strong>` : marked(cell)))))}
<h2>2. What we give to others</h2>
<p>Every organisation outside ECCS that receives personal data, what it receives, and where. ECCS does not sell personal data, uses no advertising or analytics trackers, and sets no cookies on its public pages.</p>
${table(['Who receives it', 'What', 'Where', 'Why', 'Today'], given.map((row) => row.map((cell, i) => (i === 0 ? `<strong>${esc(cell)}</strong>` : esc(cell)))))}
<p><strong>Done on ECCS\u2019s own server, with no other company:</strong> face matching, making every PDF, and reading a licence when the AI is switched off (a free text reader then reads it).</p>
<div class="keep">
<h2>3. Sensitive personal data</h2>
<p>The kinds the IT Act\u2019s SPDI Rules 2011 treat as sensitive (in force until May 2027), and where the app holds them.</p>
${table(['Kind', 'Where the app holds it', 'Rule'], sensitive.map((row) => row.map(esc)), 'narrow-first')}
</div>
<h2>4. What we never ask for or keep</h2>
<ul>
<li>A whole Aadhaar number: the forms refuse it, and a document sent back is deleted at once.</li>
<li>Card numbers, UPI PINs or banking passwords.</li>
<li>Location in the background, or at any time except the moment of a proof photo or a Supervisor\u2019s check-in.</li>
<li>The photos used to make a face template.</li>
<li>Anything from diners or website visitors beyond what every web server receives.</li>
</ul>
<h2>5. Deletion: built and not built</h2>
${table(
  ['Built and running', 'Promised in the drafts, not built yet'],
  [[
    `<ul><li>Clock-in photos after ${photoDays} days</li><li>Face templates at withdrawal or leaving</li><li>Buddy chats ${keep} days after their last message</li><li>The activity log after ${logDays} days</li><li>Customer-page photos and inspections drop off the page after ${shared.PUBLIC_PAGE_RULES.photoShownDays} and ${shared.PUBLIC_PAGE_RULES.inspectionValidDays} days</li></ul>`,
    '<ul><li>Export for 30 days after an account closes, then deletion within 90 days</li><li>Users\u2019 details within 1 year of their login being removed</li><li>Support messages, partner contacts: 1 year after</li><li>Backups within 30 days. Today the file store keeps deleted files\u2019 old versions for 90 days, and the server takes a daily snapshot (the last 7 kept)</li><li>Nothing yet for prospects or ECCS employees who leave</li></ul>',
  ]],
)}`;
  return {
    no: '01',
    file: '01 Data we ask for and data we give.pdf',
    title: 'Data we ask for and data we give',
    html: page({
      no: '01',
      kind: 'Data inventory',
      title: 'Data we ask for, and data we give',
      lede: 'Every kind of personal data the ECCS app and console collect, why, who sees it and for how long; then everyone outside ECCS who receives any of it. Checked against the app as built on 23 October 2026.',
      body,
    }),
  };
}

// ───────────────────────── 00 The brief ─────────────────────────

function briefPage(pack) {
  const toc = pack.map((p) => [esc(p.no), esc(p.title), esc(p.who), esc(p.how)]);
  const body = `
<div class="callout">
<h3>What we ask of you</h3>
<ol>
<li>Review and correct the five customer documents (02 to 06).</li>
<li>Review the consents and notices the app shows (07 to 12), above all the face-attendance consent (08).</li>
<li>Advise on the questions in section 4, and on which of the 72 choices marked [to confirm] to keep (explained in 13).</li>
<li>Tell us what must change in the app itself, not only in the words.</li>
</ol>
</div>
<h2>1. ECCS and the app</h2>
<ul>
<li><strong>ECCS</strong> (Eosfera Commercial Cleaning Services), Hyderabad: commercial kitchen cleaning, pest control, hygiene and compliance for restaurants. The company is not registered yet; the documents call it <mark class="blank">[Registered company name]</mark>.</li>
<li><strong>A phone app for restaurants</strong> (Owner, Manager, Head Chef) and ECCS\u2019s field staff: daily hygiene checklists with photos, booking ECCS\u2019s services, visit reports and certificates, licence reminders, invoices, staff attendance (optionally by face) and a salary record book, food labels, and an AI helper, ECCS Buddy. <strong>A web console</strong> for ECCS\u2019s office. <strong>A public customer page</strong> per restaurant, from a QR code.</li>
<li><strong>Where data is kept:</strong> Amazon Web Services in Mumbai, since 20 October 2026. Some AI processing by Anthropic in the USA.</li>
<li><strong>Status:</strong> in testing, with sample data. No real SMS login codes and no online payments yet.</li>
</ul>
<h2>2. How the documents were made</h2>
<ul>
<li>Drafted on 14 October 2026 with an AI assistant (Claude), from public sources on Indian law listed in document 13. <strong>No lawyer has reviewed them.</strong></li>
<li>They are shown in English only, while the app works in English and 11 Indian languages. The in-app consents (07 to 11) are in all 12; the 11 translations were written by the AI assistant and no native speaker has checked them.</li>
<li>Features added after 14 October are not reflected in them (section 5).</li>
</ul>
<h2>3. What is in this pack</h2>
${table(['No.', 'Document', 'Who agrees or sees it', 'How'], toc, 'toc no')}
<h2>4. Questions for you, most important first</h2>
<ol>
<li><strong>Face attendance (08).</strong> Is ECCS only the restaurant\u2019s Data Processor, when ECCS designed the feature and wrote the notice? Is an employee\u2019s consent free when the employer asks, or should the restaurant rely on employment as a "legitimate use" (DPDP Act section 7(i)) with consent as a safeguard? Is a tap "consent in writing" for biometric data (SPDI Rule 5)? The notice says only "tell the Owner" to withdraw.</li>
<li><strong>AI outside India (10).</strong> Documents, support messages, checklist photos (which can show staff, faces included), the restaurant\u2019s own content, inspection notes, prospects\u2019 shop-board photos and Buddy chats go to Anthropic in the USA. None of this is in the Privacy Policy or the Data Processing Terms yet. What must they say?</li>
<li><strong>Who is bound.</strong> The company does not exist yet. The Owner agrees for the restaurant; Managers and Head Chefs, who are the restaurant\u2019s employees, agree to the Terms in their own name. Is that right? Can restaurants agree before the company is formed (Terms section 27)?</li>
<li><strong>Liability (Terms 22, 23).</strong> A cap of 12 months\u2019 fees. Restaurants may count as "consumers" (Harsolia Motors, 2023), and kitchen cleaning risks property damage and injury. Is the cap sound, and what insurance should ECCS hold?</li>
<li><strong>Disputes (Terms 29).</strong> Arbitration by a jointly appointed arbitrator, IAMC Hyderabad as the fallback, fast track under \u20b910 lakh. For claims of a few thousand rupees, should either side be able to go to court instead?</li>
<li><strong>ECCS staff seeing restaurants\u2019 checklist photos.</strong> Since 20 October, ECCS\u2019s Super Admin and Ops Manager can open a restaurant\u2019s doubtful checklist photos to accept or reject them. The Privacy Policy says ECCS cannot. Does this make ECCS a fiduciary for that purpose?</li>
<li><strong>Prospects.</strong> ECCS\u2019s sales staff record businesses before any agreement: contact names and phones, location, a shop-board photo read by AI, notes, and when a quote\u2019s link was opened. The Privacy Policy does not cover prospects.</li>
<li><strong>ECCS\u2019s own employees (12).</strong> Only a short notice on the joining page; the appointment letter and handbook were written by the AI assistant; Supervisors\u2019 location is recorded at visit check-ins; the bank account and PAN are not separately encrypted.</li>
<li><strong>Retention.</strong> The drafts promise deletion schedules that are mostly not built yet (data inventory, section 5). Please settle a schedule; we will build to it.</li>
<li><strong>The customer page (11).</strong> It publishes ECCS\u2019s grade of a named restaurant: defamation risk, and confusion with FSSAI\u2019s Hygiene Rating. Should the grade letters stay?</li>
<li><strong>Consumer Protection (E-Commerce) Rules 2020.</strong> Do they apply to ECCS selling to restaurants? The drafts assume they do.</li>
<li><strong>English only.</strong> Is it acceptable that Managers and Head Chefs, who may not read English well, agree to English documents? The screen offers help from the Owner or ECCS.</li>
</ol>
<h2>5. Where the drafts no longer match the app</h2>
${table(
  ['The drafts say', 'The app now does', 'Needed'],
  [
    ['Service providers: hosting, SMS, push notifications, payments (Privacy 13); push "such as Firebase" may process data abroad (Privacy 10, 14)', 'Also Anthropic (AI, USA); Expo\u2019s push service (USA) as well as Firebase; the phone\u2019s speech recognition for Buddy\u2019s microphone', 'Name AI and push providers, purposes and transfers; add AI to the sub-processors (Data Processing 9)'],
    ['"Our office cannot browse a restaurant\u2019s checklist photos" (Privacy 6, 9, 13)', 'ECCS\u2019s Super Admin and Ops Manager can open the doubtful ones and accept or reject them', 'Say so and why, or remove the feature'],
    ['Who the policy covers (Privacy 3)', 'Prospects\u2019 details and shop-board photos are collected; ECCS employees have only the joining-page notice', 'Cover prospects; write a staff notice'],
    ['What is collected (Privacy 6)', 'Not listed: Buddy chats (kept 30 days), messages about self-harm, Supervisors\u2019 check-in location, when a quote link was opened, the device ID in the activity log', 'Add them'],
    ['Backups overwritten within 30 days (Privacy 15)', 'Deleted files\u2019 old versions are kept 90 days in the file store; daily server snapshots, the last 7 kept', 'Change the words or the setting'],
    ['Deletion after closure, after a year, and so on (Privacy 15)', 'Built only for clock-in photos, face templates, Buddy chats and the activity log', 'Settle the schedule, then build it'],
    ['Servers in India [to confirm] (Privacy 14)', 'True since 20 October 2026, except the AI and push services above', 'Confirm, with those exceptions'],
    ['Withdraw face consent by telling the Owner or writing to ECCS (Privacy 7)', 'The in-app notice says only "tell the Owner"', 'Align the notice (08)'],
  ],
)}
<h2>6. Good to know</h2>
<ul>
<li><strong>Placeholders:</strong> company name, CIN, GSTIN, address, contacts, website and Grievance Officer are blank until the company is registered (13, section 2).</li>
<li><strong>Not built yet:</strong> account deletion handling, data export at closure, breach notices, and the "terms updated" notice. The app\u2019s Profile has a "How to delete your account" link to Privacy section 18.</li>
</ul>`;
  return {
    no: '00',
    file: '00 Brief for the lawyer.pdf',
    title: 'Brief for the lawyer',
    html: page({
      no: '00',
      kind: 'Covering brief',
      title: 'Legal review brief',
      lede: 'ECCS\u2019s legal documents, in-app consents and personal-data inventory, for review before any real restaurant agrees to them.',
      factsHtml: facts([
        ['From', 'The founder, ECCS (Eosfera Commercial Cleaning Services), Hyderabad'],
        ['Date', PACK_DAY],
        ['Enclosed', '13 documents, each a separate PDF (listed in section 3)'],
      ]),
      body,
    }),
  };
}

// ───────────────────────── Make the PDFs ─────────────────────────

const docs = [
  inventoryPage(),
  ...LEGAL_PAGES.map(legalPage),
  agreementPage(),
  facePage(),
  permissionsPage(),
  aiPage(),
  customerPage(),
  employeesPage(),
  notesPage(),
];
const WHO = {
  '01': ['The data inventory you asked for', 'What we collect, from whom, why, for how long; and whom we give it to'],
  '02': ['Owner (for the restaurant), Manager, Head Chef', 'Tick box at first login'],
  '03': ['Owner, Manager, Head Chef', 'Its own tick box at first login'],
  '04': ['Owner, for the restaurant', 'With the Terms box'],
  '05': ['Owner, for the restaurant', 'With the Terms box'],
  '06': ['Everyone: part of the Terms', 'No separate tick'],
  '07': ['Owner, Manager, Head Chef', 'The click-to-agree screen for 02 to 06'],
  '08': ['Each employee whose face is added', 'Their own tap: I agree or I do not agree'],
  '09': ['Anyone using those features', 'The app\u2019s question, then the phone\u2019s box'],
  '10': ['Users of the AI features', 'Labels on screen'],
  '11': ['The public; the Owner turns it on', 'Owner\u2019s switch with a confirmation'],
  '12': ['New ECCS employees', 'Notice; click to accept letter and handbook'],
  '13': ['Background for you', 'Blanks, the 72 choices, sources'],
};
const pack = [
  { no: '00', title: 'This brief', who: 'You', how: '\u2014' },
  ...docs.map((d) => ({ no: d.no, title: d.title, who: WHO[d.no][0], how: WHO[d.no][1] })),
];
docs.unshift(briefPage(pack));

const footer = (title) =>
  `<div style="width:100%;font:7.5px 'Segoe UI',Arial,sans-serif;color:#6b7480;padding:0 18mm;display:flex;justify-content:space-between;"><span>ECCS \u00b7 ${esc(title)} \u00b7 Draft for legal review, ${PACK_DAY}</span><span>Page <span class="pageNumber"></span> of <span class="totalPages"></span></span></div>`;

for (const old of fs.readdirSync(here)) if (/^\d\d .*\.pdf$/.test(old) || /\.zip$/.test(old)) fs.rmSync(path.join(here, old));

const browser = await puppeteer.launch({ executablePath: EDGE, headless: true, args: ['--no-first-run', '--disable-extensions'] });
try {
  const tab = await browser.newPage();
  for (const doc of docs) {
    // PACK_HTML=<folder> also keeps each page's HTML there, to look at while changing the layout.
    if (process.env.PACK_HTML) fs.writeFileSync(path.join(process.env.PACK_HTML, doc.file.replace(/\.pdf$/, '.html')), doc.html);
    await tab.setContent(doc.html, { waitUntil: 'load' });
    await tab.pdf({
      path: path.join(here, doc.file),
      format: 'A4',
      printBackground: true,
      displayHeaderFooter: true,
      headerTemplate: '<div></div>',
      footerTemplate: footer(doc.title),
      margin: { top: '16mm', bottom: '17mm', left: '18mm', right: '18mm' },
    });
    console.log('made', doc.file);
  }
} finally {
  await browser.close();
}

// One zip of them all, to attach to an email.
const zip = path.join(here, `ECCS legal pack ${PACK_FILE_DAY}.zip`);
const pdfs = docs.map((d) => path.join(here, d.file).replace(/'/g, "''"));
execFileSync('powershell', ['-NoProfile', '-Command', `Compress-Archive -Force -DestinationPath '${zip.replace(/'/g, "''")}' -LiteralPath ${pdfs.map((p) => `'${p}'`).join(',')}`]);
console.log('made', path.basename(zip));
