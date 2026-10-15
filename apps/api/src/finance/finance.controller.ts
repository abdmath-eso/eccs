import { BadRequestException, Body, Controller, Delete, Get, HttpCode, Param, Patch, Post, Put, Query, Res, UploadedFile, UseInterceptors } from '@nestjs/common';
import { FileInterceptor } from '@nestjs/platform-express';
import {
  budgetSchema,
  EXPORT_REGISTERS,
  expenseListQuerySchema,
  expenseSchema,
  financeQuerySchema,
  financeSettingsSchema,
  FINANCE_RULES,
  founderMoneySchema,
  markPaidSchema,
  openingBalanceSchema,
  type BudgetDto,
  type BudgetValues,
  type CashDayDetailDto,
  type CashOpeningDto,
  type ExpenseDto,
  type ExpenseListDto,
  type ExpenseListQuery,
  type ExpenseValues,
  type ExportRegister,
  type FinanceOverviewDto,
  type FinanceQuery,
  type FinanceSettingsDto,
  type FinanceVisitOptionDto,
  type FounderMoneyDto,
  type FounderMoneyValues,
  type PaidVia,
} from '@eccs/shared';
import type { Response } from 'express';
import { z } from 'zod';
import { noteActivity } from '../activity-log/activity-context.js';
import { Activity } from '../activity-log/activity.decorator.js';
import { CurrentUser, RequirePermission } from '../auth/auth.decorators.js';
import type { AuthUser } from '../auth/auth.types.js';
import { ZodValidationPipe } from '../common/zod-validation.pipe.js';
import { FinanceService } from './finance.service.js';

const dayQuerySchema = z.object({ date: z.string().regex(/^\d{4}-\d{2}-\d{2}$/, 'Enter the day as YYYY-MM-DD') });
const exportQuerySchema = z
  .object({ from: z.string().regex(/^\d{4}-\d{2}-\d{2}$/), to: z.string().regex(/^\d{4}-\d{2}-\d{2}$/) })
  .refine((value) => value.from <= value.to, 'The end comes before the start');

// The Finance page (15 Oct 2026). Every route needs the "finance" grant, which only the
// Super Admin holds (permissions.ts): the Ops Manager, the Supervisor and every
// restaurant user are refused (403). Every route that changes something carries an
// activity log key, with amounts and kinds only, never who was paid or what was typed.
@Controller('finance')
export class FinanceController {
  constructor(private readonly finance: FinanceService) {}

  /** Everything on the page for a period (`from`, `to`), against a budget (`budgetId`, else the default). */
  @Get('overview')
  @RequirePermission('finance', 'read')
  overview(@Query(new ZodValidationPipe(financeQuerySchema)) query: FinanceQuery): Promise<FinanceOverviewDto> {
    return this.finance.overview(query);
  }

  /** One day's cash: opening, in, out, closing. */
  @Get('day')
  @RequirePermission('finance', 'read')
  day(@Query(new ZodValidationPipe(dayQuerySchema)) query: { date: string }): Promise<CashDayDetailDto> {
    return this.finance.day(query.date);
  }

  /** The expense book, newest first, filtered by month, budget line, paid or not, and linked to a visit or not. */
  @Get('expenses')
  @RequirePermission('finance', 'read')
  list(@Query(new ZodValidationPipe(expenseListQuerySchema)) query: ExpenseListQuery): Promise<ExpenseListDto> {
    return this.finance.list(query);
  }

  /** Visits an expense can be linked to. */
  @Get('visits')
  @RequirePermission('finance', 'read')
  visits(): Promise<FinanceVisitOptionDto[]> {
    return this.finance.visitOptions();
  }

  /** One of the CA's three files for a period, as CSV. The download itself is logged. */
  @Get('export/:register')
  @RequirePermission('finance', 'read')
  @Activity('finance.books.exported', { reads: 'always', place: false })
  async export(
    @Param('register') register: string,
    @Query(new ZodValidationPipe(exportQuerySchema)) query: { from: string; to: string },
    @Res({ passthrough: true }) response: Response,
  ): Promise<string> {
    if (!(EXPORT_REGISTERS as readonly string[]).includes(register)) throw new BadRequestException('Unknown register');
    const { csv, rows, fileName } = await this.finance.exportCsv(register as ExportRegister, query.from, query.to);
    noteActivity({ details: { register, rows } });
    response.setHeader('Content-Type', 'text/csv; charset=utf-8');
    response.setHeader('Content-Disposition', `attachment; filename="${fileName}"`);
    response.setHeader('Cache-Control', 'private, no-store');
    response.setHeader('X-Export-Rows', String(rows));
    return csv;
  }

  // ───────────────────────── The expense book ─────────────────────────

  @Post('expenses')
  @RequirePermission('finance', 'create')
  @Activity('finance.expense.added', { entity: 'expense', from: 'answer', facts: ['kind', 'category', 'type', 'paidVia'] })
  create(@CurrentUser() user: AuthUser, @Body(new ZodValidationPipe(expenseSchema)) body: ExpenseValues): Promise<ExpenseDto> {
    return this.finance.createExpense(user, body);
  }

