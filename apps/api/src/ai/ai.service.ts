// The shared AI part (the Claude API), 14 Oct 2026. Every AI feature asks through
// AiService.run, which checks the switches and the spending limits, calls the engine,
// checks the answer's shape and records the request in the AiRequest table.
//
// NEVER SEND TO THE AI: anything about staff, attendance, pay, faces or clock-in and
// clock-out photos; PINs, session tokens, passwords or keys of any kind. A feature
// sends only what its own task needs (a licence document, the words of a support
// message or of the restaurant's own checklist, SOP or label text, an outlet's score
// facts) and nothing about who people are beyond an opaque tag. Keep to this in every
// new feature, and say in its comment what it sends.
//
// AI never blocks the app: when it is off, over its limit or fails, `run` answers
// with a code (AI_OFF, AI_LIMIT, AI_FAILED) instead of throwing, and the feature
// steps aside so saving, submitting and reading carry on as before.
//
// To add a feature (as the daily digest, the inspection write-up and the camera
// nudge were, 14 Oct 2026): add its name to AI_FEATURES and its answer shape (a Zod schema plus the same JSON
// schema) in packages/shared/src/ai.ts, its instructions in ai-prompts.ts and a fixed
// answer in fake-ai-engine.ts, and its entry in AI_HELPERS (packages/shared/src/ai-settings.ts:
// its name on the AI usage page and the models it may use), then call
// `ai.run({ feature, model: ai.modelFor(feature), ... })` and act on `ok`. Set what the
// person did with the answer later with `setOutcome`.
//
// Since 19 Oct 2026 the switches, each helper's model and the limits are the console's AI
// settings (AiSettingsService), not the .env: a helper asks `modelFor` for its model, and
// `isOn` and the limits read the settings in force. The server's AI_FEATURES=off and
// AI_DISABLED_FEATURES still switch off whatever the console says. A limit for the India
// month joins the day's.

import { createHash } from 'node:crypto';
import { ForbiddenException, Inject, Injectable, Logger, NotFoundException, ServiceUnavailableException } from '@nestjs/common';
import {
  activitySource,
  AI_ECCS_OWN_FEATURES,
  AI_ERROR,
  AI_FEATURES,
  AI_MODELS,
  aiCostMicroUsd,
  can,
  isEccsRole,
  mainRole,
  microUsdToUsd,
  PHOTO_CHECK_VERDICTS,
  type AiSettings,
  type AiSource,
  type Role,
  type AiErrorCode,
  type AiFeature,
  type AiJsonSchema,
  type AiModelId,
  type AiOutcome,
  type AiStatus,
  type AiStatusDto,
  type AiUsage,
  type AiUsageDto,
  type AiUsageTotalsDto,
  type PhotoCheckCountsDto,
} from '@eccs/shared';
import type { ZodType } from 'zod';
import { currentActivity } from '../activity-log/activity-context.js';
import { ActivityLogService } from '../activity-log/activity-log.service.js';
import type { AuthUser } from '../auth/auth.types.js';
import { env } from '../config/env.js';
import type { Prisma } from '@eccs/db';
import { PrismaService } from '../prisma/prisma.service.js';
import {
  AI_ENGINE,
  AiEngineError,
  type AiContentBlock,
  type AiConversationMessage,
  type AiEngine,
  type AiToolDefinition,
} from './ai-engine.js';
import { AiSettingsService, serverDisabled } from './ai-settings.service.js';

/** Who and where a request is for: the person, their restaurant and the outlet. Any may be unknown. */
export interface AiWho {
  userId: string | null;
  organizationId: string | null;
  outletId: string | null;
}

/** One question to the AI, with everything AiService needs to ask it safely. */
export interface AiCall<T> {
  feature: AiFeature;
  /** Start with Haiku; a feature may step up to Sonnet when Haiku is unsure. */
  model: AiModelId;
  instructions: string;
  text: string;
  /** One picture or PDF, when the task needs it. */
  file?: { mimeType: string; data: Buffer };
  /** The answer's shape: the JSON schema Anthropic is given, and the Zod check the answer must pass. */
  answer: { schema: AiJsonSchema; check: ZodType<T> };
  maxOutputTokens: number;
  who: AiWho;
  effort?: 'low' | 'medium' | 'high';
  timeoutMs?: number;
  /** The facts the text was built from, for the fake engine (see AiEngineRequest.facts). */
  facts?: unknown;
  /**
   * The kind of answer, kept on the request row for measuring how often the AI was
   * right (the camera nudge's verdict, e.g. "NOT_DONE"). Only a short code: never any
   * of the answer's words.
   */
  resultCode?: (answer: T) => string;
}

