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
  type ChecklistSuggestionDto,
  type LocalizedText,
  type OutletChecklistDto,
} from '@eccs/shared';
import type { AuthUser } from '../auth/auth.types.js';
import { PrismaService } from '../prisma/prisma.service.js';
import { StorageService } from '../storage/storage.service.js';

const MAX_HISTORY_DAYS = 31;
const MAX_SUGGESTIONS = 8;

// Words too common to help narrow a search of the library.
const STOP_WORDS = new Set(['the', 'and', 'for', 'are', 'is', 'of', 'to', 'in', 'on', 'at', 'a', 'an', 'no', 'not', 'with']);

// Everyday words people type, and the words the library uses for the same thing.
// Each group is searched together: typing any one finds checks containing any other.
const SYNONYM_GROUPS = [
  ['fridge', 'refrigerator', 'refrigerated', 'refrigeration', 'chiller'],
  ['freezer', 'frozen', 'deep freezer'],
  ['chimney', 'hood', 'exhaust'],
  ['gas', 'lpg'],
  ['stove', 'burner', 'range', 'hob'],
  ['toilet', 'washroom', 'restroom', 'bathroom'],
  ['dustbin', 'bin', 'bins', 'garbage', 'waste', 'trash'],
  ['rat', 'rats', 'rodent', 'mouse', 'mice'],
  ['cockroach', 'cockroaches', 'roach', 'insects'],
  ['fly', 'flies', 'insect'],
  ['oil', 'frying', 'fryer'],
  ['handwash', 'handwashing', 'hand wash', 'wash basin'],
  ['uniform', 'apron', 'clothing'],
  ['cap', 'hairnet', 'hair'],
  ['expiry', 'expired', 'use-by', 'date'],
  ['label', 'labelled', 'labelling', 'labeled'],
  ['temperature', 'temp'],
  ['floor', 'floors'],
  ['drain', 'drains'],
  ['knife', 'knives'],
  ['licence', 'license'],
  ['veg', 'vegetarian'],
  ['masala', 'spice', 'spices'],
  ['atta', 'flour', 'maida'],
];
const SYNONYMS = new Map<string, string[]>();
for (const group of SYNONYM_GROUPS) {
  for (const word of group) SYNONYMS.set(word, [...new Set([...(SYNONYMS.get(word) ?? []), ...group])]);
}
/** A typed word plus the other words that mean the same, the typed word first. */
export const alternatives = (term: string) => [term, ...(SYNONYMS.get(term) ?? []).filter((word) => word !== term)];

/** The meaningful words in a string, lower case, for matching checks against each other. */
export const words = (text: string) =>
  text
    .toLowerCase()
    .split(/[^a-z0-9]+/)
    .filter((word) => word.length > 1 && !STOP_WORDS.has(word));

/** Today's calendar date in India as YYYY-MM-DD. Checklists belong to an Indian working day. */
export function indiaDate(at: Date = new Date()): string {
  return new Intl.DateTimeFormat('en-CA', { timeZone: 'Asia/Kolkata' }).format(at);
}

/** The time of day in India as HH:mm, for comparing with a checklist's due time. */
export function indiaTime(at: Date = new Date()): string {
  return new Intl.DateTimeFormat('en-GB', { timeZone: 'Asia/Kolkata', hour: '2-digit', minute: '2-digit', hour12: false }).format(at);
}

