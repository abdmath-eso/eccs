import { randomBytes, randomUUID } from 'node:crypto';
import { BadRequestException, ConflictException, ForbiddenException, Injectable, NotFoundException } from '@nestjs/common';
import type { Prisma } from '@eccs/db';
import {
  accessScope,
  can,
  inspectionShownUntil,
  isLocalOnlyAddress,
  pickRecentServices,
  PUBLIC_PAGE_RULES,
  PUBLIC_PHOTO_CAPTIONS,
  publicInspectionState,
  publicPageState,
  publicPageUrl,
  selfCheckSummary,
  selfCheckWindow,
  type Action,
  type InspectionGrade,
  type LocalizedText,
  type PublicInspectionState,
  type PublicPageDto,
  type PublicPageSettingsDto,
  type PublicPageState,
  type PublicPhotoCaption,
  type PublicPhotoDto,
  type PublicPhotoStatus,
} from '@eccs/shared';
import type { AuthUser } from '../auth/auth.types.js';
import { ChecklistsService, indiaDate } from '../checklists/checklists.service.js';
import { env } from '../config/env.js';
import { PrismaService } from '../prisma/prisma.service.js';
import { sniffFile } from '../storage/attachments.controller.js';
import { PhotoIntegrityService, type PhotoFacts } from '../storage/photo-integrity.service.js';
import { StorageService } from '../storage/storage.service.js';
import { stripPhotoDetails } from './strip-photo-details.js';

const MAX_PHOTO_BYTES = 5 * 1024 * 1024;
const MAX_LISTED = 200;
/** No more than this many answers are remembered at once, so guessing at links cannot fill the memory. */
const MAX_REMEMBERED = 5000;
/** What a link's token looks like. Anything else is not looked up at all. */
const TOKEN_PATTERN = /^[A-Za-z0-9_-]{10,64}$/;
/** The kinds of service a diner is told about: cleaning and pest control, ECCS's own work. */
const SHOWN_CATEGORIES = ['CLEANING', 'PEST'];

const fromDbDate = (date: Date) => date.toISOString().slice(0, 10);

/**
 * The page reads checklists through the checklist service, so "which checklists were due
 * and which were missed" stays one rule. That service asks who is reading; the page has
 * no person, so it reads as ECCS. It is never used to change anything, and only two
 * numbers ever leave this service: days handed in, and days counted.
 */
const READER: AuthUser = {
  id: 'public-page',
  phone: null,
  name: 'Public page',
  language: 'EN',
  contentLanguage: 'EN',
  sessionId: 'public-page',
  memberships: [{ role: 'SUPER_ADMIN', organizationId: null, organizationName: null, outletId: null, outletName: null }],
};

const profileInclude = {
  outlet: {
    select: {
      id: true,
      name: true,
      city: true,
      isActive: true,
      fssaiNumber: true,
      organizationId: true,
      organization: { select: { name: true, isActive: true } },
    },
  },
} as const satisfies Prisma.PublicProfileInclude;
type ProfileRow = Prisma.PublicProfileGetPayload<{ include: typeof profileInclude }>;

const photoInclude = {
  attachment: { select: { id: true, capturedAt: true, createdAt: true } },
  profile: { select: { outletId: true, outlet: { select: { name: true, organizationId: true, organization: { select: { name: true } } } } } },
} as const satisfies Prisma.PublicPhotoInclude;
type PhotoRow = Prisma.PublicPhotoGetPayload<{ include: typeof photoInclude }>;

/** The photos a diner sees: approved by ECCS, not removed since, the most recently approved first. */
const shownPhotos = (profileId: string) =>
  ({
    where: { profileId, status: 'APPROVED', removedAt: null },
    orderBy: [{ decidedAt: 'desc' }, { createdAt: 'desc' }, { id: 'asc' }],
    take: PUBLIC_PAGE_RULES.maxPhotos,
  }) as const satisfies Prisma.PublicPhotoFindManyArgs;

/** A new link token: 128 random bits, so a link cannot be guessed or worked out from another. */
const newToken = () => randomBytes(16).toString('base64url');

/**
 * The customer QR page: what a diner sees, the restaurant's switch, ECCS's
 * take-down, and the photos proposed, approved and removed.
 *
 * The rules for whether there is anything to show are in
 * packages/shared/src/public-page.ts; this service reads the records.
 */
