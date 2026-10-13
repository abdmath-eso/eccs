import Ionicons from '@expo/vector-icons/Ionicons';
import { useState, type ComponentProps, type ReactNode } from 'react';
import { Pressable, StyleSheet, View } from 'react-native';

import { ThemedText } from '@/components/themed-text';
import { MinTouchSize, Spacing } from '@/constants/theme';
import { useTheme } from '@/hooks/use-theme';

interface ExpandableProps {
  /** What is inside, in a few words. It is all that shows until the line is tapped. */
  title: string;
  /** A small picture before the title. */
  icon?: ComponentProps<typeof Ionicons>['name'];
  children: ReactNode;
}

/**
 * One line that opens to show more underneath, and closes again when tapped.
 *
 * For an explanation a person reads once, so that it does not have to be scrolled
 * past on every later visit to reach the part of the screen that is used (the
 * founder found the customer page screen "too much text and too long", 13 Oct
 * 2026). It is the accordion that guidance on small screens recommends for
 * secondary detail: the main controls stay in view and the rest is one tap away
 * (Nielsen Norman Group on progressive disclosure and on accordions on mobile;
 * Material's expansion panel). Closed to begin with. The arrow turns to show
 * which way it is, and a screen reader is told "collapsed" or "expanded".
 *
 * Do not put anything a person must read, or a main action, inside one.
 */
export function Expandable({ title, icon, children }: ExpandableProps) {
  const theme = useTheme();
  const [open, setOpen] = useState(false);
  return (
    <View style={[styles.box, { borderColor: theme.outline }]}>
      <Pressable
        accessibilityRole="button"
        accessibilityState={{ expanded: open }}
        onPress={() => setOpen((current) => !current)}
        style={({ pressed }) => [styles.header, pressed && { backgroundColor: theme.backgroundElement }]}>
        {icon && <Ionicons name={icon} size={22} color={theme.textSecondary} />}
        <ThemedText type="default" style={styles.title}>
          {title}
        </ThemedText>
        <Ionicons name={open ? 'chevron-up' : 'chevron-down'} size={22} color={theme.textSecondary} />
      </Pressable>
      {open && <View style={styles.body}>{children}</View>}
    </View>
  );
}

const styles = StyleSheet.create({
  box: { borderWidth: 1, borderRadius: Spacing.three, overflow: 'hidden' },
  header: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: Spacing.two,
    minHeight: MinTouchSize,
    paddingHorizontal: Spacing.three,
    paddingVertical: Spacing.two,
  },
  title: { flex: 1, fontWeight: 700 },
  body: { paddingHorizontal: Spacing.three, paddingBottom: Spacing.three, gap: Spacing.two },
});
