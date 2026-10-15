import { Injectable, Logger } from '@nestjs/common';
import {
  AI_LANGUAGES,
  AI_MODELS,
  contentTranslationJsonSchema,
  contentTranslationSchema,
  type AiErrorCode,
  type AiLanguage,
  type ContentTranslationAnswer,
  type LocalizedText,
} from '@eccs/shared';
import type { AuthUser } from '../auth/auth.types.js';
import { PrismaService } from '../prisma/prisma.service.js';
import { contentTranslationInstructions } from './ai-prompts.js';
import { AiService } from './ai.service.js';

/** The texts in every language: the typed ones under the language they are in, the rest filled in by AI. */
export interface FilledLanguages {
  /** The language the texts were typed in (detected; the screen's language when unsure). */
  source: AiLanguage;
  texts: Partial<Record<AiLanguage, string[]>>;
}

/** What is to be translated, and who it is for. */
export interface TranslateJob {
  strings: string[];
  /** The language the texts are kept under (for typed text, the screen's language). */
  typedIn: AiLanguage;
  /** True when the texts are certainly in `typedIn` (the English suggestion library): the AI's guess is not used. */
  sourceKnown?: boolean;
  /** Only these languages (the ones a text is missing); all twelve when left out. */
  languages?: readonly AiLanguage[];
  /** The person who saved, or null for the server's own work. The cost counts against `outletId` either way. */
  userId: string | null;
  outletId: string;
}

/** What a translation came to. */
export interface TranslateResult {
  /** The texts in the languages that could be filled in, or null if none could. */
  filled: FilledLanguages | null;
  /** Why a call was refused or failed (AI_OFF, AI_LIMIT, AI_FAILED), if one was; some languages may still be filled. */
  code: AiErrorCode | null;
}

/**
 * How long a saved text is left to its own translation before the filler of missing
 * languages may go back to it (translation-filler.service.ts). One translation takes
 * seconds and gives up after a minute and a half a call, so this is ample.
 */
export const OWN_TRANSLATION_GRACE_MS = 10 * 60_000;

/**
 * The most output one call is planned for, in tokens; longer work is split across
 * calls by language. Haiku writes this in well under the time a call is allowed.
 */
const MAX_OUTPUT_TOKENS_PER_CALL = 8_000;
/** Translation runs in the background, so it may take longer than a question a person waits on. */
const TIMEOUT_MS = 90_000;

/**
 * Feature 2b (14 Oct 2026): when the restaurant saves text for its own kitchen (its
 * own checklist items and checklist names, its own SOPs, its saved label names) in
 * any language, the other languages are filled in by AI, so a Telugu-speaking chef
 * reads the Owner's English item in Telugu. The typed text is kept exactly as typed,
 * under the language it is in.
 *
 * A check picked from the suggestion library is translated here too (15 Oct 2026):
 * the library's 588 checks are in English only. ECCS's basic checklists and its SOP
 * library are what is translated already; they never come here. A picked check is
 * translated once, and the translation is kept on the library entry for every later
 * pick (translation-filler.service.ts, `libraryPicked`).
 *
 * It runs after the save has answered, so saving never waits for AI and never fails
 * because of it. With AI off, nothing happens and only what was typed is kept, as
 * before; the filler of missing languages goes back to it later, when AI is on. If
 * the text is changed again before the translation comes back, the late translation
 * is thrown away (the `save` callback checks).
 *
 * Sends to the AI: only the text. Nothing about who typed it.
 */
@Injectable()
export class ContentTranslatorService {
  private readonly logger = new Logger(ContentTranslatorService.name);
  private readonly running = new Set<Promise<void>>();
  /** Translations under way that a second save of the same text joins instead of asking again (a suggestion picked twice). */
  private readonly sharing = new Map<string, Promise<FilledLanguages | null>>();
  /** When each text with a key was last saved by this server, for the filler's ten-minute wait. */
  private readonly saved = new Map<string, number>();

  constructor(
    private readonly ai: AiService,
    private readonly prisma: PrismaService,
  ) {}

  /** True when the restaurant's typed text is translated: the screens that edit it say so in one line. */
  get on(): boolean {
    return this.ai.isOn('translate-content');
  }

