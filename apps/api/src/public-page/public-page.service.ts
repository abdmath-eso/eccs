import { randomBytes, randomUUID } from 'node:crypto';
import { BadRequestException, ConflictException, ForbiddenException, Injectable, Logger, NotFoundException } from '@nestjs/common';
import type { Prisma } from '@eccs/db';
import {
  accessScope,
  can,
  checkPhotoWindow,
  inspectionShownUntil,
  isEccsRole,
  isLocalOnlyAddress,
  oldestPhotoShown,
  photoFarMetres,
  photoShownUntil,
  pickRecentServices,
  pickScoreDay,
  PUBLIC_PAGE_RULES,
  PUBLIC_PHOTO_BARRED_FLAGS,
  PUBLIC_PHOTO_CAPTIONS,
  PUBLIC_PHOTO_SOURCES,
  publicCheckResult,
  publicInspectionState,
  publicPageState,
  publicPageUrl,
  publicPhotoBy,
  publicScoreInspection,
  readPhotoFlags,
  readStoredScore,
  selfCheckSummary,
  selfCheckWindow,
  type Action,
  type InspectionGrade,
  type LocalizedText,
  type PublicCheckPhotosDto,
  type PublicInspectionState,
  type PublicPageDto,
  type PublicPageSettingsDto,
  type PublicPageState,
  type PublicPhotoCaption,
  type PublicPhotoDto,
  type PublicPhotoSource,
  type PublicPhotoStatus,
} from '@eccs/shared';
import type { AuthUser } from '../auth/auth.types.js';
import { ChecklistsService, indiaDate } from '../checklists/checklists.service.js';
import { env } from '../config/env.js';
import { PrismaService } from '../prisma/prisma.service.js';
import { handedInOnTime, ScoresService } from '../scores/scores.service.js';
import { sniffFile } from '../storage/attachments.controller.js';
import { PhotoIntegrityService, type PhotoFacts } from '../storage/photo-integrity.service.js';
import { StorageService } from '../storage/storage.service.js';
import { stripPhotoDetails } from './strip-photo-details.js';

const MAX_PHOTO_BYTES = 5 * 1024 * 1024;
const MAX_LISTED = 200;
/** The restaurant's own screen lists this many of the photos it has put forward, the newest first. */
const MAX_OWN_PROPOSALS = 60;
/** No more than this many answers are remembered at once, so guessing at links cannot fill the memory. */
const MAX_REMEMBERED = 5000;
/** What a link's token looks like. Anything else is not looked up at all. */
const TOKEN_PATTERN = /^[A-Za-z0-9_-]{10,64}$/;
/** The kinds of service a diner is told about: cleaning and pest control, ECCS's own work. */
const SHOWN_CATEGORIES = ['CLEANING', 'PEST'];
/**
 * Who on the restaurant's side may put photos from its daily checks forward: whoever can
 * open the "Customer page" screen, which is the Owner and the Manager (the Head Chef
 * cannot). To make it the Owner alone, change 'read' to 'update' here; nothing else needs to change.
 */
const PROPOSE_FROM_CHECKS_NEEDS: Action = 'read';

const toDbDate = (date: string) => new Date(`${date}T00:00:00.000Z`);
const fromDbDate = (date: Date) => date.toISOString().slice(0, 10);
const addDays = (date: string, days: number) => fromDbDate(new Date(toDbDate(date).getTime() + days * 86_400_000));

/**
 * The page reads checklists and the score through their own services, so "which
 * checklists were due", "what counts as late" and the score itself stay one rule each.
 * Those services ask who is reading; the page has no person, so it reads as ECCS. It
 * is never used to change anything a person recorded, and what leaves this service for
 * a diner is only what PublicPageDto lists: names of checklists, counts, results and points.
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
  attachment: { select: { id: true, integrityFlags: true } },
  profile: { select: { outletId: true, outlet: { select: { name: true, organizationId: true, organization: { select: { name: true } } } } } },
} as const satisfies Prisma.PublicPhotoInclude;
type PhotoRow = Prisma.PublicPhotoGetPayload<{ include: typeof photoInclude }>;

/**
 * The photos a diner sees: approved by ECCS, not removed since, taken within the last
 * 90 days, the most recently taken first (then the most recently approved).
 */
