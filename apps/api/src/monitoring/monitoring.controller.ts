import { Controller, Get, HttpCode, Post, Query } from '@nestjs/common';
import { Activity } from '../activity-log/activity.decorator.js';
import { CurrentUser, RequirePermission } from '../auth/auth.decorators.js';
import type { AuthUser } from '../auth/auth.types.js';
import { MonitoringDigestService } from './monitoring-digest.service.js';
import { MonitoringService } from './monitoring.service.js';

@Controller('monitoring')
export class MonitoringController {
  constructor(
    private readonly monitoring: MonitoringService,
    private readonly digests: MonitoringDigestService,
  ) {}

  /**
   * The monitoring board: every outlet the person may see and how each is doing.
   * `days` is how far back the checklist and rating figures look (7 unless given,
   * 31 at most). Reading clients is the coarse gate; the service then refuses
   * anyone who is not ECCS staff, because restaurant Owners can read clients too.
   */
  @Get()
  @RequirePermission('clients', 'read')
  board(@CurrentUser() user: AuthUser, @Query('days') days?: string) {
    return this.monitoring.board(user, days ? Number(days) : undefined);
  }

  /**
   * Today's digest of the board, written by AI (Super Admin and Operations Manager
   * only). Asked for separately, so the board never waits for it. Fails with code
   * AI_OFF, AI_LIMIT or AI_FAILED when AI steps aside; the board is unchanged.
   */
  @Get('digest')
  @RequirePermission('clients', 'read')
  digest(@CurrentUser() user: AuthUser) {
    return this.digests.today(user);
  }

  /** "Update": a fresh digest, at most once an hour. */
  @Post('digest')
  @HttpCode(200)
  @RequirePermission('clients', 'read')
  @Activity('ai.digest.updated')
  updateDigest(@CurrentUser() user: AuthUser) {
    return this.digests.update(user);
  }
}