export type AiResult<T> =
  | { ok: true; value: T; requestId: string }
  | { ok: false; code: AiErrorCode; requestId: string | null; reason?: string };

/** One step of a conversation with tools (see `converse`). */
export interface AiConverseCall {
  feature: AiFeature;
  model: AiModelId;
  system: string;
  tools: AiToolDefinition[];
  messages: AiConversationMessage[];
  maxOutputTokens: number;
  who: AiWho;
  effort?: 'low' | 'medium' | 'high';
  /** 'off' (the default) or 'adaptive': the model may think first. */
  thinking?: 'off' | 'adaptive';
  /** Stops the step early; it is then recorded as an error, ABORTED. */
  signal?: AbortSignal;
  timeoutMs?: number;
  /** For the fake engine (see AiEngineRequest.facts). */
  facts?: unknown;
}

export type AiConverseResult =
  | { ok: true; content: AiContentBlock[]; stopReason: string; requestId: string }
  | { ok: false; code: AiErrorCode; requestId: string | null };

const DEFAULT_TIMEOUT_MS = 45_000;

/**
 * ECCS's own work, not the restaurant's use of AI: the Supervisor's inspection write-up and the
 * office's Monitoring digest. These count against the platform's daily limit only, never against
 * an outlet's, and are left out of the outlet's own daily total (15 Oct 2026: a Supervisor's
 * summary was refused because testing had used up that outlet's allowance).
 */
const PLATFORM_ONLY_FEATURES: readonly AiFeature[] = AI_ECCS_OWN_FEATURES;
// The shop-board reader (16 Oct 2026) is ECCS's own sales work: a lead is not a client yet,
// so it has no outlet, and it counts against the platform's daily limit only. The list is
// `eccsOwn` in AI_HELPERS (packages/shared/src/ai-settings.ts).

/** Why a request may not be made now: a limit for everything (the day's or the month's), or the outlet's. */
export type AiLimitCode = 'DAILY_LIMIT' | 'MONTH_LIMIT' | 'OUTLET_LIMIT';

/**
 * Today's date in India as YYYY-MM-DD. (The same as `indiaDate` in the checklists
 * service, written out here because importing that service would make a loop:
 * it uses the AI translator, which uses this service.)
 */
const indiaDate = () => new Intl.DateTimeFormat('en-CA', { timeZone: 'Asia/Kolkata' }).format(new Date());
/** Midnight in India at the start of the given India date, as a moment. */
const indiaMidnight = (date: string) => new Date(`${date}T00:00:00.000+05:30`);
const usd = (micro: number) => Math.round(microUsdToUsd(micro) * 1_000_000) / 1_000_000;

@Injectable()
export class AiService {
  private readonly logger = new Logger(AiService.name);
  /** The server's own switches, from its .env, which stay above the console's settings. */
  private server = {
    on: env.AI_FEATURES === 'on',
    disabled: new Set<string>(env.AI_DISABLED_FEATURES),
  };
  /** Tests only: limits that replace the console's for the run, so anyone's real spending today cannot get in the way. */
  private testLimits: { dailyUsd?: number; outletDailyUsd?: number } = {};
  /** Tests only: the ids of the rows written, so the tests remove exactly their own. */
  private recorded: string[] | null = env.NODE_ENV === 'test' ? [] : null;

  constructor(
    private readonly prisma: PrismaService,
    @Inject(AI_ENGINE) private readonly engine: AiEngine,
    private readonly activity: ActivityLogService,
    private readonly config: AiSettingsService,
  ) {}

  private get db() {
    return this.prisma.client;
  }

  /** The AI settings in force now (the console's, read through the settings service's short-lived copy). */
  get settings(): AiSettings {
    return this.config.current;
  }

