import Ionicons from '@expo/vector-icons/Ionicons';
import type { MessageKey } from '@eccs/i18n';
import {
  ISSUE_CATEGORIES,
  localize,
  notificationWordingParams,
  type LocalizedText,
  type NotificationDto,
  type NotificationType,
} from '@eccs/shared';
import { useFocusEffect } from 'expo-router';
import { useCallback, useEffect, useState, type ReactNode } from 'react';
import { ActivityIndicator, Pressable, StyleSheet, View } from 'react-native';

import { isEccsUser } from '@/components/app-nav';
import { PushStatus } from '@/components/push-status';
import { ThemedText } from '@/components/themed-text';
import { Button } from '@/components/ui/button';
import { EmptyState } from '@/components/ui/empty-state';
import { ErrorText } from '@/components/ui/error-text';
import { Screen } from '@/components/ui/screen';
import { useSnackbar } from '@/components/ui/snackbar';
import { MinTouchSize, Spacing } from '@/constants/theme';
import { useTheme } from '@/hooks/use-theme';
import { errorMessage } from '@/lib/errors';
import { addDays, formatDate, formatDayLong, formatSlot, formatTime, indiaToday } from '@/lib/format';
import { useDirection } from '@/lib/direction';
import { openNotificationLink } from '@/lib/notification-link';
import { onPushArrived } from '@/lib/push';
import { useSession } from '@/lib/session';

/** The calendar date in India, and the time of day there, that a notification arrived. */
function indiaDayAndTime(iso: string): { day: string; time: string } {
  const at = new Date(iso);
  try {
    return {
      day: new Intl.DateTimeFormat('en-CA', { timeZone: 'Asia/Kolkata' }).format(at),
      time: new Intl.DateTimeFormat('en-GB', { timeZone: 'Asia/Kolkata', hour: '2-digit', minute: '2-digit', hour12: false }).format(at),
    };
  } catch {
    // A phone without time-zone data: India is five and a half hours ahead of UTC.
    const shifted = new Date(at.getTime() + 5.5 * 3_600_000).toISOString();
    return { day: shifted.slice(0, 10), time: shifted.slice(11, 16) };
  }
}

// The kinds that have their own words for several at once ("4 checklists missed"); any other kind
// shows its title with the count after it, as Gmail counts the messages in a thread.
const GROUP_WORDS = {
  CHECKLIST_MISSED: 'notif.group.CHECKLIST_MISSED',
  CHECKLIST_OVERDUE: 'notif.group.CHECKLIST_OVERDUE',
  CHECKLIST_PROBLEM: 'notif.group.CHECKLIST_PROBLEM',
} as const;

// The kinds sent to the restaurant and to ECCS staff alike that have a sentence of their own for staff.
const STAFF_BODY: Partial<Record<NotificationType, MessageKey>> = {
  VISIT_TOMORROW: 'notif.VISIT_TOMORROW.bodyStaff',
};

type Row = NotificationDto & { time: string };

/**
 * Notifications: everything the app has to tell this person, newest first and
 * grouped by day, as a plain list with thin lines between rows (Gmail, GitHub; Material 3
 * lists). One not yet read has a dot beside its title, bold writing and a light tint.
 * Tapping one opens what it is about and marks it read. Several of the same kind for the same
 * outlet on the same day are one row ("4 checklists missed · Gachibowli") that opens to show
 * them, as Android groups a phone's notifications; until 22 Oct 2026 each was a box of its own.
 */
