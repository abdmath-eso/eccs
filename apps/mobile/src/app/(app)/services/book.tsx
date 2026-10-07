import { localize, VISIT_SLOTS, type ServiceCatalogItemDto, type VisitSlot } from '@eccs/shared';
import { router } from 'expo-router';
import { useEffect, useState } from 'react';
import { ActivityIndicator, Pressable, StyleSheet, View } from 'react-native';

import { ThemedText } from '@/components/themed-text';
import { Button } from '@/components/ui/button';
import { ErrorText } from '@/components/ui/error-text';
import { Screen } from '@/components/ui/screen';
import { TextField } from '@/components/ui/text-field';
import { MinTouchSize, Spacing } from '@/constants/theme';
import { useTheme } from '@/hooks/use-theme';
import { errorMessage } from '@/lib/errors';
import { addDays, formatDayShort, formatDuration, formatRupees, indiaToday } from '@/lib/format';
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

      {heading(t('book.date'))}
      <View style={styles.options}>
        {days.map((day) => (
          <Pressable
            key={day}
            accessibilityRole="radio"
            accessibilityState={{ selected: day === date }}
            onPress={() => setDate(day)}
            style={option(day === date)}>
            <ThemedText type="default" themeColor={day === date ? 'primary' : 'text'}>
              {formatDayShort(day, language)}
            </ThemedText>
          </Pressable>
        ))}
      </View>

      {heading(t('book.slot'))}
      <View style={styles.options}>
        {VISIT_SLOTS.map((value) => (
          <Pressable
            key={value}
            accessibilityRole="radio"
            accessibilityState={{ selected: value === slot }}
            onPress={() => setSlot(value)}
            style={option(value === slot)}>
            <ThemedText type="default" themeColor={value === slot ? 'primary' : 'text'}>
              {t(`slot.${value}`)}
            </ThemedText>
          </Pressable>
        ))}
      </View>

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
  service: { borderWidth: 2, borderRadius: Spacing.three, padding: Spacing.three, gap: Spacing.one },
  serviceName: { fontWeight: 700, fontSize: 18 },
  sectionGap: { marginTop: Spacing.three },
  notes: { minHeight: 90, paddingVertical: Spacing.two, fontSize: 17, textAlignVertical: 'top' },
});
