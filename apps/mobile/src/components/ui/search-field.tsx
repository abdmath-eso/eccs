import Ionicons from '@expo/vector-icons/Ionicons';
import { Pressable, StyleSheet, TextInput, View, type TextInputProps } from 'react-native';

import { MinTouchSize, Spacing } from '@/constants/theme';
import { useTheme } from '@/hooks/use-theme';
import { useDirection } from '@/lib/direction';
import { useSession } from '@/lib/session';

interface SearchFieldProps extends Omit<TextInputProps, 'style' | 'placeholder' | 'value' | 'onChangeText'> {
  value: string;
  onChangeText: (text: string) => void;
  /** Short, so it fits ("Search labels"); a screen reader hears it too. "Search" when left out. */
  placeholder?: string;
}

/**
 * The app's one search box: a magnifying glass where the typing starts, the words, and a cross to
 * empty it once there is text (Material 3's search bar; Apple's search field). Until 22 Oct 2026
 * search boxes were built three ways, some with a magnifier, some without.
 */
export function SearchField({ value, onChangeText, placeholder, ...rest }: SearchFieldProps) {
  const theme = useTheme();
  const { t } = useSession();
  const { isRtl } = useDirection();
  const hint = placeholder ?? t('common.search');
  return (
    <View style={[styles.box, { borderColor: theme.outline, backgroundColor: theme.backgroundElement }]}>
      <Ionicons name="search" size={22} color={theme.textSecondary} />
      <TextInput
        value={value}
        onChangeText={onChangeText}
        placeholder={hint}
        placeholderTextColor={theme.textSecondary}
        accessibilityLabel={hint}
        returnKeyType="search"
        autoCorrect={false}
        style={[styles.input, { color: theme.text }, isRtl && styles.rightToLeft]}
        {...rest}
      />
      {value !== '' && (
        <Pressable
          accessibilityRole="button"
          accessibilityLabel={t('common.clear')}
          onPress={() => onChangeText('')}
          hitSlop={8}
          style={styles.clear}>
          <Ionicons name="close-circle" size={24} color={theme.textSecondary} />
        </Pressable>
      )}
    </View>
  );
}

const styles = StyleSheet.create({
  box: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: Spacing.two,
    minHeight: MinTouchSize,
    borderWidth: 1,
    borderRadius: Spacing.three,
    paddingStart: Spacing.three,
    paddingEnd: Spacing.one,
  },
  input: { flex: 1, minHeight: MinTouchSize, fontSize: 18 },
  rightToLeft: { writingDirection: 'rtl', textAlign: 'right' },
  clear: { width: 44, height: 44, alignItems: 'center', justifyContent: 'center' },
});
