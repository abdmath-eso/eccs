import { randomUUID } from 'node:crypto';
import { ConflictException, ForbiddenException, Injectable, NotFoundException } from '@nestjs/common';
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
} from '@eccs/shared';
import type { AuthUser } from '../auth/auth.types.js';
import { PrismaService } from '../prisma/prisma.service.js';

const sopInclude = { outlet: { select: { organizationId: true } } } as const satisfies Prisma.SopTemplateInclude;
type SopRow = Prisma.SopTemplateGetPayload<{ include: typeof sopInclude }>;

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
      if (!this.isEccs(user, 'read')) throw new ForbiddenException('Choose an outlet');
      where = { outletId: null, ...(!this.isEccs(user, 'update') && { isPublished: true }) };
    }
    const sops = await this.db.sopTemplate.findMany({ where, include: sopInclude, orderBy: { createdAt: 'asc' } });
    const order = (sop: SopDto) => SOP_CATEGORIES.indexOf(sop.category);
    return sops.map((sop) => this.toDto(user, sop)).sort((a, b) => order(a) - order(b));
  }

  async get(user: AuthUser, sopId: string): Promise<SopDto> {
    return this.toDto(user, await this.require(user, 'read', sopId));
  }

  async create(
    user: AuthUser,
    input: { outletId?: string | undefined; category: SopCategory; title: string; steps: string[]; language?: SopLanguage | undefined },
  ): Promise<SopDto> {
    if (input.outletId) await this.requireOutlet(user, 'create', input.outletId);
    else if (!this.isEccs(user, 'create')) throw new ForbiddenException('Choose the outlet this SOP is for');

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
        ...(input.title !== undefined && { title: { ...(sop.title as LocalizedText), [language]: input.title } }),
        ...(input.steps !== undefined && { body: { ...(sop.body as LocalizedText), [language]: input.steps.join('\n') } }),
        // Publishing is for standard SOPs only; a restaurant's own is always visible to it.
        ...(input.isPublished !== undefined && sop.outletId === null && { isPublished: input.isPublished }),
        ...(textChanged && { version: { increment: 1 } }),
      },
      include: sopInclude,
    });
    return this.toDto(user, updated);
  }

  async remove(user: AuthUser, sopId: string): Promise<void> {
    const sop = await this.require(user, 'update', sopId);
    const inUse = await this.db.checklistTemplate.count({ where: { sopTemplateId: sop.id } });
    if (inUse > 0) {
      throw new ConflictException('Checklists are based on this SOP, so it cannot be deleted. Unpublish it instead.');
    }
    await this.db.sopTemplate.delete({ where: { id: sop.id } });
  }

  // ───────────────────────── Helpers ─────────────────────────

  /** True if the user holds an ECCS role that allows the action on standard SOPs. */
  private isEccs(user: AuthUser, action: Action): boolean {
    return user.memberships.some((m) => isEccsRole(m.role) && roleCan(m.role, 'sopTemplates', action));
  }

  private languageOf(user: AuthUser): SopLanguage {
    const language = user.language.toLowerCase();
    return (SOP_LANGUAGES as readonly string[]).includes(language) ? (language as SopLanguage) : 'en';
  }

  private mayAtOutlet(user: AuthUser, action: Action, outletId: string, organizationId: string): boolean {
    return can(user.memberships, 'sopTemplates', action, { organizationId, outletId });
  }

  /** Checks the user may do this at the outlet. "Not found" and "not yours" look the same. */
  private async requireOutlet(user: AuthUser, action: Action, outletId: string) {
    const outlet = await this.db.outlet.findUnique({ where: { id: outletId }, select: { organizationId: true } });
    if (!outlet || !this.mayAtOutlet(user, action, outletId, outlet.organizationId)) {
      throw new ForbiddenException('You cannot do this at this outlet');
    }
  }

  private async require(user: AuthUser, action: Action, sopId: string): Promise<SopRow> {
    const sop = await this.db.sopTemplate.findUnique({ where: { id: sopId }, include: sopInclude });
    if (!sop) throw new NotFoundException('SOP not found');

    if (sop.outletId && sop.outlet) {
      // Someone outside the outlet is told it does not exist; someone inside who may only read is told so.
      if (!this.mayAtOutlet(user, 'read', sop.outletId, sop.outlet.organizationId)) throw new NotFoundException('SOP not found');
      if (!this.mayAtOutlet(user, action, sop.outletId, sop.outlet.organizationId)) {
        throw new ForbiddenException('Only the Owner or Manager can change this SOP');
      }
      return sop;
    }

    if (action === 'read') {
      if (sop.isPublished ? roleCanRead(user) : this.isEccs(user, 'update')) return sop;
      throw new NotFoundException('SOP not found');
    }
    if (!this.isEccs(user, action)) throw new ForbiddenException("ECCS's standard SOPs cannot be changed");
    return sop;
  }

  private toDto(user: AuthUser, sop: SopRow): SopDto {
    const body = sop.body as LocalizedText;
    const steps: SopDto['steps'] = {};
    for (const language of SOP_LANGUAGES) {
      const lines = body[language]?.split('\n').map((line) => line.trim()).filter(Boolean);
      if (lines && lines.length > 0) steps[language] = lines;
    }
    return {
      id: sop.id,
      category: (SOP_CATEGORIES as readonly string[]).includes(sop.category) ? (sop.category as SopCategory) : 'OTHER',
      title: sop.title as LocalizedText,
      steps,
      isCustom: sop.outletId !== null,
      outletId: sop.outletId,
      isPublished: sop.isPublished,
      canEdit:
        sop.outletId && sop.outlet
          ? this.mayAtOutlet(user, 'update', sop.outletId, sop.outlet.organizationId)
          : this.isEccs(user, 'update'),
      updatedAt: sop.updatedAt.toISOString(),
    };
  }
}

const roleCanRead = (user: AuthUser) => user.memberships.some((m) => roleCan(m.role, 'sopTemplates', 'read'));
