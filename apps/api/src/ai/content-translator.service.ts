import { Injectable, Logger } from '@nestjs/common';
import {
  AI_LANGUAGES,
  AI_MODELS,
  contentTranslationJsonSchema,
  contentTranslationSchema,
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

/** The most output one call is planned for; longer work is split across calls by language. */
const MAX_OUTPUT_PER_CALL = 12_000;
/** Translation runs in the background, so it may take longer than a question a person waits on. */
const TIMEOUT_MS = 90_000;

/**
 * Feature 2b (14 Oct 2026): when the restaurant saves text for its own kitchen (its
 * own checklist items and checklist names, its own SOPs, its saved label names) in
 * any language, the other languages are filled in by AI, so a Telugu-speaking chef
 * reads the Owner's English item in Telugu. The typed text is kept exactly as typed,
 * under the language it is in. ECCS's own library text is translated already and
 * never comes here.
 *
 * It runs after the save has answered, so saving never waits for AI and never fails
 * because of it. With AI off, nothing happens and only what was typed is kept, as
 * before. If the text is changed again before the translation comes back, the late
 * translation is thrown away (the `save` callback checks).
 *
 * Sends to the AI: only the typed text. Nothing about who typed it.
 */
@Injectable()
export class ContentTranslatorService {
  private readonly logger = new Logger(ContentTranslatorService.name);
  private readonly running = new Set<Promise<void>>();

  constructor(
    private readonly ai: AiService,
    private readonly prisma: PrismaService,
  ) {}

  /** True when the restaurant's typed text is translated: the screens that edit it say so in one line. */
  get on(): boolean {
    return this.ai.isOn('translate-content');
  }

  /**
   * Starts filling in the other languages of `strings`, typed in `typedIn` at an
   * outlet, and hands the result to `save` when it is ready. Returns at once.
   */
  later(job: {
    strings: string[];
    typedIn: AiLanguage;
    user: AuthUser;
    outletId: string;
    save: (filled: FilledLanguages) => Promise<void>;
  }): void {
    if (!this.on || job.strings.every((text) => !text.trim())) return;
    const work = this.fill(job)
      .then((filled) => (filled ? job.save(filled) : undefined))
      .catch((error: unknown) => this.logger.warn(`Could not save the other languages: ${String(error)}`));
    this.running.add(work);
    void work.finally(() => this.running.delete(work));
  }

  /** Tests: waits until every translation started so far has been saved or given up. */
  async settled(): Promise<void> {
    while (this.running.size > 0) await Promise.allSettled(this.running);
  }

  /** The texts in all twelve languages, or null if AI could not give them. */
  private async fill(job: { strings: string[]; typedIn: AiLanguage; user: AuthUser; outletId: string }): Promise<FilledLanguages | null> {
    const outlet = await this.prisma.client.outlet.findUnique({ where: { id: job.outletId }, select: { organizationId: true } });
    const who = { userId: job.user.id, organizationId: outlet?.organizationId ?? null, outletId: job.outletId };

    // All twelve are asked for, the typed one too: the typed language is detected in
    // the same call, and if the text turns out to be in another language (English
    // typed while the app is in Telugu), the screen's language still gets its own.
    const chars = job.strings.reduce((total, text) => total + text.length, 0);
    const perLanguage = Math.ceil(chars * 0.8) + 20 * job.strings.length + 20;
    const perCall = Math.max(1, Math.floor(MAX_OUTPUT_PER_CALL / perLanguage));
    const groups: AiLanguage[][] = [];
    for (let start = 0; start < AI_LANGUAGES.length; start += perCall) groups.push(AI_LANGUAGES.slice(start, start + perCall));

    let source: AiLanguage | null = null;
    const texts: Partial<Record<AiLanguage, string[]>> = {};
    for (const languages of groups) {
      const result = await this.ai.run<ContentTranslationAnswer>({
        feature: 'translate-content',
        model: AI_MODELS.haiku,
        instructions: contentTranslationInstructions(languages),
        text: JSON.stringify({ texts: job.strings }),
        answer: { schema: contentTranslationJsonSchema(languages), check: contentTranslationSchema(languages) },
        maxOutputTokens: Math.min(16_000, Math.ceil(perLanguage * languages.length * 1.5) + 500),
        who,
        timeoutMs: TIMEOUT_MS,
        facts: { languages, strings: job.strings },
      });
      if (!result.ok) break;
      if (source === null) source = result.value.source === 'other' ? job.typedIn : result.value.source;
      for (const language of languages) {
        const translated = result.value.languages[language];
        // A list of the wrong length would put steps out of line: that language is left out.
        if (translated?.length === job.strings.length && translated.every((text) => text.trim())) {
          texts[language] = translated.map((text) => text.trim());
        }
      }
    }
    if (source === null) return null;
    // The typed text stays exactly as typed, under the language it is in.
    texts[source] = job.strings;
    return { source, texts };
  }
}

/** One of the texts (by its place in the list) in every language there is, ready to store. */
export function localizedAt(filled: FilledLanguages, index: number): LocalizedText {
  const entries = (Object.entries(filled.texts) as [AiLanguage, string[]][])
    .map(([language, list]) => [language, list[index]] as const)
    .filter((entry): entry is readonly [AiLanguage, string] => Boolean(entry[1]));
  return Object.fromEntries(entries) as LocalizedText;
}
