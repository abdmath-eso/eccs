import { Body, Controller, Delete, Get, HttpCode, Param, Patch, Post, Put } from '@nestjs/common';
import {
  leaveSchema,
  markLeftSchema,
  teamChangeSchema,
  teamMemberSchema,
  teamSettingsSchema,
  type LeaveValues,
  type TeamChangeValues,
  type TeamListDto,
  type TeamMemberDto,
  type TeamMemberValues,
} from '@eccs/shared';
import { z } from 'zod';
import { Activity } from '../activity-log/activity.decorator.js';
import { CurrentUser, RequirePermission } from '../auth/auth.decorators.js';
import type { AuthUser } from '../auth/auth.types.js';
import { ZodValidationPipe } from '../common/zod-validation.pipe.js';
import { TeamService } from './team.service.js';

// The Team page (16 Oct 2026): ECCS's own staff. Reading needs the "team" grant (the Super
// Admin and the Ops Manager; a BDE, a Supervisor and every restaurant user are refused);
// salaries are sent only to the Super Admin. Adding, changing and marking as left need the
// ECCS logins grant ("eccsUsers"), which only the Super Admin holds; leave needs "team" C
// and U (the Super Admin and the Ops Manager).
//
// Activity log: every change here is staff data (`staffData`), recorded as the action and
// who did it, never the person, their pay, their dates or the reason for their leave.
@Controller('team')
export class TeamController {
  constructor(private readonly team: TeamService) {}

  /** Everyone on the team, who is in today, their week and what to keep an eye on. */
  @Get()
  @RequirePermission('team', 'read')
  list(@CurrentUser() user: AuthUser): Promise<TeamListDto> {
    return this.team.list(user);
  }

  /** The share of follow-ups and arrivals on time aimed for. Declared before ":userId" so its path is not read as an id. */
  @Put('settings')
  @RequirePermission('team', 'approve')
  @Activity('team.settings.changed', { staffData: true })
  settings(@Body(new ZodValidationPipe(teamSettingsSchema)) body: { onTimeTargetPercent: number }): Promise<{ onTimeTargetPercent: number }> {
    return this.team.saveSettings(body);
  }

  /** Removes a day or days of leave. Declared before ":userId". */
  @Delete('leave/:leaveId')
  @HttpCode(204)
  @RequirePermission('team', 'update')
  @Activity('team.leave.removed', { staffData: true })
  removeLeave(@Param('leaveId') leaveId: string): Promise<void> {
    return this.team.removeLeave(leaveId);
  }

  /** One person's page, by their login's id. */
  @Get(':userId')
  @RequirePermission('team', 'read')
  member(@CurrentUser() user: AuthUser, @Param('userId') userId: string): Promise<TeamMemberDto> {
    return this.team.member(user, userId);
  }

  /** Adds a team member with their ECCS login (phone number and one-time code). */
  @Post()
  @RequirePermission('eccsUsers', 'create')
  @Activity('team.member.added', { staffData: true })
  add(@CurrentUser() user: AuthUser, @Body(new ZodValidationPipe(teamMemberSchema)) body: TeamMemberValues): Promise<TeamMemberDto> {
    return this.team.add(user, body);
  }

  @Patch(':userId')
  @RequirePermission('eccsUsers', 'update')
  @Activity('team.member.changed', { staffData: true })
  change(@CurrentUser() user: AuthUser, @Param('userId') userId: string, @Body(new ZodValidationPipe(teamChangeSchema)) body: TeamChangeValues): Promise<TeamMemberDto> {
    return this.team.change(user, userId, body);
  }

  /** Their last day: the login stops working, the records stay, open leads are handed over first. */
  @Post(':userId/mark-left')
  @HttpCode(200)
  @RequirePermission('eccsUsers', 'update')
  @Activity('team.member.left', { staffData: true })
  markLeft(@CurrentUser() user: AuthUser, @Param('userId') userId: string, @Body(new ZodValidationPipe(markLeftSchema)) body: z.output<typeof markLeftSchema>): Promise<TeamMemberDto> {
    return this.team.markLeft(user, userId, body);
  }

  @Post(':userId/leave')
  @RequirePermission('team', 'create')
  @Activity('team.leave.added', { staffData: true })
  addLeave(@CurrentUser() user: AuthUser, @Param('userId') userId: string, @Body(new ZodValidationPipe(leaveSchema)) body: LeaveValues): Promise<TeamMemberDto> {
    return this.team.addLeave(user, userId, body);
  }
}
