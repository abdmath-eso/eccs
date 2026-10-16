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

// ───────────────────────── A conversation with tools (ECCS Buddy, 16 Oct 2026) ─────────────────────────
//
// Anthropic's tool use (platform.claude.com/docs/en/agents-and-tools/tool-use): the request
// carries the tools; the model answers with text and `tool_use` blocks; the server runs the
// tools and sends their `tool_result` blocks back, first in the next user message, until the
// model answers with text alone (stop reason "end_turn").

/** One tool the model may ask for: its name, what it does and when to use it, and its input's JSON schema. */
export interface AiToolDefinition {
  name: string;
  description: string;
  input_schema: AiJsonSchema;
}

/**
 * A block of a message, as the Messages API writes it. Text, a tool call, a tool's result, or
 * anything else the model sends (a thinking block from Sonnet 5.5's `between_tools`), which is
 * sent back unchanged within the same answer, as Anthropic asks.
 */
export type AiContentBlock =
  | { type: 'text'; text: string }
  | { type: 'tool_use'; id: string; name: string; input: unknown }
  | { type: 'tool_result'; tool_use_id: string; content: string; is_error?: boolean }
  | { type: 'thinking' | 'redacted_thinking'; [key: string]: unknown };

export interface AiConversationMessage {
  role: 'user' | 'assistant';
  content: AiContentBlock[];
}

export interface AiConverseRequest {
  feature: AiFeature;
  model: AiModelId;
  /** The long fixed part (instructions and the app guide): cached together with the tools. */
  system: string;
  tools: AiToolDefinition[];
  messages: AiConversationMessage[];
  maxOutputTokens: number;
  effort: 'low' | 'medium' | 'high';
  /**
   * 'off': no thinking, as for the other features. 'adaptive': the model may think before it
   * answers or calls a tool (billed as output); with thinking off, Haiku 5.5 can write its reasoning
   * into the visible answer instead (Anthropic's migration notes), so Buddy measures both.
   */
  thinking: 'off' | 'adaptive';
  timeoutMs: number;
  /** Stops the step early (Buddy's scope screen refused the message); it then fails with ABORTED. */
  signal?: AbortSignal;
  personTag: string | null;
  /** For the fake engine only (see AiEngineRequest.facts). */
  facts?: unknown;
}

export interface AiConverseAnswer {
  /** The model's blocks, in order, thinking blocks included. */
  content: AiContentBlock[];
  /** "end_turn" (answered) or "tool_use" (wants tools run). Refusals and cut-off answers are thrown as AiEngineError. */
  stopReason: string;
  usage: AiUsage;
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
  /** One step of a conversation with tools: the next assistant message. */
  converse(request: AiConverseRequest): Promise<AiConverseAnswer>;
}

export const AI_ENGINE = Symbol('AI_ENGINE');
