import { Body, Controller, Get, HttpCode, Param, Post, Query } from '@nestjs/common';
import { closeDaySchema, sendDaySheetSchema } from '@eccs/shared';
import type { z } from 'zod';
import { Activity } from '../activity-log/activity.decorator.js';
import { CurrentUser, RequirePermission } from '../auth/auth.decorators.js';
import type { AuthUser } from '../auth/auth.types.js';
import { ZodValidationPipe } from '../common/zod-validation.pipe.js';
import { env } from '../config/env.js';
import { DaySheetService } from './day-sheet.service.js';
import { TodayService } from './today.service.js';

/**
 * What time it is for Today. Under the automated tests, and in the test copies of the server
 * on this PC (NODE_ENV=test), a request may say (`?at=`, an ISO moment), so a day can be tested
 * without waiting for it: a morning's page in the evening, or a day far from the sample data.
 * Anywhere else `at` is ignored and it is always now.
 */
function clock(at: string | undefined): Date {
  if (env.NODE_ENV === 'test' && at && !Number.isNaN(Date.parse(at))) return new Date(at);
  return new Date();
}

// Today, the console's home (20 Oct 2026). The visit grant opens it: the Super Admin and the Ops
// Manager see the office's day, a Supervisor their own; a BDE (sales only) has no Today.
@Controller()
export class TodayController {
  constructor(
    private readonly today: TodayService,
    private readonly sheets: DaySheetService,
  ) {}

  @Get('today')
  @RequirePermission('jobs', 'read')
  get(@CurrentUser() user: AuthUser, @Query('at') at?: string) {
    return this.today.today(user, clock(at));
  }

  /** Close the day: once per India day, by the Super Admin or the Ops Manager. It warns in the console; it never refuses an open line. */
  @Post('today/close')
  @RequirePermission('jobs', 'create')
  @Activity('visits.day.closed')
  close(
    @CurrentUser() user: AuthUser,
    @Body(new ZodValidationPipe(closeDaySchema)) body: z.output<typeof closeDaySchema>,
    @Query('at') at?: string,
  ) {
    return this.today.closeDay(user, body.date, clock(at));
  }

  /** The Supervisor's own day's sheet, with "Still to do today": the top of the phone's jobs list (console plan step 3). */
  @Get('today/sheet')
  @RequirePermission('jobs', 'read')
  mySheet(@CurrentUser() user: AuthUser, @Query('at') at?: string) {
    return this.sheets.mine(user, clock(at));
  }

  /** Send the day's sheet to a Supervisor's phone (DAY_SHEET_SENT): the Super Admin or the Ops Manager, again once it has changed. */
  @Post('today/sheets/:supervisorId/send')
  @HttpCode(200)
  @RequirePermission('jobs', 'create')
  @Activity('visits.daySheet.sent', { answerFacts: ['told'] })
  sendSheet(
    @CurrentUser() user: AuthUser,
    @Param('supervisorId') supervisorId: string,
    @Body(new ZodValidationPipe(sendDaySheetSchema)) body: z.output<typeof sendDaySheetSchema>,
    @Query('at') at?: string,
  ) {
    return this.sheets.send(user, supervisorId, body.date, clock(at));
  }

  /** Remind: tells the outlet's Owner and Managers again that a finished visit waits for their sign-off. Once a day per visit. */
  @Post('visits/:id/remind-sign-off')
  @HttpCode(200)
  @RequirePermission('jobs', 'update')
  @Activity('visits.signOff.reminded', { entity: 'visit' })
  remind(@CurrentUser() user: AuthUser, @Param('id') id: string, @Query('at') at?: string) {
    return this.today.remind(user, id, clock(at));
  }
}
