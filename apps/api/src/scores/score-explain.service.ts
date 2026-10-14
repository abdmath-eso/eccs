import { createHash } from 'node:crypto';
import { ConflictException, ForbiddenException, Injectable, NotFoundException } from '@nestjs/common';
import { createTranslator, type MessageKey } from '@eccs/i18n';
import {
  AI_ERROR,
  AI_MODELS,
  calculateScore,
  can,
  hasDigit,
  isEccsRole,
  SCORE_EXPLANATION_JSON_SCHEMA,
  scoreExplanationSchema,
  type AiErrorCode,
  type AiLanguage,
  type ScoreExplanationAnswer,
  type ScoreExplanationDto,
  type ScoreReasonCode,
  type ScoreResult,
} from '@eccs/shared';
import { scoreExplanationInstructions } from '../ai/ai-prompts.js';
import { aiUnavailable, AiService } from '../ai/ai.service.js';
import type { AuthUser } from '../auth/auth.types.js';
import { indiaDate } from '../checklists/checklists.service.js';
import { PrismaService } from '../prisma/prisma.service.js';
import { ScoresService } from './scores.service.js';

/** Two short sentences: a few hundred tokens are plenty, in any of the twelve languages. */
const MAX_OUTPUT_TOKENS = 800;

/**
 * The version of the answer's wording. Answers kept under an earlier version are never
 * served again: version 1 (three sentences that repeated the app's numbers) was
 * replaced on 14 Oct 2026 by two sentences with no numbers at all. Raise it whenever
 * the instructions or the facts change in a way that makes kept answers wrong.
 */
const EXPLANATION_VERSION = 2;

const english = createTranslator('EN');
const toDbDate = (date: string) => new Date(`${date}T00:00:00.000Z`);

/**
 * What costs points, in plain words with no numbers: the answer may hold no numbers,
 * and the model is not shown any to repeat. The score card above and below the answer
 * shows the numbers.
 */
const REASON_WORDS: Record<ScoreReasonCode, string> = {
  INSPECTION_NON_COMPLIANT: 'Checks found not compliant at the last ECCS inspection',
  LICENCES_EXPIRED: 'Licences that have expired',
  FSSAI_MISSING: 'No FSSAI licence is on record',
  LICENCE_COPIES_MISSING: 'Licences with no copy of the document on file',
  LICENCES_EXPIRING: 'Licences expiring soon (no points lost yet)',
  CHECKLISTS_MISSED: 'Checklists not handed in today',
  CHECKLISTS_LATE: 'Checklists handed in late today',
  CHECKLISTS_MISSED_YESTERDAY: 'Checklists not handed in yesterday',
  CHECKLISTS_LATE_YESTERDAY: 'Checklists handed in late yesterday',
};

/** What the model is given: the score facts the app already shows, in words, without their numbers. */
export interface ScoreFacts {
  /** The score's band, in words ("Needs attention"). */
  band: string;
  /** True while ECCS has not inspected the outlet: the score then counts licences and checklists only. */
  provisional: boolean;
  /** Which day's checklists are counted. */
  checklistsDay: 'today' | 'yesterday' | null;
  /** What is costing points, the most costly first, by which part of the score it is in. */
  costingPoints: { part: string; what: string }[];
  /** Things worth knowing that cost nothing yet (licences expiring soon). */
  notes: string[];
}

/**
 * "Why this score?" (feature 3, 14 Oct 2026): two short sentences in the reader's
 * language, written by AI from the score's own facts: what is costing the most, in
 * plain words, then the one or two things to do first. For the Owner and the Manager,
 * who see the score's breakdown; the Head Chef sees only the number.
 *
 * No numbers at all: the score card around it shows them. After the first pictures
 * the answer's numbers repeated the list above it and disagreed with the cards below,
 * so the model is given the facts without their numbers, told to write none, and an
 * answer with any digit in any script is rejected (the app then shows its plain list
 * of what is costing points). The answer is kept for the outlet, day and language, so
 * opening it again costs nothing; it is written afresh when the facts have changed
 * since (a checklist handed in, a licence renewed).
 *
 * Sends to the AI: the score's band and what is costing points, in words. Nothing
 * about people.
 */
