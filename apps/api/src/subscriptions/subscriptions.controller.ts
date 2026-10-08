import { Body, Controller, Get, HttpCode, Param, Patch, Post } from '@nestjs/common';
import {
  cancelSubscriptionSchema,
  changeSubscriptionPlanSchema,
  createPlanSchema,
  startSubscriptionSchema,
  updatePlanSchema,
} from '@eccs/shared';
import type { z } from 'zod';
import { CurrentUser, RequirePermission } from '../auth/auth.decorators.js';
import type { AuthUser } from '../auth/auth.types.js';
import { ZodValidationPipe } from '../common/zod-validation.pipe.js';
import { SubscriptionsService } from './subscriptions.service.js';

// Two things live here. Plans, which only Super Admins and Operations Managers
// manage (catalog:create and catalog:update), while anyone who may see the
// catalogue may read the plans on offer. And an outlet's subscription: the
// permission on each route is the coarse check by role; the service then
// checks the outlet itself (the Owner's own restaurant, or ECCS).
@Controller()
export class SubscriptionsController {
  constructor(private readonly subscriptions: SubscriptionsService) {}

  // ───────────────────────── Plans ─────────────────────────

  /** The plans a restaurant can subscribe to, with what each includes and its price with GST. */
  @Get('subscription-plans')
  @RequirePermission('catalog', 'read')
  offered() {
    return this.subscriptions.offered();
  }

  /** Every plan, offered or not, with how many outlets are on it: the console's Plans page. */
  @Get('subscription-plans/all')
  @RequirePermission('catalog', 'update')
  adminOverview() {
    return this.subscriptions.adminOverview();
  }

  @Post('subscription-plans')
  @RequirePermission('catalog', 'create')
  createPlan(@Body(new ZodValidationPipe(createPlanSchema)) body: z.output<typeof createPlanSchema>) {
    return this.subscriptions.createPlan(body);
  }

  @Patch('subscription-plans/:id')
  @RequirePermission('catalog', 'update')
  updatePlan(@Param('id') id: string, @Body(new ZodValidationPipe(updatePlanSchema)) body: z.output<typeof updatePlanSchema>) {
    return this.subscriptions.updatePlan(id, body);
  }

  // ───────────────────────── An outlet's subscription ─────────────────────────

  @Get('outlets/:outletId/subscription')
  @RequirePermission('subscriptions', 'read')
  forOutlet(@CurrentUser() user: AuthUser, @Param('outletId') outletId: string) {
    return this.subscriptions.forOutlet(user, outletId);
  }

  @Post('outlets/:outletId/subscription')
  @RequirePermission('subscriptions', 'create')
  start(
    @CurrentUser() user: AuthUser,
    @Param('outletId') outletId: string,
    @Body(new ZodValidationPipe(startSubscriptionSchema)) body: z.output<typeof startSubscriptionSchema>,
  ) {
    return this.subscriptions.start(user, outletId, body);
  }

  @Post('outlets/:outletId/subscription/change-plan')
  @HttpCode(200)
  @RequirePermission('subscriptions', 'update')
  changePlan(
    @CurrentUser() user: AuthUser,
    @Param('outletId') outletId: string,
    @Body(new ZodValidationPipe(changeSubscriptionPlanSchema)) body: z.output<typeof changeSubscriptionPlanSchema>,
  ) {
    return this.subscriptions.changePlan(user, outletId, body.planCode);
  }

  @Post('outlets/:outletId/subscription/undo-change-plan')
  @HttpCode(200)
  @RequirePermission('subscriptions', 'update')
  undoChangePlan(@CurrentUser() user: AuthUser, @Param('outletId') outletId: string) {
    return this.subscriptions.undoChangePlan(user, outletId);
  }

  @Post('outlets/:outletId/subscription/pause')
  @HttpCode(200)
  @RequirePermission('subscriptions', 'update')
  pause(@CurrentUser() user: AuthUser, @Param('outletId') outletId: string) {
    return this.subscriptions.pause(user, outletId);
  }

  @Post('outlets/:outletId/subscription/resume')
  @HttpCode(200)
  @RequirePermission('subscriptions', 'update')
  resume(@CurrentUser() user: AuthUser, @Param('outletId') outletId: string) {
    return this.subscriptions.resume(user, outletId);
  }

  @Post('outlets/:outletId/subscription/cancel')
  @HttpCode(200)
  @RequirePermission('subscriptions', 'update')
  cancel(
    @CurrentUser() user: AuthUser,
    @Param('outletId') outletId: string,
    @Body(new ZodValidationPipe(cancelSubscriptionSchema)) body: z.output<typeof cancelSubscriptionSchema>,
  ) {
    return this.subscriptions.cancel(user, outletId, body.when);
  }

  /** Undoes a cancellation that has not taken effect yet. */
  @Post('outlets/:outletId/subscription/keep')
  @HttpCode(200)
  @RequirePermission('subscriptions', 'update')
  keep(@CurrentUser() user: AuthUser, @Param('outletId') outletId: string) {
    return this.subscriptions.keep(user, outletId);
  }
}
