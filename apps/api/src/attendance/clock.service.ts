import { createHash, createHmac, randomUUID } from 'node:crypto';
import { BadRequestException, ForbiddenException, HttpStatus, Injectable } from '@nestjs/common';
import {
  ATTENDANCE_ERROR,
  AUTH_ERROR,
  FACE_RULES,
  clockAssistedSchema,
  decideMatch,
  nextPunchKind,
  withinRepeatGuard,
  type ClockIdentifyDto,
  type ClockPunchResultDto,
  type ClockRosterDto,
  type MatchResult,
  type PunchFlag,
} from '@eccs/shared';
import { safeEqualHex } from '../auth/auth.crypto.js';
import { AuthService } from '../auth/auth.service.js';
import { env } from '../config/env.js';
import { PrismaService } from '../prisma/prisma.service.js';
import { sniffFile } from '../storage/attachments.controller.js';
import { AttendanceClock } from './attendance-clock.js';
import { attendanceError, photoError } from './attendance.errors.js';
import { AttendanceService } from './attendance.service.js';
import { FaceService, withPhotoNumber } from './face.service.js';
import { cosine, headTurn } from './face/face-math.js';

type Thumbnail = { buffer: Buffer; mimeType: string; extension: string };

/** What "identify" found, held in the server's memory until the person confirms or two minutes pass. */
interface PendingScan {
  deviceId: string;
  outletId: string;
  staffId: string;
  result: MatchResult;
  score: number;
  secondScore: number | null;
  /** True when a second "turned head" photo was sent and did not show a real turn of the same face. */
  possibleSpoof: boolean;
  thumbnail: Thumbnail | null;
  expiresAt: number;
}

interface TicketBody {
  /** The scan this ticket stands for. */
  id: string;
  /** The linked phone it was given to. */
  d: string;
  /** The person it names. */
  s: string;
  /** A fingerprint of the photo it was given for. */
  p: string;
  /** When it stops working, in milliseconds since 1970. */
  e: number;
}

/**
 * Clocking in and out on the outlet's linked phone, with nobody logged in.
 *
 * Who is asking is settled by the phone's device token alone, exactly as the
 * PIN screen trusts a linked phone: the token says which outlet the phone
 * belongs to, and a face is only ever compared with that outlet's staff.
 *
 * Two steps, so that a wrong guess never marks anyone: "identify" looks at the
 * photo and answers who it thinks it is, with a ticket; "confirm" hands the
 * ticket back and only then is the punch written, at the server's own time.
 *
 * Tickets and the scans behind them are kept in this server's memory for their
 * two minutes. That is right for one server; if the API is ever run as several
 * copies behind a load balancer, they must move to the database or a shared
 * cache, or a confirm may reach a copy that never saw the identify.
 */
@Injectable()
export class ClockService {
  private readonly pending = new Map<string, PendingScan>();
  /** Tickets already confirmed, kept until they would have expired anyway, to tell "used" from "never existed". */
  private readonly used = new Map<string, number>();
  /** When each phone last sent a scan, for the per-minute limit. */
  private readonly scans = new Map<string, number[]>();
  /** One punch at a time per person, so two confirms arriving together cannot both write a clock-in. */
  private readonly turns = new Map<string, Promise<unknown>>();

  constructor(
    private readonly prisma: PrismaService,
    private readonly auth: AuthService,
    private readonly face: FaceService,
    private readonly attendance: AttendanceService,
    private readonly clock: AttendanceClock,
  ) {}

  private get db() {
    return this.prisma.client;
  }

  // ───────────────────────── Who is it? ─────────────────────────

