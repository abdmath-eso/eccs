import { randomBytes, randomUUID } from 'node:crypto';
import { BadRequestException, ConflictException, ForbiddenException, Injectable, Logger, NotFoundException, type OnModuleDestroy, type OnModuleInit } from '@nestjs/common';
import { Prisma } from '@eccs/db';
import {
  addDays,
  can,
  closeScore,
  doToday as planToday,
  doTodayFor,
  freeCheckCounts,
  freeCheckFindings,
  freeCheckPhotoIds,
  indiaDay,
  inPointOrder,
  SHOP_BOARD_MAX_BYTES,
  storedFreeCheck,
  type FreeCheckDto,
  type LoseValues,
  type ParkValues,
  type SalesPhotoDto,
  type ShopBoardReadingDto,
  isLinkPreviewAgent,
  moveForward,
  quoteMessage,
  quoteTotals,
  quoteWhatsappUrl,
  SALES_OWNER_ROLES,
  SALES_RULES,
  salesScope,
  staleness,
  STEP_STAGE,
  type DoTodayItemDto,
  type LeadActivityDto,
  type LeadActivityKind,
  type LeadDetailDto,
  type LeadListDto,
  type LeadListQuery,
  type LeadRowDto,
  type LeadStage,
  type LeadUpdateValues,
  type LeadValues,
  type LocalizedText,
  type PublicQuoteDto,
  type QuoteDto,
  type QuoteInput,
  type QuoteLine,
  type QuoteOptionDto,
  type QuoteSentDto,
  type Role,
  type SalesPersonDto,
  type StepValues,
  type TargetFigures,
  type TargetInput,
  type TargetFloorsInput,
  type LeadFacts,
  type BillingCycle,
} from '@eccs/shared';
import { noteActivity } from '../activity-log/activity-context.js';
import { ActivityLogService } from '../activity-log/activity-log.service.js';
import { aiUnavailable } from '../ai/ai.service.js';
import type { AuthUser } from '../auth/auth.types.js';
import { SUPPLIER } from '../billing/supplier.js';
import { indiaDate } from '../checklists/checklists.service.js';
import { env } from '../config/env.js';
import { PrismaService } from '../prisma/prisma.service.js';
import { sniffFile } from '../storage/attachments.controller.js';
import { StorageService } from '../storage/storage.service.js';
import { latestSent, quoteLines, SalesFactsService, type FactsContext, type LeadRow } from './sales-facts.service.js';
import { ShopBoardReaderService } from './shop-board-reader.service.js';

// Sales and the CRM (15 Oct 2026): ECCS's leads, the steps the BDEs log on them, quotes
// with a public link, the BDEs' weekly targets, and the app's own moves (First job and On
// a plan) for a lead linked to the client it became. The rules themselves (stages, Do
// today, stale, likely to close, targets) are in packages/shared/src/sales.ts.
//
// Who reaches what: the Super Admin and the Ops Manager every lead; a BDE only the leads
// they own (`salesScope`). A lead out of reach answers "not found", the same as a lead
// that does not exist, so a BDE cannot learn whose leads are whose. Linking a lead to a
// client needs the clients grant as well, which a BDE does not have.
//
// Sending a quote gives back a WhatsApp link with the message typed in: the BDE sends it
// from their own phone. The server sends nothing.

const FIRST_CHECK_AFTER_MS = 45_000;
const CHECK_EVERY_MS = 60 * 60_000;
const DAY_MS = 86_400_000;
/**
 * A lead's photo nothing points at after this long is removed by the nightly refresh: a
 * board photographed and read but never saved as a lead, or one replaced by a retake.
 * Long enough for work held on a phone without signal to be sent first.
 */
const UNUSED_PHOTO_DAYS = 14;

const english = (text: unknown) => {
  const localized = (text ?? {}) as LocalizedText;
  return localized.en ?? Object.values(localized)[0] ?? '';
};
const dateOnly = (date: Date | null) => (date ? date.toISOString().slice(0, 10) : null);
const toDb = (date: string) => new Date(`${date}T00:00:00.000Z`);
const iso = (date: Date | null) => date?.toISOString() ?? null;
const isUnique = (error: unknown) => (error as { code?: string }).code === 'P2002';

/** The public quote page's address: /q/<token> on the console's web server. */
export const quoteLink = (token: string) => `${(env.PUBLIC_PAGE_BASE_URL ?? env.WEB_URL ?? 'http://localhost:3000').replace(/\/+$/, '')}/q/${token}`;

type QuoteRow = LeadRow['quotes'][number];

@Injectable()
export class SalesService implements OnModuleInit, OnModuleDestroy {
  private readonly logger = new Logger(SalesService.name);
  private timers: NodeJS.Timeout[] = [];
  private lastRunDay: string | null = null;

  constructor(
    private readonly prisma: PrismaService,
    private readonly facts: SalesFactsService,
    private readonly activity: ActivityLogService,
    private readonly storage: StorageService,
    private readonly board: ShopBoardReaderService,
  ) {}

  private get db() {
    return this.prisma.client;
  }

  // ───────────────────────── The nightly refresh ─────────────────────────

  /**
   * Shortly after the server starts, and then once each India day (checked every hour):
   * moves linked leads on from the app's data and works every lead's "likely to close"
   * score out again ("quietly recomputed each night"). Off under tests.
   */
  onModuleInit() {
    if (env.NODE_ENV === 'test') return;
    const check = () => {
      const today = indiaDate();
      if (this.lastRunDay === today) return;
      this.lastRunDay = today;
      void this.refresh()
        .then((counts) => this.activity.jobRun('sales.leads.refreshed', counts, { quiet: true }))
        .catch((error) => {
          this.lastRunDay = null;
          this.activity.jobRun('sales.leads.refreshed', null, { error });
          this.logger.warn(`Could not refresh the sales leads: ${String(error)}`);
        });
    };
    const first = setTimeout(check, FIRST_CHECK_AFTER_MS);
    const repeat = setInterval(check, CHECK_EVERY_MS);
    first.unref();
    repeat.unref();
    this.timers = [first, repeat];
  }

  onModuleDestroy() {
    for (const timer of this.timers) clearTimeout(timer);
  }

  async refresh(): Promise<{ moved: number; scored: number; photosRemoved: number }> {
    const moved = await this.syncFromApp();
    const scored = await this.rescore();
    const photosRemoved = await this.dropUnusedPhotos();
    return { moved, scored, photosRemoved };
  }

  // ───────────────────────── Who reaches what ─────────────────────────

  /** "all" for the Super Admin and the Ops Manager, "own" for a BDE. */
  scope(user: AuthUser): 'all' | 'own' {
    const scope = salesScope(user.memberships);
    if (!scope) throw new ForbiddenException('Sales is for the founders, the Ops Manager and the BDEs');
    return scope.kind;
  }

  /** The leads a person reaches, as a database filter. */
  reach(user: AuthUser): Prisma.LeadWhereInput {
    return this.scope(user) === 'own' ? { ownerId: user.id } : {};
  }

  /** One lead the person reaches, or "not found". */
  private async reachable(user: AuthUser, id: string) {
    const lead = await this.db.lead.findUnique({ where: { id } });
    if (!lead || (this.scope(user) === 'own' && lead.ownerId !== user.id)) throw new NotFoundException('Lead not found');
    return lead;
  }

