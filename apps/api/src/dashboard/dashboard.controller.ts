import { Controller, Get } from '@nestjs/common';
import { CurrentUser, RequirePermission } from '../auth/auth.decorators.js';
import type { AuthUser } from '../auth/auth.types.js';
import { DashboardService } from './dashboard.service.js';

@Controller('dashboard')
export class DashboardController {
  constructor(private readonly dashboard: DashboardService) {}

  /** Today at each of the person's outlets. Everyone at a restaurant can read checklists, so that is the gate. */
  @Get()
  @RequirePermission('checklists', 'read')
  get(@CurrentUser() user: AuthUser) {
    return this.dashboard.forUser(user);
  }
}
