import { CORRECTION_REASON_MIN } from '@eccs/shared';
import { useState, type ReactNode } from 'react';
import { Modal, ScrollView, StyleSheet, View } from 'react-native';

import { DirectionView } from '@/components/direction-view';
import { ThemedText } from '@/components/themed-text';
import { Button } from '@/components/ui/button';
import { ErrorText } from '@/components/ui/error-text';
import { TextField } from '@/components/ui/text-field';
import { MaxContentWidth, Spacing } from '@/constants/theme';
import { useTheme } from '@/hooks/use-theme';
import { KeyboardDialogFrame } from '@/lib/keyboard';
import { useSession } from '@/lib/session';

interface ReasonDialogProps {
  /** What is about to be changed: "Void this clock-in?". */
  title: string;
  /** A line of explanation under the title. */
  message?: string;
  confirmLabel: string;
  danger?: boolean;
  /** True while the change is being sent. */
  busy?: boolean;
  /** What the server said when it refused the change. */
  error?: string | null;
  /** Anything else the change needs, shown above the reason (a time, a choice). */
  children?: ReactNode;
  onConfirm: (reason: string) => void;
  onCancel: () => void;
}

/**
 * Asks why before a correction is made. Attendance decides pay, so every
 * change the Owner makes by hand carries a typed reason that stays on record.
 * Show it only while it is wanted (`{asking && <ReasonDialog ... />}`), so it
 * opens empty each time. It sits near the top so the keyboard does not cover it.
 */
export function ReasonDialog({ title, message, confirmLabel, danger, busy, error, children, onConfirm, onCancel }: ReasonDialogProps) {
  const theme = useTheme();
  const { t } = useSession();
  const [reason, setReason] = useState('');
  const [tooShort, setTooShort] = useState(false);

  function confirm() {
    const typed = reason.trim();
    if (typed.length < CORRECTION_REASON_MIN) return setTooShort(true);
    onConfirm(typed);
  }

  return (
    <Modal visible transparent animationType="fade" onRequestClose={onCancel}>
      {/* Shrinks above the keyboard while typing, so the buttons can still be scrolled to. */}
      <KeyboardDialogFrame style={styles.frame}>
        <DirectionView style={styles.backdrop}>
          <View style={[styles.card, { backgroundColor: theme.backgroundRaised }]}>
            <ScrollView contentContainerStyle={styles.body} keyboardShouldPersistTaps="handled">
              <ThemedText type="default" style={styles.title}>
                {title}
              </ThemedText>
              {message && (
                <ThemedText type="default" themeColor="textSecondary">
                  {message}
                </ThemedText>
              )}
              {children}
              <TextField
                label={t('att.reason')}
                value={reason}
                onChangeText={(next) => {
                  setReason(next);
                  setTooShort(false);
                }}
                hint={t('att.reasonHint')}
                error={tooShort ? t('att.reasonNeeded', { count: CORRECTION_REASON_MIN }) : null}
                maxLength={300}
                multiline
              />
              <ErrorText message={error ?? null} />
              <Button label={confirmLabel} variant={danger ? 'danger' : 'primary'} loading={busy} onPress={confirm} />
              <Button label={t('common.cancel')} variant="secondary" disabled={busy} onPress={onCancel} />
            </ScrollView>
          </View>
        </DirectionView>
      </KeyboardDialogFrame>
    </Modal>
  );
}

const styles = StyleSheet.create({
  frame: { flex: 1 },
  backdrop: {
    flex: 1,
    backgroundColor: 'rgba(0,0,0,0.5)',
    alignItems: 'center',
    justifyContent: 'flex-start',
    padding: Spacing.four,
    paddingTop: Spacing.six,
  },
  card: {
    width: '100%',
    maxWidth: MaxContentWidth - Spacing.six,
    maxHeight: '90%',
    borderRadius: Spacing.four,
  },
  body: { padding: Spacing.four, gap: Spacing.three },
  title: { fontWeight: 700 },
});
