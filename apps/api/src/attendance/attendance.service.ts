import { randomUUID } from 'node:crypto';
import type { Readable } from 'node:stream';
import { BadRequestException, ConflictException, ForbiddenException, HttpStatus, Injectable, Logger, NotFoundException, OnModuleDestroy, OnModuleInit } from '@nestjs/common';
import type { Prisma } from '@eccs/db';
import {
  ATTENDANCE_DAY_RULES,
  ATTENDANCE_ERROR,
  DAY_FLAGS_NEEDING_OWNER,
  FACE_RULES,
  attendanceDateVerdict,
  attendanceDayEnd,
  attendanceDayOf,
  attendanceDayStart,
  can,
  countedFromOf,
  earliestCorrectableDate,
  isMonth,
  monthBounds,
  monthOfDate,
  ownRecordLocked,
  shiftDate,
  summariseDay,
  weekdayOf,
  worksOn,
  type Action,
  type AttendanceDayCellDto,
  type AttendanceReviewDto,
  type AttendanceSettingsDto,
  type AttendanceStatus,
  type DayFlag,
  type DaySummary,
  type PunchDayDto,
  type PunchDto,
  type PunchFlag,
  type PunchKind,
  type PunchMethod,
  type ReviewDayDto,
  type RulePunch,
  type StaffPunchesDto,
} from '@eccs/shared';
import type { AuthUser } from '../auth/auth.types.js';
import { indiaDate } from '../checklists/checklists.service.js';
import { env } from '../config/env.js';
import { PrismaService } from '../prisma/prisma.service.js';
import { StorageService } from '../storage/storage.service.js';
import { AttendanceClock } from './attendance-clock.js';
import { attendanceError } from './attendance.errors.js';
import { AuditTrailService } from './audit-trail.service.js';

const toDbDate = (date: string) => new Date(`${date}T00:00:00.000Z`);
const fromDbDate = (date: Date) => date.toISOString().slice(0, 10);
const iso = (ms: number | null) => (ms === null ? null : new Date(ms).toISOString());

type PunchRow = Prisma.AttendancePunchGetPayload<object>;
type RecordRow = Prisma.AttendanceRecordGetPayload<object>;
/** What the working-out needs to know about a person. */
export interface PunchStaff {
  id: string;
  outletId: string;
  weeklyOffDay: number | null;
}
type StaffDates = PunchStaff & { name: string; joinedOn: Date | null; leftOn: Date | null; createdAt: Date };

/** A person's dates as the rules read them: counted from their joining date, or the day they were added when they have none. */
const datesOf = (person: { joinedOn: Date | null; leftOn: Date | null; createdAt: Date }) => ({
  joinedOn: countedFromOf({ joinedOn: person.joinedOn ? fromDbDate(person.joinedOn) : null, addedOn: attendanceDayOf(person.createdAt) }),
  leftOn: person.leftOn ? fromDbDate(person.leftOn) : null,
});

const toRule = (punch: PunchRow): RulePunch => ({ at: punch.at.getTime(), kind: punch.kind, flag: punch.flag });

/** How often days that have ended are settled, and old punch photos deleted, in the background. */
const CLOSE_DAYS_EVERY_MS = 30 * 60 * 1000;
const CLEAN_UP_EVERY_MS = 24 * 60 * 60 * 1000;
/** A read settles its outlet's ended days first, but not more often than this. */
const SETTLE_AT_MOST_EVERY_MS = 60 * 1000;

/** Punch flags the Owner is asked to look at. (NO_CLOCK_OUT is a matter for the day, not for one punch.) */
const PUNCH_FLAGS_FOR_REVIEW: PunchFlag[] = ['UNSURE_MATCH', 'POSSIBLE_SPOOF', 'ASSISTED', 'OFFLINE'];

/**
 * Punches, and the day's status that is worked out from them.
 *
 * The one rule to hold on to: AttendanceRecord is where a day's FINAL status
 * lives, and the salary arithmetic reads only that table. A row there is either
 * worked out from the punches (source PUNCHES; rewritten whenever a punch is
 * written, voided or added) or entered by the Owner (source OWNER; never
 * overwritten by the working-out). A punch is never deleted, only voided.
 */
@Injectable()
export class AttendanceService implements OnModuleInit, OnModuleDestroy {
  private readonly logger = new Logger(AttendanceService.name);
  private timers: NodeJS.Timeout[] = [];
  private readonly settledAt = new Map<string, { at: number; day: string }>();

  constructor(
    private readonly prisma: PrismaService,
    private readonly storage: StorageService,
    private readonly clock: AttendanceClock,
    private readonly audit: AuditTrailService,
  ) {}