  /** The settings, read again from the database when the copy in memory is stale. */
  freshSettings(): Promise<AiSettings> {
    return this.config.fresh();
  }

  /**
   * True when the feature may be used: AI is on on the server and in the console, the feature
   * is switched on in both, and there is an engine (a key).
   */
  isOn(feature: AiFeature): boolean {
    const settings = this.settings;
    return this.server.on && !this.server.disabled.has(feature) && settings.allOn && settings.helpers[feature].on && this.engine.ready;
  }

  /** The model the console has chosen for this helper (each helper's service asks here rather than choosing in its own code). */
  modelFor(feature: AiFeature): AiModelId {
    return AI_MODELS[this.settings.helpers[feature].model];
  }

  /** The licence reader's second try: whether it is made, and with which model. */
  licenceSecondTry(): { on: boolean; model: AiModelId } {
    const reader = this.settings.licenceReader;
    return { on: reader.secondTry, model: AI_MODELS[reader.secondModel] };
  }

  /** ECCS Buddy's own settings: effort, thinking, the scope check and the person's limits. */
  buddySettings(): AiSettings['buddy'] {
    return this.settings.buddy;
  }

  /** The spending limits in force, in US dollars (a test may replace the daily ones). Empty monthly: no monthly limit. */
  limits(): { dailyUsd: number; monthlyUsd: number | null; outletDailyUsd: number } {
    const limits = this.settings.limits;
    return {
      dailyUsd: this.testLimits.dailyUsd ?? limits.dailyUsd,
      monthlyUsd: limits.monthlyUsd,
      outletDailyUsd: this.testLimits.outletDailyUsd ?? limits.outletDailyUsd,
    };
  }

  /** What the server's own .env allows, for the console: never the key itself. */
  serverFacts(): { aiOn: boolean; keySet: boolean; engine: 'real' | 'fake'; disabled: AiFeature[]; fromEnv: boolean } {
    return { aiOn: this.server.on, keySet: this.engine.ready, engine: this.engine.kind, disabled: serverDisabled([...this.server.disabled]), fromEnv: this.config.fromEnv };
  }

  /** Which features are on, for the apps to show or hide them. */
  status(): AiStatusDto {
    return { features: Object.fromEntries(AI_FEATURES.map((feature) => [feature, this.isOn(feature)])) as Record<AiFeature, boolean> };
  }

  /**
   * Asks the AI one question. Never throws: a refusal (switched off, over a limit)
   * or a failure comes back as `{ ok: false, code }`, and every request, refused or
   * not, is recorded with its cost.
   */
  async run<T>(call: AiCall<T>): Promise<AiResult<T>> {
    const row = { feature: call.feature, model: call.model, ...call.who };
    try {
      // A change saved in the console a moment ago (by another copy of the server) applies to this request.
      await this.config.fresh();
      if (!this.isOn(call.feature)) {
        return { ok: false, code: AI_ERROR.off, requestId: await this.record({ ...row, status: 'OFF' }) };
      }
      const limit = await this.overLimit(PLATFORM_ONLY_FEATURES.includes(call.feature) ? null : call.who.outletId);
      if (limit) {
        this.logger.warn(`AI ${call.feature} not asked: ${limit}`);
        return { ok: false, code: AI_ERROR.limit, requestId: await this.record({ ...row, status: 'LIMIT', errorCode: limit }) };
      }
    } catch (error) {
      this.logger.warn(`AI ${call.feature} not asked: could not check the limits (${String(error)})`);
      return { ok: false, code: AI_ERROR.failed, requestId: null };
    }

    const started = Date.now();
    let usage: AiUsage | undefined;
    try {
      const answer = await this.engine.complete({
        feature: call.feature,
        model: call.model,
        instructions: call.instructions,
        text: call.text,
        ...(call.file && { file: call.file }),
        schema: call.answer.schema,
        maxOutputTokens: call.maxOutputTokens,
        effort: call.effort ?? 'low',
        timeoutMs: call.timeoutMs ?? DEFAULT_TIMEOUT_MS,
        personTag: call.who.userId ? personTag(call.who.userId) : null,
        facts: call.facts,
      });
      usage = answer.usage;
      const checked = call.answer.check.safeParse(answer.json);
      const facts = { ...row, usage, durationMs: Date.now() - started };
      if (!checked.success) {
        this.logger.warn(`AI ${call.feature} on ${call.model}: the answer did not have the expected shape`);
        return { ok: false, code: AI_ERROR.failed, requestId: await this.record({ ...facts, status: 'INVALID', errorCode: 'SHAPE' }) };
      }
      const resultCode = call.resultCode?.(checked.data);
      return { ok: true, value: checked.data, requestId: (await this.record({ ...facts, status: 'OK', resultCode }))! };
    } catch (error) {
      const code = error instanceof AiEngineError ? error.code : 'UNEXPECTED';
      usage ??= error instanceof AiEngineError ? error.usage : undefined;
      this.logger.warn(`AI ${call.feature} on ${call.model} failed: ${code}`);
      const requestId = await this.record({ ...row, usage, durationMs: Date.now() - started, status: 'ERROR', errorCode: code }).catch(
        () => null,
      );
      // The engine's own short code (TIMEOUT, REFUSED...), for a feature that acts on why it failed.
      return { ok: false, code: AI_ERROR.failed, requestId, reason: code };
    }
  }