  /**
   * Looks at one photo and answers who it is, among the enrolled staff of the
   * phone's own outlet. Marks nothing.
   *
   * A second photo, taken after "turn your head a little", is the first version
   * of a liveness check: the head must really have turned between the two, and
   * both must be the same face. A printed photo or a still picture on another
   * phone does not turn. This does NOT stop someone playing a video of the
   * person turning their head; it only raises the effort. A failed check does
   * not refuse the punch: it is recorded and marked POSSIBLE_SPOOF, with its
   * photo, for the Owner to look at.
   */
  async identify(deviceToken: unknown, photo: Buffer | undefined, secondPhoto: Buffer | undefined): Promise<ClockIdentifyDto> {
    const device = await this.requireDevice(deviceToken);
    this.countScan(device.id);
    this.face.requireEngine();
    if (!photo) throw new BadRequestException('A photo is required');

    const first = await this.face.readFace(photo);
    let possibleSpoof = false;
    if (secondPhoto) {
      let second;
      try {
        second = await this.face.readFace(secondPhoto);
      } catch (error) {
        // The app is told it was the second photo, so it asks for that one again.
        throw withPhotoNumber(error, 2);
      }
      const turned = Math.abs(headTurn(first.face.landmarks) - headTurn(second.face.landmarks)) >= FACE_RULES.livenessMinTurn;
      const samePerson = cosine(first.template, second.template) >= FACE_RULES.matchThreshold;
      possibleSpoof = !turned || !samePerson;
    }

    const gallery = await this.face.gallery(device.outletId);
    const decision = decideMatch(this.face.scores(gallery, first.template));
    if (!decision.best) {
      return { result: 'NO_MATCH', candidate: null, nextKind: null, lastPunchAt: null, lastPunchKind: null, already: false, ticket: null, ticketExpiresAt: null, enrolledHere: gallery.length };
    }

    const who = decision.best.who;
    const now = this.clock.now();
    const punches = await this.attendance.dayPunches(who.staffId, this.clock.day());
    const last = punches.at(-1) ?? null;
    const already = last !== null && withinRepeatGuard(last.at.getTime(), now.getTime());

    this.forgetExpired(now.getTime());
    const id = randomUUID();
    const expiresAt = now.getTime() + FACE_RULES.ticketSeconds * 1000;
    this.pending.set(id, {
      deviceId: device.id,
      outletId: device.outletId,
      staffId: who.staffId,
      result: decision.result,
      score: decision.best.score,
      secondScore: decision.secondScore,
      possibleSpoof,
      thumbnail: await this.face.thumbnail(photo),
      expiresAt,
    });
    const ticket = this.sign({ id, d: device.id, s: who.staffId, p: createHash('sha256').update(photo).digest('hex').slice(0, 32), e: expiresAt });

    return {
      result: decision.result,
      candidate: { staffId: who.staffId, name: who.name },
      nextKind: already ? last.kind : nextPunchKind(punches.map((punch) => ({ at: punch.at.getTime(), kind: punch.kind }))),
      lastPunchAt: last?.at.toISOString() ?? null,
      lastPunchKind: last?.kind ?? null,
      already,
      ticket,
      ticketExpiresAt: new Date(expiresAt).toISOString(),
      enrolledHere: gallery.length,
    };
  }

  /**
   * The person tapped "Yes, that's me": the punch is written. Clock-in or
   * clock-out is decided here, from their last punch of the attendance day. An
   * unsure match may be confirmed too; its punch is marked for the Owner.
   */
  async confirm(deviceToken: string, ticket: string): Promise<ClockPunchResultDto> {
    const device = await this.requireDevice(deviceToken);
    const now = this.clock.now().getTime();
    const body = this.readTicket(ticket);
    const invalid = () => attendanceError(HttpStatus.BAD_REQUEST, ATTENDANCE_ERROR.ticketInvalid, 'That scan cannot be used. Scan your face again.');
    if (!body || body.d !== device.id) throw invalid();
    if (this.used.has(body.id)) throw attendanceError(HttpStatus.CONFLICT, ATTENDANCE_ERROR.ticketUsed, 'That scan has already been used.');
    if (body.e <= now) throw attendanceError(HttpStatus.GONE, ATTENDANCE_ERROR.ticketExpired, 'That took too long. Scan your face again.');
    const scan = this.pending.get(body.id);
    // Signed by this server but not in its memory: the server was restarted in the last two minutes.
    if (!scan || scan.deviceId !== device.id || scan.staffId !== body.s) throw invalid();
    this.pending.delete(body.id);
    this.used.set(body.id, body.e);

    const flag: PunchFlag | null = scan.possibleSpoof ? 'POSSIBLE_SPOOF' : scan.result === 'UNSURE' ? 'UNSURE_MATCH' : null;
    return this.punch(device, scan.staffId, {
      method: 'FACE',
      flag,
      score: scan.score,
      secondScore: scan.secondScore,
      thumbnail: scan.thumbnail,
      createdById: null,
      reviewedById: null,
    });
  }

