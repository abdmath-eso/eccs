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
  saveInspectionSummarySchema,
  startInspectionSchema,
  updateInspectionSchema,
} from '@eccs/shared';
import { z } from 'zod';
import { Activity } from '../activity-log/activity.decorator.js';
import { CurrentUser, RequirePermission } from '../auth/auth.decorators.js';
import type { AuthUser } from '../auth/auth.types.js';
import { ZodValidationPipe } from '../common/zod-validation.pipe.js';
import { readPhotoFacts } from '../storage/photo-integrity.service.js';
import { InspectionSummaryService } from './inspection-summary.service.js';
import { InspectionsService } from './inspections.service.js';

const MAX_UPLOAD_BYTES = 10 * 1024 * 1024;

/** Sent with a photo by a phone: its own id for the photo (so sending it twice stores it once) and when it was taken. */
const photoFieldsSchema = z.object({ id: z.uuid().optional(), capturedAt: z.iso.datetime().optional() });
/** Finish may come with no body at all; `at` is when Finish was pressed on the phone. */
const finishSchema = z.object({ at: z.iso.datetime().optional() }).optional();

@Controller('inspections')
export class InspectionsController {
  constructor(
    private readonly inspections: InspectionsService,
    private readonly summaries: InspectionSummaryService,
  ) {}

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
  @Activity('inspections.inspection.started', { entity: 'inspection', from: 'answer' })
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
  @Activity('inspections.inspection.changed', { entity: 'inspection' })
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
  @Activity('inspections.inspection.removed', { entity: 'inspection' })
  remove(@CurrentUser() user: AuthUser, @Param('id') id: string) {
    return this.inspections.remove(user, id);
  }

  // ───────────────────────── On site ─────────────────────────

  @Put(':id/checks/:itemId')
  @RequirePermission('inspections', 'update')
  @Activity('inspections.check.answered', { entity: 'inspection', facts: ['answer', 'severity'] })
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
  @Activity('inspections.photo.added', { entity: 'inspection' })
  @UseInterceptors(FileInterceptor('file', { limits: { fileSize: MAX_UPLOAD_BYTES, files: 1 } }))
  addPhoto(
    @CurrentUser() user: AuthUser,
    @Param('id') id: string,
    @Param('itemId') itemId: string,
    @UploadedFile() file: { buffer: Buffer; size: number } | undefined,
    @Body() body: unknown,
  ) {
    const fields = photoFieldsSchema.safeParse(body ?? {});
    if (!fields.success) throw new BadRequestException('Invalid upload');
    if (!file) throw new BadRequestException('A photo is required');
    return this.inspections.addPhoto(user, id, itemId, file, fields.data, readPhotoFacts(body));
  }

  @Delete(':id/photos/:photoId')
  @RequirePermission('inspections', 'update')
  @Activity('inspections.photo.removed', { entity: 'inspection' })
  removePhoto(
    @CurrentUser() user: AuthUser,
    @Param('id') id: string,
    @Param('photoId') photoId: string,
    @Query('itemId') itemId?: string,
  ) {
    return this.inspections.removePhoto(user, id, photoId, itemId || undefined);
  }

  @Post(':id/finish')
  @HttpCode(200)
  @RequirePermission('inspections', 'update')
  @Activity('inspections.inspection.finished', { entity: 'inspection' })
  finish(
    @CurrentUser() user: AuthUser,
    @Param('id') id: string,
    @Body(new ZodValidationPipe(finishSchema)) body: z.output<typeof finishSchema>,
  ) {
    return this.inspections.finish(user, id, body?.at);
  }

  // ───────────────────────── The summary for the report ─────────────────────────

  /**
   * An AI draft of the summary and "Fix these first", for the Supervisor to check
   * and edit. Nothing is saved. Fails with code AI_OFF, AI_LIMIT or AI_FAILED when
   * AI steps aside; the summary can always be written by hand.
   */
  @Post(':id/summary/draft')
  @HttpCode(200)
  @RequirePermission('inspections', 'update')
  @Activity('inspections.summary.drafted', { entity: 'inspection' })
  draftSummary(@CurrentUser() user: AuthUser, @Param('id') id: string) {
    return this.summaries.draft(user, id);
  }

  /** Saves the summary for the report, after Finish and before approval. */
  @Put(':id/summary')
  @RequirePermission('inspections', 'update')
  // Never the summary's words: only whether it started from an AI draft.
  @Activity('inspections.summary.saved', { entity: 'inspection', facts: ['aiDrafted'] })
  saveSummary(
    @CurrentUser() user: AuthUser,
    @Param('id') id: string,
    @Body(new ZodValidationPipe(saveInspectionSummarySchema)) body: z.output<typeof saveInspectionSummarySchema>,
  ) {
    return this.summaries.save(user, id, body);
  }

  // ───────────────────────── Review by ECCS ─────────────────────────

  @Post(':id/approve')
  @HttpCode(200)
  @RequirePermission('inspections', 'approve')
  @Activity('inspections.inspection.approved', { entity: 'inspection' })
  approve(@CurrentUser() user: AuthUser, @Param('id') id: string) {
    return this.inspections.approve(user, id);
  }

  /** A signed link to the approved report as a PDF, for anyone who may read the report. */
  @Post(':id/report-pdf')
  @HttpCode(200)
  @RequirePermission('inspections', 'read')
  @Activity('inspections.report.opened', { entity: 'inspection' })
  reportPdf(@CurrentUser() user: AuthUser, @Param('id') id: string) {
    return this.inspections.reportPdf(user, id);
  }

  @Post(':id/send-back')
  @HttpCode(200)
  @RequirePermission('inspections', 'approve')
  @Activity('inspections.inspection.sentBack', { entity: 'inspection' })
  sendBack(
    @CurrentUser() user: AuthUser,
    @Param('id') id: string,
    @Body(new ZodValidationPipe(returnInspectionSchema)) body: z.output<typeof returnInspectionSchema>,
  ) {
    return this.inspections.sendBack(user, id, body.note);
  }
}