  /**
   * One step of a conversation with tools (ECCS Buddy, 16 Oct 2026): the same gate as `run` (the
   * switches, today's limits for everyone and for the outlet, a recorded AiRequest with its cost,
   * cache reads and writes included), for a step whose answer is text and tool calls rather than
   * JSON in a fixed shape. Never throws. The caller runs the tools and asks again; each step is
   * its own request row.
   */
  async converse(call: AiConverseCall): Promise<AiConverseResult> {
    const row = { feature: call.feature, model: call.model, ...call.who };
    try {
      // A change saved in the console a moment ago (by another copy of the server) applies to this request.
      await this.config.fresh();
      if (!this.isOn(call.feature)) {
        return { ok: false, code: AI_ERROR.off, requestId: await this.record({ ...row, status: 'OFF' }) };
      }
      const limit = await this.overLimit(PLATFORM_ONLY_FEATURES.includes(call.feature) ? null : call.who.outletId);
      if (limit) {
        this.logger.warn(`AI ${call.feature} not asked: ${limit}`);
        return { ok: false, code: AI_ERROR.limit, requestId: await this.record({ ...row, status: 'LIMIT', errorCode: limit }) };
      }
    } catch (error) {
      this.logger.warn(`AI ${call.feature} not asked: could not check the limits (${String(error)})`);
      return { ok: false, code: AI_ERROR.failed, requestId: null };
    }
    const started = Date.now();
    try {
      const answer = await this.engine.converse({
        feature: call.feature,
        model: call.model,
        system: call.system,
        tools: call.tools,
        messages: call.messages,
        maxOutputTokens: call.maxOutputTokens,
        effort: call.effort ?? 'low',
        thinking: call.thinking ?? 'off',
        ...(call.signal && { signal: call.signal }),
        timeoutMs: call.timeoutMs ?? DEFAULT_TIMEOUT_MS,
        personTag: call.who.userId ? personTag(call.who.userId) : null,
        facts: call.facts,
      });
      // Which tools the step asked for, by name ("TOOLS:visits+open_screen"), or ANSWER: for measuring which tools are used. Never any words.
      const toolNames = answer.content.flatMap((block) => (block.type === 'tool_use' ? [String(block.name).slice(0, 40)] : []));
      const thought = answer.content.some((block) => block.type === 'thinking' || block.type === 'redacted_thinking');
      const requestId = await this.record({
        ...row,
        usage: answer.usage,
        durationMs: Date.now() - started,
        status: 'OK',
        // Only how the step ended, for measuring: never any of the words.
        // ;THOUGHT when the answer came with thinking blocks (adaptive thinking ran), to check it really thinks.
        resultCode: `${toolNames.length > 0 ? `TOOLS:${toolNames.join('+')}`.slice(0, 180) : 'ANSWER'}${thought ? ';THOUGHT' : ''}`,
      });
      return { ok: true, content: answer.content, stopReason: answer.stopReason, requestId };
    } catch (error) {
      const code = error instanceof AiEngineError ? error.code : 'UNEXPECTED';
      const usage = error instanceof AiEngineError ? error.usage : undefined;
      this.logger.warn(`AI ${call.feature} on ${call.model} failed: ${code}`);
      const requestId = await this.record({ ...row, usage, durationMs: Date.now() - started, status: 'ERROR', errorCode: code }).catch(() => null);
      return { ok: false, code: AI_ERROR.failed, requestId };
    }
  }

