import { randomUUID } from 'node:crypto';
import { BadRequestException, ConflictException, ForbiddenException, Injectable, NotFoundException } from '@nestjs/common';
import type { Prisma } from '@eccs/db';
import {
  accessScope,
  BOOKING_MAX_DAYS_AHEAD,
  can,
  isEccsRole,
  readPhotoFlags,
  toServiceCategory,
  VISIT_MAX_DOCUMENTS,
  VISIT_MAX_PHOTOS,
  VISIT_SLOTS,
  type BookingDto,
  type LocalizedText,
  type ServiceCatalogItemDto,
  type ServiceTypeDto,
  type SupervisorDto,
  type VisitDocumentDto,
  type VisitDto,
  type VisitPhotoKind,
  type VisitSlot,
  type VisitStatus,
  type VisitSummaryDto,
} from '@eccs/shared';
import type { AuthUser } from '../auth/auth.types.js';
import { BillingService } from '../billing/billing.service.js';
import { CertificatesService, toVisitCertificate } from '../certificates/certificates.service.js';
import { indiaDate } from '../checklists/checklists.service.js';
import { NotifyService } from '../notifications/notify.service.js';
import { PrismaService } from '../prisma/prisma.service.js';
import { sniffFile } from '../storage/attachments.controller.js';
import { PhotoIntegrityService, type PhotoFacts } from '../storage/photo-integrity.service.js';
import { StorageService } from '../storage/storage.service.js';
import { ReportPdfService } from './report-pdf.service.js';

const MAX_LISTED = 100;
const MAX_PHOTO_BYTES = 5 * 1024 * 1024;

const toDbDate = (date: string) => new Date(`${date}T00:00:00.000Z`);
const fromDbDate = (date: Date) => date.toISOString().slice(0, 10);
const toSlot = (slot: string | null) => VISIT_SLOTS.find((known) => known === slot) ?? null;

const outletSelect = {
  select: {
    id: true,
    name: true,
    address: true,
    city: true,
    organizationId: true,
    organization: { select: { name: true } },
    // Only to know whether the kitchen's location has been set yet (see canSetOutletLocation).
    latitude: true,
  },
} as const;

const bookingInclude = {
  outlet: outletSelect,
  catalogItem: { select: { name: true, pricePaise: true } },
  job: { select: { id: true, scheduledDate: true, scheduledSlot: true, status: true } },
} as const satisfies Prisma.BookingInclude;

const visitInclude = {
  outlet: outletSelect,
  serviceType: { select: { code: true, name: true, partnerDelivered: true } },
  supervisor: { select: { id: true, name: true } },
  serviceReport: { select: { number: true } },
  signOff: { select: { signedAt: true } },
} as const satisfies Prisma.JobInclude;

const visitDetailInclude = {
  ...visitInclude,
  serviceType: {
    select: {
      code: true,
      name: true,
      partnerDelivered: true,
      checklistTemplate: {
        select: {
          // Retired tasks are read too: a visit that answered one keeps showing it (see visitTasks).
          items: {
            where: { outletId: null },
            orderBy: { position: 'asc' },
            // `type` NUMBER marks a task that records a meter reading; `maxValue` is its limit.
            select: { id: true, label: true, isActive: true, type: true, maxValue: true },
          },
        },
      },
    },
  },
  taskResponses: true,
  attachments: { where: { kind: { in: ['BEFORE', 'AFTER'] } }, orderBy: { createdAt: 'asc' } },
  signOff: true,
  // The certificate issued for the visit, if its kind of service carries one (a visit has at most one).
  certificates: { orderBy: { createdAt: 'asc' }, take: 1, select: { id: true, number: true, validFrom: true, validUntil: true } },
} as const satisfies Prisma.JobInclude;

type BookingRow = Prisma.BookingGetPayload<{ include: typeof bookingInclude }>;
type VisitRow = Prisma.JobGetPayload<{ include: typeof visitInclude }>;
type VisitDetailRow = Prisma.JobGetPayload<{ include: typeof visitDetailInclude }>;

/**
 * The tasks of one visit. ECCS can add and retire tasks in the console's
 * Catalogue, and a visit must not change under the people who did it:
 * - a task the visit has an answer for always stays, even if retired since;
 * - a visit still to be done, or under way, also has every task in use today;
 * - a finished visit has only what was answered, so a task added afterwards
 *   never appears on an old report as "not done".
 */
function visitTasks(visit: VisitDetailRow) {
  const answered = new Set(visit.taskResponses.map((response) => response.itemId));
  const open = visit.status === 'SCHEDULED' || visit.status === 'ASSIGNED' || visit.status === 'IN_PROGRESS';
  return (visit.serviceType.checklistTemplate?.items ?? []).filter(
    (item) => answered.has(item.id) || (open && item.isActive),
  );
}

/**
 * The service loop. A restaurant books a service from the catalogue; ECCS
 * confirms a date and gives the visit to a Supervisor; the Supervisor records
 * it on site (check-in, tasks, photos); the restaurant signs it off. A visit
 * whose work is completed is its own service report.
 */