  /** The people who may own a lead: the BDEs, then the founders and the Ops Manager. */
  async people(): Promise<SalesPersonDto[]> {
    const users = await this.db.user.findMany({
      where: { isActive: true, memberships: { some: { role: { in: [...SALES_OWNER_ROLES] } } } },
      select: { id: true, name: true, memberships: { select: { role: true } } },
      orderBy: { name: 'asc' },
    });
    return users
      .map((user) => {
        const roles = user.memberships.map((m) => m.role as Role);
        const role = (SALES_OWNER_ROLES as readonly Role[]).find((entry) => roles.includes(entry)) ?? roles[0]!;
        return { id: user.id, name: user.name, role, isBde: roles.includes('BDE') };
      })
      .sort((a, b) => Number(b.isBde) - Number(a.isBde) || a.name.localeCompare(b.name));
  }

  /** Who the page can be narrowed to: every BDE, and anyone else who owns a lead. */
  async owners(): Promise<SalesPersonDto[]> {
    const [people, owning] = await Promise.all([this.people(), this.db.lead.groupBy({ by: ['ownerId'], _count: { _all: true } })]);
    const owners = new Set(owning.map((row) => row.ownerId));
    return people.filter((person) => person.isBde || owners.has(person.id));
  }

  private async checkOwner(ownerId: string) {
    const owner = await this.db.user.findFirst({ where: { id: ownerId, isActive: true, memberships: { some: { role: { in: [...SALES_OWNER_ROLES] } } } }, select: { id: true } });
    if (!owner) throw new BadRequestException('Choose a BDE, a founder or the Ops Manager to own the lead');
  }

  // ───────────────────────── Reading ─────────────────────────

  private quoteDto(quote: QuoteRow): QuoteDto {
    return {
      id: quote.id,
      number: quote.number,
      lines: quoteLines(quote.lines),
      subtotalPaise: quote.subtotalPaise,
      gstPaise: quote.gstPaise,
      totalPaise: quote.totalPaise,
      status: quote.status === 'SENT' ? 'SENT' : 'DRAFT',
      sentAt: iso(quote.sentAt),
      validUntil: dateOnly(quote.validUntil),
      openCount: quote.openCount,
      firstOpenedAt: iso(quote.firstOpenedAt),
      lastOpenedAt: iso(quote.lastOpenedAt),
      link: quoteLink(quote.token),
      isSample: quote.isSample,
    };
  }

  rowDto(row: LeadRow, facts: LeadFacts, now: Date): LeadRowDto {
    const sent = latestSent(row.quotes);
    return {
      id: row.id,
      businessName: row.businessName,
      area: row.area,
      stage: row.stage as LeadStage,
      status: row.status as LeadRowDto['status'],
      source: row.source as LeadRowDto['source'],
      kitchens: row.kitchens,
      ownerId: row.ownerId,
      ownerName: row.owner.name,
      contactName: row.contactName,
      contactPhone: row.contactPhone,
      createdAt: row.createdAt.toISOString(),
      lastActivityAt: row.lastActivityAt.toISOString(),
      nextAction: row.nextAction,
      nextActionAt: iso(row.nextActionAt),
      parkedUntil: dateOnly(row.parkedUntil),
      quote: sent && { totalPaise: sent.totalPaise, openCount: sent.openCount },
      stale: staleness(facts, now),
      organization: row.organization,
      isSample: row.isSample,
    };
  }

  /** A to-do for the page, with who owns the lead and the number to call. */
  toDoDto(row: LeadRow, facts: LeadFacts, now: Date): DoTodayItemDto | null {
    const item = doTodayFor(facts, now);
    return item && { ...item, ownerName: row.owner.name, contactPhone: row.contactPhone, isSample: row.isSample };
  }

  /** The leads a person reaches, with their facts, after moving linked ones on from the app. */
  async loaded(where: Prisma.LeadWhereInput, options: { take?: number } = {}): Promise<{ rows: LeadRow[]; context: FactsContext; facts: Map<string, LeadFacts> }> {
    await this.syncFromApp();
    const rows = await this.facts.rows(where, options);
    const context = await this.facts.context(rows);
    return { rows, context, facts: new Map(rows.map((row) => [row.id, this.facts.facts(row, context)])) };
  }

  /** The Leads list, newest activity first. */
  async list(user: AuthUser, query: LeadListQuery): Promise<LeadListDto> {
    const now = new Date();
    const and: Prisma.LeadWhereInput[] = [this.reach(user)];
    if (query.owner && this.scope(user) === 'all') and.push({ ownerId: query.owner });
    if (query.stage) and.push({ stage: query.stage });
    if (query.source) and.push({ source: query.source });
    const state = query.state ?? 'all';
    if (state === 'open') and.push({ status: 'OPEN' });
    if (state === 'parked') and.push({ status: 'PARKED' });
    if (state === 'lost') and.push({ status: 'LOST' });
    if (state === 'won') and.push({ stage: { in: ['FIRST_JOB', 'ON_PLAN'] }, status: { not: 'LOST' } });
    if (state === 'stale') and.push({ status: { not: 'LOST' } });
    if (query.q) {
      const words = query.q.split(/\s+/).filter(Boolean);
      for (const word of words) {
        and.push({
          OR: [
            { businessName: { contains: word, mode: 'insensitive' } },
            { area: { contains: word, mode: 'insensitive' } },
            { contactName: { contains: word, mode: 'insensitive' } },
            { contactPhone: { contains: word.replace(/\D/g, '') || word } },
            { referrerName: { contains: word, mode: 'insensitive' } },
          ],
        });
      }
    }
    const where: Prisma.LeadWhereInput = { AND: and };
    const stale = state === 'stale';
    const [{ rows, facts }, total, owners] = await Promise.all([
      this.loaded(where, stale ? {} : { take: SALES_RULES.maxListed }),
      this.db.lead.count({ where }),
      this.owners(),
    ]);
    let leads = rows.map((row) => this.rowDto(row, facts.get(row.id)!, now));
    if (stale) leads = leads.filter((lead) => lead.stale !== null);
    return { leads: leads.slice(0, SALES_RULES.maxListed), total: stale ? leads.length : total, owners: this.scope(user) === 'all' ? owners : owners.filter((owner) => owner.id === user.id) };
  }

