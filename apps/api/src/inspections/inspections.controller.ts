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
  UploadedFile,
  UseInterceptors,
} from '@nestjs/common';
import { FileInterceptor } from '@nestjs/platform-express';
import {
  answerInspectionCheckSchema,
  returnInspectionSchema,
  startInspectionSchema,
  updateInspectionSchema,
} from '@eccs/shared';
import { z } from 'zod';
import { CurrentUser, RequirePermission } from '../auth/auth.decorators.js';
import type { AuthUser } from '../auth/auth.types.js';
import { ZodValidationPipe } from '../common/zod-validation.pipe.js';
import { InspectionsService } from './inspections.service.js';

const MAX_UPLOAD_BYTES = 10 * 1024 * 1024;

@Controller('inspections')
export class InspectionsController {
  constructor(private readonly inspections: InspectionsService) {}

  @Get()
  @RequirePermission('inspections', 'read')
  list(@CurrentUser() user: AuthUser, @Query('outletId') outletId?: string) {
    return this.inspections.list(user, { outletId: outletId || undefined });
  }

  /** The outlets the person may start an inspection for. */
  @Get('outlets')
  @RequirePermission('inspections', 'create')
  outlets(@CurrentUser() user: AuthUser) {
    return this.inspections.outlets(user);
  }

  @Post()
  @RequirePermission('inspections', 'create')
  start(
    @CurrentUser() user: AuthUser,
    @Body(new ZodValidationPipe(startInspectionSchema)) body: z.output<typeof startInspectionSchema>,
  ) {
    return this.inspections.start(user, body);
  }

  @Get(':id')
  @RequirePermission('inspections', 'read')
  get(@CurrentUser() user: AuthUser, @Param('id') id: string) {
    return this.inspections.get(user, id);
  }

  @Patch(':id')
  @RequirePermission('inspections', 'approve')
  update(
    @CurrentUser() user: AuthUser,
    @Param('id') id: string,
    @Body(new ZodValidationPipe(updateInspectionSchema)) body: z.output<typeof updateInspectionSchema>,
  ) {
    return this.inspections.update(user, id, body);
  }

  @Delete(':id')
  @HttpCode(204)
  @RequirePermission('inspections', 'approve')
  remove(@CurrentUser() user: AuthUser, @Param('id') id: string) {
    return this.inspections.remove(user, id);
  }

  // ───────────────────────── On site ─────────────────────────

  @Put(':id/checks/:itemId')
  @RequirePermission('inspections', 'update')
  answer(
    @CurrentUser() user: AuthUser,
    @Param('id') id: string,
    @Param('itemId') itemId: string,
    @Body(new ZodValidationPipe(answerInspectionCheckSchema)) body: z.output<typeof answerInspectionCheckSchema>,
  ) {
    return this.inspections.answer(user, id, itemId, body);
  }

  @Post(':id/checks/:itemId/photos')
  @HttpCode(200)
  @RequirePermission('inspections', 'update')
  @UseInterceptors(FileInterceptor('file', { limits: { fileSize: MAX_UPLOAD_BYTES, files: 1 } }))
  addPhoto(
    @CurrentUser() user: AuthUser,
    @Param('id') id: string,
    @Param('itemId') itemId: string,
    @UploadedFile() file: { buffer: Buffer; size: number } | undefined,
  ) {
    if (!file) throw new BadRequestException('A photo is required');
    return this.inspections.addPhoto(user, id, itemId, file);
  }

  @Delete(':id/photos/:photoId')
  @RequirePermission('inspections', 'update')
  removePhoto(@CurrentUser() user: AuthUser, @Param('id') id: string, @Param('photoId') photoId: string) {
    return this.inspections.removePhoto(user, id, photoId);
  }

  @Post(':id/finish')
  @HttpCode(200)
  @RequirePermission('inspections', 'update')
  finish(@CurrentUser() user: AuthUser, @Param('id') id: string) {
    return this.inspections.finish(user, id);
  }

  // ───────────────────────── Review by ECCS ─────────────────────────

  @Post(':id/approve')
  @HttpCode(200)
  @RequirePermission('inspections', 'approve')
  approve(@CurrentUser() user: AuthUser, @Param('id') id: string) {
    return this.inspections.approve(user, id);
  }

  @Post(':id/send-back')
  @HttpCode(200)
  @RequirePermission('inspections', 'approve')
  sendBack(
    @CurrentUser() user: AuthUser,
    @Param('id') id: string,
    @Body(new ZodValidationPipe(returnInspectionSchema)) body: z.output<typeof returnInspectionSchema>,
  ) {
    return this.inspections.sendBack(user, id, body.note);
  }
}
