import { BadRequestException, Injectable } from '@nestjs/common';
import {
  AI_LANGUAGE_NAMES,
  AI_MODELS,
  PHOTO_CHECK_JSON_SCHEMA,
  PHOTO_CHECK_MAX_BYTES,
  photoCheckSchema,
  photoNudgeFor,
  type AiLanguage,
  type LocalizedText,
  type PhotoCheckAnswer,
  type PhotoCheckDto,
} from '@eccs/shared';
import { PHOTO_CHECK_INSTRUCTIONS } from '../ai/ai-prompts.js';
import { aiUnavailable, AiService } from '../ai/ai.service.js';
import type { AuthUser } from '../auth/auth.types.js';
import { sniffFile } from '../storage/attachments.controller.js';
import { ChecklistsService } from './checklists.service.js';

/** The phone gives up after about 8 seconds, so the server does too. */
const TIMEOUT_MS = 8_000;
/** Room for a reason of about 12 words in any of the twelve languages (Indian scripts take more tokens). */
const MAX_OUTPUT_TOKENS = 200;

/**
 * The nudge at the camera (feature 6, 14 Oct 2026). When a checklist proof photo is
 * taken and the phone has signal, it sends a small copy here with the check's id; the
 * phone shows a quiet note under the photo when the photo is clearly unusable as proof
 * for that check (blurred, too dark, or of something else), or clearly shows the check
 * not done ("This may not be done yet: Two bottles still have water in them."), with
 * Retake and Keep it. The photo itself is saved exactly as before and never waits for this.
 *
 * Patterns: real-time capture-quality feedback in identity-check apps (didit, iDenfy,
 * Shufti Pro: "too dark", "blurred", "retake"), which tell the person at once and let
 * them retake rather than rejecting the photo later; and, for judging the check itself
 * (the founder's decision, 14 Oct 2026), AI photo verification in frontline task apps
 * (Xenia's AI photo verification, Palexy, CosaNostra), which checks each photo against
 * what the task asks and flags the exceptions without blocking the work. Here the flag
 * goes only to the person who took the photo, who decides. Microsoft HAX G2 (make clear
 * it can be wrong: "Checked by AI, which can be wrong") and G9 (support efficient
 * correction: overriding it is one tap, Keep it).
 *
 * It never marks the item, never fails it, never changes the answer (OK or Problem),
 * never stops the checklist being submitted, never reaches the office and is shown to
 * nobody else. Haiku only, for speed; it counts against the outlet's daily AI limit.
 *
 * Sends to the AI: the small copy of the photo, the check's wording and the language
 * on the person's screen (sent with every request as X-App-Language), for the reason.
 * The picture is not stored by this feature, and nothing about who took it is sent.
 * Only the verdict is kept on the AiRequest row (resultCode), for measuring how often
 * it was right; the reason is never stored.
 */
@Injectable()
export class PhotoCheckService {
  constructor(
    private readonly checklists: ChecklistsService,
    private readonly ai: AiService,
  ) {}

  async check(user: AuthUser, runId: string, itemId: string, file: { buffer: Buffer; size: number } | undefined): Promise<PhotoCheckDto> {
    const { outletId, organizationId, label } = await this.checklists.requireAnswerable(user, runId, itemId);
    if (!file) throw new BadRequestException('A photo is required');
    const image = sniffFile(file.buffer, false);
    if (!image) throw new BadRequestException('Only JPEG, PNG or WebP photos are accepted');
    if (file.size > PHOTO_CHECK_MAX_BYTES) throw new BadRequestException('That photo is too large to check');

    const wording = english(label);
    const language = user.contentLanguage.toLowerCase() as AiLanguage;
    const answer = await this.ai.run<PhotoCheckAnswer>({
      feature: 'photo-check',
      model: AI_MODELS.haiku,
      instructions: PHOTO_CHECK_INSTRUCTIONS,
      text: JSON.stringify({ check: wording, language: AI_LANGUAGE_NAMES[language] }),
      file: { mimeType: image.mimeType, data: file.buffer },
      answer: { schema: PHOTO_CHECK_JSON_SCHEMA, check: photoCheckSchema },
      maxOutputTokens: MAX_OUTPUT_TOKENS,
      who: { userId: user.id, organizationId, outletId },
      timeoutMs: TIMEOUT_MS,
      facts: { check: wording, language },
      // The verdict only, never the reason: for counting how often the nudge was right.
      resultCode: (value) => value.verdict,
    });
    if (!answer.ok) throw aiUnavailable(answer.code, 'The photo could not be checked just now');
    return { ...photoNudgeFor(answer.value), aiRequestId: answer.requestId };
  }
}

/** The check's wording in English when there is one, otherwise as the restaurant typed it. */
const english = (label: LocalizedText) => label.en ?? Object.values(label).find(Boolean) ?? '';
