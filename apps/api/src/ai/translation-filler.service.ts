import { Injectable, Logger, type OnModuleDestroy, type OnModuleInit } from '@nestjs/common';
import type { Prisma } from '@eccs/db';
import { addMissingLanguages, AI_ERROR, AI_LANGUAGES, missingLanguages, type AiLanguage, type LocalizedText } from '@eccs/shared';
import { ActivityLogService } from '../activity-log/activity-log.service.js';
import type { AuthUser } from '../auth/auth.types.js';
import { env } from '../config/env.js';
import { PrismaService } from '../prisma/prisma.service.js';
import { AiService } from './ai.service.js';
import { ContentTranslatorService, localizedAt, OWN_TRANSLATION_GRACE_MS, type FilledLanguages } from './content-translator.service.js';

// Filling in missing languages (15 Oct 2026). Translation of the restaurant's own text
// runs at the moment it is saved (content-translator.service.ts), so some text never got
// its other languages: text saved before AI existed, while it was off or over its daily
// limit, or when a translation failed; and checks picked from the suggestion library,
// which is in English only (STATUS, 5 Oct 2026) and was wrongly thought translated.
//
// Two things here put that right:
// 1. `libraryPicked`: when a restaurant picks a suggestion that is not in all twelve
//    languages yet, its English is translated once, in the background, and kept on the
//    library entry itself; the new item gets the same. Every later pick of that
//    suggestion, by any restaurant, copies the languages with no AI call.
// 2. `run`, a timed job a minute after the server starts and then every hour: it finds
//    the restaurant's own texts with fewer than twelve languages and fills in only the
//    missing ones. A language that is there, and the typed original, are never changed.
//
// What it looks at: active checklist items of a restaurant's own (and the library
// entries they were picked from), the names of checklists a restaurant created, its own
// SOPs (title and steps) and its active saved label names. Never ECCS's own text (basic
// checklists and their items, standard SOPs: those have no outlet), and never a
// library entry nobody has picked.
//
// Spending: each call counts against the outlet the text belongs to, as on a save, and
// the job asks AiService before each outlet: over the platform's daily limit, or with
// AI off, the run stops; over one outlet's limit, that outlet waits for the next run.
// At most 50 texts a run, so a large backlog is spread over several hours. Short texts
// of one outlet go together in one call. Text saved in the last ten minutes is left
// alone: its own translation may still be running.
//
// Sends to the AI: only the texts. Nothing about who wrote them.

/** The first run, a minute after the server starts, then one every hour. */
const FIRST_RUN_AFTER_MS = 60_000;
const RUN_EVERY_MS = 60 * 60_000;
/** The most texts one run fills in; the rest wait for the next run. */
export const FILL_MAX_TEXTS_PER_RUN = 50;
/** Texts of one outlet go together in one call up to this many strings, or this many letters. */
const MAX_STRINGS_PER_CALL = 30;
const MAX_CHARS_PER_CALL = 1_500;

/** The key a checklist item's save is noted under (ContentTranslatorService.later). */
export const checklistItemKey = (id: string) => `checklistItem:${id}`;
/** The key a library entry's translation is noted and shared under. */
const libraryKey = (id: string) => `library:${id}`;

/** What kind of text: a checklist item, a checklist's name, an SOP, a saved label's name, a library entry. */
export type FillKind = 'item' | 'list' | 'sop' | 'label' | 'library';
const KIND_ORDER: Record<FillKind, number> = { library: 0, item: 1, list: 2, sop: 3, label: 4 };

/** A text that is missing languages. */
export interface FillWaiting {
  kind: FillKind;
  id: string;
  /** The outlet whose daily AI allowance pays for it (for a library entry, an outlet that picked it). */
  outletId: string;
  /** The language the text is read from. */
  source: AiLanguage;
  /** True for a library entry: certainly English. */
  sourceKnown: boolean;
  /** What is sent: the text, or an SOP's title followed by its steps. */
  strings: string[];
  /** The languages to add. */
  missing: AiLanguage[];
  /** What is stored now (an SOP's title, or the text itself), written back only if nobody has changed it meanwhile. */
  stored: LocalizedText;
  /** An SOP's steps as stored now. */
  storedBody?: LocalizedText;
}

