import { randomUUID } from 'node:crypto';
import {
  ConflictException,
  ForbiddenException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import type { Prisma } from '@eccs/db';
import {
  can,
  isEccsRole,
  roleCan,
  SOP_CATEGORIES,
  SOP_LANGUAGES,
  type Action,
  type LocalizedText,
  type SopCategory,
  type SopDto,
  type SopLanguage,
  type SopLibraryItemDto,
  type SopLibraryOverviewDto,
} from '@eccs/shared';
import type { AuthUser } from '../auth/auth.types.js';
import { alternatives, words } from '../checklists/checklists.service.js';
import { PrismaService } from '../prisma/prisma.service.js';

const MAX_LIBRARY_RESULTS = 60;

const sopInclude = {
  outlet: { select: { organizationId: true } },
} as const satisfies Prisma.SopTemplateInclude;
type SopRow = Prisma.SopTemplateGetPayload<{ include: typeof sopInclude }>;
type LibraryRow = Prisma.SopLibraryItemGetPayload<object>;
type LibraryTranslations = Partial<
  Record<
    SopLanguage,
    { name: string; purpose: string; steps: string; controls: string | null }
  >
>;

// What was typed in Telugu or Hindi: whole words, since those scripts are not split like English.
const otherScriptWords = (text: string) =>
  text
    .toLowerCase()
    .split(/\s+/)
    .filter((word) => word.length > 1 && /[\u0080-￿]/.test(word));

const toCategory = (value: string): SopCategory =>
  (SOP_CATEGORIES as readonly string[]).includes(value)
    ? (value as SopCategory)
    : 'OTHER';

/**
 * The SOP library. A standard SOP (no outlet) is written by ECCS and read by
 * every restaurant once published. A restaurant's own SOP belongs to one
 * outlet and is written by its Owner or Manager.
 */
@Injectable()
export class SopsService {
  constructor(private readonly prisma: PrismaService) {}

  private get db() {
    return this.prisma.client;
  }

  /**
   * With an outlet: the published standard SOPs plus that outlet's own, as
   * its staff see them. Without: the standard SOPs, for ECCS in the console,
   * including unpublished drafts for those who can edit them.
   */
  async list(user: AuthUser, outletId: string | undefined): Promise<SopDto[]> {
    let where: Prisma.SopTemplateWhereInput;
    if (outletId) {
      await this.requireOutlet(user, 'read', outletId);
      where = { OR: [{ outletId: null, isPublished: true }, { outletId }] };
    } else {
      if (!this.isEccs(user, 'read'))
        throw new ForbiddenException('Choose an outlet');
      where = {
        outletId: null,
        ...(!this.isEccs(user, 'update') && { isPublished: true }),
      };
    }
    const sops = await this.db.sopTemplate.findMany({
      where,
      include: sopInclude,
      orderBy: { createdAt: 'asc' },
    });
    const order = (sop: SopDto) => SOP_CATEGORIES.indexOf(sop.category);
    return sops
      .map((sop) => this.toDto(user, sop))
      .sort((a, b) => order(a) - order(b));
  }

  async get(user: AuthUser, sopId: string): Promise<SopDto> {
    return this.toDto(user, await this.require(user, 'read', sopId));
  }

  async create(
    user: AuthUser,
    input: {
      outletId?: string | undefined;
      category: SopCategory;
      title: string;
      steps: string[];
      language?: SopLanguage | undefined;
    },
  ): Promise<SopDto> {
    if (input.outletId)
      await this.requireOutlet(user, 'create', input.outletId);
    else if (!this.isEccs(user, 'create'))
      throw new ForbiddenException('Choose the outlet this SOP is for');

    const language = input.language ?? this.languageOf(user);
    const sop = await this.db.sopTemplate.create({
      data: {
        code: `SOP-${randomUUID().slice(0, 8).toUpperCase()}`,
        category: input.category,
        title: { [language]: input.title },
        body: { [language]: input.steps.join('\n') },
        outletId: input.outletId ?? null,
        createdById: user.id,
        // A restaurant's own SOP is visible to its staff straight away; ECCS's start as drafts.
        isPublished: Boolean(input.outletId),
      },
      include: sopInclude,
    });
    return this.toDto(user, sop);
  }

  async update(
    user: AuthUser,
    sopId: string,
    input: {
      category?: SopCategory | undefined;
      title?: string | undefined;
      steps?: string[] | undefined;
      language?: SopLanguage | undefined;
      isPublished?: boolean | undefined;
    },
  ): Promise<SopDto> {
    const sop = await this.require(user, 'update', sopId);
    const language = input.language ?? this.languageOf(user);
    const textChanged = input.title !== undefined || input.steps !== undefined;

    const updated = await this.db.sopTemplate.update({
      where: { id: sop.id },
      data: {
        ...(input.category && { category: input.category }),
        ...(input.title !== undefined && {
          title: { ...(sop.title as LocalizedText), [language]: input.title },
        }),
        ...(input.steps !== undefined && {
          body: {
            ...(sop.body as LocalizedText),
            [language]: input.steps.join('\n'),
          },
        }),
        // Publishing is for standard SOPs only; a restaurant's own is always visible to it.
        ...(input.isPublished !== undefined &&
          sop.outletId === null && { isPublished: input.isPublished }),
        ...(textChanged && { version: { increment: 1 } }),
      },
      include: sopInclude,
    });
    return this.toDto(user, updated);
  }

  async remove(user: AuthUser, sopId: string): Promise<void> {
    const sop = await this.require(user, 'update', sopId);
    const inUse = await this.db.checklistTemplate.count({
      where: { sopTemplateId: sop.id },
    });
    if (inUse > 0) {
      throw new ConflictException(
        'Checklists are based on this SOP, so it cannot be deleted. Unpublish it instead.',
      );
    }
    await this.db.sopTemplate.delete({ where: { id: sop.id } });
  }

  // ───────────────────────── The library ─────────────────────────
  //
  // Several hundred ready-made SOPs. A restaurant never gets them all at
  // once: the Owner or Manager searches or browses, reads one, and copies
  // the ones they want into their own SOPs, where the wording is theirs to change.

  /** What the library holds: each category with the sections inside it, for browsing. */
  async libraryOverview(
    user: AuthUser,
    outletId: string,
  ): Promise<SopLibraryOverviewDto> {
    await this.requireOutlet(user, 'create', outletId);
    const groups = await this.db.sopLibraryItem.groupBy({
      by: ['category', 'section'],
      where: { isActive: true },
      _count: { _all: true },
      orderBy: { section: 'asc' },
    });
    const categories = SOP_CATEGORIES.map((category) => {
      const sections = groups
        .filter((group) => toCategory(group.category) === category)
        .map((group) => ({ name: group.section, count: group._count._all }));
      return {
        category,
        sections,
        count: sections.reduce((total, section) => total + section.count, 0),
      };
    }).filter((entry) => entry.count > 0);
    return {
      total: categories.reduce((total, entry) => total + entry.count, 0),
      categories,
    };
  }

  /**
   * Library SOPs matching what was typed, or those in a category or section.
   * Every word typed (or a word meaning the same, such as "refrigerated" for
   * "fridge") must appear in the SOP's name, section, area, role or keywords;
   * a match in the name itself comes first. Nothing asked for returns nothing.
   */
  async searchLibrary(
    user: AuthUser,
    filter: {
      outletId: string;
      search?: string | undefined;
      category?: string | undefined;
      section?: string | undefined;
    },
  ): Promise<SopLibraryItemDto[]> {
    await this.requireOutlet(user, 'create', filter.outletId);
    const terms = [
      ...words(filter.search ?? ''),
      ...otherScriptWords(filter.search ?? ''),
    ].slice(0, 6);
    const language = this.languageOf(user);
    if (terms.length === 0 && !filter.category && !filter.section) return [];

    const candidates = await this.db.sopLibraryItem.findMany({
      where: {
        isActive: true,
        ...(filter.category && { category: filter.category }),
        ...(filter.section && { section: filter.section }),
        AND: terms.map((term) => ({
          OR: alternatives(term).map((word) => ({
            searchText: { contains: word },
          })),
        })),
      },
      orderBy: { name: 'asc' },
      take: 400,
    });

    const scored = candidates.map((item) => {
      const translated =
        (item.translations as LibraryTranslations | null)?.[language]?.name ??
        '';
      const name = `${item.name} ${translated}`.toLowerCase();
      const nameWords = new Set(words(item.name));
      const score = terms.reduce(
        (total, term) =>
          total + (nameWords.has(term) ? 4 : name.includes(term) ? 2 : 0),
        0,
      );
      return { item, score };
    });
    const best = scored
      // How the restaurant is run comes before recipes when both match equally.
      .sort(
        (a, b) =>
          b.score - a.score ||
          a.item.kind.localeCompare(b.item.kind) ||
          a.item.name.length - b.item.name.length,
      )
      .slice(0, MAX_LIBRARY_RESULTS)
      .map(({ item }) => item);
    return this.toLibraryDtos(best, filter.outletId, language);
  }

  async libraryItem(
    user: AuthUser,
    outletId: string,
    itemId: string,
  ): Promise<SopLibraryItemDto> {
    await this.requireOutlet(user, 'create', outletId);
    const item = await this.db.sopLibraryItem.findFirst({
      where: { id: itemId, isActive: true },
    });
    if (!item)
      throw new NotFoundException('That SOP is no longer in the library');
    return (
      await this.toLibraryDtos([item], outletId, this.languageOf(user))
    )[0]!;
  }

  /**
   * Copies a library SOP into the outlet's own SOPs. From then on it is the
   * restaurant's to change. Adding the same one twice returns the copy it already has.
   */
  async addFromLibrary(
    user: AuthUser,
    outletId: string,
    itemId: string,
  ): Promise<SopDto> {
    await this.requireOutlet(user, 'create', outletId);
    const item = await this.db.sopLibraryItem.findFirst({
      where: { id: itemId, isActive: true },
    });
    if (!item)
      throw new NotFoundException('That SOP is no longer in the library');

    const existing = await this.db.sopTemplate.findFirst({
      where: { outletId, libraryItemId: item.id },
      include: sopInclude,
    });
    if (existing) return this.toDto(user, existing);
    const translations =
      (item.translations as LibraryTranslations | null) ?? {};

    const sop = await this.db.sopTemplate.create({
      data: {
        code: `SOP-${randomUUID().slice(0, 8).toUpperCase()}`,
        category: toCategory(item.category),
        // The copy carries every language the library has it in, so each person reads their own.
        title: {
          en: item.name,
          ...Object.fromEntries(
            Object.entries(translations).map(([code, text]) => [
              code,
              text.name,
            ]),
          ),
        },
        body: {
          en: item.steps,
          ...Object.fromEntries(
            Object.entries(translations).map(([code, text]) => [
              code,
              text.steps,
            ]),
          ),
        },
        outletId,
        createdById: user.id,
        libraryItemId: item.id,
        isPublished: true,
      },
      include: sopInclude,
    });
    return this.toDto(user, sop);
  }

  /** In the reader's language where the SOP has been translated, otherwise in English. */
  private async toLibraryDtos(
    items: LibraryRow[],
    outletId: string,
    language: SopLanguage,
  ): Promise<SopLibraryItemDto[]> {
    const copies = items.length
      ? await this.db.sopTemplate.findMany({
          where: {
            outletId,
            libraryItemId: { in: items.map((item) => item.id) },
          },
          select: { id: true, libraryItemId: true },
        })
      : [];
    const copyOf = new Map(copies.map((copy) => [copy.libraryItemId, copy.id]));
    return items.map((item) => {
      const text =
        (item.translations as LibraryTranslations | null)?.[language] ?? item;
      return {
        id: item.id,
        kind:
          item.kind === 'RECIPE' ? ('RECIPE' as const) : ('OPERATION' as const),
        name: text.name,
        category: toCategory(item.category),
        section: item.section,
        purpose: text.purpose,
        steps: text.steps.split('\n').filter(Boolean),
        controls: text.controls,
        role: item.role,
        area: item.area,
        frequency: item.frequency,
        addedSopId: copyOf.get(item.id) ?? null,
      };
    });
  }

  // ───────────────────────── Helpers ─────────────────────────

  /** True if the user holds an ECCS role that allows the action on standard SOPs. */
  private isEccs(user: AuthUser, action: Action): boolean {
    return user.memberships.some(
      (m) => isEccsRole(m.role) && roleCan(m.role, 'sopTemplates', action),
    );
  }

  private languageOf(user: AuthUser): SopLanguage {
    const language = user.language.toLowerCase();
    return (SOP_LANGUAGES as readonly string[]).includes(language)
      ? (language as SopLanguage)
      : 'en';
  }

  private mayAtOutlet(
    user: AuthUser,
    action: Action,
    outletId: string,
    organizationId: string,
  ): boolean {
    return can(user.memberships, 'sopTemplates', action, {
      organizationId,
      outletId,
    });
  }

  /** Checks the user may do this at the outlet. "Not found" and "not yours" look the same. */
  private async requireOutlet(
    user: AuthUser,
    action: Action,
    outletId: string,
  ) {
    const outlet = await this.db.outlet.findUnique({
      where: { id: outletId },
      select: { organizationId: true },
    });
    if (
      !outlet ||
      !this.mayAtOutlet(user, action, outletId, outlet.organizationId)
    ) {
      throw new ForbiddenException('You cannot do this at this outlet');
    }
  }

  private async require(
    user: AuthUser,
    action: Action,
    sopId: string,
  ): Promise<SopRow> {
    const sop = await this.db.sopTemplate.findUnique({
      where: { id: sopId },
      include: sopInclude,
    });
    if (!sop) throw new NotFoundException('SOP not found');

    if (sop.outletId && sop.outlet) {
      // Someone outside the outlet is told it does not exist; someone inside who may only read is told so.
      if (
        !this.mayAtOutlet(user, 'read', sop.outletId, sop.outlet.organizationId)
      )
        throw new NotFoundException('SOP not found');
      if (
        !this.mayAtOutlet(user, action, sop.outletId, sop.outlet.organizationId)
      ) {
        throw new ForbiddenException(
          'Only the Owner or Manager can change this SOP',
        );
      }
      return sop;
    }

    if (action === 'read') {
      if (sop.isPublished ? roleCanRead(user) : this.isEccs(user, 'update'))
        return sop;
      throw new NotFoundException('SOP not found');
    }
    if (!this.isEccs(user, action))
      throw new ForbiddenException("ECCS's standard SOPs cannot be changed");
    return sop;
  }

  private toDto(user: AuthUser, sop: SopRow): SopDto {
    const body = sop.body as LocalizedText;
    const steps: SopDto['steps'] = {};
    for (const language of SOP_LANGUAGES) {
      const lines = body[language]
        ?.split('\n')
        .map((line) => line.trim())
        .filter(Boolean);
      if (lines && lines.length > 0) steps[language] = lines;
    }
    return {
      id: sop.id,
      category: toCategory(sop.category),
      title: sop.title as LocalizedText,
      steps,
      isCustom: sop.outletId !== null,
      outletId: sop.outletId,
      isPublished: sop.isPublished,
      canEdit:
        sop.outletId && sop.outlet
          ? this.mayAtOutlet(
              user,
              'update',
              sop.outletId,
              sop.outlet.organizationId,
            )
          : this.isEccs(user, 'update'),
      updatedAt: sop.updatedAt.toISOString(),
    };
  }
}

const roleCanRead = (user: AuthUser) =>
  user.memberships.some((m) => roleCan(m.role, 'sopTemplates', 'read'));
