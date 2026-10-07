import { Controller, Get, Query } from '@nestjs/common';
import { CurrentUser, RequirePermission } from '../auth/auth.decorators.js';
import type { AuthUser } from '../auth/auth.types.js';
import { MonitoringService } from './monitoring.service.js';

@Controller('monitoring')
export class MonitoringController {
  constructor(private readonly monitoring: MonitoringService) {}

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
}
