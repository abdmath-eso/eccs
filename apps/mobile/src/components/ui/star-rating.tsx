import Ionicons from '@expo/vector-icons/Ionicons';
import { Pressable, StyleSheet, View } from 'react-native';

import { MinTouchSize, Spacing } from '@/constants/theme';
import { useTheme } from '@/hooks/use-theme';
import { useSession } from '@/lib/session';

export type Stars = 1 | 2 | 3 | 4 | 5;
const STARS: Stars[] = [1, 2, 3, 4, 5];

interface StarRatingProps {
  /** How many stars are filled; null before the person has chosen. */
  value: number | null;
  /** Leave out to only show a rating that was already given. */
  onChange?: (value: Stars) => void;
  disabled?: boolean;
}

/**
 * Five stars. Tapping the third fills the first three, as in every app that
 * asks for a rating. Without `onChange` it is a small read-only row.
 */
export function StarRating({ value, onChange, disabled }: StarRatingProps) {
  const theme = useTheme();
  const { t } = useSession();
  const label = value ? t('visit.stars', { count: value }) : undefined;

  if (!onChange) {
    return (
      <View style={styles.row} accessibilityRole="image" accessibilityLabel={label}>
        {STARS.map((star) => (
          <Ionicons
            key={star}
            name={value !== null && star <= value ? 'star' : 'star-outline'}
            size={22}
            color={value !== null && star <= value ? theme.warning : theme.outline}
          />
        ))}
      </View>
    );
  }

  return (
    <View style={styles.choices} accessibilityRole="radiogroup" accessibilityLabel={label}>
      {STARS.map((star) => {
        const filled = value !== null && star <= value;
        return (
          <Pressable
            key={star}
            accessibilityRole="radio"
            accessibilityState={{ selected: value === star, checked: value === star, disabled: !!disabled }}
            accessibilityLabel={`${t('visit.stars', { count: star })}, ${t(`visit.rating.${star}`)}`}
            disabled={disabled}
            onPress={() => onChange(star)}
            style={styles.star}>
            <Ionicons name={filled ? 'star' : 'star-outline'} size={40} color={filled ? theme.warning : theme.outline} />
          </Pressable>
        );
      })}
    </View>
  );
}

const styles = StyleSheet.create({
  row: { flexDirection: 'row', gap: Spacing.half },
  choices: { flexDirection: 'row', justifyContent: 'center', gap: Spacing.one },
  star: { minWidth: MinTouchSize, minHeight: MinTouchSize, alignItems: 'center', justifyContent: 'center' },
});
