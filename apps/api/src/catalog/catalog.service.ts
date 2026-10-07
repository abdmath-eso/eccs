import { BadRequestException, Injectable, NotFoundException } from '@nestjs/common';
import { Prisma } from '@eccs/db';
import type {
  CatalogAdminDto,
  CatalogAdminItemDto,
  CatalogItemChangeDto,
  LocalizedText,
  ServiceKindAdminDto,
} from '@eccs/shared';
import { PrismaService } from '../prisma/prisma.service.js';

const kindInclude = {
  checklistTemplate: {
    select: {
      items: {
        // ECCS's own tasks only, in the order the Supervisor sees them. Retired ones are included.
        where: { outletId: null },
        orderBy: [{ position: 'asc' }, { id: 'asc' }],
        select: { id: true, label: true, isActive: true, _count: { select: { jobTaskResponses: true } } },
      },
    },
  },
  planLines: { where: { plan: { isActive: true } }, select: { plan: { select: { name: true } } } },
  _count: { select: { jobs: true, certificates: true } },
} as const satisfies Prisma.ServiceTypeInclude;

const itemInclude = {
  serviceType: { select: { code: true } },
  _count: { select: { bookings: true } },
} as const satisfies Prisma.ServiceCatalogItemInclude;

type KindRow = Prisma.ServiceTypeGetPayload<{ include: typeof kindInclude }>;
type ItemRow = Prisma.ServiceCatalogItemGetPayload<{ include: typeof itemInclude }>;

/**
 * Names are kept in every language at once (`{ en, te, hi, … }`). The console
 * writes English only, so a change replaces the English and leaves the other
 * languages exactly as they were: they keep the old wording until someone
 * re-translates them, which the console says beside the box.
 */
function withEnglish(existing: unknown, english: string): Prisma.InputJsonObject {
  const kept = existing && typeof existing === 'object' && !Array.isArray(existing) ? (existing as Prisma.InputJsonObject) : {};
  return { ...kept, en: english };
}

const toPaise = (rupees: number) => Math.round(rupees * 100);

/**
 * The service catalogue as ECCS's office manages it: the services a restaurant
 * can book and their prices, the kinds of service, and each kind's task list.
 *
 * Nothing is deleted, because bookings and finished visits refer to these
 * rows. A service is stopped being offered, a task is retired, and a booked
 * service's price is never changed (see `updateItem`).
 */
@Injectable()
export class CatalogService {
  constructor(private readonly prisma: PrismaService) {}

  private get db() {
    return this.prisma.client;
  }

  /** Everything on the Catalogue page: every kind with its tasks, and every service, offered or not. */
  async overview(): Promise<CatalogAdminDto> {
    const [kinds, items] = await Promise.all([
      this.db.serviceType.findMany({ include: kindInclude, orderBy: { code: 'asc' } }),
      this.db.serviceCatalogItem.findMany({
        include: itemInclude,
        orderBy: [{ isActive: 'desc' }, { pricePaise: 'asc' }, { createdAt: 'asc' }],
      }),
    ]);
    return { kinds: kinds.map(toKindDto), items: items.map(toItemDto) };
  }

  // ───────────────────────── Bookable services ─────────────────────────

  async addItem(input: {
    serviceCode: string;
    name: string;
    description?: string | undefined;
    priceRupees: number;
    durationMinutes: number;
  }): Promise<CatalogAdminDto> {
    const kind = await this.requireKind(input.serviceCode);
    await this.db.serviceCatalogItem.create({
      data: {
        serviceTypeId: kind.id,
        name: { en: input.name },
        ...(input.description && { description: { en: input.description } }),
        pricePaise: toPaise(input.priceRupees),
        durationMinutes: input.durationMinutes,
      },
    });
    return this.overview();
  }

