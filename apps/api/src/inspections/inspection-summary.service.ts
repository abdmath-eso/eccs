import { BadRequestException, Injectable } from '@nestjs/common';
import {
  AI_ERROR,
  firstDistinct,
  hasNumberWord,
  INSPECTION_FIX_FIRST_MAX,
  INSPECTION_SUMMARY_JSON_SCHEMA,
  inspectionSummaryAnswerSchema,
  numbersIn,
  scoreInspection,
  unknownIds,
  unknownNumbers,
  type InspectionCheckDto,
  type InspectionDto,
  type InspectionSummaryAnswer,
  type InspectionSummaryDraftDto,
  type saveInspectionSummarySchema,
} from '@eccs/shared';
import type { z } from 'zod';
import { INSPECTION_SUMMARY_INSTRUCTIONS } from '../ai/ai-prompts.js';
import { aiUnavailable, AiService } from '../ai/ai.service.js';
import type { AuthUser } from '../auth/auth.types.js';
import { PrismaService } from '../prisma/prisma.service.js';
import { InspectionsService, type DetailRow } from './inspections.service.js';

/** About 120 words and up to five ids: well under a thousand tokens. */
const MAX_OUTPUT_TOKENS = 1200;
/** The Supervisor waits for it with signal, so a minute at most. */
const TIMEOUT_MS = 60_000;

const ANSWER_WORDS = { COMPLIANT: 'compliant', NON_COMPLIANT: 'not compliant', NOT_APPLICABLE: 'not applicable' } as const;

/** What the AI is given: the inspection's own facts, with nothing about any person and no photos. */
export interface SummaryFacts {
  outlet: string;
  score: number;
  outOf: 100;
  grade: string | null;
  counts: {
    compliant: number;
    notCompliant: number;
    notApplicable: number;
    criticalChecksFailed: number;
    /** Worked out here so the model never counts sections itself (a real draft miscounted them). */
    sections: number;
    sectionsScoring100: number;
  };
  sections: { section: string; scoreOutOf100: number | null; checks: { number: number; check: string; critical?: true; answer: string }[] }[];
  findings: {
    id: string;
    checkNumber: number;
    critical: boolean;
    severity: string | null;
    found: string | null;
    correctiveAction: string | null;
    fixBy: string | null;
  }[];
}

/**
 * The summary for an inspection report (feature 5, 14 Oct 2026). After Finish, while
 * the report waits for ECCS, the Supervisor who carried out the inspection (or an
 * ECCS admin standing in) writes a short summary and picks the findings to fix
 * first, by hand or from an AI draft they check and edit. Nothing AI-written is kept
 * until they press Save; once ECCS approves the report the summary is locked.
 *
 * The pattern is the AI report summary of inspection apps, which the inspector
 * reviews and edits before the report is final: SafetyCulture's "AI report
 * summaries" and Property Inspect's InspectAI executive summary ("review and edit
 * before finalising").
 *
 * The scores and the grade stay the app's: the AI only writes words. "Fix these
 * first" is chosen by id from the inspection's own findings, and the report shows
 * each with the Supervisor's own words. An answer naming a finding that is not this
 * inspection's, or writing a number that is not in the facts, is refused.
 *
 * Sends to the AI: the outlet's name, the scores and grade, each check's wording
 * (English) and answer, and each finding's severity, description, corrective action
 * and date. No photos and no names of people.
 */
