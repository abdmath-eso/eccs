import { Injectable, Logger, NotFoundException } from '@nestjs/common';
import type { Prisma } from '@eccs/db';
import {
  isNotificationType,
  NOTIFICATIONS_MAX_PAGE_SIZE,
  NOTIFICATIONS_PAGE_SIZE,
  type NotificationData,
  type NotificationDto,
  type NotificationLink,
  type NotificationPageDto,
  type NotificationParamsByType,
  type NotificationParamValue,
  type NotificationType,
  type Role,
} from '@eccs/shared';
import { PrismaService } from '../prisma/prisma.service.js';
import { wordInEnglish } from './notifications.wording.js';
import { PushService } from './push.service.js';

type NotificationRow = Prisma.NotificationGetPayload<object>;

/**
 * A way of reaching a person outside the app. Push notifications are the first
 * (`PushService`); SMS or WhatsApp may follow. To add one, write a class with
 * this shape and put it in `outsideChannels` below; nothing else has to change.
 */
export interface OutsideChannel {
  name: string;
  /** Called once with the notifications that were just written to the in-app list. */
  deliver(notifications: NotificationRow[]): Promise<void>;
}

export interface SendOptions {
  /** Who did the thing: they are never told about their own action. */
  except?: string | null | undefined;
  /** For reminders: a person who already has a notification with this key is not sent another. */
  dedupeKey?: string;
}

/**
 * The notifications store: writes a notification for each person it is for,
 * and serves each person their own list. Who is told about what is decided in
 * `NotifyService` (things that happen) and `RemindersService` (things that are due).
 */
@Injectable()
export class NotificationsService {
  private readonly logger = new Logger(NotificationsService.name);

  /** The one place a delivery channel is added. The list inside the app is always written. */
  private readonly outsideChannels: OutsideChannel[];

  constructor(
    private readonly prisma: PrismaService,
    push: PushService,
  ) {
    // Push sends nothing unless it is switched on (see `PushService.enabled`).
    this.outsideChannels = [push];
  }

  private get db() {
    return this.prisma.client;
  }

  // ───────────────────────── Sending ─────────────────────────

  /**
   * Tells each of these people once. Returns how many notifications were
   * written (fewer than asked for when a reminder had already been sent).
   */
  async send<T extends NotificationType>(
    to: Iterable<string | null | undefined>,
    type: T,
    params: NotificationParamsByType[T],
    link: NotificationLink | null,
    options: SendOptions = {},
  ): Promise<number> {
    const userIds = [...new Set(to)].filter((id): id is string => Boolean(id) && id !== options.except);
    if (userIds.length === 0) return 0;

    const { title, body } = wordInEnglish(type, params as Record<string, NotificationParamValue>);
    const data = { params, link } satisfies NotificationData<T>;
    const now = new Date();
    const written = await this.db.notification.createManyAndReturn({
      data: userIds.map((userId) => ({
        userId,
        channel: 'app',
        type,
        title,
        body,
        data: data as unknown as Prisma.InputJsonValue,
        dedupeKey: options.dedupeKey ?? null,
        sentAt: now,
      })),
      // The (person, key) pair is unique in the database, so a reminder sent before is skipped here.
      skipDuplicates: true,
    });

    for (const channel of this.outsideChannels) {
      await channel
        .deliver(written)
        .catch((error) => this.logger.warn(`Could not deliver by ${channel.name}: ${String(error)}`));
    }
    return written.length;
  }

  // ───────────────────────── Who ─────────────────────────

  /**
   * The people of a restaurant with these roles at an outlet. An Owner belongs
   * to the whole brand; Managers and Head Chefs to the one outlet.
   */
  async restaurantPeople(outletId: string, roles: readonly ('OWNER' | 'MANAGER' | 'HEAD_CHEF')[]): Promise<string[]> {
    const outlet = await this.db.outlet.findUnique({ where: { id: outletId }, select: { organizationId: true } });
    if (!outlet) return [];
    const outletRoles = roles.filter((role) => role !== 'OWNER');
    return this.peopleWhere({
      OR: [
        ...(roles.includes('OWNER') ? [{ role: 'OWNER' as const, organizationId: outlet.organizationId }] : []),
        ...(outletRoles.length > 0 ? [{ role: { in: outletRoles }, outletId }] : []),
      ],
    });
  }

  /** The Owners of a brand. */
  owners(organizationId: string): Promise<string[]> {
    return this.peopleWhere({ role: 'OWNER', organizationId });
  }

  /** The people who run ECCS's diary: Super Admins and Operations Managers. */
  admins(): Promise<string[]> {
    return this.peopleWhere({ role: { in: ['SUPER_ADMIN', 'OPS_MANAGER'] satisfies Role[] } });
  }

  private async peopleWhere(membership: Prisma.MembershipWhereInput): Promise<string[]> {
    // Someone whose access was removed is not told anything.
    const people = await this.db.user.findMany({
      where: { isActive: true, memberships: { some: membership } },
      select: { id: true },
    });
    return people.map((person) => person.id);
  }

  // ───────────────────────── A person's own list ─────────────────────────

  /** One page of the person's notifications, newest first. `before` is the last one of the page before. */
  async list(userId: string, page: { before?: string | undefined; limit?: number | undefined }): Promise<NotificationPageDto> {
    const limit = Math.min(Math.max(Math.trunc(page.limit ?? NOTIFICATIONS_PAGE_SIZE) || NOTIFICATIONS_PAGE_SIZE, 1), NOTIFICATIONS_MAX_PAGE_SIZE);
    // The page continues after a notification of the person's own; anyone else's id is ignored.
    const after = page.before
      ? await this.db.notification.findFirst({ where: { id: page.before, userId }, select: { id: true } })
      : null;
    const [rows, unreadCount] = await Promise.all([
      this.db.notification.findMany({
        where: { userId, channel: 'app' },
        orderBy: [{ createdAt: 'desc' }, { id: 'desc' }],
        // One more than asked for, to know whether there is a further page.
        take: limit + 1,
        ...(after && { cursor: { id: after.id }, skip: 1 }),
      }),
      this.unreadCount(userId),
    ]);
    const items = rows.slice(0, limit);
    return {
      items: items.map(toDto),
      nextCursor: rows.length > limit ? items[items.length - 1]!.id : null,
      unreadCount,
    };
  }

  unreadCount(userId: string): Promise<number> {
    return this.db.notification.count({ where: { userId, channel: 'app', readAt: null } });
  }

  /** Marks one of the person's own notifications as read. Someone else's looks like it does not exist. */
  async markRead(userId: string, notificationId: string): Promise<number> {
    const own = await this.db.notification.findFirst({ where: { id: notificationId, userId }, select: { readAt: true } });
    if (!own) throw new NotFoundException('Notification not found');
    if (!own.readAt) await this.db.notification.update({ where: { id: notificationId }, data: { readAt: new Date() } });
    return this.unreadCount(userId);
  }

  async markAllRead(userId: string): Promise<number> {
    await this.db.notification.updateMany({ where: { userId, readAt: null }, data: { readAt: new Date() } });
    return this.unreadCount(userId);
  }
}

function toDto(row: NotificationRow): NotificationDto {
  const data = (row.data ?? {}) as Partial<NotificationData>;
  return {
    id: row.id,
    type: isNotificationType(row.type) ? row.type : null,
    title: row.title,
    body: row.body,
    params: (data.params ?? {}) as Record<string, NotificationParamValue>,
    link: data.link ?? null,
    createdAt: row.createdAt.toISOString(),
    readAt: row.readAt?.toISOString() ?? null,
  };
}