  /**
   * Changes a bookable service. The name, description, usual duration and
   * whether it is offered are changed where they are.
   *
   * The price, and the kind of service, are different: a booking does not
   * keep its own copy of the price, it reads it from the service it was made
   * for. So once a service has been booked, its price is never altered.
   * Instead the booked service is kept exactly as it was and stopped being
   * offered, and a new service with the new price takes its place. Every
   * earlier request and visit goes on showing what was agreed at the time.
   * (This is how payment systems treat prices: one that has been used is
   * archived and a new one made, never edited.)
   */
  async updateItem(
    itemId: string,
    input: {
      serviceCode?: string | undefined;
      name?: string | undefined;
      description?: string | undefined;
      priceRupees?: number | undefined;
      durationMinutes?: number | undefined;
      isActive?: boolean | undefined;
    },
  ): Promise<CatalogItemChangeDto> {
    const item = await this.db.serviceCatalogItem.findUnique({ where: { id: itemId }, include: itemInclude });
    if (!item) throw new NotFoundException('Service not found');

    const kind = input.serviceCode === undefined ? null : await this.requireKind(input.serviceCode);
    const pricePaise = input.priceRupees === undefined ? item.pricePaise : toPaise(input.priceRupees);
    const serviceTypeId = kind?.id ?? item.serviceTypeId;
    const termsChanged = pricePaise !== item.pricePaise || serviceTypeId !== item.serviceTypeId;

    const name = input.name === undefined ? (item.name as Prisma.InputJsonObject) : withEnglish(item.name, input.name);
    // An emptied description is removed in every language; there is nothing left for the others to describe.
    const description =
      input.description === undefined
        ? (item.description as Prisma.InputJsonObject | null)
        : input.description
          ? withEnglish(item.description, input.description)
          : null;
    const durationMinutes = input.durationMinutes ?? item.durationMinutes;
    const isActive = input.isActive ?? item.isActive;

    if (termsChanged && item._count.bookings > 0) {
      const [, replacement] = await this.db.$transaction([
        this.db.serviceCatalogItem.update({ where: { id: item.id }, data: { isActive: false } }),
        this.db.serviceCatalogItem.create({
          data: { serviceTypeId, name, ...(description && { description }), pricePaise, durationMinutes, isActive },
        }),
      ]);
      return { catalogue: await this.overview(), replacedById: replacement.id };
    }

    await this.db.serviceCatalogItem.update({
      where: { id: item.id },
      data: {
        serviceTypeId,
        name,
        // Prisma wants its own marker (DbNull), not `null`, to empty a JSON column.
        ...(input.description !== undefined && { description: description ?? Prisma.DbNull }),
        pricePaise,
        durationMinutes,
        isActive,
      },
    });
    return { catalogue: await this.overview(), replacedById: null };
  }

  // ───────────────────────── Kinds of service ─────────────────────────

  /**
   * Renames a kind of service or switches it off or on. While a kind is off,
   * its services are not offered, ECCS cannot add a visit of that kind, and
   * plans stop creating visits of it. Visits already in the diary stay.
   */
  async updateKind(
    code: string,
    input: {
      name?: string | undefined;
      isActive?: boolean | undefined;
      issuesCertificate?: boolean | undefined;
      certificateValidDays?: number | undefined;
    },
  ): Promise<CatalogAdminDto> {
    const kind = await this.requireKind(code);
    // A certificate must say how long it is valid for. Switching certificates off keeps the
    // number of days, so switching them back on later starts from what it was. Either change
    // applies to visits approved from now on; certificates already issued keep their dates.
    const issues = input.issuesCertificate ?? kind.issuesCertificate;
    const validDays = input.certificateValidDays ?? kind.certificateValidDays;
    if (issues && !validDays) throw new BadRequestException('Enter how many days the certificate is valid for');
    await this.db.serviceType.update({
      where: { id: kind.id },
      data: {
        ...(input.name !== undefined && { name: withEnglish(kind.name, input.name) }),
        ...(input.isActive !== undefined && { isActive: input.isActive }),
        ...(input.issuesCertificate !== undefined && { issuesCertificate: input.issuesCertificate }),
        ...(input.certificateValidDays !== undefined && { certificateValidDays: input.certificateValidDays }),
      },
    });
    return this.overview();
  }

  // ───────────────────────── Task lists ─────────────────────────