export default function NotificationsScreen() {
  const theme = useTheme();
  const { t, api, language, user } = useSession();
  const { forwardIcon } = useDirection();
  const notify = useSnackbar();
  const eccs = isEccsUser(user?.memberships[0]?.role);
  const [items, setItems] = useState<NotificationDto[] | null>(null);
  const [nextCursor, setNextCursor] = useState<string | null>(null);
  const [unread, setUnread] = useState(0);
  const [error, setError] = useState<string | null>(null);
  const [olderError, setOlderError] = useState<string | null>(null);
  const [loadingOlder, setLoadingOlder] = useState(false);
  const [markingAll, setMarkingAll] = useState(false);
  // The groups opened to show what is in them, by their key.
  const [openGroups, setOpenGroups] = useState<Set<string>>(() => new Set());

  const load = useCallback(async () => {
    try {
      const page = await api.notifications.list();
      setItems(page.items);
      setNextCursor(page.nextCursor);
      setUnread(page.unreadCount);
      setError(null);
    } catch (e) {
      setError(errorMessage(e, t));
    }
    // `t` changes with language; reloading for that is unnecessary.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [api]);

  // Reloads whenever the list comes back into view, so anything new since is there.
  useFocusEffect(
    useCallback(() => {
      void load();
    }, [load]),
  );

  // A push that arrives while this list is open is added to it straight away.
  useEffect(() => onPushArrived(() => void load()), [load]);

  async function loadOlder() {
    if (!nextCursor) return;
    setLoadingOlder(true);
    setOlderError(null);
    try {
      const page = await api.notifications.list({ before: nextCursor });
      setItems((current) => [...(current ?? []), ...page.items]);
      setNextCursor(page.nextCursor);
      setUnread(page.unreadCount);
    } catch (e) {
      setOlderError(errorMessage(e, t));
    } finally {
      setLoadingOlder(false);
    }
  }

  async function markAllRead() {
    setMarkingAll(true);
    setError(null);
    try {
      await api.notifications.markAllRead();
      const now = new Date().toISOString();
      setItems((current) => current?.map((item) => (item.readAt ? item : { ...item, readAt: now })) ?? null);
      setUnread(0);
      notify(t('notif.allRead'));
    } catch (e) {
      setError(errorMessage(e, t));
    } finally {
      setMarkingAll(false);
    }
  }

  function press(item: NotificationDto) {
    if (!item.readAt) {
      // Shown as read at once. If the phone has no signal just now it stays unread on the
      // server and is simply shown as unread again next time, which does no harm.
      const now = new Date().toISOString();
      setItems((current) => current?.map((other) => (other.id === item.id ? { ...other, readAt: now } : other)) ?? null);
      setUnread((current) => Math.max(0, current - 1));
      api.notifications.markRead(item.id).catch(() => undefined);
    }
    if (item.link) openNotificationLink(item.link);
  }

  /** The title and body in the language the app is in, from the notification's kind and values. */
  function wording(item: NotificationDto): { title: string; body: string } {
    // A kind this version of the app does not know yet is shown in the server's English.
    if (!item.type) return { title: item.title, body: item.body };
    const values = notificationWordingParams(item.params, {
      text: (value) => localize(value, language),
      date: (value) => formatDate(value, language),
      // Inside a sentence "after closing" takes no capital, as "time to be confirmed" does not.
      slot: (value) =>
        value === 'AFTER_CLOSING' ? t('notif.afterClosing') : ((value ? formatSlot(value, language, t) : null) ?? t('notif.noTime')),
      category: (value) => {
        const known = ISSUE_CATEGORIES.find((category) => category === value);
        return known ? t(`category.${known}`) : value;
      },
    });
    // ECCS staff read the sentence written for them where there is one ("… at Gachibowli is tomorrow").
    const staffBody = eccs ? STAFF_BODY[item.type] : undefined;
    return { title: t(`notif.${item.type}.title`, values), body: t(staffBody ?? `notif.${item.type}.body`, values).trim() };
  }

  const today = indiaToday();
  const yesterday = addDays(today, -1);
  const dayName = (day: string) =>
    day === today ? t('notif.today') : day === yesterday ? t('notif.yesterday') : formatDayLong(day, language);

  // The list arrives newest first, so each day's notifications are already together. Within a day,
  // those of one kind for one outlet are gathered where the newest of them is.
  const days: { day: string; groups: { key: string; rows: Row[] }[] }[] = [];
  for (const item of items ?? []) {
    const { day, time } = indiaDayAndTime(item.createdAt);
    let last = days[days.length - 1];
    if (last?.day !== day) {
      last = { day, groups: [] };
      days.push(last);
    }
    // A kind this version of the app does not know is never gathered: its words cannot be counted.
    const key = item.type ? `${day}|${item.type}|${typeof item.params.outlet === 'string' ? item.params.outlet : ''}` : item.id;
    const group = last.groups.find((entry) => entry.key === key);
    if (group) group.rows.push({ ...item, time });
    else last.groups.push({ key, rows: [{ ...item, time }] });
  }

  /** The words of one row: unread with a dot beside the title, bold writing and a light tint. */
  const row = (props: {
    key: string;
    title: string;
    body: string;
    meta: string;
    isUnread: boolean;
    first: boolean;
    onPress: () => void;
    trailing: ReactNode;
    expanded?: boolean;
    inset?: boolean;
  }) => (
    <Pressable
      key={props.key}
      accessibilityRole="button"
      accessibilityState={props.expanded === undefined ? undefined : { expanded: props.expanded }}
      accessibilityLabel={`${props.isUnread ? `${t('notif.unread')}. ` : ''}${props.title}. ${props.body} ${props.meta}`}
      onPress={props.onPress}
      style={({ pressed }) => [
        styles.row,
        props.inset && styles.inset,
        !props.first && { borderTopWidth: StyleSheet.hairlineWidth, borderTopColor: theme.border },
        // The tint is the accent at 8%, light enough for the words on it.
        { backgroundColor: pressed ? theme.backgroundSelected : props.isUnread ? `${theme.primary}14` : 'transparent' },
      ]}>
      {/* Kept even when there is no dot, so read and unread rows line up; at the title's line. */}
      <View style={styles.dotColumn}>
        {props.isUnread && <View style={[styles.dot, { backgroundColor: theme.primary }]} />}
      </View>
      <View style={styles.text}>
        <ThemedText type="default" style={props.isUnread && styles.titleUnread}>
          {props.title}
        </ThemedText>
        <ThemedText type="small" themeColor={props.isUnread ? 'text' : 'textSecondary'}>
          {props.body}
        </ThemedText>
        <ThemedText type="small" themeColor="textSecondary">
          {props.meta}
        </ThemedText>
      </View>
      {props.trailing}
    </Pressable>
  );

  /** One notification as a row of the list. */
  const single = (item: Row, first: boolean, inset?: boolean) => {
    const { title, body } = wording(item);
    const outlet = typeof item.params.outlet === 'string' ? item.params.outlet : '';
    return row({
      key: item.id,
      title,
      body,
      // Says which branch, for an Owner with several, unless the sentence already does.
      meta: [outlet && !body.includes(outlet) ? outlet : null, formatTime(item.time, language)].filter(Boolean).join(' · '),
      isUnread: !item.readAt,
      first,
      inset,
      onPress: () => press(item),
      trailing: item.link ? <Ionicons name={forwardIcon} size={20} color={theme.textSecondary} /> : null,
    });
  };

  /** Several of one kind for one outlet on one day, as one row that opens to show them. */
  const gathered = (key: string, rows: Row[], first: boolean) => {
    const newest = rows[0]!;
    const type = newest.type!;
    const open = openGroups.has(key);
    const outlet = typeof newest.params.outlet === 'string' ? newest.params.outlet : '';
    const words = type in GROUP_WORDS ? GROUP_WORDS[type as keyof typeof GROUP_WORDS] : null;
    const title = words
      ? t(words, { count: rows.length })
      : t('notif.groupOther', { title: wording(newest).title, count: rows.length });
    // The checklists by name; for other kinds, the newest one's sentence.
    const nameOf = (value: unknown) =>
      typeof value === 'string' ? value : value && typeof value === 'object' ? localize(value as LocalizedText, language) : '';
    const names = [...new Set(rows.map((entry) => nameOf(entry.params.checklist)))].filter(Boolean);
    const body = names.length > 0 ? names.join(', ') : wording(newest).body;
    const toggle = () =>
      setOpenGroups((current) => {
        const next = new Set(current);
        if (open) next.delete(key);
        else next.add(key);
        return next;
      });
    return (
      <View key={key}>
        {row({
          key,
          title,
          body,
          meta: [outlet || null, formatTime(newest.time, language)].filter(Boolean).join(' · '),
          isUnread: rows.some((entry) => !entry.readAt),
          first,
          expanded: open,
          onPress: toggle,
          trailing: <Ionicons name={open ? 'chevron-up' : 'chevron-down'} size={22} color={theme.textSecondary} />,
        })}
        {open && rows.map((entry) => single(entry, false, true))}
      </View>
    );
  };

  return (
    <Screen
      back
      title={t('notif.title')}
      onRefresh={load}
      // In the top bar, as Gmail and GitHub place it: a text button that acts on the whole list.
      headerRight={
        unread > 0 ? (
          <Pressable
            accessibilityRole="button"
            accessibilityState={{ busy: markingAll }}
            disabled={markingAll}
            onPress={() => void markAllRead()}
            style={({ pressed }) => [styles.barButton, pressed && { backgroundColor: theme.backgroundElement }]}>
            {markingAll ? (
              <ActivityIndicator color={theme.primary} />
            ) : (
              <ThemedText type="default" themeColor="primary" numberOfLines={2} style={styles.barButtonText}>
                {t('notif.markAllRead')}
              </ThemedText>
            )}
          </Pressable>
        ) : undefined
      }>
      <ErrorText message={error} onRetry={items === null ? () => void load() : undefined} />
      {items === null && !error && <ActivityIndicator color={theme.primary} />}

      {/* Whether this phone shows notifications without the app being open, and how to turn that on. */}
      <PushStatus />

      {items?.length === 0 && (
        <EmptyState icon="notifications-off-outline" title={t('notif.empty')} body={t('notif.emptyHelp')} />
      )}

      {days.map((day) => (
        <View key={day.day} style={styles.day}>
          <ThemedText type="smallBold" themeColor="textSecondary" accessibilityRole="header">
            {dayName(day.day)}
          </ThemedText>
          {/* The rows of a day together, with no gap between them. */}
          <View>
            {day.groups.map((group, index) =>
              group.rows.length > 1 ? gathered(group.key, group.rows, index === 0) : single(group.rows[0]!, index === 0),
            )}
          </View>
        </View>
      ))}

      <ErrorText message={olderError} />
      {nextCursor && (
        <Button label={t('notif.older')} variant="link" onPress={() => void loadOlder()} loading={loadingOlder} />
      )}
    </Screen>
  );
}

const styles = StyleSheet.create({
  day: { gap: Spacing.one },
  // Edge to edge, as Material 3 lists run on a phone, with the words kept on the page's 16 edge.
  row: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: Spacing.two,
    marginHorizontal: -Spacing.three,
    paddingHorizontal: Spacing.three,
    paddingVertical: Spacing.two + Spacing.one,
    minHeight: MinTouchSize + Spacing.three,
  },
  // What a gathered row holds, set in under it (Material 3 insets nested items).
  inset: { paddingStart: Spacing.three + Spacing.four },
  // At the title's line, not halfway down a three-line notification.
  dotColumn: { width: 10, alignItems: 'center', alignSelf: 'flex-start', marginTop: 7 },
  dot: { width: 10, height: 10, borderRadius: 5 },
  text: { flex: 1, gap: Spacing.half },
  titleUnread: { fontWeight: 700 },
  barButton: { minHeight: MinTouchSize, justifyContent: 'center', paddingHorizontal: Spacing.two, borderRadius: Spacing.three, flexShrink: 1 },
  barButtonText: { fontWeight: 700 },
});
