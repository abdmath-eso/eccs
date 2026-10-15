import { BadRequestException, Injectable } from '@nestjs/common';
import {
  AI_ERROR,
  AI_LANGUAGE_NAMES,
  AI_MODELS,
  checkWording,
  PHOTO_CHECK_JSON_SCHEMA,
  PHOTO_CHECK_MAX_BYTES,
  photoCheckSchema,
  photoCheckWithin,
  photoNudgeFor,
  photoStandardForCheck,
  type AiLanguage,
  type PhotoCheckAnswer,
  type PhotoCheckDto,
  type PhotoStandard,
} from '@eccs/shared';
import { PHOTO_CHECK_INSTRUCTIONS } from '../ai/ai-prompts.js';
import { aiUnavailable, AiService } from '../ai/ai.service.js';
import type { AuthUser } from '../auth/auth.types.js';
import { sniffFile } from '../storage/attachments.controller.js';
import { ChecklistsService } from './checklists.service.js';
import { PhotoStandardService } from './photo-standard.service.js';

/** The phone gives up after about 8 seconds, so the server does too. */
const TIMEOUT_MS = 8_000;
/**
 * The longest the check waits for an item's photo standard to be made, the first time it
 * is needed (it usually takes a second or two). After that the photo is judged from the
 * wording alone, and the standard is kept for the next photo.
 */
const STANDARD_WAIT_MS = 3_500;
/** The judging itself is always given at least this long. */
const MIN_JUDGE_MS = 3_000;
/** Room for `seen` (about 15 words) and a reason of about 12 words in any of the twelve languages (Indian scripts take more tokens). */
const MAX_OUTPUT_TOKENS = 260;

/**
 * The nudge at the camera (feature 6, 14 Oct 2026). When a checklist proof photo is
 * taken and the phone has signal, it sends a small copy here with the check's id; the
 * phone shows a quiet note under the photo when the photo is clearly unusable as proof
 * for that check (blurred, too dark, or of something else), or clearly shows the check
 * not done ("This may not be done yet: Two bottles still have water in them."), with
 * Retake and Keep it. The photo itself is saved exactly as before and never waits for this.
 *
 * Since 15 Oct 2026 every photo is judged against the item's photo standard
 * (photo-standard.service.ts): what must be in the photo, what done and not done look like,
 * and whether a photo can show the check at all, written once from the item's wording. So
 * any check a restaurant writes ("TV is on", "Gas cylinder valve closed") is judged by what
 * it means. Where the standard says a photo cannot show the check, NOT_DONE is never shown
 * (photoCheckWithin), whatever the model says.
 *
 * Patterns: real-time capture-quality feedback in identity-check apps (didit, iDenfy,
 * Shufti Pro: "too dark", "blurred", "retake"), which tell the person at once and let
 * them retake rather than rejecting the photo later; and, for judging the check itself
 * (the founder's decision, 14 Oct 2026), AI photo verification in frontline task apps
 * (Xenia's AI photo verification, Palexy, CosaNostra, Taqtile's AI Verify), which checks
 * each photo against what the task asks and flags the exceptions without blocking the work.
 * Here the flag goes only to the person who took the photo, who decides. Microsoft HAX G2
 * (make clear it can be wrong: "Checked by AI, which can be wrong") and G9 (support
 * efficient correction: overriding it is one tap, Keep it).
 *
 * It never marks the item, never fails it, never changes the answer (OK or Problem),
 * never stops the checklist being submitted, never reaches the office and is shown to
 * nobody else. Haiku only, for speed; it counts against the outlet's daily AI limit.
 *
 * Sends to the AI: the small copy of the photo (first, as Anthropic's vision guide
 * advises), then the check's wording, its standard and the language on the person's screen
 * (sent with every request as X-App-Language), for the reason. The picture is not stored by
 * this feature, and nothing about who took it is sent. Only the verdict is kept on the
 * AiRequest row (resultCode), for measuring how often it was right; the reason is never
 * stored, and the model's `seen` note is dropped at once (never stored, logged or returned).
 */
@Injectable()
export class PhotoCheckService {
  constructor(
    private readonly checklists: ChecklistsService,
    private readonly ai: AiService,
    private readonly standards: PhotoStandardService,
  ) {}

  async check(user: AuthUser, runId: string, itemId: string, file: { buffer: Buffer; size: number } | undefined): Promise<PhotoCheckDto> {
    const { outletId, organizationId, date, item } = await this.checklists.requireAnswerable(user, runId, itemId);
    if (!file) throw new BadRequestException('A photo is required');
    const image = sniffFile(file.buffer, false);
    if (!image) throw new BadRequestException('Only JPEG, PNG or WebP photos are accepted');
    if (file.size > PHOTO_CHECK_MAX_BYTES) throw new BadRequestException('That photo is too large to check');

    const deadline = Date.now() + TIMEOUT_MS;
    const who = { userId: user.id, organizationId, outletId };
    const wording = checkWording(item.label);
    const language = user.contentLanguage.toLowerCase() as AiLanguage;

    // The item's photo standard: kept from before, or made now (the first time it is needed).
    let standard: PhotoStandard | null = null;
    if (this.ai.isOn('photo-check')) {
      const found = await this.standards.forCheck(item, who, STANDARD_WAIT_MS);
      // Over today's limit: the check would be refused too, so it is not asked.
      if (found.code === AI_ERROR.limit) throw aiUnavailable(found.code, 'The photo could not be checked just now');
      standard = found.standard ? photoStandardForCheck(found.standard) : null;
    }

    const answer = await this.ai.run<PhotoCheckAnswer>({
      feature: 'photo-check',
      model: AI_MODELS.haiku,
      instructions: PHOTO_CHECK_INSTRUCTIONS,
      text: JSON.stringify({ check: wording, standard, checklistDate: checklistDay(date), language: AI_LANGUAGE_NAMES[language] }),
      file: { mimeType: image.mimeType, data: file.buffer },
      answer: { schema: PHOTO_CHECK_JSON_SCHEMA, check: photoCheckSchema },
      maxOutputTokens: MAX_OUTPUT_TOKENS,
      who,
      timeoutMs: Math.max(deadline - Date.now(), MIN_JUDGE_MS),
      facts: { check: wording, language, standard, date },
      // The verdict only, as shown (never the reason, never `seen`): for counting how often the nudge was right.
      resultCode: (value) => photoCheckWithin(value, standard).verdict,
    });
    if (!answer.ok) throw aiUnavailable(answer.code, 'The photo could not be checked just now');
    return { ...photoNudgeFor(photoCheckWithin(answer.value, standard)), aiRequestId: answer.requestId };
  }
}

/**
 * The checklist's day written out the ways it may appear in a kitchen: "Thursday 15 October
 * 2026 (15/10/2026, 15-10-26)". Indian registers and boards write the day first. The
 * founder's decision (15 Oct 2026): the check is told the date, so an old date on a menu
 * board or an empty row for the day in a register can be noticed.
 */
function checklistDay(date: string): string {
  const day = new Date(`${date}T00:00:00.000Z`);
  const written = new Intl.DateTimeFormat('en-GB', { weekday: 'long', day: 'numeric', month: 'long', year: 'numeric', timeZone: 'UTC' }).format(day);
  const [year, month, dayOfMonth] = date.split('-');
  return `${written} (${dayOfMonth}/${month}/${year}, ${dayOfMonth}-${month}-${year!.slice(2)})`;
}
