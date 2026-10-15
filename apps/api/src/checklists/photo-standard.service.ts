import { Injectable, Logger } from '@nestjs/common';
import type { Prisma } from '@eccs/db';
import {
  AI_ERROR,
  AI_MODELS,
  checkWording,
  PHOTO_STANDARD_JSON_SCHEMA,
  photoStandardFits,
  photoStandardSchema,
  storedPhotoStandard,
  type AiErrorCode,
  type LocalizedText,
  type PhotoStandard,
  type StoredPhotoStandard,
} from '@eccs/shared';
import { PHOTO_STANDARD_INSTRUCTIONS } from '../ai/ai-prompts.js';
import { AiService, type AiWho } from '../ai/ai.service.js';
import { PrismaService } from '../prisma/prisma.service.js';

/** Writing a standard is a short answer with no picture; in the background it may take its time. */
const TIMEOUT_MS = 20_000;
/** Six short English sentences and fields fit well within this. */
const MAX_OUTPUT_TOKENS = 400;

/** A standard found or made for an item, or none, with the reason AI stepped aside if it did. */
export interface StandardFound {
  standard: StoredPhotoStandard | null;
  code: AiErrorCode | null;
}

/** An item as the photo check already holds it. */
export interface StandardItem {
  id: string;
  label: unknown;
  photoStandard: unknown;
}

const NONE: StandardFound = { standard: null, code: null };
const json = (value: StoredPhotoStandard) => value as unknown as Prisma.InputJsonValue;
/** True when an item still has the wording of the library suggestion it was picked from. */
const sameEnglish = (label: LocalizedText, entry: LocalizedText) => Boolean(label.en?.trim()) && label.en?.trim() === entry.en?.trim();

/**
 * The photo standard of a checklist item (15 Oct 2026): what a proof photo for it must show,
 * written once by AI (Haiku) from the item's wording and kept on the item, so the camera
 * nudge can judge any check a restaurant writes ("TV is on", "Main door locked") against
 * what that check means rather than against fixed examples. See ai-prompts.ts for the
 * pattern and its sources (per-step verification standards as in Taqtile's AI Verify;
 * rubric-grounded checking).
 *
 * When it is made:
 * - when a restaurant adds an item that needs a photo, or switches one to need a photo, in
 *   the background, so the first photo is already judged against it;
 * - otherwise the first time a photo of the item is checked (ECCS's basic items, items
 *   added while AI was off): the photo check waits a few seconds for it, and if it takes
 *   longer, that photo is judged from the wording alone and the standard is kept for the next.
 * It is made again only when the item's wording changes (photoStandardFits: translations
 * added later do not count as a change).
 *
 * A check picked from the suggestion library is done as the library's translations are
 * (translation-filler.service.ts): the standard is made once for the suggestion, kept on
 * the ChecklistLibraryItem, and copied to every item picked from it, then and later, with
 * no AI call. An item whose wording no longer matches its suggestion has a standard of its own.
 *
 * With AI off (or this feature switched off) nothing is made and the photo check judges from
 * the wording alone, as before. A standard is never shown to anyone; it is in English.
 *
 * Sends to the AI: the check's wording only. Nothing about who wrote it or who asks.
 */
@Injectable()
export class PhotoStandardService {
  private readonly logger = new Logger(PhotoStandardService.name);
  /** Standards being made, by what they are for and from which words: two photos of one item at once share one request. */
  private readonly making = new Map<string, Promise<StandardFound>>();
  /** Work started in the background, for tests to wait on. */
  private readonly running = new Set<Promise<unknown>>();

  constructor(
    private readonly prisma: PrismaService,
    private readonly ai: AiService,
  ) {}

  private get db() {
    return this.prisma.client;
  }

  /** True when standards may be made now. */
  get on(): boolean {
    return this.ai.isOn('photo-standard');
  }

  /**
   * For the photo check: the item's standard, made now if it has none that fits its
   * wording, waiting at most `waitMs`. One still being made after that is kept when it
   * comes, and this photo is judged from the wording alone (standard null). Never throws.
   */
  async forCheck(item: StandardItem, who: AiWho, waitMs: number): Promise<StandardFound> {
    const kept = storedPhotoStandard(item.photoStandard);
    if (kept && photoStandardFits(kept, item.label as LocalizedText)) return { standard: kept, code: null };
    if (!this.on) return NONE;
    const making = this.track(this.ensure(item.id, who));
    let timer: NodeJS.Timeout | undefined;
    const tooLate = new Promise<StandardFound>((resolve) => {
      timer = setTimeout(() => resolve(NONE), waitMs);
    });
    try {
      return await Promise.race([making, tooLate]);
    } finally {
      clearTimeout(timer);
    }
  }

  /**
   * In the background, for an item that has just been added with a photo, or switched to
   * need one: makes its standard (or copies its suggestion's) if it has none that fits.
   * Returns at once; the cost counts against `outletId`.
   */
  later(itemId: string, who: { userId: string | null; outletId: string }): void {
    if (!this.on) return;
    void this.track(
      (async () => {
        const outlet = await this.db.outlet.findUnique({ where: { id: who.outletId }, select: { organizationId: true } });
        return this.ensure(itemId, { userId: who.userId, organizationId: outlet?.organizationId ?? null, outletId: who.outletId });
      })().catch((error: unknown) => {
        this.logger.warn(`Could not start the photo standard of a checklist item: ${String(error)}`);
        return NONE;
      }),
    );
  }

  /** Tests: waits until every standard started so far has been kept or given up. */
  async settled(): Promise<void> {
    while (this.running.size > 0) await Promise.allSettled(this.running);
  }

