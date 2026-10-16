import type { AiFeature, AiUsage, LicenceAnswer } from '@eccs/shared';
import { AiEngineError, type AiEngine, type AiEngineAnswer, type AiEngineRequest } from './ai-engine.js';

// A stand-in for Anthropic, for the automated tests: fixed, plausible answers for
// each feature, worked out from the facts each feature passes along, with no
// network call at all. Selected with AI_ENGINE=fake (the default under tests;
// env.ts refuses it in production), like the fake face engine.
//
// Licence documents: a file containing "FAKE-AI:UNREADABLE" reads as nothing; one
// containing "FAKE-AI:NEEDS-SONNET" leaves the number and expiry date unread for
// Haiku, so the step up to Sonnet can be tested; any other PDF reads as a fire NOC
// and any other picture as an FSSAI licence. Translations are the text with the
// language code in front ("[te] ..."); text in Telugu or Devanagari letters counts
// as Telugu or Hindi, anything else as English. "Why this score?" names the costliest
// thing with no numbers. The daily digest has a point for
// each of the first six outlets it is given; an inspection summary gives the score
// and picks the first findings. A proof photo is fine unless its bytes carry a marker
// ("FAKE-AI:BLURRED", "FAKE-AI:TOO_DARK", "FAKE-AI:WRONG_SUBJECT", "FAKE-AI:NOT_DONE",
// "FAKE-AI:UNSURE"); NOT_DONE's reason is FAKE_NOT_DONE_REASON with the language code in
// front, as translations have, and every answer carries the `seen` note FAKE_SEEN (which
// must never reach the phone, the database or the log). A photo standard is written from
// the check's wording: a photo cannot show it ("no") when the wording says it was logged,
// recorded, written or briefed; it is about people when it names staff, uniform, gloves,
// hair or an apron.
// A test can queue an answer (or an error) for a feature's next call, and read every
// call made.

export const FAKE_LICENCE: LicenceAnswer = {
  type: 'FSSAI',
  number: '13622012000456',
  issuedTo: 'Sample Kitchen (sample)',
  issuedOn: '2026-04-01',
  expiresOn: '2027-03-31',
};
export const FAKE_FIRE_NOC: LicenceAnswer = {
  type: 'FIRE_NOC',
  number: 'FIRE/HYD/2026/00871',
  issuedTo: 'Sample Kitchen (sample)',
  issuedOn: '2026-06-12',
  expiresOn: '2027-06-11',
};

/** The camera nudge's fixed NOT_DONE reason, given as "[te] ..." in the language asked for. */
export const FAKE_NOT_DONE_REASON = 'Two bottles still have water in them.';
/** The camera nudge's `seen` note: thrown away by the server, so it must never be found anywhere. */
export const FAKE_SEEN = 'FAKE-SEEN a steel shelf and a blue cloth';

/** What the fake reads off a shop board photo (feature 7): a bilingual board with a mobile and a landline. */
export const FAKE_BOARD = {
  seen: FAKE_SEEN,
  businessName: '  Sri Annapurna   Tiffins ',
  area: 'Kukatpally',
  address: 'Plot 12, KPHB Colony, Kukatpally, Hyderabad 500072',
  phones: ['040-2345 6789', '98480 22338'],
};

/** What a fake call was asked, for tests to look at. */
export interface FakeAiCall {
  feature: AiFeature;
  model: string;
  text: string;
  hasFile: boolean;
  facts: unknown;
}

const fakeLanguageOf = (text: string) =>
  /\p{Script=Telugu}/u.test(text) ? 'te' : /\p{Script=Devanagari}/u.test(text) ? 'hi' : 'en';

export class FakeAiEngine implements AiEngine {
  readonly kind = 'fake';
  readonly ready = true;
  readonly calls: FakeAiCall[] = [];
  private readonly queued = new Map<AiFeature, unknown[]>();

  /** Tests: the next call for `feature` answers with this (or fails, for an AiEngineError). */
  queue(feature: AiFeature, answer: unknown): void {
    this.queued.set(feature, [...(this.queued.get(feature) ?? []), answer]);
  }

  /** Tests: forget the calls made and anything still queued. */
  reset(): void {
    this.calls.length = 0;
    this.queued.clear();
  }

  complete(request: AiEngineRequest): Promise<AiEngineAnswer> {
    this.calls.push({
      feature: request.feature,
      model: request.model,
      text: request.text,
      hasFile: request.file !== undefined,
      facts: request.facts,
    });
    const waiting = this.queued.get(request.feature);
    const json = waiting?.length ? waiting.shift() : this.answer(request);
    if (json instanceof AiEngineError) return Promise.reject(json);
    const usage: AiUsage = {
      inputTokens: Math.ceil((request.instructions.length + request.text.length) / 4) + (request.file ? 1600 : 0),
      outputTokens: Math.ceil(JSON.stringify(json).length / 4),
    };
    return Promise.resolve({ json, usage });
  }

