import { Injectable } from '@nestjs/common';
import {
  AI_MODELS,
  cleanShopBoardAnswer,
  SHOP_BOARD_JSON_SCHEMA,
  shopBoardAnswerSchema,
  type AiErrorCode,
  type ShopBoardAnswer,
  type ShopBoardReadingDto,
} from '@eccs/shared';
import { SHOP_BOARD_INSTRUCTIONS } from '../ai/ai-prompts.js';
import { AiService } from '../ai/ai.service.js';

const READ_TIMEOUT_MS = 30_000;
/** The board's words plus four short fields: a few hundred tokens are plenty. */
const MAX_OUTPUT_TOKENS = 700;

/**
 * Reads a photo of a restaurant's shop board into the BDE's "Log a lead" form (16 Oct
 * 2026): the business name, the locality and address, and a mobile number if one is
 * painted on it. The BDE checks every field before saving; nothing is saved here.
 *
 * Haiku reads it, once (a board is short, and a second, stronger try is not worth the
 * wait in the street). It counts against ECCS's overall daily AI limit, never an outlet's:
 * a lead is not a client yet (PLATFORM_ONLY_FEATURES in ai.service.ts). With AI off, over
 * its limit or failing, the answer says so with its code and the form is simply typed.
 * Sends to the AI: the photo, nothing else.
 */
@Injectable()
export class ShopBoardReaderService {
  constructor(private readonly ai: AiService) {}

  isOn(): boolean {
    return this.ai.isOn('shop-board');
  }

  async read(photo: { data: Buffer; mimeType: string }, userId: string): Promise<{ ok: true; reading: ShopBoardReadingDto } | { ok: false; code: AiErrorCode }> {
    const result = await this.ai.run<ShopBoardAnswer>({
      feature: 'shop-board',
      model: AI_MODELS.haiku,
      instructions: SHOP_BOARD_INSTRUCTIONS,
      text: 'Read this shop board.',
      file: photo,
      answer: { schema: SHOP_BOARD_JSON_SCHEMA, check: shopBoardAnswerSchema },
      maxOutputTokens: MAX_OUTPUT_TOKENS,
      who: { userId, organizationId: null, outletId: null },
      timeoutMs: READ_TIMEOUT_MS,
      // How much was read, for measuring: never any of the words.
      resultCode: (answer) => {
        const cleaned = cleanShopBoardAnswer(answer);
        return [cleaned.businessName && 'NAME', cleaned.area && 'AREA', cleaned.address && 'ADDRESS', cleaned.phone && 'MOBILE'].filter(Boolean).join('+') || 'NOTHING';
      },
    });
    if (!result.ok) return { ok: false, code: result.code };
    // `seen` is left behind here: only the fields go back to the phone.
    return { ok: true, reading: { ...cleanShopBoardAnswer(result.value), aiRequestId: result.requestId } };
  }
}