@Injectable()
export class PublicPageService {
  /** Answers already worked out, by token, so a busy table does not read the records for every scan. */
  private readonly remembered = new Map<string, { until: number; page: PublicPageDto | null }>();

  constructor(
    private readonly prisma: PrismaService,
    private readonly storage: StorageService,
    private readonly checklists: ChecklistsService,
    private readonly integrity: PhotoIntegrityService,
  ) {}

  private get db() {
    return this.prisma.client;
  }

  /** The address every QR code starts with. One setting: PUBLIC_PAGE_BASE_URL. */
  private get baseUrl() {
    return env.PUBLIC_PAGE_BASE_URL ?? env.WEB_URL ?? 'http://localhost:3000';
  }

  /** Forgets every remembered answer. Called after anything that changes a page. */
  forget() {
    this.remembered.clear();
  }

  // ───────────────────────── For the diner (no login) ─────────────────────────

  /**
   * What the page at this link shows, or null when there is nothing current to show.
   * Null covers every reason alike (unknown link, switched off, taken down, client
   * gone, inspection too old), and the caller must not tell them apart either.
   */
  async page(token: string): Promise<PublicPageDto | null> {
    if (!TOKEN_PATTERN.test(token)) return null;
    const now = Date.now();
    const known = this.remembered.get(token);
    if (known && known.until > now) return known.page;

    const profile = await this.db.publicProfile.findUnique({ where: { token }, include: profileInclude });
    const view = profile ? await this.view(profile) : null;
    const page = view?.state === 'LIVE' ? view.page : null;

    if (this.remembered.size >= MAX_REMEMBERED) this.remembered.clear();
    this.remembered.set(token, { until: now + PUBLIC_PAGE_RULES.cacheSeconds * 1000, page });
    return page;
  }

  /**
   * One of the page's photos, by its place on the page (1 is the first). Only the
   * photos the page itself lists can be fetched, and only while the page is showing:
   * the private photo store and its ids are never exposed.
   */
  async photo(token: string, place: number): Promise<{ body: Buffer; mimeType: string } | null> {
    const page = await this.page(token);
    if (!page || !Number.isInteger(place) || place < 1 || place > page.photos.length) return null;
    const profile = await this.db.publicProfile.findUnique({ where: { token }, select: { id: true } });
    if (!profile) return null;
    const photos = await this.db.publicPhoto.findMany({
      ...shownPhotos(profile.id),
      select: { attachment: { select: { storageKey: true, mimeType: true } } },
    });
    const attachment = photos[place - 1]?.attachment;
    if (!attachment || !attachment.mimeType.startsWith('image/')) return null;
    const file = await this.storage.getBuffer(attachment.storageKey);
    // Whatever the camera wrote into the file besides the picture (place, phone model, time) stays private.
    return { body: stripPhotoDetails(file, attachment.mimeType), mimeType: attachment.mimeType };
  }

  // ───────────────────────── Working out what is shown ─────────────────────────