  // ───────────────────────── The assisted route ─────────────────────────

  /**
   * The only way to clock in without a face: the Owner, or a Manager of this
   * outlet, types their own PIN to vouch that the person is there. For someone
   * who is not enrolled (or will not be, or is under 18), and for when the
   * camera or the face models fail. The punch is marked ASSISTED and carries
   * who vouched. A wrong PIN counts towards the phone's lock exactly as on the
   * PIN screen.
   */
  async assisted(fields: unknown, photo: Buffer | undefined): Promise<ClockPunchResultDto> {
    const parsed = clockAssistedSchema.safeParse(fields);
    if (!parsed.success) throw new BadRequestException(parsed.error.issues[0]?.message ?? 'Invalid request');
    const device = await this.requireDevice(parsed.data.deviceToken);
    this.countScan(device.id);

    const approver = await this.auth.checkPin(device, parsed.data.approverPin);
    const isOwner = approver.memberships.some((membership) => membership.role === 'OWNER' && membership.organizationId === device.organizationId);
    const isManager = approver.memberships.some((membership) => membership.role === 'MANAGER' && membership.outletId === device.outletId);
    if (!isOwner && !isManager) {
      throw attendanceError(HttpStatus.FORBIDDEN, ATTENDANCE_ERROR.approverNotAllowed, 'Only the owner or a manager of this outlet can clock someone in.');
    }

    let thumbnail: Thumbnail | null = null;
    if (photo) {
      if (photo.length > FACE_RULES.maxPhotoBytes) throw photoError(ATTENDANCE_ERROR.photoTooLarge, 'That photo is too large');
      if (!sniffFile(photo, false)) throw photoError(ATTENDANCE_ERROR.photoUnreadable, 'That photo could not be read. Take it again.');
      thumbnail = await this.face.thumbnail(photo);
    }
    return this.punch(device, parsed.data.staffId, {
      method: 'ASSISTED',
      flag: 'ASSISTED',
      score: null,
      secondScore: null,
      thumbnail,
      createdById: approver.id,
      // The Owner vouching is the Owner having seen it; a Manager's assisted punch waits for the Owner's review.
      reviewedById: isOwner ? approver.id : null,
    });
  }

  /** The outlet's working staff, for the name picker of the assisted route. Names and job titles only. */
  async roster(deviceToken: unknown): Promise<ClockRosterDto> {
    const device = await this.requireDevice(deviceToken);
    const people = await this.db.staffMember.findMany({
      where: { outletId: device.outletId, isActive: true },
      select: { id: true, name: true, jobTitle: true },
      orderBy: { name: 'asc' },
    });
    const enrolled = await this.face.enrolledAmong(people.map((person) => person.id));
    return {
      outletId: device.outletId,
      outletName: device.outletName,
      faceReady: this.face.ready,
      people: people.map((person) => ({ staffId: person.id, name: person.name, jobTitle: person.jobTitle, enrolled: enrolled.has(person.id) })),
    };
  }

  // ───────────────────────── Writing the punch ─────────────────────────

  private punch(
    device: { id: string; outletId: string },
    staffId: string,
    how: {
      method: 'FACE' | 'ASSISTED';
      flag: PunchFlag | null;
      score: number | null;
      secondScore: number | null;
      thumbnail: Thumbnail | null;
      createdById: string | null;
      reviewedById: string | null;
    },
  ): Promise<ClockPunchResultDto> {
    return this.inTurn(staffId, async () => {
      const staff = await this.db.staffMember.findFirst({ where: { id: staffId, outletId: device.outletId, isActive: true } });
      if (!staff) throw attendanceError(HttpStatus.BAD_REQUEST, ATTENDANCE_ERROR.notOnStaff, 'That person is not on the staff of this outlet.');

      const now = this.clock.now();
      const day = this.clock.day();
      const punches = await this.attendance.dayPunches(staff.id, day);
      const last = punches.at(-1);
      // A second scan moments after the first is the same person making sure; it records nothing new.
      const repeat = last && withinRepeatGuard(last.at.getTime(), now.getTime()) ? last : null;
      const row =
        repeat ??
        (await this.attendance.recordPunch(staff, {
          at: now,
          kind: nextPunchKind(punches.map((punch) => ({ at: punch.at.getTime(), kind: punch.kind }))),
          method: how.method,
          flag: how.flag,
          score: how.score,
          secondScore: how.secondScore,
          deviceId: device.id,
          photoId: how.thumbnail ? await this.attendance.savePhoto(device.outletId, how.thumbnail, now) : null,
          createdById: how.createdById,
          reviewedById: how.reviewedById,
        }));
      const summary = await this.attendance.summaryNow(staff, day);
      return {
        result: repeat ? 'ALREADY' : 'RECORDED',
        punchId: row.id,
        staffId: staff.id,
        name: staff.name,
        kind: row.kind,
        at: row.at.toISOString(),
        day,
        workedMinutesToday: summary.workedMinutes ?? 0,
        flag: row.flag,
      };
    });
  }