/** Checklists in the order they fall due; ones without a time come last. */
const byDueTime = <T extends { dueTime: string | null }>(a: T, b: T) =>
  (a.dueTime ?? '99:99').localeCompare(b.dueTime ?? '99:99');

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
      select: { id: true, template: { select: { items: true } } },
    });
    // A checklist the restaurant has created but not yet given any items is not handed out.
    const usable = lists.filter((list) => itemsFor(list.template.items, outletId).length > 0);
    await this.db.checklistRun.createMany({
      data: usable.map((list) => ({ outletChecklistId: list.id, outletId, date: toDbDate(today), shift: '' })),
      skipDuplicates: true,
    });

    const runs = await this.db.checklistRun.findMany({
      where: { outletId, date: toDbDate(today), outletChecklistId: { in: usable.map((list) => list.id) } },
      include: runInclude,
    });
    const dtos = await this.toDtos(runs, today);
    return dtos.sort(byDueTime);
  }

  async getRun(user: AuthUser, runId: string): Promise<ChecklistRunDto> {
    const run = await this.requireRun(user, 'read', runId);
    return (await this.toDtos([run], indiaDate()))[0]!;
  }

  /**
   * Records the answer to one item. A proof photo is required unless the
   * item is tick-only. Safe to repeat.
   */
  async answer(
    user: AuthUser,
    runId: string,
    itemId: string,
    input: {
      passed: boolean;
      note?: string | undefined;
      attachmentId?: string | undefined;
      capturedAt?: string | undefined;
    },
  ): Promise<ChecklistRunDto> {
    const run = await this.requireRun(user, 'create', runId);
    this.requireOpen(run);

    const item = itemsFor(run.outletChecklist.template.items, run.outletId).find((candidate) => candidate.id === itemId);
    if (!item) throw new NotFoundException('That item is not on this checklist');

    const existing = run.responses.find((response) => response.itemId === itemId);
    const photo = input.attachmentId
      ? await this.db.attachment.findUnique({ where: { id: input.attachmentId } })
      : null;
    const usable =
      photo &&
      photo.outletId === run.outletId &&
      photo.kind === 'PROOF' &&
      (photo.checklistResponseId === null || photo.checklistResponseId === existing?.id);
    if (input.attachmentId ? !usable : item.photoRequired) {
      throw new BadRequestException('This item needs a photo');
    }

    const capturedAt = input.capturedAt ? new Date(input.capturedAt) : new Date();
    const answer = { valueBool: input.passed, passed: input.passed, note: input.note ?? null, capturedAt };

    await this.db.$transaction(async (tx) => {
      const response = await tx.checklistResponse.upsert({
        where: { runId_itemId: { runId, itemId } },
        // Changing OK / Problem later does not change who first answered.
        create: { runId, itemId, answeredById: user.id, ...answer },
        update: answer,
      });
      if (photo) {
        // One proof photo per answer: retaking the photo replaces the old link.
        await tx.attachment.updateMany({
          where: { checklistResponseId: response.id, id: { not: photo.id } },
          data: { checklistResponseId: null },
        });
        await tx.attachment.update({ where: { id: photo.id }, data: { checklistResponseId: response.id } });
      }
      if (run.status === 'PENDING') {
        await tx.checklistRun.update({ where: { id: runId }, data: { status: 'IN_PROGRESS' } });
      }
    });

    return this.getRun(user, runId);
  }

  /** Removes the answer to an item, for example a tick made by mistake. Only while the checklist is open. */
  async clearAnswer(user: AuthUser, runId: string, itemId: string): Promise<ChecklistRunDto> {
    const run = await this.requireRun(user, 'create', runId);
    this.requireOpen(run);
    const existing = run.responses.find((response) => response.itemId === itemId);
    if (existing) {
      await this.db.$transaction([
        this.db.attachment.updateMany({ where: { checklistResponseId: existing.id }, data: { checklistResponseId: null } }),
        this.db.checklistResponse.delete({ where: { id: existing.id } }),
      ]);
    }
    return this.getRun(user, runId);
  }

  /** Hands the checklist in. Every item must be answered, with a photo where the item needs one. */
  async submit(user: AuthUser, runId: string): Promise<ChecklistRunDto> {
    const run = await this.requireRun(user, 'create', runId);
    this.requireOpen(run);

    const items = itemsFor(run.outletChecklist.template.items, run.outletId);
    const responses = new Map(run.responses.map((response) => [response.itemId, response]));
    const missing = items.filter((item) => {
      const response = responses.get(item.id);
      return !response || (item.photoRequired && response.attachments.length === 0);
    }).length;
    if (missing > 0) {
      throw new BadRequestException(missing === 1 ? '1 item is not done yet' : `${missing} items are not done yet`);
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
    const oldest = indiaDate(new Date(Date.now() - (span - 1) * 86_400_000));
    return this.summaries(outletId, oldest, indiaDate());
  }

  /**
   * Every checklist between two dates (YYYY-MM-DD, at most a month apart),
   * newest first, for the history calendar. Days after today are ignored.
   */
  async between(user: AuthUser, outletId: string, from: string, to: string): Promise<ChecklistRunSummaryDto[]> {
    await this.requireOutlet(user, 'read', outletId);
    const today = indiaDate();
    if (from > today) return [];
    return this.summaries(outletId, from, to < today ? to : today);
  }

  private async summaries(outletId: string, oldest: string, newest: string): Promise<ChecklistRunSummaryDto[]> {
    const today = indiaDate();
    const dates: string[] = [];
    for (let at = toDbDate(newest); fromDbDate(at) >= oldest && dates.length < MAX_HISTORY_DAYS; at = new Date(at.getTime() - 86_400_000)) {
      dates.push(fromDbDate(at));
    }

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
      where: { outletId, date: { gte: toDbDate(oldest), lte: toDbDate(newest) } },
      include: runInclude,
      orderBy: [{ date: 'desc' }, { outletChecklist: { dueTime: 'asc' } }],
    });

    const rows = runs.map((run) => {
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
    return rows.filter((row) => row.itemCount > 0);
  }

  // ───────────────────────── The outlet's own checklists and items ─────────────────────────

  /** The Owner or Manager creates an extra checklist for their outlet, such as "Mid-day checklist". */
  async createList(
    user: AuthUser,
    input: { outletId: string; title: string; dueTime?: string | undefined },
  ): Promise<OutletChecklistDto[]> {
    await this.requireOutlet(user, 'update', input.outletId);
    await this.db.outletChecklist.create({
      data: {
        outlet: { connect: { id: input.outletId } },
        frequency: 'DAILY',
        dueTime: input.dueTime ?? null,
        template: {
          create: {
            kind: 'DAILY',
            outletId: input.outletId,
            createdById: user.id,
            // Typed in one language; shown as typed to everyone at the outlet.
            title: { [user.language.toLowerCase()]: input.title },
          },
        },
      },
    });
    return this.outletChecklists(user, input.outletId);
  }

  /** Changes the due time of any of the outlet's checklists, or the name of one the restaurant created. */
  async updateList(
    user: AuthUser,
    outletChecklistId: string,
    input: { title?: string | undefined; dueTime?: string | null | undefined },
  ): Promise<OutletChecklistDto[]> {
    const list = await this.requireList(user, outletChecklistId);
    if (input.title !== undefined) {
      if (list.template.outletId === null) {
        throw new ForbiddenException("ECCS's basic checklists cannot be renamed");
      }
      await this.db.checklistTemplate.update({
        where: { id: list.templateId },
        data: { title: { [user.language.toLowerCase()]: input.title } },
      });
    }
    if (input.dueTime !== undefined) {
      await this.db.outletChecklist.update({ where: { id: list.id }, data: { dueTime: input.dueTime } });
    }
    return this.outletChecklists(user, list.outletId);
  }

  /** Removes a checklist the restaurant created. Past records are kept. */
  async removeList(user: AuthUser, outletChecklistId: string): Promise<OutletChecklistDto[]> {
    const list = await this.requireList(user, outletChecklistId);
    if (list.template.outletId === null) {
      throw new ForbiddenException("ECCS's basic checklists cannot be removed");
    }
    await this.db.outletChecklist.update({ where: { id: list.id }, data: { isActive: false } });
    return this.outletChecklists(user, list.outletId);
  }

  private async requireList(user: AuthUser, outletChecklistId: string) {
    const list = await this.db.outletChecklist.findFirst({
      where: { id: outletChecklistId, isActive: true },
      include: { template: { select: { outletId: true } } },
    });
    if (!list) throw new NotFoundException('Checklist not found');
    await this.requireOutlet(user, 'update', list.outletId);
    return list;
  }

  async outletChecklists(user: AuthUser, outletId: string): Promise<OutletChecklistDto[]> {
    await this.requireOutlet(user, 'read', outletId);
    const lists = await this.db.outletChecklist.findMany({
      where: { outletId, isActive: true, template: { kind: 'DAILY', isActive: true } },
      include: { template: { include: { items: { orderBy: { position: 'asc' } } } } },
    });
    return lists.sort(byDueTime).map((list) => ({
      id: list.id,
      outletId: list.outletId,
      title: list.template.title as LocalizedText,
      dueTime: list.dueTime,
      isCustom: list.template.outletId !== null,
      items: itemsFor(list.template.items, outletId).map((item) => ({
        id: item.id,
        label: item.label as LocalizedText,
        isCustom: item.outletId !== null,
        photoRequired: item.photoRequired,
      })),
    }));
  }

  /**
   * Ready-made checks from the library that match what the person has typed
   * so far. Every word typed (or a word meaning the same, such as
   * "refrigerator" for "fridge") must appear somewhere in the check, its
   * checklist name, category or keywords. Checks already on this checklist
   * are left out, and the most relevant come first.
   */
  async suggestions(user: AuthUser, outletChecklistId: string, search: string): Promise<ChecklistSuggestionDto[]> {
    const list = await this.requireList(user, outletChecklistId);
    const terms = words(search).slice(0, 6);
    if (terms.length === 0) return [];

    const [candidates, existing] = await Promise.all([
      this.db.checklistLibraryItem.findMany({
        where: {
          isActive: true,
          AND: terms.map((term) => ({ OR: alternatives(term).map((word) => ({ searchText: { contains: word } })) })),
        },
        take: 120,
      }),
      this.db.checklistItem.findMany({
        where: { templateId: list.templateId, isActive: true, OR: [{ outletId: null }, { outletId: list.outletId }] },
        select: { libraryItemId: true, label: true },
      }),
    ]);

    const usedIds = new Set(existing.map((item) => item.libraryItemId).filter(Boolean));
    const usedTexts = new Set(existing.flatMap((item) => Object.values(item.label as LocalizedText)).map((t) => t.trim().toLowerCase()));

    const seen = new Set<string>();
    return candidates
      .map((entry) => {
        const text = (entry.text as LocalizedText).en ?? '';
        const lower = text.toLowerCase();
        const textWords = new Set(words(text));
        // A word found in the check itself counts for more than one found only
        // in its category or keywords. The exact word typed counts most, then
        // a word meaning the same, then a partial match.
        const termScore = (term: string) => {
          if (textWords.has(term)) return 4;
          const others = alternatives(term).slice(1);
          if (others.some((word) => textWords.has(word) || (word.includes(' ') && lower.includes(word)))) return 3;
          return lower.includes(term) ? 2 : 0;
        };
        const score =
          terms.reduce((total, term) => total + termScore(term), 0) +
          (entry.priority === 'HIGH' ? 1 : 0) +
          (entry.source === 'eccs' ? 0.5 : 0);
        return { entry, text, lower, score };
      })
      .filter(({ entry, lower }) => {
        // The library repeats some checks across checklists; show each wording once.
        if (usedIds.has(entry.id) || usedTexts.has(lower) || seen.has(lower)) return false;
        seen.add(lower);
        return true;
      })
      .sort((a, b) => b.score - a.score || a.text.length - b.text.length)
      .slice(0, MAX_SUGGESTIONS)
      .map(({ entry }) => ({
        id: entry.id,
        text: entry.text as LocalizedText,
        checklistName: entry.checklistName,
        category: entry.category,
        priority: entry.priority === 'HIGH' ? ('HIGH' as const) : ('MEDIUM' as const),
      }));
  }

  /**
   * The Owner or Manager adds a check to a checklist: one picked from the
   * library, or one typed for their own kitchen. Either way it needs a photo
   * like every other item.
   */
  async addItem(
    user: AuthUser,
    outletChecklistId: string,
    input: { label?: string | undefined; libraryItemId?: string | undefined; photoRequired: boolean },
  ): Promise<OutletChecklistDto[]> {
    const list = await this.requireList(user, outletChecklistId);

    let label: Prisma.InputJsonValue;
    if (input.libraryItemId) {
      const entry = await this.db.checklistLibraryItem.findFirst({ where: { id: input.libraryItemId, isActive: true } });
      if (!entry) throw new NotFoundException('That suggestion is no longer available');
      label = entry.text as Prisma.InputJsonValue;
    } else {
      // Typed in one language; shown as typed to everyone at the outlet.
      label = { [user.language.toLowerCase()]: input.label ?? '' };
    }

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
        label,
        libraryItemId: input.libraryItemId ?? null,
        type: 'YES_NO',
        photoRequired: input.photoRequired,
      },
    });
    return this.outletChecklists(user, list.outletId);
  }

  /** Switches one of the restaurant's own items between "photo needed" and "tick only". */
  async updateItem(user: AuthUser, itemId: string, input: { photoRequired: boolean }): Promise<OutletChecklistDto[]> {
    const item = await this.db.checklistItem.findFirst({ where: { id: itemId, isActive: true } });
    if (!item?.outletId) throw new NotFoundException('Only items your restaurant added can be changed');
    await this.requireOutlet(user, 'update', item.outletId);
    await this.db.checklistItem.update({ where: { id: itemId }, data: { photoRequired: input.photoRequired } });
    return this.outletChecklists(user, item.outletId);
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
        const takenBy = response.attachments[0]?.uploadedById ?? response.answeredById;
        if (takenBy) personIds.add(takenBy);
      }
    }
    const people = personIds.size
      ? await this.db.user.findMany({ where: { id: { in: [...personIds] } }, select: { id: true, name: true } })
      : [];
    const personName = new Map(people.map((person) => [person.id, person.name]));

    const now = indiaTime();
    return runs.map((run) => {
      const responses = new Map(run.responses.map((response) => [response.itemId, response]));
      const status = effectiveStatus(run, today);
      const dueTime = run.outletChecklist.dueTime;
      const open = status === 'PENDING' || status === 'IN_PROGRESS';
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
        isOverdue: open && dueTime !== null && fromDbDate(run.date) === today && now > dueTime,
        submittedAt: run.submittedAt?.toISOString() ?? null,
        submittedByName: run.submittedBy?.name ?? null,
        reviewedAt: run.reviewedAt?.toISOString() ?? null,
        reviewedByName: run.reviewedById ? (personName.get(run.reviewedById) ?? null) : null,
        items: items.map((item) => {
          const response = responses.get(item.id);
          const photo = response?.attachments[0];
          const answeredBy = photo?.uploadedById ?? response?.answeredById;
          return {
            id: item.id,
            label: item.label as LocalizedText,
            isCustom: item.outletId !== null,
            photoRequired: item.photoRequired,
            response: response
              ? {
                  passed: response.passed ?? true,
                  note: response.note,
                  capturedAt: response.capturedAt.toISOString(),
                  takenByName: answeredBy ? (personName.get(answeredBy) ?? null) : null,
                  photoPath: photo ? this.storage.signedPath(photo.id) : null,
                }
              : null,
          };
        }),
      };
    });
  }
}
