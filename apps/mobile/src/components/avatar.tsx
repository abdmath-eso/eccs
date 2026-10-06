import { Image, StyleSheet, View } from 'react-native';

import { ThemedText } from '@/components/themed-text';
import { useTheme } from '@/hooks/use-theme';

/** The first letters of the first two words of a name, for when there is no photo. */
function initials(name: string): string {
  const letters = name
    .replace(/\(.*?\)/g, ' ')
    .split(/\s+/)
    .filter(Boolean)
    .slice(0, 2)
    .map((word) => [...word][0] ?? '');
  return letters.join('').toUpperCase() || '?';
}

/** A person's round profile photo, or their initials if they have not set one. */
export function Avatar({ name, photoUrl, size }: { name: string; photoUrl?: string | null; size: number }) {
  const theme = useTheme();
  const round = { width: size, height: size, borderRadius: size / 2 };

  if (photoUrl) {
    return (
      <Image
        source={{ uri: photoUrl }}
        accessibilityIgnoresInvertColors
        style={[round, { backgroundColor: theme.backgroundElement }]}
      />
    );
  }
  return (
    <View style={[round, styles.initials, { backgroundColor: theme.primary }]}>
      <ThemedText style={{ color: theme.onPrimary, fontSize: size * 0.38, lineHeight: size * 0.5, fontWeight: 700 }}>
        {initials(name)}
      </ThemedText>
    </View>
  );
}

const styles = StyleSheet.create({
  initials: { alignItems: 'center', justifyContent: 'center' },
});
