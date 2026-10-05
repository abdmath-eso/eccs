import { BadRequestException, Body, Controller, Delete, Get, HttpCode, Param, Post, Put, Query } from '@nestjs/common';
import { addChecklistItemSchema, answerChecklistItemSchema } from '@eccs/shared';
import type { z } from 'zod';
import { CurrentUser, RequirePermission } from '../auth/auth.decorators.js';
import type { AuthUser } from '../auth/auth.types.js';
import { ZodValidationPipe } from '../common/zod-validation.pipe.js';
import { ChecklistsService } from './checklists.service.js';

function requireOutletId(outletId: string | undefined): string {
  if (!outletId) throw new BadRequestException('outletId is required');
  return outletId;
}

// The decorators check that the role allows the action at all; the service
// then checks it is allowed at the specific outlet.
@Controller('checklists')
export class ChecklistsController {
  constructor(private readonly checklists: ChecklistsService) {}

  @Get('today')
  @RequirePermission('checklists', 'read')
  today(@CurrentUser() user: AuthUser, @Query('outletId') outletId?: string) {
    return this.checklists.today(user, requireOutletId(outletId));
  }

  @Get('history')
  @RequirePermission('checklists', 'read')
  history(@CurrentUser() user: AuthUser, @Query('outletId') outletId?: string, @Query('days') days?: string) {
    return this.checklists.history(user, requireOutletId(outletId), Number(days ?? 7));
  }

  @Get('runs/:runId')
  @RequirePermission('checklists', 'read')
  run(@CurrentUser() user: AuthUser, @Param('runId') runId: string) {
    return this.checklists.getRun(user, runId);
  }

  @Put('runs/:runId/items/:itemId')
  @RequirePermission('checklists', 'create')
  answer(
    @CurrentUser() user: AuthUser,
    @Param('runId') runId: string,
    @Param('itemId') itemId: string,
    @Body(new ZodValidationPipe(answerChecklistItemSchema)) body: z.output<typeof answerChecklistItemSchema>,
  ) {
    return this.checklists.answer(user, runId, itemId, body);
  }

  @Post('runs/:runId/submit')
  @HttpCode(200)
  @RequirePermission('checklists', 'create')
  submit(@CurrentUser() user: AuthUser, @Param('runId') runId: string) {
    return this.checklists.submit(user, runId);
  }

  @Post('runs/:runId/review')
  @HttpCode(200)
  @RequirePermission('checklists', 'approve')
  review(@CurrentUser() user: AuthUser, @Param('runId') runId: string) {
    return this.checklists.review(user, runId);
  }

  @Get('setup')
  @RequirePermission('checklists', 'read')
  setup(@CurrentUser() user: AuthUser, @Query('outletId') outletId?: string) {
    return this.checklists.outletChecklists(user, requireOutletId(outletId));
  }

  @Post('setup/:outletChecklistId/items')
  @RequirePermission('checklists', 'update')
  addItem(
    @CurrentUser() user: AuthUser,
    @Param('outletChecklistId') outletChecklistId: string,
    @Body(new ZodValidationPipe(addChecklistItemSchema)) body: z.output<typeof addChecklistItemSchema>,
  ) {
    return this.checklists.addItem(user, outletChecklistId, body.label);
  }

  @Delete('setup/items/:itemId')
  @RequirePermission('checklists', 'update')
  removeItem(@CurrentUser() user: AuthUser, @Param('itemId') itemId: string) {
    return this.checklists.removeItem(user, itemId);
  }
}
