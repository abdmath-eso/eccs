import {
  BadRequestException,
  Body,
  Controller,
  Delete,
  Get,
  HttpCode,
  Param,
  Patch,
  Post,
  Put,
  Query,
} from '@nestjs/common';
import {
  addChecklistItemSchema,
  answerChecklistItemSchema,
  createChecklistSchema,
  updateChecklistItemSchema,
  updateChecklistSchema,
} from '@eccs/shared';
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

  @Delete('runs/:runId/items/:itemId')
  @RequirePermission('checklists', 'create')
  clearAnswer(@CurrentUser() user: AuthUser, @Param('runId') runId: string, @Param('itemId') itemId: string) {
    return this.checklists.clearAnswer(user, runId, itemId);
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

  @Post('setup')
  @RequirePermission('checklists', 'update')
  createList(
    @CurrentUser() user: AuthUser,
    @Body(new ZodValidationPipe(createChecklistSchema)) body: z.output<typeof createChecklistSchema>,
  ) {
    return this.checklists.createList(user, body);
  }

  // Declared before the ":outletChecklistId" routes so "items" is not read as a checklist id.
  @Delete('setup/items/:itemId')
  @RequirePermission('checklists', 'update')
  removeItem(@CurrentUser() user: AuthUser, @Param('itemId') itemId: string) {
    return this.checklists.removeItem(user, itemId);
  }

  @Patch('setup/items/:itemId')
  @RequirePermission('checklists', 'update')
  updateItem(
    @CurrentUser() user: AuthUser,
    @Param('itemId') itemId: string,
    @Body(new ZodValidationPipe(updateChecklistItemSchema)) body: z.output<typeof updateChecklistItemSchema>,
  ) {
    return this.checklists.updateItem(user, itemId, body);
  }

  @Patch('setup/:outletChecklistId')
  @RequirePermission('checklists', 'update')
  updateList(
    @CurrentUser() user: AuthUser,
    @Param('outletChecklistId') outletChecklistId: string,
    @Body(new ZodValidationPipe(updateChecklistSchema)) body: z.output<typeof updateChecklistSchema>,
  ) {
    return this.checklists.updateList(user, outletChecklistId, body);
  }

  @Delete('setup/:outletChecklistId')
  @RequirePermission('checklists', 'update')
  removeList(@CurrentUser() user: AuthUser, @Param('outletChecklistId') outletChecklistId: string) {
    return this.checklists.removeList(user, outletChecklistId);
  }

  @Post('setup/:outletChecklistId/items')
  @RequirePermission('checklists', 'update')
  addItem(
    @CurrentUser() user: AuthUser,
    @Param('outletChecklistId') outletChecklistId: string,
    @Body(new ZodValidationPipe(addChecklistItemSchema)) body: z.output<typeof addChecklistItemSchema>,
  ) {
    return this.checklists.addItem(user, outletChecklistId, body);
  }

  @Get('setup/:outletChecklistId/suggestions')
  @RequirePermission('checklists', 'update')
  suggestions(
    @CurrentUser() user: AuthUser,
    @Param('outletChecklistId') outletChecklistId: string,
    @Query('q') search?: string,
  ) {
    return this.checklists.suggestions(user, outletChecklistId, (search ?? '').slice(0, 100));
  }

}
