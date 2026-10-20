import { Body, Controller, Get, HttpCode, Param, Patch, Post, Query, Res } from '@nestjs/common';
import {
  bookFollowUpVisitSchema,
  closeFollowUpSchema,
  closeIncidentSchema,
  createIncidentSchema,
  judgePhotosSchema,
  logFollowUpCallSchema,
  rejectPhotosSchema,
  updateIncidentSchema,
  type QualityCountsDto,
} from '@eccs/shared';
import type { Response } from 'express';
import type { z } from 'zod';
import { Activity } from '../activity-log/activity.decorator.js';
import { CurrentUser, RequirePermission } from '../auth/auth.decorators.js';
import type { AuthUser } from '../auth/auth.types.js';
import { ZodValidationPipe } from '../common/zod-validation.pipe.js';
import { FollowUpsService } from './follow-ups.service.js';
import { IncidentsService } from './incidents.service.js';
import { PhotoReviewsService } from './photo-reviews.service.js';
import { QualityService } from './quality.service.js';

/**
 * Quality (console plan step 3, 20 Oct 2026): Follow-ups, Photos and Incidents, for the Super
 * Admin and the Ops Manager (the `quality` grant). Reading needs R; logging a call, booking a
 * free visit and adding an incident C; closing, judging and changing U.
 */
@Controller('quality')
export class QualityController {
  constructor(
    private readonly quality: QualityService,
    private readonly followUps: FollowUpsService,
    private readonly photos: PhotoReviewsService,
    private readonly incidents: IncidentsService,
  ) {}

  @Get()
  @RequirePermission('quality', 'read')
  summary(@CurrentUser() user: AuthUser) {
    return this.quality.summary(user, new Date());
  }

  /** The menu's badge and the tabs' numbers. */
  @Get('counts')
  @RequirePermission('quality', 'read')
  async counts(@CurrentUser() user: AuthUser): Promise<QualityCountsDto> {
    const { kitchens: _kitchens, ...counts } = await this.quality.counts(user, new Date());
    return counts;
  }

  // ───────────────────────── Follow-ups ─────────────────────────

  @Get('follow-ups')
  @RequirePermission('quality', 'read')
  followUpList(@Query('state') state?: string) {
    return this.followUps.list(state === 'done' ? 'done' : 'open', new Date());
  }

  @Get('follow-ups/:id')
  @RequirePermission('quality', 'read')
  followUp(@Param('id') id: string) {
    return this.followUps.get(id, new Date());
  }

  @Post('follow-ups/:id/calls')
  @RequirePermission('quality', 'create')
  @Activity('quality.followUp.called')
  logCall(
    @CurrentUser() user: AuthUser,
    @Param('id') id: string,
    @Body(new ZodValidationPipe(logFollowUpCallSchema)) body: z.output<typeof logFollowUpCallSchema>,
  ) {
    return this.followUps.logCall(user, id, body, new Date());
  }

  /** A free redo or check-in visit: a normal visit in the diary, marked free (no invoice, no score). */
  @Post('follow-ups/:id/visit')
  @RequirePermission('quality', 'create')
  @Activity('quality.followUp.booked', { facts: ['serviceCode', 'slot'] })
  bookVisit(
    @CurrentUser() user: AuthUser,
    @Param('id') id: string,
    @Body(new ZodValidationPipe(bookFollowUpVisitSchema)) body: z.output<typeof bookFollowUpVisitSchema>,
  ) {
    return this.followUps.bookVisit(user, id, body, new Date());
  }

  @Post('follow-ups/:id/close')
  @HttpCode(200)
  @RequirePermission('quality', 'update')
  @Activity('quality.followUp.closed')
  closeFollowUp(
    @CurrentUser() user: AuthUser,
    @Param('id') id: string,
    @Body(new ZodValidationPipe(closeFollowUpSchema)) body: z.output<typeof closeFollowUpSchema>,
  ) {
    return this.followUps.close(user, id, body.note, new Date());
  }

  // ───────────────────────── Photos ─────────────────────────

  @Get('photos')
  @RequirePermission('quality', 'read')
  photoQueue() {
    return this.photos.queue(new Date());
  }

  @Post('photos/accept')
  @HttpCode(200)
  @RequirePermission('quality', 'update')
  @Activity('quality.photo.accepted', { facts: ['kind'] })
  accept(@CurrentUser() user: AuthUser, @Body(new ZodValidationPipe(judgePhotosSchema)) body: z.output<typeof judgePhotosSchema>) {
    return this.photos.judge(user, body, 'ACCEPTED', null, new Date());
  }

  /** Reject and ask for a retake: the outlet's Manager (a checklist) or the visit's Supervisor is told. */
  @Post('photos/reject')
  @HttpCode(200)
  @RequirePermission('quality', 'update')
  @Activity('quality.photo.rejected', { facts: ['kind'], answerFacts: ['told'] })
  reject(@CurrentUser() user: AuthUser, @Body(new ZodValidationPipe(rejectPhotosSchema)) body: z.output<typeof rejectPhotosSchema>) {
    return this.photos.judge(user, body, 'REJECTED', body.note, new Date());
  }

  // ───────────────────────── Incidents ─────────────────────────

  @Get('incidents')
  @RequirePermission('quality', 'read')
  incidentList(@Query('state') state?: string) {
    return this.incidents.list(state === 'open' ? 'open' : 'all');
  }

  @Get('incidents/:id')
  @RequirePermission('quality', 'read')
  incident(@Param('id') id: string) {
    return this.incidents.get(id);
  }

  @Post('incidents')
  @RequirePermission('quality', 'create')
  @Activity('quality.incident.added')
  addIncident(@CurrentUser() user: AuthUser, @Body(new ZodValidationPipe(createIncidentSchema)) body: z.output<typeof createIncidentSchema>) {
    return this.incidents.create(user, body, new Date());
  }

  @Patch('incidents/:id')
  @RequirePermission('quality', 'update')
  @Activity('quality.incident.changed')
  updateIncident(@Param('id') id: string, @Body(new ZodValidationPipe(updateIncidentSchema)) body: z.output<typeof updateIncidentSchema>) {
    return this.incidents.update(id, body, new Date());
  }

  @Post('incidents/:id/close')
  @HttpCode(200)
  @RequirePermission('quality', 'update')
  @Activity('quality.incident.closed')
  closeIncident(
    @CurrentUser() user: AuthUser,
    @Param('id') id: string,
    @Body(new ZodValidationPipe(closeIncidentSchema)) body: z.output<typeof closeIncidentSchema>,
  ) {
    return this.incidents.close(user, id, body, new Date());
  }

  @Post('incidents/:id/reopen')
  @HttpCode(200)
  @RequirePermission('quality', 'update')
  @Activity('quality.incident.reopened')
  reopenIncident(@Param('id') id: string) {
    return this.incidents.reopen(id);
  }

  /** The incident's whole story as a PDF, for an insurer or a lawyer. There is no public link. */
  @Get('incidents/:id/pdf')
  @RequirePermission('quality', 'read')
  @Activity('quality.incident.pdf', { reads: 'always' })
  async incidentPdf(@Param('id') id: string, @Res() response: Response): Promise<void> {
    const file = await this.incidents.pdf(id);
    response.setHeader('Content-Type', 'application/pdf');
    response.setHeader('Content-Disposition', `attachment; filename="${file.name.replace(/[^\w .-]/g, '')}"`);
    response.setHeader('Cache-Control', 'private, no-store');
    response.setHeader('X-Content-Type-Options', 'nosniff');
    response.send(file.body);
  }
}
