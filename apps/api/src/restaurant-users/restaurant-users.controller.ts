import { Body, Controller, Get, Param, Patch, Post } from '@nestjs/common';
import { createRestaurantUserSchema, updateRestaurantUserSchema } from '@eccs/shared';
import type { z } from 'zod';
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
  create(
    @CurrentUser() actor: AuthUser,
    @Body(new ZodValidationPipe(createRestaurantUserSchema)) body: z.output<typeof createRestaurantUserSchema>,
  ) {
    return this.users.create(actor, body);
  }

  @Post(':id/reset-pin')
  @RequirePermission('restaurantUsers', 'update')
  resetPin(@CurrentUser() actor: AuthUser, @Param('id') id: string) {
    return this.users.resetPin(actor, id);
  }

  @Patch(':id')
  @RequirePermission('restaurantUsers', 'update')
  update(
    @CurrentUser() actor: AuthUser,
    @Param('id') id: string,
    @Body(new ZodValidationPipe(updateRestaurantUserSchema)) body: z.output<typeof updateRestaurantUserSchema>,
  ) {
    return this.users.update(actor, id, body);
  }
}
