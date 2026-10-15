import { Controller, Get, HttpCode, Param, Post } from '@nestjs/common';
import { Activity } from '../activity-log/activity.decorator.js';
import { CurrentUser, RequirePermission } from '../auth/auth.decorators.js';
import type { AuthUser } from '../auth/auth.types.js';
import { ScoreExplainService } from './score-explain.service.js';
import { ScoresService } from './scores.service.js';

@Controller('scores')
export class ScoresController {
  constructor(
    private readonly scores: ScoresService,
    private readonly explainer: ScoreExplainService,
  ) {}

  /**
   * An outlet's hygiene score now: the number, its band, the change on last week,
   * and (except for the Head Chef) the breakdown and the last 30 days.
   */
  @Get(':outletId')
  @RequirePermission('scores', 'read')
  get(@CurrentUser() user: AuthUser, @Param('outletId') outletId: string) {
    return this.scores.forOutlet(user, outletId);
  }

  /**
   * "Why this score?": three sentences written by AI from the score's own numbers,
   * for the Owner and the Manager. Answers 503 with AI_OFF, AI_LIMIT or AI_FAILED
   * when AI steps aside; the app then shows its plain list of what is costing points.
   */
  @Post(':outletId/explain')
  @HttpCode(200)
  @RequirePermission('scores', 'read')
  @Activity('scores.score.explained', { entity: 'outlet', key: 'outletId' })
  explain(@CurrentUser() user: AuthUser, @Param('outletId') outletId: string) {
    return this.explainer.explain(user, outletId);
  }
}