/** Which texts a run looks at: all of them, or (tests) only some outlets'; and the time it counts as. */
export interface FillScope {
  outletIds?: string[];
  now?: Date;
}

/** What one run did. */
export interface FillReport {
  /** Texts given their missing languages, by kind. */
  items: number;
  lists: number;
  sops: number;
  labels: number;
  library: number;
  /** Checklist items given their library entry's languages (no AI call). */
  copied: number;
  /** Left alone for now: saved in the last ten minutes. */
  recent: number;
  /** Still missing languages after this run (over the run's 50, a limit, AI off, a failed call): tried again next run. */
  waiting: number;
  /** Texts whose call failed. */
  failed: number;
  /** Outlets that waited because their own daily AI allowance is used up. */
  overLimit: number;
  /** Why the run stopped early: AI is off, or the platform's daily (or, since 19 Oct 2026, monthly) AI allowance is used up. */
  stopped: 'AI_OFF' | 'DAILY_LIMIT' | 'MONTH_LIMIT' | null;
}

const KIND_COUNT: Record<FillKind, 'items' | 'lists' | 'sops' | 'labels' | 'library'> = {
  item: 'items',
  list: 'lists',
  sop: 'sops',
  label: 'labels',
  library: 'library',
};

const json = (value: LocalizedText) => value as Prisma.InputJsonValue;
const hasText = (value: string | undefined): value is string => Boolean(value?.trim());
/** An SOP's steps, one a line, as the app shows them. */
const stepsOf = (body: string | undefined) =>
  (body ?? '')
    .split('\n')
    .map((line) => line.trim())
    .filter(Boolean);
/** True when an item still has the wording of the library entry it was picked from. */
const sameEnglish = (label: LocalizedText, entry: LocalizedText) => hasText(label.en) && label.en.trim() === entry.en?.trim();

/** The language a text is read from: the one it was typed in, else English, else the first there is. */
function sourceOf(text: LocalizedText, typedLanguage: string | null, also?: LocalizedText): AiLanguage | null {
  const order = [typedLanguage, 'en', ...AI_LANGUAGES].filter((code): code is AiLanguage => (AI_LANGUAGES as readonly string[]).includes(code ?? ''));
  return order.find((code) => hasText(text[code]) && (!also || hasText(also[code]))) ?? null;
}

@Injectable()
export class TranslationFillerService implements OnModuleInit, OnModuleDestroy {
  private readonly logger = new Logger(TranslationFillerService.name);
  private timers: NodeJS.Timeout[] = [];
  private busy = false;

  constructor(
    private readonly prisma: PrismaService,
    private readonly ai: AiService,
    private readonly translator: ContentTranslatorService,
    private readonly activity: ActivityLogService,
  ) {}

  private get db() {
    return this.prisma.client;
  }

  /** Fills in missing languages a minute after the server starts and every hour after that. */
  onModuleInit() {
    // Tests run it themselves, at moments they choose.
    if (env.NODE_ENV === 'test') return;
    const run = () =>
      void this.run()
        .then((report) => {
          if (!report) return;
          const filled = report.items + report.lists + report.sops + report.labels + report.library;
          if (filled + report.copied + report.failed > 0) {
            this.logger.log(`Missing languages filled in: ${filled} texts, ${report.copied} copied from the library, ${report.waiting} waiting`);
          }
        })
        .catch((error) => {
          this.activity.jobRun('system.translations.filled', null, { error });
          this.logger.warn(`Could not fill in missing languages: ${String(error)}`);
        });
    const first = setTimeout(run, FIRST_RUN_AFTER_MS);
    const repeat = setInterval(run, RUN_EVERY_MS);
    // Neither keeps the server alive when it is asked to stop.
    first.unref();
    repeat.unref();
    this.timers = [first, repeat];
  }