  /** A feature found the answer unusable after all (for example a number not in the facts): it is marked INVALID. */
  async reject(requestId: string, errorCode: string): Promise<void> {
    await this.db.aiRequest.update({ where: { id: requestId }, data: { status: 'INVALID', errorCode } }).catch(() => undefined);
    this.activity.aiUpdated(requestId, { status: 'INVALID', errorCode });
  }

  /**
   * Records what the person did with an answer: kept it, changed it, threw it away,
   * or found it helpful or not. The person who asked may say so, and so may anyone
   * at the same restaurant outlet (an explanation of the score is shared by the
   * Owner and the Manager), and either of ECCS's Super Admin and Ops Manager for the
   * Monitoring board's daily digest, which they share. "Not found" and "not yours"
   * look the same.
   */
  async setOutcome(user: AuthUser, requestId: string, outcome: AiOutcome): Promise<void> {
    const request = await this.db.aiRequest.findUnique({ where: { id: requestId } });
    const sameOutlet =
      request?.outletId != null &&
      request.organizationId != null &&
      user.memberships.every((m) => !isEccsRole(m.role)) &&
      can(user.memberships, 'scores', 'read', { organizationId: request.organizationId, outletId: request.outletId });
    const sharedDigest = request?.feature === 'monitoring-digest' && isEccsAdmin(user);
    if (!request || (request.userId !== user.id && !sameOutlet && !sharedDigest)) throw new NotFoundException('Not found');
    await this.noteOutcome(requestId, outcome);
  }

  /**
   * Records what was done with an answer when the feature itself knows (for example
   * an AI draft saved as it was, or after changes). The feature has already checked
   * who may do it.
   */
  async noteOutcome(requestId: string, outcome: AiOutcome): Promise<void> {
    await this.db.aiRequest.update({ where: { id: requestId }, data: { outcome } }).catch(() => undefined);
    // The AI request's row in the activity log gets the outcome too.
    this.activity.aiUpdated(requestId, { outcome });
  }

  /** What AI has cost today and this month, by feature, for ECCS's Super Admin and Ops Manager. */
  async usage(user: AuthUser): Promise<AiUsageDto> {
    if (!isEccsAdmin(user)) {
      throw new ForbiddenException('Only the Super Admin and the Ops Manager can see what AI costs');
    }
    const today = indiaDate();
    const month = `${today.slice(0, 7)}-01`;
    return {
      today: await this.totals(today),
      month: await this.totals(month),
      limits: { dailyUsd: this.limits().dailyUsd, outletDailyUsd: this.limits().outletDailyUsd },
    };
  }

  private async totals(from: string): Promise<AiUsageTotalsDto> {
    const since = indiaMidnight(from);
    const groups = await this.db.aiRequest.groupBy({
      by: ['feature'],
      where: { createdAt: { gte: since } },
      _count: { _all: true },
      _sum: { costMicroUsd: true, inputTokens: true, outputTokens: true },
      orderBy: { feature: 'asc' },
    });
    const byFeature = groups.map((group) => ({
      feature: group.feature,
      requests: group._count._all,
      costUsd: usd(group._sum.costMicroUsd ?? 0),
      inputTokens: group._sum.inputTokens ?? 0,
      outputTokens: group._sum.outputTokens ?? 0,
    }));
    return {
      from,
      requests: byFeature.reduce((total, entry) => total + entry.requests, 0),
      costUsd: usd(groups.reduce((total, group) => total + (group._sum.costMicroUsd ?? 0), 0)),
      byFeature,
      photoCheck: await this.photoCheckCounts(since),
    };
  }

