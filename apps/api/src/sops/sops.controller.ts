import { Body, Controller, Delete, Get, HttpCode, Param, Patch, Post, Query } from '@nestjs/common';
import { createSopSchema, updateSopSchema } from '@eccs/shared';
import type { z } from 'zod';
import { CurrentUser, RequirePermission } from '../auth/auth.decorators.js';
import type { AuthUser } from '../auth/auth.types.js';
import { ZodValidationPipe } from '../common/zod-validation.pipe.js';
import { SopsService } from './sops.service.js';

// The decorators check that the role allows the action at all; the service
// then checks it is allowed for the specific SOP or outlet.
@Controller('sops')
export class SopsController {
  constructor(private readonly sops: SopsService) {}

  /** With `outletId`: what that outlet's staff see. Without: ECCS's standard SOPs, for the console. */
  @Get()
  @RequirePermission('sopTemplates', 'read')
  list(@CurrentUser() user: AuthUser, @Query('outletId') outletId?: string) {
    return this.sops.list(user, outletId || undefined);
  }

  @Get(':id')
  @RequirePermission('sopTemplates', 'read')
  get(@CurrentUser() user: AuthUser, @Param('id') id: string) {
    return this.sops.get(user, id);
  }

  @Post()
  @RequirePermission('sopTemplates', 'create')
  create(
    @CurrentUser() user: AuthUser,
    @Body(new ZodValidationPipe(createSopSchema)) body: z.output<typeof createSopSchema>,
  ) {
    return this.sops.create(user, body);
  }

  @Patch(':id')
  @RequirePermission('sopTemplates', 'update')
  update(
    @CurrentUser() user: AuthUser,
    @Param('id') id: string,
    @Body(new ZodValidationPipe(updateSopSchema)) body: z.output<typeof updateSopSchema>,
  ) {
    return this.sops.update(user, id, body);
  }

  @Delete(':id')
  @HttpCode(204)
  @RequirePermission('sopTemplates', 'update')
  async remove(@CurrentUser() user: AuthUser, @Param('id') id: string): Promise<void> {
    await this.sops.remove(user, id);
  }
}
