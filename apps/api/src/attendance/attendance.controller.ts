import { BadRequestException, Body, Controller, Get, HttpCode, Param, Post, Put, Query, Res, UploadedFile, UploadedFiles, UseInterceptors } from '@nestjs/common';
import { FileFieldsInterceptor, FileInterceptor } from '@nestjs/platform-express';
import {
  FACE_RULES,
  addPunchSchema,
  attendanceSettingsSchema,
  clockConfirmSchema,
  correctDaySchema,
  voidPunchSchema,
  type ClockIdentifyDto,
  type ClockPunchResultDto,
  type ClockRosterDto,
} from '@eccs/shared';
import type { Response } from 'express';
import type { z } from 'zod';
import { Activity } from '../activity-log/activity.decorator.js';
import { CurrentUser, Public, RequirePermission } from '../auth/auth.decorators.js';
import type { AuthUser } from '../auth/auth.types.js';
import { ZodValidationPipe } from '../common/zod-validation.pipe.js';
import { AttendanceService } from './attendance.service.js';
import { ClockService } from './clock.service.js';

/** An uploaded photo, held in memory. Photos of faces are never written to the server's disk. */
interface Upload {
  buffer: Buffer;
}

/**
 * A little above the largest photo accepted, so that a photo slightly too large
 * is refused by the service with a reason the app can word ("PHOTO_TOO_LARGE")
 * rather than by the upload layer with none.
 */
const UPLOAD_LIMIT = { fileSize: FACE_RULES.maxPhotoBytes * 2 };

// Attendance by face.
//
// The "clock" routes are open to a linked phone with nobody logged in (as the
// PIN screen is): the device token in the request says which outlet it is.
// Everything else needs a login: reading is for the Owner and the Manager,
// correcting for the Owner alone (the grants are in permissions.ts, and the
// service checks the outlet). The Head Chef's view of who is in today is the
// day sheet under /staff/attendance/day.
//
// Activity log: clocking in and out and face scans are never logged (each employee's
// attendance, already in the restaurant's own trail). The Owner's corrections and
// settings are logged as the action, the outlet and who did it, with no staff name,
// time or value (`staffData`).
const NOT_LOGGED = "An employee's own clock-in, clock-out or face scan: never logged (founder's attendance decisions).";

@Controller('attendance')
export class AttendanceController {
  constructor(
    private readonly attendance: AttendanceService,
    private readonly clock: ClockService,
  ) {}

  // ───────────────────────── Clocking in and out (linked phone, no login) ─────────────────────────

  /** One photo of the face (`photo`), and optionally a second after "turn your head" (`photo2`). Marks nothing. */
  @Public()
  @Post('clock/identify')
  @HttpCode(200)
  @Activity('staff.clock.identified', { never: NOT_LOGGED })
  @UseInterceptors(FileFieldsInterceptor([{ name: 'photo', maxCount: 1 }, { name: 'photo2', maxCount: 1 }], { limits: UPLOAD_LIMIT }))
  identify(
    @UploadedFiles() files: { photo?: Upload[]; photo2?: Upload[] } | undefined,
    @Body() body: Record<string, unknown> | undefined,
  ): Promise<ClockIdentifyDto> {
    return this.clock.identify(body?.deviceToken, files?.photo?.[0]?.buffer, files?.photo2?.[0]?.buffer);
  }

  /** "Yes, that's me": writes the punch the ticket stands for. */
  @Public()
  @Post('clock/confirm')
  @HttpCode(200)
  @Activity('staff.clock.confirmed', { never: NOT_LOGGED })
  confirm(@Body(new ZodValidationPipe(clockConfirmSchema)) body: z.output<typeof clockConfirmSchema>): Promise<ClockPunchResultDto> {
    return this.clock.confirm(body.deviceToken, body.ticket);
  }

  /** The Owner or a Manager vouches with their PIN. An optional `photo` of the person is kept with the punch. */
  @Public()
  @Post('clock/assisted')
  @HttpCode(200)
  @Activity('staff.clock.assisted', { never: NOT_LOGGED })
  @UseInterceptors(FileInterceptor('photo', { limits: UPLOAD_LIMIT }))
  assisted(@UploadedFile() photo: Upload | undefined, @Body() body: unknown): Promise<ClockPunchResultDto> {
    return this.clock.assisted(body, photo?.buffer);
  }

