import Ionicons from '@expo/vector-icons/Ionicons';
import { isReferral, LEAD_SOURCES, normalizePhone, type LeadSource, type ShopBoardReadingDto } from '@eccs/shared';
import { useState } from 'react';
import { Pressable, StyleSheet, View } from 'react-native';

import { AiMark } from '@/components/ai-parts';
import { ThemedText } from '@/components/themed-text';
import { OptionSheet } from '@/components/ui/option-sheet';
import { TextField } from '@/components/ui/text-field';
import { MinTouchSize, Spacing } from '@/constants/theme';
import { useTheme } from '@/hooks/use-theme';
import { useSession } from '@/lib/session';

// The fields of a lead (B2): the few a BDE needs in the street. Used by Log a lead, where
// AI may have filled some from the shop board, and by Change details.

export interface LeadFormValues {
  businessName: string;
  area: string;
  address: string;
  contactName: string;
  phone: string;
  kitchens: number;
  source: LeadSource;
  referrerName: string;
}

export const emptyLeadForm = (): LeadFormValues => ({
  businessName: '',
  area: '',
  address: '',
  contactName: '',
  phone: '',
  kitchens: 1,
  source: 'FIELD_VISIT',
  referrerName: '',
});

/** What is wrong with the form, if anything: the name is needed, and a phone typed must be a mobile number. */
export function leadFormProblems(values: LeadFormValues) {
  return {
    businessName: values.businessName.trim().length === 0,
    phone: values.phone.trim().length > 0 && normalizePhone(values.phone) === null,
  };
}

/** The phone as the API takes it (it adds +91 itself); null when empty. */
export const phoneInput = (typed: string) => (typed.trim() ? typed.trim() : null);

interface LeadFormProps {
  values: LeadFormValues;
  onChange: (next: LeadFormValues) => void;
  /** Set once Save was pressed, so what is missing says so. */
  showMissing: boolean;
  /** What AI read off the shop board: a sparkle beside each field still holding it, "Could not read" under each it could not. */
  read?: ShopBoardReadingDto | null;
}

export function LeadForm({ values, onChange, showMissing, read }: LeadFormProps) {
  const theme = useTheme();
  const { t } = useSession();
  const [choosing, setChoosing] = useState(false);
  const set = <K extends keyof LeadFormValues>(key: K, value: LeadFormValues[K]) => onChange({ ...values, [key]: value });
  const problems = leadFormProblems(values);

  /** The sparkles beside a field while it still holds what AI read. */
  const mark = (readValue: string | null | undefined, current: string) =>
    read && readValue && current.trim() === readValue ? <AiMark label={t('ai.filledCheck')} /> : null;
  /** Under a field AI could not read, while it is still empty. */
  const unread = (readValue: string | null | undefined, current: string) => (read && !readValue && !current.trim() ? t('ai.couldNotRead') : null);
  const phoneRead = read?.phone ? read.phone.replace(/^\+91/, '') : null;
  const phoneMark = read?.phone && normalizePhone(values.phone) === read.phone ? <AiMark label={t('ai.filledCheck')} /> : null;
  const phoneHint =
    read && read.otherPhones.length > 0
      ? t('bde.form.otherPhones', { numbers: read.otherPhones.join(', ') })
      : (unread(phoneRead, values.phone) ?? t('bde.form.phoneHint'));

  return (
    <View style={styles.form}>
      <TextField
        label={t('bde.form.name')}
        labelMark={mark(read?.businessName, values.businessName)}
        value={values.businessName}
        onChangeText={(text) => set('businessName', text)}
        maxLength={100}
        autoCapitalize="words"
        hint={unread(read?.businessName, values.businessName)}
        error={showMissing && problems.businessName ? t('bde.form.nameNeeded') : null}
      />
      <TextField
        label={t('bde.form.area')}
        labelMark={mark(read?.area, values.area)}
        value={values.area}
        onChangeText={(text) => set('area', text)}
        maxLength={60}
        autoCapitalize="words"
        placeholder={t('bde.form.areaPlaceholder')}
        hint={unread(read?.area, values.area)}
      />
      <TextField label={t('bde.form.contact')} value={values.contactName} onChangeText={(text) => set('contactName', text)} maxLength={80} autoCapitalize="words" />
      <TextField
        label={t('bde.form.phone')}
        labelMark={phoneMark}
        value={values.phone}
        onChangeText={(text) => set('phone', text)}
        keyboardType="phone-pad"
        inputMode="tel"
        maxLength={16}
        hint={phoneHint}
        error={showMissing && problems.phone ? t('error.phone') : null}
      />

      <View style={styles.inline}>
        <ThemedText type="smallBold" themeColor="textSecondary" style={styles.flex}>
          {t('bde.form.kitchens')}
        </ThemedText>
        <Stepper
          value={values.kitchens}
          min={1}
          max={200}
          label={t('bde.form.kitchens')}
          onChange={(next) => set('kitchens', next)}
          less={t('bde.form.fewer')}
          more={t('bde.form.more')}
          color={theme.primary}
          background={theme.backgroundElement}
        />
      </View>

      {/* One line that opens the list, as the app's branch chooser does: seven chips took four rows. It is drawn
          as the text boxes around it are (their label, fill, edge and size of words), with the arrow that says it
          opens a list, so the form has one look for its fields (Material 3's exposed dropdown menu: a text field
          that opens a menu). */}
      <View style={styles.field}>
        <ThemedText type="smallBold" themeColor="textSecondary">
          {t('bde.form.source')}
        </ThemedText>
        <Pressable
          accessibilityRole="button"
          accessibilityLabel={`${t('bde.form.source')}: ${t(`bde.source.${values.source}`)}`}
          onPress={() => setChoosing(true)}
          style={({ pressed }) => [
            styles.chooser,
            { borderColor: theme.outline, backgroundColor: pressed ? theme.backgroundSelected : theme.backgroundElement },
          ]}>
          <ThemedText type="default" numberOfLines={1} style={styles.chooserText}>
            {t(`bde.source.${values.source}`)}
          </ThemedText>
          <Ionicons name="chevron-down" size={22} color={theme.textSecondary} />
        </Pressable>
      </View>
      <OptionSheet
        visible={choosing}
        title={t('bde.form.source')}
        onClose={() => setChoosing(false)}
        options={LEAD_SOURCES.map((source) => ({
          label: t(`bde.source.${source}`),
          icon: source === values.source ? ('radio-button-on' as const) : ('radio-button-off' as const),
          onPress: () => {
            setChoosing(false);
            set('source', source);
          },
        }))}
      />
      {isReferral(values.source) && (
        <TextField label={t('bde.form.referrer')} value={values.referrerName} onChangeText={(text) => set('referrerName', text)} maxLength={80} autoCapitalize="words" />
      )}

      <TextField
        label={t('bde.form.address')}
        labelMark={mark(read?.address, values.address)}
        value={values.address}
        onChangeText={(text) => set('address', text)}
        maxLength={200}
        multiline
        hint={unread(read?.address, values.address)}
      />
    </View>
  );
}