  private track<T>(work: Promise<T>): Promise<T> {
    this.running.add(work);
    const done = () => this.running.delete(work);
    work.then(done, done);
    return work;
  }

  /**
   * The item's standard: the one it has if it fits its wording, else its suggestion's
   * (made once for the suggestion if need be), else a new one from its own wording, kept on
   * the item. Never throws: a failure is answered as "none" with AI_FAILED.
   */
  private async ensure(itemId: string, who: AiWho): Promise<StandardFound> {
    try {
      const item = await this.db.checklistItem.findUnique({
        where: { id: itemId },
        select: { id: true, label: true, photoStandard: true, libraryItem: { select: { id: true, text: true } } },
      });
      if (!item) return NONE;
      const label = item.label as LocalizedText;
      const kept = storedPhotoStandard(item.photoStandard);
      if (kept && photoStandardFits(kept, label)) return { standard: kept, code: null };

      // Picked from the library and still in its words: the suggestion's standard, made once for everyone who picks it.
      const entryText = item.libraryItem?.text as LocalizedText | undefined;
      if (item.libraryItem && entryText && sameEnglish(label, entryText)) {
        const found = await this.forSuggestion(item.libraryItem.id, who);
        if (found.standard) await this.copyFromSuggestion(item.libraryItem.id, found.standard);
        return found;
      }

      const wording = checkWording(label);
      if (!wording) return NONE;
      return await this.share(`item:${item.id}\u0000${wording}`, async () => {
        const made = await this.make(wording, who);
        if (made.standard) await this.keepOnItem(item.id, made.standard);
        return made;
      });
    } catch (error) {
      this.logger.warn(`Could not make the photo standard of a checklist item: ${String(error)}`);
      return { standard: null, code: AI_ERROR.failed };
    }
  }

  /** The suggestion's standard, made from its English and kept on it if it has none for that English. */
  private async forSuggestion(entryId: string, who: AiWho): Promise<StandardFound> {
    const entry = await this.db.checklistLibraryItem.findUnique({ where: { id: entryId }, select: { text: true, photoStandard: true } });
    const text = entry?.text as LocalizedText | undefined;
    const english = text?.en?.trim();
    if (!entry || !english) return NONE;
    const kept = storedPhotoStandard(entry.photoStandard);
    if (kept && photoStandardFits(kept, text)) return { standard: kept, code: null };
    return this.share(`library:${entryId}\u0000${english}`, async () => {
      const made = await this.make(english, who);
      if (made.standard) {
        // Kept only if the library has not been reloaded with new wording meanwhile.
        const now = await this.db.checklistLibraryItem.findUnique({ where: { id: entryId }, select: { text: true } });
        if ((now?.text as LocalizedText | undefined)?.en?.trim() === english) {
          await this.db.checklistLibraryItem.update({ where: { id: entryId }, data: { photoStandard: json(made.standard) } });
        }
      }
      return made;
    });
  }

  /** Gives the suggestion's standard to every item picked from it that is still in its words and has none that fits (no AI call). */
  private async copyFromSuggestion(entryId: string, standard: StoredPhotoStandard): Promise<void> {
    const items = await this.db.checklistItem.findMany({
      where: { libraryItemId: entryId, isActive: true },
      select: { id: true, label: true, photoStandard: true },
    });
    for (const item of items) {
      const label = item.label as LocalizedText;
      if (!photoStandardFits(standard, label)) continue;
      const kept = storedPhotoStandard(item.photoStandard);
      if (kept && photoStandardFits(kept, label)) continue;
      await this.db.checklistItem.update({ where: { id: item.id }, data: { photoStandard: json(standard) } });
    }
  }

  /** Keeps a standard on the item, unless its wording has changed while it was being made. */
  private async keepOnItem(itemId: string, standard: StoredPhotoStandard): Promise<void> {
    const now = await this.db.checklistItem.findUnique({ where: { id: itemId }, select: { label: true } });
    if (!now || !photoStandardFits(standard, now.label as LocalizedText)) return;
    await this.db.checklistItem.update({ where: { id: itemId }, data: { photoStandard: json(standard) } });
  }

  /** One request at a time for the same thing: a second asker joins the first. */
  private share(key: string, work: () => Promise<StandardFound>): Promise<StandardFound> {
    const already = this.making.get(key);
    if (already) return already;
    const started = work();
    this.making.set(key, started);
    const done = () => {
      if (this.making.get(key) === started) this.making.delete(key);
    };
    started.then(done, done);
    return started;
  }

  /** Asks Haiku to write the standard for this wording. Only the wording is sent. */
  private async make(wording: string, who: AiWho): Promise<StandardFound> {
    const result = await this.ai.run<PhotoStandard>({
      feature: 'photo-standard',
      model: AI_MODELS.haiku,
      instructions: PHOTO_STANDARD_INSTRUCTIONS,
      text: JSON.stringify({ check: wording }),
      answer: { schema: PHOTO_STANDARD_JSON_SCHEMA, check: photoStandardSchema },
      maxOutputTokens: MAX_OUTPUT_TOKENS,
      who,
      timeoutMs: TIMEOUT_MS,
      facts: { check: wording },
      // Only whether a photo can show the check (YES, PARTLY, NO), for seeing how many cannot.
      resultCode: (value) => value.photoCanShow.toUpperCase(),
    });
    if (!result.ok) return { standard: null, code: result.code };
    return { standard: { ...result.value, wording, madeAt: new Date().toISOString() }, code: null };
  }
}
