import { BadRequestException, Injectable } from '@nestjs/common';
import {
  AI_MODELS,
  PHOTO_CHECK_JSON_SCHEMA,
  PHOTO_CHECK_MAX_BYTES,
  photoCheckSchema,
  photoNudgeFor,
  type LocalizedText,
  type PhotoCheckAnswer,
  type PhotoCheckDto,
} from '@eccs/shared';
import { PHOTO_CHECK_INSTRUCTIONS } from '../ai/ai-prompts.js';
import { aiUnavailable, AiService } from '../ai/ai.service.js';
import type { AuthUser } from '../auth/auth.types.js';
import { sniffFile } from '../storage/attachments.controller.js';
import { ChecklistsService } from './checklists.service.js';

/** The phone gives up after about 6 seconds, so the server does too. */
const TIMEOUT_MS = 6_000;

/**
 * The nudge at the camera (feature 6, 14 Oct 2026). When a checklist proof photo is
 * taken and the phone has signal, it sends a small copy here with the check's id; if
 * the photo is clearly unusable as proof for that check (blurred, too dark, or of
 * something else), the phone shows a quiet "Retake?" under it. The photo itself is
 * saved exactly as before and never waits for this.
 *
 * The pattern is real-time capture-quality feedback in identity-check apps (didit,
 * iDenfy, Shufti Pro: "too dark", "blurred", "retake"), which tell the person at once
 * and let them retake, rather than rejecting the photo later.
 *
 * It never marks the item, never fails it, never reaches the office and is shown to
 * nobody else. It never judges whether the place is clean or the work was done.
 * Haiku only, for speed; it counts against the outlet's daily AI limit.
 *
 * Sends to the AI: the small copy of the photo and the check's wording. The picture
 * is not stored by this feature, and nothing about who took it is sent.
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
    const answer = await this.ai.run<PhotoCheckAnswer>({
      feature: 'photo-check',
      model: AI_MODELS.haiku,
      instructions: PHOTO_CHECK_INSTRUCTIONS,
      text: JSON.stringify({ check: wording }),
      file: { mimeType: image.mimeType, data: file.buffer },
      answer: { schema: PHOTO_CHECK_JSON_SCHEMA, check: photoCheckSchema },
      maxOutputTokens: 50,
      who: { userId: user.id, organizationId, outletId },
      timeoutMs: TIMEOUT_MS,
      facts: { check: wording },
    });
    if (!answer.ok) throw aiUnavailable(answer.code, 'The photo could not be checked just now');
    return { nudge: photoNudgeFor(answer.value.verdict), aiRequestId: answer.requestId };
  }
}

/** The check's wording in English when there is one, otherwise as the restaurant typed it. */
const english = (label: LocalizedText) => label.en ?? Object.values(label).find(Boolean) ?? '';
