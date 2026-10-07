import { Controller, Get, Param } from '@nestjs/common';
import { CurrentUser, RequirePermission } from '../auth/auth.decorators.js';
import type { AuthUser } from '../auth/auth.types.js';
import { ScoresService } from './scores.service.js';

@Controller('scores')
export class ScoresController {
  constructor(private readonly scores: ScoresService) {}

  /**
   * An outlet's hygiene score now: the number, its band, the change on last week,
   * and (except for the Head Chef) the breakdown and the last 30 days.
   */
  @Get(':outletId')
  @RequirePermission('scores', 'read')
  get(@CurrentUser() user: AuthUser, @Param('outletId') outletId: string) {
    return this.scores.forOutlet(user, outletId);
  }
}