  /**
   * Where an outlet's page stands, and what it shows or would show. `page` is filled
   * whenever the client is active and has a current inspection, even while the page is
   * off, so the Owner can see what turning it on would publish.
   */
  private async view(profile: ProfileRow): Promise<{
    state: PublicPageState;
    inspection: { state: PublicInspectionState; date: string | null; shownUntil: string | null };
    page: PublicPageDto | null;
  }> {
    const today = indiaDate();
    const outlet = profile.outlet;
    const clientActive = outlet.isActive && outlet.organization.isActive;

    // ECCS's latest approved inspection. Without a report number there is nothing a diner could check, so it does not count.
    const latest = await this.db.inspection.findFirst({
      where: { outletId: outlet.id, status: 'APPROVED', overallScore: { not: null }, grade: { not: null }, reportNumber: { not: null } },
      orderBy: [{ conductedAt: 'desc' }, { createdAt: 'desc' }],
      select: { conductedAt: true, overallScore: true, grade: true, reportNumber: true },
    });
    const inspectionDate = latest ? indiaDate(latest.conductedAt) : null;
    const inspectionState = publicInspectionState(inspectionDate, today);
    const state = publicPageState({
      clientActive,
      takenDown: profile.takenDownAt !== null,
      enabled: profile.isEnabled,
      inspectionDate,
      today,
    });
    const inspection = {
      state: inspectionState,
      date: inspectionDate,
      shownUntil: inspectionDate ? inspectionShownUntil(inspectionDate) : null,
    };
    if (!latest || !inspectionDate || inspectionState !== 'CURRENT' || !clientActive) return { state, inspection, page: null };

    const [selfChecks, services, photos, fssai] = await Promise.all([
      this.selfChecks(outlet.id, today),
      this.services(outlet.id, today),
      this.db.publicPhoto.findMany({
        ...shownPhotos(profile.id),
        select: { captionCode: true, attachment: { select: { capturedAt: true, createdAt: true } } },
      }),
      this.db.licence.findFirst({
        where: { outletId: outlet.id, type: 'FSSAI', number: { not: null } },
        orderBy: { expiresOn: 'desc' },
        select: { number: true },
      }),
    ]);

    return {
      state,
      inspection,
      page: {
        restaurantName: outlet.organization.name,
        outletName: outlet.name,
        city: outlet.city,
        inspection: {
          score: Math.round(latest.overallScore ?? 0),
          grade: latest.grade as InspectionGrade,
          date: inspectionDate,
          shownUntil: inspectionShownUntil(inspectionDate),
          reportNumber: latest.reportNumber ?? '',
        },
        selfChecks,
        services,
        photos: photos.map((photo, index) => ({
          n: index + 1,
          caption: toCaption(photo.captionCode),
          date: indiaDate(photo.attachment.capturedAt ?? photo.attachment.createdAt),
        })),
        fssaiNumber: fssai?.number?.trim() || outlet.fssaiNumber?.trim() || null,
        eccsPhone: env.SUPPORT_PHONE,
        updatedAt: new Date().toISOString(),
      },
    };
  }

  /** On how many of the last 30 days the kitchen handed in all of its own daily checklists. */
  private async selfChecks(outletId: string, today: string): Promise<PublicPageDto['selfChecks']> {
    const { from, to } = selfCheckWindow(today);
    const summaries = await this.checklists.between(READER, outletId, from, to);
    return selfCheckSummary(
      summaries.map((summary) => ({ date: summary.date, handedIn: summary.status === 'SUBMITTED' })),
      today,
    );
  }

  /**
   * The latest finished visit of each kind of cleaning and pest-control service whose
   * report ECCS has approved, with that visit's ECCS certificate if it is still valid.
   */
  private async services(outletId: string, today: string): Promise<PublicPageDto['services']> {
    const visits = await this.db.job.findMany({
      where: {
        outletId,
        status: 'APPROVED',
        reviewedAt: { not: null },
        serviceType: { partnerDelivered: false, category: { in: SHOWN_CATEGORIES } },
        scheduledDate: { gte: new Date(Date.now() - (PUBLIC_PAGE_RULES.serviceWithinDays + 31) * 86_400_000) },
      },
      orderBy: { scheduledDate: 'desc' },
      take: MAX_LISTED,
      select: {
        scheduledDate: true,
        checkInAt: true,
        serviceType: { select: { code: true, name: true } },
        certificates: { select: { number: true, validFrom: true, validUntil: true }, orderBy: { validUntil: 'desc' }, take: 1 },
      },
    });
    const done = visits.map((visit) => ({
      code: visit.serviceType.code,
      name: visit.serviceType.name as LocalizedText,
      // The day the work was done: the day in India the Supervisor checked in.
      date: visit.checkInAt ? indiaDate(visit.checkInAt) : fromDbDate(visit.scheduledDate),
      certificate: visit.certificates[0] ?? null,
    }));
    return pickRecentServices(done, today).map(({ certificate, ...service }) => {
      const valid = certificate !== null && fromDbDate(certificate.validFrom) <= today && fromDbDate(certificate.validUntil) >= today;
      return {
        ...service,
        certificateNumber: valid ? certificate.number : null,
        certificateValidUntil: valid ? fromDbDate(certificate.validUntil) : null,
      };
    });
  }

  // ───────────────────────── The restaurant's switch and ECCS's take-down ─────────────────────────

