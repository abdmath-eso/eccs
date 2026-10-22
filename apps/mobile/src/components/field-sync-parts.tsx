import Ionicons from '@expo/vector-icons/Ionicons';
import { useState } from 'react';
import { StyleSheet, View } from 'react-native';

import { ThemedText } from '@/components/themed-text';
import { Button } from '@/components/ui/button';
import { ConfirmDialog } from '@/components/ui/confirm-dialog';
import { Notice } from '@/components/ui/notice';
import { useSnackbar } from '@/components/ui/snackbar';
import { UnsentMark } from '@/components/unsent-mark';
import { Spacing } from '@/constants/theme';
import { useTheme } from '@/hooks/use-theme';
import { formatDateTime } from '@/lib/format';
import type { FieldSubject, FieldSummary, HoldReason } from '@/lib/offline/field-ops';
import { outbox } from '@/lib/offline/outbox';
import { useSession } from '@/lib/session';

// Small pieces the visit and inspection screens share for working without
// signal: the "as of" line on a copy shown from the phone, the mark on a list
// card with unsent work, and the notice on work the server refused.

/**
 * Shown when a list, visit or inspection is on screen from the phone's own copy
 * because the server could not be reached: says so, and how old the copy is.
 */
export function SavedCopyNote({ at }: { at: number }) {
  const theme = useTheme();
  const { t, language } = useSession();
  return (
    <View style={styles.row} accessibilityRole="text">
      <Ionicons name="cloud-offline" size={20} color={theme.textSecondary} />
      <ThemedText type="small" themeColor="textSecondary" style={styles.text}>
        {t('offline.asOf', { time: formatDateTime(new Date(at).toISOString(), language) })}
      </ThemedText>
    </View>
  );
}

/** On a list card: whether this visit or inspection has work the server does not have yet. Nothing when it has none. */
export function FieldMark({ summary, hasSignal }: { summary: FieldSummary; hasSignal: boolean }) {
  const theme = useTheme();
  const { t } = useSession();
  if (summary.held > 0) {
    return (
      <View style={styles.row}>
        <Ionicons name="alert-circle" size={20} color={theme.danger} />
        <ThemedText type="smallBold" themeColor="danger" style={styles.text}>
          {t('offline.heldMark', { count: summary.held })}
        </ThemedText>
      </View>
    );
  }
  if (summary.unsent === 0) return null;
  return (
    <UnsentMark
      sending={hasSignal}
      text={summary.finishPending ? t('offline.finishWaiting') : t('offline.runUnsent', { count: summary.unsent })}
    />
  );
}

interface HeldNoticeProps {
  subject: FieldSubject;
  subjectId: string;
  reason: HoldReason;
  /** How many steps are kept on the phone. */
  count: number;
}

/**
 * On a visit or inspection whose work the server refused: what happened, that
 * the work is still on the phone, and what to do. "Send again" is for after the
 * office has put things right; deleting is the person's own choice, asked twice.
 */
export function HeldNotice({ subject, subjectId, reason, count }: HeldNoticeProps) {
  const { t } = useSession();
  const notify = useSnackbar();
  const [deleting, setDeleting] = useState(false);
  return (
    // The app's one notice box, in its danger look (22 Oct 2026: it was a box of its own with a thicker edge).
    <View accessibilityRole="alert">
      <Notice tone="danger" title={t('offline.heldTitle')} text={t(`offline.held.${subject}.${reason}`, { count })}>
        <View style={styles.actions}>
          <Button icon="refresh" label={t('offline.sendAgain')} variant="secondary" onPress={() => outbox.release(subject, subjectId)} />
          <Button label={t('offline.deleteFromPhone')} variant="danger" onPress={() => setDeleting(true)} />
        </View>
      </Notice>
      <ConfirmDialog
        visible={deleting}
        message={t('offline.deleteConfirm', { count })}
        confirmLabel={t('offline.deleteFromPhone')}
        danger
        onConfirm={() => {
          setDeleting(false);
          outbox.discard(subject, subjectId);
          notify(t('offline.deleted'));
        }}
        onCancel={() => setDeleting(false)}
      />
    </View>
  );
}

const styles = StyleSheet.create({
  // The icon on the first line of words that may wrap (in Telugu, or on a small phone), not halfway down them.
  row: { flexDirection: 'row', alignItems: 'flex-start', gap: Spacing.two },
  text: { flex: 1 },
  actions: { gap: Spacing.two, marginTop: Spacing.one },
});
