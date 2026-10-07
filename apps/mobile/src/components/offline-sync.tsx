import Ionicons from '@expo/vector-icons/Ionicons';
import { isEccsRole, localize } from '@eccs/shared';
import { router, usePathname } from 'expo-router';
import { useEffect, useState } from 'react';
import { ActivityIndicator, AppState, Modal, Platform, Pressable, StyleSheet, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

import { DirectionView } from '@/components/direction-view';
import { ThemedText } from '@/components/themed-text';
import { Button } from '@/components/ui/button';
import { MaxContentWidth, MinTouchSize, Spacing } from '@/constants/theme';
import { useTheme } from '@/hooks/use-theme';
import { isTabRoute } from '@/lib/navigation';
import { checklistCache } from '@/lib/offline/checklist-cache';
import { fieldCache } from '@/lib/offline/field-cache';
import { isFieldOp } from '@/lib/offline/field-ops';
import { outbox, useOutbox } from '@/lib/offline/outbox';
import type { OutboxNotice } from '@/lib/offline/outbox-core';
import { useSession } from '@/lib/session';

// How long "All sent" stays up before the line goes away.
const ALL_SENT_MS = 4000;

/**
 * Keeps checklist answers, and a Supervisor's visits and inspections, flowing
 * to the server whenever the app is open, on any screen, and always says where
 * things stand in one quiet line above the bottom bar:
 *   - no signal, and how many answers are saved on the phone waiting;
 *   - sending, and how many are left;
 *   - all sent (briefly);
 *   - work the server did not accept, kept on the phone, with a way to open it.
 * It also tells the person, once, when answers saved on the phone could not
 * be added to a checklist (someone else submitted it first, say), or when a
 * visit's or inspection's work was refused and what to do about it.
 * Mounted once, in the layout of the logged-in screens.
 */
export function OfflineSync() {
  const theme = useTheme();
  const insets = useSafeAreaInsets();
  const pathname = usePathname();
  const { t, user, language } = useSession();
  const box = useOutbox();
  // The "all sent" moment whose message has already been shown for long enough.
  const [allSentSeen, setAllSentSeen] = useState<number | null>(null);

  const userId = user?.id ?? null;
  const userName = user?.name ?? null;

  // Tell the outbox and the saved checklists who is using the phone. Only that
  // person's answers are sent; anyone else's wait on the phone for them.
  useEffect(() => {
    if (userId) void checklistCache.load(userId);
    if (userId) void fieldCache.load(userId);
    outbox.setUser(userId, userName);
    void outbox.init();
  }, [userId, userName]);

  // Logging out takes this component away: stop sending straight away.
  useEffect(
    () => () => {
      outbox.setUser(null);
      checklistCache.close();
      fieldCache.close();
    },
    [],
  );

  // Try again as soon as the app is opened again, and (in a browser) when the connection comes back.
  useEffect(() => {
    const subscription = AppState.addEventListener('change', (state) => {
      if (state === 'active') outbox.kick();
    });
    const online = () => outbox.kick();
    const inBrowser = Platform.OS === 'web' && typeof window !== 'undefined';
    if (inBrowser) window.addEventListener('online', online);
    return () => {
      subscription.remove();
      if (inBrowser) window.removeEventListener('online', online);
    };
  }, []);

  const allSentAt = box.allSentAt;
  useEffect(() => {
    if (allSentAt === null) return;
    const timer = setTimeout(() => setAllSentSeen(allSentAt), ALL_SENT_MS);
    return () => clearTimeout(timer);
  }, [allSentAt]);

  if (!user) return null;

  // Work the server refused is kept on the phone but is not "waiting to send"; it has its own line.
  const count = box.waiting;
  const noSignal = box.online === false;
  const role = user.memberships[0]?.role;
  // The screens where work done without signal is saved for later: checklists for a
  // restaurant, visits and inspections for ECCS staff.
  const savesForLater =
    pathname.startsWith('/checklists') ||
    (role !== undefined && isEccsRole(role) && (pathname.startsWith('/services') || pathname.startsWith('/inspections')));
  // The first visit or inspection whose work the server refused and the phone is keeping.
  const heldOp = box.ops.filter(isFieldOp).find((op) => op.held !== undefined);
  const openHeld = () => {
    if (!heldOp) return;
    if (heldOp.subject === 'visit') router.push({ pathname: '/services/[visitId]', params: { visitId: heldOp.subjectId } });
    else router.push({ pathname: '/inspections/[inspectionId]', params: { inspectionId: heldOp.subjectId } });
  };
  // On a visit or an inspection itself the notice there already says what is held and what to do.
  const onOne = /^\/(services|inspections)\/[^/]+/.test(pathname) && !/\/(book|start)$/.test(pathname);

  // What the line says, if anything. Text and an icon together, never colour alone.
  let line: {
    icon: 'cloud-offline' | 'cloud-done' | 'time' | 'alert-circle' | null;
    text: string;
    color: string;
    retry?: boolean;
    /** Opens the visit or inspection whose work is held, instead of trying again. */
    open?: boolean;
  } | null = null;
  if (count > 0 && box.phase === 'sending' && !noSignal) {
    line = { icon: null, text: t('offline.sending', { count }), color: theme.textSecondary };
  } else if (count > 0 && noSignal) {
    line = { icon: 'cloud-offline', text: t('offline.noSignalWaiting', { count }), color: theme.warning, retry: true };
  } else if (count > 0) {
    line = { icon: 'time', text: t('offline.retrying', { count }), color: theme.warning, retry: true };
  } else if (heldOp && !onOne) {
    line = { icon: 'alert-circle', text: t('offline.heldLine', { count: box.held }), color: theme.danger, open: true };
  } else if (noSignal && savesForLater) {
    // Elsewhere in the app nothing is saved for later, so this promise is only made here.
    line = { icon: 'cloud-offline', text: t('offline.noSignal'), color: theme.warning, retry: true };
  } else if (allSentAt !== null && allSentSeen !== allSentAt) {
    line = { icon: 'cloud-done', text: t('offline.allSent'), color: theme.primary };
  }

  /** Says plainly what happened to the answers that were not added. */
  const noticeText = (shown: OutboxNotice): string => {
    if (shown.subject) {
      // A Supervisor's visit or inspection, named by its outlet where the phone knows it.
      const visit = shown.subject === 'visit' ? fieldCache.getVisit(shown.runId)?.data : undefined;
      const place = visit
        ? [localize(visit.serviceName, language), visit.outletName].join(', ')
        : shown.subject === 'inspection'
          ? fieldCache.getInspection(shown.runId)?.data.outletName
          : undefined;
      const title = place ? `“${place}”` : t(shown.subject === 'visit' ? 'offline.thisVisit' : 'offline.thisInspection');
      if (shown.reason === 'rejected') return t('offline.stepsRejected', { title, count: shown.count });
      if (shown.reason === 'finishRejected') return t('offline.finishRejected', { title });
      if (shown.reason === 'finished' || shown.reason === 'cancelled' || shown.reason === 'gone') {
        const what = t(`offline.held.${shown.subject}.${shown.reason}`, { count: shown.count });
        return place ? `${title}. ${what}` : what;
      }
    }
    const name = localize(shown.title ?? checklistCache.getRun(shown.runId)?.title, language);
    const title = name ? `“${name}”` : t('offline.thisChecklist');
    if (shown.reason === 'submittedByOther') {
      return t(shown.count > 0 ? 'offline.conflictSubmitted' : 'offline.conflictSubmittedNone', {
        name: shown.by ?? t('offline.someone'),
        title,
        count: shown.count,
      });
    }
    if (shown.reason === 'closed') return t('offline.conflictClosed', { title, count: shown.count });
    return shown.count > 0 ? t('offline.rejected', { title, count: shown.count }) : t('offline.submitRejected', { title });
  };

  const notice = box.notices[0];
  // Screens without the bottom bar reach the bottom edge, so keep clear of the home indicator there.
  const aboveBottomBar = isTabRoute(pathname, user.memberships[0]?.role);

  return (
    <>
      {line && (
        <Pressable
          accessibilityRole={line.retry || line.open ? 'button' : 'text'}
          accessibilityLabel={
            line.retry ? `${line.text}. ${t('offline.tryNow')}` : line.open ? `${line.text}. ${t('offline.open')}` : line.text
          }
          accessibilityLiveRegion="polite"
          disabled={!line.retry && !line.open}
          onPress={() => (line.open ? openHeld() : outbox.kick())}
          style={[
            styles.strip,
            {
              backgroundColor: theme.backgroundElement,
              borderColor: theme.border,
              paddingBottom: Spacing.two + (aboveBottomBar ? 0 : insets.bottom),
            },
          ]}>
          <View style={styles.row}>
            {line.icon ? (
              <Ionicons name={line.icon} size={22} color={line.color} />
            ) : (
              <ActivityIndicator size="small" color={theme.primary} />
            )}
            <ThemedText type="small" style={styles.text}>
              {line.text}
            </ThemedText>
            {(line.retry || line.open) && (
              <ThemedText type="smallBold" themeColor="primary">
                {t(line.open ? 'offline.open' : 'offline.tryNow')}
              </ThemedText>
            )}
          </View>
        </Pressable>
      )}

      {notice && (
        <Modal visible transparent animationType="fade" onRequestClose={() => outbox.dismissNotice(notice.id)}>
          <DirectionView style={styles.backdrop}>
            <View style={[styles.card, { backgroundColor: theme.background }]} accessibilityRole="alert">
              <Ionicons name="alert-circle" size={32} color={theme.warning} />
              <ThemedText type="default">{noticeText(notice)}</ThemedText>
              {notice.subject && (
                <Button
                  label={t('offline.open')}
                  onPress={() => {
                    outbox.dismissNotice(notice.id);
                    if (notice.subject === 'visit') {
                      router.push({ pathname: '/services/[visitId]', params: { visitId: notice.runId } });
                    } else {
                      router.push({ pathname: '/inspections/[inspectionId]', params: { inspectionId: notice.runId } });
                    }
                  }}
                />
              )}
              <Button
                label={t('common.close')}
                variant={notice.subject ? 'secondary' : 'primary'}
                onPress={() => outbox.dismissNotice(notice.id)}
              />
            </View>
          </DirectionView>
        </Modal>
      )}
    </>
  );
}

const styles = StyleSheet.create({
  strip: {
    borderTopWidth: 1,
    paddingTop: Spacing.two,
    paddingHorizontal: Spacing.three,
    alignItems: 'center',
  },
  row: {
    width: '100%',
    maxWidth: MaxContentWidth,
    minHeight: MinTouchSize - Spacing.three,
    flexDirection: 'row',
    alignItems: 'center',
    gap: Spacing.two,
  },
  text: { flex: 1 },
  backdrop: {
    flex: 1,
    backgroundColor: 'rgba(0,0,0,0.5)',
    alignItems: 'center',
    justifyContent: 'center',
    padding: Spacing.four,
  },
  card: {
    width: '100%',
    maxWidth: MaxContentWidth - Spacing.six,
    borderRadius: Spacing.four,
    padding: Spacing.four,
    gap: Spacing.three,
  },
});