@Injectable()
export class ServicesService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly storage: StorageService,
    private readonly reports: ReportPdfService,
    private readonly notify: NotifyService,
    private readonly certificates: CertificatesService,
    private readonly billing: BillingService,
    private readonly integrity: PhotoIntegrityService,
  ) {}

  private get db() {
    return this.prisma.client;
  }

  // ───────────────────────── Catalogue ─────────────────────────

  async catalog(): Promise<ServiceCatalogItemDto[]> {
    const items = await this.db.serviceCatalogItem.findMany({
      where: { isActive: true, serviceType: { isActive: true } },
      include: { serviceType: { select: { code: true, category: true, partnerDelivered: true } } },
      orderBy: { pricePaise: 'asc' },
    });
    return items.map((item) => ({
      id: item.id,
      serviceCode: item.serviceType.code,
      category: toServiceCategory(item.serviceType.category),
      partnerDelivered: item.serviceType.partnerDelivered,
      name: item.name as LocalizedText,
      description: (item.description as LocalizedText | null) ?? null,
      pricePaise: item.pricePaise,
      durationMinutes: item.durationMinutes,
    }));
  }

  async serviceTypes(): Promise<ServiceTypeDto[]> {
    const types = await this.db.serviceType.findMany({ where: { isActive: true }, orderBy: { code: 'asc' } });
    return types.map((type) => ({ code: type.code, name: type.name as LocalizedText }));
  }

  /** The people a visit can be given to. */
  async supervisors(): Promise<SupervisorDto[]> {
    const people = await this.db.user.findMany({
      where: { isActive: true, memberships: { some: { role: 'SUPERVISOR' } } },
      select: { id: true, name: true },
      orderBy: { name: 'asc' },
    });
    return people;
  }

  // ───────────────────────── Bookings ─────────────────────────

  /** Requests the user may see: those waiting for ECCS first, then the newest. */
  async listBookings(
    user: AuthUser,
    filter: { outletId?: string | undefined; requestedOnly: boolean },
  ): Promise<BookingDto[]> {
    const scope = accessScope(user.memberships, 'bookings');
    if (!scope) return [];

    let where: Prisma.BookingWhereInput;
    if (scope.kind === 'all') where = {};
    else if (scope.kind === 'assigned') where = { job: { supervisorId: user.id } };
    else {
      where = {
        OR: [{ outlet: { organizationId: { in: scope.organizationIds } } }, { outletId: { in: scope.outletIds } }],
      };
    }

    const bookings = await this.db.booking.findMany({
      where: {
        ...where,
        ...(filter.outletId && { outletId: filter.outletId }),
        ...(filter.requestedOnly && { status: 'REQUESTED' }),
      },
      include: bookingInclude,
      orderBy: { createdAt: 'desc' },
      take: MAX_LISTED,
    });
    const names = await this.userNames(bookings.map((booking) => booking.requestedById));
    return bookings
      .map((booking) => toBookingDto(booking, names))
      .sort((a, b) => Number(b.status === 'REQUESTED') - Number(a.status === 'REQUESTED'));
  }

  /** The Owner or Manager asks for a one-time service on a day and time that suits them. */
  async createBooking(
    user: AuthUser,
    input: { outletId: string; catalogItemId: string; preferredDate: string; preferredSlot: VisitSlot; notes?: string | undefined },
  ): Promise<BookingDto> {
    const outlet = await this.db.outlet.findUnique({
      where: { id: input.outletId },
      select: { id: true, organizationId: true, isActive: true, organization: { select: { isActive: true } } },
    });
    // An outlet ECCS has switched off, or one of a client that is switched off, takes no bookings.
    const allowed =
      outlet?.isActive &&
      outlet.organization.isActive &&
      can(user.memberships, 'bookings', 'create', { organizationId: outlet.organizationId, outletId: outlet.id });
    if (!outlet || !allowed) throw new ForbiddenException('You cannot book a service for this outlet');

    const item = await this.db.serviceCatalogItem.findFirst({
      where: { id: input.catalogItemId, isActive: true, serviceType: { isActive: true } },
      select: { id: true },
    });
    if (!item) throw new BadRequestException('That service is not available');
    this.requireUpcomingDate(input.preferredDate, BOOKING_MAX_DAYS_AHEAD);

    const booking = await this.db.booking.create({
      data: {
        outletId: outlet.id,
        catalogItemId: item.id,
        preferredDate: toDbDate(input.preferredDate),
        preferredSlot: input.preferredSlot,
        notes: input.notes || null,
        requestedById: user.id,
      },
    });
    await this.notify.bookingRequested(user, booking.id);
    return this.getBooking(booking.id);
  }

  /** ECCS accepts a request. This puts the visit in the diary. */
  async confirmBooking(
    user: AuthUser,
    bookingId: string,
    input: { date: string; slot: VisitSlot; supervisorId?: string | null | undefined },
  ): Promise<BookingDto> {
    const booking = await this.requireBooking(user, bookingId);
    if (!this.isEccsAdmin(user)) throw new ForbiddenException('Only ECCS can confirm a booking');
    if (booking.status !== 'REQUESTED') throw new ConflictException('This request has already been dealt with');
    this.requireUpcomingDate(input.date);
    const supervisorId = await this.requireSupervisor(input.supervisorId);

    await this.db.$transaction([
      this.db.job.create({
        data: {
          outletId: booking.outletId,
          serviceTypeId: booking.catalogItem.serviceTypeId,
          bookingId: booking.id,
          scheduledDate: toDbDate(input.date),
          scheduledSlot: input.slot,
          status: supervisorId ? 'ASSIGNED' : 'SCHEDULED',
          supervisorId,
        },
      }),
      this.db.booking.update({ where: { id: booking.id }, data: { status: 'CONFIRMED' } }),
    ]);
    await this.notify.bookingConfirmed(user, booking.id);
    return this.getBooking(booking.id);
  }

  /**
   * Withdraws a request. The restaurant can do this until ECCS has confirmed
   * it; after that they call ECCS, who can cancel until the visit starts.
   */
  async cancelBooking(user: AuthUser, bookingId: string): Promise<BookingDto> {
    const booking = await this.requireBooking(user, bookingId, 'update');
    const fromEccs = this.isEccsAdmin(user);
    if (booking.status === 'CONFIRMED' && !fromEccs) {
      throw new ConflictException('This visit is already confirmed. Call ECCS to change it.');
    }
    if (booking.status !== 'REQUESTED' && booking.status !== 'CONFIRMED') {
      throw new ConflictException('This request can no longer be cancelled');
    }
    if (booking.job && booking.job.status !== 'SCHEDULED' && booking.job.status !== 'ASSIGNED') {
      throw new ConflictException('The visit has already started');
    }
    await this.db.$transaction([
      ...(booking.job ? [this.db.job.update({ where: { id: booking.job.id }, data: { status: 'CANCELLED' } })] : []),
      this.db.booking.update({ where: { id: booking.id }, data: { status: 'CANCELLED' } }),
    ]);
    await this.notify.bookingCancelled(user, booking.id, { confirmed: booking.status === 'CONFIRMED' });
    return this.getBooking(booking.id);
  }

  // ───────────────────────── Visits ─────────────────────────

  /**
   * Visits the user may see. `open`: still to happen, happening, or waiting for
   * sign-off, soonest first. `closed`: signed off or cancelled, latest first.
   */
  async listVisits(
    user: AuthUser,
    filter: { outletId?: string | undefined; state: 'open' | 'closed' },
  ): Promise<VisitSummaryDto[]> {
    const scope = accessScope(user.memberships, 'jobs');
    if (!scope) return [];

    let where: Prisma.JobWhereInput;
    if (scope.kind === 'all') where = {};
    else if (scope.kind === 'assigned') where = { supervisorId: user.id };
    else {
      where = {
        OR: [{ outlet: { organizationId: { in: scope.organizationIds } } }, { outletId: { in: scope.outletIds } }],
      };
    }

    const open = filter.state === 'open';
    const forRestaurant = scope.kind === 'restaurant';
    // A visit the restaurant has signed off is finished for them, but stays on ECCS's
    // list until ECCS has approved its report.
    const underWay: Prisma.JobWhereInput = { status: { in: ['SCHEDULED', 'ASSIGNED', 'IN_PROGRESS', 'COMPLETED'] } };
    const stage: Prisma.JobWhereInput = forRestaurant
      ? open
        ? underWay
        : { status: { in: ['APPROVED', 'CANCELLED'] } }
      : open
        ? { OR: [underWay, { status: 'APPROVED', reviewedAt: null }] }
        : { OR: [{ status: 'CANCELLED' }, { status: 'APPROVED', reviewedAt: { not: null } }] };
    const visits = await this.db.job.findMany({
      where: { AND: [where, stage, filter.outletId ? { outletId: filter.outletId } : {}] },
      include: visitInclude,
      orderBy: [{ scheduledDate: open ? 'asc' : 'desc' }, { createdAt: 'asc' }],
      take: MAX_LISTED,
    });
    return visits.map((visit) => toSummary(visit, forRestaurant));
  }

  async getVisit(user: AuthUser, visitId: string): Promise<VisitDto> {
    const visit = await this.requireVisit(user, visitId);
    return this.toDto(user, visit, await this.visitDocuments(user, visit));
  }

  /** ECCS puts a visit in the diary without a request from the restaurant. */
  async createVisit(
    user: AuthUser,
    input: { outletId: string; serviceCode: string; date: string; slot: VisitSlot; supervisorId?: string | null | undefined },
  ): Promise<VisitDto> {
    if (!this.isEccsAdmin(user)) throw new ForbiddenException('Only ECCS can schedule a visit');
    const [outlet, serviceType] = await Promise.all([
      this.db.outlet.findFirst({
        where: { id: input.outletId, isActive: true, organization: { isActive: true } },
        select: { id: true },
      }),
      this.db.serviceType.findFirst({ where: { code: input.serviceCode, isActive: true }, select: { id: true } }),
    ]);
    if (!outlet) throw new BadRequestException('Outlet not found');
    if (!serviceType) throw new BadRequestException('That service is not available');
    this.requireUpcomingDate(input.date);
    const supervisorId = await this.requireSupervisor(input.supervisorId);

    const visit = await this.db.job.create({
      data: {
        outletId: outlet.id,
        serviceTypeId: serviceType.id,
        scheduledDate: toDbDate(input.date),
        scheduledSlot: input.slot,
        status: supervisorId ? 'ASSIGNED' : 'SCHEDULED',
        supervisorId,
      },
    });
    await this.notify.visitCreated(user, visit.id);
    return this.getVisit(user, visit.id);
  }

  /** ECCS moves a visit or changes who does it, until it starts. */
  async updateVisit(
    user: AuthUser,
    visitId: string,
    input: { date?: string | undefined; slot?: VisitSlot | undefined; supervisorId?: string | null | undefined },
  ): Promise<VisitDto> {
    const visit = await this.requireVisit(user, visitId);
    if (!this.isEccsAdmin(user)) throw new ForbiddenException('Only ECCS can change a visit');
    if (visit.status !== 'SCHEDULED' && visit.status !== 'ASSIGNED') {
      throw new ConflictException('This visit has already started');
    }
    if (input.date !== undefined) this.requireUpcomingDate(input.date);
    const supervisorId =
      input.supervisorId === undefined ? visit.supervisorId : await this.requireSupervisor(input.supervisorId);

    await this.db.job.update({
      where: { id: visit.id },
      data: {
        ...(input.date !== undefined && { scheduledDate: toDbDate(input.date) }),
        ...(input.slot !== undefined && { scheduledSlot: input.slot }),
        supervisorId,
        status: supervisorId ? 'ASSIGNED' : 'SCHEDULED',
      },
    });
    await this.notify.visitChanged(user, visit);
    return this.getVisit(user, visit.id);
  }

  /** ECCS calls a visit off before it starts. A booking it came from is cancelled with it. */
  async cancelVisit(user: AuthUser, visitId: string): Promise<VisitDto> {
    const visit = await this.requireVisit(user, visitId);
    if (!this.isEccsAdmin(user)) throw new ForbiddenException('Only ECCS can cancel a visit');
    if (visit.status !== 'SCHEDULED' && visit.status !== 'ASSIGNED') {
      throw new ConflictException('This visit has already started');
    }
    await this.db.$transaction([
      this.db.job.update({ where: { id: visit.id }, data: { status: 'CANCELLED' } }),
      ...(visit.bookingId
        ? [this.db.booking.update({ where: { id: visit.bookingId }, data: { status: 'CANCELLED' } })]
        : []),
    ]);
    await this.notify.visitCancelled(user, visit.id);
    return this.getVisit(user, visit.id);
  }

  // ───────────────────────── On site ─────────────────────────

  /** The Supervisor arrives. From here the tasks and photos can be recorded. */
  async checkIn(
    user: AuthUser,
    visitId: string,
    position: { latitude?: number | undefined; longitude?: number | undefined; at?: string | undefined },
  ): Promise<VisitDto> {
    const visit = await this.requireVisit(user, visitId);
    this.requireRecorder(user, visit);
    if (visit.status !== 'SCHEDULED' && visit.status !== 'ASSIGNED') {
      // A phone that checked in without signal sends the check-in later, and may send it
      // twice if the first reply was lost. The same check-in (same time) is not an error.
      if (visit.status !== 'CANCELLED' && sameMoment(visit.checkInAt, position.at)) return this.getVisit(user, visit.id);
      throw new ConflictException('This visit has already been started');
    }
    const outlet = await this.db.outlet.findUnique({
      where: { id: visit.outletId },
      select: { latitude: true, longitude: true },
    });
    const located = position.latitude !== undefined && position.longitude !== undefined;
    await this.db.job.update({
      where: { id: visit.id },
      data: {
        status: 'IN_PROGRESS',
        checkInAt: phoneTime(position.at),
        // Whoever starts an unassigned visit takes it.
        supervisorId: visit.supervisorId ?? user.id,
        ...(located && {
          checkInLatitude: position.latitude!,
          checkInLongitude: position.longitude!,
          ...(outlet?.latitude != null &&
            outlet.longitude != null && {
              checkInDistanceM: metresBetween(position.latitude!, position.longitude!, outlet.latitude, outlet.longitude),
            }),
        }),
      },
    });
    await this.notify.visitStarted(user, visit.id);
    return this.getVisit(user, visit.id);
  }

  async answerTask(
    user: AuthUser,
    visitId: string,
    itemId: string,
    input: { done: boolean; note?: string | undefined; value?: number | undefined },
  ): Promise<VisitDto> {
    const visit = await this.requireInProgress(user, visitId);
    const items = visitTasks(visit);
    const item = items.find((entry) => entry.id === itemId);
    if (!item) throw new NotFoundException('That task is not part of this service');

    // A task that records a meter reading (the frying oil test) is done only with its number.
    // Not done, with a reason, is still allowed: a kitchen may have fewer fryers than the list.
    const isReading = item.type === 'NUMBER';
    if (isReading && input.done && input.value === undefined) throw new BadRequestException('Enter the reading');
    if (!isReading && input.value !== undefined) throw new BadRequestException('This task does not take a reading');

    const answer = {
      valueBool: input.done,
      valueNumber: isReading && input.done ? input.value! : null,
      note: input.note || null,
      capturedAt: new Date(),
    };
    await this.db.jobTaskResponse.upsert({
      where: { jobId_itemId: { jobId: visit.id, itemId } },
      create: { jobId: visit.id, itemId, ...answer },
      update: answer,
    });
    return this.getVisit(user, visit.id);
  }

  async updateRecord(
    user: AuthUser,
    visitId: string,
    input: { technicianNames?: string[] | undefined; notes?: string | undefined; partnerName?: string | undefined },
  ): Promise<VisitDto> {
    const visit = await this.requireInProgress(user, visitId);
    await this.db.job.update({
      where: { id: visit.id },
      data: {
        ...(input.partnerName !== undefined && { partnerName: input.partnerName || null }),
        ...(input.technicianNames !== undefined && { technicianNames: [...new Set(input.technicianNames)] }),
        ...(input.notes !== undefined && { notes: input.notes || null }),
      },
    });
    return this.getVisit(user, visit.id);
  }

  async addPhoto(
    user: AuthUser,
    visitId: string,
    kind: VisitPhotoKind,
    file: { buffer: Buffer; size: number },
    /** Chosen by the phone: the photo's id, so sending it twice stores it once, and when it was taken. */
    phone: { id?: string | undefined; capturedAt?: string | undefined } = {},
    /** What the phone said about the photo besides the picture: where it was, and whether the camera took it. */
    facts?: PhotoFacts,
  ): Promise<VisitDto> {
    if (phone.id) {
      const earlier = await this.db.attachment.findUnique({ where: { id: phone.id }, select: { jobId: true } });
      // The same photo sent again after its first reply was lost: it is already on the visit.
      if (earlier?.jobId === visitId) return this.getVisit(user, visitId);
      if (earlier) throw new ConflictException('That photo has already been used elsewhere');
    }
    const visit = await this.requireInProgress(user, visitId);
    const image = sniffFile(file.buffer, false);
    if (!image) throw new BadRequestException('Only JPEG, PNG or WebP photos are accepted');
    if (file.size > MAX_PHOTO_BYTES) throw new BadRequestException('That photo is too large');
    if (visit.attachments.length >= VISIT_MAX_PHOTOS) {
      throw new BadRequestException(`A visit can have up to ${VISIT_MAX_PHOTOS} photos`);
    }

    const id = phone.id ?? randomUUID();
    const now = new Date();
    const month = String(now.getUTCMonth() + 1).padStart(2, '0');
    const storageKey = `outlets/${visit.outletId}/${now.getUTCFullYear()}/${month}/${id}.${image.extension}`;
    await this.storage.put(storageKey, file.buffer, image.mimeType);
    await this.db.attachment.create({
      data: {
        id,
        outletId: visit.outletId,
        jobId: visit.id,
        kind,
        storageKey,
        mimeType: image.mimeType,
        sizeBytes: file.size,
        capturedAt: phoneTime(phone.capturedAt, now),
        uploadedById: user.id,
        ...this.integrity.captureColumns({ buffer: file.buffer, mimeType: image.mimeType }, phone.capturedAt, now, facts),
      },
    });
    // Look at the photo once (time, place, used before). This only marks it for ECCS; it cannot refuse it.
    await this.integrity.assess(id);
    return this.getVisit(user, visit.id);
  }

  /**
   * Saves where the kitchen is, read by the phone of the person recording a visit there.
   * Only while the visit is under way, and only when ECCS has not set the outlet's location
   * already: a location set in the office is changed in the office.
   */
  async setOutletLocation(user: AuthUser, visitId: string, place: { latitude: number; longitude: number }): Promise<VisitDto> {
    const visit = await this.requireInProgress(user, visitId);
    if (visit.outlet.latitude === null) {
      await this.db.outlet.update({ where: { id: visit.outletId }, data: { latitude: place.latitude, longitude: place.longitude } });
    }
    return this.getVisit(user, visit.id);
  }

  async removePhoto(user: AuthUser, visitId: string, photoId: string): Promise<VisitDto> {
    const visit = await this.requireInProgress(user, visitId);
    const photo = visit.attachments.find((entry) => entry.id === photoId);
    // Already gone (the same removal sent twice, say): the visit is as the person wanted it.
    if (!photo) return this.getVisit(user, visit.id);
    await this.db.attachment.delete({ where: { id: photo.id } });
    await this.storage.remove(photo.storageKey).catch(() => undefined);
    return this.getVisit(user, visit.id);
  }

  // ───────────────────────── Result documents ─────────────────────────

  /**
   * Attaches a result document to a visit: the lab's report for a water test,
   * the list of staff seen at a medical camp, a training attendance sheet, the
   * agency's audit report. It is filed in the outlet's documents under
   * "report", exactly where the service report PDF goes, so the restaurant
   * finds it with its other papers.
   *
   * The Supervisor can attach one while recording the visit. ECCS's office can
   * attach one from check-in onwards and at any time afterwards, because a
   * lab's report or a certificate arrives days after the visit is finished.
   */
  async addDocument(
    user: AuthUser,
    visitId: string,
    input: { title: string; partnerName?: string | undefined },
    file: { buffer: Buffer; size: number },
  ): Promise<VisitDto> {
    const visit = await this.requireVisit(user, visitId);
    if (!this.mayAttachDocument(user, visit)) {
      if (!this.mayRecord(user, visit)) throw new ForbiddenException('This visit is not assigned to you');
      throw new ConflictException(
        visit.status === 'SCHEDULED' || visit.status === 'ASSIGNED'
          ? 'Check in at the outlet first'
          : 'Only the ECCS office can add a document once the visit is finished',
      );
    }
    const kind = sniffFile(file.buffer, true);
    if (!kind) throw new BadRequestException('Only PDF, JPEG, PNG or WebP files are accepted');
    const already = await this.db.document.count({ where: { attachment: { jobId: visit.id, kind: 'DOCUMENT' } } });
    if (already >= VISIT_MAX_DOCUMENTS) {
      throw new BadRequestException(`A visit can have up to ${VISIT_MAX_DOCUMENTS} documents`);
    }

    const id = randomUUID();
    const storageKey = `outlets/${visit.outletId}/visit-documents/${id}.${kind.extension}`;
    await this.storage.put(storageKey, file.buffer, kind.mimeType);
    await this.db.$transaction([
      this.db.attachment.create({
        data: {
          id,
          outletId: visit.outletId,
          jobId: visit.id,
          kind: 'DOCUMENT',
          storageKey,
          mimeType: kind.mimeType,
          sizeBytes: file.size,
          capturedAt: new Date(),
          uploadedById: user.id,
        },
      }),
      this.db.document.create({
        data: { outletId: visit.outletId, category: 'report', title: input.title, attachmentId: id, uploadedById: user.id },
      }),
      // Naming the partner with the document also records it on the visit.
      ...(input.partnerName
        ? [this.db.job.update({ where: { id: visit.id }, data: { partnerName: input.partnerName } })]
        : []),
    ]);
    // The same notice the restaurant gets for any document ECCS files for it.
    await this.notify.documentChanged(user, visit.outletId, input.title);
    return this.getVisit(user, visit.id);
  }

  /** Takes a wrongly attached result document off the visit and out of the outlet's documents. ECCS's office only. */
  async removeDocument(user: AuthUser, visitId: string, documentId: string): Promise<VisitDto> {
    const visit = await this.requireVisit(user, visitId);
    if (!this.isEccsAdmin(user)) throw new ForbiddenException('Only ECCS can remove a document from a visit');
    const document = await this.db.document.findFirst({
      where: { id: documentId, attachment: { jobId: visit.id, kind: 'DOCUMENT' } },
      include: { attachment: { select: { id: true, storageKey: true } } },
    });
    // Already gone (the same removal sent twice): the visit is as the person wanted it.
    if (!document) return this.getVisit(user, visit.id);
    await this.db.$transaction([
      this.db.document.delete({ where: { id: document.id } }),
      this.db.attachment.delete({ where: { id: document.attachment.id } }),
    ]);
    await this.storage.remove(document.attachment.storageKey).catch(() => undefined);
    return this.getVisit(user, visit.id);
  }

  /** ECCS's office from check-in onwards; the visit's own Supervisor while recording it. */
  private mayAttachDocument(user: AuthUser, visit: VisitRow): boolean {
    if (visit.status === 'SCHEDULED' || visit.status === 'ASSIGNED' || visit.status === 'CANCELLED') return false;
    if (!this.mayRecord(user, visit)) return false;
    return this.isEccsAdmin(user) || visit.status === 'IN_PROGRESS';
  }

  /** The visit's result documents, for people who may read the outlet's documents (not the Head Chef). */
  private async visitDocuments(user: AuthUser, visit: VisitRow): Promise<VisitDocumentDto[]> {
    const mayRead =
      this.mayRecord(user, visit) ||
      can(user.memberships, 'documents', 'read', { organizationId: visit.outlet.organizationId, outletId: visit.outletId });
    if (!mayRead) return [];
    const documents = await this.db.document.findMany({
      where: { attachment: { jobId: visit.id, kind: 'DOCUMENT' } },
      include: { attachment: { select: { id: true, mimeType: true } } },
      orderBy: { createdAt: 'asc' },
    });
    return documents.map((document) => ({
      id: document.id,
      title: document.title,
      file: { path: this.storage.signedPath(document.attachment.id), mimeType: document.attachment.mimeType },
      createdAt: document.createdAt.toISOString(),
    }));
  }

  /**
   * The Supervisor finishes. Every task must be answered and there must be at
   * least one photo of the finished work. The visit gets its report number
   * here and waits for the restaurant's sign-off.
   */
  async complete(user: AuthUser, visitId: string, at?: string): Promise<VisitDto> {
    if (at) {
      // `at` is when Finish was pressed on the phone. The same Finish sent again (its first
      // reply was lost on a weak signal) is not an error: the visit is already finished.
      const earlier = await this.requireVisit(user, visitId);
      this.requireRecorder(user, earlier);
      const finished = earlier.status === 'COMPLETED' || earlier.status === 'APPROVED';
      if (finished && sameMoment(earlier.completedAt, at)) return this.getVisit(user, visitId);
    }
    const visit = await this.requireInProgress(user, visitId);
    const items = visitTasks(visit);
    const answered = new Set(visit.taskResponses.map((response) => response.itemId));
    if (items.some((item) => !answered.has(item.id))) {
      throw new BadRequestException('Answer every task before finishing');
    }
    if (!visit.attachments.some((photo) => photo.kind === 'AFTER')) {
      throw new BadRequestException('Add at least one photo of the finished work');
    }

    const now = phoneTime(at);
    for (let attempt = 0; ; attempt++) {
      try {
        await this.db.$transaction(async (tx) => {
          // A report sent back for correction keeps the number it was first given.
          if (!visit.serviceReport) {
            const prefix = `SR-${indiaDate(now).slice(0, 4)}-`;
            const issued = await tx.serviceReport.count({ where: { number: { startsWith: prefix } } });
            await tx.serviceReport.create({
              data: { jobId: visit.id, number: `${prefix}${String(issued + 1 + attempt).padStart(5, '0')}` },
            });
          }
          // A visit ECCS sent back after the restaurant had signed it off does not need
          // signing again: once corrected it returns to ECCS for approval.
          await tx.job.update({
            where: { id: visit.id },
            data: { status: visit.signOff ? 'APPROVED' : 'COMPLETED', completedAt: now },
          });
          if (visit.bookingId) {
            await tx.booking.update({ where: { id: visit.bookingId }, data: { status: 'COMPLETED' } });
          }
        });
        break;
      } catch (error) {
        // Two visits finished at the same moment can pick the same number; take the next.
        if (attempt >= 3 || (error as { code?: string }).code !== 'P2002') throw error;
      }
    }
    await this.notify.visitFinished(user, visit.id);
    return this.getVisit(user, visit.id);
  }

  /**
   * ECCS has checked the signed-off visit's report. It is final from here: its
   * PDF is made and filed in the outlet's documents for the Owner and Manager.
   */
  async approveReport(user: AuthUser, visitId: string): Promise<VisitDto> {
    const visit = await this.requireReportInReview(user, visitId);
    await this.db.job.update({
      where: { id: visit.id },
      data: { reviewedAt: new Date(), reviewedById: user.id, reviewNote: null },
    });
    // Takes a few seconds, so the approval does not wait for it.
    this.reports.ensureLater(visit.id);
    // A kind of service that carries a certificate gets it now. This never fails the approval.
    await this.certificates.issueOnApproval(visit.id);
    // A booked one-time visit is invoiced now (a plan's visit is covered by the plan's invoice). This never fails the approval either.
    await this.billing.billOnApproval(visit.id);
    await this.notify.reportApproved(user, visit.id);
    return this.getVisit(user, visit.id);
  }

  /**
   * ECCS finds something wrong or missing in the report and gives the visit
   * back to the Supervisor, who corrects it and finishes again.
   */
  async returnReport(user: AuthUser, visitId: string, note: string): Promise<VisitDto> {
    const visit = await this.requireReportInReview(user, visitId);
    // The restaurant's sign-off and rating are kept; they do not sign again after the correction.
    await this.db.job.update({
      where: { id: visit.id },
      data: { status: 'IN_PROGRESS', completedAt: null, reviewNote: note },
    });
    await this.notify.reportReturned(user, visit.id);
    return this.getVisit(user, visit.id);
  }

  private async requireReportInReview(user: AuthUser, visitId: string): Promise<VisitDetailRow> {
    const visit = await this.requireVisit(user, visitId);
    if (!this.isEccsAdmin(user)) throw new ForbiddenException('Only ECCS can check a report');
    if (visit.status !== 'APPROVED' || visit.reviewedAt) {
      throw new ConflictException('This report is not waiting to be checked');
    }
    return visit;
  }

  /** The restaurant's Owner or Manager confirms the work was done and rates it. */
  async signOff(
    user: AuthUser,
    visitId: string,
    input: { rating: number; comment?: string | undefined },
  ): Promise<VisitDto> {
    const visit = await this.requireVisit(user, visitId);
    if (!this.maySignOff(user, visit)) throw new ForbiddenException('Only the Owner or Manager can sign off a visit');
    if (visit.status === 'APPROVED') throw new ConflictException('This visit has already been signed off');
    if (visit.status !== 'COMPLETED') throw new ConflictException('The visit is not finished yet');

    const now = new Date();
    const role = user.memberships.find(
      (m) => !isEccsRole(m.role) && (m.outletId === visit.outletId || m.organizationId === visit.outlet.organizationId),
    )?.role;
    await this.db.$transaction([
      this.db.signOff.create({
        data: {
          jobId: visit.id,
          signerName: user.name,
          signerRole: role ?? null,
          signedAt: now,
          rating: input.rating,
          comment: input.comment || null,
        },
      }),
      // Signed off; the report now waits for ECCS to approve it.
      this.db.job.update({
        where: { id: visit.id },
        data: { status: 'APPROVED', approvedById: user.id, approvedAt: now, reviewedAt: null, reviewedById: null },
      }),
    ]);
    await this.notify.visitSignedOff(user, visit.id);
    return this.getVisit(user, visit.id);
  }

  /** A link to the final report as a PDF. Makes the PDF first if it is not there yet. */
  async reportPdf(user: AuthUser, visitId: string): Promise<{ path: string }> {
    const visit = await this.requireVisit(user, visitId);
    if (visit.status !== 'APPROVED' || !visit.reviewedAt) {
      throw new ConflictException('The PDF is ready once the visit is signed off and ECCS has approved the report');
    }
    return { path: this.storage.signedPath(await this.reports.ensure(visit.id)) };
  }

  // ───────────────────────── Helpers ─────────────────────────

  /** Super Admin and Operations Manager: the people who run the diary. */
  private isEccsAdmin(user: AuthUser): boolean {
    return accessScope(user.memberships, 'jobs')?.kind === 'all' && can(user.memberships, 'jobs', 'create');
  }

  private maySignOff(user: AuthUser, visit: VisitRow): boolean {
    const restaurantRoles = user.memberships.filter((m) => !isEccsRole(m.role));
    return can(restaurantRoles, 'jobs', 'approve', {
      organizationId: visit.outlet.organizationId,
      outletId: visit.outletId,
    });
  }

  /** The Supervisor whose visit it is, or an ECCS admin standing in. */
  private mayRecord(user: AuthUser, visit: VisitRow): boolean {
    if (!can(user.memberships, 'jobs', 'update')) return false;
    return this.isEccsAdmin(user) || visit.supervisorId === user.id;
  }

  private requireRecorder(user: AuthUser, visit: VisitRow) {
    if (!this.mayRecord(user, visit)) throw new ForbiddenException('This visit is not assigned to you');
  }

  private async requireInProgress(user: AuthUser, visitId: string): Promise<VisitDetailRow> {
    const visit = await this.requireVisit(user, visitId);
    this.requireRecorder(user, visit);
    if (visit.status === 'SCHEDULED' || visit.status === 'ASSIGNED') {
      throw new ConflictException('Check in at the outlet first');
    }
    if (visit.status !== 'IN_PROGRESS') throw new ConflictException('This visit is finished and can no longer be changed');
    return visit;
  }

  private requireUpcomingDate(date: string, maxDaysAhead = 365) {
    const today = indiaDate();
    if (date < today) throw new BadRequestException('Choose today or a later date');
    const latest = new Date(toDbDate(today).getTime() + maxDaysAhead * 86_400_000);
    if (toDbDate(date) > latest) throw new BadRequestException(`Choose a date within the next ${maxDaysAhead} days`);
  }

  private async requireSupervisor(supervisorId: string | null | undefined): Promise<string | null> {
    if (!supervisorId) return null;
    const person = await this.db.user.findFirst({
      where: { id: supervisorId, isActive: true, memberships: { some: { role: 'SUPERVISOR' } } },
      select: { id: true },
    });
    if (!person) throw new BadRequestException('Choose one of the Supervisors');
    return person.id;
  }

  /** Loads a visit if the user may see it. "Not found" and "not yours" look the same. */
  private async requireVisit(user: AuthUser, visitId: string): Promise<VisitDetailRow> {
    const visit = await this.db.job.findUnique({ where: { id: visitId }, include: visitDetailInclude });
    if (!visit) throw new NotFoundException('Visit not found');
    let allowed = can(user.memberships, 'jobs', 'read', {
      organizationId: visit.outlet.organizationId,
      outletId: visit.outletId,
    });
    if (allowed && accessScope(user.memberships, 'jobs')?.kind === 'assigned') allowed = visit.supervisorId === user.id;
    if (!allowed) throw new NotFoundException('Visit not found');
    return visit;
  }

  private async requireBooking(user: AuthUser, bookingId: string, action: 'read' | 'update' = 'read') {
    const booking = await this.db.booking.findUnique({
      where: { id: bookingId },
      include: {
        outlet: { select: { organizationId: true } },
        catalogItem: { select: { serviceTypeId: true } },
        job: { select: { id: true, status: true, supervisorId: true } },
      },
    });
    if (!booking) throw new NotFoundException('Booking not found');
    let allowed = can(user.memberships, 'bookings', action, {
      organizationId: booking.outlet.organizationId,
      outletId: booking.outletId,
    });
    if (allowed && accessScope(user.memberships, 'bookings')?.kind === 'assigned') {
      allowed = booking.job?.supervisorId === user.id;
    }
    if (!allowed) throw new NotFoundException('Booking not found');
    return booking;
  }

  private async getBooking(bookingId: string): Promise<BookingDto> {
    const booking = await this.db.booking.findUniqueOrThrow({ where: { id: bookingId }, include: bookingInclude });
    return toBookingDto(booking, await this.userNames([booking.requestedById]));
  }

  private async userNames(ids: string[]): Promise<Map<string, string>> {
    const people = await this.db.user.findMany({ where: { id: { in: [...new Set(ids)] } }, select: { id: true, name: true } });
    return new Map(people.map((person) => [person.id, person.name]));
  }

  private toDto(user: AuthUser, visit: VisitDetailRow, documents: VisitDocumentDto[]): VisitDto {
    const answers = new Map(visit.taskResponses.map((response) => [response.itemId, response]));
    const ahead = visit.status === 'SCHEDULED' || visit.status === 'ASSIGNED';
    const inReview = visit.status === 'APPROVED' && !visit.reviewedAt;
    const forRestaurant = !user.memberships.some((m) => isEccsRole(m.role));
    return {
      ...toSummary(visit, forRestaurant),
      technicianNames: visit.technicianNames,
      checkInAt: visit.checkInAt?.toISOString() ?? null,
      completedAt: visit.completedAt?.toISOString() ?? null,
      notes: visit.notes,
      tasks: visitTasks(visit).map((item) => {
        const answer = answers.get(item.id);
        return {
          itemId: item.id,
          label: item.label as LocalizedText,
          done: answer?.valueBool ?? null,
          note: answer?.note ?? null,
          reading: item.type === 'NUMBER' ? { value: answer?.valueNumber ?? null, limit: item.maxValue } : null,
        };
      }),
      photos: visit.attachments.map((photo) => ({
        id: photo.id,
        kind: photo.kind as VisitPhotoKind,
        path: this.storage.signedPath(photo.id),
        // Reasons for doubt are for the ECCS office only: not the restaurant, and not the Supervisor who took the photo.
        ...(this.isEccsAdmin(user) && photo.doubtful && { flags: readPhotoFlags(photo.integrityFlags) }),
      })),
      signOff: visit.signOff
        ? {
            name: visit.signOff.signerName,
            role: visit.signOff.signerRole,
            signedAt: visit.signOff.signedAt.toISOString(),
            rating: visit.signOff.rating,
            comment: visit.signOff.comment,
          }
        : null,
      canRecord: (ahead || visit.status === 'IN_PROGRESS') && this.mayRecord(user, visit),
      canSignOff: visit.status === 'COMPLETED' && this.maySignOff(user, visit),
      correctionNote: forRestaurant ? null : visit.reviewNote,
      canReview: inReview && this.isEccsAdmin(user),
      canManage: ahead && this.isEccsAdmin(user),
      ...(visit.status === 'IN_PROGRESS' && visit.outlet.latitude === null && this.mayRecord(user, visit) && { canSetOutletLocation: true }),
      certificate:
        visit.certificates[0] && can(user.memberships, 'reports', 'read') ? toVisitCertificate(visit.certificates[0]) : null,
      partnerDelivered: visit.serviceType.partnerDelivered,
      partnerName: visit.partnerName,
      documents,
      canAttachDocument: this.mayAttachDocument(user, visit),
    };
  }
}

