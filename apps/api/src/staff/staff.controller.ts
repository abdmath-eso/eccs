import { BadRequestException, Body, Controller, Delete, Get, HttpCode, Param, Patch, Post, Put, Query } from '@nestjs/common';
import {
  addPayEntrySchema,
  createStaffMemberSchema,
  markAttendanceSchema,
  saveSalarySchema,
  updateStaffMemberSchema,
} from '@eccs/shared';
import type { z } from 'zod';
import { CurrentUser, RequirePermission } from '../auth/auth.decorators.js';
import type { AuthUser } from '../auth/auth.types.js';
import { ZodValidationPipe } from '../common/zod-validation.pipe.js';
import { StaffService } from './staff.service.js';

// The restaurant's own staff, their attendance and the salary tracker.
// The decorators check that the role allows the action at all (ECCS roles have
// no grant on staff, attendance or salary, so every route refuses them); the
// service then checks the specific outlet.
@Controller('staff')
export class StaffController {
  constructor(private readonly staff: StaffService) {}

  // ───────────────────────── People ─────────────────────────

  @Get('people')
  @RequirePermission('staff', 'read')
  people(@CurrentUser() user: AuthUser, @Query('outletId') outletId?: string, @Query('left') left?: string) {
    if (!outletId) throw new BadRequestException('outletId is required');
    return this.staff.listPeople(user, outletId, left === '1');
  }

  @Post('people')
  @RequirePermission('staff', 'create')
  create(
    @CurrentUser() user: AuthUser,
    @Body(new ZodValidationPipe(createStaffMemberSchema)) body: z.output<typeof createStaffMemberSchema>,
  ) {
    return this.staff.createPerson(user, body);
  }

  @Patch('people/:id')
  @RequirePermission('staff', 'update')
  update(
    @CurrentUser() user: AuthUser,
    @Param('id') id: string,
    @Body(new ZodValidationPipe(updateStaffMemberSchema)) body: z.output<typeof updateStaffMemberSchema>,
  ) {
    return this.staff.updatePerson(user, id, body);
  }

  /** Only for someone added by mistake: a person with records is marked as having left instead. */
  @Delete('people/:id')
  @HttpCode(204)
  @RequirePermission('staff', 'update')
  async remove(@CurrentUser() user: AuthUser, @Param('id') id: string): Promise<void> {
    await this.staff.removePerson(user, id);
  }

  // ───────────────────────── Attendance ─────────────────────────

  /**
   * The day's sheet: who is in, and each person's status. For whoever reads attendance:
   * the Owner and the Manager. The Head Chef has no attendance page (13 Oct 2026).
   */
  @Get('attendance/day')
  @RequirePermission('attendance', 'read')
  day(@CurrentUser() user: AuthUser, @Query('outletId') outletId?: string, @Query('date') date?: string) {
    if (!outletId) throw new BadRequestException('outletId is required');
    return this.staff.day(user, outletId, date || undefined);
  }

  /**
   * The Owner's correction of a day, with a reason. Nobody marks attendance by hand
   * since face attendance: the Manager and the Head Chef are refused here (403).
   */
  @Put('attendance/day')
  @RequirePermission('attendance', 'update')
  mark(
    @CurrentUser() user: AuthUser,
    @Body(new ZodValidationPipe(markAttendanceSchema)) body: z.output<typeof markAttendanceSchema>,
  ) {
    return this.staff.mark(user, body);
  }

  @Get('attendance/month')
  @RequirePermission('attendance', 'read')
  month(@CurrentUser() user: AuthUser, @Query('outletId') outletId?: string, @Query('month') month?: string) {
    if (!outletId) throw new BadRequestException('outletId is required');
    return this.staff.outletMonth(user, outletId, month || undefined);
  }

  @Get('people/:id/attendance')
  @RequirePermission('attendance', 'read')
  personMonth(@CurrentUser() user: AuthUser, @Param('id') id: string, @Query('month') month?: string) {
    return this.staff.personMonth(user, id, month || undefined);
  }

  // ───────────────────────── Salary tracker ─────────────────────────

  @Get('salary')
  @RequirePermission('salary', 'read')
  salary(@CurrentUser() user: AuthUser, @Query('outletId') outletId?: string, @Query('month') month?: string) {
    if (!outletId) throw new BadRequestException('outletId is required');
    return this.staff.salaryMonth(user, outletId, month || undefined);
  }

  @Get('people/:id/salary')
  @RequirePermission('salary', 'read')
  personSalary(@CurrentUser() user: AuthUser, @Param('id') id: string, @Query('month') month?: string) {
    return this.staff.personSalary(user, id, month || undefined);
  }

  @Put('people/:id/salary/:month')
  @RequirePermission('salary', 'update')
  saveSalary(
    @CurrentUser() user: AuthUser,
    @Param('id') id: string,
    @Param('month') month: string,
    @Body(new ZodValidationPipe(saveSalarySchema)) body: z.output<typeof saveSalarySchema>,
  ) {
    return this.staff.saveSalary(user, id, month, body);
  }

  @Post('people/:id/pay-entries')
  @RequirePermission('salary', 'create')
  addPayEntry(
    @CurrentUser() user: AuthUser,
    @Param('id') id: string,
    @Body(new ZodValidationPipe(addPayEntrySchema)) body: z.output<typeof addPayEntrySchema>,
  ) {
    return this.staff.addPayEntry(user, id, body);
  }

  @Delete('pay-entries/:id')
  @RequirePermission('salary', 'update')
  removePayEntry(@CurrentUser() user: AuthUser, @Param('id') id: string) {
    return this.staff.removePayEntry(user, id);
  }
}
