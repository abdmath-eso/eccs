import Ionicons from '@expo/vector-icons/Ionicons';
import type { ComponentProps, ReactNode } from 'react';
import { StyleSheet, View } from 'react-native';

import { ThemedText } from '@/components/themed-text';
import { Spacing } from '@/constants/theme';
import { useTheme } from '@/hooks/use-theme';

export type NoticeTone = 'info' | 'warning' | 'danger' | 'sample';

// Each kind has one colour and one picture, everywhere (IBM Carbon's notifications: "each status
// is associated with a specific color and icon").
const LOOK: Record<NoticeTone, { icon: ComponentProps<typeof Ionicons>['name']; color: 'info' | 'warning' | 'danger' }> = {
  info: { icon: 'information-circle-outline', color: 'info' },
  warning: { icon: 'warning-outline', color: 'warning' },
  danger: { icon: 'alert-circle-outline', color: 'danger' },
  sample: { icon: 'flask-outline', color: 'warning' },
};

interface NoticeProps {
  tone: NoticeTone;
  /** A short bold first line. */
  title?: string;
  /** The message: one or two sentences. */
  text?: string;
  /** Extra parts under the message, such as a button. */
  children?: ReactNode;
}

/**
 * A box that tells the person something about the screen: a warning, a note, or that a thing is
 * only a sample. One look for all of them (22 Oct 2026: six orange boxes were drawn six ways,
 * with five icons, two corner sizes and two inner spaces).
 */
export function Notice({ tone, title, text, children }: NoticeProps) {
  const theme = useTheme();
  const look = LOOK[tone];
  const color = theme[look.color];
  return (
    <View style={[styles.box, { borderColor: color, backgroundColor: `${color}0F` }]}>
      <Ionicons name={look.icon} size={22} color={color} style={styles.icon} />
      <View style={styles.words}>
        {title && <ThemedText type="smallBold">{title}</ThemedText>}
        {text && <ThemedText type="small">{text}</ThemedText>}
        {children}
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  box: {
    flexDirection: 'row',
    alignItems: 'flex-start',
    gap: Spacing.two,
    borderWidth: 1,
    borderRadius: Spacing.three,
    padding: Spacing.three,
  },
  icon: { marginTop: -1 },
  words: { flex: 1, gap: Spacing.one },
});
