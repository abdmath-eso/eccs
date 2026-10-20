import { BadRequestException, ConflictException, Injectable, NotFoundException } from '@nestjs/common';
import type { Prisma } from '@eccs/db';
import {
  incidentReference,
  indiaDay,
  localize,
  QUALITY_RULES,
  salesRupees,
  type IncidentDto,
  type IncidentsDto,
  type IncidentStatus,
  type IncidentSummaryDto,
  type LocalizedText,
} from '@eccs/shared';
import { noteActivity } from '../activity-log/activity-context.js';
import type { AuthUser } from '../auth/auth.types.js';
import { PdfPrinterService } from '../pdf/pdf-printer.service.js';
import { day, escapeHtml, factRow, moment, reportFooter, reportPage } from '../pdf/report-page.js';
import { PrismaService } from '../prisma/prisma.service.js';
import { StorageService } from '../storage/storage.service.js';

// Quality > Incidents (20 Oct 2026; docs/CONSOLE_PLAN.md 4.5): anything that could become a
// claim, a complaint or a lesson (an injury, damage, a missing item). The office adds them (the
// Supervisor phones in), follows them up and closes them with what was paid or done. Each has its
// own console page and a PDF of the whole story for an insurer or a lawyer; there is no public link.
// Photos and files come through the usual upload (POST /attachments for the outlet) and are tied
// to the incident here. The fields follow an accident book's: when, where, what happened, what
// was done, who dealt with it.

const toDbDate = (date: string) => new Date(`${date}T00:00:00.000Z`);
const fromDbDate = (date: Date) => date.toISOString().slice(0, 10);
const rupeesToPaise = (rupees: number | null | undefined) => (rupees === null || rupees === undefined ? null : Math.round(rupees * 100));

const incidentInclude = {
  outlet: { select: { name: true, address: true, city: true, organization: { select: { name: true } } } },
  job: { select: { id: true, scheduledDate: true, serviceType: { select: { name: true } }, supervisor: { select: { name: true } }, serviceReport: { select: { number: true } } } },
  attachments: { orderBy: { createdAt: 'asc' }, select: { id: true, mimeType: true, storageKey: true } },
} as const satisfies Prisma.IncidentInclude;
type IncidentRow = Prisma.IncidentGetPayload<{ include: typeof incidentInclude }>;