  /** The customer page of an outlet, for the app's screen and the console. Makes the page's record (off) the first time. */
  async settings(user: AuthUser, outletId: string): Promise<PublicPageSettingsDto> {
    const outlet = await this.requireOutlet(user, outletId, 'read');
    const profile = await this.ensureProfile(outlet.id);
    const view = await this.view(profile);
    const restaurant = this.isRestaurant(user);
    const target = { organizationId: outlet.organizationId, outletId: outlet.id };

    const [photos, photosWaiting] = await Promise.all([
      this.db.publicPhoto.findMany({
        where: { profileId: profile.id, status: 'APPROVED', removedAt: null },
        include: photoInclude,
        orderBy: shownPhotos(profile.id).orderBy,
        take: MAX_LISTED,
      }),
      this.db.publicPhoto.count({ where: { profileId: profile.id, status: 'PROPOSED' } }),
    ]);
    const url = publicPageUrl(this.baseUrl, profile.token);

    return {
      outletId: outlet.id,
      outletName: outlet.name,
      organizationName: outlet.organization.name,
      enabled: profile.isEnabled,
      takenDown: profile.takenDownAt !== null,
      takenDownReason: restaurant ? null : profile.takenDownReason,
      state: view.state,
      url,
      localOnly: isLocalOnlyAddress(url),
      linkChangedAt: profile.tokenChangedAt?.toISOString() ?? null,
      inspection: view.inspection,
      preview: view.page,
      photos: photos.map((photo, index) => this.toPhoto(photo, restaurant, index < PUBLIC_PAGE_RULES.maxPhotos)),
      photosWaiting,
      // The switch is the restaurant's own: publishing is its decision, so ECCS cannot turn a page on.
      canSwitch: restaurant && can(user.memberships, 'publicPage', 'update', target),
      canTakeDown: !restaurant && can(user.memberships, 'publicPage', 'approve', target),
    };
  }

  /** The Owner turns the page on or off. */
  async setEnabled(user: AuthUser, outletId: string, enabled: boolean): Promise<PublicPageSettingsDto> {
    const outlet = await this.requireOwner(user, outletId);
    const profile = await this.ensureProfile(outlet.id);
    if (enabled && profile.takenDownAt) {
      throw new ConflictException({ message: 'ECCS has taken this page down. Call ECCS to have it put back.', code: 'PAGE_TAKEN_DOWN' });
    }
    await this.db.publicProfile.update({ where: { id: profile.id }, data: { isEnabled: enabled } });
    this.forget();
    return this.settings(user, outletId);
  }

  /**
   * "Make a new link": the old link, and every QR code printed with it, stops
   * working at once and shows the same plain page as a link that never existed.
   */
  async newLink(user: AuthUser, outletId: string): Promise<PublicPageSettingsDto> {
    const outlet = await this.requireOwner(user, outletId);
    const profile = await this.ensureProfile(outlet.id);
    await this.db.publicProfile.update({ where: { id: profile.id }, data: { token: newToken(), tokenChangedAt: new Date() } });
    this.forget();
    return this.settings(user, outletId);
  }

  /** ECCS takes a page down (a client leaving, a complaint). The restaurant cannot override it. */
  async takeDown(user: AuthUser, outletId: string, reason: string): Promise<PublicPageSettingsDto> {
    const outlet = await this.requireOutlet(user, outletId, 'approve');
    const profile = await this.ensureProfile(outlet.id);
    await this.db.publicProfile.update({
      where: { id: profile.id },
      data: { takenDownAt: profile.takenDownAt ?? new Date(), takenDownById: user.id, takenDownReason: reason },
    });
    this.forget();
    return this.settings(user, outletId);
  }

  /** ECCS lifts its take-down. The page shows again only if the restaurant's own switch is on. */
  async restore(user: AuthUser, outletId: string): Promise<PublicPageSettingsDto> {
    const outlet = await this.requireOutlet(user, outletId, 'approve');
    const profile = await this.ensureProfile(outlet.id);
    await this.db.publicProfile.update({
      where: { id: profile.id },
      data: { takenDownAt: null, takenDownById: null, takenDownReason: null },
    });
    this.forget();
    return this.settings(user, outletId);
  }