  /**
   * The camera nudge's answers since a moment, by verdict, with how many photos were
   * retaken (ACCEPTED) or kept with "Keep it" (DISCARDED) after a nudge: how ECCS sees
   * how often the AI was wrong. Requests that never got an answer have no verdict and
   * are not counted here.
   */
  private async photoCheckCounts(since: Date): Promise<PhotoCheckCountsDto[]> {
    const feature: AiFeature = 'photo-check';
    const groups = await this.db.aiRequest.groupBy({
      by: ['resultCode', 'outcome'],
      where: { feature, resultCode: { not: null }, createdAt: { gte: since } },
      _count: { _all: true },
    });
    const counts = new Map<string, PhotoCheckCountsDto>();
    for (const group of groups) {
      const verdict = group.resultCode ?? '';
      const entry = counts.get(verdict) ?? { verdict, requests: 0, retaken: 0, kept: 0 };
      entry.requests += group._count._all;
      if (group.outcome === 'ACCEPTED') entry.retaken += group._count._all;
      if (group.outcome === 'DISCARDED') entry.kept += group._count._all;
      counts.set(verdict, entry);
    }
    // In the order the verdicts are listed (OK first, NOT_DONE near the end).
    const rank = (verdict: string) => {
      const at = (PHOTO_CHECK_VERDICTS as readonly string[]).indexOf(verdict);
      return at < 0 ? PHOTO_CHECK_VERDICTS.length : at;
    };
    return [...counts.values()].sort((a, b) => rank(a.verdict) - rank(b.verdict));
  }

  /**
   * Which of today's spending limits stops a request for this outlet now, or null.
   * For work the server does by itself (filling in missing languages), which asks
   * before it starts and stops for the day instead of being refused call after call.
   */
  async limitReached(outletId: string | null): Promise<AiLimitCode | null> {
    await this.config.fresh();
    return this.overLimit(outletId);
  }

  /**
   * Why no request may be made now, or null: today's spending (India time) is at the daily
   * limit, this India month's at the monthly limit (when one is set), or the outlet's today
   * at its own. Hard limits: the request is refused and recorded as LIMIT with the code.
   */
  private async overLimit(outletId: string | null): Promise<AiLimitCode | null> {
    const today = indiaDate();
    const limits = this.limits();
    const spent = async (since: Date, where: Prisma.AiRequestWhereInput = {}) =>
      (await this.db.aiRequest.aggregate({ where: { ...where, createdAt: { gte: since } }, _sum: { costMicroUsd: true } }))._sum
        .costMicroUsd ?? 0;
    if ((await spent(indiaMidnight(today))) >= limits.dailyUsd * 1_000_000) return 'DAILY_LIMIT';
    if (limits.monthlyUsd !== null && (await spent(indiaMidnight(`${today.slice(0, 7)}-01`))) >= limits.monthlyUsd * 1_000_000) return 'MONTH_LIMIT';
    // The outlet's own total leaves out ECCS's own work there (see PLATFORM_ONLY_FEATURES).
    const outletSpent = outletId ? await spent(indiaMidnight(today), { outletId, feature: { notIn: [...PLATFORM_ONLY_FEATURES] } }) : 0;
    if (outletId && outletSpent >= limits.outletDailyUsd * 1_000_000) return 'OUTLET_LIMIT';
    return null;
  }

  private async record(entry: AiWho & {
    feature: AiFeature;
    model: AiModelId;
    status: AiStatus;
    errorCode?: string;
    usage?: AiUsage | undefined;
    durationMs?: number;
    resultCode?: string | undefined;
  }): Promise<string> {
    const usage = entry.usage;
    const row = await this.db.aiRequest.create({
      data: {
        feature: entry.feature,
        model: entry.model,
        userId: entry.userId,
        organizationId: entry.organizationId,
        outletId: entry.outletId,
        // Every input token, cache reads and writes included, as before 19 Oct 2026; the cache's own share alongside.
        inputTokens: (usage?.inputTokens ?? 0) + (usage?.cacheWriteTokens ?? 0) + (usage?.cacheReadTokens ?? 0),
        cacheReadTokens: usage?.cacheReadTokens ?? 0,
        cacheWriteTokens: usage?.cacheWriteTokens ?? 0,
        outputTokens: usage?.outputTokens ?? 0,
        costMicroUsd: usage ? aiCostMicroUsd(entry.model, usage) : 0,
        status: entry.status,
        errorCode: entry.errorCode ?? null,
        durationMs: entry.durationMs ?? 0,
        resultCode: entry.resultCode ?? null,
        source: await this.sourceOf(entry.userId),
      },
      select: { id: true, inputTokens: true, outputTokens: true, costMicroUsd: true },
    });
    this.recorded?.push(row.id);
    // Every AI request also writes a row in the activity log (category AI), after the answer has gone.
    this.activity.aiRequest({
      requestId: row.id,
      feature: entry.feature,
      model: entry.model,
      status: entry.status,
      errorCode: entry.errorCode ?? null,
      inputTokens: row.inputTokens,
      outputTokens: row.outputTokens,
      costMicroUsd: row.costMicroUsd,
      durationMs: entry.durationMs ?? 0,
      userId: entry.userId,
      organizationId: entry.organizationId,
      outletId: entry.outletId,
    });
    return row.id;
  }