  private get db() {
    return this.prisma.client;
  }

  /** Background work is off under tests: they call `closeDays` and `cleanUpPhotos` themselves. */
  onModuleInit() {
    if (env.NODE_ENV === 'test') return;
    const safely = (name: string, work: () => Promise<unknown>) => () => {
      work().catch((error: unknown) => this.logger.error(`${name} failed: ${String(error)}`));
    };
    const closeDays = safely('Settling ended attendance days', () => this.closeDays());
    const cleanUp = safely('Deleting old punch photos', () => this.cleanUpPhotos());
    this.timers = [setTimeout(closeDays, 40_000), setInterval(closeDays, CLOSE_DAYS_EVERY_MS), setTimeout(cleanUp, 70_000), setInterval(cleanUp, CLEAN_UP_EVERY_MS)];
    for (const timer of this.timers) timer.unref();
  }

  onModuleDestroy() {
    for (const timer of this.timers) clearTimeout(timer);
  }

  // ───────────────────────── Settings ─────────────────────────

  /** The outlet's full-day and half-day hours: the Owner's own figures, or the standard 8 and 4 hours. */
  async settingsOf(outletId: string) {
    const row = await this.db.attendanceSettings.findUnique({ where: { outletId } });
    return {
      fullDayMinutes: row?.fullDayMinutes ?? ATTENDANCE_DAY_RULES.fullDayMinutes,
      halfDayMinutes: row?.halfDayMinutes ?? ATTENDANCE_DAY_RULES.halfDayMinutes,
      // The days a month's salary is divided by: empty means the days in that month, as it always was.
      salaryDivisorDays: row?.salaryDivisorDays ?? null,
      isDefault: !row,
    };
  }

  async getSettings(user: AuthUser, outletId: string): Promise<AttendanceSettingsDto> {
    await this.requireOutlet(user, 'read', outletId);
    return { outletId, dayStartsAtHour: ATTENDANCE_DAY_RULES.dayStartsAtHour, ...(await this.settingsOf(outletId)) };
  }

  /**
   * The Owner changes what counts as a full day and a half day. Days already
   * worked out from punches, as far back as corrections reach, are worked out
   * again with the new figures; days the Owner set by hand are left alone.
   *
   * The days a month's salary is divided by is saved here too, when it is sent.
   * Nothing is rewritten for it: months that hold their own divisor keep it, and
   * open months are simply worked out with the new one the next time they are read.
   */
  async saveSettings(
    user: AuthUser,
    outletId: string,
    input: { fullDayMinutes: number; halfDayMinutes: number; salaryDivisorDays?: number | null | undefined },
  ): Promise<AttendanceSettingsDto> {
    const outlet = await this.requireOutlet(user, 'update', outletId);
    const before = await this.settingsOf(outletId);
    const hours = { fullDayMinutes: input.fullDayMinutes, halfDayMinutes: input.halfDayMinutes };
    // Left out by an app built before the setting existed: it then stays as it is.
    const divisor = input.salaryDivisorDays === undefined ? {} : { salaryDivisorDays: input.salaryDivisorDays };
    await this.db.attendanceSettings.upsert({
      where: { outletId },
      create: { outletId, ...hours, ...divisor, updatedById: user.id },
      update: { ...hours, ...divisor, updatedById: user.id },
    });
    await this.audit.write({
      actorId: user.id,
      action: 'attendance.settings.update',
      entity: 'Outlet',
      entityId: outletId,
      organizationId: outlet.organizationId,
      details: {
        before: { fullDayMinutes: before.fullDayMinutes, halfDayMinutes: before.halfDayMinutes, salaryDivisorDays: before.salaryDivisorDays },
        after: { ...hours, ...divisor },
      },
    });
    await this.closeDays(undefined, outletId);
    return this.getSettings(user, outletId);
  }

  // ───────────────────────── Punches ─────────────────────────

  /** A person's punches of one attendance day that still count (voided ones left out), oldest first. */
  dayPunches(staffId: string, day: string): Promise<PunchRow[]> {
    return this.db.attendancePunch.findMany({
      where: { staffMemberId: staffId, voidedAt: null, at: { gte: attendanceDayStart(day), lt: attendanceDayEnd(day) } },
      orderBy: { at: 'asc' },
    });
  }

