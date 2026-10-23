import { Body, Controller, Get, HttpCode, Post, Query } from '@nestjs/common';
import { usageQuerySchema, usageViewsSchema, type UsageOverviewDto, type UsageQuery, type UsageViewsInput } from '@eccs/shared';
import { Activity } from '../activity-log/activity.decorator.js';
import { CurrentUser, RequirePermission } from '../auth/auth.decorators.js';
import type { AuthUser } from '../auth/auth.types.js';
import { ZodValidationPipe } from '../common/zod-validation.pipe.js';
import { AllowWithoutTerms } from '../legal/legal.decorators.js';
import { UsageService } from './usage.service.js';

const COUNTED_NOT_LOGGED = 'Screen opens are counted for the Usage page, never logged one by one.';

// The Usage page (23 Oct 2026). Every logged-in person's app sends the screens they open, with
// no grant needed: it only ever adds to that person's own counts. Before agreeing to the terms
// too, so the agreement screen is counted. Only the Super Admin reads the page (usage R).
@Controller('usage')
export class UsageController {
  constructor(private readonly usage: UsageService) {}

  /** The screens this person opened, sent by their app every half minute: at most 50 at a time. */
  @Post('views')
  @HttpCode(204)
  @AllowWithoutTerms()
  @Activity('system.usage.counted', { never: COUNTED_NOT_LOGGED })
  async views(@CurrentUser() user: AuthUser, @Body(new ZodValidationPipe(usageViewsSchema)) body: UsageViewsInput): Promise<void> {
    await this.usage.record(user, body);
  }

  /** Everything on the page: `days` (7, 30 or 90), `segment` (restaurants or team), and one `restaurant` if chosen. */
  @Get('overview')
  @RequirePermission('usage', 'read')
  overview(@Query(new ZodValidationPipe(usageQuerySchema)) query: UsageQuery): Promise<UsageOverviewDto> {
    return this.usage.overview(query);
  }
}
