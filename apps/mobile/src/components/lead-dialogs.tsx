import { indiaMoment, SALES_RULES } from '@eccs/shared';
import { useState, type ReactNode } from 'react';
import { Modal, ScrollView, StyleSheet, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

import { DirectionView } from '@/components/direction-view';
import { ThemedText } from '@/components/themed-text';
import { Button } from '@/components/ui/button';
import { ErrorText } from '@/components/ui/error-text';
import { OptionChip } from '@/components/ui/option-chip';
import { TextField } from '@/components/ui/text-field';
import { MaxContentWidth, Spacing } from '@/constants/theme';
import { useTheme } from '@/hooks/use-theme';
import { addDays, formatDayShort, formatTime, indiaToday, maskTypedDate, parseTypedDate, toTypedDate } from '@/lib/format';
import { dayWords } from '@/lib/sales';
import { KeyboardDialogFrame } from '@/lib/keyboard';
import { useSession } from '@/lib/session';

// The small forms a step on a lead needs (B2): a note, when a free check is and who goes,
// the next step and when, park until a date and why, lost and why. Each opens over the
// lead page and saves nothing until its button is pressed; the step then goes into the
// outbox at once, so it is kept without signal. Days and times are picked with a tap (the
// next seven days; the usual hours), as calendar apps offer quick choices.

interface SheetProps {
  title: string;
  confirmLabel: string;
  danger?: boolean;
  error?: string | null;
  children: ReactNode;
  onConfirm: () => void;
  onCancel: () => void;
}

/** One small form over the screen, near the top so the keyboard does not cover it. */
export function LeadSheet({ title, confirmLabel, danger, error, children, onConfirm, onCancel }: SheetProps) {
  const theme = useTheme();
  const { t } = useSession();
  // A SafeAreaView inside a Modal does not keep clear of the iPhone's status bar.
  const insets = useSafeAreaInsets();
  return (
    <Modal visible transparent animationType="fade" onRequestClose={onCancel}>
      {/* Shrinks above the keyboard while typing, so the buttons can still be scrolled to. */}
      <KeyboardDialogFrame style={styles.frame}>
        <DirectionView style={[styles.backdrop, { paddingTop: Spacing.five + insets.top }]}>
          <View style={[styles.card, { backgroundColor: theme.backgroundRaised }]}>
            <ScrollView contentContainerStyle={styles.body} keyboardShouldPersistTaps="handled">
              <ThemedText type="default" style={styles.title}>
                {title}
              </ThemedText>
              {children}
              <ErrorText message={error ?? null} />
              <Button label={confirmLabel} variant={danger ? 'danger' : 'primary'} onPress={onConfirm} />
              <Button label={t('common.cancel')} variant="secondary" onPress={onCancel} />
            </ScrollView>
          </View>
        </DirectionView>
      </KeyboardDialogFrame>
    </Modal>
  );
}

const TIMES = ['09:00', '10:00', '11:00', '12:00', '14:00', '15:00', '16:00', '17:00', '18:00'];

/** A day of the next week and an hour, each one tap. */
function WhenPicker({ day, time, onDay, onTime }: { day: string; time: string; onDay: (day: string) => void; onTime: (time: string) => void }) {
  const { t, language } = useSession();
  const today = indiaToday();
  const days = Array.from({ length: 7 }, (_, index) => addDays(today, index));
  return (
    <>
      <ThemedText type="smallBold" themeColor="textSecondary">
        {t('bde.when.day')}
      </ThemedText>
      <View style={styles.chips}>
        {days.map((value, index) => (
          <OptionChip key={value} label={index < 2 ? dayWords(value, t, language) : formatDayShort(value, language)} selected={day === value} onPress={() => onDay(value)} />
        ))}
      </View>
      <ThemedText type="smallBold" themeColor="textSecondary">
        {t('bde.when.time')}
      </ThemedText>
      <View style={styles.chips}>
        {TIMES.map((value) => (
          <OptionChip key={value} label={formatTime(value, language)} selected={time === value} onPress={() => onTime(value)} />
        ))}
      </View>
    </>
  );
}

/** The next whole hour of today that is still to come, or tomorrow at ten. */
function soonest(): { day: string; time: string } {
  const hour = Number(new Intl.DateTimeFormat('en-GB', { timeZone: 'Asia/Kolkata', hour: '2-digit', hour12: false }).format(new Date()));
  const next = TIMES.find((value) => Number(value.slice(0, 2)) > hour);
  return next ? { day: indiaToday(), time: next } : { day: addDays(indiaToday(), 1), time: '10:00' };
}

export function NoteDialog({ onSave, onCancel }: { onSave: (note: string) => void; onCancel: () => void }) {
  const { t } = useSession();
  const [note, setNote] = useState('');
  const [missing, setMissing] = useState(false);
  return (
    <LeadSheet title={t('bde.step.note')} confirmLabel={t('bde.step.save')} onCancel={onCancel} onConfirm={() => (note.trim() ? onSave(note.trim()) : setMissing(true))}>
      <TextField label={t('bde.step.noteLabel')} value={note} onChangeText={setNote} maxLength={200} multiline autoFocus error={missing ? t('bde.step.noteNeeded') : null} />
    </LeadSheet>
  );
}

/** A free check booked: when, and who from ECCS goes. */
export function BookCheckDialog({ onSave, onCancel }: { onSave: (input: { checkAt: string; checkWith: string | null }) => void; onCancel: () => void }) {
  const { t } = useSession();
  const first = soonest();
  const [day, setDay] = useState(first.day);
  const [time, setTime] = useState(first.time);
  const [who, setWho] = useState('');
  return (
    <LeadSheet
      title={t('bde.step.bookCheck')}
      confirmLabel={t('bde.step.book')}
      onCancel={onCancel}
      onConfirm={() => onSave({ checkAt: indiaMoment(day, time).toISOString(), checkWith: who.trim() || null })}>
      <WhenPicker day={day} time={time} onDay={setDay} onTime={setTime} />
      <TextField label={t('bde.step.checkWith')} value={who} onChangeText={setWho} maxLength={40} autoCapitalize="words" />
    </LeadSheet>
  );
}

/** The next step and when, as the lead's next action. */
export function NextStepDialog({ current, onSave, onCancel }: { current: string | null; onSave: (input: { nextAction: string; nextActionAt: string }) => void; onCancel: () => void }) {
  const { t } = useSession();
  const first = soonest();
  const [what, setWhat] = useState(current && current !== 'Next step' ? current : '');
  const [day, setDay] = useState(first.day);
  const [time, setTime] = useState(first.time);
  const [missing, setMissing] = useState(false);
  const quick = [t('bde.next.callBack'), t('bde.next.visit'), t('bde.next.followQuote')];
  return (
    <LeadSheet
      title={t('bde.step.next')}
      confirmLabel={t('bde.step.save')}
      onCancel={onCancel}
      onConfirm={() => (what.trim() ? onSave({ nextAction: what.trim(), nextActionAt: indiaMoment(day, time).toISOString() }) : setMissing(true))}>
      <View style={styles.chips}>
        {quick.map((value) => (
          <OptionChip key={value} label={value} selected={what === value} onPress={() => setWhat(value)} />
        ))}
      </View>
      <TextField label={t('bde.step.nextLabel')} value={what} onChangeText={setWhat} maxLength={80} error={missing ? t('bde.step.nextNeeded') : null} />
      <WhenPicker day={day} time={time} onDay={setDay} onTime={setTime} />
    </LeadSheet>
  );
}

/** Park until a date, with the reason in a few words ("after Diwali"). */
export function ParkDialog({ onSave, onCancel }: { onSave: (input: { until: string; reason: string }) => void; onCancel: () => void }) {
  const { t, language } = useSession();
  const today = indiaToday();
  const [typed, setTyped] = useState(toTypedDate(addDays(today, 14)));
  const [reason, setReason] = useState('');
  const [problem, setProblem] = useState<string | null>(null);
  const until = typed.replace(/\D/g, '').length === 8 ? parseTypedDate(typed) : null;
  const quick = [
    [7, 'bde.park.week'],
    [14, 'bde.park.twoWeeks'],
    [30, 'bde.park.month'],
    [90, 'bde.park.threeMonths'],
  ] as const;
  function save() {
    if (!until || until <= today || until > addDays(today, SALES_RULES.parkMaxDays)) return setProblem(t('bde.step.parkDate'));
    if (!reason.trim()) return setProblem(t('bde.step.reasonNeeded'));
    onSave({ until, reason: reason.trim() });
  }
  return (
    <LeadSheet title={t('bde.step.park')} confirmLabel={t('bde.step.parkSave')} error={problem} onCancel={onCancel} onConfirm={save}>
      <View style={styles.chips}>
        {quick.map(([days, key]) => {
          const value = addDays(today, days);
          return <OptionChip key={days} label={t(key)} selected={until === value} onPress={() => setTyped(toTypedDate(value))} />;
        })}
      </View>
      <TextField
        label={t('bde.step.parkUntil')}
        value={typed}
        onChangeText={(next) => setTyped((current) => maskTypedDate(next, current))}
        placeholder={t('docs.datePlaceholder')}
        keyboardType="number-pad"
        inputMode="numeric"
        maxLength={10}
        hint={until ? `✓ ${dayWords(until, t, language)}` : null}
      />
      <TextField label={t('bde.step.parkReason')} value={reason} onChangeText={setReason} maxLength={60} placeholder={t('bde.step.parkReasonPlaceholder')} />
    </LeadSheet>
  );
}

/** Lost, with the reason: a few quick ones, or typed. */
export function LoseDialog({ onSave, onCancel }: { onSave: (reason: string) => void; onCancel: () => void }) {
  const { t } = useSession();
  const [reason, setReason] = useState('');
  const [missing, setMissing] = useState(false);
  const quick = [t('bde.lost.price'), t('bde.lost.vendor'), t('bde.lost.closed'), t('bde.lost.notInterested')];
  return (
    <LeadSheet title={t('bde.step.lost')} confirmLabel={t('bde.step.lostSave')} danger onCancel={onCancel} onConfirm={() => (reason.trim() ? onSave(reason.trim()) : setMissing(true))}>
      <View style={styles.chips}>
        {quick.map((value) => (
          <OptionChip key={value} label={value} selected={reason === value} onPress={() => setReason(value)} />
        ))}
      </View>
      <TextField label={t('bde.step.lostReason')} value={reason} onChangeText={setReason} maxLength={100} error={missing ? t('bde.step.reasonNeeded') : null} />
    </LeadSheet>
  );
}

const styles = StyleSheet.create({
  frame: { flex: 1 },
  backdrop: { flex: 1, backgroundColor: 'rgba(0,0,0,0.5)', alignItems: 'center', justifyContent: 'flex-start', padding: Spacing.three },
  card: { width: '100%', maxWidth: MaxContentWidth - Spacing.four, maxHeight: '92%', borderRadius: Spacing.four },
  body: { padding: Spacing.four, gap: Spacing.three },
  title: { fontWeight: 700, fontSize: 18 },
  chips: { flexDirection: 'row', flexWrap: 'wrap', gap: Spacing.two },
});
