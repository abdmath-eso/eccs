import Ionicons from '@expo/vector-icons/Ionicons';
import {
  ISSUE_CATEGORIES,
  localize,
  notificationWordingParams,
  type NotificationDto,
  type NotificationLink,
} from '@eccs/shared';
import { router, useFocusEffect } from 'expo-router';
import { useCallback, useState } from 'react';
import { ActivityIndicator, Pressable, StyleSheet, View } from 'react-native';

import { ThemedText } from '@/components/themed-text';
import { Button } from '@/components/ui/button';
import { ErrorText } from '@/components/ui/error-text';
import { Screen } from '@/components/ui/screen';
import { useSnackbar } from '@/components/ui/snackbar';
import { MinTouchSize, Spacing } from '@/constants/theme';
import { useTheme } from '@/hooks/use-theme';
import { errorMessage } from '@/lib/errors';
import { addDays, formatDate, formatDayLong, formatSlot, formatTime, indiaToday } from '@/lib/format';
import { useSession } from '@/lib/session';
import { rememberOutlet } from '@/lib/use-outlet';

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

/** Opens what a notification is about. An Owner with several branches lands on the right one. */
function open(link: NotificationLink) {
  if ('outletId' in link && link.outletId) void rememberOutlet(link.outletId);
  switch (link.kind) {
    case 'visit':
      return router.push({ pathname: '/services/[visitId]', params: { visitId: link.visitId } });
    case 'services':
      return router.push('/services');
    case 'issue':
      return router.push({ pathname: '/support/[issueId]', params: { issueId: link.issueId } });
    case 'checklist':
      return link.runId
        ? router.push({ pathname: '/checklists/[runId]', params: { runId: link.runId } })
        : router.push('/checklists');
    case 'documents':
      return router.push('/documents');
    case 'staff':
      return router.push('/staff');
  }
}

/**
 * Notifications: everything the app has to tell this person, newest first and
 * grouped by day. One not yet read has a dot and heavier writing. Tapping one
 * opens what it is about and marks it read.
 */
export default function NotificationsScreen() {
  const theme = useTheme();
  const { t, api, language } = useSession();
  const notify = useSnackbar();
  const [items, setItems] = useState<NotificationDto[] | null>(null);
  const [nextCursor, setNextCursor] = useState<string | null>(null);
  const [unread, setUnread] = useState(0);
  const [error, setError] = useState<string | null>(null);
  const [olderError, setOlderError] = useState<string | null>(null);
  const [loadingOlder, setLoadingOlder] = useState(false);
  const [markingAll, setMarkingAll] = useState(false);

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
    if (item.link) open(item.link);
  }

  /** The title and body in the language the app is in, from the notification's kind and values. */
  function wording(item: NotificationDto): { title: string; body: string } {
    // A kind this version of the app does not know yet is shown in the server's English.
    if (!item.type) return { title: item.title, body: item.body };
    const values = notificationWordingParams(item.params, {
      text: (value) => localize(value, language),
      date: (value) => formatDate(value, language),
      slot: (value) => (value ? formatSlot(value, language, t) : null) ?? t('notif.noTime'),
      category: (value) => {
        const known = ISSUE_CATEGORIES.find((category) => category === value);
        return known ? t(`category.${known}`) : value;
      },
    });
    return { title: t(`notif.${item.type}.title`, values), body: t(`notif.${item.type}.body`, values).trim() };
  }

  const today = indiaToday();
  const yesterday = addDays(today, -1);
  const dayName = (day: string) =>
    day === today ? t('notif.today') : day === yesterday ? t('notif.yesterday') : formatDayLong(day, language);

  // The list arrives newest first, so each day's notifications are already together.
  const days: { day: string; items: (NotificationDto & { time: string })[] }[] = [];
  for (const item of items ?? []) {
    const { day, time } = indiaDayAndTime(item.createdAt);
    const last = days[days.length - 1];
    if (last?.day === day) last.items.push({ ...item, time });
    else days.push({ day, items: [{ ...item, time }] });
  }

  return (
    <Screen back title={t('notif.title')} onRefresh={load}>
      <ErrorText message={error} onRetry={items === null ? () => void load() : undefined} />
      {items === null && !error && <ActivityIndicator color={theme.primary} />}

      {unread > 0 && (
        <Button
          icon="checkmark-done"
          label={t('notif.markAllRead')}
          variant="secondary"
          onPress={() => void markAllRead()}
          loading={markingAll}
        />
      )}

      {items?.length === 0 && (
        <View style={styles.empty}>
          <Ionicons name="notifications-off-outline" size={56} color={theme.textSecondary} />
          <ThemedText type="subtitle" style={styles.emptyTitle}>
            {t('notif.empty')}
          </ThemedText>
          <ThemedText type="default" themeColor="textSecondary" style={styles.center}>
            {t('notif.emptyHelp')}
          </ThemedText>
        </View>
      )}

      {days.map((group) => (
        <View key={group.day} style={styles.day}>
          <ThemedText type="smallBold" themeColor="textSecondary" accessibilityRole="header">
            {dayName(group.day)}
          </ThemedText>
          {group.items.map((item) => {
            const { title, body } = wording(item);
            const isUnread = !item.readAt;
            const outlet = typeof item.params.outlet === 'string' ? item.params.outlet : '';
            // Says which branch, for an Owner with several, unless the sentence already does.
            const meta = [outlet && !body.includes(outlet) ? outlet : null, formatTime(item.time, language)].filter(Boolean).join(' · ');
            return (
              <Pressable
                key={item.id}
                accessibilityRole="button"
                accessibilityLabel={`${isUnread ? `${t('notif.unread')}. ` : ''}${title}. ${body} ${meta}`}
                onPress={() => press(item)}
                style={({ pressed }) => [
                  styles.row,
                  {
                    backgroundColor: pressed ? theme.backgroundSelected : theme.backgroundElement,
                    // Unread is marked three ways, never by colour alone: an edge, a dot and heavier writing.
                    borderColor: isUnread ? theme.primary : 'transparent',
                  },
                ]}>
                <View style={styles.dotColumn}>
                  {isUnread && <View style={[styles.dot, { backgroundColor: theme.primary }]} />}
                </View>
                <View style={styles.text}>
                  <ThemedText type="default" style={isUnread ? styles.titleUnread : styles.titleRead}>
                    {title}
                  </ThemedText>
                  <ThemedText type="default" themeColor={isUnread ? 'text' : 'textSecondary'}>
                    {body}
                  </ThemedText>
                  <ThemedText type="small" themeColor="textSecondary">
                    {meta}
                  </ThemedText>
                </View>
                {item.link && <Ionicons name="chevron-forward" size={20} color={theme.textSecondary} />}
              </Pressable>
            );
          })}
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
  day: { gap: Spacing.two },
  row: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: Spacing.two,
    borderRadius: Spacing.three,
    borderWidth: 1.5,
    padding: Spacing.three,
    paddingLeft: Spacing.two,
    minHeight: MinTouchSize * 1.6,
  },
  // Kept even when there is no dot, so read and unread rows line up.
  dotColumn: { width: 12, alignItems: 'center' },
  dot: { width: 12, height: 12, borderRadius: 6 },
  text: { flex: 1, gap: Spacing.half },
  titleUnread: { fontWeight: 700, fontSize: 17 },
  titleRead: { fontWeight: 500, fontSize: 17 },
  empty: { alignItems: 'center', gap: Spacing.two, paddingVertical: Spacing.six },
  emptyTitle: { fontSize: 20, lineHeight: 26, textAlign: 'center' },
  center: { textAlign: 'center' },
});
