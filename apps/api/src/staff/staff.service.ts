import { BadRequestException, ConflictException, ForbiddenException, HttpStatus, Injectable, NotFoundException } from '@nestjs/common';
import type { Prisma } from '@eccs/db';
import {
  ATTENDANCE_ERROR,
  CORRECTION_REASON_MIN,
  attendanceDateVerdict,
  attendanceDayOf,
  attendanceTotals,
  can,
  countedFromOf,
  divisorFor,
  earliestCorrectableDate,
  isCalendarDate,
  isMonth,
  monthBounds,
  monthOfDate,
  ownRecordLocked,
  shiftMonth,
  staffSalaryMonth,
  weekdayOf,
  worksOn,
  type Action,
  type AttendanceDayCellDto,
  type AttendanceDayDto,
  type AttendanceMonthDto,
  type AttendanceStatus,
  type Resource,
  type SalaryMonthDto,
  type SalaryMonthEntryInput,
  type SalaryOutletMonthDto,
  type StaffMemberDto,
  type StaffMonthDto,
  type StaffPayEntryKind,
  type StaffPayType,
} from '@eccs/shared';
import { AttendanceClock } from '../attendance/attendance-clock.js';
import { attendanceError } from '../attendance/attendance.errors.js';
import { AttendanceService } from '../attendance/attendance.service.js';
import { AuditTrailService } from '../attendance/audit-trail.service.js';
import { FaceService, isOwnerOf } from '../attendance/face.service.js';
import type { AuthUser } from '../auth/auth.types.js';
import { PrismaService } from '../prisma/prisma.service.js';

const toDbDate = (date: string) => new Date(`${date}T00:00:00.000Z`);
const fromDbDate = (date: Date) => date.toISOString().slice(0, 10);
const fromDbDateOrNull = (date: Date | null) => (date ? fromDbDate(date) : null);

const outletSelect = { id: true, name: true, organizationId: true, organization: { select: { name: true } } } as const;
type OutletRow = Prisma.OutletGetPayload<{ select: typeof outletSelect }>;

const staffInclude = { _count: { select: { attendance: true, salaries: true, payEntries: true, punches: true } } } as const;
type StaffRow = Prisma.StaffMemberGetPayload<{ include: typeof staffInclude }>;

// Everything the salary arithmetic needs about a person: every mark, typed figure and pay entry.
const salaryInclude = {
  attendance: { select: { date: true, status: true } },
  salaries: true,
  payEntries: { orderBy: [{ date: 'asc' }, { createdAt: 'asc' }] },
} as const satisfies Prisma.StaffMemberInclude;
type SalaryRow = Prisma.StaffMemberGetPayload<{ include: typeof salaryInclude }>;

type PersonDates = { joinedOn: Date | null; leftOn: Date | null; createdAt: Date };
/**
 * The day a person's attendance and pay count from: their joining date, or, for someone
 * added before joining dates were filled in for everyone, the (attendance) day they were added.
 */
const countedFrom = (person: PersonDates) =>
  countedFromOf({ joinedOn: fromDbDateOrNull(person.joinedOn), addedOn: attendanceDayOf(person.createdAt) });
/** The dates every rule here works from. `joinedOn` is never empty in it: see `countedFrom`. */
const datesOf = (person: PersonDates) => ({ joinedOn: countedFrom(person), leftOn: fromDbDateOrNull(person.leftOn) });
const rateOf = (person: { payType: StaffPayType; monthlySalaryPaise: number; dailyWagePaise: number }) =>
  person.payType === 'DAILY' ? person.dailyWagePaise : person.monthlySalaryPaise;

interface StaffFields {
  name?: string | undefined;
  jobTitle?: string | null | undefined;
  phone?: string | null | undefined;
  joinedOn?: string | null | undefined;
  payType?: StaffPayType | undefined;
  payPaise?: number | undefined;
  weeklyOffDay?: number | null | undefined;
  userId?: string | null | undefined;
  leftOn?: string | null | undefined;
}

/**
 * The restaurant's own staff: the people, their attendance and the salary
 * tracker. A record book for the Owner and Manager; ECCS has no access, and
 * since 13 Oct 2026 nor has the Head Chef (until then the Head Chef saw who
 * was in today).
 *
 * Since face attendance nobody marks attendance by hand: a day's status is
 * worked out from the clock-ins and clock-outs (see ../attendance), and only
 * the Owner can set or correct one, with a reason. This service reads the
 * result; the pay arithmetic is unchanged.
 *
 * Nobody but the Owner changes their OWN record here: a Manager who is on the
 * staff list reads their own details and pay but cannot edit them (see
 * `ownRecordLocked` in @eccs/shared, and `requireNotOwn` below).
 */