  // ───────────────────────── Photos ─────────────────────────

  /**
   * A Supervisor proposes a photo already taken during one of their own finished
   * visits or inspections. Checklist photos are the restaurant's own and can never
   * be proposed. A photo is proposed once; ECCS's decision on it stands.
   */
  async propose(user: AuthUser, input: { attachmentId: string; caption: PublicPhotoCaption }): Promise<PublicPhotoDto> {
    const attachment = await this.db.attachment.findUnique({
      where: { id: input.attachmentId },
      select: {
        id: true,
        outletId: true,
        mimeType: true,
        job: { select: { supervisorId: true, status: true } },
        inspectionFinding: { select: { inspection: { select: { supervisorId: true, status: true } } } },
        publicPhotos: { select: { id: true }, take: 1 },
      },
    });
    const visit = attachment?.job;
    const inspection = attachment?.inspectionFinding?.inspection;
    const mine = (visit && visit.supervisorId === user.id) || (inspection && inspection.supervisorId === user.id);
    if (!attachment?.outletId || !mine) throw new NotFoundException('Photo not found');
    if (!attachment.mimeType.startsWith('image/')) throw new BadRequestException('Only a photo can be proposed');
    const finished = visit ? visit.status === 'COMPLETED' || visit.status === 'APPROVED' : inspection?.status !== 'DRAFT';
    if (!finished) throw new ConflictException('Finish the visit or inspection first');
    if (attachment.publicPhotos.length > 0) {
      throw new ConflictException({ message: 'This photo has already been proposed', code: 'PHOTO_ALREADY_PROPOSED' });
    }
    await this.requireOutlet(user, attachment.outletId, 'create');
    return this.createProposal(user, attachment.outletId, attachment.id, input.caption);
  }

  /** A Supervisor takes a photo specially for the page, at an outlet they have worked at. */
  async proposeNew(
    user: AuthUser,
    outletId: string,
    caption: PublicPhotoCaption,
    file: { buffer: Buffer; size: number },
    phone: { capturedAt?: string | undefined } = {},
    facts?: PhotoFacts,
  ): Promise<PublicPhotoDto> {
    const outlet = await this.requireOutlet(user, outletId, 'create');
    const image = sniffFile(file.buffer, false);
    if (!image) throw new BadRequestException('Only JPEG, PNG or WebP photos are accepted');
    if (file.size > MAX_PHOTO_BYTES) throw new BadRequestException('That photo is too large');

    const id = randomUUID();
    const now = new Date();
    const storageKey = `outlets/${outlet.id}/public-page/${id}.${image.extension}`;
    await this.storage.put(storageKey, file.buffer, image.mimeType);
    const said = phone.capturedAt ? new Date(phone.capturedAt) : null;
    await this.db.attachment.create({
      data: {
        id,
        outletId: outlet.id,
        kind: 'PROOF',
        storageKey,
        mimeType: image.mimeType,
        sizeBytes: file.size,
        capturedAt: said && !Number.isNaN(said.getTime()) && said <= now ? said : now,
        uploadedById: user.id,
        ...this.integrity.captureColumns({ buffer: file.buffer, mimeType: image.mimeType }, phone.capturedAt, now, facts),
      },
    });
    return this.createProposal(user, outlet.id, id, caption);
  }

  private async createProposal(user: AuthUser, outletId: string, attachmentId: string, caption: PublicPhotoCaption): Promise<PublicPhotoDto> {
    const profile = await this.ensureProfile(outletId);
    const created = await this.db.publicPhoto.create({
      data: { profileId: profile.id, attachmentId, captionCode: caption, proposedById: user.id },
      include: photoInclude,
    });
    return this.toPhoto(created, false, false);
  }

