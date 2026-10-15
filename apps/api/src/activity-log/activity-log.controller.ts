import { Controller, Get, Param, Query, Res } from '@nestjs/common';
import {
  activityLogQuerySchema,
  type ActivityLogEventDto,
  type ActivityLogFacetsDto,
  type ActivityLogPageDto,
  type ActivityLogQuery,
  type ActivityLogSummaryDto,
} from '@eccs/shared';
import type { Response } from 'express';
import { RequirePermission } from '../auth/auth.decorators.js';
import { ZodValidationPipe } from '../common/zod-validation.pipe.js';
import { noteActivity } from './activity-context.js';
import { Activity } from './activity.decorator.js';
import { ActivityLogReaderService } from './activity-log-reader.service.js';

/** The names of the filters used for an export, for its own log row (never what was typed in the search). */
const filtersUsed = (query: ActivityLogQuery) =>
  Object.entries(query)
    .filter(([name, value]) => name !== 'cursor' && name !== 'limit' && value !== undefined && value !== false)
    .map(([name]) => name)
    .sort();

// The console's Logs page. Only the Super Admin and the Ops Manager hold the auditLog
// grant (permissions.ts), so a Supervisor and every restaurant user are refused (403).
// Every route takes the same filters (activityLogQuerySchema in packages/shared).
@Controller('activity-log')
export class ActivityLogController {
  constructor(private readonly reader: ActivityLogReaderService) {}

  /** The list, newest first, 50 at a time; `nextCursor` is passed back as `cursor` for the next page. */
  @Get()
  @RequirePermission('auditLog', 'read')
  list(@Query(new ZodValidationPipe(activityLogQuerySchema)) query: ActivityLogQuery): Promise<ActivityLogPageDto> {
    return this.reader.list(query);
  }

  /** The choices for the filter menus, with counts under the other filters. */
  @Get('facets')
  @RequirePermission('auditLog', 'read')
  facets(@Query(new ZodValidationPipe(activityLogQuerySchema)) query: ActivityLogQuery): Promise<ActivityLogFacetsDto> {
    return this.reader.facets(query);
  }

  /** Events, failures, people, AI calls and AI cost under the current filters. */
  @Get('summary')
  @RequirePermission('auditLog', 'read')
  summary(@Query(new ZodValidationPipe(activityLogQuerySchema)) query: ActivityLogQuery): Promise<ActivityLogSummaryDto> {
    return this.reader.summary(query);
  }

  /** The current filters as a CSV file, newest first, at most 10,000 rows. The export itself is logged. */
  @Get('export')
  @RequirePermission('auditLog', 'read')
  @Activity('system.logs.exported', { reads: 'always', place: false })
  async export(
    @Query(new ZodValidationPipe(activityLogQuerySchema)) query: ActivityLogQuery,
    @Res({ passthrough: true }) response: Response,
  ): Promise<string> {
    const { csv, rows, truncated } = await this.reader.exportCsv(query);
    noteActivity({ details: { rows, truncated, filters: filtersUsed(query) } });
    const day = new Intl.DateTimeFormat('en-CA', { timeZone: 'Asia/Kolkata' }).format(new Date());
    response.setHeader('Content-Type', 'text/csv; charset=utf-8');
    response.setHeader('Content-Disposition', `attachment; filename="eccs-activity-${day}.csv"`);
    response.setHeader('Cache-Control', 'private, no-store');
    response.setHeader('X-Export-Rows', String(rows));
    response.setHeader('X-Export-Truncated', truncated ? 'true' : 'false');
    return csv;
  }

  /** One event in full, with the other rows of the same request. */
  @Get(':id')
  @RequirePermission('auditLog', 'read')
  get(@Param('id') id: string): Promise<ActivityLogEventDto> {
    return this.reader.get(id);
  }
}