  /**
   * Where a request was asked from, as the activity log names it: the person's role and the
   * app that sent the request (the phone app or the console); with nobody asking, the
   * server's own work (SYSTEM). Never fails a request: unknown is left empty.
   */
  private async sourceOf(userId: string | null): Promise<AiSource | null> {
    if (!userId) return 'SYSTEM';
    try {
      const context = currentActivity();
      const asking = (context?.request as { user?: AuthUser } | undefined)?.user;
      let role: Role | null = null;
      if (asking?.id === userId) role = mainRole(asking.memberships.map((m) => m.role));
      else {
        const person = await this.db.user.findUnique({ where: { id: userId }, select: { memberships: { select: { role: true } } } });
        role = person ? mainRole(person.memberships.map((m) => m.role as Role)) : null;
      }
      if (!role) return null;
      const source = activitySource({ role, client: context?.client ?? 'other' });
      return source === 'PUBLIC' ? null : source;
    } catch {
      return null;
    }
  }

  // ───────────────────────── Tests only ─────────────────────────

  /**
   * Tests: change the server's switches for this run (as AI_FEATURES and AI_DISABLED_FEATURES
   * would; the rest of the e2e run has AI off), and replace the daily limits so anyone's real
   * spending today cannot get in the way. The console's settings are left alone.
   */
  setForTest(changes: Partial<{ on: boolean; disabled: string[]; dailyLimitUsd: number; outletDailyLimitUsd: number }>): void {
    if (env.NODE_ENV !== 'test') throw new Error('AI settings can only be changed in tests');
    this.server = {
      on: changes.on ?? this.server.on,
      disabled: changes.disabled ? new Set(changes.disabled) : this.server.disabled,
    };
    this.testLimits = {
      dailyUsd: changes.dailyLimitUsd ?? this.testLimits.dailyUsd,
      outletDailyUsd: changes.outletDailyLimitUsd ?? this.testLimits.outletDailyUsd,
    };
  }

  /** Tests: the console's daily limits apply again (no test limits). */
  clearTestLimits(): void {
    if (env.NODE_ENV !== 'test') throw new Error('AI settings can only be changed in tests');
    this.testLimits = {};
  }

  /** Tests: the ids of the AiRequest rows written so far, for removing exactly those. */
  recordedForTest(): string[] {
    return [...(this.recorded ?? [])];
  }
}

/**
 * The answer to the app when AI stepped aside, with its code (AI_OFF, AI_LIMIT or
 * AI_FAILED), so the screen carries on without it. `failed` is what to say when it failed.
 */
export function aiUnavailable(code: AiErrorCode, failed: string): ServiceUnavailableException {
  const message = code === AI_ERROR.limit ? 'The limit for AI has been reached' : code === AI_ERROR.off ? 'AI is switched off' : failed;
  return new ServiceUnavailableException({ message, code });
}

/** ECCS's Super Admin or Operations Manager: they see what AI costs, and share the board's digest. */
const isEccsAdmin = (user: AuthUser) => user.memberships.some((m) => m.role === 'SUPER_ADMIN' || m.role === 'OPS_MANAGER');

/** An opaque tag for a person, so Anthropic can spot abuse without learning who anyone is. */
function personTag(userId: string): string {
  return createHash('sha256').update(`eccs-ai-person:${userId}`).digest('hex').slice(0, 32);
}
