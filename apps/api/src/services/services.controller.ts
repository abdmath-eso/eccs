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
  addVisitDocumentSchema,
  answerVisitTaskSchema,
  confirmBookingSchema,
  createBookingSchema,
  createVisitSchema,
  outletLocationSchema,
  setOutletPlanSchema,
  returnReportSchema,
  signOffVisitSchema,
  updateVisitRecordSchema,
  updateVisitSchema,
  VISIT_PHOTO_KINDS,
  visitCapacitySchema,
} from '@eccs/shared';
import { z } from 'zod';
import { Activity } from '../activity-log/activity.decorator.js';
import { CurrentUser, RequirePermission } from '../auth/auth.decorators.js';
import type { AuthUser } from '../auth/auth.types.js';
import { ZodValidationPipe } from '../common/zod-validation.pipe.js';
import { readPhotoFacts } from '../storage/photo-integrity.service.js';
import { PlansService } from './plans.service.js';
import { ServicesService } from './services.service.js';
import { WeekBoardService } from './week-board.service.js';

const MAX_UPLOAD_BYTES = 10 * 1024 * 1024;

const checkInSchema = z.object({
  latitude: z.number().min(-90).max(90).optional(),
  longitude: z.number().min(-180).max(180).optional(),
  /** When the Supervisor checked in on the phone, if that was earlier than now (no signal at the time). */
  at: z.iso.datetime().optional(),
});
const photoFieldsSchema = z.object({
  kind: z.enum(VISIT_PHOTO_KINDS),
  /** Chosen by the phone so that sending the same photo twice stores it once. */
  id: z.uuid().optional(),
  capturedAt: z.iso.datetime().optional(),
});
/** Finish may come with no body at all; `at` is when Finish was pressed on the phone. */
const completeSchema = z.object({ at: z.iso.datetime().optional() }).optional();

@Controller()
export class ServicesController {
  constructor(
    private readonly services: ServicesService,
    private readonly plansService: PlansService,
    private readonly weekBoard: WeekBoardService,
  ) {}

  // ───────────────────────── Plans ─────────────────────────

  @Get('plans')
  @RequirePermission('catalog', 'read')
  plans() {
    return this.plansService.plans();
  }

  @Get('outlets/:outletId/plan')
  @RequirePermission('subscriptions', 'read')
  outletPlan(@CurrentUser() user: AuthUser, @Param('outletId') outletId: string) {
    return this.plansService.outletPlan(user, outletId);
  }

  @Put('outlets/:outletId/plan')
  @RequirePermission('subscriptions', 'create')
  @Activity('subscriptions.outletPlan.set', { entity: 'outlet', key: 'outletId', facts: ['planCode'] })
  setOutletPlan(
    @CurrentUser() user: AuthUser,
    @Param('outletId') outletId: string,
    @Body(new ZodValidationPipe(setOutletPlanSchema)) body: z.output<typeof setOutletPlanSchema>,
  ) {
    return this.plansService.setOutletPlan(user, outletId, body);
  }

  @Delete('outlets/:outletId/plan')
  @RequirePermission('subscriptions', 'create')
  @Activity('subscriptions.outletPlan.stopped', { entity: 'outlet', key: 'outletId' })
  stopOutletPlan(@CurrentUser() user: AuthUser, @Param('outletId') outletId: string) {
    return this.plansService.stopOutletPlan(user, outletId);
  }

  /** Fills the diary from the plans now, instead of waiting for the next automatic check. */
  @Post('visits/from-plans')
  @HttpCode(200)
  @RequirePermission('jobs', 'create')
  @Activity('visits.diary.filled', { answerFacts: ['created'] })
  fillFromPlans() {
    return this.plansService.generateAll();
  }

  // ───────────────────────── Catalogue ─────────────────────────

  @Get('services/catalog')
  @RequirePermission('catalog', 'read')
  catalog() {
    return this.services.catalog();
  }

  @Get('services/types')
  @RequirePermission('catalog', 'read')
  types() {
    return this.services.serviceTypes();
  }

  @Get('services/supervisors')
  @RequirePermission('jobs', 'create')
  supervisors() {
    return this.services.supervisors();
  }

  // ───────────────────────── Bookings ─────────────────────────

  @Get('bookings')
  @RequirePermission('bookings', 'read')
  listBookings(@CurrentUser() user: AuthUser, @Query('outletId') outletId?: string, @Query('status') status?: string) {
    return this.services.listBookings(user, { outletId: outletId || undefined, requestedOnly: status === 'requested' });
  }

  @Post('bookings')
  @RequirePermission('bookings', 'create')
  @Activity('visits.booking.requested', { entity: 'booking', from: 'answer' })
  createBooking(
    @CurrentUser() user: AuthUser,
    @Body(new ZodValidationPipe(createBookingSchema)) body: z.output<typeof createBookingSchema>,
  ) {
    return this.services.createBooking(user, body);
  }