  onModuleDestroy() {
    for (const timer of this.timers) clearTimeout(timer);
  }

  // ───────────────────────── A suggestion picked from the library ─────────────────────────

  /**
   * A restaurant has just picked `entry` from the suggestion library at an outlet; the
   * new item already has every language the entry has. If the entry is missing some,
   * its English is translated in the background (once, however many pick it meanwhile),
   * the result is kept on the entry, and every item picked from it gets the same.
   */
  libraryPicked(user: AuthUser, entry: { id: string; text: unknown }, outletId: string): void {
    const text = entry.text as LocalizedText;
    const english = text.en?.trim();
    const missing = missingLanguages(text);
    if (!english || missing.length === 0) return;
    this.translator.later({
      strings: [english],
      typedIn: 'en',
      sourceKnown: true,
      languages: missing,
      user,
      outletId,
      key: libraryKey(entry.id),
      save: async (filled) => {
        await this.saveLibraryEntry(entry.id, english, localizedAt(filled, 0));
        await this.copyFromLibrary({ entryIds: [entry.id] });
      },
    });
  }

  /** Adds the languages the entry is missing; its English and any language it has are never changed. */
  private async saveLibraryEntry(entryId: string, english: string, filled: LocalizedText): Promise<boolean> {
    const current = await this.db.checklistLibraryItem.findUnique({ where: { id: entryId }, select: { text: true } });
    const text = current?.text as LocalizedText | undefined;
    // The library was reloaded with new wording meanwhile: this translation is of the old one.
    if (!text || text.en?.trim() !== english) return false;
    const merged = addMissingLanguages(text, filled);
    if (!merged) return false;
    const { count } = await this.db.checklistLibraryItem.updateMany({ where: { id: entryId, text: { equals: json(text) } }, data: { text: json(merged) } });
    return count > 0;
  }

  /**
   * Gives checklist items picked from the library the languages their entry has and
   * they do not (no AI call). An item whose English no longer matches its entry (the
   * library was reworded since) is left to be translated as an item of its own.
   */
  private async copyFromLibrary(where: { entryIds?: string[]; outletIds?: string[] | undefined }): Promise<number> {
    const items = await this.db.checklistItem.findMany({
      where: {
        isActive: true,
        outletId: where.outletIds ? { in: where.outletIds } : { not: null },
        libraryItemId: where.entryIds ? { in: where.entryIds } : { not: null },
      },
      select: { id: true, label: true, libraryItem: { select: { text: true } } },
    });
    let copied = 0;
    for (const item of items) {
      const label = item.label as LocalizedText;
      const entry = item.libraryItem?.text as LocalizedText | undefined;
      if (!entry || !sameEnglish(label, entry)) continue;
      const merged = addMissingLanguages(label, entry);
      if (!merged) continue;
      const { count } = await this.db.checklistItem.updateMany({ where: { id: item.id, label: { equals: json(label) } }, data: { label: json(merged) } });
      copied += count;
    }
    return copied;
  }

  // ───────────────────────── The timed job ─────────────────────────

  /**
   * One run: copies library languages to items picked from translated entries, then
   * fills in up to 50 waiting texts, outlet by outlet, and writes one activity log row
   * with the counts (none when there was nothing to do). Null if a run is already going.
   */
  async run(scope: FillScope = {}): Promise<FillReport | null> {
    if (this.busy) return null;
    this.busy = true;
    try {
      return await this.fillWaiting(scope);
    } finally {
      this.busy = false;
    }
  }

