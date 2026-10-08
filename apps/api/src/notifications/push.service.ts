import { ForbiddenException, Injectable, Logger, NotFoundException, type OnModuleDestroy, type OnModuleInit } from '@nestjs/common';
import type { Prisma } from '@eccs/db';
import {
  isExpoPushToken,
  isNotificationType,
  pushChannelFor,
  PUSH_CHANNELS,
  type Language,
  type NotificationData,
  type NotificationParamValue,
  type PushData,
  type PushDeviceDto,
  type PushRecipientsDto,
  type PushTestResultDto,
  type RegisterPushDeviceInput,
  type Role,
} from '@eccs/shared';
import type { AuthUser } from '../auth/auth.types.js';
import { env } from '../config/env.js';
import { PrismaService } from '../prisma/prisma.service.js';
import type { OutsideChannel } from './notifications.service.js';
import { testPushWording, wordInLanguage } from './push.wording.js';

type NotificationRow = Prisma.NotificationGetPayload<object>;

// Expo's push service: https://docs.expo.dev/push-notifications/sending-notifications/
const EXPO_SEND_URL = 'https://exp.host/--/api/v2/push/send';
const EXPO_RECEIPTS_URL = 'https://exp.host/--/api/v2/push/getReceipts';
/** The most messages Expo takes in one request, and the most receipts it gives in one. */
export const PUSH_BATCH_SIZE = 100;
const RECEIPT_BATCH_SIZE = 1000;
/** Expo advises asking for receipts about 15 minutes after sending; it keeps them for a day. */
const RECEIPT_WAIT_MS = 15 * 60_000;
const RECEIPT_KEPT_MS = 24 * 60 * 60_000;
/** How long to wait for Expo to answer before giving up on a request. */
const REQUEST_TIMEOUT_MS = 10_000;

const ADMIN_ROLES: readonly Role[] = ['SUPER_ADMIN', 'OPS_MANAGER'];

/** One message as Expo's push service takes it. */
interface ExpoMessage {
  to: string;
  title: string;
  body: string;
  data: PushData;
  sound: 'default';
  priority: 'high';
  channelId: string;
}

/** Expo's answer for one message: accepted (with an id to ask about later) or refused. */
interface ExpoTicket {
  status?: 'ok' | 'error';
  id?: string;
  message?: string;
  details?: { error?: string };
}

interface SendResult {
  accepted: number;
  /** Tokens Expo says no longer lead to an installed app. */
  dead: string[];
  errors: string[];
}

const chunks = <T>(items: T[], size: number): T[][] =>
  Array.from({ length: Math.ceil(items.length / size) }, (_, index) => items.slice(index * size, (index + 1) * size));

/**
 * Push notifications: which phone belongs to whom, and sending to them through
 * Expo's push service. It is the delivery channel that `NotificationsService`
 * hands each new notification to, after writing it to the list inside the app.
 *
 * Nothing is sent unless `PUSH_NOTIFICATIONS=on` is set in `.env`, and never
 * while the automated tests run. A failure here is logged and goes no further:
 * the notification is already in the person's list.
 */
@Injectable()
export class PushService implements OutsideChannel, OnModuleInit, OnModuleDestroy {
  readonly name = 'push';
  private readonly logger = new Logger(PushService.name);

  /** Whether anything is sent at all. The push tests switch it on for themselves, with Expo replaced by a stand-in. */
  enabled = env.PUSH_NOTIFICATIONS === 'on' && env.NODE_ENV !== 'test';

  /** The sending still under way, so tests (and shutdown) can wait for it. */
  private work: Promise<void> = Promise.resolve();

  /**
   * Messages Expo accepted and has yet to report on: its id for each, and the
   * phone it went to. Kept in memory only, so a restart forgets them; a phone
   * that has gone is then found on the next message instead.
   */
  private readonly awaitingReceipt = new Map<string, { token: string; sentAt: number }>();
  private receiptTimer: NodeJS.Timeout | null = null;

  constructor(private readonly prisma: PrismaService) {}

  private get db() {
    return this.prisma.client;
  }

  onModuleInit() {
    // Background timers stay off while the tests run.
    if (env.NODE_ENV === 'test') return;
    this.logger.log(
      this.enabled
        ? 'Push notifications are ON: new notifications are also sent to registered phones through Expo.'
        : 'Push notifications are off (set PUSH_NOTIFICATIONS=on in .env to send them).',
    );
    if (!this.enabled) return;
    this.receiptTimer = setInterval(() => void this.checkReceipts(), RECEIPT_WAIT_MS);
    // The timer alone must not keep the server from stopping.
    this.receiptTimer.unref();
  }

  onModuleDestroy() {
    if (this.receiptTimer) clearInterval(this.receiptTimer);
  }

  /** Resolves when everything handed over so far has been dealt with. */
  idle(): Promise<void> {
    return this.work;
  }

  // ───────────────────────── Phones ─────────────────────────