  @Post('bookings/:id/confirm')
  @HttpCode(200)
  @RequirePermission('bookings', 'update')
  @Activity('visits.booking.confirmed', { entity: 'booking' })
  confirmBooking(
    @CurrentUser() user: AuthUser,
    @Param('id') id: string,
    @Body(new ZodValidationPipe(confirmBookingSchema)) body: z.output<typeof confirmBookingSchema>,
  ) {
    return this.services.confirmBooking(user, id, body);
  }

  @Post('bookings/:id/cancel')
  @HttpCode(200)
  @RequirePermission('bookings', 'update')
  @Activity('visits.booking.cancelled', { entity: 'booking' })
  cancelBooking(@CurrentUser() user: AuthUser, @Param('id') id: string) {
    return this.services.cancelBooking(user, id);
  }

  // ───────────────────────── Visits ─────────────────────────

  @Get('visits')
  @RequirePermission('jobs', 'read')
  listVisits(@CurrentUser() user: AuthUser, @Query('outletId') outletId?: string, @Query('state') state?: string) {
    return this.services.listVisits(user, { outletId: outletId || undefined, state: state === 'closed' ? 'closed' : 'open' });
  }

  /** The week board: Monday to Saturday of the week holding `start` (this week when left out). */
  @Get('visits/week')
  @RequirePermission('jobs', 'read')
  week(@CurrentUser() user: AuthUser, @Query('start') start?: string) {
    return this.weekBoard.week(user, start || undefined);
  }

  /** How many visits a day the crew can take. Read by everyone who sees the board. */
  @Get('visits/settings')
  @RequirePermission('jobs', 'read')
  visitSettings(@CurrentUser() user: AuthUser) {
    return this.weekBoard.settings(user);
  }

  // The settings grant is the Super Admin's alone.
  @Put('visits/settings')
  @RequirePermission('settings', 'update')
  @Activity('visits.capacity.changed', { facts: ['MON', 'TUE', 'WED', 'THU', 'FRI', 'SAT'] })
  updateVisitSettings(
    @CurrentUser() user: AuthUser,
    @Body(new ZodValidationPipe(visitCapacitySchema)) body: z.output<typeof visitCapacitySchema>,
  ) {
    return this.weekBoard.updateSettings(user, body);
  }

  @Post('visits')
  @RequirePermission('jobs', 'create')
  @Activity('visits.visit.added', { entity: 'visit', from: 'answer' })
  createVisit(
    @CurrentUser() user: AuthUser,
    @Body(new ZodValidationPipe(createVisitSchema)) body: z.output<typeof createVisitSchema>,
  ) {
    return this.services.createVisit(user, body);
  }

  @Get('visits/:id')
  @RequirePermission('jobs', 'read')
  getVisit(@CurrentUser() user: AuthUser, @Param('id') id: string) {
    return this.services.getVisit(user, id);
  }

  @Patch('visits/:id')
  @RequirePermission('jobs', 'create')
  @Activity('visits.visit.changed', { entity: 'visit' })
  updateVisit(
    @CurrentUser() user: AuthUser,
    @Param('id') id: string,
    @Body(new ZodValidationPipe(updateVisitSchema)) body: z.output<typeof updateVisitSchema>,
  ) {
    return this.services.updateVisit(user, id, body);
  }

  @Post('visits/:id/cancel')
  @HttpCode(200)
  @RequirePermission('jobs', 'create')
  @Activity('visits.visit.cancelled', { entity: 'visit' })
  cancelVisit(@CurrentUser() user: AuthUser, @Param('id') id: string) {
    return this.services.cancelVisit(user, id);
  }

  // ───────────────────────── On site ─────────────────────────

  @Post('visits/:id/check-in')
  @HttpCode(200)
  @RequirePermission('jobs', 'update')
  @Activity('visits.visit.checkedIn', { entity: 'visit' })
  checkIn(
    @CurrentUser() user: AuthUser,
    @Param('id') id: string,
    @Body(new ZodValidationPipe(checkInSchema)) body: z.output<typeof checkInSchema>,
  ) {
    return this.services.checkIn(user, id, body);
  }

  @Put('visits/:id/tasks/:itemId')
  @RequirePermission('jobs', 'update')
  @Activity('visits.task.answered', { entity: 'visit', facts: ['done'] })
  answerTask(
    @CurrentUser() user: AuthUser,
    @Param('id') id: string,
    @Param('itemId') itemId: string,
    @Body(new ZodValidationPipe(answerVisitTaskSchema)) body: z.output<typeof answerVisitTaskSchema>,
  ) {
    return this.services.answerTask(user, id, itemId, body);
  }

  @Patch('visits/:id/record')
  @RequirePermission('jobs', 'update')
  @Activity('visits.record.changed', { entity: 'visit' })
  updateRecord(
    @CurrentUser() user: AuthUser,
    @Param('id') id: string,
    @Body(new ZodValidationPipe(updateVisitRecordSchema)) body: z.output<typeof updateVisitRecordSchema>,
  ) {
    return this.services.updateRecord(user, id, body);
  }