/** A number changed with − and +, big enough for a thumb. */
export function Stepper({
  value,
  min,
  max,
  label,
  onChange,
  less,
  more,
  color,
  background,
}: {
  value: number;
  min: number;
  max: number;
  label: string;
  onChange: (next: number) => void;
  less: string;
  more: string;
  color: string;
  background: string;
}) {
  const button = (icon: 'remove' | 'add', accessibilityLabel: string, next: number, disabled: boolean) => (
    <Pressable
      accessibilityRole="button"
      accessibilityLabel={accessibilityLabel}
      disabled={disabled}
      onPress={() => onChange(next)}
      style={[styles.stepButton, { backgroundColor: background, opacity: disabled ? 0.4 : 1 }]}>
      <Ionicons name={icon} size={24} color={color} />
    </Pressable>
  );
  return (
    // Numbers and their − and + read the same way round in every language.
    <View style={styles.stepper} accessibilityLabel={`${label}: ${value}`}>
      {button('remove', less, Math.max(min, value - 1), value <= min)}
      <ThemedText type="default" style={styles.stepValue}>
        {value}
      </ThemedText>
      {button('add', more, Math.min(max, value + 1), value >= max)}
    </View>
  );
}

const styles = StyleSheet.create({
  form: { gap: Spacing.three },
  flex: { flex: 1 },
  inline: { flexDirection: 'row', alignItems: 'center', gap: Spacing.two },
  // As components/ui/text-field: label 8 above, a 1 edge in the outline colour on the grey fill, words at 20.
  field: { gap: Spacing.two },
  chooser: { flexDirection: 'row', alignItems: 'center', gap: Spacing.two, minHeight: MinTouchSize, borderWidth: 1, borderRadius: Spacing.three, paddingHorizontal: Spacing.three },
  chooserText: { flex: 1, fontSize: 20, lineHeight: 30, fontWeight: 400 },
  stepper: { flexDirection: 'row', alignItems: 'center', gap: Spacing.two },
  stepButton: { width: MinTouchSize, height: MinTouchSize, borderRadius: Spacing.three, alignItems: 'center', justifyContent: 'center' },
  stepValue: { minWidth: 36, textAlign: 'center', fontWeight: 700, fontSize: 20 },
});