  /** One lead with its timeline, quotes, score and today's to-do. */
  async detail(user: AuthUser, id: string): Promise<LeadDetailDto> {
    await this.reachable(user, id);
    const now = new Date();
    const { rows, facts } = await this.loaded({ id });
    const row = rows[0];
    if (!row) throw new NotFoundException('Lead not found');
    const lead = facts.get(id)!;
    const [activities, people] = await Promise.all([
      this.db.leadActivity.findMany({ where: { leadId: id }, orderBy: [{ at: 'desc' }, { createdAt: 'desc' }] }),
      this.scope(user) === 'all' ? this.people() : Promise.resolve([] as SalesPersonDto[]),
    ]);
    const byIds = [...new Set(activities.map((entry) => entry.byId).filter((value): value is string => !!value))];
    const names = new Map((await this.db.user.findMany({ where: { id: { in: byIds } }, select: { id: true, name: true } })).map((person) => [person.id, person.name]));
    const numbers = new Map(row.quotes.map((quote) => [quote.id, quote.number]));
    const score = closeScore(lead, now);
    return {
      ...this.rowDto(row, lead, now),
      photo: row.photoId ? this.photoDto(row.photoId) : null,
      address: row.address,
      referrerName: row.referrerName,
      latitude: row.latitude,
      longitude: row.longitude,
      checkAt: iso(row.checkAt),
      checkWith: row.checkWith,
      checkDoneAt: iso(row.checkDoneAt),
      checkFindings: row.checkFindings,
      parkedAt: iso(row.parkedAt),
      parkedReason: row.parkedReason,
      lostAt: iso(row.lostAt),
      lostReason: row.lostReason,
      wonAt: iso(row.wonAt),
      planAt: iso(row.planAt),
      activities: activities.map(
        (entry): LeadActivityDto => ({
          id: entry.id,
          kind: entry.kind as LeadActivityKind,
          at: entry.at.toISOString(),
          byName: entry.byId ? (names.get(entry.byId) ?? null) : null,
          note: entry.note,
          fromStage: (entry.fromStage as LeadStage | null) ?? null,
          toStage: (entry.toStage as LeadStage | null) ?? null,
          checkAt: iso(entry.checkAt),
          checkWith: entry.checkWith,
          findings: entry.findings,
          amountPaise: entry.amountPaise,
          signal: (entry.signal as LeadActivityDto['signal']) ?? null,
          rating: entry.rating,
          quoteNumber: entry.quoteId ? (numbers.get(entry.quoteId) ?? null) : null,
          scorecard: this.scorecardDto(entry.scorecard),
        }),
      ),
      quotes: row.quotes.map((quote) => this.quoteDto(quote)),
      close: score,
      toDo: this.toDoDto(row, lead, now),
      owners: people,
    };
  }

  /** A lead's photo with a link that works for an hour (image tags cannot send a login). */
  private photoDto(id: string): SalesPhotoDto {
    return { id, path: this.storage.signedPath(id) };
  }

  /** A free check's scorecard as the apps show it, each photo with its link; null for a step without one. */
  private scorecardDto(stored: unknown): FreeCheckDto | null {
    const card = storedFreeCheck(stored);
    if (!card) return null;
    return {
      answers: card.answers.map((entry) => ({ point: entry.point, answer: entry.answer, photo: entry.photoId ? this.photoDto(entry.photoId) : null })),
      counts: freeCheckCounts(card.answers),
    };
  }

  // ───────────────────────── Photos and the shop board (the BDE's phone, B2) ─────────────────────────

  /**
   * Files a photo for a lead before the lead or step it belongs to is saved: the shop
   * board when a lead is logged, or a free check's "Needs fixing". It belongs to no outlet
   * (a lead is not a client yet). The phone chooses its id, so sending the same photo
   * again from the outbox files it once.
   */
  async uploadPhoto(user: AuthUser, file: { buffer: Buffer; size: number } | undefined, fields: { id?: string | undefined; capturedAt?: string | undefined }): Promise<SalesPhotoDto> {
    this.scope(user);
    if (!file) throw new BadRequestException('A photo is required');
    const image = sniffFile(file.buffer, false);
    if (!image) throw new BadRequestException('Only JPEG, PNG or WebP photos are accepted');
    if (file.size > SHOP_BOARD_MAX_BYTES) throw new BadRequestException('That photo is too large');
    const id = fields.id ?? randomUUID();
    const existing = await this.db.attachment.findUnique({ where: { id }, select: { kind: true, uploadedById: true } });
    if (existing) {
      // A retry of an upload that already arrived.
      if (existing.kind !== 'LEAD' || existing.uploadedById !== user.id) throw new ForbiddenException('That photo belongs to something else');
      return this.photoDto(id);
    }
    const now = new Date();
    const storageKey = `sales/leads/${now.getUTCFullYear()}/${String(now.getUTCMonth() + 1).padStart(2, '0')}/${id}.${image.extension}`;
    await this.storage.put(storageKey, file.buffer, image.mimeType);
    const taken = fields.capturedAt ? new Date(fields.capturedAt) : now;
    await this.db.attachment.create({
      data: { id, kind: 'LEAD', storageKey, mimeType: image.mimeType, sizeBytes: file.size, capturedAt: Number.isNaN(taken.getTime()) ? now : taken, uploadedById: user.id },
    });
    return this.photoDto(id);
  }

  /** Photos a person may put on a lead: lead photos they filed themselves (the Super Admin and Ops Manager any). */
  private async checkPhotos(user: AuthUser, ids: readonly string[]) {
    const wanted = [...new Set(ids)];
    if (wanted.length === 0) return;
    const found = await this.db.attachment.count({
      where: { id: { in: wanted }, kind: 'LEAD', outletId: null, ...(this.scope(user) === 'own' && { uploadedById: user.id }) },
    });
    if (found !== wanted.length) throw new BadRequestException('A photo was not found. Take it again.');
  }

  /**
   * Reads the shop board in a photo already filed (POST /sales/photos) into the Log a lead
   * form: the name, area, address and a mobile number painted on it. Nothing is saved.
   * When AI is off, over its limit or fails, the answer is 503 with the code, and the BDE
   * types the form.
   */
  async readBoard(user: AuthUser, photoId: string): Promise<ShopBoardReadingDto> {
    this.scope(user);
    const photo = await this.db.attachment.findFirst({
      where: { id: photoId, kind: 'LEAD', outletId: null, ...(this.scope(user) === 'own' && { uploadedById: user.id }) },
      select: { storageKey: true, mimeType: true },
    });
    if (!photo) throw new NotFoundException('That photo was not found. Take it again.');
    const result = await this.board.read({ data: await this.storage.getBuffer(photo.storageKey), mimeType: photo.mimeType }, user.id);
    if (!result.ok) {
      noteActivity({ details: { read: false, code: result.code } });
      throw aiUnavailable(result.code, 'The board could not be read');
    }
    const { reading } = result;
    noteActivity({ details: { read: true, name: Boolean(reading.businessName), area: Boolean(reading.area), address: Boolean(reading.address), mobile: Boolean(reading.phone) } });
    return reading;
  }

  /**
   * Removes lead photos nothing points at any more (see UNUSED_PHOTO_DAYS): neither a
   * lead's shop board nor a free check's scorecard. A failure only warns.
   */
  async dropUnusedPhotos(): Promise<number> {
    const cutoff = new Date(Date.now() - UNUSED_PHOTO_DAYS * DAY_MS);
    const candidates = await this.db.attachment.findMany({
      where: { kind: 'LEAD', outletId: null, createdAt: { lt: cutoff }, leadPhotos: { none: {} } },
      select: { id: true, storageKey: true },
      take: 200,
    });
    if (candidates.length === 0) return 0;
    const cards = await this.db.leadActivity.findMany({ where: { scorecard: { not: Prisma.DbNull } }, select: { scorecard: true } });
    const used = new Set(cards.flatMap((card) => freeCheckPhotoIds(storedFreeCheck(card.scorecard)?.answers ?? [])));
    let removed = 0;
    for (const photo of candidates.filter((entry) => !used.has(entry.id))) {
      try {
        await this.db.attachment.delete({ where: { id: photo.id } });
        await this.storage.remove(photo.storageKey);
        removed += 1;
      } catch (error) {
        this.logger.warn(`Could not remove the unused lead photo ${photo.id}: ${String(error)}`);
      }
    }
    return removed;
  }

  /** Do today for these leads, in the rules' order, each with who owns it and the number to call. */
  toDoList(rows: readonly LeadRow[], facts: Map<string, LeadFacts>, now: Date): DoTodayItemDto[] {
    const byId = new Map(rows.map((row) => [row.id, row]));
    return planToday([...facts.values()], now).map((item) => {
      const row = byId.get(item.leadId)!;
      return { ...item, ownerName: row.owner.name, contactPhone: row.contactPhone, isSample: row.isSample };
    });
  }

