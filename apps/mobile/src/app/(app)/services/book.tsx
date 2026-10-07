import { localize, VISIT_SLOT_PERIODS, type ServiceCatalogItemDto, type VisitSlot } from '@eccs/shared';
import Ionicons from '@expo/vector-icons/Ionicons';
import { router } from 'expo-router';
import { useEffect, useRef, useState, type ReactNode } from 'react';
import { ActivityIndicator, Pressable, ScrollView, StyleSheet, View } from 'react-native';

import { ThemedText } from '@/components/themed-text';
import { Button } from '@/components/ui/button';
import { ErrorText } from '@/components/ui/error-text';
import { OptionChip } from '@/components/ui/option-chip';
import { Screen } from '@/components/ui/screen';
import { useSnackbar } from '@/components/ui/snackbar';
import { TextField } from '@/components/ui/text-field';
import { MinTouchSize, Spacing } from '@/constants/theme';
import { useTheme } from '@/hooks/use-theme';
import { errorMessage } from '@/lib/errors';
import {
  addDays,
  dayParts,
  formatDayLong,
  formatDayShort,
  formatDuration,
  formatRupees,
  formatSlot,
  indiaToday,
} from '@/lib/format';
import { useSession } from '@/lib/session';
import { useOutlet } from '@/lib/use-outlet';

// The days offered, starting tomorrow. ECCS needs at least a day's notice.
const DAYS_OFFERED = 14;

/** The choices a request needs, in the order they appear on the screen. */
type Step = 'outlet' | 'service' | 'date' | 'slot';

/**
 * Booking a one-time service: pick it from the priced catalogue, then the
 * day and time of day. ECCS confirms the visit afterwards.
 */
