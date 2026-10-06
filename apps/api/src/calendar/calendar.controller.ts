import { BadRequestException, Controller, Get, Query } from '@nestjs/common';
import { CurrentUser, RequirePermission } from '../auth/auth.decorators.js';
import type { AuthUser } from '../auth/auth.types.js';
import { indiaDate } from '../checklists/checklists.service.js';
import { CalendarService } from './calendar.service.js';

@Controller('calendar')
export class CalendarController {
  constructor(private readonly calendar: CalendarService) {}

  /**
   * One month of an outlet's calendar; `month` is YYYY-MM and defaults to
   * this month. Service visits are part of it, so being able to see those
   * is the gate: the Owner and Manager, not the Head Chef.
   */
  @Get()
  @RequirePermission('jobs', 'read')
  month(@CurrentUser() user: AuthUser, @Query('outletId') outletId?: string, @Query('month') month?: string) {
    if (!outletId) throw new BadRequestException('outletId is required');
    return this.calendar.month(user, outletId, month || indiaDate().slice(0, 7));
  }
}
