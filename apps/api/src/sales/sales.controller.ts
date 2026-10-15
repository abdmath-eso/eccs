import { Body, Controller, Delete, Get, HttpCode, Param, Patch, Post, Put, Query } from '@nestjs/common';
import {
  leadListQuerySchema,
  leadSchema,
  leadUpdateSchema,
  linkClientSchema,
  loseSchema,
  parkSchema,
  quoteSchema,
  salesOverviewQuerySchema,
  stepSchema,
  targetFloorsSchema,
  targetSchema,
  type DoTodayItemDto,
  type LeadDetailDto,
  type LeadListDto,
  type LeadListQuery,
  type LeadUpdateValues,
  type LeadValues,
  type QuoteDto,
  type QuoteOptionDto,
  type QuoteSentDto,
  type SalesOverviewDto,
  type StepValues,
  type TargetFigures,
} from '@eccs/shared';
import { z } from 'zod';
import { Activity } from '../activity-log/activity.decorator.js';
import { CurrentUser, RequirePermission } from '../auth/auth.decorators.js';
import type { AuthUser } from '../auth/auth.types.js';
import { ZodValidationPipe } from '../common/zod-validation.pipe.js';
import { SalesOverviewService } from './sales-overview.service.js';
import { SalesService } from './sales.service.js';

// The Sales page and the CRM (15 Oct 2026). Every route needs the "sales" grant: the
// Super Admin, the Ops Manager and the BDEs (permissions.ts). A BDE reaches only the
// leads they own, which the service checks on every request; the Supervisor and every
// restaurant user are refused (403). Every route that changes something carries an
// activity log key, with the lead by its business name, its stage and the kind of step,
// never the contact's name or number, a note or a reason typed in.
@Controller('sales')
export class SalesController {
  constructor(
    private readonly sales: SalesService,
    private readonly figures: SalesOverviewService,
  ) {}

  /** Everything on the Sales page, for everyone or one person (`owner`). A BDE always sees their own. */
  @Get('overview')
  @RequirePermission('sales', 'read')
  overview(@CurrentUser() user: AuthUser, @Query(new ZodValidationPipe(salesOverviewQuerySchema)) query: { owner?: string }): Promise<SalesOverviewDto> {
    return this.figures.overview(user, query);
  }

  /** Today's to-dos for the leads a person reaches: the menu's number, and the BDE's day on the phone (B2). */
  @Get('do-today')
  @RequirePermission('sales', 'read')
  doToday(@CurrentUser() user: AuthUser): Promise<{ items: DoTodayItemDto[] }> {
    return this.sales.doToday(user);
  }

  @Get('leads')
  @RequirePermission('sales', 'read')
  list(@CurrentUser() user: AuthUser, @Query(new ZodValidationPipe(leadListQuerySchema)) query: LeadListQuery): Promise<LeadListDto> {
    return this.sales.list(user, query);
  }

  @Get('leads/:id')
  @RequirePermission('sales', 'read')
  detail(@CurrentUser() user: AuthUser, @Param('id') id: string): Promise<LeadDetailDto> {
    return this.sales.detail(user, id);
  }

  /** What a quote can hold: the services and plans on offer, with their prices before GST. */
  @Get('quote-options')
  @RequirePermission('sales', 'read')
  quoteOptions(): Promise<QuoteOptionDto[]> {
    return this.sales.quoteOptions();
  }

  // ───────────────────────── Leads ─────────────────────────

  @Post('leads')
  @RequirePermission('sales', 'create')
  @Activity('sales.lead.added', { entity: 'lead', from: 'answer', facts: ['source'] })
  create(@CurrentUser() user: AuthUser, @Body(new ZodValidationPipe(leadSchema)) body: LeadValues): Promise<LeadDetailDto> {
    return this.sales.create(user, body);
  }

  @Patch('leads/:id')
  @RequirePermission('sales', 'update')
  @Activity('sales.lead.changed', { entity: 'lead' })
  update(@CurrentUser() user: AuthUser, @Param('id') id: string, @Body(new ZodValidationPipe(leadUpdateSchema)) body: LeadUpdateValues): Promise<LeadDetailDto> {
    return this.sales.update(user, id, body);
  }