  /** Today's to-dos for the leads a person reaches (the menu's number; the BDE's phone in B2). */
  async doToday(user: AuthUser): Promise<{ items: DoTodayItemDto[] }> {
    const { rows, facts } = await this.loaded({ ...this.reach(user), status: { not: 'LOST' } });
    return { items: this.toDoList(rows, facts, new Date()) };
  }

  /** What a quote can hold: the catalogue's services and the plans on offer, with their prices before GST. */
  async quoteOptions(): Promise<QuoteOptionDto[]> {
    const [services, plans] = await Promise.all([
      this.db.serviceCatalogItem.findMany({ where: { isActive: true, serviceType: { isActive: true } }, orderBy: { pricePaise: 'asc' }, include: { serviceType: { select: { gstRatePercent: true, code: true } } } }),
      this.db.plan.findMany({ where: { isActive: true }, orderBy: { pricePaise: 'asc' } }),
    ]);
    return [
      ...plans.map((plan): QuoteOptionDto => ({ kind: 'PLAN', refId: plan.id, name: english(plan.name), unitPaise: plan.pricePaise, gstRatePercent: 18, cycle: plan.billingCycle as BillingCycle, serviceCode: null })),
      ...services.map(
        (item): QuoteOptionDto => ({
          kind: 'SERVICE',
          refId: item.id,
          name: english(item.name),
          unitPaise: item.pricePaise,
          gstRatePercent: item.serviceType.gstRatePercent,
          cycle: null,
          serviceCode: item.serviceType.code,
        }),
      ),
    ];
  }

  // ───────────────────────── Leads ─────────────────────────

  /** A new lead. A BDE always owns what they add. Sending the same `id` twice adds one lead. */
  async create(user: AuthUser, input: LeadValues): Promise<LeadDetailDto> {
    if (input.id) {
      const existing = await this.db.lead.findUnique({ where: { id: input.id }, select: { id: true } });
      if (existing) return this.detail(user, existing.id);
    }
    const ownerId = this.scope(user) === 'own' ? user.id : (input.ownerId ?? user.id);
    await this.checkOwner(ownerId);
    if (input.photoId) await this.checkPhotos(user, [input.photoId]);
    // Logged on the phone at `at` (B2), perhaps without signal: it counts from then, never from ahead of now.
    const received = new Date();
    if (input.at && new Date(input.at).getTime() > received.getTime() + 5 * 60_000) throw new BadRequestException('A lead cannot be logged ahead of time');
    const now = input.at && new Date(input.at) < received ? new Date(input.at) : received;
    const lead = await this.db.lead.create({
      data: {
        ...(input.id && { id: input.id }),
        businessName: input.businessName,
        area: input.area,
        address: input.address,
        contactName: input.contactName,
        contactPhone: input.contactPhone,
        kitchens: input.kitchens,
        source: input.source,
        referrerName: input.referrerName,
        ownerId,
        createdById: user.id,
        nextAction: input.nextAction ?? (input.nextActionAt ? 'Next step' : null),
        nextActionAt: input.nextActionAt ? new Date(input.nextActionAt) : null,
        latitude: input.latitude ?? null,
        longitude: input.longitude ?? null,
        photoId: input.photoId ?? null,
        lastActivityAt: now,
        createdAt: now,
        activities: { create: { kind: 'CREATED', at: now, byId: user.id } },
      },
    });
    await this.keepFollowUp({ id: lead.id, ownerId, nextActionAt: null }, lead.nextActionAt, now);
    noteActivity({ details: { source: input.source, kitchens: input.kitchens, photo: Boolean(input.photoId) } });
    await this.rescore([lead.id]);
    return this.detail(user, lead.id);
  }

  /** A change to a lead's details or its next step. Only the Super Admin or Ops Manager hands a lead to someone else. */
  async update(user: AuthUser, id: string, input: LeadUpdateValues): Promise<LeadDetailDto> {
    const lead = await this.reachable(user, id);
    if (input.ownerId && input.ownerId !== lead.ownerId) {
      if (this.scope(user) !== 'all') throw new ForbiddenException('Only the Super Admin or the Ops Manager hands a lead to someone else');
      await this.checkOwner(input.ownerId);
    }
    const data: Prisma.LeadUncheckedUpdateInput = {};
    if (input.businessName !== undefined) data.businessName = input.businessName;
    if (input.area !== undefined) data.area = input.area;
    if (input.address !== undefined) data.address = input.address;
    if (input.contactName !== undefined) data.contactName = input.contactName;
    if (input.contactPhone !== undefined) data.contactPhone = input.contactPhone;
    if (input.kitchens !== undefined) data.kitchens = input.kitchens;
    if (input.source !== undefined) data.source = input.source;
    if (input.referrerName !== undefined) data.referrerName = input.referrerName;
    if (input.ownerId) data.ownerId = input.ownerId;
    if (input.latitude !== undefined) data.latitude = input.latitude;
    if (input.longitude !== undefined) data.longitude = input.longitude;
    if (input.photoId !== undefined) {
      if (input.photoId) await this.checkPhotos(user, [input.photoId]);
      data.photoId = input.photoId;
    }
    if (input.nextAction !== undefined || input.nextActionAt !== undefined) {
      const at = input.nextActionAt === undefined ? lead.nextActionAt : input.nextActionAt ? new Date(input.nextActionAt) : null;
      const text = input.nextAction === undefined ? lead.nextAction : input.nextAction;
      data.nextActionAt = at;
      data.nextAction = at ? (text ?? 'Next step') : text;
    }
    const source = (data.source as string | undefined) ?? lead.source;
    const referrer = data.referrerName === undefined ? lead.referrerName : data.referrerName;
    if (referrer && source !== 'CHEF_REFERRAL' && source !== 'PARTNER_REFERRAL') throw new BadRequestException('Only a referral has a referrer');
    await this.db.lead.update({ where: { id }, data });
    await this.keepFollowUp(lead, data.nextActionAt as Date | null | undefined, new Date());
    // A lead handed to someone else takes its next step with it.
    if (input.ownerId && input.ownerId !== lead.ownerId) await this.db.leadFollowUp.updateMany({ where: { leadId: id, endedAt: null }, data: { ownerId: input.ownerId } });
    noteActivity({ details: { changed: Object.keys(data) } });
    await this.rescore([id]);
    return this.detail(user, id);
  }