  /** Bills paid together. Declared before ":id" so its path is not read as an id. */
  @Post('expenses/mark-paid')
  @HttpCode(200)
  @RequirePermission('finance', 'update')
  @Activity('finance.expenses.markedPaid', { facts: ['paidVia'], answerFacts: ['updated'] })
  markPaid(@Body(new ZodValidationPipe(markPaidSchema)) body: { ids: string[]; paidVia: PaidVia; paidOn: string }): Promise<{ updated: number }> {
    return this.finance.markPaid(body);
  }

  @Patch('expenses/:id')
  @RequirePermission('finance', 'update')
  @Activity('finance.expense.changed', { entity: 'expense', facts: ['kind', 'category', 'type', 'paidVia'] })
  update(@Param('id') id: string, @Body(new ZodValidationPipe(expenseSchema)) body: ExpenseValues): Promise<ExpenseDto> {
    return this.finance.updateExpense(id, body);
  }

  @Delete('expenses/:id')
  @HttpCode(204)
  @RequirePermission('finance', 'update')
  @Activity('finance.expense.removed', { entity: 'expense' })
  remove(@Param('id') id: string): Promise<void> {
    return this.finance.removeExpense(id);
  }

  /** A receipt photo or PDF, filed before the expense is saved; its id goes in the form. */
  @Post('receipts')
  @UseInterceptors(FileInterceptor('file', { limits: { fileSize: FINANCE_RULES.maxReceiptBytes, files: 1 } }))
  @RequirePermission('finance', 'create')
  @Activity('finance.receipt.added', { entity: 'attachment', from: 'answer' })
  receipt(@CurrentUser() user: AuthUser, @UploadedFile() file: { buffer: Buffer; size: number } | undefined) {
    return this.finance.uploadReceipt(user, file);
  }

  // ───────────────────────── Budgets ─────────────────────────

  @Post('budgets')
  @RequirePermission('finance', 'create')
  @Activity('finance.budget.added', { entity: 'budget', from: 'answer' })
  createBudget(@Body(new ZodValidationPipe(budgetSchema)) body: BudgetValues): Promise<BudgetDto> {
    return this.finance.createBudget(body);
  }

  @Patch('budgets/:id')
  @RequirePermission('finance', 'update')
  @Activity('finance.budget.changed', { entity: 'budget' })
  updateBudget(@Param('id') id: string, @Body(new ZodValidationPipe(budgetSchema)) body: BudgetValues): Promise<BudgetDto> {
    return this.finance.updateBudget(id, body);
  }

  @Delete('budgets/:id')
  @HttpCode(204)
  @RequirePermission('finance', 'update')
  @Activity('finance.budget.removed', { entity: 'budget' })
  removeBudget(@Param('id') id: string): Promise<void> {
    return this.finance.removeBudget(id);
  }

  // ───────────────────────── Founders' money, opening balance, settings ─────────────────────────

  @Post('founders-money')
  @RequirePermission('finance', 'create')
  @Activity('finance.founderMoney.added', { entity: 'founderMoney', from: 'answer', facts: ['direction'] })
  addFounderMoney(@CurrentUser() user: AuthUser, @Body(new ZodValidationPipe(founderMoneySchema)) body: FounderMoneyValues): Promise<FounderMoneyDto> {
    return this.finance.addFounderMoney(user, body);
  }

  @Delete('founders-money/:id')
  @HttpCode(204)
  @RequirePermission('finance', 'update')
  @Activity('finance.founderMoney.removed', { entity: 'founderMoney' })
  removeFounderMoney(@Param('id') id: string): Promise<void> {
    return this.finance.removeFounderMoney(id);
  }

  @Put('opening-balance')
  @RequirePermission('finance', 'update')
  @Activity('finance.opening.saved', { entity: 'cashOpening', from: 'answer' })
  saveOpening(@CurrentUser() user: AuthUser, @Body(new ZodValidationPipe(openingBalanceSchema)) body: { asOf: string; bankPaise: number; cashPaise: number }): Promise<CashOpeningDto> {
    return this.finance.saveOpening(user, body);
  }

  @Put('settings')
  @RequirePermission('finance', 'update')
  @Activity('finance.settings.changed', { facts: ['collectedTargetPercent', 'usdToInrPaise'] })
  saveSettings(@Body(new ZodValidationPipe(financeSettingsSchema)) body: FinanceSettingsDto): Promise<FinanceSettingsDto> {
    return this.finance.saveSettings(body);
  }

  // ───────────────────────── Collections ─────────────────────────

  /**
   * "Remind" on an overdue invoice: the WhatsApp link with the reminder typed in. The
   * console opens it; nothing is sent by the server.
   */
  @Post('invoices/:id/remind')
  @HttpCode(200)
  @RequirePermission('finance', 'update')
  @Activity('finance.invoice.reminded', { entity: 'invoice' })
  remind(@Param('id') id: string): Promise<{ url: string; hasPhone: boolean }> {
    return this.finance.remind(id);
  }
}