  /**
   * Photos, by who is asking: ECCS admins get the approval queue (the oldest first;
   * `status` chooses waiting, approved or rejected), a Supervisor gets what they
   * proposed themselves, and the restaurant gets its approved photos.
   */
  async listPhotos(
    user: AuthUser,
    filter: { status?: PublicPhotoStatus | undefined; outletId?: string | undefined },
  ): Promise<PublicPhotoDto[]> {
    const scope = accessScope(user.memberships, 'publicPage');
    if (!scope) return [];
    const restaurant = scope.kind === 'restaurant';

    let where: Prisma.PublicPhotoWhereInput;
    if (scope.kind === 'all') where = { status: filter.status ?? 'PROPOSED' };
    else if (scope.kind === 'assigned') where = { proposedById: user.id, ...(filter.status && { status: filter.status }) };
    else {
      where = {
        status: 'APPROVED',
        removedAt: null,
        profile: { outlet: { OR: [{ organizationId: { in: scope.organizationIds } }, { id: { in: scope.outletIds } }] } },
      };
    }
    const photos = await this.db.publicPhoto.findMany({
      where: { AND: [where, filter.outletId ? { profile: { outletId: filter.outletId } } : {}] },
      include: photoInclude,
      // The queue is worked through from the longest-waiting; everything else reads newest first.
      orderBy: scope.kind === 'all' && where.status === 'PROPOSED' ? { createdAt: 'asc' } : { createdAt: 'desc' },
      take: MAX_LISTED,
    });
    const shown = await this.shownIds(photos);
    const names = restaurant ? new Map<string, string>() : await this.names(photos.map((photo) => photo.proposedById));
    return photos.map((photo) => this.toPhoto(photo, restaurant, shown.has(photo.id), names.get(photo.proposedById ?? '') ?? null));
  }

  /** How many photos wait for ECCS's decision: the number beside the console's menu entry. */
  async waiting(): Promise<{ waiting: number }> {
    return { waiting: await this.db.publicPhoto.count({ where: { status: 'PROPOSED' } }) };
  }

  async approve(user: AuthUser, photoId: string): Promise<PublicPhotoDto> {
    return this.decide(user, photoId, { status: 'APPROVED', rejectReason: null });
  }

  async reject(user: AuthUser, photoId: string, reason: string): Promise<PublicPhotoDto> {
    return this.decide(user, photoId, { status: 'REJECTED', rejectReason: reason });
  }

  private async decide(
    user: AuthUser,
    photoId: string,
    decision: { status: 'APPROVED' | 'REJECTED'; rejectReason: string | null },
  ): Promise<PublicPhotoDto> {
    const photo = await this.db.publicPhoto.findUnique({ where: { id: photoId }, include: photoInclude });
    if (!photo) throw new NotFoundException('Photo not found');
    if (photo.status !== 'PROPOSED') throw new ConflictException('This photo has already been decided');
    const updated = await this.db.publicPhoto.update({
      where: { id: photo.id },
      data: { ...decision, approvedById: user.id, decidedAt: new Date() },
      include: photoInclude,
    });
    this.forget();
    const shown = await this.shownIds([updated]);
    const names = await this.names([updated.proposedById]);
    return this.toPhoto(updated, false, shown.has(updated.id), names.get(updated.proposedById ?? '') ?? null);
  }

  /**
   * Takes an approved photo off the page for good. The restaurant's Owner may do this
   * to any photo on their own page at any time, without giving a reason; so may ECCS.
   */
  async remove(user: AuthUser, photoId: string): Promise<void> {
    const photo = await this.db.publicPhoto.findUnique({ where: { id: photoId }, include: photoInclude });
    const target = photo && { organizationId: photo.profile.outlet.organizationId, outletId: photo.profile.outletId };
    // "Not found" and "not yours" look the same.
    if (!photo || !target || !can(user.memberships, 'publicPage', 'update', target)) throw new NotFoundException('Photo not found');
    if (photo.status !== 'APPROVED') throw new ConflictException('Only a photo that is on the page can be removed');
    if (!photo.removedAt) {
      await this.db.publicPhoto.update({ where: { id: photo.id }, data: { removedAt: new Date(), removedById: user.id } });
    }
    this.forget();
  }

  // ───────────────────────── Helpers ─────────────────────────

  private isRestaurant(user: AuthUser) {
    return accessScope(user.memberships, 'publicPage')?.kind === 'restaurant';
  }

