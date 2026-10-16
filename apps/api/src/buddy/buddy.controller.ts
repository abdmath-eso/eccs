import { Body, Controller, Delete, Get, HttpCode, Param, Post, Query } from '@nestjs/common';
import { BUDDY_SCREENS, buddyFeedbackSchema, buddyMessageSchema, type BuddyScreen } from '@eccs/shared';
import type { z } from 'zod';
import { Activity } from '../activity-log/activity.decorator.js';
import { CurrentUser } from '../auth/auth.decorators.js';
import type { AuthUser } from '../auth/auth.types.js';
import { ZodValidationPipe } from '../common/zod-validation.pipe.js';
import { BuddyService } from './buddy.service.js';

// ECCS Buddy's routes (16 Oct 2026). None needs a grant of its own: the service refuses everyone
// but the restaurant's Owner and Manager, and every tool and card then checks the grant of the
// app route it stands for. The activity log keeps what was done, never the words: a message is
// logged with the screen it came from and how many cards and Open buttons it led to; a card done
// is logged as the app's own action with through=buddy.
@Controller('buddy')
export class BuddyController {
  constructor(private readonly buddy: BuddyService) {}

  /** Whether Buddy can answer now, and the suggested prompts for the screen. */
  @Get('start')
  start(@CurrentUser() user: AuthUser, @Query('screen') screen?: string, @Query('outletId') outletId?: string) {
    const known = (BUDDY_SCREENS as readonly string[]).includes(screen ?? '') ? (screen as BuddyScreen) : 'other';
    return this.buddy.start(user, known, outletId || undefined);
  }

  /** Recent chats, newest first. */
  @Get('chats')
  chats(@CurrentUser() user: AuthUser) {
    return this.buddy.chats(user);
  }

  @Get('chats/:id')
  chat(@CurrentUser() user: AuthUser, @Param('id') id: string) {
    return this.buddy.chat(user, id);
  }

  @Delete('chats/:id')
  @HttpCode(204)
  @Activity('ai.buddy.chatDeleted')
  async removeChat(@CurrentUser() user: AuthUser, @Param('id') id: string): Promise<void> {
    await this.buddy.removeChat(user, id);
  }

  /** A message to Buddy, and its answer. */
  @Post('messages')
  @HttpCode(200)
  @Activity('ai.buddy.message', { facts: ['screen'] })
  send(@CurrentUser() user: AuthUser, @Body(new ZodValidationPipe(buddyMessageSchema)) body: z.output<typeof buddyMessageSchema>) {
    return this.buddy.send(user, body);
  }

  /** "Helpful?" on one of Buddy's answers. */
  @Post('messages/:id/feedback')
  @HttpCode(204)
  @Activity('ai.buddy.feedback', { facts: ['outcome'] })
  async feedback(
    @CurrentUser() user: AuthUser,
    @Param('id') id: string,
    @Body(new ZodValidationPipe(buddyFeedbackSchema)) body: z.output<typeof buddyFeedbackSchema>,
  ): Promise<void> {
    await this.buddy.feedback(user, id, body.outcome);
  }

  /** The card's main button (Book, Add, Save SOP, Send): carried out once, through the app's own service. */
  @Post('cards/:id/confirm')
  @HttpCode(200)
  @Activity('ai.buddy.cardConfirmed')
  confirm(@CurrentUser() user: AuthUser, @Param('id') id: string) {
    return this.buddy.confirm(user, id);
  }

  @Post('cards/:id/cancel')
  @HttpCode(200)
  @Activity('ai.buddy.cardCancelled')
  cancel(@CurrentUser() user: AuthUser, @Param('id') id: string) {
    return this.buddy.cancelCard(user, id);
  }

}

/**
 * ECCS's counts of Buddy for the console (the Super Admin and the Ops Manager): per day and per
 * restaurant, chats, changes made, answers not helpful, refused messages and people paused. Never a
 * chat's words. Kept apart from /buddy, which only the restaurant's Owner and Manager reach.
 */
@Controller('ai/buddy-stats')
export class BuddyStatsController {
  constructor(private readonly buddy: BuddyService) {}

  @Get()
  stats(@CurrentUser() user: AuthUser) {
    return this.buddy.stats(user);
  }
}