  private answer(request: AiEngineRequest): unknown {
    switch (request.feature) {
      case 'licence-reader': {
        const file = request.file;
        const bytes = file ? file.data.toString('latin1') : '';
        if (bytes.includes('FAKE-AI:UNREADABLE')) {
          return { type: null, number: null, issuedTo: null, issuedOn: null, expiresOn: null };
        }
        if (bytes.includes('FAKE-AI:NEEDS-SONNET') && request.model === 'claude-haiku-5-5') {
          return { ...FAKE_LICENCE, number: null, expiresOn: null };
        }
        return file?.mimeType === 'application/pdf' ? FAKE_FIRE_NOC : FAKE_LICENCE;
      }
      case 'translate-support': {
        const facts = request.facts as { target: string; messages: { id: string; text: string }[] };
        return {
          items: facts.messages.map((message) => {
            const source = fakeLanguageOf(message.text);
            return { id: message.id, source, text: source === facts.target ? message.text : `[${facts.target}] ${message.text}` };
          }),
        };
      }
      case 'translate-content': {
        const facts = request.facts as { languages: string[]; strings: string[] };
        const source = fakeLanguageOf(facts.strings.join(' '));
        return {
          source,
          languages: Object.fromEntries(facts.languages.map((language) => [language, facts.strings.map((text) => `[${language}] ${text}`)])),
        };
      }
      case 'explain-score': {
        // Two sentences with no numbers, as the real answer must be.
        const facts = request.facts as { costingPoints: { what: string; part: string }[] };
        const [first, second] = facts.costingPoints;
        return {
          costingMost: first ? `${first.what} cost the most.` : 'Nothing is costing much.',
          doFirst: first ? `Start with the ${first.part}${second ? `, then the ${second.part}` : ''}.` : 'Keep doing what you do.',
        };
      }
      case 'monitoring-digest': {
        const facts = request.facts as {
          counts: { needAttention: number; toWatch: number };
          outlets: { id: string; level: string; areas: Record<string, unknown> }[];
        };
        return {
          overview: `${facts.counts.needAttention} outlets need attention and ${facts.counts.toWatch} are worth watching.`,
          points: facts.outlets.slice(0, 6).map((outlet) => ({
            outletId: outlet.id,
            text: `${outlet.level === 'ATTENTION' ? 'Needs attention' : 'Worth watching'}: ${Object.keys(outlet.areas).join(', ')}.`,
          })),
        };
      }
      case 'inspection-summary': {
        const facts = request.facts as { outlet: string; score: number; outOf: number; findings: { id: string }[] };
        return {
          summary: `${facts.outlet} scored ${facts.score} out of ${facts.outOf}. The non-compliances below need putting right.`,
          fixFirst: facts.findings.slice(0, 5).map((finding) => finding.id),
        };
      }
      case 'photo-check': {
        // A test chooses the verdict with a marker in the picture's bytes, e.g. "FAKE-AI:BLURRED".
        // NOT_DONE comes with a fixed reason in the language asked for, marked like a translation ("[te] ...").
        const facts = request.facts as { language: string };
        const bytes = request.file ? request.file.data.toString('latin1') : '';
        const marked = /FAKE-AI:(BLURRED|TOO_DARK|WRONG_SUBJECT|NOT_DONE|UNSURE)/.exec(bytes);
        const verdict = marked ? marked[1] : 'OK';
        return { seen: FAKE_SEEN, verdict, reason: verdict === 'NOT_DONE' ? `[${facts.language}] ${FAKE_NOT_DONE_REASON}` : null };
      }
      case 'photo-standard': {
        // Plain sentences built from the wording, with the two choices worked out from its words.
        const { check } = request.facts as { check: string };
        const cannotShow = /\b(logged|recorded|written|briefed|register)\b/i.test(check);
        return {
          subject: `what the check "${check}" is about`,
          done: `it looks as "${check}" says`,
          notDone: `it clearly does not look as "${check}" says`,
          photoCanShow: cannotShow ? 'no' : 'yes',
          partlyNote: null,
          aboutPeople: /\b(staff|uniform|gloves|hair|apron)\b/i.test(check),
        };
      }
      case 'shop-board': {
        // A board photo reads as FAKE_BOARD, unless its bytes carry a marker: "FAKE-AI:UNREADABLE"
        // reads as nothing, "FAKE-AI:NO-ADDRESS" leaves the area and address out, "FAKE-AI:LANDLINE"
        // has only a landline painted on it.
        const bytes = request.file ? request.file.data.toString('latin1') : '';
        if (bytes.includes('FAKE-AI:UNREADABLE')) return { seen: FAKE_SEEN, businessName: null, area: null, address: null, phones: [] };
        if (bytes.includes('FAKE-AI:NO-ADDRESS')) return { ...FAKE_BOARD, area: null, address: null };
        if (bytes.includes('FAKE-AI:LANDLINE')) return { ...FAKE_BOARD, phones: ['040-2345 6789'] };
        return FAKE_BOARD;
      }
      // A new feature adds its fixed answer above.
      default:
        return {};
    }
  }
}
