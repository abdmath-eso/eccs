import Ionicons from '@expo/vector-icons/Ionicons';
import { FOOD_LABEL_RULES, type ShelfLifeUnit } from '@eccs/shared';
import { useState } from 'react';
import { Pressable, StyleSheet, View } from 'react-native';

import { tallScript, ThemedText } from '@/components/themed-text';
import { ErrorText } from '@/components/ui/error-text';
import { OptionChip } from '@/components/ui/option-chip';
import { TextField } from '@/components/ui/text-field';
import { MinTouchSize, Spacing } from '@/constants/theme';
import { useTheme } from '@/hooks/use-theme';
import { chosenHours, shelfLifeText, type ShelfLifeChoice } from '@/lib/labels';
import { useSession } from '@/lib/session';

const UNITS: ShelfLifeUnit[] = ['HOURS', 'DAYS'];

interface ShelfLifeFieldProps {
  /** The question over the choices. */
  label: string;
  value: ShelfLifeChoice;
  onChange: (next: ShelfLifeChoice) => void;
  /** One line under the choices; an error takes its place. */
  hint: string;
  error?: string | null;
}

/**
 * How long a food keeps, asked the same way on every form that makes or changes a label: the common
 * lengths as chips to tap, and "Another length" for any other, typed as a number with Hours | Days
 * right beside it as one answer (Material 3: choice chips for a handful of set options, a segmented
 * button for two). Until 22 Oct 2026 adding a label asked with chips and changing one with a number,
 * two controls for one question.
 */
export function ShelfLifeField({ label, value, onChange, hint, error }: ShelfLifeFieldProps) {
  const theme = useTheme();
  const { t, language } = useSession();
  // The number box takes the cursor when "Another length" is tapped, not when a saved length opens with it.
  const [focusNumber, setFocusNumber] = useState(false);
  const typedWrong = value.other && value.number.trim() !== '' && chosenHours(value) === null;
  const message = error ?? (typedWrong ? t('labels.items.lifeNeeded') : null);
  // In the longer scripts the chosen unit carries no tick, so "Hours" | "Days" keep to one line at 320
  // (Tamil, Malayalam); its filled background and heavier words still mark it.
  const tick = !tallScript(language);

  return (
    <View style={styles.field}>
      <ThemedText type="smallBold" themeColor="textSecondary">
        {label}
      </ThemedText>
      <View style={styles.chips} accessibilityRole="radiogroup" accessibilityLabel={label}>
        {FOOD_LABEL_RULES.shelfLifePresets.map((hours) => (
          <OptionChip
            key={hours}
            label={shelfLifeText(hours, t)}
            selected={!value.other && value.preset === hours}
            onPress={() => onChange({ ...value, other: false, preset: hours })}
          />
        ))}
        <OptionChip
          label={t('labels.otherLength')}
          selected={value.other}
          onPress={() => {
            if (!value.other) setFocusNumber(true);
            onChange({ ...value, other: true });
          }}
        />
      </View>

      {value.other && (
        <View style={styles.otherRow}>
          <View style={styles.number}>
            <TextField
              accessibilityLabel={t('labels.otherLengthNumber')}
              value={value.number}
              onChangeText={(number) => onChange({ ...value, number })}
              keyboardType="number-pad"
              maxLength={4}
              autoFocus={focusNumber}
              style={message ? { borderColor: theme.danger, borderWidth: 2 } : undefined}
            />
          </View>
          <View style={[styles.segments, { borderColor: theme.outline }]} accessibilityRole="radiogroup">
            {UNITS.map((option, index) => {
              const selected = value.unit === option;
              return (
                <Pressable
                  key={option}
                  accessibilityRole="radio"
                  accessibilityState={{ selected, checked: selected }}
                  onPress={() => onChange({ ...value, unit: option })}
                  style={({ pressed }) => [
                    styles.segment,
                    index > 0 && { borderStartWidth: 1, borderStartColor: theme.outline },
                    selected && { backgroundColor: theme.primaryContainer },
                    pressed && !selected && { backgroundColor: theme.backgroundElement },
                  ]}>
                  {selected && tick && <Ionicons name="checkmark" size={18} color={theme.onPrimaryContainer} />}
                  <ThemedText
                    type="default"
                    style={[styles.segmentText, selected && styles.bold, { color: selected ? theme.onPrimaryContainer : theme.text }]}>
                    {t(`labels.unit.${option}`)}
                  </ThemedText>
                </Pressable>
              );
            })}
          </View>
        </View>
      )}

      {message ? (
        <ErrorText message={message} />
      ) : (
        <ThemedText type="small" themeColor="textSecondary">
          {hint}
        </ThemedText>
      )}
    </View>
  );
}

const styles = StyleSheet.create({
  field: { gap: Spacing.two },
  chips: { flexDirection: 'row', flexWrap: 'wrap', gap: Spacing.two },
  otherRow: { flexDirection: 'row', alignItems: 'flex-start', gap: Spacing.two },
  // Room for four digits, and no more, so Hours | Days keep the rest of the row at 320.
  number: { width: 88 },
  // Two buttons joined into one control, the chosen one filled.
  segments: { flex: 1, flexDirection: 'row', minHeight: MinTouchSize, borderWidth: 1, borderRadius: Spacing.three, overflow: 'hidden' },
  segment: {
    flex: 1,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: Spacing.one,
    paddingHorizontal: Spacing.one,
  },
  segmentText: { flexShrink: 1, textAlign: 'center' },
  bold: { fontWeight: 700 },
});