  /** A call, a visit, a note, a free check booked or done, or what the owner asked. The lead moves right by itself. */
  @Post('leads/:id/steps')
  @RequirePermission('sales', 'create')
  @Activity('sales.step.logged', { entity: 'lead', facts: ['kind', 'signal'] })
  step(@CurrentUser() user: AuthUser, @Param('id') id: string, @Body(new ZodValidationPipe(stepSchema)) body: StepValues): Promise<LeadDetailDto> {
    return this.sales.logStep(user, id, body);
  }

  @Post('leads/:id/park')
  @HttpCode(200)
  @RequirePermission('sales', 'update')
  @Activity('sales.lead.parked', { entity: 'lead' })
  park(@CurrentUser() user: AuthUser, @Param('id') id: string, @Body(new ZodValidationPipe(parkSchema)) body: { until: string; reason: string }): Promise<LeadDetailDto> {
    return this.sales.park(user, id, body);
  }

  @Post('leads/:id/lose')
  @HttpCode(200)
  @RequirePermission('sales', 'update')
  @Activity('sales.lead.lost', { entity: 'lead' })
  lose(@CurrentUser() user: AuthUser, @Param('id') id: string, @Body(new ZodValidationPipe(loseSchema)) body: { reason: string }): Promise<LeadDetailDto> {
    return this.sales.lose(user, id, body);
  }

  @Post('leads/:id/reopen')
  @HttpCode(200)
  @RequirePermission('sales', 'update')
  @Activity('sales.lead.reopened', { entity: 'lead' })
  reopen(@CurrentUser() user: AuthUser, @Param('id') id: string): Promise<LeadDetailDto> {
    return this.sales.reopen(user, id);
  }

  /** "Became a client": which client the lead turned into (or null to undo). Also needs the clients grant. */
  @Put('leads/:id/client')
  @RequirePermission('sales', 'update')
  @Activity('sales.lead.linked', { entity: 'lead' })
  link(@CurrentUser() user: AuthUser, @Param('id') id: string, @Body(new ZodValidationPipe(linkClientSchema)) body: { organizationId: string | null }): Promise<LeadDetailDto> {
    return this.sales.linkClient(user, id, body.organizationId);
  }

  // ───────────────────────── Quotes ─────────────────────────

  @Post('leads/:id/quotes')
  @RequirePermission('sales', 'create')
  @Activity('sales.quote.added', { entity: 'quote', from: 'answer' })
  addQuote(@CurrentUser() user: AuthUser, @Param('id') id: string, @Body(new ZodValidationPipe(quoteSchema)) body: z.output<typeof quoteSchema>): Promise<QuoteDto> {
    return this.sales.addQuote(user, id, body);
  }

  /** The WhatsApp link with the message and the quote's link typed in. Nothing is sent by the server. */
  @Post('quotes/:id/send')
  @HttpCode(200)
  @RequirePermission('sales', 'update')
  @Activity('sales.quote.sent', { entity: 'quote' })
  send(@CurrentUser() user: AuthUser, @Param('id') id: string): Promise<QuoteSentDto> {
    return this.sales.sendQuote(user, id);
  }

  @Delete('quotes/:id')
  @HttpCode(204)
  @RequirePermission('sales', 'update')
  @Activity('sales.quote.removed', { entity: 'quote' })
  removeQuote(@CurrentUser() user: AuthUser, @Param('id') id: string): Promise<void> {
    return this.sales.removeQuote(user, id);
  }

  // ───────────────────────── Targets (the Super Admin) ─────────────────────────

  /** The lowest each weekly target can go. Declared before ":userId" so its path is not read as an id. */
  @Put('targets/floors')
  @RequirePermission('sales', 'approve')
  @Activity('sales.targets.floorsChanged', { facts: ['leads', 'checks', 'firstJobs', 'plans'] })
  floors(@Body(new ZodValidationPipe(targetFloorsSchema)) body: TargetFigures): Promise<TargetFigures> {
    return this.sales.setFloors(body);
  }

  /** One BDE's targets for a week, set by hand; a figure sent as null goes back to the suggestion. */
  @Put('targets/:userId')
  @RequirePermission('sales', 'approve')
  @Activity('sales.target.set', { entity: 'user', key: 'userId', facts: ['weekStart', 'leads', 'checks', 'firstJobs', 'plans'] })
  target(@CurrentUser() user: AuthUser, @Param('userId') userId: string, @Body(new ZodValidationPipe(targetSchema)) body: z.output<typeof targetSchema>): Promise<{ saved: boolean }> {
    return this.sales.setTarget(user, userId, body);
  }
}
