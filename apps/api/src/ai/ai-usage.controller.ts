import { Body, Controller, Get, Patch, Query, Res } from '@nestjs/common';
import {
  aiSettingsPatchSchema,
  aiUsageQuerySchema,
  type AiAlertsDto,
  type AiOverviewDto,
  type AiRequestPageDto,
  type AiSettingsDto,
  type AiUsageQuery,
} from '@eccs/shared';
import type { Response } from 'express';
import type { z } from 'zod';
import { noteActivity } from '../activity-log/activity-context.js';
import { Activity } from '../activity-log/activity.decorator.js';
import { CurrentUser, RequirePermission } from '../auth/auth.decorators.js';
import type { AuthUser } from '../auth/auth.types.js';
import { ZodValidationPipe } from '../common/zod-validation.pipe.js';
import { AiSettingsService } from './ai-settings.service.js';
import { AiUsageService } from './ai-usage.service.js';

/** The names of the filters used for an export, for its own log row. */
const filtersUsed = (query: AiUsageQuery) =>
  Object.entries(query)
    .filter(([name, value]) => name !== 'cursor' && name !== 'limit' && value !== undefined && !(Array.isArray(value) && value.length === 0))
    .map(([name]) => name)
    .sort();

// The console's AI usage page (19 Oct 2026). The Super Admin and the Ops Manager hold the
// aiUsage grant (permissions.ts) and read everything; only the Super Admin may change the
// AI settings. Everyone else is refused (403). Every reading route takes the same filters
// (aiUsageQuerySchema in packages/shared).
@Controller('ai')
export class AiUsageController {
  constructor(
    private readonly usage: AiUsageService,
    private readonly config: AiSettingsService,
  ) {}

  /** Everything on the overview: cards, the daily spend, by helper, by outlet, by model, findings, the filters' choices. */
  @Get('overview')
  @RequirePermission('aiUsage', 'read')
  overview(@Query(new ZodValidationPipe(aiUsageQuerySchema)) query: AiUsageQuery): Promise<AiOverviewDto> {
    return this.usage.overview(query);
  }

  /** The request log, newest first, 50 at a time; `nextCursor` is passed back as `cursor` for the next page. */
  @Get('requests')
  @RequirePermission('aiUsage', 'read')
  requests(@Query(new ZodValidationPipe(aiUsageQuerySchema)) query: AiUsageQuery): Promise<AiRequestPageDto> {
    return this.usage.requests(query);
  }

  /** The request log under the filters as a CSV file, at most 10,000 rows. No words of any prompt or answer. The export itself is logged. */
  @Get('requests/export')
  @RequirePermission('aiUsage', 'read')
  @Activity('ai.log.exported', { reads: 'always', place: false })
  async export(@Query(new ZodValidationPipe(aiUsageQuerySchema)) query: AiUsageQuery, @Res({ passthrough: true }) response: Response): Promise<string> {
    const { csv, rows, truncated } = await this.usage.exportCsv(query);
    noteActivity({ details: { rows, truncated, filters: filtersUsed(query) } });
    const day = new Intl.DateTimeFormat('en-CA', { timeZone: 'Asia/Kolkata' }).format(new Date());
    response.setHeader('Content-Type', 'text/csv; charset=utf-8');
    response.setHeader('Content-Disposition', `attachment; filename="eccs-ai-requests-${day}.csv"`);
    response.setHeader('Cache-Control', 'private, no-store');
    response.setHeader('X-Export-Rows', String(rows));
    response.setHeader('X-Export-Truncated', truncated ? 'true' : 'false');
    return csv;
  }

  /** The warnings true now (the page's banner and the menu's count). */
  @Get('alerts')
  @RequirePermission('aiUsage', 'read')
  alerts(): Promise<AiAlertsDto> {
    return this.usage.alerts();
  }

  /** The AI settings, what the server allows, and who changed what. The Ops Manager reads them too. */
  @Get('settings')
  @RequirePermission('aiUsage', 'read')
  settings(@CurrentUser() user: AuthUser): Promise<AiSettingsDto> {
    return this.usage.settings(user);
  }

  /**
   * Changes some of the AI settings (the Super Admin only). The change is laid over what is
   * saved and the whole is checked; it applies from the next request. What changed, from and
   * to, goes in the activity log.
   */
  @Patch('settings')
  @RequirePermission('aiUsage', 'update')
  @Activity('ai.settings.changed', { place: false })
  async change(
    @CurrentUser() user: AuthUser,
    @Body(new ZodValidationPipe(aiSettingsPatchSchema)) body: z.output<typeof aiSettingsPatchSchema>,
  ): Promise<AiSettingsDto> {
    await this.config.save(user, body);
    return this.usage.settings(user);
  }
}
