import { BadRequestException, Body, Controller, Delete, Get, HttpCode, Param, Patch, Post, Query } from '@nestjs/common';
import {
  createFoodItemSchema,
  createFoodLabelSchema,
  renderLabelSchema,
  updateFoodItemSchema,
} from '@eccs/shared';
import type { z } from 'zod';
import { Activity } from '../activity-log/activity.decorator.js';
import { CurrentUser, RequirePermission } from '../auth/auth.decorators.js';
import type { AuthUser } from '../auth/auth.types.js';
import { ZodValidationPipe } from '../common/zod-validation.pipe.js';
import { FoodLabelsService } from './food-labels.service.js';

// The decorators check that the role allows the action at all; the service
// then checks it is allowed at the specific outlet.
//
// One permission, "foodLabels", covers both halves. "create" is printing a label
// and saving a new one (a name and how long it keeps), which the Owner, the
// Manager and the Head Chef all hold, so anyone in the kitchen can make a label
// for whatever they want (founder, 9 Oct 2026). "update" is changing or
// removing a saved label, which only the Owner and the Manager hold.
@Controller('food-labels')
export class FoodLabelsController {
  constructor(private readonly labels: FoodLabelsService) {}

  // ───────────────────────── Items ─────────────────────────

  @Get('items')
  @RequirePermission('foodLabels', 'read')
  items(@CurrentUser() user: AuthUser, @Query('outletId') outletId?: string, @Query('all') all?: string) {
    return this.labels.listItems(user, required(outletId), all === '1');
  }

  @Post('items')
  @RequirePermission('foodLabels', 'create')
  @Activity('foodLabels.item.added', { entity: 'foodItem', from: 'answer', facts: ['shelfLifeHours'] })
  createItem(
    @CurrentUser() user: AuthUser,
    @Body(new ZodValidationPipe(createFoodItemSchema)) body: z.output<typeof createFoodItemSchema>,
  ) {
    return this.labels.createItem(user, body);
  }

  @Patch('items/:id')
  @RequirePermission('foodLabels', 'update')
  @Activity('foodLabels.item.changed', { entity: 'foodItem', facts: ['shelfLifeHours', 'isActive'] })
  updateItem(
    @CurrentUser() user: AuthUser,
    @Param('id') id: string,
    @Body(new ZodValidationPipe(updateFoodItemSchema)) body: z.output<typeof updateFoodItemSchema>,
  ) {
    return this.labels.updateItem(user, id, body);
  }

  /** Deletes an item no label was ever made for; one with labels is retired instead and kept. */
  @Delete('items/:id')
  @RequirePermission('foodLabels', 'update')
  @Activity('foodLabels.item.removed', { entity: 'foodItem' })
  removeItem(@CurrentUser() user: AuthUser, @Param('id') id: string) {
    return this.labels.removeItem(user, id);
  }

  // ───────────────────────── Labels ─────────────────────────

  /** Records one printing: a saved label, how many stickers, and the moment Print was pressed. */
  @Post('labels')
  @RequirePermission('foodLabels', 'create')
  @Activity('foodLabels.label.printed', { entity: 'foodLabel', from: 'answer', facts: ['copies'] })
  create(
    @CurrentUser() user: AuthUser,
    @Body(new ZodValidationPipe(createFoodLabelSchema)) body: z.output<typeof createFoodLabelSchema>,
  ) {
    return this.labels.createLabel(user, body);
  }

  /** Notes that the label was sent to a printer or shared. */
  @Post('labels/:id/printed')
  @HttpCode(200)
  @RequirePermission('foodLabels', 'create')
  @Activity('foodLabels.label.sent', { entity: 'foodLabel' })
  printed(@CurrentUser() user: AuthUser, @Param('id') id: string) {
    return this.labels.markPrinted(user, id);
  }

  /** Draws a label as a picture, to hand to a label printer's own app. Nothing is saved. */
  @Post('render')
  @HttpCode(200)
  @RequirePermission('foodLabels', 'create')
  @Activity('foodLabels.label.drawn')
  render(@Body(new ZodValidationPipe(renderLabelSchema)) body: z.output<typeof renderLabelSchema>) {
    return this.labels.render(body);
  }
}

function required(outletId: string | undefined): string {
  if (!outletId) throw new BadRequestException('outletId is required');
  return outletId;
}