@Injectable()
export class ScoreExplainService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly scores: ScoresService,
    private readonly ai: AiService,
  ) {}

  private get db() {
    return this.prisma.client;
  }

  async explain(user: AuthUser, outletId: string): Promise<ScoreExplanationDto> {
    const outlet = await this.db.outlet.findUnique({ where: { id: outletId }, select: { id: true, organizationId: true } });
    const target = { organizationId: outlet?.organizationId ?? null, outletId };
    if (!outlet || !can(user.memberships, 'scores', 'read', target)) throw new NotFoundException('Outlet not found');
    // The Owner and the Manager, as the score's breakdown is: never the Head Chef, and not ECCS staff.
    const restaurantUser = user.memberships.every((m) => !isEccsRole(m.role));
    if (!restaurantUser || !can(user.memberships, 'licences', 'read', target)) {
      throw new ForbiddenException('The Owner and the Manager can ask why the score is what it is');
    }

    const today = indiaDate();
    const result = calculateScore(await this.scores.gather(outletId, today));
    if (result.score === null) throw new ConflictException({ message: 'There is no score to explain yet', code: 'NO_SCORE' });

    const language = user.contentLanguage.toLowerCase() as AiLanguage;
    const facts = scoreFacts(result);
    // The version is part of the fingerprint, so an answer kept under older wording is written afresh.
    const factsHash = createHash('sha256').update(JSON.stringify({ version: EXPLANATION_VERSION, facts })).digest('hex');
    const key = { outletId_date_language: { outletId, date: toDbDate(today), language } };

    // Opened again today with nothing changed: the same answer, at no cost.
    const kept = await this.db.aiScoreExplanation.findUnique({ where: key });
    if (kept && kept.factsHash === factsHash) return this.toDto(kept, today, true);

    const answer = await this.ai.run<ScoreExplanationAnswer>({
      feature: 'explain-score',
      model: AI_MODELS.haiku,
      instructions: scoreExplanationInstructions(language),
      text: JSON.stringify(facts),
      answer: { schema: SCORE_EXPLANATION_JSON_SCHEMA, check: scoreExplanationSchema },
      maxOutputTokens: MAX_OUTPUT_TOKENS,
      who: { userId: user.id, organizationId: outlet.organizationId, outletId },
      timeoutMs: 30_000,
      facts,
    });
    if (!answer.ok) throw unavailable(answer.code);

    const sentences = [answer.value.costingMost, answer.value.doFirst].map((text) => text.trim()).filter(Boolean);
    // No numbers at all: an answer with a digit in any script is not shown.
    if (sentences.some(hasDigit)) {
      await this.ai.reject(answer.requestId, 'NUMBERS');
      throw unavailable(AI_ERROR.failed);
    }

    const data = { factsHash, sentences, aiRequestId: answer.requestId };
    const row = await this.db.aiScoreExplanation.upsert({
      where: key,
      create: { outletId, date: toDbDate(today), language, ...data },
      update: data,
    });
    return this.toDto(row, today, false);
  }

  private async toDto(
    row: { outletId: string; sentences: unknown; aiRequestId: string },
    date: string,
    stored: boolean,
  ): Promise<ScoreExplanationDto> {
    const request = await this.db.aiRequest.findUnique({ where: { id: row.aiRequestId }, select: { outcome: true } });
    const outcome = request?.outcome;
    return {
      outletId: row.outletId,
      date,
      sentences: row.sentences as string[],
      aiRequestId: row.aiRequestId,
      stored,
      helpful: outcome === 'HELPFUL' ? true : outcome === 'NOT_HELPFUL' ? false : null,
    };
  }
}

/** The answer when AI stepped aside: the app then shows its plain list of what is costing points. */
const unavailable = (code: AiErrorCode) => aiUnavailable(code, 'The explanation could not be written just now');

/**
 * The score facts the app shows, in plain words without their numbers. What is costing
 * points is listed most costly first, so the model can say what costs the most without
 * being shown a number.
 */
export function scoreFacts(result: ScoreResult): ScoreFacts {
  const measured = result.components.filter((entry) => entry.measured);
  return {
    band: result.band ? english(`score.band.${result.band}` as MessageKey) : '',
    provisional: result.provisional,
    checklistsDay: result.checklistsDay === 'TODAY' ? 'today' : result.checklistsDay === 'YESTERDAY' ? 'yesterday' : null,
    costingPoints: measured
      .flatMap((entry) =>
        entry.reasons
          .filter((reason) => reason.lost > 0)
          .map((reason) => ({ part: english(`score.part.${entry.key}` as MessageKey), what: REASON_WORDS[reason.code], lost: reason.lost })),
      )
      .sort((a, b) => b.lost - a.lost)
      .map(({ part, what }) => ({ part, what })),
    notes: measured.flatMap((entry) => entry.reasons.filter((reason) => reason.lost === 0).map((reason) => REASON_WORDS[reason.code])),
  };
}
