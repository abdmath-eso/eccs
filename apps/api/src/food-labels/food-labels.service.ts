import {
  BadRequestException,
  ConflictException,
  ForbiddenException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import type { Prisma } from '@eccs/db';
import {
  ALLERGENS,
  can,
  checkLabelTimes,
  FOOD_LABEL_RULES,
  groupLabels,
  indiaDay,
  LABEL_DOTS_PER_MM,
  LABEL_SIZES,
  labelGroup,
  labelsHtml,
  localize,
  useByFor,
  type Action,
  type Allergen,
  type FoodItemDto,
  type FoodItemRemovalDto,
  type FoodLabelBoardDto,
  type FoodLabelCountsDto,
  type FoodLabelDto,
  type FoodLabelPeopleDto,
  type LabelImageDto,
  type LabelPrintData,
  type LabelTimeProblem,
  type LocalizedText,
  type StorageType,
} from '@eccs/shared';
import type { AuthUser } from '../auth/auth.types.js';
import { PdfPrinterService } from '../pdf/pdf-printer.service.js';
import { PrismaService } from '../prisma/prisma.service.js';

const itemInclude = {
  _count: { select: { labels: true } },
  labels: { orderBy: { createdAt: 'desc' }, take: 1, select: { createdAt: true } },
} as const satisfies Prisma.FoodItemInclude;

type ItemRow = Prisma.FoodItemGetPayload<{ include: typeof itemInclude }>;
type LabelRow = Prisma.FoodLabelGetPayload<object>;

// What the person is told when a label's times break a rule (see checkLabelTimes in @eccs/shared).
const TIME_PROBLEMS: Record<LabelTimeProblem, string> = {
  PREPARED_IN_FUTURE: 'The prepared time cannot be in the future',
  PREPARED_TOO_OLD: `The prepared time cannot be more than ${FOOD_LABEL_RULES.maxBackdateHours} hours ago`,
  USE_BY_BEFORE_PREPARED: 'Use by must be after the prepared time',
  USE_BY_TOO_FAR: 'Use by is too far away',
  OVERRIDE_NOT_ALLOWED: 'Use by is later than this item keeps. Only a Manager or the Owner can allow that',
  OVERRIDE_NEEDS_REASON: 'Say why this is being kept longer than usual',
};

const allergensOf = (stored: string[]): Allergen[] => ALLERGENS.filter((allergen) => stored.includes(allergen));

/**
 * Food items (what a kitchen prepares and how long each keeps), the labels
 * made for them, and the list of what is in the fridge now. Everything
 * belongs to one outlet. Nothing here touches the hygiene score.
 */
@Injectable()
export class FoodLabelsService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly printer: PdfPrinterService,
  ) {}

  private get db() {
    return this.prisma.client;
  }

  // ───────────────────────── Items ─────────────────────────

  /**
   * The outlet's items: the ones a label was made for most recently first,
   * then the rest by name. Retired items are left out unless `all` is set.
   */
  async listItems(user: AuthUser, outletId: string, all: boolean): Promise<FoodItemDto[]> {
    await this.requireOutlet(user, 'read', outletId);
    const items = await this.db.foodItem.findMany({
      where: { outletId, ...(!all && { isActive: true }) },
      include: itemInclude,
    });
    return items
      .map((item) => this.toItemDto(item, user))
      .sort(
        (a, b) =>
          Number(b.isActive) - Number(a.isActive) ||
          (b.lastUsedAt ?? '').localeCompare(a.lastUsedAt ?? '') ||
          a.name.localeCompare(b.name),
      );
  }

  async createItem(
    user: AuthUser,
    input: {
      outletId: string;
      name: string;
      storage: StorageType;
      shelfLifeHours: number;
      allergens: Allergen[];
      note?: string | undefined;
      starterKey?: string | undefined;
    },
  ): Promise<FoodItemDto> {
    await this.requireOutlet(user, 'update', input.outletId);
    await this.refuseSameName(user, input.outletId, input.name, null);
    const item = await this.db.foodItem.create({
      data: {
        outletId: input.outletId,
        name: this.nameAsTyped(user, input.name),
        storage: input.storage,
        shelfLifeHours: input.shelfLifeHours,
        allergens: input.allergens,
        note: input.note ?? null,
        starterKey: input.starterKey ?? null,
      },
      include: itemInclude,
    });
    return this.toItemDto(item, user);
  }

  /**
   * Changes an item, retires it or brings it back. Labels already made keep
   * the name, storage and allergens they were printed with.
   */
  async updateItem(
    user: AuthUser,
    itemId: string,
    input: {
      name?: string | undefined;
      storage?: StorageType | undefined;
      shelfLifeHours?: number | undefined;
      allergens?: Allergen[] | undefined;
      note?: string | undefined;
      isActive?: boolean | undefined;
    },
  ): Promise<FoodItemDto> {
    const existing = await this.requireItem(user, 'update', itemId);
    const renamed = input.name !== undefined && input.name !== localize(existing.name as LocalizedText, user.contentLanguage);
    if (renamed || input.isActive === true) {
      const name = input.name ?? localize(existing.name as LocalizedText, user.contentLanguage);
      await this.refuseSameName(user, existing.outletId, name, itemId);
    }
    const item = await this.db.foodItem.update({
      where: { id: itemId },
      data: {
        // A new name replaces the old one in every language: the kitchen's own wording is the name.
        ...(renamed && { name: this.nameAsTyped(user, input.name!) }),
        ...(input.storage !== undefined && { storage: input.storage }),
        ...(input.shelfLifeHours !== undefined && { shelfLifeHours: input.shelfLifeHours }),
        ...(input.allergens !== undefined && { allergens: input.allergens }),
        ...(input.note !== undefined && { note: input.note || null }),
        ...(input.isActive !== undefined && { isActive: input.isActive }),
      },
      include: itemInclude,
    });
    return this.toItemDto(item, user);
  }

  /**
   * Removes an item from the list. Once a label has been made for it the item
   * is retired, never deleted, so those labels still say what they were for;
   * an item with no labels is simply deleted.
   */
  async removeItem(user: AuthUser, itemId: string): Promise<FoodItemRemovalDto> {
    const existing = await this.requireItem(user, 'update', itemId);
    if ((await this.db.foodLabel.count({ where: { foodItemId: itemId } })) === 0) {
      await this.db.foodItem.delete({ where: { id: itemId } });
      return { deleted: true, item: null };
    }
    const item = await this.db.foodItem.update({ where: { id: existing.id }, data: { isActive: false }, include: itemInclude });
    return { deleted: false, item: this.toItemDto(item, user) };
  }

  /**
   * Names to choose "prepared by" from: everyone with a login at the outlet
   * (and the restaurant's Owner), then the outlet's staff list, which holds
   * the cooks who have no login. Names only.
   */
  async people(user: AuthUser, outletId: string): Promise<FoodLabelPeopleDto> {
    const outlet = await this.requireOutlet(user, 'create', outletId);
    const [logins, staff] = await Promise.all([
      this.db.user.findMany({
        where: {
          isActive: true,
          memberships: {
            some: {
              role: { in: ['OWNER', 'MANAGER', 'HEAD_CHEF'] },
              OR: [{ outletId }, { outletId: null, organizationId: outlet.organizationId }],
            },
          },
        },
        select: { name: true },
        orderBy: { name: 'asc' },
      }),
      this.db.staffMember.findMany({ where: { outletId, isActive: true }, select: { name: true }, orderBy: { name: 'asc' } }),
    ]);
    const seen = new Set<string>();
    const names = [...logins, ...staff]
      .map((person) => person.name.trim())
      .filter((name) => name && !seen.has(name.toLowerCase()) && seen.add(name.toLowerCase()));
    return { names };
  }

  // ───────────────────────── Labels ─────────────────────────

  /**
   * Makes a label. Left to itself, "prepared" is now and "use by" is prepared
   * plus the item's shelf life; both can be given, within the limits in
   * checkLabelTimes. A use-by later than the shelf life allows needs a
   * Manager or the Owner and a reason.
   */
  async createLabel(
    user: AuthUser,
    input: {
      foodItemId: string;
      preparedAt?: string | undefined;
      expiresAt?: string | undefined;
      preparedByName?: string | undefined;
      quantityNote?: string | undefined;
      copies: number;
      overrideReason?: string | undefined;
      clientId?: string | undefined;
      madeAt?: string | undefined;
    },
  ): Promise<FoodLabelDto> {
    const item = await this.requireItem(user, 'create', input.foodItemId);

    // A label made without signal may be sent more than once: the second time, answer with the first.
    if (input.clientId) {
      const sent = await this.db.foodLabel.findUnique({ where: { clientId: input.clientId } });
      if (sent && sent.outletId === item.outletId) return this.toLabelDto(sent);
    }
    if (!item.isActive) throw new ConflictException('This item has been retired. Choose another');

    const now = this.momentMade(input);
    const preparedAt = input.preparedAt ? new Date(input.preparedAt) : now;
    const expiresAt = input.expiresAt ? new Date(input.expiresAt) : useByFor(preparedAt, item.shelfLifeHours);
    const outlet = await this.db.outlet.findUniqueOrThrow({ where: { id: item.outletId }, select: { organizationId: true } });
    const check = checkLabelTimes({
      preparedAt,
      expiresAt,
      shelfLifeHours: item.shelfLifeHours,
      now,
      mayOverride: can(user.memberships, 'foodLabels', 'update', {
        organizationId: outlet.organizationId,
        outletId: item.outletId,
      }),
      overrideReason: input.overrideReason,
    });
    if (check.problem) {
      const body = { message: TIME_PROBLEMS[check.problem], code: check.problem };
      throw check.problem === 'OVERRIDE_NOT_ALLOWED' ? new ForbiddenException(body) : new BadRequestException(body);
    }

    const byAnother = input.preparedByName !== undefined && input.preparedByName !== user.name;
    try {
      const label = await this.db.foodLabel.create({
        data: {
          outletId: item.outletId,
          foodItemId: item.id,
          itemName: localize(item.name as LocalizedText, user.contentLanguage),
          storage: item.storage,
          allergens: item.allergens,
          preparedAt,
          expiresAt,
          preparedById: byAnother ? null : user.id,
          preparedByName: input.preparedByName ?? user.name,
          quantityNote: input.quantityNote ?? null,
          copies: input.copies,
          overrideReason: check.overridden ? input.overrideReason!.trim() : null,
          overrideById: check.overridden ? user.id : null,
          createdById: user.id,
          clientId: input.clientId ?? null,
        },
      });
      return this.toLabelDto(label);
    } catch (error) {
      // The same label arriving twice at the same moment: the database let only one in.
      const sent = input.clientId ? await this.db.foodLabel.findUnique({ where: { clientId: input.clientId } }) : null;
      if (sent) return this.toLabelDto(sent);
      throw error;
    }
  }

  /** Every live label at the outlet, as "expired", "use today" and "later", soonest first. */
  async board(user: AuthUser, outletId: string): Promise<FoodLabelBoardDto> {
    const outlet = await this.requireOutlet(user, 'read', outletId);
    const now = new Date();
    const rows = await this.db.foodLabel.findMany({ where: { outletId, status: 'LIVE' }, orderBy: { expiresAt: 'asc' } });
    const groups = groupLabels(await this.toLabelDtos(rows, now), now);
    return {
      outletId,
      outletName: outlet.name,
      now: now.toISOString(),
      expired: groups.EXPIRED,
      today: groups.TODAY,
      later: groups.LATER,
    };
  }

  async counts(user: AuthUser, outletId: string): Promise<FoodLabelCountsDto> {
    await this.requireOutlet(user, 'read', outletId);
    const now = new Date();
    // Midnight tonight in India: the end of "today" for the kitchen.
    const midnight = new Date(Date.parse(`${indiaDay(now)}T00:00:00+05:30`) + 86_400_000);
    const [today, expired] = await Promise.all([
      this.db.foodLabel.count({ where: { outletId, status: 'LIVE', expiresAt: { gt: now, lt: midnight } } }),
      this.db.foodLabel.count({ where: { outletId, status: 'LIVE', expiresAt: { lte: now } } }),
    ]);
    return { outletId, today, expired };
  }

  /** Marks the food used up, or thrown away with its reason. Either takes the label off the list. */
  async closeLabel(
    user: AuthUser,
    labelId: string,
    input: { outcome: 'USED' | 'DISCARDED'; reason?: 'EXPIRED' | 'SPOILED' | 'OTHER' | undefined; note?: string | undefined },
  ): Promise<FoodLabelDto> {
    await this.requireLabel(user, labelId);
    // Only a live label can be closed; two people tapping at once close it once.
    const changed = await this.db.foodLabel.updateMany({
      where: { id: labelId, status: 'LIVE' },
      data: {
        status: input.outcome,
        discardReason: input.outcome === 'DISCARDED' ? (input.reason ?? null) : null,
        closeNote: input.note ?? null,
        closedAt: new Date(),
        closedById: user.id,
      },
    });
    if (changed.count === 0) throw new ConflictException('This label was already marked');
    return this.toLabelDto(await this.db.foodLabel.findUniqueOrThrow({ where: { id: labelId } }));
  }

  /** Undoes a mistaken tap: puts a just-closed label back on the list. */
  async reopenLabel(user: AuthUser, labelId: string): Promise<FoodLabelDto> {
    const label = await this.requireLabel(user, labelId);
    if (label.status === 'LIVE') return this.toLabelDto(label);
    const since = label.closedAt ? Date.now() - label.closedAt.getTime() : Infinity;
    if (since > FOOD_LABEL_RULES.undoMinutes * 60_000) {
      throw new ConflictException('It is too late to put this label back. Make a new one');
    }
    const reopened = await this.db.foodLabel.update({
      where: { id: labelId },
      data: { status: 'LIVE', discardReason: null, closeNote: null, closedAt: null, closedById: null },
    });
    return this.toLabelDto(reopened);
  }

  async markPrinted(user: AuthUser, labelId: string): Promise<FoodLabelDto> {
    await this.requireLabel(user, labelId);
    return this.toLabelDto(await this.db.foodLabel.update({ where: { id: labelId }, data: { printedAt: new Date() } }));
  }

  /**
   * Draws one label as a black-and-white picture at a thermal printer's dots
   * (8 to the millimetre), using the same layout the app prints. The wording
   * comes from the app, already in the person's language; nothing is stored.
   */
  async render(input: { size: 'L50X30' | 'L50X25' | 'ROLL58'; label: LabelPrintData }): Promise<LabelImageDto> {
    const { widthMm, heightMm } = LABEL_SIZES[input.size];
    const widthPx = widthMm * LABEL_DOTS_PER_MM;
    const heightPx = heightMm * LABEL_DOTS_PER_MM;
    const png = await this.printer.image(labelsHtml([input.label], input.size), {
      width: widthPx,
      height: heightPx,
      // A web page measures a millimetre as 96/25.4 of its own units.
      cssWidth: (widthMm * 96) / 25.4,
    });
    return { pngBase64: png.toString('base64'), widthPx, heightPx };
  }

  // ───────────────────────── Helpers ─────────────────────────

  /**
   * The moment the label was made, which the limits are measured from. That
   * is now, except for a label made without signal and sent later: then it is
   * the phone's own time, unless the phone's clock is ahead of ours or the
   * label has waited too long to be believed.
   */
  private momentMade(input: { clientId?: string | undefined; madeAt?: string | undefined }): Date {
    const now = new Date();
    if (!input.clientId || !input.madeAt) return now;
    const made = new Date(input.madeAt);
    if (made.getTime() >= now.getTime()) return now;
    if (made.getTime() < now.getTime() - FOOD_LABEL_RULES.maxQueuedHours * 3_600_000) {
      throw new BadRequestException({ message: 'This label waited too long to be sent. Make it again', code: 'QUEUED_TOO_LONG' });
    }
    return made;
  }

  /** A name the kitchen typed is kept under the language the screen was in, and shown to everyone as typed. */
  private nameAsTyped(user: AuthUser, name: string): Prisma.InputJsonValue {
    return { [user.contentLanguage.toLowerCase()]: name };
  }

  /** Two items on the list with the same name would make the wrong one easy to pick. */
  private async refuseSameName(user: AuthUser, outletId: string, name: string, exceptId: string | null): Promise<void> {
    const others = await this.db.foodItem.findMany({
      where: { outletId, isActive: true, ...(exceptId && { id: { not: exceptId } }) },
      select: { name: true },
    });
    const wanted = name.trim().toLowerCase();
    if (others.some((other) => localize(other.name as LocalizedText, user.contentLanguage).trim().toLowerCase() === wanted)) {
      throw new ConflictException({ message: 'An item with this name is already on the list', code: 'ITEM_NAME_TAKEN' });
    }
  }

  /** Checks the user may do this at the outlet. "Not found" and "not yours" look the same when asked. */
  private async requireOutlet(user: AuthUser, action: Action, outletId: string, asNotFound = false) {
    const outlet = await this.db.outlet.findUnique({
      where: { id: outletId },
      select: { id: true, name: true, organizationId: true },
    });
    if (!outlet || !can(user.memberships, 'foodLabels', action, { organizationId: outlet.organizationId, outletId })) {
      throw asNotFound ? new NotFoundException('Not found') : new ForbiddenException('You cannot do this at this outlet');
    }
    return outlet;
  }

  private async requireItem(user: AuthUser, action: Action, itemId: string) {
    const item = await this.db.foodItem.findUnique({ where: { id: itemId } });
    if (!item) throw new NotFoundException('Item not found');
    await this.requireOutlet(user, action, item.outletId, true);
    return item;
  }

  private async requireLabel(user: AuthUser, labelId: string): Promise<LabelRow> {
    const label = await this.db.foodLabel.findUnique({ where: { id: labelId } });
    if (!label) throw new NotFoundException('Label not found');
    await this.requireOutlet(user, 'create', label.outletId, true);
    return label;
  }

  private toItemDto(item: ItemRow, user: AuthUser): FoodItemDto {
    return {
      id: item.id,
      outletId: item.outletId,
      name: localize(item.name as LocalizedText, user.contentLanguage),
      storage: item.storage,
      shelfLifeHours: item.shelfLifeHours,
      allergens: allergensOf(item.allergens),
      note: item.note,
      isActive: item.isActive,
      starterKey: item.starterKey,
      labelCount: item._count.labels,
      lastUsedAt: item.labels[0]?.createdAt.toISOString() ?? null,
    };
  }

  private async toLabelDto(label: LabelRow): Promise<FoodLabelDto> {
    return (await this.toLabelDtos([label], new Date()))[0]!;
  }

  private async toLabelDtos(labels: LabelRow[], now: Date): Promise<FoodLabelDto[]> {
    const ids = [...new Set(labels.flatMap((label) => [label.closedById, label.overrideById]).filter((id): id is string => !!id))];
    const people = ids.length ? await this.db.user.findMany({ where: { id: { in: ids } }, select: { id: true, name: true } }) : [];
    const nameOf = (id: string | null) => (id ? (people.find((person) => person.id === id)?.name ?? null) : null);

    return labels.map((label) => ({
      id: label.id,
      outletId: label.outletId,
      foodItemId: label.foodItemId,
      itemName: label.itemName,
      storage: label.storage,
      allergens: allergensOf(label.allergens),
      preparedAt: label.preparedAt.toISOString(),
      expiresAt: label.expiresAt.toISOString(),
      preparedByName: label.preparedByName,
      quantityNote: label.quantityNote,
      copies: label.copies,
      status: label.status,
      group: label.status === 'LIVE' ? labelGroup(label.expiresAt, now) : null,
      overrideReason: label.overrideReason,
      overrideByName: nameOf(label.overrideById),
      discardReason: label.discardReason,
      closeNote: label.closeNote,
      closedAt: label.closedAt?.toISOString() ?? null,
      closedByName: nameOf(label.closedById),
      printedAt: label.printedAt?.toISOString() ?? null,
      createdAt: label.createdAt.toISOString(),
    }));
  }
}