  /**
   * A step logged on a lead: it moves the lead right when the step calls for it, never
   * left; brings back a parked or lost lead; and clears a next step that was already due,
   * since this step was it. Sending the same step `id` twice logs it once.
   */
  async logStep(user: AuthUser, id: string, input: StepValues): Promise<LeadDetailDto> {
    if (input.id) {
      const existing = await this.db.leadActivity.findUnique({ where: { id: input.id }, select: { leadId: true } });
      if (existing) {
        if (existing.leadId !== id) throw new ConflictException('That step belongs to another lead');
        return this.detail(user, id);
      }
    }
    const lead = await this.reachable(user, id);
    const now = new Date();
    const at = input.at ? new Date(input.at) : now;
    if (at.getTime() > now.getTime() + 5 * 60_000) throw new BadRequestException('A step cannot be logged ahead of time');
    if (input.kind === 'CHECK_BOOKED' && input.checkAt && new Date(input.checkAt).getTime() < at.getTime() - DAY_MS) {
      throw new BadRequestException('Book the free check for today or later');
    }

    // A free check done with the phone's scorecard (B2): its photos must be the BDE's own,
    // and the number of things to fix is counted from it, which "Likely to close" reads.
    const scorecard = input.kind === 'CHECK_DONE' && input.scorecard ? { answers: inPointOrder(input.scorecard.answers) } : null;
    if (scorecard) await this.checkPhotos(user, freeCheckPhotoIds(scorecard.answers));
    const findings = scorecard ? freeCheckFindings(scorecard.answers) : (input.findings ?? 0);

    const stage = moveForward(lead.stage as LeadStage, STEP_STAGE[input.kind]);
    const data: Prisma.LeadUncheckedUpdateInput = { stage, lastActivityAt: at > lead.lastActivityAt ? at : lead.lastActivityAt };
    const reopen = lead.status !== 'OPEN';
    if (reopen) Object.assign(data, this.reopened());
    const next = this.nextStep(lead, input, at);
    Object.assign(data, next);
    if (input.kind === 'CHECK_BOOKED') Object.assign(data, { checkAt: new Date(input.checkAt!), checkWith: input.checkWith });
    if (input.kind === 'CHECK_DONE') Object.assign(data, { checkDoneAt: at, checkFindings: findings, checkAt: null, checkWith: null });

    await this.db.$transaction(async (tx) => {
      // A millisecond before the step, so the timeline reads "reopened" then the step.
      if (reopen) await tx.leadActivity.create({ data: { leadId: id, kind: 'REOPENED', at: new Date(at.getTime() - 1), byId: user.id } });
      await tx.leadActivity.create({
        data: {
          ...(input.id && { id: input.id }),
          leadId: id,
          kind: input.kind,
          at,
          byId: user.id,
          note: input.note,
          ...(stage !== lead.stage && { fromStage: lead.stage, toStage: stage }),
          checkAt: input.kind === 'CHECK_BOOKED' && input.checkAt ? new Date(input.checkAt) : null,
          checkWith: input.kind === 'CHECK_BOOKED' ? input.checkWith : null,
          findings: input.kind === 'CHECK_DONE' ? findings : null,
          signal: input.kind === 'ASKED' ? input.signal : null,
          ...(scorecard && { scorecard: scorecard as unknown as Prisma.InputJsonValue }),
        },
      });
      await tx.lead.update({ where: { id }, data });
    });
    await this.keepFollowUp(lead, 'nextActionAt' in next ? next.nextActionAt : undefined, at);
    noteActivity({ details: { stage, moved: stage !== lead.stage, reopened: reopen, ...(scorecard && { scorecard: true, findings }), late: input.at !== undefined && now.getTime() - at.getTime() > 5 * 60_000 } });
    await this.rescore([id]);
    return this.detail(user, id);
  }

  /** The next step after a step is logged: the one given with it, or none if the old one was already due. */
  private nextStep(lead: { nextAction: string | null; nextActionAt: Date | null }, input: { nextAction?: string | null; nextActionAt?: string | null }, at: Date) {
    if (input.nextActionAt || input.nextAction) {
      const when = input.nextActionAt ? new Date(input.nextActionAt) : null;
      return { nextAction: input.nextAction ?? 'Next step', nextActionAt: when };
    }
    if (lead.nextActionAt && lead.nextActionAt.getTime() <= Math.max(at.getTime(), Date.now())) return { nextAction: null, nextActionAt: null };
    if (!lead.nextActionAt && lead.nextAction) return { nextAction: null };
    return {};
  }

  /**
   * Keeps the history of a lead's next step (LeadFollowUp, 16 Oct 2026), which the Team
   * page's "follow-ups on time" reads: when a lead's next-step time changes (set, moved,
   * cleared by a step, a park or a loss), the one before ends at that moment and the new one
   * starts. `next` undefined means it did not change.
   */
  private async keepFollowUp(lead: { id: string; ownerId: string; nextActionAt: Date | null }, next: Date | null | undefined, at: Date) {
    if (next === undefined || (lead.nextActionAt?.getTime() ?? null) === (next?.getTime() ?? null)) return;
    await this.db.leadFollowUp.updateMany({ where: { leadId: lead.id, endedAt: null }, data: { endedAt: at } });
    if (next) await this.db.leadFollowUp.create({ data: { leadId: lead.id, ownerId: lead.ownerId, setAt: at, dueAt: next } });
  }

  /**
   * Hands every lead someone owns that is not lost to another owner in one go, with the same
   * rule as handing one lead over: the Super Admin or the Ops Manager does it, to a BDE, a
   * founder or the Ops Manager (the Team page's "Mark as left", 16 Oct 2026). Their next
   * steps go with them. Returns how many leads moved.
   */
  async handOver(user: AuthUser, fromId: string, toId: string): Promise<number> {
    if (this.scope(user) !== 'all') throw new ForbiddenException('Only the Super Admin or the Ops Manager hands a lead to someone else');
    if (fromId === toId) throw new BadRequestException('Choose someone else to take the leads over');
    await this.checkOwner(toId);
    const leads = await this.db.lead.findMany({ where: { ownerId: fromId, status: { not: 'LOST' } }, select: { id: true } });
    const ids = leads.map((lead) => lead.id);
    if (ids.length === 0) return 0;
    await this.db.$transaction([
      this.db.lead.updateMany({ where: { id: { in: ids } }, data: { ownerId: toId } }),
      this.db.leadFollowUp.updateMany({ where: { leadId: { in: ids }, endedAt: null }, data: { ownerId: toId } }),
    ]);
    return ids.length;
  }

  /** The fields that put a parked or lost lead back in the pipeline. */
  private reopened() {
    return { status: 'OPEN', parkedAt: null, parkedUntil: null, parkedReason: null, lostAt: null, lostReason: null };
  }

  /**
   * A park or a loss sent from the phone carries the phone's own `id` and `at` (B2). The
   * same `id` again is the outbox repeating itself after a lost answer: nothing more is
   * recorded. `at` is when it was done, never ahead of now.
   */
  private async replayed(user: AuthUser, id: string, input: { id?: string | undefined; at?: string | undefined }): Promise<{ done: LeadDetailDto | null; at: Date }> {
    if (input.id) {
      const existing = await this.db.leadActivity.findUnique({ where: { id: input.id }, select: { leadId: true } });
      if (existing) {
        if (existing.leadId !== id) throw new ConflictException('That step belongs to another lead');
        return { done: await this.detail(user, id), at: new Date() };
      }
    }
    const now = new Date();
    const at = input.at ? new Date(input.at) : now;
    if (at.getTime() > now.getTime() + 5 * 60_000) throw new BadRequestException('A step cannot be logged ahead of time');
    return { done: null, at: at > now ? now : at };
  }