  /** Writes one punch and works the person's day out again. The only place a punch is created. */
  async recordPunch(
    staff: PunchStaff,
    punch: {
      at: Date;
      kind: PunchKind;
      method: PunchMethod;
      flag: PunchFlag | null;
      score?: number | null;
      secondScore?: number | null;
      deviceId?: string | null;
      photoId?: string | null;
      note?: string | null;
      createdById?: string | null;
      /** Set when the Owner made or approved the punch themselves, so it does not then wait for the Owner's review. */
      reviewedById?: string | null;
    },
  ): Promise<PunchRow> {
    const row = await this.db.attendancePunch.create({
      data: {
        outletId: staff.outletId,
        staffMemberId: staff.id,
        at: punch.at,
        kind: punch.kind,
        method: punch.method,
        flag: punch.flag,
        score: punch.score ?? null,
        secondScore: punch.secondScore ?? null,
        deviceId: punch.deviceId ?? null,
        photoId: punch.photoId ?? null,
        note: punch.note ?? null,
        createdById: punch.createdById ?? null,
        createdAt: this.clock.now(),
        ...(punch.reviewedById && { reviewedById: punch.reviewedById, reviewedAt: this.clock.now() }),
      },
    });
    await this.rederive(staff, attendanceDayOf(punch.at));
    return row;
  }

  /** Stores the photo taken at a punch. Only the Owner and Manager can open it, and it is deleted after 35 days. */
  async savePhoto(outletId: string, photo: { buffer: Buffer; mimeType: string; extension: string }, at: Date): Promise<string> {
    const id = randomUUID();
    const month = String(at.getUTCMonth() + 1).padStart(2, '0');
    const storageKey = `outlets/${outletId}/punches/${at.getUTCFullYear()}/${month}/${id}.${photo.extension}`;
    await this.storage.put(storageKey, photo.buffer, photo.mimeType);
    await this.db.attachment.create({
      data: { id, outletId, kind: 'PUNCH', storageKey, mimeType: photo.mimeType, sizeBytes: photo.buffer.length, capturedAt: at, createdAt: at },
    });
    return id;
  }

  /** What the punches say about a person's day, right now. */
  async summaryNow(staff: PunchStaff, day: string): Promise<DaySummary> {
    const [punches, settings] = await Promise.all([this.dayPunches(staff.id, day), this.settingsOf(staff.outletId)]);
    return this.summarise(day, punches, settings, staff.weeklyOffDay);
  }

  private summarise(day: string, punches: PunchRow[], settings: { fullDayMinutes: number; halfDayMinutes: number }, weeklyOffDay: number | null): DaySummary {
    return summariseDay({
      day,
      now: this.clock.now(),
      punches: punches.map(toRule),
      fullDayMinutes: settings.fullDayMinutes,
      halfDayMinutes: settings.halfDayMinutes,
      usualDayOff: weeklyOffDay !== null && weekdayOf(day) === weeklyOffDay,
    });
  }

  /**
   * Works one person's day out from its punches and stores the answer, unless
   * the Owner has set that day by hand, in which case it is left exactly as the
   * Owner left it.
   */
  async rederive(staff: PunchStaff, day: string): Promise<void> {
    const date = toDbDate(day);
    const record = await this.db.attendanceRecord.findUnique({ where: { staffMemberId_date: { staffMemberId: staff.id, date } } });
    if (record?.source === 'OWNER') return;
    const punches = await this.dayPunches(staff.id, day);
    if (punches.length === 0) {
      // No punch is left on the day (the only one was voided, or the Owner's entry was taken away).
      // Whether "no punch" means absent is not decided here: `closeDays` holds the careful rules for
      // that (not before the outlet started using punches, not before the person joined), so the
      // worked-out row is dropped and the outlet's ended days are settled afresh.
      if (record) await this.db.attendanceRecord.delete({ where: { id: record.id } });
      await this.closeDays(this.clock.now(), staff.outletId);
      return;
    }
    const settings = await this.settingsOf(staff.outletId);
    await this.store(staff.id, day, record, this.summarise(day, punches, settings, staff.weeklyOffDay));
  }

  /** Brings the stored row for a day in line with what the punches say; writes nothing when it already is. */
  private async store(staffId: string, day: string, record: RecordRow | null, summary: DaySummary): Promise<boolean> {
    const date = toDbDate(day);
    if (summary.status === null) {
      if (!record) return false;
      await this.db.attendanceRecord.delete({ where: { id: record.id } });
      return true;
    }
    const same =
      record &&
      record.status === summary.status &&
      record.workedMinutes === summary.workedMinutes &&
      record.flags.length === summary.flags.length &&
      record.flags.every((flag, index) => flag === summary.flags[index]);
    if (same) return false;
    const worked = { status: summary.status, source: 'PUNCHES' as const, workedMinutes: summary.workedMinutes, flags: summary.flags, markedById: null, note: null };
    await this.db.attendanceRecord.upsert({
      where: { staffMemberId_date: { staffMemberId: staffId, date } },
      create: { staffMemberId: staffId, date, ...worked },
      update: worked,
    });
    return true;
  }

