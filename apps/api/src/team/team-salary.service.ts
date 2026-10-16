import { Injectable, Logger } from '@nestjs/common';
import { salaryDescription, salaryMonths, type SalaryMonth } from '@eccs/shared';
import { indiaDate } from '../checklists/checklists.service.js';
import { PrismaService } from '../prisma/prisma.service.js';

// Salaries into Finance (16 Oct 2026): each team member's monthly salary becomes the
// Salaries line of the Finance page, as one row of the expense book per person per month,
// so Finance's own rules apply to it unchanged: the month's salary counts in that month
// (spread over its days on the weekly bars), it is a payout due until the Super Admin marks
// it paid, cash out on the day it is paid, held against the budget's Salaries line, and in
// what is left and the runway.
//
// The rows are made and kept up to date here, from the salaries on the Team page, every
// time Finance is read (a handful of people, so it takes a moment): a new month's row
// appears on its first day; a row not yet paid follows any change (a new salary, a joining
// or leaving date, the person's name); a row already paid is never touched, because that is
// what was paid. Nothing else writes these rows, and the expense book cannot change or
// remove them, so a salary is never counted twice. The arithmetic is salaryMonths in
// packages/shared/src/team.ts.

const toDb = (date: string) => new Date(`${date}T00:00:00.000Z`);
const fromDb = (date: Date) => date.toISOString().slice(0, 10);
const isUnique = (error: unknown) => (error as { code?: string }).code === 'P2002';

@Injectable()
export class TeamSalaryService {
  private readonly logger = new Logger(TeamSalaryService.name);

  constructor(private readonly prisma: PrismaService) {}

  private get db() {
    return this.prisma.client;
  }

  /** The rows Team should have in the expense book on `today`, by member and month. */
  async expected(today = indiaDate()): Promise<Map<string, { memberId: string; name: string; isSample: boolean; month: SalaryMonth }>> {
    const members = await this.db.teamMember.findMany({
      select: { id: true, joinedOn: true, leftOn: true, isSample: true, user: { select: { name: true } }, salaries: { select: { from: true, monthlyPaise: true } } },
    });
    const wanted = new Map<string, { memberId: string; name: string; isSample: boolean; month: SalaryMonth }>();
    for (const member of members) {
      const months = salaryMonths({
        joinedOn: fromDb(member.joinedOn),
        leftOn: member.leftOn ? fromDb(member.leftOn) : null,
        steps: member.salaries.map((step) => ({ from: fromDb(step.from), monthlyPaise: step.monthlyPaise })),
        today,
      });
      for (const month of months) wanted.set(`${member.id}|${month.month}`, { memberId: member.id, name: member.user.name, isSample: member.isSample, month });
    }
    return wanted;
  }

  /**
   * Brings the expense book's salary rows in line with Team: adds the months missing,
   * corrects the unpaid ones that differ, and removes unpaid ones Team no longer has (a
   * joining date moved later, a salary set to nothing). Paid rows are left as they are.
   * Never throws: Finance still shows what it has.
   */
  async sync(today = indiaDate()): Promise<{ added: number; changed: number; removed: number }> {
    const counts = { added: 0, changed: 0, removed: 0 };
    try {
      const [wanted, rows] = await Promise.all([
        this.expected(today),
        this.db.expense.findMany({
          where: { teamMemberId: { not: null } },
          select: { id: true, teamMemberId: true, salaryMonth: true, date: true, vendor: true, description: true, amountPaise: true, paidOn: true, dueDate: true },
        }),
      ]);
      const have = new Map(rows.map((row) => [`${row.teamMemberId}|${row.salaryMonth}`, row]));
      for (const [key, entry] of wanted) {
        const row = have.get(key);
        const data = {
          date: toDb(entry.month.firstDay),
          vendor: entry.name,
          description: salaryDescription(entry.month),
          amountPaise: entry.month.paise,
          dueDate: toDb(entry.month.dueDate),
        };
        if (!row) {
          try {
            await this.db.expense.create({
              data: { ...data, kind: 'EXPENSE', category: 'SALARIES', gstPaise: 0, teamMemberId: entry.memberId, salaryMonth: entry.month.month, isSample: entry.isSample },
            });
            counts.added += 1;
          } catch (error) {
            // Made a moment ago by another request reading Finance at the same time.
            if (!isUnique(error)) throw error;
          }
          continue;
        }
        if (row.paidOn) continue;
        const same =
          fromDb(row.date) === entry.month.firstDay &&
          row.vendor === data.vendor &&
          row.description === data.description &&
          row.amountPaise === data.amountPaise &&
          row.dueDate !== null &&
          fromDb(row.dueDate) === entry.month.dueDate;
        if (same) continue;
        await this.db.expense.update({ where: { id: row.id }, data });
        counts.changed += 1;
      }
      const stale = rows.filter((row) => !row.paidOn && !wanted.has(`${row.teamMemberId}|${row.salaryMonth}`)).map((row) => row.id);
      if (stale.length > 0) counts.removed = (await this.db.expense.deleteMany({ where: { id: { in: stale }, paidOn: null } })).count;
    } catch (error) {
      this.logger.warn(`Could not bring the salaries in from Team: ${String(error)}`);
    }
    return counts;
  }
}
