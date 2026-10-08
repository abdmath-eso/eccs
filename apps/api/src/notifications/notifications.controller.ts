import { Controller, Get, HttpCode, Param, Post, Query, Res } from '@nestjs/common';
import type { NotificationNewsDto, NotificationPageDto, UnreadCountDto } from '@eccs/shared';
import type { Response } from 'express';
import { CurrentUser } from '../auth/auth.decorators.js';
import type { AuthUser } from '../auth/auth.types.js';
import { NotificationsService } from './notifications.service.js';

/**
 * A person's own notifications. There is no role check: everyone who is logged
 * in has a list, and only ever sees and changes their own.
 */
@Controller('notifications')
export class NotificationsController {
  constructor(private readonly notifications: NotificationsService) {}

  /** Newest first, a page at a time: `before` is the id of the last one already shown. */
  @Get()
  list(
    @CurrentUser() user: AuthUser,
    @Query('before') before?: string,
    @Query('limit') limit?: string,
  ): Promise<NotificationPageDto> {
    return this.notifications.list(user.id, { before: before || undefined, limit: limit ? Number(limit) : undefined });
  }

  /** The number for the badge on the bell. */
  @Get('unread-count')
  async unreadCount(@CurrentUser() user: AuthUser): Promise<UnreadCountDto> {
    return { unreadCount: await this.notifications.unreadCount(user.id) };
  }

  /**
   * "Anything new?", for a console left open on a desk. The answer is held
   * back until the person's newest notification is no longer the one named in
   * `latest` (or one of theirs is marked read), or for about 25 seconds,
   * whichever comes first; the console then asks again. This is what lets a
   * new notification show on the PC within a second or two without asking
   * the database every few seconds.
   */
  @Get('wait')
  wait(
    @CurrentUser() user: AuthUser,
    @Res({ passthrough: true }) response: Response,
    @Query('latest') latest?: string,
  ): Promise<NotificationNewsDto> {
    // The browser tab was closed or moved on: stop waiting on its behalf.
    const gone = new AbortController();
    response.on('close', () => gone.abort());
    return this.notifications.waitForNews(user.id, latest || null, gone.signal);
  }

  @Post('read-all')
  @HttpCode(200)
  async markAllRead(@CurrentUser() user: AuthUser): Promise<UnreadCountDto> {
    return { unreadCount: await this.notifications.markAllRead(user.id) };
  }

  @Post(':id/read')
  @HttpCode(200)
  async markRead(@CurrentUser() user: AuthUser, @Param('id') id: string): Promise<UnreadCountDto> {
    return { unreadCount: await this.notifications.markRead(user.id, id) };
  }
}