  /**
   * This phone now belongs to this person. A phone has one push token, so if
   * someone else had it (the last person to use a shared phone), it moves.
   */
  async register(userId: string, input: RegisterPushDeviceInput): Promise<PushDeviceDto> {
    await this.db.deviceToken.upsert({
      where: { token: input.token },
      create: { userId, token: input.token, platform: input.platform },
      update: { userId, platform: input.platform },
    });
    return { serverEnabled: this.enabled };
  }

  /** Stops sending this person's notifications to this phone. Someone else's phone is left alone. */
  async unregister(userId: string, token: string): Promise<PushDeviceDto> {
    await this.db.deviceToken.deleteMany({ where: { userId, token } });
    return { serverEnabled: this.enabled };
  }

  // ───────────────────────── Sending ─────────────────────────

  /**
   * Called by `NotificationsService` with the notifications it has just written.
   * It returns at once and sends in the background, so whoever caused the
   * notification (a Supervisor finishing a visit, say) is not kept waiting on
   * Expo's servers. It never throws.
   */
  deliver(notifications: NotificationRow[]): Promise<void> {
    if (this.enabled && notifications.length > 0) {
      this.work = this.work.then(() =>
        this.deliverNow(notifications).catch((error) => this.logger.warn(`Push failed: ${String(error)}`)),
      );
    }
    return Promise.resolve();
  }

  private async deliverNow(notifications: NotificationRow[]): Promise<void> {
    const userIds = [...new Set(notifications.map((notification) => notification.userId))];
    const now = new Date();
    const devices = await this.db.deviceToken.findMany({
      where: {
        userId: { in: userIds },
        // Only someone who can still open the app: active, and logged in somewhere. A person whose
        // login has run out (or who locked the phone while it had no signal, so it could not take
        // its token away) is not sent anything.
        user: { isActive: true, sessions: { some: { revokedAt: null, expiresAt: { gt: now } } } },
      },
      select: { token: true, userId: true, user: { select: { language: true } } },
    });
    if (devices.length === 0) {
      this.logger.log(`Push: ${notifications.length} notification(s) for ${userIds.length} person(s), none has a phone registered`);
      return;
    }

    const messages: ExpoMessage[] = [];
    for (const notification of notifications) {
      for (const device of devices) {
        if (device.userId !== notification.userId) continue;
        messages.push(this.message(device.token, device.user.language, notification));
      }
    }
    const result = await this.send(messages);
    await this.forget(result.dead);
    this.logger.log(
      `Push: ${notifications.length} notification(s) to ${devices.length} phone(s): ${result.accepted} accepted` +
        (result.errors.length > 0 ? `, ${result.errors.length} refused (${[...new Set(result.errors)].join('; ')})` : '') +
        (result.dead.length > 0 ? `, ${result.dead.length} phone(s) no longer registered and removed` : ''),
    );
  }

  /** One notification as a push message for one phone, worded in its owner's saved language. */
  private message(token: string, language: Language, notification: NotificationRow): ExpoMessage {
    const type = isNotificationType(notification.type) ? notification.type : null;
    const stored = (notification.data ?? {}) as Partial<NotificationData>;
    // A kind this server does not know (written by a newer version) keeps its stored English.
    const words = type
      ? wordInLanguage(language, type, (stored.params ?? {}) as Record<string, NotificationParamValue>)
      : { title: notification.title, body: notification.body };
    return {
      to: token,
      title: words.title,
      body: words.body,
      data: {
        userId: notification.userId,
        notificationId: notification.id,
        ...(type && { type }),
        link: stored.link ?? null,
      },
      sound: 'default',
      priority: 'high',
      channelId: pushChannelFor(type),
    };
  }

  /**
   * Hands messages to Expo, at most 100 in a request. Expo answers with one
   * "ticket" per message, in the same order.
   */
  private async send(messages: ExpoMessage[]): Promise<SendResult> {
    const result: SendResult = { accepted: 0, dead: [], errors: [] };
    for (const batch of chunks(messages, PUSH_BATCH_SIZE)) {
      let tickets: ExpoTicket[];
      try {
        tickets = (await this.post<{ data?: ExpoTicket[] }>(EXPO_SEND_URL, batch)).data ?? [];
      } catch (error) {
        // The whole request failed (no internet, Expo down): nothing in it was sent.
        result.errors.push(...batch.map(() => String(error instanceof Error ? error.message : error)));
        continue;
      }
      batch.forEach((message, index) => {
        const ticket = tickets[index];
        if (ticket?.status === 'ok') {
          result.accepted += 1;
          if (ticket.id) this.awaitingReceipt.set(ticket.id, { token: message.to, sentAt: Date.now() });
          return;
        }
        if (ticket?.details?.error === 'DeviceNotRegistered') result.dead.push(message.to);
        result.errors.push(ticket?.details?.error ?? ticket?.message ?? 'No answer from Expo');
      });
    }
    return result;
  }