/**
 * Where the visit stands, as the person asking sees it. Signed off but not yet
 * approved by ECCS is its own stage. A visit ECCS sent back for correction after
 * sign-off is "under way" again for ECCS, but for the restaurant, who has nothing
 * more to do, it is still with ECCS.
 */
function visitStage(visit: VisitRow, forRestaurant: boolean): VisitStatus {
  if (visit.status === 'APPROVED' && !visit.reviewedAt) return 'IN_REVIEW';
  if (visit.status === 'IN_PROGRESS' && visit.signOff && forRestaurant) return 'IN_REVIEW';
  return visit.status as VisitStatus;
}

function toSummary(visit: VisitRow, forRestaurant: boolean): VisitSummaryDto {
  return {
    id: visit.id,
    outletId: visit.outletId,
    outletName: visit.outlet.name,
    outletAddress: [visit.outlet.address, visit.outlet.city].filter(Boolean).join(', ') || null,
    organizationName: visit.outlet.organization.name,
    serviceCode: visit.serviceType.code,
    serviceName: visit.serviceType.name as LocalizedText,
    date: fromDbDate(visit.scheduledDate),
    slot: toSlot(visit.scheduledSlot),
    status: visitStage(visit, forRestaurant),
    supervisorId: visit.supervisor?.id ?? null,
    supervisorName: visit.supervisor?.name ?? null,
    booked: visit.bookingId !== null,
    fromPlan: visit.scheduleId !== null,
    reportNumber: visit.serviceReport?.number ?? null,
  };
}

