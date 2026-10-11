import { BadRequestException, ForbiddenException, HttpException, HttpStatus, Inject, Injectable, Logger, NotFoundException } from '@nestjs/common';
import { ATTENDANCE_ERROR, FACE_RULES, can, faceConsentSchema, type FaceStatusDto } from '@eccs/shared';
import type { AuthUser } from '../auth/auth.types.js';
import { PrismaService } from '../prisma/prisma.service.js';
import { sniffFile } from '../storage/attachments.controller.js';
import { AttendanceClock } from './attendance-clock.js';
import { attendanceError, engineUnavailable, photoError } from './attendance.errors.js';
import { AuditTrailService } from './audit-trail.service.js';
import { FACE_ENGINE, UnreadablePhotoError, type DetectedFace, type FaceEngine } from './face/face-engine.js';
import { cosine } from './face/face-math.js';
import { TemplateVault } from './face/template-vault.js';

/** A face darker than this (average brightness, 0 to 255) is not judged: the photo is asked for again. */
const MIN_BRIGHTNESS = 40;
/** A second face counts as "someone else in the photo" when it is at least this share of the main face's width. Someone small in the background does not. */
const RIVAL_FACE_SHARE = 0.5;
/** The employee's "I agree" must have been tapped within this long before the enrolment reaches the server. */
const CONSENT_MAX_AGE_MS = 24 * 60 * 60 * 1000;
/** A phone's clock may run a little ahead of the server's. */
const CLOCK_SLACK_MS = 10 * 60 * 1000;

export interface ReadFace {
  face: DetectedFace;
  /** The face's template, one unit long. Held in memory only. */
  template: Float32Array;
}

/** One enrolled person of an outlet, with their templates unlocked, for comparing. Never leaves the server's memory. */
export interface GalleryPerson {
  staffId: string;
  name: string;
  templates: Float32Array[];
}

export type FaceEndReason = 'WITHDRAWN' | 'LEFT' | 'REENROLLED';

/**
 * Faces: enrolling a person (with their consent), forgetting them again, and
 * comparing a photo with the enrolled staff of one outlet.
 *
 * What is kept is a template per enrolment photo, encrypted, never the photo.
 * Nothing here ever compares across outlets, and no template is ever sent to
 * an app.
 */
@Injectable()
export class FaceService {
  private readonly logger = new Logger(FaceService.name);
  private readonly vault = new TemplateVault();

  constructor(
    private readonly prisma: PrismaService,
    @Inject(FACE_ENGINE) private readonly engine: FaceEngine,
    private readonly clock: AttendanceClock,
    private readonly audit: AuditTrailService,
  ) {}

  private get db() {
    return this.prisma.client;
  }

  /** False when faces cannot be recognised just now (the model files are missing): only the assisted route works. */
  get ready(): boolean {
    return this.engine.ready;
  }

  requireEngine(): void {
    if (!this.engine.ready) throw engineUnavailable(this.engine.reason);
  }

  // ───────────────────────── Reading a photo ─────────────────────────

  /**
   * Finds the one face in a photo and makes its template, or says what is wrong
   * with the photo in a way the app can show ("come closer", "more light").
   * For a punch, a small face in the background is ignored; for enrolment
   * (`alone`) the person must be the only face in the photo.
   */
  async readFace(photo: Buffer, alone = false): Promise<ReadFace> {
    this.requireEngine();
    if (photo.length > FACE_RULES.maxPhotoBytes) throw photoError(ATTENDANCE_ERROR.photoTooLarge, 'That photo is too large');
    if (!sniffFile(photo, false)) throw photoError(ATTENDANCE_ERROR.photoUnreadable, 'That photo could not be read. Take it again.');

    let analysis;
    try {
      analysis = await this.engine.analyse(photo);
    } catch (error) {
      if (error instanceof UnreadablePhotoError) throw photoError(ATTENDANCE_ERROR.photoUnreadable, 'That photo could not be read. Take it again.');
      throw error;
    }
    const face = analysis.faces[0];
    if (!face) throw photoError(ATTENDANCE_ERROR.noFace, 'No face was found. Look straight at the camera.');
    const others = analysis.faces.slice(1).filter((other) => alone || other.box.width >= face.box.width * RIVAL_FACE_SHARE);
    if (others.length > 0) throw photoError(ATTENDANCE_ERROR.manyFaces, 'More than one face is in the photo. One person at a time.');
    if (face.box.width < FACE_RULES.minFacePixels) throw photoError(ATTENDANCE_ERROR.faceTooSmall, 'Come closer to the camera.');
    if (face.brightness < MIN_BRIGHTNESS || face.sharpness < this.engine.minSharpness) {
      throw photoError(ATTENDANCE_ERROR.tooDarkOrBlurred, 'The photo is too dark or blurred. Move to the light, hold still and try again.');
    }
    return { face, template: await analysis.embed(face) };
  }