@Injectable()
export class InspectionSummaryService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly inspections: InspectionsService,
    private readonly ai: AiService,
  ) {}

  private get db() {
    return this.prisma.client;
  }

  /** An AI draft for the person to check. Nothing is saved. */
  async draft(user: AuthUser, inspectionId: string): Promise<InspectionSummaryDraftDto> {
    const { inspection, checks } = await this.inspections.forWriteUp(user, inspectionId);
    const facts = summaryFacts(inspection, checks);
    const answer = await this.ai.run<InspectionSummaryAnswer>({
      feature: 'inspection-summary',
      model: this.ai.modelFor('inspection-summary'),
      instructions: INSPECTION_SUMMARY_INSTRUCTIONS,
      text: JSON.stringify(facts),
      answer: { schema: INSPECTION_SUMMARY_JSON_SCHEMA, check: inspectionSummaryAnswerSchema },
      maxOutputTokens: MAX_OUTPUT_TOKENS,
      who: { userId: user.id, organizationId: inspection.outlet.organizationId, outletId: inspection.outletId },
      timeoutMs: TIMEOUT_MS,
      facts,
    });
    const failed = 'The summary could not be drafted just now. Write it yourself.';
    if (!answer.ok) throw aiUnavailable(answer.code, failed);

    const summary = answer.value.summary.trim();
    const problem =
      unknownIds(answer.value.fixFirst, facts.findings.map((finding) => finding.id)).length > 0
        ? 'IDS'
        : unknownNumbers(summary, numbersIn(JSON.stringify(numbersThatCount(facts)))).length > 0 || hasNumberWord(summary)
          ? 'NUMBERS'
          : null;
    if (problem) {
      await this.ai.reject(answer.requestId, problem);
      throw aiUnavailable(AI_ERROR.failed, failed);
    }
    return { summary, fixFirst: firstDistinct(answer.value.fixFirst, INSPECTION_FIX_FIRST_MAX), aiRequestId: answer.requestId };
  }

  /**
   * Saves the summary as the person left it. With AI off this works just the same:
   * the summary is then their own words. An empty summary removes it.
   */
  async save(user: AuthUser, inspectionId: string, input: z.output<typeof saveInspectionSummarySchema>): Promise<InspectionDto> {
    const { inspection, checks } = await this.inspections.forWriteUp(user, inspectionId);
    const findings = checks.flatMap((check) => (check.answer === 'NON_COMPLIANT' && check.findingId ? [check.findingId] : []));
    const fixFirst = input.fixFirst;
    if (unknownIds(fixFirst, findings).length > 0) {
      throw new BadRequestException("Fix these first can only list this inspection's own non-compliances");
    }
    // The AI draft it started from, if any: one drafted for this outlet's inspection summary.
    const draft = input.draft
      ? await this.db.aiRequest.findFirst({
          where: { id: input.draft.requestId, feature: 'inspection-summary', outletId: inspection.outletId, status: 'OK' },
          select: { id: true },
        })
      : null;

    const summary = input.summary.trim();
    await this.db.inspection.update({
      where: { id: inspection.id },
      data: {
        summary: summary || null,
        fixFirst: summary ? firstDistinct(fixFirst, INSPECTION_FIX_FIRST_MAX) : [],
        summaryAiDrafted: summary ? input.aiDrafted || draft !== null : false,
        summaryUpdatedAt: new Date(),
      },
    });
    // What the person did with the draft: kept as it was, changed, or cleared.
    if (draft) await this.ai.noteOutcome(draft.id, !summary ? 'DISCARDED' : input.draft?.edited ? 'EDITED' : 'ACCEPTED');
    return this.inspections.get(user, inspection.id);
  }
}

const english = (label: InspectionCheckDto['label']) => label.en ?? Object.values(label)[0] ?? '';

/** The inspection's facts as the AI is given them. */
export function summaryFacts(inspection: DetailRow, checks: readonly (InspectionCheckDto & { section: string })[]): SummaryFacts {
  const score = scoreInspection(checks.map((check) => ({ section: check.section, marks: check.marks, answer: check.answer })));
  const failed = checks.filter((check) => check.answer === 'NON_COMPLIANT' && check.findingId);
  return {
    outlet: inspection.outlet.name,
    score: Math.round(inspection.overallScore ?? score.overallScore),
    outOf: 100,
    grade: inspection.grade,
    counts: {
      compliant: checks.length - score.nonCompliant - score.notApplicable,
      notCompliant: score.nonCompliant,
      notApplicable: score.notApplicable,
      criticalChecksFailed: score.criticalFailed,
      sections: score.sections.length,
      sectionsScoring100: score.sections.filter((section) => section.score === 100).length,
    },
    sections: score.sections.map((section) => ({
      section: section.section,
      scoreOutOf100: section.score,
      checks: checks
        .filter((check) => check.section === section.section)
        .map((check) => ({
          number: check.number,
          check: english(check.label),
          ...(check.critical && { critical: true as const }),
          answer: check.answer ? ANSWER_WORDS[check.answer] : 'not answered',
        })),
    })),
    findings: failed.map((check) => ({
      id: check.findingId!,
      checkNumber: check.number,
      critical: check.critical,
      severity: check.severity,
      found: check.note,
      correctiveAction: check.correctiveAction,
      fixBy: check.dueDate,
    })),
  };
}

/**
 * The facts a number in the summary may come from: the scores, the counts and the
 * dates. Not the findings' ids, whose digits are not numbers anyone could write, and
 * not the checks' numbers, which run from 1 to 92 and would let almost any wrong count
 * through ("7 checks were compliant"); the summary is told not to write them.
 */
const numbersThatCount = (facts: SummaryFacts) => ({
  ...facts,
  sections: facts.sections.map((section) => ({ ...section, checks: section.checks.map(({ number: _number, ...rest }) => rest) })),
  findings: facts.findings.map(({ id: _id, checkNumber: _checkNumber, ...rest }) => rest),
});