  // ───────────────────────── The Owner's corrections ─────────────────────────

  /**
   * The Owner sets one person's status for a day (leave, the weekly off, or a
   * correction), always with a reason. A null status takes the Owner's entry
   * away and the day goes back to what the punches say.
   */
  async correctDay(
    user: AuthUser,
    input: { outletId: string; staffId: string; date: string; status: AttendanceStatus | null; reason: string },
  ): Promise<void> {
    const outlet = await this.requireOutlet(user, 'update', input.outletId);
    this.requireOpenDay(input.date);
    const staff = await this.db.staffMember.findFirst({ where: { id: input.staffId, outletId: outlet.id } });
    if (!staff || !worksOn(datesOf(staff), input.date)) {
      throw new BadRequestException('That person was not on the staff of this outlet that day');
    }
    this.requireNotOwn(user, outlet.organizationId, staff);
    const date = toDbDate(input.date);
    const before = await this.db.attendanceRecord.findUnique({ where: { staffMemberId_date: { staffMemberId: staff.id, date } } });

    if (input.status === null) {
      // Only an entry the Owner made can be taken away; what the punches gave is not the Owner's to clear.
      if (before?.source === 'OWNER') {
        await this.db.attendanceRecord.delete({ where: { id: before.id } });
        await this.rederive(staff, input.date);
      }
    } else {
      const entry = { status: input.status, source: 'OWNER' as const, workedMinutes: null, flags: [], note: input.reason, markedById: user.id };
      await this.db.attendanceRecord.upsert({
        where: { staffMemberId_date: { staffMemberId: staff.id, date } },
        create: { staffMemberId: staff.id, date, ...entry },
        update: entry,
      });
    }
    await this.audit.write({
      actorId: user.id,
      action: 'attendance.day.correct',
      entity: 'StaffMember',
      entityId: staff.id,
      organizationId: outlet.organizationId,
      details: { date: input.date, before: before ? { status: before.status, source: before.source } : null, after: input.status, reason: input.reason },
    });
  }

  /** The Owner adds a punch the camera never recorded (someone forgot to clock out), with a reason. */
  async addPunch(user: AuthUser, input: { staffId: string; at: string; kind: PunchKind; reason: string }): Promise<PunchDto> {
    const staff = await this.db.staffMember.findUnique({ where: { id: input.staffId } });
    if (!staff) throw new NotFoundException('Not found');
    const outlet = await this.requireOutlet(user, 'create', staff.outletId, true);
    this.requireNotOwn(user, outlet.organizationId, staff);
    const at = new Date(input.at);
    if (at > this.clock.now()) throw new BadRequestException('A punch cannot be added for a time that has not come');
    const day = attendanceDayOf(at);
    this.requireOpenDay(day);
    if (!worksOn(datesOf(staff), day)) {
      throw new BadRequestException('That person was not on the staff of this outlet that day');
    }
    const punch = await this.recordPunch(staff, { at, kind: input.kind, method: 'CORRECTION', flag: null, note: input.reason, createdById: user.id, reviewedById: user.id });
    await this.audit.write({
      actorId: user.id,
      action: 'attendance.punch.add',
      entity: 'AttendancePunch',
      entityId: punch.id,
      organizationId: outlet.organizationId,
      details: { staffId: staff.id, at: at.toISOString(), kind: input.kind, reason: input.reason },
    });
    return (await this.toPunchDtos([punch], true))[0]!;
  }

  /** The Owner voids a wrong punch, with a reason. It stays on record, struck out, and no longer counts. */
  async voidPunch(user: AuthUser, punchId: string, reason: string): Promise<PunchDto> {
    const { punch, staff, outlet } = await this.requirePunch(user, 'update', punchId);
    this.requireNotOwn(user, outlet.organizationId, staff);
    if (punch.voidedAt) throw new ConflictException('That punch has already been voided');
    const day = attendanceDayOf(punch.at);
    this.requireOpenDay(day);
    const voided = await this.db.attendancePunch.update({
      where: { id: punch.id },
      data: { voidedAt: this.clock.now(), voidedById: user.id, voidReason: reason },
    });
    await this.rederive(staff, day);
    await this.audit.write({
      actorId: user.id,
      action: 'attendance.punch.void',
      entity: 'AttendancePunch',
      entityId: punch.id,
      organizationId: outlet.organizationId,
      details: { staffId: staff.id, at: punch.at.toISOString(), kind: punch.kind, method: punch.method, reason },
    });
    return (await this.toPunchDtos([voided], true))[0]!;
  }

