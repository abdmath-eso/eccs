import type { AiFeature, AiJsonSchema, AiModelId, AiUsage } from '@eccs/shared';

/**
 * What the server asks the AI, after AiService has checked the switches and the
 * limits. One request is one question with one answer in a fixed shape.
 */
export interface AiEngineRequest {
  feature: AiFeature;
  model: AiModelId;
  /** The instructions (the "system prompt"). */
  instructions: string;
  /** The question or the text to work on. */
  text: string;
  /** At most one picture (JPEG, PNG or WebP) or PDF, sent before the text. */
  file?: { mimeType: string; data: Buffer };
  /** The shape the answer must have, as a JSON schema. */
  schema: AiJsonSchema;
  /** The most the answer may be, in tokens. */
  maxOutputTokens: number;
  /** How hard the model works: "low" is the cheapest and fastest (see the effort page). */
  effort: 'low' | 'medium' | 'high';
  timeoutMs: number;
  /** An opaque tag for the person asking, never their name or number: Anthropic uses it to spot abuse. */
  personTag: string | null;
  /**
   * The facts the text was built from, in their own form. The real engine ignores
   * this; the fake engine answers from it, so tests need no language model.
   */
  facts?: unknown;
}

export interface AiEngineAnswer {
  /** The answer, parsed from JSON but not yet checked against its shape. */
  json: unknown;
  usage: AiUsage;
}

/**
 * The call failed. `code` is short and safe to store (for example "TIMEOUT",
 * "HTTP_529", "REFUSED"); `usage` is set when tokens were still charged.
 * Neither ever holds the API key, the text sent or the answer.
 */
export class AiEngineError extends Error {
  constructor(
    readonly code: string,
    message: string,
    readonly usage?: AiUsage,
  ) {
    super(message);
    this.name = 'AiEngineError';
  }
}

/**
 * Something that answers AI requests. Two kinds: the real one, which calls
 * Anthropic's Messages API (claude-engine.ts), and a fake one with fixed answers
 * for the automated tests (fake-ai-engine.ts), chosen by AI_ENGINE.
 */
export interface AiEngine {
  readonly kind: 'real' | 'fake';
  /** False when the engine cannot be used at all (the real one without an API key). */
  readonly ready: boolean;
  complete(request: AiEngineRequest): Promise<AiEngineAnswer>;
}

export const AI_ENGINE = Symbol('AI_ENGINE');
