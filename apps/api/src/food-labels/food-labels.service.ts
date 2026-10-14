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
  LABEL_DOTS_PER_MM,
  LABEL_SIZES,
  labelsHtml,
  localize,
  looseLabelName,
  useByFor,
  type Action,
  type AiLanguage,
  type Allergen,
  type FoodItemDto,
  type FoodItemRemovalDto,
  type FoodLabelDto,
  type LabelImageDto,
  type LabelPrintData,
  type LabelTimeProblem,
  type LocalizedText,
  type StorageType,
} from '@eccs/shared';
import { ContentTranslatorService, localizedAt } from '../ai/content-translator.service.js';
import type { AuthUser } from '../auth/auth.types.js';
import { PdfPrinterService } from '../pdf/pdf-printer.service.js';
import { PrismaService } from '../prisma/prisma.service.js';

const itemInclude = {
  _count: { select: { labels: true } },
  labels: { orderBy: { createdAt: 'desc' }, take: 1, select: { createdAt: true } },
} as const satisfies Prisma.FoodItemInclude;

type ItemRow = Prisma.FoodItemGetPayload<{ include: typeof itemInclude }>;
type LabelRow = Prisma.FoodLabelGetPayload<object>;

// What the person is told when a label's "prepared" time breaks a rule (see checkLabelTimes in @eccs/shared).
const TIME_PROBLEMS: Record<LabelTimeProblem, string> = {
  PREPARED_IN_FUTURE: 'The prepared time cannot be in the future',
  PREPARED_TOO_OLD: `The prepared time cannot be more than ${FOOD_LABEL_RULES.maxBackdateHours} hours ago`,
};

const allergensOf = (stored: string[]): Allergen[] => ALLERGENS.filter((allergen) => stored.includes(allergen));

/**
 * Food items (the outlet's saved labels: a name and how long the food keeps)
 * and the record of each label printed from them. Everyone who prints labels
 * can save a new one; changing or removing a saved one is for the Owner and
 * the Manager. Everything belongs to one outlet. Nothing here touches the
 * hygiene score.
 */