  /** The Owner has looked at a marked punch (an unsure match, an assisted punch...) and lets it stand. */
  async reviewPunch(user: AuthUser, punchId: string): Promise<PunchDto> {
    const { punch, staff, outlet } = await this.requirePunch(user, 'update', punchId);
    this.requireNotOwn(user, outlet.organizationId, staff);
    const reviewed = punch.reviewedAt
      ? punch
      : await this.db.attendancePunch.update({ where: { id: punch.id }, data: { reviewedAt: this.clock.now(), reviewedById: user.id } });
    if (!punch.reviewedAt) {
      await this.audit.write({ actorId: user.id, action: 'attendance.punch.review', entity: 'AttendancePunch', entityId: punch.id, organizationId: outlet.organizationId, details: { flag: punch.flag } });
    }
    return (await this.toPunchDtos([reviewed], true))[0]!;
  }

  /** Corrections reach back to the start of last month, and never forward. */
  private requireOpenDay(day: string): void {
    const verdict = attendanceDateVerdict(day, this.clock.date(), true);
    if (verdict === 'FUTURE') throw new BadRequestException('Attendance cannot be changed for a day that has not come');
    if (verdict === 'TOO_OLD') throw new BadRequestException('That day is too long ago to change');
  }

  // ───────────────────────── Settling days that have ended ─────────────────────────

  /**
   * Works out every attendance day that has ended and is still open to
   * correction, for every outlet (or one), and stores the answers. This is what
   * turns "no punches yesterday" into absent (or the weekly off), and yesterday's
   * provisional "present" into present, half day or absent by the hours worked.
   *
   * Careful by design, because it can take a day's pay away:
   * - it never touches a day the Owner set by hand;
   * - it only marks absences at an outlet that has started using punches, and
   *   only from the outlet's first punch onwards, so switching the feature on
   *   does not mark everyone absent for the weeks before;
   * - it never marks a person absent for a day before they were added to the app
   *   or before their joining date, or after they left;
   * - it goes back only as far as the Owner can still correct.
   *
   * Safe to run any number of times. Returns how many days it changed.
   */
  async closeDays(now: Date = this.clock.now(), outletId?: string): Promise<number> {
    const today = attendanceDayOf(now);
    const lastEnded = shiftDate(today, -1);
    const windowStart = earliestCorrectableDate(indiaDate(now));
    const firstPunches = await this.db.attendancePunch.groupBy({ by: ['outletId'], _min: { at: true }, ...(outletId && { where: { outletId } }) });
    let changed = 0;

    for (const first of firstPunches) {
      if (!first._min.at) continue;
      const liveFrom = attendanceDayOf(first._min.at);
      const from = liveFrom > windowStart ? liveFrom : windowStart;
      if (from > lastEnded) continue;

      const staff: StaffDates[] = await this.db.staffMember.findMany({
        where: { outletId: first.outletId },
        select: { id: true, outletId: true, name: true, weeklyOffDay: true, joinedOn: true, leftOn: true, createdAt: true },
      });
      const ids = staff.map((person) => person.id);
      const [punches, records, settings] = await Promise.all([
        this.db.attendancePunch.findMany({
          where: { staffMemberId: { in: ids }, voidedAt: null, at: { gte: attendanceDayStart(from), lt: attendanceDayEnd(lastEnded) } },
          orderBy: { at: 'asc' },
        }),
        this.db.attendanceRecord.findMany({ where: { staffMemberId: { in: ids }, date: { gte: toDbDate(from), lte: toDbDate(lastEnded) } } }),
        this.settingsOf(first.outletId),
      ]);
      const punchesOf = groupBy(punches, (punch) => `${punch.staffMemberId}|${attendanceDayOf(punch.at)}`);
      const recordOf = new Map(records.map((record) => [`${record.staffMemberId}|${fromDbDate(record.date)}`, record]));

      for (const person of staff) {
        const dates = datesOf(person);
        const addedOn = attendanceDayOf(person.createdAt);
        for (let day = from; day <= lastEnded; day = shiftDate(day, 1)) {
          const key = `${person.id}|${day}`;
          const record = recordOf.get(key) ?? null;
          if (record?.source === 'OWNER') continue;
          const dayPunches = punchesOf.get(key) ?? [];
          // With no punch, "absent" is only said of someone who was on the staff, and in the app, that day.
          if (dayPunches.length === 0 && (!worksOn(dates, day) || day < addedOn)) {
            // A row worked out earlier for such a day (the joining date was changed since) is taken away again.
            if (record) {
              await this.db.attendanceRecord.delete({ where: { id: record.id } });
              changed += 1;
            }
            continue;
          }
          const summary = summariseDay({
            day,
            now,
            punches: dayPunches.map(toRule),
            fullDayMinutes: settings.fullDayMinutes,
            halfDayMinutes: settings.halfDayMinutes,
            usualDayOff: person.weeklyOffDay !== null && weekdayOf(day) === person.weeklyOffDay,
          });
          if (await this.store(person.id, day, record, summary)) changed += 1;
        }
      }
    }
    return changed;
  }

