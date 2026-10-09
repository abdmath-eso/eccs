import { BadRequestException, ConflictException, ForbiddenException, Injectable, NotFoundException } from '@nestjs/common';
import type { Prisma } from '@eccs/db';
import {
  attendanceDateVerdict,
  attendanceTotals,
  can,
  earliestCorrectableDate,
  isCalendarDate,
  isMonth,
  monthBounds,
  monthOfDate,
  shiftMonth,
  staffSalaryMonth,
  weekdayOf,
  worksOn,
  type Action,
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
import type { AuthUser } from '../auth/auth.types.js';
import { indiaDate } from '../checklists/checklists.service.js';
import { PrismaService } from '../prisma/prisma.service.js';

const toDbDate = (date: string) => new Date(`${date}T00:00:00.000Z`);
const fromDbDate = (date: Date) => date.toISOString().slice(0, 10);
const fromDbDateOrNull = (date: Date | null) => (date ? fromDbDate(date) : null);

const outletSelect = { id: true, name: true, organizationId: true, organization: { select: { name: true } } } as const;
type OutletRow = Prisma.OutletGetPayload<{ select: typeof outletSelect }>;

const staffInclude = { _count: { select: { attendance: true, salaries: true, payEntries: true } } } as const;
type StaffRow = Prisma.StaffMemberGetPayload<{ include: typeof staffInclude }>;

// Everything the salary arithmetic needs about a person: every mark, typed figure and pay entry.
const salaryInclude = {
  attendance: { select: { date: true, status: true } },
  salaries: true,
  payEntries: { orderBy: [{ date: 'asc' }, { createdAt: 'asc' }] },
} as const satisfies Prisma.StaffMemberInclude;
type SalaryRow = Prisma.StaffMemberGetPayload<{ include: typeof salaryInclude }>;

type PersonDates = { joinedOn: Date | null; leftOn: Date | null };
const datesOf = (person: PersonDates) => ({ joinedOn: fromDbDateOrNull(person.joinedOn), leftOn: fromDbDateOrNull(person.leftOn) });
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
 * the Head Chef may only mark today's attendance.
 */
@Injectable()
export class StaffService {
  constructor(private readonly prisma: PrismaService) {}

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
    if (input.userId) await this.checkLogin(outlet.id, input.userId, null);
    const row = await this.db.staffMember.create({
      data: {
        outletId: outlet.id,
        name: input.name,
        jobTitle: input.jobTitle ?? null,
        phone: input.phone ?? null,
        joinedOn: input.joinedOn ? toDbDate(input.joinedOn) : null,
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
    const today = indiaDate();

    if (input.userId) await this.checkLogin(outlet.id, input.userId, row.id);
    const joinedOn = input.joinedOn !== undefined ? input.joinedOn : fromDbDateOrNull(row.joinedOn);
    if (input.leftOn) {
      if (input.leftOn > today) throw new BadRequestException('The last day cannot be after today');
      if (joinedOn && input.leftOn < joinedOn) throw new BadRequestException('The last day cannot be before the joining date');
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
    return (await this.toDtos(user, outlet, [updated]))[0]!;
  }

  /**
   * Removes a person added by mistake. Someone with any attendance, advance,
   * payment or pay figure is never deleted: they are marked as having left.
   */
  async removePerson(user: AuthUser, staffId: string): Promise<void> {
    const { row } = await this.requireStaff(user, 'staff', 'update', staffId);
    if (row._count.attendance + row._count.salaries + row._count.payEntries > 0) {
      throw new ConflictException('This person has records. Mark them as having left instead.');
    }
    await this.db.staffMember.delete({ where: { id: row.id } });
  }

  // ───────────────────────── Attendance ─────────────────────────

  /**
   * One day's sheet for the outlet: everyone who was on the staff that day and
   * how they are marked. The Head Chef gets today's only.
   */
  async day(user: AuthUser, outletId: string, date: string | undefined): Promise<AttendanceDayDto> {
    const outlet = await this.requireOutlet(user, 'attendance', 'create', outletId);
    const today = indiaDate();
    const day = date ?? today;
    if (!isCalendarDate(day)) throw new BadRequestException('Give the date as YYYY-MM-DD');
    const mayCorrect = this.mayCorrect(user, outlet);
    const verdict = attendanceDateVerdict(day, today, mayCorrect);
    if (verdict === 'FUTURE') throw new BadRequestException('Attendance cannot be marked for a day that has not come');
    if (verdict === 'TODAY_ONLY') throw new ForbiddenException("You can mark today's attendance only");

    const rows = await this.db.staffMember.findMany({
      where: { outletId },
      include: { attendance: { where: { date: toDbDate(day) } } },
      orderBy: { name: 'asc' },
    });
    const people = rows.filter((row) => worksOn(datesOf(row), day));
    const markerIds = [...new Set(people.map((row) => row.attendance[0]?.markedById).filter((id): id is string => !!id))];
    const markers = markerIds.length
      ? await this.db.user.findMany({ where: { id: { in: markerIds } }, select: { id: true, name: true } })
      : [];
    const nameOf = new Map(markers.map((marker) => [marker.id, marker.name]));

    return {
      outletId,
      date: day,
      today,
      earliestDate: mayCorrect ? earliestCorrectableDate(today) : today,
      editable: verdict === 'OK',
      people: people.map((row) => {
        const mark = row.attendance[0];
        return {
          staffId: row.id,
          name: row.name,
          jobTitle: row.jobTitle,
          status: mark?.status ?? null,
          usualDayOff: row.weeklyOffDay !== null && weekdayOf(day) === row.weeklyOffDay,
          markedByName: mark?.markedById ? (nameOf.get(mark.markedById) ?? null) : null,
        };
      }),
    };
  }

  /**
   * Marks, changes or clears attendance for a day. Today for anyone who may
   * mark; back to the start of last month for the Owner and Manager; never a
   * day that has not come.
   */
  async mark(
    user: AuthUser,
    input: { outletId: string; date: string; marks: { staffId: string; status: AttendanceStatus | null }[] },
  ): Promise<AttendanceDayDto> {
    const outlet = await this.requireOutlet(user, 'attendance', 'create', input.outletId);
    const today = indiaDate();
    const verdict = attendanceDateVerdict(input.date, today, this.mayCorrect(user, outlet));
    if (verdict === 'FUTURE') throw new BadRequestException('Attendance cannot be marked for a day that has not come');
    if (verdict === 'TOO_OLD') throw new BadRequestException('That day is too long ago to change');
    if (verdict === 'TODAY_ONLY') throw new ForbiddenException("You can mark today's attendance only");

    const ids = [...new Set(input.marks.map((mark) => mark.staffId))];
    const staff = await this.db.staffMember.findMany({ where: { id: { in: ids }, outletId: outlet.id } });
    if (staff.length !== ids.length || staff.some((row) => !worksOn(datesOf(row), input.date))) {
      throw new BadRequestException('Someone in the list was not on the staff of this outlet that day');
    }

    const date = toDbDate(input.date);
    await this.db.$transaction(
      input.marks.map((mark) =>
        mark.status === null
          ? this.db.attendanceRecord.deleteMany({ where: { staffMemberId: mark.staffId, date } })
          : this.db.attendanceRecord.upsert({
              where: { staffMemberId_date: { staffMemberId: mark.staffId, date } },
              create: { staffMemberId: mark.staffId, date, status: mark.status, markedById: user.id },
              update: { status: mark.status, markedById: user.id },
            }),
      ),
    );
    return this.day(user, outlet.id, input.date);
  }

  /** The outlet's month: each person's days present, half days, absences, leave and weekly offs. */
  async outletMonth(user: AuthUser, outletId: string, month: string | undefined): Promise<AttendanceMonthDto> {
    const outlet = await this.requireOutlet(user, 'attendance', 'read', outletId);
    const today = indiaDate();
    const wanted = this.monthOrThis(month, today);
    const { first, last } = monthBounds(wanted);
    const rows = await this.db.staffMember.findMany({
      where: { outletId: outlet.id },
      include: { attendance: { where: { date: { gte: toDbDate(first), lte: toDbDate(last) } }, select: { date: true, status: true } } },
      orderBy: { name: 'asc' },
    });
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
    const today = indiaDate();
    const wanted = this.monthOrThis(month, today);
    const { first, last } = monthBounds(wanted);
    const range = { gte: toDbDate(first), lte: toDbDate(last) };
    const [attendance, checklistsHandedIn] = await Promise.all([
      this.db.attendanceRecord.findMany({ where: { staffMemberId: row.id, date: range }, select: { date: true, status: true } }),
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
      earliestDate: this.mayCorrect(user, outlet) ? earliestCorrectableDate(today) : today,
      marks,
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
    const today = indiaDate();
    const wanted = this.monthOrThis(month, today);
    const rows = await this.db.staffMember.findMany({ where: { outletId: outlet.id }, include: salaryInclude, orderBy: { name: 'asc' } });
    return {
      outletId: outlet.id,
      month: wanted,
      today,
      people: rows
        .map((row) => this.toSalaryDto(row, outlet, wanted, today))
        .filter((person) => person.totals.countedDays > 0 || person.entries.length > 0 || person.balancePaise !== 0),
    };
  }

  async personSalary(user: AuthUser, staffId: string, month: string | undefined): Promise<SalaryMonthDto> {
    const { row, outlet } = await this.requireStaff(user, 'salary', 'read', staffId);
    const today = indiaDate();
    return this.salaryOf(row.id, outlet, this.monthOrThis(month, today), today);
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
    const today = indiaDate();
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
    return this.refreshCopies(row.id, outlet, wanted, today);
  }

  /** Records an advance given, or a payment of the month's pay, on its own date. */
  async addPayEntry(
    user: AuthUser,
    staffId: string,
    input: { kind: StaffPayEntryKind; month: string; date: string; amountPaise: number; note: string | null },
  ): Promise<SalaryMonthDto> {
    const { row, outlet } = await this.requireStaff(user, 'salary', 'create', staffId);
    const today = indiaDate();
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
    return this.refreshCopies(row.id, outlet, wanted, today);
  }

  /** Takes back an advance or payment entered by mistake. */
  async removePayEntry(user: AuthUser, entryId: string): Promise<SalaryMonthDto> {
    const entry = await this.db.staffPayEntry.findUnique({ where: { id: entryId } });
    if (!entry) throw new NotFoundException('Not found');
    const { row, outlet } = await this.requireStaff(user, 'salary', 'update', entry.staffMemberId);
    await this.db.staffPayEntry.delete({ where: { id: entry.id } });
    return this.refreshCopies(row.id, outlet, monthOfDate(fromDbDate(entry.month)), indiaDate());
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

  /** The Owner and Manager may correct past days; the Head Chef may only mark. */
  private mayCorrect(user: AuthUser, outlet: OutletRow): boolean {
    return can(user.memberships, 'attendance', 'update', { organizationId: outlet.organizationId, outletId: outlet.id });
  }

  private async salaryOf(staffId: string, outlet: OutletRow, month: string, today: string): Promise<SalaryMonthDto> {
    const row = await this.db.staffMember.findUniqueOrThrow({ where: { id: staffId }, include: salaryInclude });
    return this.toSalaryDto(row, outlet, month, today);
  }

  /**
   * After a change, brings the month's stored copies of the worked-out figures
   * up to date (where the month has a record), and answers with the month.
   */
  private async refreshCopies(staffId: string, outlet: OutletRow, month: string, today: string): Promise<SalaryMonthDto> {
    const dto = await this.salaryOf(staffId, outlet, month, today);
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

  private toSalaryDto(row: SalaryRow, outlet: OutletRow, month: string, today: string): SalaryMonthDto {
    const records: Record<string, SalaryMonthEntryInput> = {};
    for (const record of row.salaries) {
      records[monthOfDate(fromDbDate(record.month))] = {
        payType: record.payType,
        ratePaise: record.basePaise,
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
    };
  }

  private async toDtos(user: AuthUser, outlet: OutletRow, rows: StaffRow[]): Promise<StaffMemberDto[]> {
    // Pay is shown only to someone who may read the salary tracker here: not to the Head Chef.
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
      ...datesOf(row),
      isActive: row.isActive,
      weeklyOffDay: row.weeklyOffDay,
      userId: row.userId,
      userName: row.userId ? (nameOf.get(row.userId) ?? null) : null,
      pay: seesPay ? { payType: row.payType, payPaise: rateOf(row) } : null,
      hasRecords: row._count.attendance + row._count.salaries + row._count.payEntries > 0,
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
