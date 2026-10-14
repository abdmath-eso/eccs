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
// answer in fake-ai-engine.ts, then call `ai.run({ feature, model, ... })` and act on
// `ok`. Set what the person did with the answer later with `setOutcome`.

import { createHash } from 'node:crypto';
import { ForbiddenException, Inject, Injectable, Logger, NotFoundException, ServiceUnavailableException } from '@nestjs/common';
import {
  AI_ERROR,
  AI_FEATURES,
  aiCostMicroUsd,
  can,
  isEccsRole,
  microUsdToUsd,
  PHOTO_CHECK_VERDICTS,
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
import type { AuthUser } from '../auth/auth.types.js';
import { env } from '../config/env.js';
import { PrismaService } from '../prisma/prisma.service.js';
import { AI_ENGINE, AiEngineError, type AiEngine } from './ai-engine.js';

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
  | { ok: false; code: AiErrorCode; requestId: string | null };

const DEFAULT_TIMEOUT_MS = 45_000;

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
  private settings = {
    on: env.AI_FEATURES === 'on',
    disabled: new Set<string>(env.AI_DISABLED_FEATURES),
    dailyLimitUsd: env.AI_DAILY_LIMIT_USD,
    outletDailyLimitUsd: env.AI_OUTLET_DAILY_LIMIT_USD,
  };
  /** Tests only: the ids of the rows written, so the tests remove exactly their own. */
  private recorded: string[] | null = env.NODE_ENV === 'test' ? [] : null;

  constructor(
    private readonly prisma: PrismaService,
    @Inject(AI_ENGINE) private readonly engine: AiEngine,
  ) {}

  private get db() {
    return this.prisma.client;
  }

  /** True when the feature may be used: AI is on, the feature is not switched off, and there is an engine (a key). */
  isOn(feature: AiFeature): boolean {
    return this.settings.on && !this.settings.disabled.has(feature) && this.engine.ready;
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
      if (!this.isOn(call.feature)) {
        return { ok: false, code: AI_ERROR.off, requestId: await this.record({ ...row, status: 'OFF' }) };
      }
      const limit = await this.overLimit(call.who.outletId);
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
      return { ok: false, code: AI_ERROR.failed, requestId };
    }
  }

  /** A feature found the answer unusable after all (for example a number not in the facts): it is marked INVALID. */
  async reject(requestId: string, errorCode: string): Promise<void> {
    await this.db.aiRequest.update({ where: { id: requestId }, data: { status: 'INVALID', errorCode } }).catch(() => undefined);
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
      limits: { dailyUsd: this.settings.dailyLimitUsd, outletDailyUsd: this.settings.outletDailyLimitUsd },
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

  /** Why no request may be made now, or null: today's spending (India time) is at a limit. */
  private async overLimit(outletId: string | null): Promise<string | null> {
    const since = indiaMidnight(indiaDate());
    const spent = async (where: { outletId?: string }) =>
      (await this.db.aiRequest.aggregate({ where: { ...where, createdAt: { gte: since } }, _sum: { costMicroUsd: true } }))._sum
        .costMicroUsd ?? 0;
    if ((await spent({})) >= this.settings.dailyLimitUsd * 1_000_000) return 'DAILY_LIMIT';
    if (outletId && (await spent({ outletId })) >= this.settings.outletDailyLimitUsd * 1_000_000) return 'OUTLET_LIMIT';
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
        inputTokens: (usage?.inputTokens ?? 0) + (usage?.cacheWriteTokens ?? 0) + (usage?.cacheReadTokens ?? 0),
        outputTokens: usage?.outputTokens ?? 0,
        costMicroUsd: usage ? aiCostMicroUsd(entry.model, usage) : 0,
        status: entry.status,
        errorCode: entry.errorCode ?? null,
        durationMs: entry.durationMs ?? 0,
        resultCode: entry.resultCode ?? null,
      },
      select: { id: true },
    });
    this.recorded?.push(row.id);
    return row.id;
  }

  // ───────────────────────── Tests only ─────────────────────────

  /** Tests: change the switches and limits for this run (the rest of the e2e run has AI off). */
  setForTest(changes: Partial<{ on: boolean; disabled: string[]; dailyLimitUsd: number; outletDailyLimitUsd: number }>): void {
    if (env.NODE_ENV !== 'test') throw new Error('AI settings can only be changed in tests');
    this.settings = {
      on: changes.on ?? this.settings.on,
      disabled: changes.disabled ? new Set(changes.disabled) : this.settings.disabled,
      dailyLimitUsd: changes.dailyLimitUsd ?? this.settings.dailyLimitUsd,
      outletDailyLimitUsd: changes.outletDailyLimitUsd ?? this.settings.outletDailyLimitUsd,
    };
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
  const message = code === AI_ERROR.limit ? "Today's limit for AI has been reached" : code === AI_ERROR.off ? 'AI is switched off' : failed;
  return new ServiceUnavailableException({ message, code });
}

/** ECCS's Super Admin or Operations Manager: they see what AI costs, and share the board's digest. */
const isEccsAdmin = (user: AuthUser) => user.memberships.some((m) => m.role === 'SUPER_ADMIN' || m.role === 'OPS_MANAGER');

/** An opaque tag for a person, so Anthropic can spot abuse without learning who anyone is. */
function personTag(userId: string): string {
  return createHash('sha256').update(`eccs-ai-person:${userId}`).digest('hex').slice(0, 32);
}
