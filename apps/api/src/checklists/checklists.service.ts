import {
  BadRequestException,
  ConflictException,
  ForbiddenException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import type { Prisma } from '@eccs/db';
import {
  can,
  type Action,
  type ChecklistRunDto,
  type ChecklistRunStatus,
  type ChecklistRunSummaryDto,
  type LocalizedText,
  type OutletChecklistDto,
} from '@eccs/shared';
import type { AuthUser } from '../auth/auth.types.js';
import { PrismaService } from '../prisma/prisma.service.js';
import { StorageService } from '../storage/storage.service.js';

const MAX_HISTORY_DAYS = 31;

/** Today's calendar date in India as YYYY-MM-DD. Checklists belong to an Indian working day. */
export function indiaDate(at: Date = new Date()): string {
  return new Intl.DateTimeFormat('en-CA', { timeZone: 'Asia/Kolkata' }).format(at);
}

const toDbDate = (date: string) => new Date(`${date}T00:00:00.000Z`);
const fromDbDate = (date: Date) => date.toISOString().slice(0, 10);

const runInclude = {
  outlet: { select: { id: true, organizationId: true } },
  outletChecklist: { include: { template: { include: { items: { orderBy: { position: 'asc' } } } } } },
  submittedBy: { select: { name: true } },
  responses: { include: { attachments: { orderBy: { createdAt: 'desc' }, take: 1 } } },
} as const satisfies Prisma.ChecklistRunInclude;

type RunRow = Prisma.ChecklistRunGetPayload<{ include: typeof runInclude }>;
type ItemRow = RunRow['outletChecklist']['template']['items'][number];

/** The items that apply to an outlet: ECCS's basic items plus the outlet's own. */
const itemsFor = (items: ItemRow[], outletId: string) =>
  items.filter((item) => item.isActive && (item.outletId === null || item.outletId === outletId));

/** A checklist left unfinished on an earlier day counts as missed. */
const effectiveStatus = (run: { status: ChecklistRunStatus; date: Date }, today: string): ChecklistRunStatus =>
  run.status !== 'SUBMITTED' && fromDbDate(run.date) < today ? 'MISSED' : run.status;

@Injectable()
export class ChecklistsService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly storage: StorageService,
  ) {}

  private get db() {
    return this.prisma.client;
  }

  // ───────────────────────── Filling in ─────────────────────────

  /** Today's checklists for an outlet, creating today's blank copies the first time anyone looks. */
  async today(user: AuthUser, outletId: string): Promise<ChecklistRunDto[]> {
    await this.requireOutlet(user, 'read', outletId);
    const today = indiaDate();

    const lists = await this.db.outletChecklist.findMany({
      where: { outletId, isActive: true, template: { kind: 'DAILY', isActive: true } },
      select: { id: true },
    });
    await this.db.checklistRun.createMany({
      data: lists.map((list) => ({ outletChecklistId: list.id, outletId, date: toDbDate(today), shift: '' })),
      skipDuplicates: true,
    });

    const runs = await this.db.checklistRun.findMany({
      where: { outletId, date: toDbDate(today) },
      include: runInclude,
      orderBy: { outletChecklist: { dueTime: 'asc' } },
    });
    return this.toDtos(runs, today);
  }

  async getRun(user: AuthUser, runId: string): Promise<ChecklistRunDto> {
    const run = await this.requireRun(user, 'read', runId);
    return (await this.toDtos([run], indiaDate()))[0]!;
  }

  /** Records the answer to one item. A proof photo is required. Safe to repeat. */
  async answer(
    user: AuthUser,
    runId: string,
    itemId: string,
    input: { passed: boolean; note?: string | undefined; attachmentId: string; capturedAt?: string | undefined },
  ): Promise<ChecklistRunDto> {
    const run = await this.requireRun(user, 'create', runId);
    this.requireOpen(run);

    const item = itemsFor(run.outletChecklist.template.items, run.outletId).find((candidate) => candidate.id === itemId);
    if (!item) throw new NotFoundException('That item is not on this checklist');

    const photo = await this.db.attachment.findUnique({ where: { id: input.attachmentId } });
    const existing = run.responses.find((response) => response.itemId === itemId);
    const usable =
      photo &&
      photo.outletId === run.outletId &&
      photo.kind === 'PROOF' &&
      (photo.checklistResponseId === null || photo.checklistResponseId === existing?.id);
    if (!usable) throw new BadRequestException('A photo is required for every item');

    const capturedAt = input.capturedAt ? new Date(input.capturedAt) : new Date();
    const answer = { valueBool: input.passed, passed: input.passed, note: input.note ?? null, capturedAt };

    await this.db.$transaction(async (tx) => {
      const response = await tx.checklistResponse.upsert({
        where: { runId_itemId: { runId, itemId } },
        create: { runId, itemId, ...answer },
        update: answer,
      });
      // One proof photo per answer: retaking the photo replaces the old link.
      await tx.attachment.updateMany({
        where: { checklistResponseId: response.id, id: { not: photo.id } },
        data: { checklistResponseId: null },
      });
      await tx.attachment.update({ where: { id: photo.id }, data: { checklistResponseId: response.id } });
      if (run.status === 'PENDING') {
        await tx.checklistRun.update({ where: { id: runId }, data: { status: 'IN_PROGRESS' } });
      }
    });

    return this.getRun(user, runId);
  }

  /** Hands the checklist in. Every item must have an answer with a photo. */
  async submit(user: AuthUser, runId: string): Promise<ChecklistRunDto> {
    const run = await this.requireRun(user, 'create', runId);
    this.requireOpen(run);

    const items = itemsFor(run.outletChecklist.template.items, run.outletId);
    const answered = new Set(run.responses.filter((response) => response.attachments.length > 0).map((r) => r.itemId));
    const missing = items.filter((item) => !answered.has(item.id)).length;
    if (missing > 0) {
      throw new BadRequestException(
        missing === 1 ? '1 item still needs a photo' : `${missing} items still need a photo`,
      );
    }

    await this.db.checklistRun.update({
      where: { id: runId },
      data: { status: 'SUBMITTED', submittedById: user.id, submittedAt: new Date() },
    });
    return this.getRun(user, runId);
  }

  /** The Manager or Owner marks a submitted checklist as checked. */
  async review(user: AuthUser, runId: string): Promise<ChecklistRunDto> {
    const run = await this.requireRun(user, 'approve', runId);
    if (run.status !== 'SUBMITTED') throw new ConflictException('Only a submitted checklist can be reviewed');
    if (!run.reviewedAt) {
      await this.db.checklistRun.update({
        where: { id: runId },
        data: { reviewedById: user.id, reviewedAt: new Date() },
      });
    }
    return this.getRun(user, runId);
  }

  // ───────────────────────── History ─────────────────────────

  /** The last few days, newest first. Days nobody opened the app are recorded as missed. */
  async history(user: AuthUser, outletId: string, days: number): Promise<ChecklistRunSummaryDto[]> {
    await this.requireOutlet(user, 'read', outletId);
    const span = Math.min(Math.max(Math.trunc(days) || 7, 1), MAX_HISTORY_DAYS);
    const today = indiaDate();
    const dates = Array.from({ length: span }, (_, index) => indiaDate(new Date(Date.now() - index * 86_400_000)));
    const oldest = dates[dates.length - 1]!;

    const lists = await this.db.outletChecklist.findMany({
      where: { outletId, isActive: true, template: { kind: 'DAILY', isActive: true } },
      select: { id: true, createdAt: true },
    });
    const missed = lists.flatMap((list) =>
      dates
        .filter((date) => date < today && date >= indiaDate(list.createdAt))
        .map((date) => ({
          outletChecklistId: list.id,
          outletId,
          date: toDbDate(date),
          shift: '',
          status: 'MISSED' as const,
        })),
    );
    if (missed.length > 0) await this.db.checklistRun.createMany({ data: missed, skipDuplicates: true });

    const runs = await this.db.checklistRun.findMany({
      where: { outletId, date: { gte: toDbDate(oldest), lte: toDbDate(today) } },
      include: runInclude,
      orderBy: [{ date: 'desc' }, { outletChecklist: { dueTime: 'asc' } }],
    });

    return runs.map((run) => {
      const items = itemsFor(run.outletChecklist.template.items, run.outletId);
      const itemIds = new Set(items.map((item) => item.id));
      const responses = run.responses.filter((response) => itemIds.has(response.itemId));
      return {
        id: run.id,
        title: run.outletChecklist.template.title as LocalizedText,
        date: fromDbDate(run.date),
        status: effectiveStatus(run, today),
        itemCount: Math.max(items.length, responses.length),
        doneCount: responses.length,
        problemCount: responses.filter((response) => response.passed === false).length,
        submittedByName: run.submittedBy?.name ?? null,
        reviewedAt: run.reviewedAt?.toISOString() ?? null,
      };
    });
  }

  // ───────────────────────── The outlet's own items ─────────────────────────

  async outletChecklists(user: AuthUser, outletId: string): Promise<OutletChecklistDto[]> {
    await this.requireOutlet(user, 'read', outletId);
    const lists = await this.db.outletChecklist.findMany({
      where: { outletId, isActive: true, template: { kind: 'DAILY', isActive: true } },
      include: { template: { include: { items: { orderBy: { position: 'asc' } } } } },
      orderBy: { dueTime: 'asc' },
    });
    return lists.map((list) => ({
      id: list.id,
      outletId: list.outletId,
      title: list.template.title as LocalizedText,
      dueTime: list.dueTime,
      items: itemsFor(list.template.items, outletId).map((item) => ({
        id: item.id,
        label: item.label as LocalizedText,
        isCustom: item.outletId !== null,
      })),
    }));
  }

  /** The Owner or Manager adds a check specific to their kitchen. It needs a photo like every other item. */
  async addItem(user: AuthUser, outletChecklistId: string, label: string): Promise<OutletChecklistDto[]> {
    const list = await this.db.outletChecklist.findUnique({ where: { id: outletChecklistId } });
    if (!list) throw new NotFoundException('Checklist not found');
    await this.requireOutlet(user, 'update', list.outletId);

    const last = await this.db.checklistItem.aggregate({
      where: { templateId: list.templateId },
      _max: { position: true },
    });
    await this.db.checklistItem.create({
      data: {
        templateId: list.templateId,
        outletId: list.outletId,
        createdById: user.id,
        position: (last._max.position ?? 0) + 1,
        // Typed in one language; shown as typed to everyone at the outlet.
        label: { [user.language.toLowerCase()]: label },
        type: 'YES_NO',
        photoRequired: true,
      },
    });
    return this.outletChecklists(user, list.outletId);
  }

  /** Removes an item the restaurant added. ECCS's basic items cannot be removed. Past answers are kept. */
  async removeItem(user: AuthUser, itemId: string): Promise<OutletChecklistDto[]> {
    const item = await this.db.checklistItem.findUnique({ where: { id: itemId } });
    if (!item?.outletId) throw new NotFoundException('Only items your restaurant added can be removed');
    await this.requireOutlet(user, 'update', item.outletId);
    await this.db.checklistItem.update({ where: { id: itemId }, data: { isActive: false } });
    return this.outletChecklists(user, item.outletId);
  }

  // ───────────────────────── Helpers ─────────────────────────

  /** Checks the user may do this at the outlet. "Not found" and "not yours" look the same. */
  private async requireOutlet(user: AuthUser, action: Action, outletId: string) {
    const outlet = await this.db.outlet.findUnique({
      where: { id: outletId },
      select: { id: true, organizationId: true },
    });
    const allowed =
      outlet && can(user.memberships, 'checklists', action, { organizationId: outlet.organizationId, outletId });
    if (!outlet || !allowed) throw new ForbiddenException('You cannot do this at this outlet');
    return outlet;
  }

  private async requireRun(user: AuthUser, action: Action, runId: string): Promise<RunRow> {
    const run = await this.db.checklistRun.findUnique({ where: { id: runId }, include: runInclude });
    const allowed =
      run &&
      can(user.memberships, 'checklists', action, {
        organizationId: run.outlet.organizationId,
        outletId: run.outletId,
      });
    if (!run || !allowed) throw new NotFoundException('Checklist not found');
    return run;
  }

  private requireOpen(run: RunRow) {
    if (run.status === 'SUBMITTED') throw new ConflictException('This checklist has already been submitted');
    if (effectiveStatus(run, indiaDate()) === 'MISSED') {
      throw new ConflictException('This checklist was for an earlier day and is closed');
    }
  }

  private async toDtos(runs: RunRow[], today: string): Promise<ChecklistRunDto[]> {
    // Names of everyone who reviewed a run or took a proof photo, in one query.
    const personIds = new Set<string>();
    for (const run of runs) {
      if (run.reviewedById) personIds.add(run.reviewedById);
      for (const response of run.responses) {
        const takenBy = response.attachments[0]?.uploadedById;
        if (takenBy) personIds.add(takenBy);
      }
    }
    const people = personIds.size
      ? await this.db.user.findMany({ where: { id: { in: [...personIds] } }, select: { id: true, name: true } })
      : [];
    const personName = new Map(people.map((person) => [person.id, person.name]));

    return runs.map((run) => {
      const responses = new Map(run.responses.map((response) => [response.itemId, response]));
      const status = effectiveStatus(run, today);
      // A closed checklist shows what was actually answered, even if items were removed since.
      const items =
        status === 'SUBMITTED' || status === 'MISSED'
          ? run.outletChecklist.template.items.filter(
              (item) => responses.has(item.id) || itemsFor([item], run.outletId).length > 0,
            )
          : itemsFor(run.outletChecklist.template.items, run.outletId);

      return {
        id: run.id,
        outletChecklistId: run.outletChecklistId,
        outletId: run.outletId,
        title: run.outletChecklist.template.title as LocalizedText,
        date: fromDbDate(run.date),
        dueTime: run.outletChecklist.dueTime,
        status,
        submittedAt: run.submittedAt?.toISOString() ?? null,
        submittedByName: run.submittedBy?.name ?? null,
        reviewedAt: run.reviewedAt?.toISOString() ?? null,
        reviewedByName: run.reviewedById ? (personName.get(run.reviewedById) ?? null) : null,
        items: items.map((item) => {
          const response = responses.get(item.id);
          const photo = response?.attachments[0];
          return {
            id: item.id,
            label: item.label as LocalizedText,
            isCustom: item.outletId !== null,
            response: response
              ? {
                  passed: response.passed ?? true,
                  note: response.note,
                  capturedAt: response.capturedAt.toISOString(),
                  takenByName: photo?.uploadedById ? (personName.get(photo.uploadedById) ?? null) : null,
                  photoPath: photo ? this.storage.signedPath(photo.id) : null,
                }
              : null,
          };
        }),
      };
    });
  }
}