  /**
   * The outlet, if the person may do this to its customer page: their own restaurant's
   * for the Owner, their own outlet's for the Manager (reading only), any for ECCS
   * admins, and for a Supervisor the outlets where they have a visit or an inspection.
   * "Not found" and "not yours" look the same.
   */
  private async requireOutlet(user: AuthUser, outletId: string, action: Action) {
    const outlet = await this.db.outlet.findUnique({
      where: { id: outletId },
      select: { id: true, name: true, organizationId: true, organization: { select: { name: true } } },
    });
    let allowed =
      outlet !== null && can(user.memberships, 'publicPage', action, { organizationId: outlet.organizationId, outletId });
    if (allowed && accessScope(user.memberships, 'publicPage')?.kind === 'assigned') {
      const [visits, inspections] = await Promise.all([
        this.db.job.count({ where: { outletId, supervisorId: user.id } }),
        this.db.inspection.count({ where: { outletId, supervisorId: user.id } }),
      ]);
      allowed = visits + inspections > 0;
    }
    if (!outlet || !allowed) throw new NotFoundException('Outlet not found');
    return outlet;
  }

  /**
   * The switch and the link belong to the restaurant's Owner alone. ECCS admins hold
   * the same letter in the permission table for their own take-down, so they are
   * turned away here by name.
   */
  private async requireOwner(user: AuthUser, outletId: string) {
    const outlet = await this.requireOutlet(user, outletId, 'update');
    if (!this.isRestaurant(user)) throw new ForbiddenException('Only the restaurant’s Owner can switch its page on or off');
    return outlet;
  }

  /** The outlet's page record, made the first time it is needed: off, with a fresh random link. */
  private async ensureProfile(outletId: string): Promise<ProfileRow> {
    const existing = await this.db.publicProfile.findUnique({ where: { outletId }, include: profileInclude });
    if (existing) return existing;
    try {
      return await this.db.publicProfile.create({ data: { outletId, token: newToken(), isEnabled: false }, include: profileInclude });
    } catch (error) {
      // Two people opened the screen at the same moment and the other one made the record first.
      if ((error as { code?: string }).code !== 'P2002') throw error;
      return this.db.publicProfile.findUniqueOrThrow({ where: { outletId }, include: profileInclude });
    }
  }

  /** Of these photos, the ids of the ones a diner sees now. */
  private async shownIds(photos: readonly PhotoRow[]): Promise<Set<string>> {
    const profileIds = [...new Set(photos.filter((photo) => photo.status === 'APPROVED' && !photo.removedAt).map((photo) => photo.profileId))];
    const shown = await Promise.all(profileIds.map((profileId) => this.db.publicPhoto.findMany({ ...shownPhotos(profileId), select: { id: true } })));
    return new Set(shown.flat().map((photo) => photo.id));
  }

  private async names(userIds: readonly (string | null)[]): Promise<Map<string, string>> {
    const ids = [...new Set(userIds.filter((id): id is string => id !== null))];
    if (ids.length === 0) return new Map();
    const users = await this.db.user.findMany({ where: { id: { in: ids } }, select: { id: true, name: true } });
    return new Map(users.map((entry) => [entry.id, entry.name]));
  }

  private toPhoto(photo: PhotoRow, forRestaurant: boolean, shown: boolean, proposedByName: string | null = null): PublicPhotoDto {
    return {
      id: photo.id,
      outletId: photo.profile.outletId,
      outletName: photo.profile.outlet.name,
      organizationName: photo.profile.outlet.organization.name,
      caption: toCaption(photo.captionCode),
      status: photo.status,
      path: this.storage.signedPath(photo.attachment.id),
      sourcePhotoId: forRestaurant ? null : photo.attachment.id,
      // The restaurant is not told which Supervisor proposed a photo, nor why another was rejected.
      proposedByName: forRestaurant ? null : proposedByName,
      proposedAt: photo.createdAt.toISOString(),
      decidedAt: photo.decidedAt?.toISOString() ?? null,
      rejectReason: forRestaurant ? null : photo.rejectReason,
      removed: photo.removedAt !== null,
      shown: shown && photo.status === 'APPROVED' && photo.removedAt === null,
    };
  }
}

/** A stored caption code as one of the fixed list. Anything unknown reads as the prep area, the most general. */
function toCaption(code: string | null): PublicPhotoCaption {
  return PUBLIC_PHOTO_CAPTIONS.find((caption) => caption === code) ?? 'PREP_AREA';
}