  private async fillWaiting(scope: FillScope): Promise<FillReport> {
    const report: FillReport = { items: 0, lists: 0, sops: 0, labels: 0, library: 0, copied: 0, recent: 0, waiting: 0, failed: 0, overLimit: 0, stopped: null };
    // Free first: suggestions translated since an item was picked from them.
    report.copied += await this.copyFromLibrary({ outletIds: scope.outletIds });

    const { texts, recent } = await this.findWaiting(scope);
    report.recent = recent;
    const thisRun = texts.slice(0, FILL_MAX_TEXTS_PER_RUN);
    report.waiting = texts.length - thisRun.length;

    if (!this.translator.on) {
      report.stopped = AI_ERROR.off;
      report.waiting += thisRun.length;
      return this.finish(report);
    }

    const overLimit = new Set<string>();
    const filledEntries: string[] = [];
    for (const call of callsFor(thisRun)) {
      if (report.stopped || overLimit.has(call.outletId)) {
        report.waiting += call.texts.length;
        continue;
      }
      // Asked before each call, so a limit stops the run without a refused request each time.
      const limit = await this.ai.limitReached(call.outletId);
      if (limit) {
        if (limit === 'OUTLET_LIMIT') overLimit.add(call.outletId);
        else report.stopped = limit;
        report.waiting += call.texts.length;
        continue;
      }

      const languages = AI_LANGUAGES.filter((language) => call.texts.some((text) => text.missing.includes(language)));
      const result = await this.translator.translate({
        strings: call.texts.flatMap((text) => text.strings),
        typedIn: call.source,
        sourceKnown: call.sourceKnown,
        languages,
        userId: null,
        outletId: call.outletId,
      });

      let offset = 0;
      for (const text of call.texts) {
        const written = result.filled ? await this.write(text, result.filled, offset) : { added: false, complete: false };
        offset += text.strings.length;
        if (written.added) {
          report[KIND_COUNT[text.kind]] += 1;
          if (text.kind === 'library') filledEntries.push(text.id);
        }
        if (!written.complete) {
          report.waiting += 1;
          if (result.code === AI_ERROR.failed) report.failed += 1;
        }
      }

      if (result.code === AI_ERROR.off) report.stopped = AI_ERROR.off;
      else if (result.code === AI_ERROR.limit) {
        // Reached during this call: whose limit was it?
        const reached = await this.ai.limitReached(call.outletId);
        if (reached === 'OUTLET_LIMIT') overLimit.add(call.outletId);
        else report.stopped = reached ?? 'DAILY_LIMIT';
      }
    }
    report.overLimit = overLimit.size;

    // Items picked from the entries just translated get the same languages.
    if (filledEntries.length > 0) report.copied += await this.copyFromLibrary({ entryIds: filledEntries, outletIds: scope.outletIds });
    return this.finish(report);
  }

  /** One activity log row for a run that did something, failed or was held back by a limit; none for an empty run. */
  private finish(report: FillReport): FillReport {
    const filled = report.items + report.lists + report.sops + report.labels + report.library;
    if (filled + report.copied + report.failed + report.overLimit > 0 || report.stopped === 'DAILY_LIMIT' || report.stopped === 'MONTH_LIMIT') {
      this.activity.system('system.translations.filled', { details: { filled, ...report } });
    }
    return report;
  }

