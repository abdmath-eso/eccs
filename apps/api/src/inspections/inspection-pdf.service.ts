import { randomUUID } from 'node:crypto';
import { Injectable, Logger, NotFoundException } from '@nestjs/common';
import {
  INSPECTION_GRADE_FROM,
  isCriticalCheck,
  scoreInspection,
  type InspectionAnswer,
  type InspectionGrade,
  type InspectionSeverity,
  type LocalizedText,
} from '@eccs/shared';
import { indiaDate } from '../checklists/checklists.service.js';
import { PdfPrinterService } from '../pdf/pdf-printer.service.js';
import { day, escapeHtml, factRow as row, moment, REPORT_COLORS, reportFooter, reportPage } from '../pdf/report-page.js';
import { PrismaService } from '../prisma/prisma.service.js';
import { StorageService } from '../storage/storage.service.js';

const TITLE = 'Inspection report';

// The grade in words, as the app and the console show it, and what it means for the restaurant.
const GRADES: Record<InspectionGrade, { label: string; means: string }> = {
  A_PLUS: {
    label: 'A+ · Exemplary',
    means: `A score of ${INSPECTION_GRADE_FROM.A_PLUS} or more with no critical check failed. The kitchen meets the standard throughout; put right the few points listed below.`,
  },
  A: {
    label: 'A · Satisfactory',
    means: `A score of ${INSPECTION_GRADE_FROM.A} to ${INSPECTION_GRADE_FROM.A_PLUS - 1} with no critical check failed. The kitchen meets the standard in most respects; the points listed below need attention.`,
  },
  B: {
    label: 'B · Needs improvement',
    means: `A score of ${INSPECTION_GRADE_FROM.B} to ${INSPECTION_GRADE_FROM.A - 1} with no critical check failed. Several things fall short of the standard and need to be put right by the dates given below.`,
  },
  NON_COMPLIANT: {
    label: 'No grade · Not compliant',
    means: `No grade is given when the score is below ${INSPECTION_GRADE_FROM.B} or when any critical check fails. The non-compliances listed below need prompt action.`,
  },
};

// Most serious first: the order the non-compliances are listed in.
const SEVERITY_ORDER: InspectionSeverity[] = ['CRITICAL', 'HIGH', 'MEDIUM', 'LOW'];
const SEVERITY_WORDS: Record<InspectionSeverity, string> = { LOW: 'Low', MEDIUM: 'Medium', HIGH: 'High', CRITICAL: 'Critical' };

// Each answer has a mark as well as a word, so it never depends on colour (or a colour printer).
const ANSWERS: Record<InspectionAnswer, { mark: string; word: string; style: string }> = {
  COMPLIANT: { mark: '✓', word: 'Compliant', style: 'ok' },
  NON_COMPLIANT: { mark: '✗', word: 'Not compliant', style: 'bad' },
  NOT_APPLICABLE: { mark: '–', word: 'Not applicable', style: 'na' },
};

const english = (text: unknown) => {
  const localized = (text ?? {}) as LocalizedText;
  return localized.en ?? Object.values(localized)[0] ?? '';
};

const plural = (count: number, one: string, many: string) => `${count} ${count === 1 ? one : many}`;