const shownPhotos = (profileId: string, today: string) =>
  ({
    where: { profileId, status: 'APPROVED', removedAt: null, takenOn: { gte: toDbDate(oldestPhotoShown(today)) } },
    orderBy: [{ takenOn: 'desc' }, { decidedAt: 'desc' }, { createdAt: 'desc' }, { id: 'asc' }],
    take: PUBLIC_PAGE_RULES.maxPhotos,
  }) as const satisfies Prisma.PublicPhotoFindManyArgs;

/**
 * A proof photo of the outlet's own daily checks that may be put forward for the page:
 * the proof of a check that was marked as fine (never the photo of a reported problem),
 * in a checklist that was handed in (so the answer can no longer change), on one of the
 * days in the window, at this outlet.
 */
const eligibleCheckPhoto = (outletId: string, window: { from: string; to: string }) =>
  ({
    outletId,
    kind: 'PROOF',
    mimeType: { startsWith: 'image/' },
    checklistResponse: {
      passed: true,
      run: { outletId, status: 'SUBMITTED', date: { gte: toDbDate(window.from), lte: toDbDate(window.to) } },
    },
  }) as const satisfies Prisma.AttachmentWhereInput;

/** True when a photo carries a mark that bars it from the page: the day it would state is in doubt, or its location was faked. */
const barred = (integrityFlags: unknown) => readPhotoFlags(integrityFlags).some((flag) => PUBLIC_PHOTO_BARRED_FLAGS.includes(flag.code));

/** A new link token: 128 random bits, so a link cannot be guessed or worked out from another. */
const newToken = () => randomBytes(16).toString('base64url');

/** ECCS's latest approved inspection of an outlet, and where it stands for the page today. */
interface LatestInspection {
  state: PublicInspectionState;
  /** The day it was carried out. Null when there is none. */
  date: string | null;
  score: number;
  grade: InspectionGrade | null;
  reportNumber: string;
}

/**
 * The customer QR page: what a diner sees, the restaurant's switch, ECCS's
 * take-down, and the photos proposed, approved and removed.
 *
 * The rules for what is shown are in packages/shared/src/public-page.ts; this
 * service reads the records.
 */
@Injectable()
export class PublicPageService {
  private readonly logger = new Logger(PublicPageService.name);
  /** Answers already worked out, by token, so a busy table does not read the records for every scan. */
  private readonly remembered = new Map<string, { until: number; page: PublicPageDto | null }>();