  /** The small copy of a punch photo that is kept. Falls back to the photo as sent when the engine cannot make one. */
  async thumbnail(photo: Buffer): Promise<{ buffer: Buffer; mimeType: string; extension: string } | null> {
    const sniffed = sniffFile(photo, false);
    if (!sniffed) return null;
    if (this.engine.ready) {
      try {
        return await this.engine.thumbnail(photo);
      } catch {
        // An unreadable picture is not worth failing a punch over; keep nothing.
        return null;
      }
    }
    return { buffer: photo, ...sniffed };
  }

  // ───────────────────────── Comparing ─────────────────────────

  /** The enrolled, still-working staff of ONE outlet, with their templates unlocked. */
  async gallery(outletId: string, exceptStaffId?: string): Promise<GalleryPerson[]> {
    const rows = await this.db.faceTemplate.findMany({
      where: {
        // Templates from another model cannot be compared with this one's, so they are left out.
        modelId: this.engine.modelId,
        staffMember: { outletId, isActive: true, ...(exceptStaffId && { id: { not: exceptStaffId } }) },
      },
      select: { vector: true, staffMember: { select: { id: true, name: true } } },
    });
    const people = new Map<string, GalleryPerson>();
    for (const row of rows) {
      let template: Float32Array;
      try {
        template = this.vault.open(row.vector, row.staffMember.id);
      } catch {
        // Locked with another key, or damaged. The person will not be recognised until they enrol again.
        this.logger.warn(`A face template of staff member ${row.staffMember.id} could not be opened. Was FACE_TEMPLATE_KEY changed?`);
        continue;
      }
      const person = people.get(row.staffMember.id) ?? { staffId: row.staffMember.id, name: row.staffMember.name, templates: [] };
      person.templates.push(template);
      people.set(person.staffId, person);
    }
    return [...people.values()];
  }

  /** How alike a face is to each person: the best of that person's templates. */
  scores(gallery: readonly GalleryPerson[], template: Float32Array): { who: GalleryPerson; score: number }[] {
    return gallery.map((who) => ({ who, score: Math.max(...who.templates.map((own) => cosine(own, template))) }));
  }

  /** Which of these people have a face enrolled. */
  async enrolledAmong(staffIds: string[]): Promise<Set<string>> {
    if (staffIds.length === 0) return new Set();
    const rows = await this.db.faceTemplate.findMany({
      where: { staffMemberId: { in: staffIds }, modelId: this.engine.modelId },
      select: { staffMemberId: true },
      distinct: ['staffMemberId'],
    });
    return new Set(rows.map((row) => row.staffMemberId));
  }

  // ───────────────────────── Enrolment, with consent ─────────────────────────

