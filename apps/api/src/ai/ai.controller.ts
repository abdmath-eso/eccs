import { Body, Controller, Get, HttpCode, Param, Post } from '@nestjs/common';
import { aiOutcomeSchema, type AiStatusDto, type AiUsageDto } from '@eccs/shared';
import type { z } from 'zod';
import { Activity } from '../activity-log/activity.decorator.js';
import { CurrentUser } from '../auth/auth.decorators.js';
import type { AuthUser } from '../auth/auth.types.js';
import { ZodValidationPipe } from '../common/zod-validation.pipe.js';
import { AiService } from './ai.service.js';

// Every route needs a login (the guard sees to that). None of them needs a
// permission of its own: the status is the same for everyone, an outcome can only
// be set by the person who asked (or someone at the same outlet), and the spending
// report checks for the Super Admin or the Ops Manager itself.
@Controller('ai')
export class AiController {
  constructor(private readonly ai: AiService) {}

  /** Which AI features are on, so the apps show or hide their buttons. */
  @Get('status')
  async status(): Promise<AiStatusDto> {
    // The console's switches may have changed a moment ago (on another copy of the server).
    await this.ai.freshSettings();
    return this.ai.status();
  }

  /** What AI has cost today and this month, by feature. ECCS's Super Admin and Ops Manager only. */
  @Get('usage')
  usage(@CurrentUser() user: AuthUser): Promise<AiUsageDto> {
    return this.ai.usage(user);
  }

  /** What the person did with an answer: ACCEPTED, EDITED, DISCARDED, HELPFUL or NOT_HELPFUL. */
  @Post('requests/:id/outcome')
  @HttpCode(204)
  @Activity('ai.outcome.recorded', { entity: 'aiRequest', facts: ['outcome'] })
  async outcome(
    @CurrentUser() user: AuthUser,
    @Param('id') id: string,
    @Body(new ZodValidationPipe(aiOutcomeSchema)) body: z.output<typeof aiOutcomeSchema>,
  ): Promise<void> {
    await this.ai.setOutcome(user, id, body.outcome);
  }
}