@Injectable()
export class IncidentsService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly storage: StorageService,
    private readonly printer: PdfPrinterService,
  ) {}

  private get db() {
    return this.prisma.client;
  }

  /** Open first, then the most recent day first. */
  async list(state: 'open' | 'all'): Promise<IncidentsDto> {
    const rows = await this.db.incident.findMany({
      where: state === 'open' ? { status: 'OPEN' } : {},
      include: { outlet: { select: { name: true } }, _count: { select: { attachments: true } } },
      orderBy: [{ happenedOn: 'desc' }, { createdAt: 'desc' }],
      take: 500,
    });
    const items = rows.map(
      (row): IncidentSummaryDto => ({
        id: row.id,
        reference: incidentReference(row.reference),
        outletId: row.outletId,
        outletName: row.outlet.name,
        happenedOn: fromDbDate(row.happenedOn),
        whatHappened: row.whatHappened,
        whatWasDone: row.whatWasDone,
        costPaise: row.costPaise,
        status: row.status as IncidentStatus,
        fileCount: row._count.attachments,
      }),
    );
    return { items: [...items.filter((item) => item.status === 'OPEN'), ...items.filter((item) => item.status !== 'OPEN')] };
  }

  async get(incidentId: string): Promise<IncidentDto> {
    const row = await this.require(incidentId);
    return this.toDto(row, await this.names(row));
  }

  /** Open incidents, for Today ("Incident open: any") and the badge. */
  async open(): Promise<{ id: string; reference: string; outletName: string; whatHappened: string; happenedOn: string }[]> {
    const rows = await this.db.incident.findMany({
      where: { status: 'OPEN' },
      select: { id: true, reference: true, whatHappened: true, happenedOn: true, outlet: { select: { name: true } } },
      orderBy: { happenedOn: 'asc' },
    });
    return rows.map((row) => ({ id: row.id, reference: incidentReference(row.reference), outletName: row.outlet.name, whatHappened: row.whatHappened, happenedOn: fromDbDate(row.happenedOn) }));
  }

  async create(
    user: AuthUser,
    input: {
      outletId: string;
      visitId?: string | null | undefined;
      happenedOn: string;
      whatHappened: string;
      whatWasDone?: string | undefined;
      costRupees?: number | null | undefined;
      attachmentIds?: string[] | undefined;
    },
    now: Date,
  ): Promise<IncidentDto> {
    const outlet = await this.db.outlet.findUnique({ where: { id: input.outletId }, select: { id: true } });
    if (!outlet) throw new BadRequestException('Choose the outlet');
    this.requireDay(input.happenedOn, now);
    await this.requireVisitAt(input.visitId, outlet.id);
    const files = await this.requireFiles(input.attachmentIds ?? [], outlet.id, null);
    const created = await this.db.$transaction(async (tx) => {
      const made = await tx.incident.create({
        data: {
          outletId: outlet.id,
          jobId: input.visitId ?? null,
          happenedOn: toDbDate(input.happenedOn),
          whatHappened: input.whatHappened,
          whatWasDone: input.whatWasDone || null,
          costPaise: rupeesToPaise(input.costRupees),
          createdById: user.id,
        },
      });
      if (files.length > 0) await tx.attachment.updateMany({ where: { id: { in: files } }, data: { incidentId: made.id } });
      return made;
    });
    return this.get(created.id);
  }

  async update(
    incidentId: string,
    input: {
      visitId?: string | null | undefined;
      happenedOn?: string | undefined;
      whatHappened?: string | undefined;
      whatWasDone?: string | undefined;
      costRupees?: number | null | undefined;
      addAttachmentIds?: string[] | undefined;
      removeAttachmentIds?: string[] | undefined;
    },
    now: Date,
  ): Promise<IncidentDto> {
    const incident = await this.require(incidentId);
    if (input.happenedOn !== undefined) this.requireDay(input.happenedOn, now);
    if (input.visitId !== undefined) await this.requireVisitAt(input.visitId, incident.outletId);
    const adding = await this.requireFiles(input.addAttachmentIds ?? [], incident.outletId, incident.id);
    const kept = incident.attachments.length + adding.filter((id) => !incident.attachments.some((file) => file.id === id)).length - (input.removeAttachmentIds?.length ?? 0);
    if (kept > QUALITY_RULES.maxIncidentFiles) throw new BadRequestException(`An incident can hold at most ${QUALITY_RULES.maxIncidentFiles} photos and files`);
    await this.db.$transaction(async (tx) => {
      await tx.incident.update({
        where: { id: incident.id },
        data: {
          ...(input.visitId !== undefined && { jobId: input.visitId }),
          ...(input.happenedOn !== undefined && { happenedOn: toDbDate(input.happenedOn) }),
          ...(input.whatHappened !== undefined && { whatHappened: input.whatHappened }),
          ...(input.whatWasDone !== undefined && { whatWasDone: input.whatWasDone || null }),
          ...(input.costRupees !== undefined && { costPaise: rupeesToPaise(input.costRupees) }),
        },
      });
      if (adding.length > 0) await tx.attachment.updateMany({ where: { id: { in: adding } }, data: { incidentId: incident.id } });
      // Taken off the incident, not deleted: the file stays in storage with the outlet, as other removed proof does.
      if (input.removeAttachmentIds?.length) {
        await tx.attachment.updateMany({ where: { id: { in: input.removeAttachmentIds }, incidentId: incident.id }, data: { incidentId: null } });
      }
    });
    return this.get(incident.id);
  }

  /** Close with how it ended: what was paid or done, and the final cost. */
  async close(user: AuthUser, incidentId: string, input: { note: string; costRupees?: number | null | undefined }, now: Date): Promise<IncidentDto> {
    const incident = await this.require(incidentId);
    if (incident.status === 'CLOSED') throw new ConflictException('This incident is already closed');
    await this.db.incident.update({
      where: { id: incident.id },
      data: {
        status: 'CLOSED',
        closedAt: now,
        closedById: user.id,
        closeNote: input.note,
        ...(input.costRupees !== undefined && { costPaise: rupeesToPaise(input.costRupees) }),
      },
    });
    return this.get(incident.id);
  }

  async reopen(incidentId: string): Promise<IncidentDto> {
    const incident = await this.require(incidentId);
    if (incident.status !== 'CLOSED') throw new ConflictException('This incident is open');
    // The closing note is kept in the log of who did what; the incident is open again with nothing closed about it.
    await this.db.incident.update({ where: { id: incident.id }, data: { status: 'OPEN', closedAt: null, closedById: null, closeNote: null } });
    return this.get(incident.id);
  }

  /** The month's incidents for the strip: those that happened this month, those open now, and their cost. */
  async monthFacts(month: string): Promise<{ incidents: number; incidentsOpen: number; incidentCostPaise: number }> {
    const start = toDbDate(`${month}-01`);
    const [count, open, cost] = await Promise.all([
      this.db.incident.count({ where: { happenedOn: { gte: start } } }),
      this.db.incident.count({ where: { status: 'OPEN' } }),
      this.db.incident.aggregate({ where: { happenedOn: { gte: start } }, _sum: { costPaise: true } }),
    ]);
    return { incidents: count, incidentsOpen: open, incidentCostPaise: cost._sum.costPaise ?? 0 };
  }

  // ───────────────────────── The PDF ─────────────────────────

  /** The whole story on paper, for an insurer or a lawyer: the facts, the visit, what was done, how it ended, and the photos. */
  async pdf(incidentId: string): Promise<{ body: Buffer; name: string }> {
    const incident = await this.require(incidentId);
    const dto = this.toDto(incident, await this.names(incident));
    const photos = incident.attachments.filter((file) => file.mimeType.startsWith('image/'));
    const pictures = await Promise.all(
      photos.map(async (photo) => `<img src="data:${photo.mimeType};base64,${(await this.storage.getBuffer(photo.storageKey)).toString('base64')}" alt="">`),
    );
    const files = incident.attachments.length - photos.length;
    const body = `
      <h2>The incident</h2>
      <table class="facts">
        ${factRow('Client', dto.organizationName)}
        ${factRow('Outlet', dto.outletName)}
        ${factRow('Address', dto.outletAddress)}
        ${factRow('Day it happened', day(incident.happenedOn))}
        ${factRow('Status', dto.status === 'OPEN' ? 'Open' : 'Closed')}
        ${factRow('Cost to ECCS', dto.costPaise ? salesRupees(dto.costPaise) : 'None recorded')}
        ${factRow('Added by', `${dto.createdByName}, ${moment(incident.createdAt)}`)}
        ${dto.closedAt ? factRow('Closed by', `${dto.closedByName ?? ''}, ${moment(new Date(dto.closedAt))}`) : ''}
      </table>
      ${
        dto.visit
          ? `<h2>The visit</h2><table class="facts">
              ${factRow('Service', localize(dto.visit.serviceName, 'EN'))}
              ${factRow('Day', day(toDbDate(dto.visit.date)))}
              ${factRow('Supervisor', dto.visit.supervisorName)}
              ${factRow('Service report', dto.visit.reportNumber)}
            </table>`
          : ''
      }
      <h2>What happened</h2>
      <div class="box"><p>${escapeHtml(dto.whatHappened)}</p></div>
      <h2>What was done</h2>
      <div class="box"><p>${escapeHtml(dto.whatWasDone ?? 'Nothing recorded yet.')}</p></div>
      ${dto.closeNote ? `<h2>How it ended</h2><div class="box"><p>${escapeHtml(dto.closeNote)}</p></div>` : ''}
      ${pictures.length > 0 ? `<h2>Photos</h2><div class="photos">${pictures.join('')}</div>` : ''}
      ${files > 0 ? `<p class="muted">${files === 1 ? 'One file (a PDF) is' : `${files} files (PDFs) are`} kept with the incident in the ECCS console.</p>` : ''}
      <footer class="muted">Printed from the ECCS console on ${moment(new Date())}. Every entry above is as recorded at the time; the console keeps a log of who changed what.</footer>`;
    const html = reportPage({ title: 'Incident record', number: dto.reference, body });
    noteActivity({ details: { status: dto.status } });
    return { body: await this.printer.print(html, { footer: reportFooter('Incident record', dto.reference) }), name: `Incident ${dto.reference}.pdf` };
  }

  // ───────────────────────── Helpers ─────────────────────────

  private async require(incidentId: string): Promise<IncidentRow> {
    const row = await this.db.incident.findUnique({ where: { id: incidentId }, include: incidentInclude });
    if (!row) throw new NotFoundException('Incident not found');
    return row;
  }

  /** An incident is recorded after the fact: today or an earlier day, within a year. */
  private requireDay(date: string, now: Date) {
    const today = indiaDay(now);
    if (date > today) throw new BadRequestException('Choose today or an earlier day');
    if (toDbDate(date).getTime() < toDbDate(today).getTime() - 366 * 86_400_000) throw new BadRequestException('Choose a day within the last year');
  }

  private async requireVisitAt(visitId: string | null | undefined, outletId: string) {
    if (!visitId) return;
    const visit = await this.db.job.findUnique({ where: { id: visitId }, select: { outletId: true } });
    if (!visit || visit.outletId !== outletId) throw new BadRequestException('Choose one of this outlet\'s visits');
  }

  /** Files uploaded for this outlet, not tied to anything else (or already this incident's). */
  private async requireFiles(ids: string[], outletId: string, incidentId: string | null): Promise<string[]> {
    const wanted = [...new Set(ids)];
    if (wanted.length === 0) return [];
    const files = await this.db.attachment.findMany({
      where: {
        id: { in: wanted },
        outletId,
        kind: { in: ['PROOF', 'DOCUMENT'] },
        checklistResponseId: null,
        jobId: null,
        issueId: null,
        inspectionFindingId: null,
        OR: [{ incidentId: null }, ...(incidentId ? [{ incidentId }] : [])],
      },
      select: { id: true },
    });
    if (files.length !== wanted.length) throw new BadRequestException('Upload the photos and files for this outlet first');
    return files.map((file) => file.id);
  }

  /** Who added and who closed it; incidents keep ids, not names, so a renamed person reads as they are now. */
  private async names(row: IncidentRow): Promise<Map<string, string>> {
    const ids = [row.createdById, row.closedById].filter((id): id is string => Boolean(id));
    const people = await this.db.user.findMany({ where: { id: { in: ids } }, select: { id: true, name: true } });
    return new Map(people.map((person) => [person.id, person.name]));
  }

  private toDto(row: IncidentRow, names: Map<string, string>): IncidentDto {
    return {
      id: row.id,
      reference: incidentReference(row.reference),
      outletId: row.outletId,
      outletName: row.outlet.name,
      organizationName: row.outlet.organization.name,
      outletAddress: [row.outlet.address, row.outlet.city].filter(Boolean).join(', ') || null,
      happenedOn: fromDbDate(row.happenedOn),
      whatHappened: row.whatHappened,
      whatWasDone: row.whatWasDone,
      costPaise: row.costPaise,
      status: row.status as IncidentStatus,
      fileCount: row.attachments.length,
      visit: row.job
        ? {
            id: row.job.id,
            date: fromDbDate(row.job.scheduledDate),
            serviceName: row.job.serviceType.name as LocalizedText,
            supervisorName: row.job.supervisor?.name ?? null,
            reportNumber: row.job.serviceReport?.number ?? null,
          }
        : null,
      files: row.attachments.map((file) => ({ id: file.id, path: this.storage.signedPath(file.id), isPdf: file.mimeType === 'application/pdf' })),
      createdByName: names.get(row.createdById) ?? 'someone who has left',
      createdAt: row.createdAt.toISOString(),
      closedByName: row.closedById ? (names.get(row.closedById) ?? 'someone who has left') : null,
      closedAt: row.closedAt?.toISOString() ?? null,
      closeNote: row.closeNote,
    };
  }
}
