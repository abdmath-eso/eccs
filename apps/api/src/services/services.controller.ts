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
  answerVisitTaskSchema,
  confirmBookingSchema,
  createBookingSchema,
  createVisitSchema,
  setOutletPlanSchema,
  returnReportSchema,
  signOffVisitSchema,
  updateVisitRecordSchema,
  updateVisitSchema,
  VISIT_PHOTO_KINDS,
} from '@eccs/shared';
import { z } from 'zod';
import { CurrentUser, RequirePermission } from '../auth/auth.decorators.js';
import type { AuthUser } from '../auth/auth.types.js';
import { ZodValidationPipe } from '../common/zod-validation.pipe.js';
import { PlansService } from './plans.service.js';
import { ServicesService } from './services.service.js';

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
  setOutletPlan(
    @CurrentUser() user: AuthUser,
    @Param('outletId') outletId: string,
    @Body(new ZodValidationPipe(setOutletPlanSchema)) body: z.output<typeof setOutletPlanSchema>,
  ) {
    return this.plansService.setOutletPlan(user, outletId, body);
  }

  @Delete('outlets/:outletId/plan')
  @RequirePermission('subscriptions', 'create')
  stopOutletPlan(@CurrentUser() user: AuthUser, @Param('outletId') outletId: string) {
    return this.plansService.stopOutletPlan(user, outletId);
  }

  /** Fills the diary from the plans now, instead of waiting for the next automatic check. */
  @Post('visits/from-plans')
  @HttpCode(200)
  @RequirePermission('jobs', 'create')
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
  createBooking(
    @CurrentUser() user: AuthUser,
    @Body(new ZodValidationPipe(createBookingSchema)) body: z.output<typeof createBookingSchema>,
  ) {
    return this.services.createBooking(user, body);
  }

  @Post('bookings/:id/confirm')
  @HttpCode(200)
  @RequirePermission('bookings', 'update')
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
  cancelBooking(@CurrentUser() user: AuthUser, @Param('id') id: string) {
    return this.services.cancelBooking(user, id);
  }

  // ───────────────────────── Visits ─────────────────────────

  @Get('visits')
  @RequirePermission('jobs', 'read')
  listVisits(@CurrentUser() user: AuthUser, @Query('outletId') outletId?: string, @Query('state') state?: string) {
    return this.services.listVisits(user, { outletId: outletId || undefined, state: state === 'closed' ? 'closed' : 'open' });
  }

  @Post('visits')
  @RequirePermission('jobs', 'create')
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
  cancelVisit(@CurrentUser() user: AuthUser, @Param('id') id: string) {
    return this.services.cancelVisit(user, id);
  }

  // ───────────────────────── On site ─────────────────────────

  @Post('visits/:id/check-in')
  @HttpCode(200)
  @RequirePermission('jobs', 'update')
  checkIn(
    @CurrentUser() user: AuthUser,
    @Param('id') id: string,
    @Body(new ZodValidationPipe(checkInSchema)) body: z.output<typeof checkInSchema>,
  ) {
    return this.services.checkIn(user, id, body);
  }

  @Put('visits/:id/tasks/:itemId')
  @RequirePermission('jobs', 'update')
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
    return this.services.addPhoto(user, id, fields.data.kind, file, fields.data);
  }

  @Delete('visits/:id/photos/:photoId')
  @RequirePermission('jobs', 'update')
  removePhoto(@CurrentUser() user: AuthUser, @Param('id') id: string, @Param('photoId') photoId: string) {
    return this.services.removePhoto(user, id, photoId);
  }

  @Post('visits/:id/complete')
  @HttpCode(200)
  @RequirePermission('jobs', 'update')
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
  approveReport(@CurrentUser() user: AuthUser, @Param('id') id: string) {
    return this.services.approveReport(user, id);
  }

  @Post('visits/:id/return-report')
  @HttpCode(200)
  @RequirePermission('jobs', 'create')
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
  reportPdf(@CurrentUser() user: AuthUser, @Param('id') id: string) {
    return this.services.reportPdf(user, id);
  }

  @Post('visits/:id/sign-off')
  @HttpCode(200)
  @RequirePermission('jobs', 'approve')
  signOff(
    @CurrentUser() user: AuthUser,
    @Param('id') id: string,
    @Body(new ZodValidationPipe(signOffVisitSchema)) body: z.output<typeof signOffVisitSchema>,
  ) {
    return this.services.signOff(user, id, body);
  }
}