  /**
   * Enrols a person's face from 3 to 5 photos taken now (front, a little to the
   * left, a little to the right...). Only the Owner may do it, and only with the
   * employee's own consent in the same request. The photos are used to make the
   * templates and are then gone: they are never written anywhere.
   *
   * Enrolling again replaces the earlier templates and starts a new consent
   * record; the earlier record is kept, marked as ended.
   */
  async enrol(user: AuthUser, staffId: string, photos: Buffer[], consentText: unknown): Promise<FaceStatusDto> {
    const { row, organizationId } = await this.requireStaff(user, staffId, 'OWNER');
    if (!row.isActive) throw attendanceError(HttpStatus.BAD_REQUEST, ATTENDANCE_ERROR.notOnStaff, 'This person has left; their face cannot be enrolled');
    const consent = this.readConsent(consentText);
    this.requireEngine();
    if (photos.length < FACE_RULES.enrolMinPhotos || photos.length > FACE_RULES.enrolMaxPhotos) {
      throw new BadRequestException(`Send ${FACE_RULES.enrolMinPhotos} to ${FACE_RULES.enrolMaxPhotos} photos of the face`);
    }

    const read: ReadFace[] = [];
    for (const [index, photo] of photos.entries()) {
      try {
        read.push(await this.readFace(photo, true));
      } catch (error) {
        // Say which photo, so the app can ask for that one again.
        throw withPhotoNumber(error, index + 1);
      }
    }
    // All the photos must be of one person: each is compared with the first.
    for (const [index, face] of read.entries()) {
      if (cosine(face.template, read[0]!.template) < FACE_RULES.matchThreshold) {
        throw photoError(ATTENDANCE_ERROR.facesDiffer, 'The photos do not all look like the same person. Take them again.', { photo: index + 1 });
      }
    }

    // One person must not hold two identities at the outlet: if this face is
    // already enrolled as someone else, refuse and say who.
    const others = await this.gallery(row.outletId, row.id);
    let twin: { who: GalleryPerson; score: number } | null = null;
    for (const face of read) {
      for (const candidate of this.scores(others, face.template)) if (!twin || candidate.score > twin.score) twin = candidate;
    }
    if (twin && twin.score >= FACE_RULES.confidentThreshold) {
      throw attendanceError(HttpStatus.CONFLICT, ATTENDANCE_ERROR.faceAlreadyEnrolled, `This face is already enrolled as ${twin.who.name}.`, {
        staff: { staffId: twin.who.staffId, name: twin.who.name },
      });
    }

    const now = this.clock.now();
    await this.db.$transaction([
      this.db.faceConsent.updateMany({ where: { staffMemberId: row.id, endedAt: null }, data: { endedAt: now, endedReason: 'REENROLLED', endedById: user.id } }),
      this.db.faceTemplate.deleteMany({ where: { staffMemberId: row.id } }),
      this.db.faceConsent.create({
        data: {
          staffMemberId: row.id,
          version: consent.consentVersion,
          language: consent.language,
          acceptedAt: new Date(consent.acceptedAt),
          acceptedBy: consent.acceptedBy,
          recordedById: user.id,
          createdAt: now,
        },
      }),
      this.db.faceTemplate.createMany({
        data: read.map((face) => ({
          staffMemberId: row.id,
          vector: this.vault.seal(face.template, row.id),
          modelId: this.engine.modelId,
          quality: face.face.sharpness,
          createdAt: now,
        })),
      }),
    ]);
    await this.audit.write({
      actorId: user.id,
      action: 'face.enrol',
      entity: 'StaffMember',
      entityId: row.id,
      organizationId,
      details: { templates: read.length, consentVersion: consent.consentVersion, consentLanguage: consent.language, acceptedAt: consent.acceptedAt },
    });
    return this.statusOf(row.id);
  }

  /** Where a person's enrolment stands. For the Owner and the Manager. */
  async status(user: AuthUser, staffId: string): Promise<FaceStatusDto> {
    const { row } = await this.requireStaff(user, staffId, 'MANAGES');
    return this.statusOf(row.id);
  }

  /**
   * The employee withdraws consent (the Owner taps it for them). Every template
   * is deleted at once, and the person clocks in through the assisted route
   * from then on. Their attendance records stay.
   */
  async withdraw(user: AuthUser, staffId: string): Promise<FaceStatusDto> {
    const { row, organizationId } = await this.requireStaff(user, staffId, 'OWNER');
    const removed = await this.forget(row.id, 'WITHDRAWN', user.id);
    await this.audit.write({ actorId: user.id, action: 'face.withdraw', entity: 'StaffMember', entityId: row.id, organizationId, details: { templatesDeleted: removed } });
    return this.statusOf(row.id);
  }

