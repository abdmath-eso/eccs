import { BadRequestException, Body, Controller, Delete, Get, HttpCode, Param, Patch, Post, Query } from '@nestjs/common';
import { createDocumentSchema, createLicenceSchema, updateLicenceSchema } from '@eccs/shared';
import type { z } from 'zod';
import { CurrentUser, RequirePermission } from '../auth/auth.decorators.js';
import type { AuthUser } from '../auth/auth.types.js';
import { ZodValidationPipe } from '../common/zod-validation.pipe.js';
import { LicencesService } from './licences.service.js';

// The decorators check that the role allows the action at all; the service
// then checks it is allowed at the specific outlet.
@Controller()
export class LicencesController {
  constructor(private readonly licences: LicencesService) {}

  @Get('licences')
  @RequirePermission('licences', 'read')
  list(@CurrentUser() user: AuthUser, @Query('outletId') outletId?: string, @Query('attention') attention?: string) {
    return this.licences.listLicences(user, { outletId: outletId || undefined, attentionOnly: attention === '1' });
  }

  @Post('licences')
  @RequirePermission('licences', 'create')
  create(
    @CurrentUser() user: AuthUser,
    @Body(new ZodValidationPipe(createLicenceSchema)) body: z.output<typeof createLicenceSchema>,
  ) {
    return this.licences.createLicence(user, body);
  }

  @Patch('licences/:id')
  @RequirePermission('licences', 'update')
  update(
    @CurrentUser() user: AuthUser,
    @Param('id') id: string,
    @Body(new ZodValidationPipe(updateLicenceSchema)) body: z.output<typeof updateLicenceSchema>,
  ) {
    return this.licences.updateLicence(user, id, body);
  }

  @Delete('licences/:id')
  @HttpCode(204)
  @RequirePermission('licences', 'update')
  async remove(@CurrentUser() user: AuthUser, @Param('id') id: string): Promise<void> {
    await this.licences.removeLicence(user, id);
  }

  @Get('documents')
  @RequirePermission('documents', 'read')
  documents(@CurrentUser() user: AuthUser, @Query('outletId') outletId?: string) {
    if (!outletId) throw new BadRequestException('outletId is required');
    return this.licences.listDocuments(user, outletId);
  }

  @Post('documents')
  @RequirePermission('documents', 'create')
  createDocument(
    @CurrentUser() user: AuthUser,
    @Body(new ZodValidationPipe(createDocumentSchema)) body: z.output<typeof createDocumentSchema>,
  ) {
    return this.licences.createDocument(user, body);
  }

  @Delete('documents/:id')
  @RequirePermission('documents', 'update')
  removeDocument(@CurrentUser() user: AuthUser, @Param('id') id: string) {
    return this.licences.removeDocument(user, id);
  }
}