// What this report adds to the styles every ECCS report shares (src/pdf/report-page.ts).
const STYLES = `
  .result { display: flex; gap: 16px; align-items: center; border: 2px solid ${REPORT_COLORS.brand}; border-radius: 8px; padding: 12px 14px; margin-top: 14px; break-inside: avoid; }
  .result.fail { border-color: ${REPORT_COLORS.danger}; }
  .score { text-align: center; min-width: 108px; }
  .score b { display: block; font-size: 34pt; line-height: 1; }
  .grade { font-size: 15pt; font-weight: 700; color: ${REPORT_COLORS.brand}; }
  .fail .grade { color: ${REPORT_COLORS.danger}; }
  .alert { border: 2px solid ${REPORT_COLORS.danger}; border-radius: 6px; padding: 8px 12px; margin-top: 10px; color: ${REPORT_COLORS.danger}; font-weight: 700; break-inside: avoid; }
  .alert span { font-weight: 400; color: ${REPORT_COLORS.text}; }
  .grid th { text-align: left; font-size: 9.5pt; font-weight: 600; color: ${REPORT_COLORS.muted}; padding: 4px 6px; border-bottom: 1.5px solid ${REPORT_COLORS.text}; }
  .grid td { padding: 5px 6px; border-bottom: 1px solid ${REPORT_COLORS.line}; vertical-align: top; }
  .grid tr { break-inside: avoid; }
  .grid .num { text-align: right; white-space: nowrap; }
  .grid .total td { font-weight: 700; border-top: 1.5px solid ${REPORT_COLORS.text}; border-bottom: 0; }
  .bar { width: 22%; } .bar i { display: block; height: 7px; margin-top: 5px; background: ${REPORT_COLORS.line}; border-radius: 4px; overflow: hidden; }
  .bar i b { display: block; height: 100%; background: ${REPORT_COLORS.brand}; }
  .finding { border: 1px solid ${REPORT_COLORS.line}; border-left: 4px solid ${REPORT_COLORS.danger}; border-radius: 4px; padding: 9px 12px; margin-bottom: 10px; break-inside: avoid; }
  .finding h3 { font-size: 11pt; margin: 0 0 4px; }
  .tags { font-size: 9.5pt; font-weight: 700; color: ${REPORT_COLORS.danger}; margin-bottom: 4px; }
  .tags .low { color: ${REPORT_COLORS.muted}; }
  .finding dl { display: grid; grid-template-columns: 30% 1fr; gap: 3px 8px; margin: 4px 0 0; }
  .finding dt { font-weight: 600; color: ${REPORT_COLORS.muted}; }
  .finding dd { margin: 0; white-space: pre-wrap; overflow-wrap: anywhere; }
  .finding .photos { grid-template-columns: repeat(4, 1fr); margin-top: 8px; }
  .keep { break-inside: avoid; }
  .all { break-before: page; }
  .checks { table-layout: fixed; }
  h3.section { font-size: 11pt; margin: 14px 0 2px; break-after: avoid; display: flex; justify-content: space-between; gap: 12px; }
  h3.section span { font-weight: 400; color: ${REPORT_COLORS.muted}; white-space: nowrap; }
  .ok { color: ${REPORT_COLORS.brand}; } .bad { color: ${REPORT_COLORS.danger}; font-weight: 700; } .na { color: ${REPORT_COLORS.muted}; }
  .star { color: ${REPORT_COLORS.warning}; font-weight: 700; white-space: nowrap; }
  .answer { white-space: nowrap; }
`;

/**
 * Makes the PDF of an approved inspection report and files it in the outlet's
 * document vault. The layout follows what inspection reports commonly carry:
 * who and where, the score and grade, the section scores, the non-compliances
 * to act on, then every check with its answer, and ECCS's approval. The format
 * is a sample until ECCS supplies its own.
 */
@Injectable()
export class InspectionPdfService {
  private readonly logger = new Logger(InspectionPdfService.name);
  /** PDFs being made right now, so two requests for the same one share the work. */
  private readonly making = new Map<string, Promise<string>>();

  constructor(
    private readonly prisma: PrismaService,
    private readonly storage: StorageService,
    private readonly printer: PdfPrinterService,
  ) {}

  private get db() {
    return this.prisma.client;
  }

  /**
   * The attachment holding the inspection's report PDF, made now if it does
   * not exist yet. Only a report ECCS has approved has one: before that it can
   * still change. One PDF per report number; asking again returns the same file.
   */
  ensure(inspectionId: string): Promise<string> {
    let job = this.making.get(inspectionId);
    if (!job) {
      job = this.make(inspectionId).finally(() => this.making.delete(inspectionId));
      this.making.set(inspectionId, job);
    }
    return job;
  }