  /**
   * Called before attendance or pay is read, so what is shown never waits for
   * the half-hourly timer: settles the outlet's ended days if that has not been
   * done in the last minute (or since the attendance day changed).
   */
  async settle(outletId: string): Promise<void> {
    const now = this.clock.now();
    const day = attendanceDayOf(now);
    const last = this.settledAt.get(outletId);
    if (last && last.day === day && Math.abs(now.getTime() - last.at) < SETTLE_AT_MOST_EVERY_MS) return;
    this.settledAt.set(outletId, { at: now.getTime(), day });
    await this.closeDays(now, outletId);
  }

  // ───────────────────────── Deleting old punch photos ─────────────────────────

  /**
   * Deletes punch photos older than 35 days: the file, and the record of it.
   * The punch itself stays, without its photo. Long enough to settle a month's
   * pay and a dispute about it; no longer, because a photo of a face is not
   * something to keep without need. Returns how many were deleted.
   */
  async cleanUpPhotos(now: Date = this.clock.now()): Promise<number> {
    const before = new Date(now.getTime() - FACE_RULES.punchPhotoDays * 24 * 60 * 60 * 1000);
    const old = await this.db.attachment.findMany({ where: { kind: 'PUNCH', createdAt: { lt: before } }, select: { id: true, storageKey: true }, take: 500 });
    let deleted = 0;
    for (const photo of old) {
      try {
        await this.storage.remove(photo.storageKey);
      } catch (error) {
        // Left for the next run rather than losing track of a file that is still there.
        this.logger.warn(`Could not delete punch photo ${photo.id} from storage: ${String(error)}`);
        continue;
      }
      await this.db.$transaction([
        this.db.attendancePunch.updateMany({ where: { photoId: photo.id }, data: { photoId: null } }),
        this.db.attachment.delete({ where: { id: photo.id } }),
      ]);
      deleted += 1;
    }
    return deleted;
  }

  // ───────────────────────── Reading ─────────────────────────

  /**
   * For some people over a run of attendance days: each day that has a status
   * or a punch, with first in, last out, minutes worked and what to look at.
   * The status is always the stored one, the same the pay is worked out from.
   */
  async cells(
    outletId: string,
    staff: readonly { id: string; weeklyOffDay: number | null }[],
    fromDay: string,
    toDay: string,
    seesPhotos: boolean,
  ): Promise<Map<string, Record<string, AttendanceDayCellDto & { markedById: string | null }>>> {
    const ids = staff.map((person) => person.id);
    const [punches, records, settings] = await Promise.all([
      this.db.attendancePunch.findMany({
        where: { staffMemberId: { in: ids }, voidedAt: null, at: { gte: attendanceDayStart(fromDay), lt: attendanceDayEnd(toDay) } },
        orderBy: { at: 'asc' },
      }),
      this.db.attendanceRecord.findMany({ where: { staffMemberId: { in: ids }, date: { gte: toDbDate(fromDay), lte: toDbDate(toDay) } } }),
      this.settingsOf(outletId),
    ]);
    const punchesOf = groupBy(punches, (punch) => `${punch.staffMemberId}|${attendanceDayOf(punch.at)}`);
    const recordOf = new Map(records.map((record) => [`${record.staffMemberId}|${fromDbDate(record.date)}`, record]));
    const result = new Map<string, Record<string, AttendanceDayCellDto & { markedById: string | null }>>();
    for (const person of staff) {
      const days: Record<string, AttendanceDayCellDto & { markedById: string | null }> = {};
      const keys = new Set([...punchesOf.keys(), ...recordOf.keys()].filter((key) => key.startsWith(`${person.id}|`)));
      for (const key of [...keys].sort()) {
        const day = key.slice(person.id.length + 1);
        days[day] = this.cell(day, recordOf.get(key) ?? null, punchesOf.get(key) ?? [], settings, person.weeklyOffDay, seesPhotos);
      }
      result.set(person.id, days);
    }
    return result;
  }