  /**
   * Starts filling in the other languages of `strings`, kept under `typedIn` at an
   * outlet, and hands the result to `save` when it is ready. Returns at once.
   *
   * `key` names the record (for example "checklistItem:<id>"): the filler of missing
   * languages leaves it alone for ten minutes, and a second job with the same key and
   * the same texts while the first is under way shares its answer instead of paying again.
   */
  later(
    job: Omit<TranslateJob, 'userId'> & {
      user: AuthUser;
      key?: string;
      save: (filled: FilledLanguages) => Promise<void>;
    },
  ): void {
    if (job.key) this.noteSaved(job.key);
    if (!this.on || job.strings.every((text) => !text.trim())) return;
    const shareKey = job.key ? `${job.key}\u0000${JSON.stringify(job.strings)}` : null;
    let filling = shareKey ? this.sharing.get(shareKey) : undefined;
    if (!filling) {
      const started = this.translate({ ...job, userId: job.user.id }).then((result) => result.filled);
      filling = started;
      if (shareKey) {
        this.sharing.set(shareKey, started);
        const done = () => {
          if (this.sharing.get(shareKey) === started) this.sharing.delete(shareKey);
        };
        started.then(done, done);
      }
    }
    const work = filling
      .then((filled) => (filled ? job.save(filled) : undefined))
      .catch((error: unknown) => this.logger.warn(`Could not save the other languages: ${String(error)}`));
    this.running.add(work);
    void work.finally(() => this.running.delete(work));
  }

  /** True when the text with this key was saved by this server after `since` (see OWN_TRANSLATION_GRACE_MS). */
  savedSince(key: string, since: Date): boolean {
    return (this.saved.get(key) ?? 0) > since.getTime();
  }

  /** Tests: waits until every translation started so far has been saved or given up. */
  async settled(): Promise<void> {
    while (this.running.size > 0) await Promise.allSettled(this.running);
  }

  private noteSaved(key: string) {
    const now = Date.now();
    // Only the last ten minutes matter: older entries are dropped as new ones come.
    for (const [old, at] of this.saved) if (at < now - OWN_TRANSLATION_GRACE_MS) this.saved.delete(old);
    this.saved.set(key, now);
  }

  /**
   * The texts in the languages asked for (all twelve unless `languages` says which),
   * as far as AI could give them, with the reason if it stopped short. Never throws
   * for an AI problem: AiService answers with a code instead.
   */
  async translate(job: TranslateJob): Promise<TranslateResult> {
    const outlet = await this.prisma.client.outlet.findUnique({ where: { id: job.outletId }, select: { organizationId: true } });
    const who = { userId: job.userId, organizationId: outlet?.organizationId ?? null, outletId: job.outletId };

    // On a save all twelve are asked for, the typed one too: the typed language is
    // detected in the same call, and if the text turns out to be in another language
    // (English typed while the app is in Telugu), the screen's language still gets its own.
    const wanted = job.languages ?? AI_LANGUAGES;
    // The output planned for each language: Indian scripts take about two tokens for
    // each English letter, plus the quotes and commas around each text.
    const chars = job.strings.reduce((total, text) => total + text.length, 0);
    const perLanguage = Math.ceil(chars * 2) + 15 * job.strings.length + 20;
    const perCall = Math.max(1, Math.floor(MAX_OUTPUT_TOKENS_PER_CALL / perLanguage));
    const groups: AiLanguage[][] = [];
    for (let start = 0; start < wanted.length; start += perCall) groups.push(wanted.slice(start, start + perCall));

    let source: AiLanguage | null = null;
    let code: AiErrorCode | null = null;
    const texts: Partial<Record<AiLanguage, string[]>> = {};
    for (const languages of groups) {
      const result = await this.ai.run<ContentTranslationAnswer>({
        feature: 'translate-content',
        model: AI_MODELS.haiku,
        instructions: contentTranslationInstructions(languages),
        text: JSON.stringify({ texts: job.strings }),
        answer: { schema: contentTranslationJsonSchema(languages), check: contentTranslationSchema(languages) },
        // Room for half as much again as planned: an answer cut off at its limit is lost and still paid for.
        maxOutputTokens: Math.min(16_000, Math.ceil(perLanguage * languages.length * 1.5) + 500),
        who,
        timeoutMs: TIMEOUT_MS,
        facts: { languages, strings: job.strings },
      });
      if (!result.ok) {
        code = result.code;
        break;
      }
      if (source === null) {
        source = job.sourceKnown || result.value.source === 'other' ? job.typedIn : result.value.source;
      }
      for (const language of languages) {
        const translated = result.value.languages[language];
        // A list of the wrong length would put steps out of line: that language is left out.
        if (translated?.length === job.strings.length && translated.every((text) => text.trim())) {
          texts[language] = translated.map((text) => text.trim());
        }
      }
    }
    if (source === null) return { filled: null, code };
    // The typed text stays exactly as typed, under the language it is in.
    texts[source] = job.strings;
    return { filled: { source, texts }, code };
  }
}

/** One of the texts (by its place in the list) in every language there is, ready to store. */
export function localizedAt(filled: FilledLanguages, index: number): LocalizedText {
  const entries = (Object.entries(filled.texts) as [AiLanguage, string[]][])
    .map(([language, list]) => [language, list[index]] as const)
    .filter((entry): entry is readonly [AiLanguage, string] => Boolean(entry[1]));
  return Object.fromEntries(entries) as LocalizedText;
}
