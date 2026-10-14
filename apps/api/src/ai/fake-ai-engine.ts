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
// as Telugu or Hindi, anything else as English. A test can queue an answer (or an
// error) for a feature's next call, and read every call made.

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
        const facts = request.facts as { score: number; costingPoints: { what: string; part: string; pointsLost: number }[] };
        const [first, second] = facts.costingPoints;
        return {
          pulledDown: first
            ? `Your score is ${facts.score}. ${first.what} cost ${first.pointsLost} points, the most.`
            : `Your score is ${facts.score}.`,
          doFirst: first ? `Start with the ${first.part}.` : 'Keep doing what you do.',
          doNext: second ? `Then look at the ${second.part}.` : '',
        };
      }
      // A new feature adds its fixed answer above.
      default:
        return {};
    }
  }
}
