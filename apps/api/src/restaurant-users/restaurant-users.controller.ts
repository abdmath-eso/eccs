import { Body, Controller, Get, Param, Patch, Post } from '@nestjs/common';
import { createRestaurantUserSchema, updateRestaurantUserSchema } from '@eccs/shared';
import type { z } from 'zod';
import { Activity } from '../activity-log/activity.decorator.js';
import { CurrentUser, RequirePermission } from '../auth/auth.decorators.js';
import type { AuthUser } from '../auth/auth.types.js';
import { ZodValidationPipe } from '../common/zod-validation.pipe.js';
import { RestaurantUsersService } from './restaurant-users.service.js';

@Controller('restaurant-users')
export class RestaurantUsersController {
  constructor(private readonly users: RestaurantUsersService) {}

  @Get()
  @RequirePermission('restaurantUsers', 'read')
  list(@CurrentUser() actor: AuthUser) {
    return this.users.list(actor);
  }

  @Post()
  @RequirePermission('restaurantUsers', 'create')
  // Never the PIN the answer carries.
  @Activity('appLogins.user.added', { entity: 'user', from: 'answer', key: 'user.id', facts: ['role'] })
  create(
    @CurrentUser() actor: AuthUser,
    @Body(new ZodValidationPipe(createRestaurantUserSchema)) body: z.output<typeof createRestaurantUserSchema>,
  ) {
    return this.users.create(actor, body);
  }

  @Post(':id/reset-pin')
  @RequirePermission('restaurantUsers', 'update')
  @Activity('appLogins.pin.reset', { entity: 'user' })
  resetPin(@CurrentUser() actor: AuthUser, @Param('id') id: string) {
    return this.users.resetPin(actor, id);
  }

  @Patch(':id')
  @RequirePermission('restaurantUsers', 'update')
  @Activity('appLogins.user.changed', { entity: 'user', facts: ['isActive', 'role'] })
  update(
    @CurrentUser() actor: AuthUser,
    @Param('id') id: string,
    @Body(new ZodValidationPipe(updateRestaurantUserSchema)) body: z.output<typeof updateRestaurantUserSchema>,
  ) {
    return this.users.update(actor, id, body);
  }
}