@Injectable()
export class FoodLabelsService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly printer: PdfPrinterService,
    private readonly translator: ContentTranslatorService,
  ) {}

  private get db() {
    return this.prisma.client;
  }

  // ───────────────────────── Items ─────────────────────────

  /**
   * The outlet's items: the ones a label was made for most recently first,
   * then the rest by name (the app's list puts them in order of name itself).
   * Retired items are left out unless `all` is set.
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

  /**
   * Saves a new label for the outlet: a name and how long it keeps; where it
   * is stored, allergens and a note are optional. For everyone who makes
   * labels, the Head Chef included. A name the outlet already has (compared
   * loosely) is refused, and the answer says which saved label has it, so the
   * app can offer that one instead.
   */
  async createItem(
    user: AuthUser,
    input: {
      outletId: string;
      name: string;
      storage?: StorageType | null | undefined;
      shelfLifeHours: number;
      allergens: Allergen[];
      note?: string | undefined;
      starterKey?: string | undefined;
    },
  ): Promise<FoodItemDto> {
    await this.requireOutlet(user, 'create', input.outletId);
    await this.refuseSameName(user, input.outletId, input.name, null);
    const item = await this.db.foodItem.create({
      data: {
        outletId: input.outletId,
        name: this.nameAsTyped(user, input.name),
        storage: input.storage ?? null,
        shelfLifeHours: input.shelfLifeHours,
        allergens: input.allergens,
        note: input.note ?? null,
        starterKey: input.starterKey ?? null,
      },
      include: itemInclude,
    });
    this.translateNameLater(user, item.outletId, item.id, input.name);
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
      storage?: StorageType | null | undefined;
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
        // AI then fills in the other languages again, when it is on.
        ...(renamed && { name: this.nameAsTyped(user, input.name!), typedLanguage: null }),
        ...(input.storage !== undefined && { storage: input.storage }),
        ...(input.shelfLifeHours !== undefined && { shelfLifeHours: input.shelfLifeHours }),
        ...(input.allergens !== undefined && { allergens: input.allergens }),
        ...(input.note !== undefined && { note: input.note || null }),
        ...(input.isActive !== undefined && { isActive: input.isActive }),
      },
      include: itemInclude,
    });
    if (renamed) this.translateNameLater(user, item.outletId, item.id, input.name!);
    return this.toItemDto(item, user);
  }

  /**
   * Fills in the other languages of a label name the kitchen typed (AI, in the
   * background), so each cook reads it in their own. Skipped if it was renamed again meanwhile.
   */
  private translateNameLater(user: AuthUser, outletId: string, itemId: string, typed: string) {
    const typedIn = user.contentLanguage.toLowerCase() as AiLanguage;
    this.translator.later({
      strings: [typed],
      typedIn,
      user,
      outletId,
      save: async (filled) => {
        const current = await this.db.foodItem.findUnique({ where: { id: itemId }, select: { name: true } });
        if ((current?.name as LocalizedText | undefined)?.[typedIn] !== typed) return;
        await this.db.foodItem.update({ where: { id: itemId }, data: { name: localizedAt(filled, 0), typedLanguage: filled.source } });
      },
    });
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

  // ───────────────────────── Labels ─────────────────────────

  /**
   * Makes a label, from a saved one (`foodItemId`) or for something new
   * (`newItem`: a name and how long it keeps, which is saved for next time).
   *
   * "Prepared" is the moment Print was pressed on the phone, which the app
   * sends, and "use by" is always that moment plus how long the food keeps:
   * nobody chooses either, and a use-by sent by anything else is not looked
   * at. "Prepared by" is always the person signed in. The check on "prepared"
   * stays, so a phone with a wrong clock cannot date a label into the future.
   */
  async createLabel(
    user: AuthUser,
    input: {
      foodItemId?: string | undefined;
      newItem?: { outletId: string; name: string; shelfLifeHours: number } | undefined;
      preparedAt?: string | undefined;
      copies: number;
      clientId?: string | undefined;
      madeAt?: string | undefined;
    },
  ): Promise<FoodLabelDto> {
    const saved = input.foodItemId ? await this.requireItem(user, 'create', input.foodItemId) : null;
    if (!saved && !input.newItem) throw new BadRequestException('Choose a saved label, or give a new one a name');
    const outlet = await this.requireOutlet(user, 'create', saved?.outletId ?? input.newItem!.outletId, saved !== null);

    // A label made without signal may be sent more than once: the second time, answer with the first.
    if (input.clientId) {
      const sent = await this.db.foodLabel.findUnique({ where: { clientId: input.clientId } });
      if (sent && sent.outletId === outlet.id) return this.toLabelDto(sent);
    }
    if (saved && !saved.isActive) throw new ConflictException('This item has been retired. Choose another');

    // How long this label's food keeps: the saved label's length, or the one just chosen for a new label.
    const shelfLifeHours = saved?.shelfLifeHours ?? input.newItem!.shelfLifeHours;
    const now = this.momentMade(input);
    const preparedAt = input.preparedAt ? new Date(input.preparedAt) : now;
    const expiresAt = useByFor(preparedAt, shelfLifeHours);
    const problem = checkLabelTimes({ preparedAt, now });
    if (problem) throw new BadRequestException({ message: TIME_PROBLEMS[problem], code: problem });

    try {
      // The new saved label and its first label are made together or not at all,
      // so a label that fails (or arrives twice) never leaves a stray entry on the list.
      const { label, newItemId } = await this.db.$transaction(async (tx) => {
        let item = saved;
        // A label name saved here for the first time, to fill in its other languages afterwards.
        let created: string | null = null;
        if (!item) {
          // One at a time for each outlet, so two people typing the same new name at once get one saved label.
          await tx.$executeRaw`SELECT pg_advisory_xact_lock(hashtext(${outlet.id}))`;
          const wanted = looseLabelName(input.newItem!.name);
          const active = await tx.foodItem.findMany({ where: { outletId: outlet.id, isActive: true } });
          item = active.find((other) => looseLabelName(localize(other.name as LocalizedText, user.contentLanguage)) === wanted) ?? null;
          if (!item) {
            item = await tx.foodItem.create({
              data: {
                outletId: outlet.id,
                name: this.nameAsTyped(user, input.newItem!.name),
                shelfLifeHours: input.newItem!.shelfLifeHours,
              },
            });
            created = item.id;
          }
        }
        const made = await tx.foodLabel.create({
          data: {
            outletId: outlet.id,
            foodItemId: item.id,
            itemName: localize(item.name as LocalizedText, user.contentLanguage),
            storage: item.storage,
            allergens: item.allergens,
            preparedAt,
            expiresAt,
            preparedById: user.id,
            preparedByName: user.name,
            copies: input.copies,
            createdById: user.id,
            clientId: input.clientId ?? null,
          },
        });
        return { label: made, newItemId: created };
      });
      if (newItemId) this.translateNameLater(user, outlet.id, newItemId, input.newItem!.name);
      return this.toLabelDto(label);
    } catch (error) {
      // The same label arriving twice at the same moment: the database let only one in.
      const sent = input.clientId ? await this.db.foodLabel.findUnique({ where: { clientId: input.clientId } }) : null;
      if (sent) return this.toLabelDto(sent);
      throw error;
    }
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

  /**
   * Two saved labels with the same name would make the wrong one easy to pick.
   * Names are compared loosely (capitals and extra spaces do not count), and
   * the refusal names the one that already has it, so it can be offered.
   */
  private async refuseSameName(user: AuthUser, outletId: string, name: string, exceptId: string | null): Promise<void> {
    const others = await this.db.foodItem.findMany({
      where: { outletId, isActive: true, ...(exceptId && { id: { not: exceptId } }) },
      select: { id: true, name: true },
    });
    const wanted = looseLabelName(name);
    const same = others.find((other) => looseLabelName(localize(other.name as LocalizedText, user.contentLanguage)) === wanted);
    if (same) {
      throw new ConflictException({
        message: 'There is already a label with this name. Use that one',
        code: 'ITEM_NAME_TAKEN',
        existingId: same.id,
        existingName: localize(same.name as LocalizedText, user.contentLanguage),
      });
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

  private toLabelDto(label: LabelRow): FoodLabelDto {
    return {
      id: label.id,
      outletId: label.outletId,
      foodItemId: label.foodItemId,
      itemName: label.itemName,
      storage: label.storage,
      allergens: allergensOf(label.allergens),
      preparedAt: label.preparedAt.toISOString(),
      expiresAt: label.expiresAt.toISOString(),
      preparedByName: label.preparedByName,
      copies: label.copies,
      printedAt: label.printedAt?.toISOString() ?? null,
      createdAt: label.createdAt.toISOString(),
    };
  }
}