  constructor(
    private readonly prisma: PrismaService,
    private readonly storage: StorageService,
    private readonly checklists: ChecklistsService,
    private readonly scores: ScoresService,
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
   * What the page at this link shows, or null when there is nothing to show.
   * Null covers every reason alike (unknown link, switched off, taken down, client
   * gone), and the caller must not tell them apart either.
   */
  async page(token: string): Promise<PublicPageDto | null> {
    if (!TOKEN_PATTERN.test(token)) return null;
    const now = Date.now();
    const known = this.remembered.get(token);
    if (known && known.until > now) return known.page;

    const profile = await this.db.publicProfile.findUnique({ where: { token }, include: profileInclude });
    // Only a page that is showing is put together. For any other, nothing beyond its own record is read.
    let page: PublicPageDto | null = null;
    if (profile && this.stateOf(profile) === 'LIVE') {
      const today = indiaDate();
      page = await this.content(profile, today, await this.latestInspection(profile.outlet.id, today));
    }

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
      ...shownPhotos(profile.id, indiaDate()),
      select: { attachment: { select: { storageKey: true, mimeType: true } } },
    });
    const attachment = photos[place - 1]?.attachment;
    if (!attachment || !attachment.mimeType.startsWith('image/')) return null;
    const file = await this.storage.getBuffer(attachment.storageKey);
    // Whatever the camera wrote into the file besides the picture (place, phone model, time) stays private.
    return { body: stripPhotoDetails(file, attachment.mimeType), mimeType: attachment.mimeType };
  }

  // ───────────────────────── Working out what is shown ─────────────────────────

  /** Whether a diner is shown the page. Since 13 Oct 2026 this needs no inspection. */
  private stateOf(profile: ProfileRow): PublicPageState {
    return publicPageState({
      clientActive: profile.outlet.isActive && profile.outlet.organization.isActive,
      takenDown: profile.takenDownAt !== null,
      enabled: profile.isEnabled,
    });
  }

  /** ECCS's latest approved inspection. Without a report number there is nothing a diner could check, so it does not count. */
  private async latestInspection(outletId: string, today: string): Promise<LatestInspection> {
    const latest = await this.db.inspection.findFirst({
      where: { outletId, status: 'APPROVED', overallScore: { not: null }, grade: { not: null }, reportNumber: { not: null } },
      orderBy: [{ conductedAt: 'desc' }, { createdAt: 'desc' }],
      select: { conductedAt: true, overallScore: true, grade: true, reportNumber: true },
    });
    const date = latest ? indiaDate(latest.conductedAt) : null;
    return {
      state: publicInspectionState(date, today),
      date,
      score: Math.round(latest?.overallScore ?? 0),
      grade: (latest?.grade as InspectionGrade | null | undefined) ?? null,
      reportNumber: latest?.reportNumber ?? '',
    };
  }

  /**
   * Everything the page shows for an outlet, whether or not the page is on: the
   * Owner's screen shows the same thing as "what customers see".
   */
  private async content(profile: ProfileRow, today: string, latest: LatestInspection): Promise<PublicPageDto> {
    const outlet = profile.outlet;
    // The score first and by itself: working it out reads the same checklist records the daily checks read next.
    const score = await this.score(outlet.id, today, latest.state);
    const daily = await this.dailyChecks(outlet.id, today);
    const [services, photos, fssai] = await Promise.all([
      this.services(outlet.id, today),
      this.db.publicPhoto.findMany({ ...shownPhotos(profile.id, today), select: { captionCode: true, source: true, takenOn: true } }),
      this.db.licence.findFirst({
        where: { outletId: outlet.id, type: 'FSSAI', number: { not: null } },
        orderBy: { expiresOn: 'desc' },
        select: { number: true },
      }),
    ]);

    return {
      restaurantName: outlet.organization.name,
      outletName: outlet.name,
      city: outlet.city,
      yesterday: addDays(today, -1),
      score,
      ...daily,
      photos: photos.map((photo, index) => ({
        n: index + 1,
        caption: toCaption(photo.captionCode),
        date: fromDbDate(photo.takenOn),
        by: publicPhotoBy(toSource(photo.source)),
      })),
      // The inspection is shown only inside its validity period; afterwards it drops off by itself.
      inspection:
        latest.state === 'CURRENT' && latest.date && latest.grade
          ? {
              score: latest.score,
              grade: latest.grade,
              date: latest.date,
              shownUntil: inspectionShownUntil(latest.date),
              reportNumber: latest.reportNumber,
            }
          : null,
      services,
      fssaiNumber: fssai?.number?.trim() || outlet.fssaiNumber?.trim() || null,
      eccsPhone: env.SUPPORT_PHONE,
      updatedAt: new Date().toISOString(),
    };
  }

  /**
   * Yesterday's hygiene score with its three parts, or the most recent one of the last
   * week with its own date, or null when there is none.
   *
   * Yesterday is over, so its score is worked out afresh here by the scorer itself
   * (apps/api/src/scores), which also stores it as that day's row. Reading the row
   * as it stood would not do: it may have been written during the day, before the
   * evening's checklists, and it would not know of an inspection approved since. This
   * way the app's trend and the page always show the same number for the day.
   */
  private async score(outletId: string, today: string, inspection: PublicInspectionState): Promise<PublicPageDto['score']> {
    const yesterday = addDays(today, -1);
    try {
      await this.scores.snapshot(outletId, yesterday);
    } catch (error) {
      // The stored days are still read below: a number with its own date is better than none.
      this.logger.warn(`Could not work out yesterday's hygiene score of outlet ${outletId} for its customer page: ${String(error)}`);
    }

    const rows = await this.db.hygieneScoreSnapshot.findMany({
      where: { outletId, date: { gte: toDbDate(addDays(today, -PUBLIC_PAGE_RULES.scoreWithinDays)), lte: toDbDate(yesterday) } },
      select: { date: true, score: true, breakdown: true },
    });
    const days = rows.flatMap((row) => {
      const read = readStoredScore(row.score, row.breakdown);
      return read ? [{ date: fromDbDate(row.date), ...read }] : [];
    });
    const chosen = pickScoreDay(days.map((day) => day.date), today);
    const found = days.find((day) => day.date === chosen);
    if (!found) return null;

    const counted = !found.provisional;
    // Only asked when it decides the wording: has ECCS finished an inspection here at all, approved or not?
    const everInspected =
      counted ||
      inspection !== 'NONE' ||
      (await this.db.inspection.count({ where: { outletId, status: { in: ['SUBMITTED', 'APPROVED'] } } })) > 0;
    return { ...found, isYesterday: found.date === yesterday, inspection: publicScoreInspection({ counted, inspection, everInspected }) };
  }

  /**
   * The outlet's daily checklists with yesterday's result for each, and on how many of
   * the last 30 days all of them were handed in. Only names, counts and results: never
   * the checks themselves, who did them, at what time, or what was written.
   */
  private async dailyChecks(outletId: string, today: string): Promise<Pick<PublicPageDto, 'checklists' | 'selfChecks'>> {
    const { from, to } = selfCheckWindow(today);
    // The checklist service also writes down as missed any day nobody opened the app.
    const summaries = await this.checklists.between(READER, outletId, from, to);
    const lists = await this.checklists.outletChecklists(READER, outletId);

    // `to` is yesterday. Each checklist has at most one record a day.
    const ofYesterday = new Map(summaries.filter((summary) => summary.date === to).map((summary) => [summary.id, summary.status]));
    const records = ofYesterday.size
      ? await this.db.checklistRun.findMany({
          where: { id: { in: [...ofYesterday.keys()] } },
          select: { id: true, outletChecklistId: true, submittedAt: true, outletChecklist: { select: { dueTime: true } } },
        })
      : [];
    const byList = new Map(records.map((record) => [record.outletChecklistId, record]));

    return {
      checklists: lists
        // A checklist the restaurant has made but given no checks yet is not handed out, so it is not listed.
        .filter((list) => list.items.length > 0)
        .map((list) => {
          const record = byList.get(list.id);
          return {
            name: list.title,
            checks: list.items.length,
            result: publicCheckResult(
              record
                ? {
                    handedIn: ofYesterday.get(record.id) === 'SUBMITTED',
                    onTime: handedInOnTime(to, record.submittedAt, record.outletChecklist.dueTime),
                  }
                : null,
            ),
          };
        }),
      selfChecks: selfCheckSummary(
        summaries.map((summary) => ({ date: summary.date, handedIn: summary.status === 'SUBMITTED' })),
        today,
      ),
    };
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
    const today = indiaDate();
    const state = this.stateOf(profile);
    const latest = await this.latestInspection(outlet.id, today);
    const restaurant = this.isRestaurant(user);
    const target = { organizationId: outlet.organizationId, outletId: outlet.id };

    const current = shownPhotos(profile.id, today);
    const [preview, photos, photosWaiting] = await Promise.all([
      // What a diner sees, or would see if the page were on. A client that is switched off has no page to preview.
      state === 'INACTIVE' ? null : this.content(profile, today, latest),
      this.db.publicPhoto.findMany({ where: current.where, include: photoInclude, orderBy: current.orderBy, take: MAX_LISTED }),
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
      state,
      url,
      localOnly: isLocalOnlyAddress(url),
      linkChangedAt: profile.tokenChangedAt?.toISOString() ?? null,
      // For information: the page shows without an inspection, and shows the inspection while there is a current one.
      inspection: { state: latest.state, date: latest.date, shownUntil: latest.date ? inspectionShownUntil(latest.date) : null },
      preview,
      photos: photos.map((photo, index) => this.toPhoto(photo, restaurant, index < PUBLIC_PAGE_RULES.maxPhotos)),
      photosWaiting,
      // The switch is the restaurant's own: publishing is its decision, so ECCS cannot turn a page on.
      canSwitch: restaurant && can(user.memberships, 'publicPage', 'update', target),
      canTakeDown: !restaurant && can(user.memberships, 'publicPage', 'approve', target),
      canPropose: this.mayProposeFromChecks(user, target),
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

  // ───────────────────────── Photos from ECCS's visits ─────────────────────────

  /**
   * A Supervisor proposes a photo already taken during one of their own finished
   * visits or inspections. A restaurant's checklist photos are its own: a Supervisor
   * can never propose one (the restaurant does that itself, below). A photo is
   * proposed once; ECCS's decision on it stands.
   */
  async propose(user: AuthUser, input: { attachmentId: string; caption: PublicPhotoCaption }): Promise<PublicPhotoDto> {
    const attachment = await this.db.attachment.findUnique({
      where: { id: input.attachmentId },
      select: {
        id: true,
        outletId: true,
        mimeType: true,
        capturedAt: true,
        createdAt: true,
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
    return this.createProposal(user, attachment.outletId, attachment.id, input.caption, {
      source: visit ? 'ECCS_VISIT' : 'ECCS_INSPECTION',
      takenOn: indiaDate(attachment.capturedAt ?? attachment.createdAt),
    });
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
    const capturedAt = said && !Number.isNaN(said.getTime()) && said <= now ? said : now;
    await this.db.attachment.create({
      data: {
        id,
        outletId: outlet.id,
        kind: 'PROOF',
        storageKey,
        mimeType: image.mimeType,
        sizeBytes: file.size,
        capturedAt,
        uploadedById: user.id,
        ...this.integrity.captureColumns({ buffer: file.buffer, mimeType: image.mimeType }, phone.capturedAt, now, facts),
      },
    });
    return this.createProposal(user, outlet.id, id, caption, { source: 'ECCS_FOR_PAGE', takenOn: indiaDate(capturedAt) });
  }

  // ───────────────────────── Photos from the restaurant's own daily checks ─────────────────────────

  /**
   * For the restaurant's "Add photos from your daily checks" screen: the proof photos it
   * may put forward (see eligibleCheckPhoto), the newest day first, and what has become
   * of the ones it already has. Nothing here is published: a person chooses each photo,
   * and ECCS approves it, before a diner can see it.
   */
  async checkPhotos(user: AuthUser, outletId: string): Promise<PublicCheckPhotosDto> {
    const outlet = await this.requireOutlet(user, outletId, 'read');
    // ECCS cannot browse a restaurant's checklist photos from here: this list is for the restaurant's own people.
    if (!this.isRestaurant(user)) throw new ForbiddenException('Only the restaurant can see its own checklist photos here');
    const profile = await this.ensureProfile(outlet.id);
    const today = indiaDate();

    const [photos, proposed] = await Promise.all([
      this.db.attachment.findMany({
        where: { ...eligibleCheckPhoto(outlet.id, checkPhotoWindow(today)), publicPhotos: { none: {} } },
        // By day, then by checklist in the order they fall due, then in the order of the checks.
        orderBy: [
          { checklistResponse: { run: { date: 'desc' } } },
          { checklistResponse: { run: { outletChecklist: { dueTime: { sort: 'asc', nulls: 'last' } } } } },
          { checklistResponse: { run: { outletChecklistId: 'asc' } } },
          { checklistResponse: { item: { position: 'asc' } } },
        ],
        take: MAX_LISTED,
        select: {
          id: true,
          integrityFlags: true,
          checklistResponse: {
            select: {
              item: { select: { label: true } },
              run: { select: { date: true, outletChecklist: { select: { template: { select: { title: true } } } } } },
            },
          },
        },
      }),
      this.db.publicPhoto.findMany({
        where: { profileId: profile.id, source: 'DAILY_CHECK' },
        include: photoInclude,
        orderBy: { createdAt: 'desc' },
        take: MAX_OWN_PROPOSALS,
      }),
    ]);
    const shown = await this.shownIds(proposed);

    const eligible = photos.flatMap((photo) => {
      const answer = photo.checklistResponse;
      if (!answer || barred(photo.integrityFlags)) return [];
      return [
        {
          attachmentId: photo.id,
          path: this.storage.signedPath(photo.id),
          date: fromDbDate(answer.run.date),
          checklist: answer.run.outletChecklist.template.title as LocalizedText,
          check: answer.item.label as LocalizedText,
          // Taken far from the outlet's saved place: still offered, with the distance said beside it.
          farMetres: photoFarMetres(readPhotoFlags(photo.integrityFlags)),
        },
      ];
    });

    return {
      eligible,
      // Said on the screen with the reasons, so a photo that is missing is not a mystery.
      leftOut: photos.length - eligible.length,
      proposed: proposed.map((photo) => this.toPhoto(photo, true, shown.has(photo.id))),
      canPropose: this.mayProposeFromChecks(user, { organizationId: outlet.organizationId, outletId: outlet.id }),
    };
  }

  /**
   * The restaurant puts one of its own daily-check photos forward for its page. It then
   * waits for ECCS's approval like any other, and that approval shows ECCS this one
   * photo and nothing else of the checklist. Proposed once; ECCS's decision stands.
   */
  async proposeFromCheck(user: AuthUser, outletId: string, input: { attachmentId: string; caption: PublicPhotoCaption }): Promise<PublicPhotoDto> {
    const outlet = await this.requireOutlet(user, outletId, 'read');
    if (!this.mayProposeFromChecks(user, { organizationId: outlet.organizationId, outletId: outlet.id })) {
      throw new ForbiddenException('Only the restaurant can put forward photos from its own daily checks');
    }
    const photo = await this.db.attachment.findFirst({
      where: { id: input.attachmentId, ...eligibleCheckPhoto(outlet.id, checkPhotoWindow(indiaDate())) },
      select: {
        id: true,
        integrityFlags: true,
        publicPhotos: { select: { id: true }, take: 1 },
        checklistResponse: { select: { run: { select: { date: true } } } },
      },
    });
    // One answer for a photo of another outlet, the photo of a reported problem, a photo from a checklist
    // that was not handed in or is too old, a doubtful photo, and a photo that does not exist.
    if (!photo?.checklistResponse || barred(photo.integrityFlags)) throw new NotFoundException('Photo not found');
    if (photo.publicPhotos.length > 0) {
      throw new ConflictException({ message: 'This photo has already been proposed', code: 'PHOTO_ALREADY_PROPOSED' });
    }
    // The day stated for the photo is the day of the check it was the proof for.
    const takenOn = fromDbDate(photo.checklistResponse.run.date);
    return this.createProposal(user, outlet.id, photo.id, input.caption, { source: 'DAILY_CHECK', takenOn }, true);
  }

  // ───────────────────────── ECCS's approval, and removing ─────────────────────────

  private async createProposal(
    user: AuthUser,
    outletId: string,
    attachmentId: string,
    caption: PublicPhotoCaption,
    from: { source: PublicPhotoSource; takenOn: string },
    forRestaurant = false,
  ): Promise<PublicPhotoDto> {
    const profile = await this.ensureProfile(outletId);
    const today = indiaDate();
    const created = await this.db.publicPhoto.create({
      data: {
        profileId: profile.id,
        attachmentId,
        captionCode: caption,
        proposedById: user.id,
        source: from.source,
        // A photo cannot have been taken after it was proposed, whatever the phone's clock said.
        takenOn: toDbDate(from.takenOn > today ? today : from.takenOn),
      },
      include: photoInclude,
    });
    return this.toPhoto(created, forRestaurant, false);
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
   * True for someone on the restaurant's side who may put this outlet's daily-check
   * photos forward: they can open its customer page (see PROPOSE_FROM_CHECKS_NEEDS)
   * and can already see its checklists, photos included. Never anyone at ECCS.
   */
  private mayProposeFromChecks(user: AuthUser, target: { organizationId: string; outletId: string }) {
    return user.memberships.some(
      (membership) =>
        !isEccsRole(membership.role) &&
        can([membership], 'publicPage', PROPOSE_FROM_CHECKS_NEEDS, target) &&
        can([membership], 'checklists', 'read', target),
    );
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
    const today = indiaDate();
    const profileIds = [...new Set(photos.filter((photo) => photo.status === 'APPROVED' && !photo.removedAt).map((photo) => photo.profileId))];
    const shown = await Promise.all(
      profileIds.map((profileId) => this.db.publicPhoto.findMany({ ...shownPhotos(profileId, today), select: { id: true } })),
    );
    return new Set(shown.flat().map((photo) => photo.id));
  }

  private async names(userIds: readonly (string | null)[]): Promise<Map<string, string>> {
    const ids = [...new Set(userIds.filter((id): id is string => id !== null))];
    if (ids.length === 0) return new Map();
    const users = await this.db.user.findMany({ where: { id: { in: ids } }, select: { id: true, name: true } });
    return new Map(users.map((entry) => [entry.id, entry.name]));
  }

  private toPhoto(photo: PhotoRow, forRestaurant: boolean, shown: boolean, proposedByName: string | null = null): PublicPhotoDto {
    const source = toSource(photo.source);
    const takenOn = fromDbDate(photo.takenOn);
    const expired = takenOn < oldestPhotoShown(indiaDate());
    return {
      id: photo.id,
      outletId: photo.profile.outletId,
      outletName: photo.profile.outlet.name,
      organizationName: photo.profile.outlet.organization.name,
      caption: toCaption(photo.captionCode),
      status: photo.status,
      source,
      takenOn,
      shownUntil: photoShownUntil(takenOn),
      expired,
      path: this.storage.signedPath(photo.attachment.id),
      sourcePhotoId: forRestaurant ? null : photo.attachment.id,
      // The restaurant is not told which Supervisor proposed a photo.
      proposedByName: forRestaurant ? null : proposedByName,
      proposedAt: photo.createdAt.toISOString(),
      decidedAt: photo.decidedAt?.toISOString() ?? null,
      // Why a photo was rejected is told to whoever put it forward: the restaurant for one from
      // its own daily checks, the Supervisor (and not the restaurant) for one of ECCS's.
      rejectReason: forRestaurant && source !== 'DAILY_CHECK' ? null : photo.rejectReason,
      removed: photo.removedAt !== null,
      shown: shown && photo.status === 'APPROVED' && photo.removedAt === null && !expired,
      // For ECCS's office to weigh; the restaurant is told it of its own photos only, like the reason above.
      farMetres: forRestaurant && source !== 'DAILY_CHECK' ? null : photoFarMetres(readPhotoFlags(photo.attachment.integrityFlags)),
    };
  }
}

/** A stored caption code as one of the fixed list. Anything unknown reads as the prep area, the most general. */
function toCaption(code: string | null): PublicPhotoCaption {
  return PUBLIC_PHOTO_CAPTIONS.find((caption) => caption === code) ?? 'PREP_AREA';
}

/** A stored source as one of the fixed list. Only this service writes it, so anything else is not expected. */
function toSource(code: string): PublicPhotoSource {
  return PUBLIC_PHOTO_SOURCES.find((source) => source === code) ?? 'ECCS_FOR_PAGE';
}