  @Post('visits/:id/photos')
  @HttpCode(200)
  @RequirePermission('jobs', 'update')
  @Activity('visits.photo.added', { entity: 'visit', facts: ['kind'] })
  @UseInterceptors(FileInterceptor('file', { limits: { fileSize: MAX_UPLOAD_BYTES, files: 1 } }))
  addPhoto(
    @CurrentUser() user: AuthUser,
    @Param('id') id: string,
    @UploadedFile() file: { buffer: Buffer; size: number } | undefined,
    @Body() body: unknown,
  ) {
    const fields = photoFieldsSchema.safeParse(body);
    if (!fields.success) throw new BadRequestException('Say whether the photo is from before or after the work');
    if (!file) throw new BadRequestException('A photo is required');
    return this.services.addPhoto(user, id, fields.data.kind, file, fields.data, readPhotoFacts(body));
  }

  /** The person recording the visit saves where the kitchen is, read by their phone on the spot. */
  @Post('visits/:id/outlet-location')
  @HttpCode(200)
  @RequirePermission('jobs', 'update')
  @Activity('visits.outletPlace.saved', { entity: 'visit' })
  setOutletLocation(
    @CurrentUser() user: AuthUser,
    @Param('id') id: string,
    @Body(new ZodValidationPipe(outletLocationSchema)) body: z.output<typeof outletLocationSchema>,
  ) {
    return this.services.setOutletLocation(user, id, body);
  }

  @Delete('visits/:id/photos/:photoId')
  @RequirePermission('jobs', 'update')
  @Activity('visits.photo.removed', { entity: 'visit' })
  removePhoto(@CurrentUser() user: AuthUser, @Param('id') id: string, @Param('photoId') photoId: string) {
    return this.services.removePhoto(user, id, photoId);
  }

  /** A result document for the visit (a lab report, an attendance sheet…): a PDF or a picture, with what it is. */
  @Post('visits/:id/documents')
  @HttpCode(200)
  @RequirePermission('jobs', 'update')
  @Activity('visits.document.added', { entity: 'visit' })
  @UseInterceptors(FileInterceptor('file', { limits: { fileSize: MAX_UPLOAD_BYTES, files: 1 } }))
  addDocument(
    @CurrentUser() user: AuthUser,
    @Param('id') id: string,
    @UploadedFile() file: { buffer: Buffer; size: number } | undefined,
    @Body() body: unknown,
  ) {
    const fields = addVisitDocumentSchema.safeParse(body);
    if (!fields.success) throw new BadRequestException(fields.error.issues[0]?.message ?? 'Say what the document is');
    if (!file) throw new BadRequestException('Choose a file');
    return this.services.addDocument(user, id, fields.data, file);
  }

  @Delete('visits/:id/documents/:documentId')
  @RequirePermission('jobs', 'create')
  @Activity('visits.document.removed', { entity: 'visit' })
  removeDocument(@CurrentUser() user: AuthUser, @Param('id') id: string, @Param('documentId') documentId: string) {
    return this.services.removeDocument(user, id, documentId);
  }

  @Post('visits/:id/complete')
  @HttpCode(200)
  @RequirePermission('jobs', 'update')
  @Activity('visits.visit.finished', { entity: 'visit' })
  complete(
    @CurrentUser() user: AuthUser,
    @Param('id') id: string,
    @Body(new ZodValidationPipe(completeSchema)) body: z.output<typeof completeSchema>,
  ) {
    return this.services.complete(user, id, body?.at);
  }

  @Post('visits/:id/approve-report')
  @HttpCode(200)
  @RequirePermission('jobs', 'create')
  @Activity('visits.report.approved', { entity: 'visit' })
  approveReport(@CurrentUser() user: AuthUser, @Param('id') id: string) {
    return this.services.approveReport(user, id);
  }

  @Post('visits/:id/return-report')
  @HttpCode(200)
  @RequirePermission('jobs', 'create')
  @Activity('visits.report.returned', { entity: 'visit' })
  returnReport(
    @CurrentUser() user: AuthUser,
    @Param('id') id: string,
    @Body(new ZodValidationPipe(returnReportSchema)) body: z.output<typeof returnReportSchema>,
  ) {
    return this.services.returnReport(user, id, body.note);
  }

  @Post('visits/:id/report-pdf')
  @HttpCode(200)
  @RequirePermission('jobs', 'read')
  @Activity('visits.report.opened', { entity: 'visit' })
  reportPdf(@CurrentUser() user: AuthUser, @Param('id') id: string) {
    return this.services.reportPdf(user, id);
  }

  @Post('visits/:id/sign-off')
  @HttpCode(200)
  @RequirePermission('jobs', 'approve')
  // The stars, never the comment.
  @Activity('visits.visit.signedOff', { entity: 'visit', facts: ['rating'] })
  signOff(
    @CurrentUser() user: AuthUser,
    @Param('id') id: string,
    @Body(new ZodValidationPipe(signOffVisitSchema)) body: z.output<typeof signOffVisitSchema>,
  ) {
    return this.services.signOff(user, id, body);
  }
}