  /** Parked until a date, with the reason in a few words ("after Diwali"). Park again moves the date. */
  async park(user: AuthUser, id: string, input: ParkValues): Promise<LeadDetailDto> {
    const { done, at } = await this.replayed(user, id, input);
    if (done) return done;
    const lead = await this.reachable(user, id);
    if (lead.status === 'LOST') throw new ConflictException('This lead is lost: reopen it first');
    // Judged on the day it was done, so a park made on the phone without signal still counts when it arrives.
    const today = indiaDay(at);
    if (input.until <= today) throw new BadRequestException('Park it until a day after today');
    if (input.until > addDays(today, SALES_RULES.parkMaxDays)) throw new BadRequestException('Park it for at most a year');
    await this.db.$transaction([
      this.db.leadActivity.create({ data: { ...(input.id && { id: input.id }), leadId: id, kind: 'PARKED', at, byId: user.id, note: input.reason } }),
      this.db.lead.update({
        where: { id },
        data: {
          status: 'PARKED',
          parkedAt: at,
          parkedUntil: toDb(input.until),
          parkedReason: input.reason,
          nextAction: null,
          nextActionAt: null,
          lastActivityAt: at > lead.lastActivityAt ? at : lead.lastActivityAt,
        },
      }),
    ]);
    await this.keepFollowUp(lead, null, at);
    noteActivity({ details: { again: lead.status === 'PARKED', days: Math.round((toDb(input.until).getTime() - toDb(today).getTime()) / DAY_MS) } });
    await this.rescore([id]);
    return this.detail(user, id);
  }

  /** Lost, with the reason. It keeps its stage and can be reopened. */
  async lose(user: AuthUser, id: string, input: LoseValues): Promise<LeadDetailDto> {
    const { done, at } = await this.replayed(user, id, input);
    if (done) return done;
    const lead = await this.reachable(user, id);
    if (lead.status === 'LOST') throw new ConflictException('This lead is already lost');
    await this.db.$transaction([
      this.db.leadActivity.create({ data: { ...(input.id && { id: input.id }), leadId: id, kind: 'LOST', at, byId: user.id, note: input.reason } }),
      this.db.lead.update({
        where: { id },
        data: { status: 'LOST', lostAt: at, lostReason: input.reason, nextAction: null, nextActionAt: null, lastActivityAt: at > lead.lastActivityAt ? at : lead.lastActivityAt },
      }),
    ]);
    await this.keepFollowUp(lead, null, at);
    noteActivity({ details: { stage: lead.stage } });
    await this.rescore([id]);
    return this.detail(user, id);
  }

  /** Back in the pipeline at the stage it had. */
  async reopen(user: AuthUser, id: string): Promise<LeadDetailDto> {
    const lead = await this.reachable(user, id);
    if (lead.status === 'OPEN') throw new ConflictException('This lead is already open');
    const now = new Date();
    await this.db.$transaction([
      this.db.leadActivity.create({ data: { leadId: id, kind: 'REOPENED', at: now, byId: user.id } }),
      this.db.lead.update({ where: { id }, data: { ...this.reopened(), lastActivityAt: now } }),
    ]);
    noteActivity({ details: { from: lead.status } });
    await this.rescore([id]);
    return this.detail(user, id);
  }

  /**
   * "Became a client": the client this lead turned into, so its first job and its plan are
   * read from the app from now on. Null undoes a wrong link. For the Super Admin and the
   * Ops Manager, who onboard clients; a BDE does not see clients' records.
   */
  async linkClient(user: AuthUser, id: string, organizationId: string | null): Promise<LeadDetailDto> {
    if (!can(user.memberships, 'clients', 'update')) throw new ForbiddenException('Linking a lead to a client is for the Super Admin and the Ops Manager');
    const lead = await this.reachable(user, id);
    const organization = organizationId ? await this.db.organization.findUnique({ where: { id: organizationId }, select: { id: true, name: true } }) : null;
    if (organizationId && !organization) throw new NotFoundException('Client not found');
    if (lead.organizationId === (organization?.id ?? null)) return this.detail(user, id);
    const now = new Date();
    await this.db.$transaction([
      this.db.leadActivity.create({ data: { leadId: id, kind: 'LINKED', at: now, byId: user.id, note: organization ? `Became a client: ${organization.name}` : 'Link to the client removed' } }),
      this.db.lead.update({ where: { id }, data: { organizationId: organization?.id ?? null, lastActivityAt: now } }),
    ]);
    noteActivity({ organizationId: organization?.id ?? lead.organizationId, details: { linked: Boolean(organization) } });
    await this.syncFromApp([id]);
    await this.rescore([id]);
    return this.detail(user, id);
  }

  // ───────────────────────── Quotes ─────────────────────────

  /** A quote for a lead, priced from today's catalogue and plans. It stays a draft until sent. */
  async addQuote(user: AuthUser, leadId: string, input: QuoteInput): Promise<QuoteDto> {
    await this.reachable(user, leadId);
    const ids = (kind: string) => input.lines.filter((line) => line.kind === kind).map((line) => line.refId);
    const [services, plans] = await Promise.all([
      this.db.serviceCatalogItem.findMany({ where: { id: { in: ids('SERVICE') }, isActive: true }, include: { serviceType: { select: { gstRatePercent: true } } } }),
      this.db.plan.findMany({ where: { id: { in: ids('PLAN') }, isActive: true } }),
    ]);
    const lines: QuoteLine[] = input.lines.map((line) => {
      if (line.kind === 'SERVICE') {
        const item = services.find((entry) => entry.id === line.refId);
        if (!item) throw new BadRequestException('A service on the quote is no longer offered');
        return { kind: 'SERVICE', refId: item.id, name: english(item.name), quantity: line.quantity, unitPaise: item.pricePaise, gstRatePercent: item.serviceType.gstRatePercent, cycle: null, amountPaise: item.pricePaise * line.quantity };
      }
      const plan = plans.find((entry) => entry.id === line.refId);
      if (!plan) throw new BadRequestException('A plan on the quote is no longer offered');
      return { kind: 'PLAN', refId: plan.id, name: english(plan.name), quantity: line.quantity, unitPaise: plan.pricePaise, gstRatePercent: 18, cycle: plan.billingCycle as BillingCycle, amountPaise: plan.pricePaise * line.quantity };
    });
    const totals = quoteTotals(lines);
    const year = indiaDate().slice(0, 4);
    const prefix = `Q-${year}-`;
    for (let attempt = 0; ; attempt += 1) {
      const last = await this.db.quote.findFirst({ where: { number: { startsWith: prefix } }, orderBy: { number: 'desc' }, select: { number: true } });
      const next = (last ? Number(last.number.slice(prefix.length)) || 0 : 0) + 1;
      try {
        const quote = await this.db.quote.create({
          data: {
            leadId,
            number: `${prefix}${String(next).padStart(4, '0')}`,
            lines: lines as unknown as Prisma.InputJsonValue,
            subtotalPaise: totals.subtotalPaise,
            gstPaise: totals.gstPaise,
            totalPaise: totals.totalPaise,
            // 24 random bytes: the link cannot be guessed.
            token: randomBytes(24).toString('base64url'),
            createdById: user.id,
          },
        });
        noteActivity({ details: { lines: lines.length, totalPaise: totals.totalPaise, plan: lines.some((line) => line.kind === 'PLAN') } });
        return this.quoteDto(quote);
      } catch (error) {
        // Two quotes made at the same moment took the same number: try the next one.
        if (!isUnique(error) || attempt >= 4) throw error;
      }
    }
  }

  private async reachableQuote(user: AuthUser, quoteId: string) {
    const quote = await this.db.quote.findUnique({ where: { id: quoteId }, include: { lead: true } });
    if (!quote || (this.scope(user) === 'own' && quote.lead.ownerId !== user.id)) throw new NotFoundException('Quote not found');
    return quote;
  }

