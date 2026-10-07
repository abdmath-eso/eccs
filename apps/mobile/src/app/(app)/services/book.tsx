import { localize, VISIT_SLOT_PERIODS, type ServiceCatalogItemDto, type VisitSlot } from '@eccs/shared';
import { router } from 'expo-router';
import { useEffect, useState } from 'react';
import { ActivityIndicator, Pressable, ScrollView, StyleSheet, View } from 'react-native';

import { ThemedText } from '@/components/themed-text';
import { Button } from '@/components/ui/button';
import { ErrorText } from '@/components/ui/error-text';
import { Screen } from '@/components/ui/screen';
import { TextField } from '@/components/ui/text-field';
import { MinTouchSize, Spacing } from '@/constants/theme';
import { useTheme } from '@/hooks/use-theme';
import { errorMessage } from '@/lib/errors';
import { addDays, dayParts, formatDayLong, formatDuration, formatRupees, formatSlot, indiaToday } from '@/lib/format';
import { useSession } from '@/lib/session';
import { useOutlet } from '@/lib/use-outlet';

// The days offered, starting tomorrow. ECCS needs at least a day's notice.
const DAYS_OFFERED = 14;

/**
 * Booking a one-time service: pick it from the priced catalogue, then the
 * day and time of day. ECCS confirms the visit afterwards.
 */
export default function BookServiceScreen() {
  const theme = useTheme();
  const { t, api, language } = useSession();
  const { outletId, outlets, choose } = useOutlet();

  const [catalog, setCatalog] = useState<ServiceCatalogItemDto[] | null>(null);
  const [itemId, setItemId] = useState<string | null>(null);
  const [date, setDate] = useState<string | null>(null);
  const [slot, setSlot] = useState<VisitSlot | null>(null);
  const [notes, setNotes] = useState('');
  const [sending, setSending] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    api.services
      .catalog()
      .then((items) => !cancelled && setCatalog(items))
      .catch((e) => !cancelled && setError(errorMessage(e, t)));
    return () => {
      cancelled = true;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [api]);

  async function send() {
    if (!outletId || !itemId || !date || !slot) return;
    setSending(true);
    setError(null);
    try {
      await api.bookings.create({
        outletId,
        catalogItemId: itemId,
        preferredDate: date,
        preferredSlot: slot,
        ...(notes.trim() && { notes: notes.trim() }),
      });
      // Back to Services, which reloads and shows the request as waiting for ECCS.
      if (router.canGoBack()) router.back();
      else router.replace('/services');
    } catch (e) {
      setError(errorMessage(e, t));
      setSending(false);
    }
  }

  const today = indiaToday();
  const days = Array.from({ length: DAYS_OFFERED }, (_, index) => addDays(today, index + 1));
  const option = (selected: boolean) => [
    styles.option,
    { borderColor: selected ? theme.primary : theme.border },
    selected && { backgroundColor: theme.backgroundElement },
  ];
  const slotButton = (value: VisitSlot) => {
    const selected = value === slot;
    return (
      <Pressable
        key={value}
        accessibilityRole="radio"
        accessibilityState={{ selected }}
        onPress={() => setSlot(value)}
        style={[
          styles.slot,
          { borderColor: selected ? theme.primary : theme.border },
          selected && { backgroundColor: theme.primary },
        ]}>
        <ThemedText type="default" style={[styles.slotText, { color: selected ? theme.onPrimary : theme.text }]}>
          {formatSlot(value, language, t)}
        </ThemedText>
      </Pressable>
    );
  };
  const heading = (text: string) => (
    <ThemedText type="smallBold" themeColor="textSecondary" style={styles.sectionGap}>
      {text}
    </ThemedText>
  );

  return (
    <Screen back title={t('book.title')} subtitle={t('book.help')}>
      {outlets.length > 1 && (
        <>
          {heading(t('checklists.chooseOutlet'))}
          <View style={styles.options}>
            {outlets.map((outlet) => (
              <Pressable
                key={outlet.id}
                accessibilityRole="radio"
                accessibilityState={{ selected: outlet.id === outletId }}
                onPress={() => choose(outlet.id)}
                style={option(outlet.id === outletId)}>
                <ThemedText type="default" themeColor={outlet.id === outletId ? 'primary' : 'text'}>
                  {outlet.name}
                </ThemedText>
              </Pressable>
            ))}
          </View>
        </>
      )}

      {heading(t('book.service'))}
      {catalog === null && !error && <ActivityIndicator color={theme.primary} />}
      {catalog?.map((item) => {
        const selected = item.id === itemId;
        return (
          <Pressable
            key={item.id}
            accessibilityRole="radio"
            accessibilityState={{ selected }}
            onPress={() => setItemId(item.id)}
            style={[
              styles.service,
              { borderColor: selected ? theme.primary : theme.border },
              selected && { backgroundColor: theme.backgroundElement },
            ]}>
            <ThemedText type="default" style={styles.serviceName} themeColor={selected ? 'primary' : 'text'}>
              {selected ? '✓ ' : ''}
              {localize(item.name, language)}
            </ThemedText>
            <ThemedText type="default">{t('book.price', { price: formatRupees(item.pricePaise, language) })}</ThemedText>
            <ThemedText type="small" themeColor="textSecondary">
              {t('book.duration', { time: formatDuration(item.durationMinutes, language) })}
            </ThemedText>
          </Pressable>
        );
      })}

      {/* One row of days to swipe through, as booking apps do, instead of a wall of buttons. */}
      {heading(t('book.date'))}
      <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={styles.days}>
        {days.map((day) => {
          const selected = day === date;
          const parts = dayParts(day, language);
          return (
            <Pressable
              key={day}
              accessibilityRole="radio"
              accessibilityState={{ selected }}
              accessibilityLabel={formatDayLong(day, language)}
              onPress={() => setDate(day)}
              style={[
                styles.day,
                { borderColor: selected ? theme.primary : theme.border },
                selected && { backgroundColor: theme.primary },
              ]}>
              <ThemedText type="small" style={{ color: selected ? theme.onPrimary : theme.textSecondary }}>
                {parts.weekday}
              </ThemedText>
              <ThemedText type="default" style={[styles.dayNumber, { color: selected ? theme.onPrimary : theme.text }]}>
                {parts.day}
              </ThemedText>
              <ThemedText type="small" style={{ color: selected ? theme.onPrimary : theme.textSecondary }}>
                {parts.month}
              </ThemedText>
            </Pressable>
          );
        })}
      </ScrollView>
      {date && (
        <ThemedText type="default" themeColor="primary">
          {formatDayLong(date, language)}
        </ThemedText>
      )}

      {/* Two-hour windows in which the team arrives, grouped by part of the day. */}
      {heading(t('book.slot'))}
      {VISIT_SLOT_PERIODS.map(({ period, slots }) => (
        <View key={period} style={styles.period}>
          <ThemedText type="small" themeColor="textSecondary">
            {t(`slot.${period}`)}
          </ThemedText>
          <View style={styles.slots}>{slots.map((value) => slotButton(value))}</View>
        </View>
      ))}
      <View style={styles.slots}>{slotButton('AFTER_CLOSING')}</View>

      <TextField
        label={t('book.notes')}
        value={notes}
        onChangeText={setNotes}
        placeholder={t('book.notesPlaceholder')}
        maxLength={500}
        multiline
        style={styles.notes}
      />

      <ErrorText message={error} />
      <Button
        label={t('book.send')}
        onPress={() => void send()}
        loading={sending}
        disabled={!outletId || !itemId || !date || !slot}
      />
    </Screen>
  );
}