  private inTurn<T>(staffId: string, work: () => Promise<T>): Promise<T> {
    const result = (this.turns.get(staffId) ?? Promise.resolve()).then(work, work);
    const settled = result.catch(() => undefined);
    this.turns.set(staffId, settled);
    void settled.then(() => {
      if (this.turns.get(staffId) === settled) this.turns.delete(staffId);
    });
    return result;
  }

  // ───────────────────────── The phone ─────────────────────────

  /** The linked phone behind a device token, which must belong to one outlet that is still active. */
  private async requireDevice(deviceToken: unknown) {
    const device = await this.auth.requireLinkedDevice(typeof deviceToken === 'string' ? deviceToken : '');
    if (!device.outletId) {
      throw attendanceError(
        HttpStatus.BAD_REQUEST,
        ATTENDANCE_ERROR.deviceHasNoOutlet,
        'This phone is linked to the restaurant as a whole, not to one outlet. Clock in on the phone kept at the outlet.',
      );
    }
    const outlet = await this.db.outlet.findUnique({ where: { id: device.outletId }, select: { name: true, isActive: true, organization: { select: { isActive: true } } } });
    if (!outlet?.isActive || !outlet.organization.isActive) {
      throw new ForbiddenException({ code: AUTH_ERROR.restaurantInactive, message: 'This restaurant is not active with ECCS at the moment. Please call ECCS.' });
    }
    return { ...device, outletId: device.outletId, outletName: outlet.name };
  }

  /** At most thirty scans a minute from one phone: far more than a queue at the door needs, far fewer than guessing would. */
  private countScan(deviceId: string): void {
    const now = this.clock.now().getTime();
    const recent = (this.scans.get(deviceId) ?? []).filter((at) => at > now - 60_000 && at <= now);
    if (recent.length >= FACE_RULES.identifyPerMinute) {
      this.scans.set(deviceId, recent);
      throw attendanceError(HttpStatus.TOO_MANY_REQUESTS, ATTENDANCE_ERROR.tooManyScans, 'Too many scans from this phone. Wait a minute and try again.');
    }
    recent.push(now);
    this.scans.set(deviceId, recent);
  }

  // ───────────────────────── Tickets ─────────────────────────

  /** The ticket is its facts plus this server's signature over them, so the phone cannot alter who or when. */
  private sign(body: TicketBody): string {
    const text = Buffer.from(JSON.stringify(body)).toString('base64url');
    return `${text}.${this.signature(text)}`;
  }

  private readTicket(ticket: string): TicketBody | null {
    const [text, signature, ...rest] = ticket.split('.');
    if (!text || !signature || rest.length > 0 || !/^[0-9a-f]{64}$/.test(signature)) return null;
    if (!safeEqualHex(this.signature(text), signature)) return null;
    try {
      const body = JSON.parse(Buffer.from(text, 'base64url').toString('utf8')) as TicketBody;
      return typeof body.id === 'string' && typeof body.d === 'string' && typeof body.s === 'string' && typeof body.e === 'number' ? body : null;
    } catch {
      return null;
    }
  }

  private signature(text: string): string {
    // The same server secret that signs photo links, under its own label so the two can never be swapped.
    return createHmac('sha256', env.FILE_URL_SECRET).update(`clock-ticket:${text}`).digest('hex');
  }

  private forgetExpired(now: number): void {
    for (const [id, scan] of this.pending) if (scan.expiresAt <= now) this.pending.delete(id);
    for (const [id, expiresAt] of this.used) if (expiresAt <= now) this.used.delete(id);
  }
}