export default function BookServiceScreen() {
  const theme = useTheme();
  const { t, api, language } = useSession();
  const notify = useSnackbar();
  const { outletId, outlets, choose } = useOutlet();

  const [catalog, setCatalog] = useState<ServiceCatalogItemDto[] | null>(null);
  const [itemId, setItemId] = useState<string | null>(null);
  const [date, setDate] = useState<string | null>(null);
  const [slot, setSlot] = useState<VisitSlot | null>(null);
  const [notes, setNotes] = useState('');
  const [sending, setSending] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [catalogError, setCatalogError] = useState<string | null>(null);
  /** Counts the tries at loading the catalogue; "Try again" adds one, which loads it again. */
  const [attempt, setAttempt] = useState(0);
  /** The first choice Send found missing, so it can be pointed out. */
  const [missing, setMissing] = useState<Step | null>(null);

  const scrollRef = useRef<ScrollView>(null);
  /** How far down the page each choice sits, for scrolling to it. */
  const positions = useRef<Partial<Record<Step, number>>>({});

  useEffect(() => {
    let cancelled = false;
    api.services
      .catalog()
      .then((items) => {
        if (cancelled) return;
        setCatalog(items);
        setCatalogError(null);
      })
      .catch((e) => !cancelled && setCatalogError(errorMessage(e, t)));
    return () => {
      cancelled = true;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [api, attempt]);

  /** Send is always pressable: if a choice is missing it says which and goes to it. */
  async function send() {
    const lacking: Step | null = !outletId ? 'outlet' : !itemId ? 'service' : !date ? 'date' : !slot ? 'slot' : null;
    setMissing(lacking);
    if (lacking) {
      const y = positions.current[lacking];
      if (y !== undefined) scrollRef.current?.scrollTo({ y: Math.max(0, y - Spacing.three), animated: true });
      return;
    }
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
      notify(t('svc.requestSent'));
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

  // Each choice is one block, so Send can scroll to it and the "choose this first" line sits under it.
  const section = (step: Step, children: ReactNode) => (
    <View
      style={styles.section}
      onLayout={(event) => {
        positions.current[step] = event.nativeEvent.layout.y;
      }}>
      {children}
    </View>
  );
  const chosen = { outlet: outletId, service: itemId, date, slot };
  const need = (step: Step, message: string) => (
    <ErrorText message={missing === step && !chosen[step] ? message : null} />
  );

  // What is being asked for, in one line above Send, so it can be checked without scrolling back up.
  const picked = catalog?.find((entry) => entry.id === itemId);
  const summary = [
    picked && localize(picked.name, language),
    date && formatDayShort(date, language),
    slot && formatSlot(slot, language, t),
    picked && t('book.price', { price: formatRupees(picked.pricePaise, language) }),
  ]
    .filter(Boolean)
    .join(' · ');

  return (
    <Screen
      back
      title={t('book.title')}
      subtitle={t('book.help')}
      scrollRef={scrollRef}
      footer={
        <>
          <ThemedText type={summary ? 'smallBold' : 'small'} themeColor={summary ? 'text' : 'textSecondary'}>
            {summary || t('book.summaryEmpty')}
          </ThemedText>
          <ErrorText message={error} />
          <Button label={t('book.send')} onPress={() => void send()} loading={sending} />
        </>
      }>
      {outlets.length > 1 &&
        section(
          'outlet',
          <>
            {heading(t('checklists.chooseOutlet'))}
            <View style={styles.options} accessibilityRole="radiogroup">
              {outlets.map((outlet) => (
                <OptionChip
                  key={outlet.id}
                  label={outlet.name}
                  selected={outlet.id === outletId}
                  onPress={() => choose(outlet.id)}
                />
              ))}
            </View>
            {need('outlet', t('book.needOutlet'))}
          </>,
        )}

      {section(
        'service',
        <>
          {heading(t('book.service'))}
          {catalog === null && !catalogError && <ActivityIndicator color={theme.primary} />}
          <ErrorText message={catalogError} onRetry={() => setAttempt((count) => count + 1)} />
          {/* Each service shows its price and how long it takes, so it is a card rather than a one-line chip. */}
          {catalog?.map((item) => {
            const selected = item.id === itemId;
            return (
              <Pressable
                key={item.id}
                accessibilityRole="radio"
                accessibilityState={{ selected, checked: selected }}
                onPress={() => setItemId(item.id)}
                style={[
                  styles.service,
                  { borderColor: selected ? theme.primary : theme.outline },
                  selected && { backgroundColor: theme.backgroundElement },
                ]}>
                <View style={styles.serviceHeader}>
                  {selected && <Ionicons name="checkmark" size={20} color={theme.primary} />}
                  <ThemedText type="default" style={styles.serviceName} themeColor={selected ? 'primary' : 'text'}>
                    {localize(item.name, language)}
                  </ThemedText>
                </View>
                <ThemedText type="default">
                  {t('book.price', { price: formatRupees(item.pricePaise, language) })}
                </ThemedText>
                <ThemedText type="small" themeColor="textSecondary">
                  {t('book.duration', { time: formatDuration(item.durationMinutes, language) })}
                </ThemedText>
              </Pressable>
            );
          })}
          {need('service', t('book.needService'))}
        </>,
      )}

      {section(
        'date',
        <>
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
                  <ThemedText
                    type="default"
                    style={[styles.dayNumber, { color: selected ? theme.onPrimary : theme.text }]}>
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
          {need('date', t('book.needDate'))}
        </>,
      )}

      {section(
        'slot',
        <>
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
          {need('slot', t('book.needSlot'))}
        </>,
      )}

      <TextField
        label={t('book.notes')}
        value={notes}
        onChangeText={setNotes}
        placeholder={t('book.notesPlaceholder')}
        maxLength={500}
        multiline
        style={styles.notes}
      />
    </Screen>
  );
}

const styles = StyleSheet.create({
  options: { flexDirection: 'row', flexWrap: 'wrap', gap: Spacing.two },
  section: { gap: Spacing.three },
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
  serviceHeader: { flexDirection: 'row', alignItems: 'center', gap: Spacing.one },
  serviceName: { flex: 1, fontWeight: 700, fontSize: 18 },
  sectionGap: { marginTop: Spacing.three },
  notes: { minHeight: 90, paddingVertical: Spacing.two, fontSize: 17, textAlignVertical: 'top' },
});