  /** Deletes every template of a person and closes their consent record. Called on withdrawal, and when a person is marked as left. */
  async forget(staffId: string, reason: FaceEndReason, byUserId: string | null): Promise<number> {
    const now = this.clock.now();
    const [removed] = await this.db.$transaction([
      this.db.faceTemplate.deleteMany({ where: { staffMemberId: staffId } }),
      this.db.faceConsent.updateMany({ where: { staffMemberId: staffId, endedAt: null }, data: { endedAt: now, endedReason: reason, endedById: byUserId } }),
    ]);
    return removed.count;
  }

  private async statusOf(staffId: string): Promise<FaceStatusDto> {
    const [templates, consent] = await Promise.all([
      this.db.faceTemplate.count({ where: { staffMemberId: staffId, modelId: this.engine.modelId } }),
      this.db.faceConsent.findFirst({ where: { staffMemberId: staffId }, orderBy: { createdAt: 'desc' } }),
    ]);
    const enrolled = templates > 0;
    return {
      staffId,
      enrolled,
      templates,
      enrolledAt: enrolled && consent ? consent.createdAt.toISOString() : null,
      consentAt: consent ? consent.acceptedAt.toISOString() : null,
      consentVersion: consent?.version ?? null,
      consentLanguage: consent?.language ?? null,
      withdrawnAt: !enrolled && consent?.endedAt ? consent.endedAt.toISOString() : null,
    };
  }

  /** No consent, no enrolment: the request must carry the employee's own agreement, given just now. */
  private readConsent(text: unknown) {
    let raw: unknown = text;
    if (typeof text === 'string') {
      try {
        raw = JSON.parse(text);
      } catch {
        raw = null;
      }
    }
    const parsed = faceConsentSchema.safeParse(raw);
    const refuse = (message: string) => attendanceError(HttpStatus.BAD_REQUEST, ATTENDANCE_ERROR.consentRequired, message);
    if (!parsed.success) throw refuse("The employee's consent is required before their face can be enrolled");
    const age = this.clock.now().getTime() - Date.parse(parsed.data.acceptedAt);
    if (age > CONSENT_MAX_AGE_MS || age < -CLOCK_SLACK_MS) throw refuse('The consent must be given by the employee now, just before the photos are taken');
    return parsed.data;
  }

  /**
   * The person, if this user may act on their face. OWNER: the Owner of their
   * restaurant only. MANAGES: anyone who may change the outlet's staff (the
   * Owner and the Manager). "Not found" and "not yours" look the same.
   */
  private async requireStaff(user: AuthUser, staffId: string, need: 'OWNER' | 'MANAGES') {
    const row = await this.db.staffMember.findUnique({
      where: { id: staffId },
      select: { id: true, name: true, outletId: true, isActive: true, outlet: { select: { organizationId: true } } },
    });
    if (!row) throw new NotFoundException('Not found');
    const organizationId = row.outlet.organizationId;
    if (!can(user.memberships, 'staff', 'update', { organizationId, outletId: row.outletId })) throw new NotFoundException('Not found');
    if (need === 'OWNER' && !isOwnerOf(user, organizationId)) throw new ForbiddenException("Only the owner can enrol or remove a person's face");
    return { row, organizationId };
  }
}

/** True for the Owner of this restaurant. The Manager holds the same grants on staff, so the role itself is checked. */
export const isOwnerOf = (user: AuthUser, organizationId: string) =>
  user.memberships.some((membership) => membership.role === 'OWNER' && membership.organizationId === organizationId);

/** Adds "which photo" to a photo error, leaving any other error as it is. */
export function withPhotoNumber(error: unknown, photo: number): unknown {
  if (!(error instanceof HttpException) || error.getStatus() !== 400) return error;
  const body = error.getResponse();
  if (typeof body !== 'object' || !('code' in body)) return error;
  const { code, message } = body as { code: (typeof ATTENDANCE_ERROR)[keyof typeof ATTENDANCE_ERROR]; message: string };
  return photoError(code, message, { photo });
}