  /**
   * Every text in scope that is missing languages, library entries first, then by
   * outlet, with how many were left alone because they were saved in the last ten
   * minutes. Reads only.
   */
  async findWaiting(scope: FillScope = {}): Promise<{ texts: FillWaiting[]; recent: number }> {
    const since = new Date((scope.now ?? new Date()).getTime() - OWN_TRANSLATION_GRACE_MS);
    const outlet = scope.outletIds ? { in: scope.outletIds } : { not: null };
    const texts: FillWaiting[] = [];
    let recent = 0;
    const add = (text: FillWaiting | null, isRecent: boolean) => {
      if (!text) return;
      if (isRecent) recent += 1;
      else texts.push(text);
    };

    // The restaurant's own checklist items. One picked from the library and still in its
    // words is filled through its library entry, once for everyone who picked it.
    // (Items have no time of saving: the server notes its own saves for ten minutes.)
    const items = await this.db.checklistItem.findMany({
      where: { isActive: true, outletId: outlet },
      select: { id: true, outletId: true, label: true, typedLanguage: true, libraryItem: { select: { id: true, text: true } } },
      orderBy: { id: 'asc' },
    });
    const entries = new Map<string, { outletId: string; text: LocalizedText; recent: boolean }>();
    for (const item of items) {
      const label = item.label as LocalizedText;
      const entryText = item.libraryItem?.text as LocalizedText | undefined;
      const isRecent = this.translator.savedSince(checklistItemKey(item.id), since);
      if (item.libraryItem && entryText && sameEnglish(label, entryText)) {
        if (missingLanguages(entryText).length === 0) continue;
        const entryId = item.libraryItem.id;
        const pickedRecently = isRecent || this.translator.savedSince(libraryKey(entryId), since);
        const known = entries.get(entryId);
        if (!known) entries.set(entryId, { outletId: item.outletId!, text: entryText, recent: pickedRecently });
        else if (pickedRecently) known.recent = true;
        continue;
      }
      add(this.single('item', item.id, item.outletId!, label, item.typedLanguage), isRecent);
    }
    for (const [id, entry] of entries) add(this.single('library', id, entry.outletId, entry.text, 'en', true), entry.recent);

    // Names of checklists a restaurant created.
    const lists = await this.db.checklistTemplate.findMany({
      where: { isActive: true, outletId: outlet },
      select: { id: true, outletId: true, title: true, typedLanguage: true, updatedAt: true },
    });
    for (const list of lists) add(this.single('list', list.id, list.outletId!, list.title as LocalizedText, list.typedLanguage), list.updatedAt > since);

    // The restaurant's own SOPs: the title and every step.
    const sops = await this.db.sopTemplate.findMany({
      where: { outletId: outlet },
      select: { id: true, outletId: true, title: true, body: true, typedLanguage: true, updatedAt: true },
    });
    for (const sop of sops) add(this.sop(sop.id, sop.outletId!, sop.title as LocalizedText, sop.body as LocalizedText, sop.typedLanguage), sop.updatedAt > since);

    // Saved label names in use.
    const foods = await this.db.foodItem.findMany({
      where: { isActive: true, ...(scope.outletIds && { outletId: { in: scope.outletIds } }) },
      select: { id: true, outletId: true, name: true, typedLanguage: true, updatedAt: true },
    });
    for (const food of foods) add(this.single('label', food.id, food.outletId, food.name as LocalizedText, food.typedLanguage), food.updatedAt > since);

    // Library entries first (one translation serves every item picked from them), then outlet by outlet.
    const libraryFirst = (text: FillWaiting) => (text.kind === 'library' ? 0 : 1);
    texts.sort((a, b) => libraryFirst(a) - libraryFirst(b) || a.outletId.localeCompare(b.outletId) || KIND_ORDER[a.kind] - KIND_ORDER[b.kind]);
    return { texts, recent };
  }

  /** A one-string text that is missing languages, or null. */
  private single(kind: FillKind, id: string, outletId: string, text: LocalizedText | null, typedLanguage: string | null, sourceKnown = false): FillWaiting | null {
    const stored = text ?? {};
    const missing = missingLanguages(stored);
    const source = sourceKnown ? (hasText(stored.en) ? 'en' : null) : sourceOf(stored, typedLanguage);
    if (missing.length === 0 || !source) return null;
    return { kind, id, outletId, source, sourceKnown, strings: [stored[source]!.trim()], missing, stored };
  }

  /** An SOP that is missing languages in its title or steps, or null. */
  private sop(id: string, outletId: string, title: LocalizedText | null, body: LocalizedText | null, typedLanguage: string | null): FillWaiting | null {
    const storedTitle = title ?? {};
    const storedBody = body ?? {};
    // Read from a language that has both the title and the steps, if there is one.
    const source = sourceOf(storedTitle, typedLanguage, storedBody) ?? sourceOf(storedTitle, typedLanguage);
    if (!source) return null;
    const steps = stepsOf(storedBody[source]);
    const missing = AI_LANGUAGES.filter(
      (language) => missingLanguages(storedTitle).includes(language) || (steps.length > 0 && missingLanguages(storedBody).includes(language)),
    );
    if (missing.length === 0) return null;
    return { kind: 'sop', id, outletId, source, sourceKnown: false, strings: [storedTitle[source]!.trim(), ...steps], missing, stored: storedTitle, storedBody };
  }

