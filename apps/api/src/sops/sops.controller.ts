import { BadRequestException, Body, Controller, Delete, Get, HttpCode, Param, Patch, Post, Query } from '@nestjs/common';
import { addSopFromLibrarySchema, createSopSchema, updateSopSchema } from '@eccs/shared';
import type { z } from 'zod';
import { CurrentUser, RequirePermission } from '../auth/auth.decorators.js';
import type { AuthUser } from '../auth/auth.types.js';
import { ZodValidationPipe } from '../common/zod-validation.pipe.js';
import { SopsService } from './sops.service.js';

function requireOutletId(outletId: string | undefined): string {
  if (!outletId) throw new BadRequestException('outletId is required');
  return outletId;
}

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

  // The library routes are declared before ':id', so "library" is not taken for an SOP's id.

  /** What the library holds, by category and section, for browsing. */
  @Get('library/overview')
  @RequirePermission('sopTemplates', 'create')
  libraryOverview(@CurrentUser() user: AuthUser, @Query('outletId') outletId?: string) {
    return this.sops.libraryOverview(user, requireOutletId(outletId));
  }

  /** Ready-made SOPs matching `q`, or in a `category` or `section`. */
  @Get('library')
  @RequirePermission('sopTemplates', 'create')
  searchLibrary(
    @CurrentUser() user: AuthUser,
    @Query('outletId') outletId?: string,
    @Query('q') search?: string,
    @Query('category') category?: string,
    @Query('section') section?: string,
  ) {
    return this.sops.searchLibrary(user, {
      outletId: requireOutletId(outletId),
      search,
      category: category || undefined,
      section: section || undefined,
    });
  }

  @Get('library/:itemId')
  @RequirePermission('sopTemplates', 'create')
  libraryItem(@CurrentUser() user: AuthUser, @Param('itemId') itemId: string, @Query('outletId') outletId?: string) {
    return this.sops.libraryItem(user, requireOutletId(outletId), itemId);
  }

  /** Copies a library SOP into the outlet's own SOPs. */
  @Post('library/:itemId/add')
  @RequirePermission('sopTemplates', 'create')
  addFromLibrary(
    @CurrentUser() user: AuthUser,
    @Param('itemId') itemId: string,
    @Body(new ZodValidationPipe(addSopFromLibrarySchema)) body: z.output<typeof addSopFromLibrarySchema>,
  ) {
    return this.sops.addFromLibrary(user, body.outletId, itemId);
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
