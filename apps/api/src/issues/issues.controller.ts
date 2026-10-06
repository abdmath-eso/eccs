import { Body, Controller, Get, HttpCode, Param, Patch, Post, Query } from '@nestjs/common';
import {
  addIssueCommentSchema,
  createIssueSchema,
  updateIssueSchema,
  type SupportContactDto,
} from '@eccs/shared';
import type { z } from 'zod';
import { CurrentUser, RequirePermission } from '../auth/auth.decorators.js';
import type { AuthUser } from '../auth/auth.types.js';
import { ZodValidationPipe } from '../common/zod-validation.pipe.js';
import { env } from '../config/env.js';
import { IssuesService } from './issues.service.js';

@Controller()
export class IssuesController {
  constructor(private readonly issues: IssuesService) {}

  /** How to reach ECCS directly, for the call and WhatsApp buttons in the app. */
  @Get('support/contact')
  contact(): SupportContactDto {
    return { phone: env.SUPPORT_PHONE, whatsapp: env.SUPPORT_WHATSAPP, hours: env.SUPPORT_HOURS };
  }

  @Get('issues')
  @RequirePermission('issues', 'read')
  list(@CurrentUser() user: AuthUser, @Query('outletId') outletId?: string, @Query('status') status?: string) {
    return this.issues.list(user, { outletId: outletId || undefined, openOnly: status === 'open' });
  }

  @Post('issues')
  @RequirePermission('issues', 'create')
  create(
    @CurrentUser() user: AuthUser,
    @Body(new ZodValidationPipe(createIssueSchema)) body: z.output<typeof createIssueSchema>,
  ) {
    return this.issues.create(user, body);
  }

  @Get('issues/:id')
  @RequirePermission('issues', 'read')
  get(@CurrentUser() user: AuthUser, @Param('id') id: string) {
    return this.issues.get(user, id);
  }

  @Post('issues/:id/comments')
  @HttpCode(200)
  @RequirePermission('issues', 'read')
  addComment(
    @CurrentUser() user: AuthUser,
    @Param('id') id: string,
    @Body(new ZodValidationPipe(addIssueCommentSchema)) body: z.output<typeof addIssueCommentSchema>,
  ) {
    return this.issues.addComment(user, id, body.body);
  }

  @Patch('issues/:id')
  @RequirePermission('issues', 'update')
  setStatus(
    @CurrentUser() user: AuthUser,
    @Param('id') id: string,
    @Body(new ZodValidationPipe(updateIssueSchema)) body: z.output<typeof updateIssueSchema>,
  ) {
    return this.issues.setStatus(user, id, body.status);
  }
}
