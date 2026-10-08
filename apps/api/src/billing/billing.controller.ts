import { BadRequestException, Body, Controller, Get, HttpCode, Param, Post, Query } from '@nestjs/common';
import {
  confirmPaymentSchema,
  INVOICE_STATUSES,
  recordPaymentSchema,
  startPaymentSchema,
  voidInvoiceSchema,
  type InvoiceStatus,
} from '@eccs/shared';
import { CurrentUser, RequirePermission } from '../auth/auth.decorators.js';
import type { AuthUser } from '../auth/auth.types.js';
import { ZodValidationPipe } from '../common/zod-validation.pipe.js';
import { BillingService } from './billing.service.js';

// Invoices and payments follow the "invoices" and "payments" rows of the
// permission table: the Owner and the Manager read, ECCS admins do
// everything, the Head Chef and the Supervisor have no access. Which rows each
// of them gets, and that only the Owner pays, is decided in the service.
@Controller()
export class BillingController {
  constructor(private readonly billing: BillingService) {}

  /** The newest first. Narrowed by `outletId`, `organizationId` (a client) and `status`. */
  @Get('invoices')
  @RequirePermission('invoices', 'read')
  list(
    @CurrentUser() user: AuthUser,
    @Query('outletId') outletId?: string,
    @Query('organizationId') organizationId?: string,
    @Query('status') status?: string,
  ) {
    if (status && !INVOICE_STATUSES.includes(status as InvoiceStatus)) throw new BadRequestException('Unknown status');
    return this.billing.list(user, {
      outletId: outletId || undefined,
      organizationId: organizationId || undefined,
      status: (status as InvoiceStatus) || undefined,
    });
  }

  /** What is owed and how overdue the oldest unpaid invoice is: in all, by client and by outlet. */
  @Get('invoices/dues')
  @RequirePermission('invoices', 'read')
  dues(@CurrentUser() user: AuthUser, @Query('outletId') outletId?: string) {
    return this.billing.dues(user, { outletId: outletId || undefined });
  }

  /** Due, overdue and collected this month, for the top of the console's page. */
  @Get('invoices/totals')
  @RequirePermission('invoices', 'update')
  totals(@CurrentUser() user: AuthUser) {
    return this.billing.totals(user);
  }

  /** ECCS raises, now, the invoice of every plan whose cycle has begun and has none. Safe to press twice. */
  @Post('invoices/raise-due')
  @HttpCode(200)
  @RequirePermission('invoices', 'create')
  raiseDue(@CurrentUser() user: AuthUser) {
    return this.billing.raiseDue(user);
  }

  @Get('invoices/:id')
  @RequirePermission('invoices', 'read')
  get(@CurrentUser() user: AuthUser, @Param('id') id: string) {
    return this.billing.get(user, id);
  }

  /** A signed link to the invoice as a PDF, for anyone who may read it. */
  @Post('invoices/:id/pdf')
  @HttpCode(200)
  @RequirePermission('invoices', 'read')
  pdf(@CurrentUser() user: AuthUser, @Param('id') id: string) {
    return this.billing.pdf(user, id);
  }

  @Post('invoices/:id/void')
  @HttpCode(200)
  @RequirePermission('invoices', 'update')
  void(
    @CurrentUser() user: AuthUser,
    @Param('id') id: string,
    @Body(new ZodValidationPipe(voidInvoiceSchema)) body: { reason: string },
  ) {
    return this.billing.void(user, id, body.reason);
  }

  /** After a void: a new invoice for the same visit or the same cycle of the plan. */
  @Post('invoices/:id/raise-again')
  @HttpCode(200)
  @RequirePermission('invoices', 'create')
  raiseAgain(@CurrentUser() user: AuthUser, @Param('id') id: string) {
    return this.billing.raiseAgain(user, id);
  }

  /** The Owner starts paying in the app. */
  @Post('invoices/:id/payments')
  @HttpCode(200)
  @RequirePermission('payments', 'create')
  startPayment(
    @CurrentUser() user: AuthUser,
    @Param('id') id: string,
    @Body(new ZodValidationPipe(startPaymentSchema)) body: { method: string },
  ) {
    return this.billing.startPayment(user, id, body);
  }

  /** ECCS records a payment received outside the app. */
  @Post('invoices/:id/payments/manual')
  @HttpCode(200)
  @RequirePermission('payments', 'update')
  recordPayment(
    @CurrentUser() user: AuthUser,
    @Param('id') id: string,
    @Body(new ZodValidationPipe(recordPaymentSchema))
    body: { id?: string | undefined; method: string; amountPaise: number; paidOn: string; reference?: string | undefined },
  ) {
    return this.billing.recordPayment(user, id, body);
  }

  /** The payment screen reports how a payment ended. Sending it twice changes nothing. */
  @Post('payments/:id/confirm')
  @HttpCode(200)
  @RequirePermission('payments', 'create')
  confirmPayment(
    @CurrentUser() user: AuthUser,
    @Param('id') id: string,
    @Body(new ZodValidationPipe(confirmPaymentSchema)) body: Record<string, unknown>,
  ) {
    return this.billing.confirmPayment(user, id, body);
  }

  /** One payment and its invoice as it stands now: the receipt. */
  @Get('payments/:id')
  @RequirePermission('invoices', 'read')
  receipt(@CurrentUser() user: AuthUser, @Param('id') id: string) {
    return this.billing.receipt(user, id);
  }
}
