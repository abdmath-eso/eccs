// Push notifications: the same notifications as the list inside the app, also
// sent to the person's phone so they see them without opening the app.
//
// A phone that may receive them has a "push token", an address Expo's push
// service gives the installed app. The app tells the API its token after login
// and takes it away again on Lock or logout, so a phone shared by several
// people only shows notifications for whoever is logged in on it.

import { z } from "zod";
import { isNotificationType, type NotificationLink, type NotificationType } from "./notifications.js";
import type { Role } from "./roles.js";

/** What an Expo push token looks like: "ExponentPushToken[...]" (or the older "ExpoPushToken[...]"). */
const EXPO_PUSH_TOKEN = /^Expo(nent)?PushToken\[[^\]\s]+\]$/;

export const isExpoPushToken = (value: unknown): value is string =>
  typeof value === "string" && value.length <= 200 && EXPO_PUSH_TOKEN.test(value);

export const PUSH_PLATFORMS = ["android", "ios"] as const;
export type PushPlatform = (typeof PUSH_PLATFORMS)[number];

/** A phone says: send this person's notifications here. */
export const registerPushDeviceSchema = z.object({
  token: z.string().refine(isExpoPushToken, "This is not a push token"),
  platform: z.enum(PUSH_PLATFORMS),
});
export type RegisterPushDeviceInput = z.infer<typeof registerPushDeviceSchema>;

/** A phone says: stop sending this person's notifications here. */
export const unregisterPushDeviceSchema = z.object({
  token: z.string().refine(isExpoPushToken, "This is not a push token"),
});
export type UnregisterPushDeviceInput = z.infer<typeof unregisterPushDeviceSchema>;

/** What the API answers when a phone registers or unregisters. */
export interface PushDeviceDto {
  /** Whether the server is switched on to send push notifications at all (`PUSH_NOTIFICATIONS=on`). */
  serverEnabled: boolean;
}

/** Sends a test push. Without `userId` it goes to the person asking. */
export const sendTestPushSchema = z.object({
  userId: z.string().min(1).optional(),
});
export type SendTestPushInput = z.infer<typeof sendTestPushSchema>;

/** What happened to a test push, in enough detail to see where it stopped. */
export interface PushTestResultDto {
  /** False when the server is not switched on to send push; nothing was sent. */
  serverEnabled: boolean;
  /** How many phones the person has registered. */
  devices: number;
  /** How many of those Expo's push service accepted. Accepted is not yet delivered. */
  accepted: number;
  /** What Expo's push service said about each one it refused, in its own words. */
  errors: string[];
}

/** Someone a test push can be sent to: a person with at least one phone registered. */
export interface PushRecipientDto {
  id: string;
  name: string;
  role: Role | null;
  devices: number;
}

export interface PushRecipientsDto {
  serverEnabled: boolean;
  recipients: PushRecipientDto[];
}

/**
 * The two Android notification channels. Android lets a person silence each
 * channel separately in the phone's settings, so reminders can be turned down
 * without losing word of things that have just happened.
 */
export const PUSH_CHANNELS = { updates: "default", reminders: "reminders" } as const;
export type PushChannelId = (typeof PUSH_CHANNELS)[keyof typeof PUSH_CHANNELS];

// The kinds that RemindersService sends on a timer rather than when something happens.
const REMINDER_TYPES: ReadonlySet<NotificationType> = new Set([
  "VISIT_TOMORROW",
  "SIGN_OFF_WAITING",
  "VISIT_NOT_DONE",
  "CHECKLIST_OVERDUE",
  "CHECKLIST_MISSED",
  "LICENCE_EXPIRING",
  "LICENCE_EXPIRED",
]);

export const pushChannelFor = (type: NotificationType | null): PushChannelId =>
  type && REMINDER_TYPES.has(type) ? PUSH_CHANNELS.reminders : PUSH_CHANNELS.updates;

/**
 * What travels with a push notification besides its words, so that tapping it
 * can open the right screen. `userId` is who it was meant for: a shared phone
 * ignores a tap on a notification that belongs to someone who is not the one
 * logged in now.
 */
export interface PushData {
  userId: string;
  /** The notification in the person's list, to mark it read. Absent on a test push. */
  notificationId?: string;
  type?: NotificationType;
  link?: NotificationLink | null;
  /** True for the test push sent from the console. */
  test?: boolean;
}

/** Reads the data of a push that arrived, or null if it is not one of ours. */
export function readPushData(value: unknown): PushData | null {
  if (!value || typeof value !== "object") return null;
  const data = value as Record<string, unknown>;
  if (typeof data.userId !== "string") return null;
  const link = data.link && typeof data.link === "object" && "kind" in data.link ? (data.link as NotificationLink) : null;
  return {
    userId: data.userId,
    ...(typeof data.notificationId === "string" && { notificationId: data.notificationId }),
    ...(isNotificationType(data.type) && { type: data.type }),
    link,
    ...(data.test === true && { test: true }),
  };
}