  /** Makes it in the background, right after ECCS approves the report. A failure is logged, not shown. */
  ensureLater(inspectionId: string): void {
    this.ensure(inspectionId).catch((error) =>
      this.logger.warn(`Could not make the report PDF for inspection ${inspectionId}: ${String(error)}`),
    );
  }

  private async make(inspectionId: string): Promise<string> {
    const inspection = await this.db.inspection.findUnique({
      where: { id: inspectionId },
      include: {
        outlet: { include: { organization: { select: { name: true } } } },
        supervisor: { select: { name: true } },
        template: {
          select: {
            title: true,
            items: {
              where: { outletId: null },
              orderBy: { position: 'asc' },
              select: { id: true, position: true, section: true, label: true, weight: true },
            },
          },
        },
        responses: { include: { finding: { include: { attachments: { orderBy: { createdAt: 'asc' } } } } } },
      },
    });
    if (!inspection || inspection.status !== 'APPROVED' || !inspection.reportNumber || !inspection.approvedAt) {
      throw new NotFoundException('The PDF is ready once ECCS has approved the inspection report');
    }

    const number = inspection.reportNumber;
    const storageKey = `outlets/${inspection.outletId}/inspection-reports/${number}.pdf`;
    const existing = await this.db.attachment.findUnique({ where: { storageKey }, select: { id: true } });
    if (existing) return existing.id;

    const approver = inspection.approvedById
      ? await this.db.user.findUnique({ where: { id: inspection.approvedById }, select: { name: true } })
      : null;

    // The report is made of the checks that were answered, whatever the template holds now.
    const responses = new Map(inspection.responses.map((response) => [response.itemId, response]));
    const checks = await Promise.all(
      inspection.template.items
        .filter((item) => responses.has(item.id))
        .map(async (item) => {
          const response = responses.get(item.id)!;
          const finding = response.answer === 'NON_COMPLIANT' ? response.finding : null;
          return {
            number: item.position,
            section: item.section ?? '',
            label: english(item.label),
            marks: item.weight,
            critical: isCriticalCheck(item.weight),
            answer: response.answer,
            finding,
            photos: await Promise.all(
              (finding?.attachments ?? []).map(
                async (photo) =>
                  `data:${photo.mimeType};base64,${(await this.storage.getBuffer(photo.storageKey)).toString('base64')}`,
              ),
            ),
          };
        }),
    );
    const score = scoreInspection(checks);
    const grade = GRADES[score.grade];
    const failed = score.grade === 'NON_COMPLIANT';
    const compliant = checks.length - score.nonCompliant - score.notApplicable;
    const conducted = moment(inspection.startedAt ?? inspection.conductedAt);

    const sectionRows = score.sections
      .map(
        (section, index) => `<tr>
          <td>${index + 1}. ${escapeHtml(section.section)}</td>
          <td class="num">${section.earned} of ${section.possible}</td>
          <td class="num">${section.nonCompliant || '–'}</td>
          <td class="num"><b>${section.score ?? 'n/a'}</b></td>
          <td class="bar"><i><b style="width:${section.score ?? 0}%"></b></i></td>
        </tr>`,
      )
      .join('');

    const rank = (severity: InspectionSeverity | null | undefined) => {
      const place = severity ? SEVERITY_ORDER.indexOf(severity) : -1;
      return place === -1 ? SEVERITY_ORDER.length : place;
    };
    const findings = checks
      .filter((check) => check.answer === 'NON_COMPLIANT')
      .sort(
        (a, b) =>
          Number(b.critical) - Number(a.critical) || rank(a.finding?.severity) - rank(b.finding?.severity) || a.number - b.number,
      );
    const findingCard = (check: (typeof findings)[number], index: number) => {
        const finding = check.finding;
        const severity = finding?.severity ?? null;
        const detail = (label: string, value: string | null | undefined) =>
          // dir="auto": what was typed in Urdu reads from the right, everything else from the left.
          value ? `<dt>${label}</dt><dd dir="auto">${escapeHtml(value)}</dd>` : '';
        return `<div class="finding">
          <h3>${index + 1}. ${escapeHtml(check.label)}</h3>
          <div class="tags">${[
            check.critical ? '<span>★ Critical check</span>' : '',
            severity ? `<span class="${severity === 'LOW' ? 'low' : ''}">Severity: ${SEVERITY_WORDS[severity]}</span>` : '',
            `<span class="low">Check ${check.number} · ${escapeHtml(check.section)}</span>`,
          ]
            .filter(Boolean)
            .join(' &nbsp;·&nbsp; ')}</div>
          <dl>
            ${detail('What was found', finding?.description)}
            ${detail('Corrective action', finding?.correctiveAction)}
            ${detail('Fix by', finding?.dueDate ? day(finding.dueDate) : null)}
          </dl>
          ${check.photos.length > 0 ? `<div class="photos">${check.photos.map((src) => `<img src="${src}" alt="">`).join('')}</div>` : ''}
        </div>`;
    };
    const [firstCard = '', ...otherCards] = findings.map(findingCard);
    const findingsIntro =
      findings.length > 0
        ? '<p class="muted" style="margin-bottom:8px">What needs to be put right, the most serious first. Each has what was found, what to do and the date to do it by.</p>'
        : '<p>None found. Every check that applies was compliant.</p>';

    const allChecks = score.sections
      .map((section, index) => {
        const rows = checks
          .filter((check) => check.section === section.section)
          .map((check) => {
            const answer = ANSWERS[check.answer];
            const earned = check.answer === 'NOT_APPLICABLE' ? '–' : `${check.answer === 'COMPLIANT' ? check.marks : 0} of ${check.marks}`;
            return `<tr>
              <td class="num">${check.number}</td>
              <td>${escapeHtml(check.label)}${check.critical ? ' <span class="star">★ Critical</span>' : ''}</td>
              <td class="answer ${answer.style}">${answer.mark} ${answer.word}</td>
              <td class="num">${earned}</td>
            </tr>`;
          })
          .join('');
        // A section is kept whole on one page (the longest has 13 checks), so its heading
        // and column names never need repeating and no check is left alone over the page.
        return `<div class="keep"><h3 class="section">${index + 1}. ${escapeHtml(section.section)}<span>${
          section.score === null ? 'Nothing applied' : `${section.score} out of 100`
        }</span></h3>
        <table class="grid checks"><colgroup><col style="width:7%"><col><col style="width:23%"><col style="width:11%"></colgroup>
        <thead><tr><th class="num">No.</th><th>Check</th><th>Answer</th><th class="num">Marks</th></tr></thead><tbody>${rows}</tbody></table></div>`;
      })
      .join('');

    const body = `
      <table class="facts" style="margin-top:12px">
        ${row('Client', inspection.outlet.organization.name)}
        ${row('Outlet', inspection.outlet.name)}
        ${row('Address', [inspection.outlet.address, inspection.outlet.city, inspection.outlet.pincode].filter(Boolean).join(', '))}
        ${row('Inspected on', conducted)}
        ${row('Inspected by', `${inspection.supervisor.name}, ECCS`)}
        ${row('Checklist', `${english(inspection.template.title)} · ${plural(checks.length, 'check', 'checks')}`)}
      </table>

      <div class="result${failed ? ' fail' : ''}">
        <div class="score"><b>${score.overallScore}</b><span class="muted">out of 100</span></div>
        <div>
          <div class="grade">${escapeHtml(grade.label)}</div>
          <p>${escapeHtml(grade.means)}</p>
          <p class="muted">${compliant} compliant · ${score.nonCompliant} not compliant · ${score.notApplicable} not applicable · ${score.earned} of ${score.possible} marks</p>
        </div>
      </div>
      ${
        score.criticalFailed > 0
          ? `<div class="alert">⚠ ${plural(score.criticalFailed, 'critical check', 'critical checks')} failed. <span>A failed critical check means no grade, whatever the score. ${
              score.criticalFailed === 1 ? 'It is' : 'They are'
            } listed first under Non-compliances and marked ★.</span></div>`
          : ''
      }

      <h2>Section scores</h2>
      <table class="grid">
        <thead><tr><th>Section</th><th class="num">Marks</th><th class="num">Not compliant</th><th class="num">Score</th><th></th></tr></thead>
        <tbody>
          ${sectionRows}
          <tr class="total"><td>Overall</td><td class="num">${score.earned} of ${score.possible}</td><td class="num">${score.nonCompliant || '–'}</td><td class="num">${score.overallScore}</td><td></td></tr>
        </tbody>
      </table>
      <p class="muted">Each check carries 2 marks and a critical check (★) 4. Checks that do not apply are left out. A score is the marks earned out of the marks possible, as a figure out of 100. A+ is ${INSPECTION_GRADE_FROM.A_PLUS} or more, A is ${INSPECTION_GRADE_FROM.A} to ${INSPECTION_GRADE_FROM.A_PLUS - 1}, B is ${INSPECTION_GRADE_FROM.B} to ${INSPECTION_GRADE_FROM.A - 1}; below ${INSPECTION_GRADE_FROM.B}, or with a critical check failed, there is no grade.</p>

      <!-- The heading stays with the first non-compliance, never alone at the foot of a page. -->
      <div class="keep">
        <h2>Non-compliances (${findings.length})</h2>
        ${findingsIntro}
        ${firstCard}
      </div>
      ${otherCards.join('')}

      <div class="all">
        <h2>All checks</h2>
        <p class="muted">Every check of the inspection in order, with its answer. ✓ Compliant · ✗ Not compliant · – Not applicable · ★ Critical check.</p>
        ${allChecks}
      </div>

      <h2>Approved by ECCS</h2>
      <div class="box">
        <p><b>${escapeHtml(approver?.name ?? 'ECCS')}</b> · ${moment(inspection.approvedAt)}</p>
        <p>Inspection carried out by ${escapeHtml(inspection.supervisor.name)}${
          inspection.completedAt ? ` and finished on ${moment(inspection.completedAt)}` : ''
        }.</p>
        <p class="muted">Checked and approved in the ECCS console under this person's own login. The report records what was seen at the time of the inspection. It is ECCS's own inspection, scored the way FSSAI's hygiene rating checklists are; it is not an FSSAI rating or licence.</p>
      </div>

      <footer class="muted">Report ${escapeHtml(number)} · made on ${moment(new Date())} · Sample format</footer>
    `;

    const pdf = await this.printer.print(reportPage({ title: TITLE, number, styles: STYLES, body }), {
      footer: reportFooter(TITLE, number),
    });
    await this.storage.put(storageKey, pdf, 'application/pdf');

    const id = randomUUID();
    const filedBy = inspection.approvedById ?? inspection.supervisorId;
    try {
      await this.db.$transaction([
        this.db.attachment.create({
          data: {
            id,
            outletId: inspection.outletId,
            kind: 'REPORT',
            storageKey,
            mimeType: 'application/pdf',
            sizeBytes: pdf.length,
            capturedAt: new Date(),
            uploadedById: filedBy,
          },
        }),
        // Filed in the restaurant's document vault, where their other papers are.
        this.db.document.create({
          data: {
            outletId: inspection.outletId,
            category: 'report',
            // The day in India the inspection was carried out, whatever the server's clock zone.
            title: `Inspection report ${number}: ${score.overallScore} out of 100, ${day(
              new Date(`${indiaDate(inspection.startedAt ?? inspection.conductedAt)}T00:00:00.000Z`),
            )}`,
            attachmentId: id,
            uploadedById: filedBy,
          },
        }),
        this.db.inspection.update({ where: { id: inspection.id }, data: { pdfKey: storageKey } }),
      ]);
      return id;
    } catch (error) {
      // Two requests made it at the same moment; the other one's copy is the one on file.
      const other = await this.db.attachment.findUnique({ where: { storageKey }, select: { id: true } });
      if (other) return other.id;
      throw error;
    }
  }
}