  /** The outlet's staff by name, for the assisted route's picker. */
  @Public()
  @Get('clock/roster')
  roster(@Query('deviceToken') deviceToken?: string): Promise<ClockRosterDto> {
    return this.clock.roster(deviceToken);
  }

  // ───────────────────────── Reading (Owner and Manager) ─────────────────────────

  /** One person's punches for a month, day by day, voided ones included. */
  @Get('punches')
  @RequirePermission('attendance', 'read')
  punches(@CurrentUser() user: AuthUser, @Query('staffId') staffId?: string, @Query('month') month?: string) {
    if (!staffId) throw new BadRequestException('staffId is required');
    return this.attendance.punchesMonth(user, staffId, month || undefined);
  }

  /** What is waiting for the Owner at an outlet: marked punches, and days whose status is a stand-in. */
  @Get('review')
  @RequirePermission('attendance', 'read')
  review(@CurrentUser() user: AuthUser, @Query('outletId') outletId?: string) {
    if (!outletId) throw new BadRequestException('outletId is required');
    return this.attendance.review(user, outletId);
  }

  /**
   * The photo taken at a punch, for a reader who is logged in. (The apps
   * normally show it through the signed link in `photoPath`, which image tags
   * can load; that link is only ever given to the Owner and the Manager.)
   */
  @Get('punches/:id/photo')
  @RequirePermission('attendance', 'read')
  async photo(@CurrentUser() user: AuthUser, @Param('id') id: string, @Res() response: Response): Promise<void> {
    const { body, mimeType } = await this.attendance.photo(user, id);
    response.setHeader('Content-Type', mimeType);
    response.setHeader('Cache-Control', 'private, no-store');
    response.setHeader('X-Content-Type-Options', 'nosniff');
    body.pipe(response);
  }

  @Get('settings/:outletId')
  @RequirePermission('attendance', 'read')
  settings(@CurrentUser() user: AuthUser, @Param('outletId') outletId: string) {
    return this.attendance.getSettings(user, outletId);
  }

  // ───────────────────────── Correcting (Owner only) ─────────────────────────

  /** What counts as a full day and a half day at this outlet. */
  @Put('settings/:outletId')
  @RequirePermission('attendance', 'update')
  @Activity('staff.settings.changed', { staffData: true })
  saveSettings(
    @CurrentUser() user: AuthUser,
    @Param('outletId') outletId: string,
    @Body(new ZodValidationPipe(attendanceSettingsSchema)) body: z.output<typeof attendanceSettingsSchema>,
  ) {
    return this.attendance.saveSettings(user, outletId, body);
  }

  /** Sets one person's status for a day (leave, weekly off, a correction), or with a null status takes the Owner's entry away. */
  @Put('day')
  @HttpCode(204)
  @RequirePermission('attendance', 'update')
  @Activity('staff.attendance.corrected', { staffData: true, entity: 'staffMember', from: 'body', key: 'staffId' })
  async correctDay(@CurrentUser() user: AuthUser, @Body(new ZodValidationPipe(correctDaySchema)) body: z.output<typeof correctDaySchema>): Promise<void> {
    await this.attendance.correctDay(user, body);
  }

  /** Adds a punch the camera never recorded. */
  @Post('punches')
  @RequirePermission('attendance', 'create')
  @Activity('staff.punch.added', { staffData: true, entity: 'staffMember', from: 'body', key: 'staffId' })
  addPunch(@CurrentUser() user: AuthUser, @Body(new ZodValidationPipe(addPunchSchema)) body: z.output<typeof addPunchSchema>) {
    return this.attendance.addPunch(user, body);
  }

  /** Strikes a wrong punch out. It stays on record. */
  @Post('punches/:id/void')
  @HttpCode(200)
  @RequirePermission('attendance', 'update')
  @Activity('staff.punch.voided', { staffData: true, entity: 'attendancePunch' })
  voidPunch(@CurrentUser() user: AuthUser, @Param('id') id: string, @Body(new ZodValidationPipe(voidPunchSchema)) body: z.output<typeof voidPunchSchema>) {
    return this.attendance.voidPunch(user, id, body.reason);
  }

  /** The Owner has looked at a marked punch and lets it stand. */
  @Post('punches/:id/review')
  @HttpCode(200)
  @RequirePermission('attendance', 'update')
  @Activity('staff.punch.reviewed', { staffData: true, entity: 'attendancePunch' })
  reviewPunch(@CurrentUser() user: AuthUser, @Param('id') id: string) {
    return this.attendance.reviewPunch(user, id);
  }
}
