import { Logger } from '@nestjs/common';
import type { AiModelId, AiUsage } from '@eccs/shared';
import {
  AiEngineError,
  type AiContentBlock,
  type AiConverseAnswer,
  type AiConverseRequest,
  type AiEngine,
  type AiEngineAnswer,
  type AiEngineRequest,
} from './ai-engine.js';

// Anthropic's Messages API, called with plain `fetch` (no npm package: the REST API is
// small, and installing packages on this PC fails while the founder's API is running).
// Everything below follows Anthropic's own pages, read on 14 Oct 2026:
// - Messages API reference (platform.claude.com/docs/en/api/messages/create): the
//   address, the three headers, and `metadata.user_id`, which must be an opaque id
//   and never a name, email or phone number.
// - Structured outputs (.../build-with-claude/structured-outputs): the answer's shape
//   is given as `output_config.format` = { type: "json_schema", schema }, and comes
//   back as JSON in the first text block. Used instead of forcing a tool, because
//   Sonnet 5.5 refuses a forced `tool_choice` with a 400 (.../api/errors, "Forced tool
//   use not supported"; .../build-with-claude/thinking). The answer is only certain
//   to fit when `stop_reason` is "end_turn": "refusal" and "max_tokens" are failures.
// - Effort and thinking (.../build-with-claude/effort, .../thinking): these tasks
//   need no thinking. Haiku 5.5 turns it off with { type: "disabled" }, Sonnet 5.5
//   with { type: "between_tools" }, both only at effort "high" or below; Opus 5.5
//   cannot turn it off. Thinking would be billed as output tokens.
// - Vision (.../build-with-claude/vision): a base64 image block before the text;
//   JPEG, PNG, GIF or WebP; at most 10 MB; Claude reads 28 × 28-pixel patches, so a
//   2000 × 1500 photo is about 3,900 tokens; rotated or blurred photos read worse.
// - PDF support (.../build-with-claude/pdf-support): a base64 "document" block before
//   the text; each page is read as text and as a picture; no passwords.
// - Errors and rate limits (.../api/errors, .../api/rate-limits): 429 (with
//   `retry-after`), 500 and 529 are worth trying again after a pause; 400, 401, 403
//   and 413 are not. A 429 with error_code "enforced_spend_limit_reached" (the
//   monthly spend cap) has no `retry-after` and keeps failing, so it is not retried.

const MESSAGES_URL = 'https://api.anthropic.com/v1/messages';
const API_VERSION = '2023-06-01';

/** Photos are made upright and at most this many pixels on their long side before sending. */
const PHOTO_LONG_EDGE = 2000;
/** Above this a picture cannot be sent as it is (Anthropic's limit is 10 MB after base64, which adds a third). */
const MAX_RAW_IMAGE_BYTES = 7 * 1024 * 1024;
/** One first try and up to two more, as Anthropic's own client libraries do. */
const MAX_ATTEMPTS = 3;
/** A `retry-after` longer than this is not waited for: the person is waiting too. */
const MAX_RETRY_WAIT_MS = 10_000;

const RETRYABLE = new Set([408, 429, 500, 502, 503, 504, 529]);

/** How each model is told not to think first (see the comment at the top). */
const THINKING_OFF: Partial<Record<AiModelId, { type: string }>> = {
  'claude-haiku-5-5': { type: 'disabled' },
  'claude-sonnet-5-5': { type: 'between_tools' },
};

interface MessagesResponse {
  content?: { type: string; text?: string }[];
  stop_reason?: string;
  usage?: {
    input_tokens?: number;
    output_tokens?: number;
    cache_creation_input_tokens?: number | null;
    cache_read_input_tokens?: number | null;
  };
}

interface ErrorResponse {
  error?: { type?: string; message?: string; details?: { error_code?: string } };
}

const pause = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));

/** The real engine: Anthropic's Messages API. Holds the API key and never shows it. */
export class ClaudeEngine implements AiEngine {
  readonly kind = 'real';
  private readonly logger = new Logger('ClaudeEngine');

  // A private field: the key never appears in logs, errors or anything serialised.
  #key: string | undefined;

  constructor(apiKey: string | undefined) {
    this.#key = apiKey?.trim() || undefined;
  }

  get ready(): boolean {
    return this.#key !== undefined;
  }