function toBookingDto(booking: BookingRow, names: Map<string, string>): BookingDto {
  // A cancelled visit is no longer where the booking stands.
  const visit = booking.job && booking.job.status !== 'CANCELLED' ? booking.job : null;
  return {
    id: booking.id,
    outletId: booking.outletId,
    outletName: booking.outlet.name,
    organizationName: booking.outlet.organization.name,
    serviceName: booking.catalogItem.name as LocalizedText,
    pricePaise: booking.catalogItem.pricePaise,
    preferredDate: fromDbDate(booking.preferredDate),
    preferredSlot: toSlot(booking.preferredSlot),
    notes: booking.notes,
    status: booking.status,
    requestedByName: names.get(booking.requestedById) ?? '',
    createdAt: booking.createdAt.toISOString(),
    visitId: visit?.id ?? null,
    visitDate: visit ? fromDbDate(visit.scheduledDate) : null,
    visitSlot: visit ? toSlot(visit.scheduledSlot) : null,
  };
}

// A phone can do things with no signal and send them later, so it says when each was
// really done. Its clock is believed unless it is ahead of ours by more than this.
const PHONE_CLOCK_AHEAD_MS = 5 * 60_000;

/** The time the phone says something was done; our own time if it gave none or its clock is ahead. */
export function phoneTime(at: string | undefined, now = new Date()): Date {
  const said = at ? Date.parse(at) : Number.NaN;
  return Number.isNaN(said) || said > now.getTime() + PHONE_CLOCK_AHEAD_MS ? now : new Date(said);
}

/** True when a time we stored is the very one the phone is sending again: the same action, repeated. */
export function sameMoment(stored: Date | null, at: string | undefined): boolean {
  return stored !== null && at !== undefined && stored.getTime() === Date.parse(at);
}

/** Distance between two points on the ground, in whole metres. */
function metresBetween(latA: number, lonA: number, latB: number, lonB: number): number {
  const radians = (degrees: number) => (degrees * Math.PI) / 180;
  const a =
    Math.sin(radians(latB - latA) / 2) ** 2 +
    Math.cos(radians(latA)) * Math.cos(radians(latB)) * Math.sin(radians(lonB - lonA) / 2) ** 2;
  return Math.round(6_371_000 * 2 * Math.asin(Math.sqrt(a)));
}