  /** Adds a task to the end of a kind's list. A kind with no list yet (the safety inspection) is given one. */
  async addTask(code: string, label: string): Promise<CatalogAdminDto> {
    const kind = await this.requireKind(code);
    await this.db.$transaction(async (tx) => {
      let templateId = kind.checklistTemplateId;
      if (!templateId) {
        const template = await tx.checklistTemplate.create({
          data: { kind: 'SERVICE', title: kind.name as Prisma.InputJsonObject },
        });
        await tx.serviceType.update({ where: { id: kind.id }, data: { checklistTemplateId: template.id } });
        templateId = template.id;
      }
      const last = await tx.checklistItem.aggregate({ where: { templateId }, _max: { position: true } });
      await tx.checklistItem.create({
        data: { templateId, position: (last._max.position ?? 0) + 1, label: { en: label } },
      });
    });
    return this.overview();
  }

  /**
   * Rewords a task, retires it or brings it back. A retired task is no longer
   * asked on new visits; visits that already answered it keep showing it
   * (see `visitTasks` in services.service.ts).
   */
  async updateTask(taskId: string, input: { label?: string | undefined; isActive?: boolean | undefined }): Promise<CatalogAdminDto> {
    const task = await this.requireTask(taskId);
    await this.db.checklistItem.update({
      where: { id: task.id },
      data: {
        ...(input.label !== undefined && { label: withEnglish(task.label, input.label) }),
        ...(input.isActive !== undefined && { isActive: input.isActive }),
      },
    });
    return this.overview();
  }

  /**
   * Moves a task one place up or down among the tasks in use. Retired tasks
   * are skipped over, and every task of the list is renumbered so the order
   * is unambiguous afterwards.
   */
  async moveTask(taskId: string, direction: 'up' | 'down'): Promise<CatalogAdminDto> {
    const task = await this.requireTask(taskId);
    if (!task.isActive) throw new BadRequestException('Bring the task back before moving it');

    const all = await this.db.checklistItem.findMany({
      where: { templateId: task.templateId, outletId: null },
      orderBy: [{ position: 'asc' }, { id: 'asc' }],
      select: { id: true, isActive: true },
    });
    const inUse = all.filter((entry) => entry.isActive);
    const from = inUse.findIndex((entry) => entry.id === task.id);
    const to = direction === 'up' ? from - 1 : from + 1;
    const neighbour = inUse[to];
    // Already first (or last): nothing to do, and no error for a second click that arrived late.
    if (!neighbour) return this.overview();

    const order = all.map((entry) => entry.id);
    const a = order.indexOf(task.id);
    const b = order.indexOf(neighbour.id);
    [order[a], order[b]] = [order[b]!, order[a]!];
    await this.db.$transaction(
      order.map((id, index) => this.db.checklistItem.update({ where: { id }, data: { position: index + 1 } })),
    );
    return this.overview();
  }

  // ───────────────────────── Helpers ─────────────────────────

  private async requireKind(code: string) {
    const kind = await this.db.serviceType.findUnique({ where: { code } });
    if (!kind) throw new NotFoundException('That kind of service was not found');
    return kind;
  }

  /** A task of a service's list. Checklist items of other kinds (daily checklists, inspections) are not reachable here. */
  private async requireTask(taskId: string) {
    const task = await this.db.checklistItem.findFirst({
      where: { id: taskId, outletId: null, template: { kind: 'SERVICE', serviceTypes: { some: {} } } },
    });
    if (!task) throw new NotFoundException('Task not found');
    return task;
  }
}

function toItemDto(item: ItemRow): CatalogAdminItemDto {
  return {
    id: item.id,
    serviceCode: item.serviceType.code,
    name: item.name as LocalizedText,
    description: (item.description as LocalizedText | null) ?? null,
    pricePaise: item.pricePaise,
    durationMinutes: item.durationMinutes,
    isActive: item.isActive,
    bookingCount: item._count.bookings,
    createdAt: item.createdAt.toISOString(),
  };
}

function toKindDto(kind: KindRow): ServiceKindAdminDto {
  return {
    code: kind.code,
    name: kind.name as LocalizedText,
    isActive: kind.isActive,
    tasks: (kind.checklistTemplate?.items ?? []).map((task) => ({
      id: task.id,
      label: task.label as LocalizedText,
      isActive: task.isActive,
      answerCount: task._count.jobTaskResponses,
    })),
    visitCount: kind._count.jobs,
    planNames: kind.planLines.map((line) => line.plan.name as LocalizedText),
    issuesCertificate: kind.issuesCertificate,
    certificateValidDays: kind.certificateValidDays,
    certificateCount: kind._count.certificates,
  };
}