  private cell(
    day: string,
    record: RecordRow | null,
    punches: PunchRow[],
    settings: { fullDayMinutes: number; halfDayMinutes: number },
    weeklyOffDay: number | null,
    seesPhotos: boolean,
  ): AttendanceDayCellDto & { markedById: string | null } {
    const summary = this.summarise(day, punches, settings, weeklyOffDay);
    const byOwner = record?.source === 'OWNER';
    // Once the Owner has settled a day, a missing punch or a short day no longer waits for anyone.
    const flags: DayFlag[] = byOwner ? summary.flags.filter((flag) => !DAY_FLAGS_NEEDING_OWNER.includes(flag)) : summary.flags;
    return {
      status: record?.status ?? null,
      source: record?.source ?? null,
      firstInAt: iso(summary.firstInAt),
      lastOutAt: iso(summary.lastOutAt),
      workedMinutes: punches.length > 0 ? summary.workedMinutes : null,
      flags,
      provisional: !byOwner && record !== null && summary.provisional,
      onDuty: summary.onDuty,
      punches: punches.length,
      hasPhoto: seesPhotos && punches.some((punch) => punch.photoId !== null),
      note: byOwner ? record.note : null,
      markedById: byOwner ? record.markedById : null,
    };
  }

  /** A cell for a day with neither a status nor a punch. */
  static emptyCell(): AttendanceDayCellDto & { markedById: string | null } {
    return { status: null, source: null, firstInAt: null, lastOutAt: null, workedMinutes: null, flags: [], provisional: false, onDuty: false, punches: 0, hasPhoto: false, note: null, markedById: null };
  }

  /** One person's punches for a month, day by day, voided ones included. For the Owner and the Manager. */
  async punchesMonth(user: AuthUser, staffId: string, month: string | undefined): Promise<StaffPunchesDto> {
    const staff = await this.db.staffMember.findUnique({ where: { id: staffId } });
    if (!staff) throw new NotFoundException('Not found');
    await this.requireOutlet(user, 'read', staff.outletId, true);
    const today = this.clock.day();
    const wanted = month ?? monthOfDate(today);
    if (!isMonth(wanted)) throw new BadRequestException('Give the month as YYYY-MM');
    await this.settle(staff.outletId);

    const { first, last } = monthBounds(wanted);
    const [all, cells] = await Promise.all([
      this.db.attendancePunch.findMany({
        where: { staffMemberId: staff.id, at: { gte: attendanceDayStart(first), lt: attendanceDayEnd(last) } },
        orderBy: { at: 'asc' },
      }),
      this.cells(staff.outletId, [staff], first, last, true),
    ]);
    const entries = groupBy(await this.toPunchDtos(all, true), (punch) => punch.day);
    const days: PunchDayDto[] = [...entries.keys()]
      .sort()
      .reverse()
      .map((date) => {
        const { markedById: _markedById, ...cell } = cells.get(staff.id)?.[date] ?? AttendanceService.emptyCell();
        return { date, ...cell, entries: entries.get(date) ?? [] };
      });
    return { staffId: staff.id, name: staff.name, outletId: staff.outletId, month: wanted, today, earliestDate: earliestCorrectableDate(this.clock.date()), days };
  }

  /**
   * What is waiting for the Owner at an outlet: marked punches nobody has looked
   * at yet, and ended days whose status is a stand-in (no clock-out, a short
   * day). Only as far back as a correction can still be made.
   */
  async review(user: AuthUser, outletId: string): Promise<AttendanceReviewDto> {
    await this.requireOutlet(user, 'read', outletId);
    await this.settle(outletId);
    const today = this.clock.day();
    const earliest = earliestCorrectableDate(this.clock.date());
    const lastEnded = shiftDate(today, -1);
    const staff = await this.db.staffMember.findMany({ where: { outletId }, select: { id: true, name: true, weeklyOffDay: true } });
    const nameOf = new Map(staff.map((person) => [person.id, person.name]));

    const [flagged, cells] = await Promise.all([
      this.db.attendancePunch.findMany({
        where: { outletId, voidedAt: null, reviewedAt: null, flag: { in: PUNCH_FLAGS_FOR_REVIEW }, at: { gte: attendanceDayStart(earliest) } },
        orderBy: { at: 'desc' },
        take: 200,
      }),
      earliest <= lastEnded ? this.cells(outletId, staff, earliest, lastEnded, true) : Promise.resolve(new Map<string, Record<string, AttendanceDayCellDto & { markedById: string | null }>>()),
    ]);
    const days: ReviewDayDto[] = [];
    for (const [staffId, byDate] of cells) {
      for (const [date, { markedById: _markedById, ...cell }] of Object.entries(byDate)) {
        if (cell.source === 'PUNCHES' && cell.flags.some((flag) => DAY_FLAGS_NEEDING_OWNER.includes(flag))) {
          days.push({ staffId, name: nameOf.get(staffId) ?? '', date, ...cell });
        }
      }
    }
    days.sort((a, b) => b.date.localeCompare(a.date) || a.name.localeCompare(b.name));
    return { outletId, today, earliestDate: earliest, punches: await this.toPunchDtos(flagged, true), days };
  }