  /**
   * "Send": the WhatsApp link with the message and the quote's link typed in, for the BDE to
   * send from their phone. The first send marks the quote sent and moves the lead to Quoted;
   * sending again only gives the link again. A sample lead's number is never put in the link.
   */
  async sendQuote(user: AuthUser, quoteId: string): Promise<QuoteSentDto> {
    const quote = await this.reachableQuote(user, quoteId);
    const lead = quote.lead;
    const now = new Date();
    const first = quote.status !== 'SENT';
    if (first) {
      const stage = moveForward(lead.stage as LeadStage, STEP_STAGE.QUOTE_SENT);
      const reopen = lead.status !== 'OPEN';
      const next = this.nextStep(lead, {}, now);
      await this.db.$transaction(async (tx) => {
        if (reopen) await tx.leadActivity.create({ data: { leadId: lead.id, kind: 'REOPENED', at: new Date(now.getTime() - 1), byId: user.id } });
        await tx.leadActivity.create({
          data: { leadId: lead.id, kind: 'QUOTE_SENT', at: now, byId: user.id, quoteId: quote.id, amountPaise: quote.totalPaise, ...(stage !== lead.stage && { fromStage: lead.stage, toStage: stage }) },
        });
        await tx.quote.update({ where: { id: quote.id }, data: { status: 'SENT', sentAt: now, validUntil: toDb(addDays(indiaDate(), SALES_RULES.quoteValidDays)) } });
        await tx.lead.update({
          where: { id: lead.id },
          data: { stage, lastActivityAt: now, ...(reopen && this.reopened()), ...next },
        });
      });
      await this.keepFollowUp(lead, 'nextActionAt' in next ? next.nextActionAt : undefined, now);
      await this.rescore([lead.id]);
    }
    const saved = await this.db.quote.findUniqueOrThrow({ where: { id: quote.id } });
    const sender = await this.db.user.findUnique({ where: { id: user.id }, select: { name: true } });
    const text = quoteMessage({
      contactName: lead.contactName,
      businessName: lead.businessName,
      senderName: sender?.name ?? 'ECCS',
      totalPaise: saved.totalPaise,
      link: quoteLink(saved.token),
      validUntil: dateOnly(saved.validUntil),
    });
    const phone = lead.isSample ? null : lead.contactPhone;
    noteActivity({ details: { first, hasPhone: Boolean(phone), totalPaise: saved.totalPaise } });
    return { quote: this.quoteDto(saved), whatsappUrl: quoteWhatsappUrl(phone, text), hasPhone: Boolean(phone) };
  }

  /** A quote not yet sent can be removed; a sent one stays as the record of what was offered. */
  async removeQuote(user: AuthUser, quoteId: string): Promise<void> {
    const quote = await this.reachableQuote(user, quoteId);
    if (quote.status === 'SENT') throw new ConflictException('A quote already sent stays on the lead');
    await this.db.quote.delete({ where: { id: quote.id } });
  }

  // ───────────────────────── The public quote page ─────────────────────────

  /** What the owner sees at the quote's link. Only a sent quote has a page. */
  async publicQuote(token: string): Promise<PublicQuoteDto | null> {
    const quote = await this.db.quote.findUnique({ where: { token }, include: { lead: { select: { businessName: true, contactName: true, area: true, owner: { select: { name: true } } } } } });
    if (!quote || quote.status !== 'SENT') return null;
    const lines = quoteLines(quote.lines);
    const totals = quoteTotals(lines);
    return {
      number: quote.number,
      businessName: quote.lead.businessName,
      contactName: quote.lead.contactName,
      area: quote.lead.area,
      sentOn: quote.sentAt ? indiaDay(quote.sentAt) : null,
      validUntil: dateOnly(quote.validUntil),
      lines: lines.map((line) => ({ name: line.name, quantity: line.quantity, unitPaise: line.unitPaise, amountPaise: line.amountPaise, cycle: line.cycle, gstRatePercent: line.gstRatePercent })),
      subtotalPaise: quote.subtotalPaise,
      cgstPaise: totals.cgstPaise,
      sgstPaise: totals.sgstPaise,
      totalPaise: quote.totalPaise,
      preparedBy: quote.lead.owner.name.split(/\s+/)[0] ?? quote.lead.owner.name,
      supplier: { name: SUPPLIER.name, legalName: SUPPLIER.legalName, address: SUPPLIER.address, gstin: SUPPLIER.gstin, phone: env.SUPPORT_PHONE, isSample: SUPPLIER.isSample },
    };
  }

  /**
   * The owner opened the quote: recorded on the lead as "quote opened", once in any 30
   * minutes at most, and never for a link-preview robot (WhatsApp fetches every link the
   * moment it is pasted).
   */
  async recordOpen(token: string, agent: string | null | undefined): Promise<{ recorded: boolean }> {
    const quote = await this.db.quote.findUnique({ where: { token }, select: { id: true, number: true, status: true, leadId: true, lead: { select: { organizationId: true } } } });
    if (!quote || quote.status !== 'SENT') throw new NotFoundException();
    noteActivity({ entity: { type: 'quote', id: quote.id, reference: quote.number }, organizationId: quote.lead.organizationId });
    if (isLinkPreviewAgent(agent)) {
      noteActivity({ details: { recorded: false, robot: true } });
      return { recorded: false };
    }
    const now = new Date();
    const cutoff = new Date(now.getTime() - SALES_RULES.openEveryMinutes * 60_000);
    // One statement decides, so two opens at the same moment cannot both count.
    const counted = await this.db.quote.updateMany({
      where: { id: quote.id, OR: [{ lastOpenedAt: null }, { lastOpenedAt: { lt: cutoff } }] },
      data: { openCount: { increment: 1 }, lastOpenedAt: now },
    });
    if (counted.count === 0) {
      noteActivity({ details: { recorded: false } });
      return { recorded: false };
    }
    await this.db.quote.updateMany({ where: { id: quote.id, firstOpenedAt: null }, data: { firstOpenedAt: now } });
    await this.db.leadActivity.create({ data: { leadId: quote.leadId, kind: 'QUOTE_OPENED', at: now, quoteId: quote.id } });
    noteActivity({ details: { recorded: true } });
    await this.rescore([quote.leadId]);
    return { recorded: true };
  }

  // ───────────────────────── Targets ─────────────────────────

  async floors(): Promise<TargetFigures> {
    const row = await this.db.salesSettings.findUnique({ where: { id: 'default' } });
    const floors = SALES_RULES.defaultFloors;
    return {
      leads: row?.floorLeads ?? floors.leads,
      checks: row?.floorChecks ?? floors.checks,
      firstJobs: row?.floorFirstJobs ?? floors.firstJobs,
      plans: row?.floorPlans ?? floors.plans,
    };
  }

  async setFloors(input: TargetFloorsInput): Promise<TargetFigures> {
    const data = { floorLeads: input.leads, floorChecks: input.checks, floorFirstJobs: input.firstJobs, floorPlans: input.plans };
    await this.db.salesSettings.upsert({ where: { id: 'default' }, create: { id: 'default', ...data }, update: data });
    return this.floors();
  }