@Injectable()
export class StaffService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly attendance: AttendanceService,
    private readonly face: FaceService,
    private readonly clock: AttendanceClock,
    private readonly audit: AuditTrailService,
  ) {}

  private get db() {
    return this.prisma.client;
  }

  // ───────────────────────── People ─────────────────────────

  /** Everyone on the outlet's staff, those still working first. People who left are included when asked for. */
  async listPeople(user: AuthUser, outletId: string, includeLeft: boolean): Promise<StaffMemberDto[]> {
    const outlet = await this.requireOutlet(user, 'staff', 'read', outletId);
    const rows = await this.db.staffMember.findMany({
      where: { outletId, ...(!includeLeft && { isActive: true }) },
      include: staffInclude,
      orderBy: [{ isActive: 'desc' }, { name: 'asc' }],
    });
    return this.toDtos(user, outlet, rows);
  }

  async createPerson(user: AuthUser, input: StaffFields & { outletId: string; name: string; payType: StaffPayType; payPaise: number }) {
    const outlet = await this.requireOutlet(user, 'staff', 'create', input.outletId);
    // A Manager cannot put themselves on the staff list, with a salary of their own choosing: the Owner adds them.
    this.requireNotOwn(user, outlet, { userId: input.userId ?? null });
    if (input.userId) await this.checkLogin(outlet.id, input.userId, null);
    const row = await this.db.staffMember.create({
      data: {
        outletId: outlet.id,
        name: input.name,
        jobTitle: input.jobTitle ?? null,
        phone: input.phone ?? null,
        // Pay starts on the day the person joined. With no date given that is today (the attendance
        // day, so someone added during a late shift can clock in on it), never the 1st of the month.
        joinedOn: toDbDate(input.joinedOn ?? this.clock.day()),
        payType: input.payType,
        monthlySalaryPaise: input.payType === 'MONTHLY' ? input.payPaise : 0,
        dailyWagePaise: input.payType === 'DAILY' ? input.payPaise : 0,
        weeklyOffDay: input.weeklyOffDay ?? null,
        userId: input.userId ?? null,
      },
      include: staffInclude,
    });
    return (await this.toDtos(user, outlet, [row]))[0]!;
  }

  /**
   * Changes a person's details. Giving a last day marks them as having left;
   * clearing it brings them back. A change of pay applies from this month:
   * earlier months keep the pay they had (see `keepEarlierPay`).
   */
  async updatePerson(user: AuthUser, staffId: string, input: StaffFields): Promise<StaffMemberDto> {
    const { row, outlet } = await this.requireStaff(user, 'staff', 'update', staffId);
    const today = this.clock.date();

    // Their own pay, joining date, day off or the link to their login: the Owner's to change. Nor can
    // anyone link somebody else's record to their own login, which would make that record theirs.
    this.requireNotOwn(user, outlet, row);
    this.requireNotOwn(user, outlet, { userId: input.userId ?? null });
    if (input.userId) await this.checkLogin(outlet.id, input.userId, row.id);
    const joinedOn = input.joinedOn ?? countedFrom(input.joinedOn === undefined ? row : { ...row, joinedOn: null });
    if (input.leftOn) {
      if (input.leftOn > today) throw new BadRequestException('The last day cannot be after today');
      if (input.leftOn < joinedOn) throw new BadRequestException('The last day cannot be before the joining date');
    }

    const payType = input.payType ?? row.payType;
    const payPaise = input.payPaise ?? rateOf(row);
    const payChanged = payType !== row.payType || payPaise !== rateOf(row);
    if (payChanged) await this.keepEarlierPay(row.id, today, payType, payPaise);

    const updated = await this.db.staffMember.update({
      where: { id: row.id },
      data: {
        ...(input.name !== undefined && { name: input.name }),
        ...(input.jobTitle !== undefined && { jobTitle: input.jobTitle || null }),
        ...(input.phone !== undefined && { phone: input.phone || null }),
        ...(input.joinedOn !== undefined && { joinedOn: input.joinedOn ? toDbDate(input.joinedOn) : null }),
        ...(input.weeklyOffDay !== undefined && { weeklyOffDay: input.weeklyOffDay }),
        ...(input.userId !== undefined && { userId: input.userId }),
        ...(payChanged && {
          payType,
          monthlySalaryPaise: payType === 'MONTHLY' ? payPaise : 0,
          dailyWagePaise: payType === 'DAILY' ? payPaise : 0,
        }),
        ...(input.leftOn !== undefined && { leftOn: input.leftOn ? toDbDate(input.leftOn) : null, isActive: !input.leftOn }),
      },
      include: staffInclude,
    });
    if (input.leftOn) {
      // A person who has left is no longer recognised: their face templates are deleted at once
      // and their consent record closed. Coming back means enrolling, and consenting, again.
      const removed = await this.face.forget(row.id, 'LEFT', user.id);
      if (removed > 0) {
        await this.audit.write({
          actorId: user.id,
          action: 'face.delete.left',
          entity: 'StaffMember',
          entityId: row.id,
          organizationId: outlet.organizationId,
          details: { templatesDeleted: removed, leftOn: input.leftOn },
        });
      }
    }
    return (await this.toDtos(user, outlet, [updated]))[0]!;
  }

  /**
   * Removes a person added by mistake. Someone with any attendance, punch, advance,
   * payment or pay figure is never deleted: they are marked as having left.
   */
  async removePerson(user: AuthUser, staffId: string): Promise<void> {
    const { row, outlet } = await this.requireStaff(user, 'staff', 'update', staffId);
    this.requireNotOwn(user, outlet, row);
    if (row._count.attendance + row._count.salaries + row._count.payEntries + row._count.punches > 0) {
      throw new ConflictException('This person has records. Mark them as having left instead.');
    }
    await this.db.staffMember.delete({ where: { id: row.id } });
  }

  // ───────────────────────── Attendance ─────────────────────────

  /**
   * One day's sheet for the outlet: everyone who was on the staff that day, the
   * day's status, and what the punches say (first in, last out, time worked).
   * For the Owner and the Manager, who can open any day as far back as a day can
   * still be corrected. The Head Chef has no attendance page (13 Oct 2026).
   */
  async day(user: AuthUser, outletId: string, date: string | undefined): Promise<AttendanceDayDto> {
    const outlet = await this.requireOutlet(user, 'attendance', 'read', outletId);
    // "Today" is the attendance day: before 4 am it is still yesterday's, so a late shift stays on one sheet.
    const today = this.clock.day();
    const calendarToday = this.clock.date();
    const day = date ?? today;
    if (!isCalendarDate(day)) throw new BadRequestException('Give the date as YYYY-MM-DD');
    if (day > calendarToday) throw new BadRequestException('There is no attendance yet for a day that has not come');

    await this.attendance.settle(outlet.id);
    const rows = await this.db.staffMember.findMany({ where: { outletId }, orderBy: { name: 'asc' } });
    const people = rows.filter((row) => worksOn(datesOf(row), day));
    const [cells, enrolled] = await Promise.all([
      this.attendance.cells(outlet.id, people, day, day, true),
      this.face.enrolledAmong(people.map((row) => row.id)),
    ]);
    const cellOf = (staffId: string) => cells.get(staffId)?.[day] ?? AttendanceService.emptyCell();
    const markerIds = [...new Set(people.map((row) => cellOf(row.id).markedById).filter((id): id is string => !!id))];
    const markers = markerIds.length
      ? await this.db.user.findMany({ where: { id: { in: markerIds } }, select: { id: true, name: true } })
      : [];
    const nameOf = new Map(markers.map((marker) => [marker.id, marker.name]));

    return {
      outletId,
      date: day,
      today,
      earliestDate: earliestCorrectableDate(calendarToday),
      editable: this.mayCorrect(user, outlet) && attendanceDateVerdict(day, calendarToday, true) === 'OK',
      people: people.map((row) => {
        const { markedById, ...cell } = cellOf(row.id);
        return {
          staffId: row.id,
          name: row.name,
          jobTitle: row.jobTitle,
          usualDayOff: row.weeklyOffDay !== null && weekdayOf(day) === row.weeklyOffDay,
          markedByName: markedById ? (nameOf.get(markedById) ?? null) : null,
          enrolled: enrolled.has(row.id),
          ...cell,
        };
      }),
    };
  }

  /**
   * The Owner's correction of a day, for one or several people: leave, the
   * weekly off, or a status put right, always with a reason. A null status
   * takes the Owner's entry away and the day goes back to what the punches say.
   * Nobody else can send this: hand-marking ended with face attendance.
   * Back to the start of last month, and never a day that has not come.
   */
  async mark(
    user: AuthUser,
    input: { outletId: string; date: string; marks: { staffId: string; status: AttendanceStatus | null }[]; reason?: string | undefined },
  ): Promise<AttendanceDayDto> {
    const outlet = await this.requireOutlet(user, 'attendance', 'update', input.outletId);
    const reason = input.reason?.trim() ?? '';
    if (reason.length < CORRECTION_REASON_MIN) {
      throw attendanceError(400, ATTENDANCE_ERROR.reasonRequired, `Say why, in at least ${CORRECTION_REASON_MIN} characters`);
    }
    const verdict = attendanceDateVerdict(input.date, this.clock.date(), true);
    if (verdict === 'FUTURE') throw new BadRequestException('Attendance cannot be changed for a day that has not come');
    if (verdict === 'TOO_OLD') throw new BadRequestException('That day is too long ago to change');

    // Everyone is checked before anyone is changed, so a wrong name in the list changes nothing.
    const ids = [...new Set(input.marks.map((mark) => mark.staffId))];
    const staff = await this.db.staffMember.findMany({ where: { id: { in: ids }, outletId: outlet.id } });
    if (staff.length !== ids.length || staff.some((row) => !worksOn(datesOf(row), input.date))) {
      throw new BadRequestException('Someone in the list was not on the staff of this outlet that day');
    }
    for (const mark of input.marks) {
      await this.attendance.correctDay(user, { outletId: outlet.id, staffId: mark.staffId, date: input.date, status: mark.status, reason });
    }
    return this.day(user, outlet.id, input.date);
  }

  /** The outlet's month: each person's days present, half days, absences, leave and weekly offs. */
  async outletMonth(user: AuthUser, outletId: string, month: string | undefined): Promise<AttendanceMonthDto> {
    const outlet = await this.requireOutlet(user, 'attendance', 'read', outletId);
    const today = this.clock.date();
    const wanted = this.monthOrThis(month, today);
    const { first, last } = monthBounds(wanted);
    await this.attendance.settle(outlet.id);
    const rows = await this.db.staffMember.findMany({
      where: { outletId: outlet.id },
      include: { attendance: { where: { date: { gte: toDbDate(first), lte: toDbDate(last) } }, select: { date: true, status: true } } },
      orderBy: { name: 'asc' },
    });
    const cells = await this.attendance.cells(outlet.id, rows, first, last, true);
    return {
      outletId: outlet.id,
      month: wanted,
      today,
      people: rows
        .map((row) => ({
          staffId: row.id,
          name: row.name,
          jobTitle: row.jobTitle,
          isActive: row.isActive,
          days: this.daysOf(cells.get(row.id)),
          totals: attendanceTotals({
            ...datesOf(row),
            weeklyOffDay: row.weeklyOffDay,
            month: wanted,
            today,
            marks: this.marksOf(row.attendance),
          }),
        }))
        // Someone who had not joined yet, or had already left, is not on that month's list.
        .filter((person) => person.totals.countedDays > 0),
    };
  }

  /** One person's month, day by day, with the checklists they handed in when they have an app login. */
  async personMonth(user: AuthUser, staffId: string, month: string | undefined): Promise<StaffMonthDto> {
    const { row, outlet } = await this.requireStaff(user, 'attendance', 'read', staffId);
    const today = this.clock.date();
    const wanted = this.monthOrThis(month, today);
    const { first, last } = monthBounds(wanted);
    const range = { gte: toDbDate(first), lte: toDbDate(last) };
    await this.attendance.settle(outlet.id);
    const [attendance, cells, checklistsHandedIn] = await Promise.all([
      this.db.attendanceRecord.findMany({ where: { staffMemberId: row.id, date: range }, select: { date: true, status: true } }),
      this.attendance.cells(outlet.id, [row], first, last, true),
      // The light tie to hygiene: the daily checklists this person submitted under their own login.
      row.userId
        ? this.db.checklistRun.count({ where: { outletId: outlet.id, submittedById: row.userId, date: range } })
        : Promise.resolve(null),
    ]);
    const marks = this.marksOf(attendance);
    return {
      staff: (await this.toDtos(user, outlet, [row]))[0]!,
      month: wanted,
      today,
      earliestDate: earliestCorrectableDate(today),
      marks,
      days: this.daysOf(cells.get(row.id)),
      totals: attendanceTotals({ ...datesOf(row), weeklyOffDay: row.weeklyOffDay, month: wanted, today, marks }),
      checklistsHandedIn,
    };
  }

  // ───────────────────────── Salary tracker ─────────────────────────

  /**
   * The outlet's pay for a month, a row per person: everyone who worked in it,
   * and anyone else with money given that month or a balance still open.
   */
  async salaryMonth(user: AuthUser, outletId: string, month: string | undefined): Promise<SalaryOutletMonthDto> {
    const outlet = await this.requireOutlet(user, 'salary', 'read', outletId);
    const today = this.clock.date();
    const wanted = this.monthOrThis(month, today);
    await this.attendance.settle(outlet.id);
    const [rows, divisorDays] = await Promise.all([
      this.db.staffMember.findMany({ where: { outletId: outlet.id }, include: salaryInclude, orderBy: { name: 'asc' } }),
      this.divisorSetting(outlet.id),
    ]);
    return {
      outletId: outlet.id,
      month: wanted,
      today,
      people: rows
        .map((row) => this.toSalaryDto(row, outlet, wanted, today, divisorDays, this.selfLocked(user, outlet, row)))
        .filter((person) => person.totals.countedDays > 0 || person.entries.length > 0 || person.balancePaise !== 0),
    };
  }

  async personSalary(user: AuthUser, staffId: string, month: string | undefined): Promise<SalaryMonthDto> {
    const { row, outlet } = await this.requireStaff(user, 'salary', 'read', staffId);
    const today = this.clock.date();
    return this.salaryOf(user, row.id, outlet, this.monthOrThis(month, today), today);
  }

  /** Saves what the Owner or Manager typed for a person's month: overtime, bonus, deductions, their own figures, a note. */
  async saveSalary(
    user: AuthUser,
    staffId: string,
    month: string,
    input: {
      overtimeHours: number;
      overtimePaise: number;
      bonusPaise: number;
      deductionsPaise: number;
      dueOverridePaise: number | null;
      carriedOverridePaise: number | null;
      note: string | null;
    },
  ): Promise<SalaryMonthDto> {
    const { row, outlet } = await this.requireStaff(user, 'salary', 'update', staffId);
    this.requireNotOwn(user, outlet, row);
    const today = this.clock.date();
    const wanted = this.monthOrThis(month, today);
    const typed = {
      overtimeHours: input.overtimeHours,
      overtimePaise: input.overtimePaise,
      bonusPaise: input.bonusPaise,
      deductionsPaise: input.deductionsPaise,
      dueOverridePaise: input.dueOverridePaise,
      carriedOverridePaise: input.carriedOverridePaise,
      note: input.note,
      updatedById: user.id,
    };
    await this.db.salaryRecord.upsert({
      where: { staffMemberId_month: { staffMemberId: row.id, month: toDbDate(`${wanted}-01`) } },
      // A new record takes the person's pay as it is now; the copies of worked-out figures are filled in below.
      create: { staffMemberId: row.id, month: toDbDate(`${wanted}-01`), payType: row.payType, basePaise: rateOf(row), daysWorked: 0, netPaise: 0, ...typed },
      update: typed,
    });
    await this.keepDivisor(row.id, outlet.id, wanted);
    return this.refreshCopies(user, row.id, outlet, wanted, today);
  }

  /** Records an advance given, or a payment of the month's pay, on its own date. */
  async addPayEntry(
    user: AuthUser,
    staffId: string,
    input: { kind: StaffPayEntryKind; month: string; date: string; amountPaise: number; note: string | null },
  ): Promise<SalaryMonthDto> {
    const { row, outlet } = await this.requireStaff(user, 'salary', 'create', staffId);
    this.requireNotOwn(user, outlet, row);
    const today = this.clock.date();
    const wanted = this.monthOrThis(input.month, today);
    if (input.date > today) throw new BadRequestException('The date cannot be after today');
    await this.db.staffPayEntry.create({
      data: {
        staffMemberId: row.id,
        month: toDbDate(`${wanted}-01`),
        kind: input.kind,
        date: toDbDate(input.date),
        amountPaise: input.amountPaise,
        note: input.note,
        createdById: user.id,
      },
    });
    if (input.kind === 'PAYMENT') {
      // Once money has been paid for a month, the month keeps the pay and the divisor it was worked
      // out with, so a later change of the setting (or a raise) does not rewrite it. An advance does
      // not do this: it is money given ahead, and the month is still open.
      await this.db.salaryRecord.upsert({
        where: { staffMemberId_month: { staffMemberId: row.id, month: toDbDate(`${wanted}-01`) } },
        create: { staffMemberId: row.id, month: toDbDate(`${wanted}-01`), payType: row.payType, basePaise: rateOf(row), daysWorked: 0, netPaise: 0, updatedById: user.id },
        update: {},
      });
      await this.keepDivisor(row.id, outlet.id, wanted);
    }
    return this.refreshCopies(user, row.id, outlet, wanted, today);
  }

  /** Takes back an advance or payment entered by mistake. */
  async removePayEntry(user: AuthUser, entryId: string): Promise<SalaryMonthDto> {
    const entry = await this.db.staffPayEntry.findUnique({ where: { id: entryId } });
    if (!entry) throw new NotFoundException('Not found');
    const { row, outlet } = await this.requireStaff(user, 'salary', 'update', entry.staffMemberId);
    this.requireNotOwn(user, outlet, row);
    await this.db.staffPayEntry.delete({ where: { id: entry.id } });
    return this.refreshCopies(user, row.id, outlet, monthOfDate(fromDbDate(entry.month)), this.clock.date());
  }

  // ───────────────────────── Helpers ─────────────────────────

  private monthOrThis(month: string | undefined, today: string): string {
    const wanted = month ?? monthOfDate(today);
    if (!isMonth(wanted)) throw new BadRequestException('Give the month as YYYY-MM');
    if (wanted > monthOfDate(today)) throw new BadRequestException('That month has not come yet');
    return wanted;
  }

  private marksOf(attendance: { date: Date; status: AttendanceStatus }[]): Record<string, AttendanceStatus> {
    return Object.fromEntries(attendance.map((mark) => [fromDbDate(mark.date), mark.status]));
  }

  /** A month's cells without the "who set it" id, which is for this service only. */
  private daysOf(cells: Record<string, AttendanceDayCellDto & { markedById: string | null }> | undefined): Record<string, AttendanceDayCellDto> {
    return Object.fromEntries(Object.entries(cells ?? {}).map(([date, { markedById: _markedById, ...cell }]) => [date, cell]));
  }

  /** Only the Owner may correct attendance. */
  private mayCorrect(user: AuthUser, outlet: OutletRow): boolean {
    return can(user.memberships, 'attendance', 'update', { organizationId: outlet.organizationId, outletId: outlet.id });
  }

  /** True when this is the user's own record and they are not the restaurant's Owner: they read it, and cannot change it. */
  private selfLocked(user: AuthUser, outlet: OutletRow, record: { userId: string | null }): boolean {
    return ownRecordLocked({ userId: user.id, isOwner: isOwnerOf(user, outlet.organizationId) }, record);
  }

  /** Refuses a change to the user's own record: only the Owner can make it. The app words the refusal from its code. */
  private requireNotOwn(user: AuthUser, outlet: OutletRow, record: { userId: string | null }): void {
    if (this.selfLocked(user, outlet, record)) {
      throw attendanceError(HttpStatus.FORBIDDEN, ATTENDANCE_ERROR.ownRecord, 'Only the owner can change your own attendance, pay or staff record.');
    }
  }

  private async salaryOf(user: AuthUser, staffId: string, outlet: OutletRow, month: string, today: string): Promise<SalaryMonthDto> {
    // Days that ended since the last look are settled first, so the pay is worked out from final statuses.
    await this.attendance.settle(outlet.id);
    const [row, divisorDays] = await Promise.all([
      this.db.staffMember.findUniqueOrThrow({ where: { id: staffId }, include: salaryInclude }),
      this.divisorSetting(outlet.id),
    ]);
    return this.toSalaryDto(row, outlet, month, today, divisorDays, this.selfLocked(user, outlet, row));
  }

  /** The outlet's setting for the days a month's salary is divided by: null means the days in that month. */
  private async divisorSetting(outletId: string): Promise<number | null> {
    return (await this.attendance.settingsOf(outletId)).salaryDivisorDays;
  }

  /**
   * Writes the divisor in force onto a month's record, if the month does not hold one yet.
   * Called when a payment is recorded or the month is saved. From then on the month is worked
   * out with that number whatever the outlet's setting becomes: a month already settled is
   * never quietly rewritten. (The same idea as the month's own rate of pay, `basePaise`.)
   */
  private async keepDivisor(staffId: string, outletId: string, month: string): Promise<void> {
    const divisorDays = divisorFor(month, await this.divisorSetting(outletId));
    await this.db.salaryRecord.updateMany({
      // Only a month paid by the month has a divisor; a daily wage is not divided by anything.
      where: { staffMemberId: staffId, month: toDbDate(`${month}-01`), divisorDays: null, payType: 'MONTHLY' },
      data: { divisorDays },
    });
  }

  /**
   * After a change, brings the month's stored copies of the worked-out figures
   * up to date (where the month has a record), and answers with the month.
   */
  private async refreshCopies(user: AuthUser, staffId: string, outlet: OutletRow, month: string, today: string): Promise<SalaryMonthDto> {
    const dto = await this.salaryOf(user, staffId, outlet, month, today);
    await this.db.salaryRecord.updateMany({
      where: { staffMemberId: staffId, month: toDbDate(`${month}-01`) },
      data: {
        daysWorked: dto.paidDays,
        advancesPaise: dto.advancesPaise,
        netPaise: dto.netPaise,
        paidPaise: dto.paidPaise,
        paidOn: dto.lastPaidOn ? toDbDate(dto.lastPaidOn) : null,
      },
    });
    return dto;
  }

  /**
   * Called just before a person's pay is changed. Every earlier month since
   * their records began gets a record holding the pay as it was, so the raise
   * (or the move from monthly to daily) does not rewrite what those months came
   * to. This month takes the new pay.
   */
  private async keepEarlierPay(staffId: string, today: string, newType: StaffPayType, newPaise: number): Promise<void> {
    const row = await this.db.staffMember.findUniqueOrThrow({ where: { id: staffId }, include: salaryInclude });
    const thisMonth = monthOfDate(today);
    const have = new Set(row.salaries.map((record) => monthOfDate(fromDbDate(record.month))));
    const dataMonths = [
      ...row.attendance.map((mark) => monthOfDate(fromDbDate(mark.date))),
      ...row.payEntries.map((entry) => monthOfDate(fromDbDate(entry.month))),
      ...have,
    ];
    const start = dataMonths.reduce((earliest, month) => (month < earliest ? month : earliest), thisMonth);
    const missing: string[] = [];
    for (let month = start; month < thisMonth; month = shiftMonth(month, 1)) if (!have.has(month)) missing.push(month);

    await this.db.$transaction([
      this.db.salaryRecord.createMany({
        data: missing.map((month) => ({
          staffMemberId: staffId,
          month: toDbDate(`${month}-01`),
          payType: row.payType,
          basePaise: rateOf(row),
          daysWorked: 0,
          netPaise: 0,
        })),
      }),
      this.db.salaryRecord.updateMany({
        where: { staffMemberId: staffId, month: toDbDate(`${thisMonth}-01`) },
        data: { payType: newType, basePaise: newPaise },
      }),
    ]);
  }

  private toSalaryDto(row: SalaryRow, outlet: OutletRow, month: string, today: string, divisorDays: number | null, selfLocked: boolean): SalaryMonthDto {
    const records: Record<string, SalaryMonthEntryInput> = {};
    for (const record of row.salaries) {
      records[monthOfDate(fromDbDate(record.month))] = {
        payType: record.payType,
        ratePaise: record.basePaise,
        divisorDays: record.divisorDays,
        dueOverridePaise: record.dueOverridePaise,
        carriedOverridePaise: record.carriedOverridePaise,
        overtimePaise: record.overtimePaise,
        bonusPaise: record.bonusPaise,
        deductionsPaise: record.deductionsPaise,
      };
    }
    const entryMonth = (entry: { month: Date }) => monthOfDate(fromDbDate(entry.month));
    const figures = staffSalaryMonth({
      person: { payType: row.payType, ratePaise: rateOf(row), ...datesOf(row), weeklyOffDay: row.weeklyOffDay },
      today,
      marks: this.marksOf(row.attendance),
      records,
      entries: row.payEntries.map((entry) => ({ month: entryMonth(entry), kind: entry.kind, amountPaise: entry.amountPaise })),
      month,
      divisorDays,
    });
    const record = row.salaries.find((candidate) => monthOfDate(fromDbDate(candidate.month)) === month);
    const entries = row.payEntries.filter((entry) => entryMonth(entry) === month);
    const payments = entries.filter((entry) => entry.kind === 'PAYMENT');
    return {
      ...figures,
      staffId: row.id,
      name: row.name,
      jobTitle: row.jobTitle,
      isActive: row.isActive,
      joinedOn: fromDbDateOrNull(row.joinedOn),
      countedFrom: countedFrom(row),
      outletId: outlet.id,
      outletName: outlet.name,
      organizationName: outlet.organization.name,
      overtimeHours: record?.overtimeHours ?? 0,
      note: record?.note ?? null,
      entries: entries.map((entry) => ({
        id: entry.id,
        kind: entry.kind,
        date: fromDbDate(entry.date),
        amountPaise: entry.amountPaise,
        note: entry.note,
      })),
      lastPaidOn: payments.length ? fromDbDate(payments[payments.length - 1]!.date) : null,
      selfLocked,
    };
  }

  private async toDtos(user: AuthUser, outlet: OutletRow, rows: StaffRow[]): Promise<StaffMemberDto[]> {
    // Pay is shown only to someone who may read the salary tracker here.
    const seesPay = can(user.memberships, 'salary', 'read', { organizationId: outlet.organizationId, outletId: outlet.id });
    const loginIds = [...new Set(rows.map((row) => row.userId).filter((id): id is string => id !== null))];
    const logins = loginIds.length ? await this.db.user.findMany({ where: { id: { in: loginIds } }, select: { id: true, name: true } }) : [];
    const nameOf = new Map(logins.map((login) => [login.id, login.name]));
    return rows.map((row) => ({
      id: row.id,
      outletId: row.outletId,
      name: row.name,
      jobTitle: row.jobTitle,
      phone: row.phone,
      joinedOn: fromDbDateOrNull(row.joinedOn),
      countedFrom: countedFrom(row),
      leftOn: fromDbDateOrNull(row.leftOn),
      isActive: row.isActive,
      weeklyOffDay: row.weeklyOffDay,
      userId: row.userId,
      userName: row.userId ? (nameOf.get(row.userId) ?? null) : null,
      pay: seesPay ? { payType: row.payType, payPaise: rateOf(row) } : null,
      hasRecords: row._count.attendance + row._count.salaries + row._count.payEntries + row._count.punches > 0,
      selfLocked: this.selfLocked(user, outlet, row),
    }));
  }

  /** A person can be linked to an app login of the same outlet, and a login to one person only. */
  private async checkLogin(outletId: string, userId: string, staffId: string | null): Promise<void> {
    const membership = await this.db.membership.findFirst({ where: { userId, outletId, role: { in: ['MANAGER', 'HEAD_CHEF'] } } });
    if (!membership) throw new BadRequestException('That app login does not belong to this outlet');
    const taken = await this.db.staffMember.findFirst({ where: { userId, ...(staffId && { id: { not: staffId } }) } });
    if (taken) throw new BadRequestException('That app login is already linked to someone else');
  }

  /** Checks the user may do this at the outlet. ECCS roles have no grant on these resources, so are always refused. */
  private async requireOutlet(user: AuthUser, resource: Resource, action: Action, outletId: string, asNotFound = false): Promise<OutletRow> {
    const outlet = await this.db.outlet.findUnique({ where: { id: outletId }, select: outletSelect });
    if (!outlet || !can(user.memberships, resource, action, { organizationId: outlet.organizationId, outletId })) {
      throw asNotFound ? new NotFoundException('Not found') : new ForbiddenException('You cannot do this at this outlet');
    }
    return outlet;
  }

  /** The person, if the user may do this at their outlet. "Not found" and "not yours" look the same. */
  private async requireStaff(user: AuthUser, resource: Resource, action: Action, staffId: string) {
    const row = await this.db.staffMember.findUnique({ where: { id: staffId }, include: staffInclude });
    if (!row) throw new NotFoundException('Not found');
    const outlet = await this.requireOutlet(user, resource, action, row.outletId, true);
    return { row, outlet };
  }
}