  /** The photo taken at a punch, for the Owner or the Manager of that outlet only. */
  async photo(user: AuthUser, punchId: string): Promise<{ body: Readable; mimeType: string }> {
    const { punch } = await this.requirePunch(user, 'read', punchId);
    const attachment = punch.photoId ? await this.db.attachment.findUnique({ where: { id: punch.photoId } }) : null;
    if (!attachment || attachment.kind !== 'PUNCH') throw new NotFoundException('This punch has no photo, or it has been deleted');
    return { body: await this.storage.get(attachment.storageKey), mimeType: attachment.mimeType };
  }

  async toPunchDtos(punches: PunchRow[], seesPhotos: boolean): Promise<PunchDto[]> {
    const staffIds = [...new Set(punches.map((punch) => punch.staffMemberId))];
    const userIds = [...new Set(punches.flatMap((punch) => [punch.createdById, punch.voidedById]).filter((id): id is string => id !== null))];
    const [staff, users] = await Promise.all([
      staffIds.length ? this.db.staffMember.findMany({ where: { id: { in: staffIds } }, select: { id: true, name: true } }) : [],
      userIds.length ? this.db.user.findMany({ where: { id: { in: userIds } }, select: { id: true, name: true } }) : [],
    ]);
    const staffName = new Map(staff.map((person) => [person.id, person.name]));
    const userName = new Map(users.map((person) => [person.id, person.name]));
    return punches.map((punch) => ({
      id: punch.id,
      staffId: punch.staffMemberId,
      staffName: staffName.get(punch.staffMemberId) ?? '',
      outletId: punch.outletId,
      day: attendanceDayOf(punch.at),
      at: punch.at.toISOString(),
      kind: punch.kind,
      method: punch.method,
      flag: punch.flag,
      score: punch.score,
      secondScore: punch.secondScore,
      note: punch.note,
      createdByName: punch.createdById ? (userName.get(punch.createdById) ?? null) : null,
      photoPath: seesPhotos && punch.photoId ? this.storage.signedPath(punch.photoId) : null,
      voided: punch.voidedAt !== null,
      voidedAt: punch.voidedAt?.toISOString() ?? null,
      voidedByName: punch.voidedById ? (userName.get(punch.voidedById) ?? null) : null,
      voidReason: punch.voidReason,
      reviewedAt: punch.reviewedAt?.toISOString() ?? null,
    }));
  }

  // ───────────────────────── Who may ─────────────────────────

  /** Checks the user may do this to attendance at the outlet: read for the Owner and Manager, create and update for the Owner alone. */
  private async requireOutlet(user: AuthUser, action: Action, outletId: string, asNotFound = false) {
    const outlet = await this.db.outlet.findUnique({ where: { id: outletId }, select: { id: true, organizationId: true } });
    if (!outlet || !can(user.memberships, 'attendance', action, { organizationId: outlet.organizationId, outletId })) {
      throw asNotFound ? new NotFoundException('Not found') : new ForbiddenException('You cannot do this at this outlet');
    }
    return outlet;
  }

  /**
   * Nobody but the Owner corrects their own attendance (see `ownRecordLocked` in @eccs/shared).
   * Today only the Owner holds the grant to correct at all, so this cannot fire. It is here so
   * that giving the grant to the Manager one day cannot quietly let a Manager set their own days.
   */
  private requireNotOwn(user: AuthUser, organizationId: string, staff: { userId: string | null }): void {
    const isOwner = user.memberships.some((membership) => membership.role === 'OWNER' && membership.organizationId === organizationId);
    if (ownRecordLocked({ userId: user.id, isOwner }, staff)) {
      throw attendanceError(HttpStatus.FORBIDDEN, ATTENDANCE_ERROR.ownRecord, 'Only the owner can change your own attendance.');
    }
  }

  private async requirePunch(user: AuthUser, action: Action, punchId: string) {
    const punch = await this.db.attendancePunch.findUnique({ where: { id: punchId }, include: { staffMember: true } });
    if (!punch) throw new NotFoundException('Not found');
    const outlet = await this.requireOutlet(user, action, punch.outletId, true);
    const { staffMember: staff, ...row } = punch;
    return { punch: row as PunchRow, staff, outlet };
  }
}

function groupBy<T>(items: readonly T[], keyOf: (item: T) => string): Map<string, T[]> {
  const groups = new Map<string, T[]>();
  for (const item of items) {
    const key = keyOf(item);
    const group = groups.get(key);
    if (group) group.push(item);
    else groups.set(key, [item]);
  }
  return groups;
}