  private async post<T>(url: string, body: unknown): Promise<T> {
    const response = await fetch(url, {
      method: 'POST',
      headers: {
        Accept: 'application/json',
        'Accept-Encoding': 'gzip, deflate',
        'Content-Type': 'application/json',
        // Only needed if "enhanced security" is switched on for the project at expo.dev.
        ...(env.EXPO_ACCESS_TOKEN && { Authorization: `Bearer ${env.EXPO_ACCESS_TOKEN}` }),
      },
      body: JSON.stringify(body),
      signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS),
    });
    if (!response.ok) throw new Error(`Expo answered ${response.status}`);
    return (await response.json()) as T;
  }

  private async forget(tokens: string[]): Promise<void> {
    if (tokens.length > 0) await this.db.deviceToken.deleteMany({ where: { token: { in: tokens } } });
  }

  /**
   * Asks Expo what became of the messages it accepted a while ago. This is where
   * Google's or Apple's verdict arrives: above all "DeviceNotRegistered", meaning
   * the app was removed from that phone, whose token is then deleted. Runs on a
   * timer; returns how many phones were removed. Never throws.
   */
  async checkReceipts(asOf: Date = new Date()): Promise<number> {
    try {
      const due: string[] = [];
      for (const [id, sent] of this.awaitingReceipt) {
        const age = asOf.getTime() - sent.sentAt;
        if (age > RECEIPT_KEPT_MS) this.awaitingReceipt.delete(id);
        else if (age >= RECEIPT_WAIT_MS) due.push(id);
      }
      const dead: string[] = [];
      const problems: string[] = [];
      for (const ids of chunks(due, RECEIPT_BATCH_SIZE)) {
        const { data } = await this.post<{ data?: Record<string, ExpoTicket> }>(EXPO_RECEIPTS_URL, { ids });
        for (const [id, receipt] of Object.entries(data ?? {})) {
          const sent = this.awaitingReceipt.get(id);
          this.awaitingReceipt.delete(id);
          if (receipt.status !== 'error' || !sent) continue;
          if (receipt.details?.error === 'DeviceNotRegistered') dead.push(sent.token);
          problems.push(receipt.details?.error ?? receipt.message ?? 'unknown');
        }
      }
      await this.forget(dead);
      if (due.length > 0) {
        this.logger.log(
          `Push receipts: ${due.length} checked` +
            (problems.length > 0 ? `, ${problems.length} not delivered (${[...new Set(problems)].join('; ')})` : ', all delivered to Google or Apple') +
            (dead.length > 0 ? `, ${dead.length} phone(s) no longer registered and removed` : ''),
        );
      }
      return dead.length;
    } catch (error) {
      this.logger.warn(`Could not check push receipts: ${String(error)}`);
      return 0;
    }
  }

  // ───────────────────────── The test push ─────────────────────────

  private mustBeAdmin(user: AuthUser) {
    if (!user.memberships.some((membership) => ADMIN_ROLES.includes(membership.role))) {
      throw new ForbiddenException('Only ECCS admins can send a test push');
    }
  }

  /** The people a test push can go to: everyone with a phone registered. */
  async recipients(user: AuthUser): Promise<PushRecipientsDto> {
    this.mustBeAdmin(user);
    const people = await this.db.user.findMany({
      where: { isActive: true, deviceTokens: { some: {} } },
      select: { id: true, name: true, memberships: { select: { role: true }, take: 1 }, _count: { select: { deviceTokens: true } } },
      orderBy: { name: 'asc' },
    });
    return {
      serverEnabled: this.enabled,
      recipients: people.map((person) => ({
        id: person.id,
        name: person.name,
        role: person.memberships[0]?.role ?? null,
        devices: person._count.deviceTokens,
      })),
    };
  }

  /**
   * Sends one test push to a person's phones (the admin's own unless another
   * person is named) and waits for Expo's answer, so the console can say what
   * happened. It writes nothing to anyone's notification list.
   */
  async sendTest(user: AuthUser, userId: string | undefined): Promise<PushTestResultDto> {
    this.mustBeAdmin(user);
    const person = await this.db.user.findFirst({
      where: { id: userId ?? user.id, isActive: true },
      select: { id: true, language: true, deviceTokens: { select: { token: true } } },
    });
    if (!person) throw new NotFoundException('Person not found');
    const tokens = person.deviceTokens.map((device) => device.token).filter(isExpoPushToken);
    if (!this.enabled || tokens.length === 0) {
      return { serverEnabled: this.enabled, devices: tokens.length, accepted: 0, errors: [] };
    }
    const words = testPushWording(person.language);
    const result = await this.send(
      tokens.map((token) => ({
        to: token,
        ...words,
        data: { userId: person.id, link: null, test: true },
        sound: 'default',
        priority: 'high',
        channelId: PUSH_CHANNELS.updates,
      })),
    );
    await this.forget(result.dead);
    this.logger.log(`Push test by ${user.id} to ${person.id}: ${tokens.length} phone(s), ${result.accepted} accepted`);
    return { serverEnabled: true, devices: tokens.length, accepted: result.accepted, errors: [...new Set(result.errors)] };
  }
}