  /** The Super Admin's own figures for one BDE's week; a figure set to null goes back to the suggestion. */
  async setTarget(user: AuthUser, userId: string, input: TargetInput): Promise<{ saved: boolean }> {
    const bde = await this.db.user.findFirst({ where: { id: userId, memberships: { some: { role: 'BDE' } } }, select: { id: true } });
    if (!bde) throw new NotFoundException('That person is not a BDE');
    const weekStart = toDb(input.weekStart);
    const existing = await this.db.salesTarget.findUnique({ where: { userId_weekStart: { userId, weekStart } } });
    const pick = (key: 'leads' | 'checks' | 'firstJobs' | 'plans') => (input[key] === undefined ? (existing?.[key] ?? null) : input[key]);
    const values = { leads: pick('leads'), checks: pick('checks'), firstJobs: pick('firstJobs'), plans: pick('plans') };
    if (Object.values(values).every((value) => value === null)) {
      if (existing) await this.db.salesTarget.delete({ where: { id: existing.id } });
      return { saved: false };
    }
    await this.db.salesTarget.upsert({
      where: { userId_weekStart: { userId, weekStart } },
      create: { userId, weekStart, ...values, setById: user.id },
      update: { ...values, setById: user.id },
    });
    noteActivity({ details: { ...values } as Record<string, unknown> });
    return { saved: true };
  }

  // ───────────────────────── The app's own moves ─────────────────────────

  /**
   * First job and On a plan, from the app itself, for leads linked to a client: the
   * client's first approved visit or paid one-off invoice on or after the day the lead was
   * logged makes it a First job; an active plan started on or after that day puts it On a
   * plan. Each is written on the lead's timeline once, with the sale's value before GST
   * and, for a visit, the restaurant's rating and whether it signed off the same day. A
   * lead never moves left, a lost lead is left alone, and a parked one comes back.
   * Returns how many leads moved.
   */
  async syncFromApp(leadIds?: string[]): Promise<number> {
    const leads = await this.db.lead.findMany({
      where: { organizationId: { not: null }, status: { not: 'LOST' }, OR: [{ wonAt: null }, { planAt: null }], ...(leadIds && { id: { in: leadIds } }) },
      select: { id: true, stage: true, status: true, createdAt: true, wonAt: true, planAt: true, organizationId: true, quotes: { select: { status: true, sentAt: true, lines: true, subtotalPaise: true } } },
    });
    if (leads.length === 0) return 0;
    const organizationIds = [...new Set(leads.map((lead) => lead.organizationId!))];
    const [jobs, payments, plans] = await Promise.all([
      this.db.job.findMany({
        where: { status: 'APPROVED', outlet: { organizationId: { in: organizationIds } } },
        select: {
          approvedAt: true,
          completedAt: true,
          scheduledDate: true,
          bookingId: true,
          outlet: { select: { organizationId: true } },
          signOff: { select: { rating: true, signedAt: true } },
          booking: { select: { catalogItem: { select: { pricePaise: true } }, invoices: { where: { status: { not: 'VOID' } }, select: { subtotalPaise: true } } } },
        },
      }),
      this.db.payment.findMany({
        where: { status: 'SUCCEEDED', paidAt: { not: null }, invoice: { organizationId: { in: organizationIds }, subscriptionId: null, status: { not: 'VOID' } } },
        select: { paidAt: true, invoice: { select: { organizationId: true, subtotalPaise: true } } },
      }),
      this.db.subscription.findMany({
        where: { status: 'ACTIVE', outlet: { organizationId: { in: organizationIds } } },
        select: { startDate: true, pricePaise: true, outlet: { select: { organizationId: true } }, plan: { select: { pricePaise: true } } },
      }),
    ]);

    const now = new Date();
    let moved = 0;
    for (const lead of leads) {
      const since = indiaDay(lead.createdAt);
      const quoted = lead.quotes.filter((quote) => quote.status === 'SENT' && !quoteLines(quote.lines).some((line) => line.kind === 'PLAN')).sort((a, b) => (b.sentAt?.getTime() ?? 0) - (a.sentAt?.getTime() ?? 0))[0];
      const visits = jobs
        .filter((job) => job.outlet.organizationId === lead.organizationId)
        .map((job) => {
          const at = job.approvedAt ?? job.completedAt ?? job.scheduledDate;
          const sameDay = Boolean(job.signOff && job.completedAt && indiaDay(job.signOff.signedAt) === indiaDay(job.completedAt));
          const value = job.booking?.invoices[0]?.subtotalPaise ?? job.booking?.catalogItem.pricePaise ?? quoted?.subtotalPaise ?? 0;
          return { at, value, rating: job.signOff?.rating ?? null, sameDay: sameDay as boolean | null };
        });
      const paid = payments
        .filter((payment) => payment.invoice.organizationId === lead.organizationId)
        .map((payment) => ({ at: payment.paidAt!, value: payment.invoice.subtotalPaise, rating: null, sameDay: null as boolean | null }));
      const first = [...visits, ...paid].filter((event) => indiaDay(event.at) >= since).sort((a, b) => a.at.getTime() - b.at.getTime())[0];
      const started = plans.filter((plan) => plan.outlet.organizationId === lead.organizationId && plan.startDate.toISOString().slice(0, 10) >= since);
      // A plan "starts" at ten in the morning of its first day, or now if that is still to come.
      const planStart = started.length > 0 ? new Date(Math.min(...started.map((plan) => new Date(`${plan.startDate.toISOString().slice(0, 10)}T10:00:00.000+05:30`).getTime()), now.getTime())) : null;

      let stage = lead.stage as LeadStage;
      const activities: Prisma.LeadActivityCreateManyInput[] = [];
      const data: Prisma.LeadUncheckedUpdateInput = {};
      if (!lead.wonAt && (first || planStart)) {
        if (first && (!planStart || first.at <= planStart)) {
          const next = moveForward(stage, 'FIRST_JOB');
          activities.push({ leadId: lead.id, kind: 'WON', at: first.at, amountPaise: first.value, rating: first.rating, sameDay: first.sameDay, ...(next !== stage && { fromStage: stage, toStage: next }) });
          stage = next;
          data.wonAt = first.at;
        } else data.wonAt = planStart;
      }
      if (!lead.planAt && planStart) {
        const next = moveForward(stage, 'ON_PLAN');
        const value = started.reduce((total, plan) => total + (plan.pricePaise ?? plan.plan.pricePaise), 0);
        activities.push({ leadId: lead.id, kind: 'WON', at: planStart, amountPaise: value, ...(next !== stage && { fromStage: stage, toStage: next }) });
        stage = next;
        data.planAt = planStart;
      }
      if (activities.length === 0 && data.wonAt === undefined) continue;
      data.stage = stage;
      if (lead.status === 'PARKED') Object.assign(data, this.reopened());
      await this.db.$transaction([this.db.leadActivity.createMany({ data: activities }), this.db.lead.update({ where: { id: lead.id }, data })]);
      moved += 1;
    }
    return moved;
  }

  /** Works out "likely to close" again and keeps it on the lead (every lead that is not lost, unless told which). */
  async rescore(leadIds?: string[]): Promise<number> {
    const rows = await this.facts.rows(leadIds ? { id: { in: leadIds } } : { status: { not: 'LOST' } });
    if (rows.length === 0) return 0;
    const context = await this.facts.context(rows);
    const now = new Date();
    const updates = rows.map((row) => {
      const score = closeScore(this.facts.facts(row, context), now);
      return this.db.lead.update({
        where: { id: row.id },
        data: {
          score: score?.score ?? 0,
          scoreSignals: score ? { kind: score.kind, signals: score.signals.map((signal) => ({ key: signal.key, points: signal.points, words: signal.words })) } : Prisma.DbNull,
          scoredAt: now,
        },
      });
    });
    // In batches, so a big refresh never holds one long transaction.
    for (let start = 0; start < updates.length; start += 100) await this.db.$transaction(updates.slice(start, start + 100));
    return rows.length;
  }
}
