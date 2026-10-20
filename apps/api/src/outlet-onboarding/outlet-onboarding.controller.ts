import { Body, Controller, Delete, Get, HttpCode, Param, Post } from '@nestjs/common';
import { onboardingEntrySchema } from '@eccs/shared';
import type { z } from 'zod';
import { Activity } from '../activity-log/activity.decorator.js';
import { CurrentUser, RequirePermission } from '../auth/auth.decorators.js';
import type { AuthUser } from '../auth/auth.types.js';
import { ZodValidationPipe } from '../common/zod-validation.pipe.js';
import { OutletOnboardingService } from './outlet-onboarding.service.js';

// Clients > New outlets (20 Oct 2026): the Super Admin and the Ops Manager, who onboard
// restaurants (clients:create to read and start, clients:update to log a step).
@Controller('outlet-onboarding')
export class OutletOnboardingController {
  constructor(private readonly onboarding: OutletOnboardingService) {}

  /** The tab: outlets in their first ten days, the strip, and outlets that could still be started. */
  @Get()
  @RequirePermission('clients', 'create')
  board() {
    return this.onboarding.board();
  }

  /** For the Today page: outlets not live after 24 hours, and the day-3 and day-10 calls due. */
  @Get('attention')
  @RequirePermission('clients', 'create')
  attention() {
    return this.onboarding.attention();
  }

  @Post('outlets/:outletId/start')
  @HttpCode(200)
  @RequirePermission('clients', 'create')
  @Activity('clients.onboarding.started', { entity: 'outlet', key: 'outletId' })
  start(@CurrentUser() user: AuthUser, @Param('outletId') outletId: string) {
    return this.onboarding.start(user, outletId);
  }

  /** One tap: the day-3 call, the QR posters delivered, the day-10 call, or a note. The note itself is never logged. */
  @Post('outlets/:outletId/entries')
  @RequirePermission('clients', 'update')
  @Activity('clients.onboarding.logged', { entity: 'outlet', key: 'outletId', facts: ['kind'] })
  log(
    @CurrentUser() user: AuthUser,
    @Param('outletId') outletId: string,
    @Body(new ZodValidationPipe(onboardingEntrySchema)) body: z.output<typeof onboardingEntrySchema>,
  ) {
    return this.onboarding.log(user, outletId, body);
  }

  @Delete('outlets/:outletId/entries/:entryId')
  @RequirePermission('clients', 'update')
  @Activity('clients.onboarding.undone', { entity: 'outlet', key: 'outletId' })
  remove(@Param('outletId') outletId: string, @Param('entryId') entryId: string) {
    return this.onboarding.remove(outletId, entryId);
  }
}
