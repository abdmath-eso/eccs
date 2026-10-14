import { createHash } from 'node:crypto';
import {
  ConflictException,
  ForbiddenException,
  Injectable,
  NotFoundException,
  ServiceUnavailableException,
} from '@nestjs/common';
import { createTranslator, type MessageKey } from '@eccs/i18n';
import {
  AI_ERROR,
  AI_MODELS,
  calculateScore,
  can,
  isEccsRole,
  numbersIn,
  SCORE_EXPLANATION_JSON_SCHEMA,
  scoreExplanationSchema,
  unknownNumbers,
  type AiErrorCode,
  type AiLanguage,
  type ScoreExplanationAnswer,
  type ScoreExplanationDto,
  type ScoreResult,
} from '@eccs/shared';
import { scoreExplanationInstructions } from '../ai/ai-prompts.js';
import { AiService } from '../ai/ai.service.js';
import type { AuthUser } from '../auth/auth.types.js';
import { indiaDate } from '../checklists/checklists.service.js';
import { PrismaService } from '../prisma/prisma.service.js';
import { ScoresService } from './scores.service.js';

/** Three short sentences: a few hundred tokens are plenty, in any of the twelve languages. */
const MAX_OUTPUT_TOKENS = 800;

const english = createTranslator('EN');
const toDbDate = (date: string) => new Date(`${date}T00:00:00.000Z`);

/** What the model is given: only the score facts the app already shows, with its own numbers. */
export interface ScoreFacts {
  score: number;
  outOf: 100;
  band: string;
  /** True while ECCS has not inspected the outlet: the score then counts licences and checklists only. */
  provisional: boolean;
  /** Which day's checklists are counted. */
  checklistsDay: 'today' | 'yesterday' | null;
  parts: { part: string; counted: boolean; points: number; outOf: number }[];
  /** What is costing points, the most costly first, as the app words it. */
  costingPoints: { part: string; what: string; pointsLost: number }[];
  /** Things worth knowing that cost nothing yet (licences expiring soon). */
  notes: string[];
}

/**
 * "Why this score?" (feature 3, 14 Oct 2026): three short sentences in the reader's
 * language on what pulled the outlet's hygiene score down most and the one or two
 * things to do first, written by AI from the score's own facts. For the Owner and
 * the Manager, who see the score's breakdown; the Head Chef sees only the number.
 *
 * The numbers are the app's: the model is told to use only the numbers it is
 * given, and an answer with any other number in it is rejected (the app then shows
 * its plain list of what is costing points). The answer is kept for the outlet,
 * day and language, so opening it again costs nothing; it is written afresh when
 * the score's facts have changed since (a checklist handed in, a licence renewed).
 *
 * Sends to the AI: the score, its three parts and what is costing points. Nothing
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
    const factsHash = createHash('sha256').update(JSON.stringify(facts)).digest('hex');
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

    const sentences = [answer.value.pulledDown, answer.value.doFirst, answer.value.doNext].map((text) => text.trim()).filter(Boolean);
    // Every number must be one the app gave; an answer with any other is not shown.
    if (unknownNumbers(sentences.join(' '), numbersIn(JSON.stringify(facts))).length > 0) {
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
function unavailable(code: AiErrorCode) {
  const message =
    code === AI_ERROR.limit
      ? "Today's limit for AI has been reached"
      : code === AI_ERROR.off
        ? 'AI is switched off'
        : 'The explanation could not be written just now';
  return new ServiceUnavailableException({ message, code });
}

/** The score facts the app shows, in plain words with the app's own numbers. */
export function scoreFacts(result: ScoreResult): ScoreFacts {
  const reasonText = (code: string, count: number, total?: number) =>
    english(`score.reason.${code}` as MessageKey, { count, total: total ?? count });
  const measured = result.components.filter((entry) => entry.measured);
  return {
    score: result.score ?? 0,
    outOf: 100,
    band: result.band ? english(`score.band.${result.band}` as MessageKey) : '',
    provisional: result.provisional,
    checklistsDay: result.checklistsDay === 'TODAY' ? 'today' : result.checklistsDay === 'YESTERDAY' ? 'yesterday' : null,
    parts: result.components.map((entry) => ({
      part: english(`score.part.${entry.key}` as MessageKey),
      counted: entry.measured,
      points: entry.earned,
      outOf: entry.max,
    })),
    costingPoints: measured
      .flatMap((entry) =>
        entry.reasons
          .filter((reason) => reason.lost > 0)
          .map((reason) => ({
            part: english(`score.part.${entry.key}` as MessageKey),
            what: reasonText(reason.code, reason.count, reason.total),
            pointsLost: reason.lost,
          })),
      )
      .sort((a, b) => b.pointsLost - a.pointsLost),
    notes: measured.flatMap((entry) =>
      entry.reasons.filter((reason) => reason.lost === 0).map((reason) => reasonText(reason.code, reason.count, reason.total)),
    ),
  };
}