  async complete(request: AiEngineRequest): Promise<AiEngineAnswer> {
    if (!this.#key) throw new AiEngineError('NO_KEY', 'No API key is set');
    const content: unknown[] = [];
    if (request.file) content.push(await fileBlock(request.file));
    content.push({ type: 'text', text: request.text });

    const thinking = THINKING_OFF[request.model];
    const body = JSON.stringify({
      model: request.model,
      max_tokens: request.maxOutputTokens,
      system: request.instructions,
      messages: [{ role: 'user', content }],
      output_config: { effort: request.effort, format: { type: 'json_schema', schema: request.schema } },
      ...(thinking && { thinking }),
      ...(request.personTag && { metadata: { user_id: request.personTag } }),
    });
    return readAnswer(await this.post(body, request.timeoutMs));
  }

  /**
   * One step of a conversation with tools (ECCS Buddy, 16 Oct 2026). Follows Anthropic's tool use
   * and prompt caching pages (read 16 Oct 2026):
   * - Tools, then the system prompt, then the messages make up the prompt in that order, and a
   *   cache mark on the last block of the system prompt caches the tools and the system prompt
   *   together (5 minutes; a read costs a tenth of the input price on Haiku 5.5, a twentieth on
   *   Sonnet 5.5; at least 512 tokens on both). The instructions, the app guide and the tools are
   *   fixed, so every message from every restaurant reads them from the cache.
   * - A second mark on the last block of the conversation caches it as it grows, so each later
   *   step of the same answer (after a tool's result) reads everything before it from the cache.
   * - `tool_choice` stays "auto" (Sonnet 5.5 refuses a forced tool); thinking is off as for the
   *   other features (Sonnet 5.5's "between_tools" can still send short thinking blocks between
   *   tool calls, which the caller sends back unchanged).
   * - A refusal or an answer cut off at its length is a failure, as for `complete`.
   */
  async converse(request: AiConverseRequest): Promise<AiConverseAnswer> {
    if (!this.#key) throw new AiEngineError('NO_KEY', 'No API key is set');
    // Adaptive thinking is what Haiku 5.5 and Sonnet 5.5 do when the field is left out.
    const thinking = request.thinking === 'adaptive' ? undefined : THINKING_OFF[request.model];
    const messages = request.messages.map((message, index) =>
      index === request.messages.length - 1
        ? { ...message, content: message.content.map((block, at) => (at === message.content.length - 1 ? { ...block, cache_control: { type: 'ephemeral' } } : block)) }
        : message,
    );
    const body = JSON.stringify({
      model: request.model,
      max_tokens: request.maxOutputTokens,
      system: [{ type: 'text', text: request.system, cache_control: { type: 'ephemeral' } }],
      tools: request.tools,
      tool_choice: { type: 'auto' },
      messages,
      output_config: { effort: request.effort },
      ...(thinking && { thinking }),
      ...(request.personTag && { metadata: { user_id: request.personTag } }),
    });
    const answer = await this.post(body, request.timeoutMs, request.signal);
    const usage = usageOf(answer);
    if (answer.stop_reason === 'refusal') throw new AiEngineError('REFUSED', 'The model declined to answer', usage);
    if (answer.stop_reason === 'max_tokens') throw new AiEngineError('TOO_LONG', 'The answer was cut off at its length limit', usage);
    return { content: (answer.content ?? []) as AiContentBlock[], stopReason: answer.stop_reason ?? 'end_turn', usage };
  }

  /** Sends one request to the Messages API, trying again after a pause when Anthropic says to. */
  private async post(body: string, timeoutMs: number, stop?: AbortSignal): Promise<MessagesResponse> {
    if (!this.#key) throw new AiEngineError('NO_KEY', 'No API key is set');
    for (let attempt = 1; ; attempt += 1) {
      let response: Response;
      try {
        response = await fetch(MESSAGES_URL, {
          method: 'POST',
          headers: { 'x-api-key': this.#key, 'anthropic-version': API_VERSION, 'content-type': 'application/json' },
          body,
          signal: stop ? AbortSignal.any([AbortSignal.timeout(timeoutMs), stop]) : AbortSignal.timeout(timeoutMs),
        });
      } catch (error) {
        // A timeout is not tried again: the person has already waited the whole time.
        if (stop?.aborted) throw new AiEngineError('ABORTED', 'Stopped by the server');
        if (error instanceof Error && error.name === 'TimeoutError') {
          throw new AiEngineError('TIMEOUT', `No answer within ${timeoutMs / 1000} seconds`);
        }
        if (attempt < MAX_ATTEMPTS) {
          await pause(backoff(attempt));
          continue;
        }
        throw new AiEngineError('NETWORK', 'Could not reach Anthropic');
      }

      if (response.ok) return (await response.json()) as MessagesResponse;

      const failure = ((await response.json().catch(() => ({}))) ?? {}) as ErrorResponse;
      const type = failure.error?.type ?? 'unknown';
      const spendCap = failure.error?.details?.error_code === 'enforced_spend_limit_reached';
      const retryAfter = Number(response.headers.get('retry-after'));
      const waitMs = Number.isFinite(retryAfter) && retryAfter > 0 ? retryAfter * 1000 : backoff(attempt);
      if (RETRYABLE.has(response.status) && !spendCap && attempt < MAX_ATTEMPTS && waitMs <= MAX_RETRY_WAIT_MS) {
        this.logger.warn(`Anthropic answered ${response.status} (${type}); trying again in ${(waitMs / 1000).toFixed(1)} s`);
        await pause(waitMs);
        continue;
      }
      // Anthropic's own words on a refused request (never the key, the text sent or an answer), to find the cause.
      if (response.status === 400) this.logger.warn(`Anthropic refused the request: ${(failure.error?.message ?? '').slice(0, 300)}`);
      throw new AiEngineError(spendCap ? 'SPEND_CAP' : `HTTP_${response.status}`, `Anthropic answered ${response.status} (${type})`);
    }
  }
}

/** Half a second, then a second, with a little randomness so retries do not bunch up. */
const backoff = (attempt: number) => 500 * 2 ** (attempt - 1) + Math.floor(Math.random() * 250);

/** The token counts of an answer, cache writes and reads included. */
const usageOf = (body: MessagesResponse): AiUsage => ({
  inputTokens: body.usage?.input_tokens ?? 0,
  outputTokens: body.usage?.output_tokens ?? 0,
  cacheWriteTokens: body.usage?.cache_creation_input_tokens ?? 0,
  cacheReadTokens: body.usage?.cache_read_input_tokens ?? 0,
});

function readAnswer(body: MessagesResponse): AiEngineAnswer {
  const usage = usageOf(body);
  if (body.stop_reason === 'refusal') throw new AiEngineError('REFUSED', 'The model declined to answer', usage);
  if (body.stop_reason === 'max_tokens') throw new AiEngineError('TOO_LONG', 'The answer was cut off at its length limit', usage);
  // Thinking blocks, if any, come before the answer and are skipped.
  const text = (body.content ?? [])
    .filter((block) => block.type === 'text')
    .map((block) => block.text ?? '')
    .join('');
  try {
    return { json: JSON.parse(text) as unknown, usage };
  } catch {
    throw new AiEngineError('NOT_JSON', 'The answer was not in the expected shape', usage);
  }
}

/** The picture or PDF as a content block. Photos are turned upright and made smaller first. */
async function fileBlock(file: { mimeType: string; data: Buffer }): Promise<unknown> {
  if (file.mimeType === 'application/pdf') {
    return { type: 'document', source: { type: 'base64', media_type: 'application/pdf', data: file.data.toString('base64') } };
  }
  let data = file.data;
  let mediaType = file.mimeType;
  try {
    const sharp = (await import('sharp')).default;
    data = await sharp(file.data)
      .rotate() // upright, following the phone's orientation mark
      .resize({ width: PHOTO_LONG_EDGE, height: PHOTO_LONG_EDGE, fit: 'inside', withoutEnlargement: true })
      .jpeg({ quality: 85 })
      .toBuffer();
    mediaType = 'image/jpeg';
  } catch {
    // Sent as it is if it could not be prepared; Anthropic then says whether it can read it.
  }
  if (data.length > MAX_RAW_IMAGE_BYTES) throw new AiEngineError('FILE_TOO_LARGE', 'The picture is too large to send');
  return { type: 'image', source: { type: 'base64', media_type: mediaType, data: data.toString('base64') } };
}