  /**
   * Writes the languages a text was missing, from its place in the call's answer, only
   * if nobody has changed the text since it was read. Says whether anything was added
   * and whether the text now has all twelve.
   */
  private async write(text: FillWaiting, filled: FilledLanguages, offset: number): Promise<{ added: boolean; complete: boolean }> {
    const answer = Object.entries(filled.texts) as [AiLanguage, string[]][];
    const at = (index: number) => Object.fromEntries(answer.flatMap(([language, list]) => (list[offset + index] ? [[language, list[offset + index]!]] : []))) as LocalizedText;
    const notChanged = (value: LocalizedText) => ({ equals: json(value) });

    if (text.kind === 'sop') {
      const body = text.storedBody ?? {};
      const stepCount = text.strings.length - 1;
      const steps: LocalizedText = {};
      for (const [language, list] of answer) {
        const lines = list.slice(offset + 1, offset + text.strings.length);
        if (stepCount > 0 && lines.length === stepCount && lines.every((line) => line.trim())) steps[language] = lines.join('\n');
      }
      const title = addMissingLanguages(text.stored, at(0));
      const newBody = stepCount > 0 ? addMissingLanguages(body, steps) : null;
      const complete = (value: LocalizedText) => missingLanguages(value).length === 0;
      if (!title && !newBody) return { added: false, complete: false };
      const { count } = await this.db.sopTemplate.updateMany({
        where: { id: text.id, title: notChanged(text.stored), body: notChanged(body) },
        data: { ...(title && { title: json(title) }), ...(newBody && { body: json(newBody) }) },
      });
      return { added: count > 0, complete: count > 0 && complete(title ?? text.stored) && (stepCount === 0 || complete(newBody ?? body)) };
    }

    const merged = addMissingLanguages(text.stored, at(0));
    if (!merged) return { added: false, complete: false };
    const where = { id: text.id };
    let count = 0;
    if (text.kind === 'item') count = (await this.db.checklistItem.updateMany({ where: { ...where, label: notChanged(text.stored) }, data: { label: json(merged) } })).count;
    if (text.kind === 'list') count = (await this.db.checklistTemplate.updateMany({ where: { ...where, title: notChanged(text.stored) }, data: { title: json(merged) } })).count;
    if (text.kind === 'label') count = (await this.db.foodItem.updateMany({ where: { ...where, name: notChanged(text.stored) }, data: { name: json(merged) } })).count;
    if (text.kind === 'library') {
      const english = text.strings[0]!;
      count = (await this.saveLibraryEntry(text.id, english, at(0))) ? 1 : 0;
    }
    return { added: count > 0, complete: count > 0 && missingLanguages(merged).length === 0 };
  }
}

/** One call's worth of texts: one outlet, one source language, at most 30 strings or 1,500 letters (an SOP is never split). */
interface Call {
  outletId: string;
  source: AiLanguage;
  sourceKnown: boolean;
  texts: FillWaiting[];
}

function callsFor(texts: FillWaiting[]): Call[] {
  const groups = new Map<string, Call[]>();
  for (const text of texts) {
    const key = `${text.outletId}|${text.source}|${text.sourceKnown}`;
    const calls = groups.get(key) ?? [];
    groups.set(key, calls);
    const last = calls.at(-1);
    const size = (call: Call) => call.texts.reduce((total, other) => total + other.strings.length, 0);
    const letters = (call: Call) => call.texts.reduce((total, other) => total + other.strings.join('').length, 0);
    if (
      last &&
      size(last) + text.strings.length <= MAX_STRINGS_PER_CALL &&
      letters(last) + text.strings.join('').length <= MAX_CHARS_PER_CALL
    ) {
      last.texts.push(text);
    } else {
      calls.push({ outletId: text.outletId, source: text.source, sourceKnown: text.sourceKnown, texts: [text] });
    }
  }
  return [...groups.values()].flat();
}
