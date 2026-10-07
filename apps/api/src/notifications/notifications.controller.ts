import { Controller, Get, HttpCode, Param, Post, Query } from '@nestjs/common';
import type { NotificationPageDto, UnreadCountDto } from '@eccs/shared';
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