const styles = StyleSheet.create({
  options: { flexDirection: 'row', flexWrap: 'wrap', gap: Spacing.two },
  option: {
    minHeight: MinTouchSize,
    borderWidth: 2,
    borderRadius: Spacing.three,
    paddingHorizontal: Spacing.three,
    justifyContent: 'center',
  },
  days: { gap: Spacing.two, paddingVertical: Spacing.one },
  day: {
    width: 64,
    minHeight: 84,
    borderWidth: 2,
    borderRadius: Spacing.three,
    alignItems: 'center',
    justifyContent: 'center',
    gap: Spacing.half,
  },
  dayNumber: { fontSize: 24, lineHeight: 28, fontWeight: 700 },
  period: { gap: Spacing.one },
  slots: { flexDirection: 'row', gap: Spacing.two },
  slot: {
    flex: 1,
    minHeight: MinTouchSize + Spacing.two,
    borderWidth: 2,
    borderRadius: Spacing.three,
    paddingHorizontal: Spacing.two,
    alignItems: 'center',
    justifyContent: 'center',
  },
  slotText: { fontSize: 18, fontWeight: 700, textAlign: 'center' },
  service: { borderWidth: 2, borderRadius: Spacing.three, padding: Spacing.three, gap: Spacing.one },
  serviceName: { fontWeight: 700, fontSize: 18 },
  sectionGap: { marginTop: Spacing.three },
  notes: { minHeight: 90, paddingVertical: Spacing.two, fontSize: 17, textAlignVertical: 'top' },
});
