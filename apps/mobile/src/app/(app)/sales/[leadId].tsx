import Ionicons from '@expo/vector-icons/Ionicons';
import type { LeadActivityDto, LeadDetailDto } from '@eccs/shared';
import { router, useFocusEffect, useLocalSearchParams } from 'expo-router';
import { useCallback, useState, type ComponentProps } from 'react';
import { ActivityIndicator, StyleSheet, View } from 'react-native';

import { HeldNotice, SavedCopyNote } from '@/components/field-sync-parts';
import { BookCheckDialog, LoseDialog, NextStepDialog, NoteDialog, ParkDialog } from '@/components/lead-dialogs';
import { LeadPhoto, StageTag } from '@/components/lead-parts';
import { ThemedText } from '@/components/themed-text';
import { Button } from '@/components/ui/button';
import { Card } from '@/components/ui/card';
import { ErrorText } from '@/components/ui/error-text';
import { Notice } from '@/components/ui/notice';
import { OptionSheet, type SheetOption } from '@/components/ui/option-sheet';
import { Screen } from '@/components/ui/screen';
import { useSnackbar } from '@/components/ui/snackbar';
import { UnsentMark } from '@/components/unsent-mark';
import { Spacing } from '@/constants/theme';
import { useTheme } from '@/hooks/use-theme';
import { ltrText } from '@/lib/direction';
import { formatDate, formatPhone } from '@/lib/format';
import { activityWords, callLead, momentWords, nextStepWords, queueLose, queuePark, queueStep, queueUpdate, staleWords, todoLine } from '@/lib/sales';
import { useSession } from '@/lib/session';
import { useLead } from '@/lib/use-leads';

type IconName = ComponentProps<typeof Ionicons>['name'];
type Dialog = 'note' | 'check' | 'next' | 'park' | 'lose';
type Step = { label: string; icon: IconName; run: () => void };

const ACTIVITY_ICONS: Partial<Record<LeadActivityDto['kind'], IconName>> = {
  CREATED: 'add-circle-outline',
  CALL: 'call-outline',
  VISIT: 'walk-outline',
  NOTE: 'create-outline',
  CHECK_BOOKED: 'calendar-outline',
  CHECK_DONE: 'clipboard-outline',
  QUOTE_SENT: 'document-text-outline',
  QUOTE_OPENED: 'eye-outline',
  PARKED: 'pause-circle-outline',
  LOST: 'close-circle-outline',
  WON: 'trophy-outline',
};

/**
 * One lead (B2): the photo of the shop board, where it stands, what is due, and the
 * steps as one-tap actions: Call (opens the dialler and logs the call), Visited and Note
 * in one row; the step that usually comes next as the main button (book a free check,
 * do it, send the quote); the rest under "More steps". Then the next step, the details
 * and the timeline. Every step is saved on the phone first and sent through the outbox,
 * so it works without signal; the stage moves by itself, by the server's own rule.
 *
 * PATTERN FOLLOWED: Pipedrive's deal page on the phone (the stage at the top, the next
 * activity first, call, note and activity in reach, the history below; calls made from
 * the app logged on the deal: support.pipedrive.com, "Calling and logging calls in the
 * mobile app"), and Salesforce Maps' one-tap check-in on a visit (trailhead.salesforce.com).
 * The contact's details are a summary list, each with its label over it (GOV.UK Design System's
 * summary list, stacked on a phone), so the phone number is a line of its own.
 */
export default function LeadScreen() {
  const { leadId, do: asked } = useLocalSearchParams<{ leadId: string; do?: string }>();
  const theme = useTheme();
  const { t, language } = useSession();
  const notify = useSnackbar();
  const { view, saved, error, load, hasSignal } = useLead(leadId);
  const [dialog, setDialog] = useState<Dialog | null>(asked === 'park' ? 'park' : null);
  const [moreOpen, setMoreOpen] = useState(false);
  const [problem, setProblem] = useState<string | null>(null);

  useFocusEffect(
    useCallback(() => {
      void load();
    }, [load]),
  );

  if (!view) {
    return (
      <Screen back backLabel={t('bde.tab.leads')} onRefresh={load}>
        <ErrorText message={error} onRetry={() => void load()} />
        {!error && <ActivityIndicator color={theme.primary} />}
      </Screen>
    );
  }
  const lead = view.lead;

  /** Saves a step on the phone (it is sent by the outbox) and says so; the phone refusing to store it is the only failure. */
  async function run(work: () => Promise<unknown>, done = t('bde.logged')) {
    setProblem(null);
    setDialog(null);
    try {
      await work();
      notify(done);
    } catch {
      setProblem(t('bde.form.notStored'));
    }
  }

  const openQuote = (plan?: boolean) => router.push({ pathname: '/sales/quote', params: { leadId: lead.id, ...(plan && { plan: '1' }) } });
  const steps: Record<'check' | 'checkDone' | 'quote' | 'plan' | 'next' | 'park' | 'lose' | 'edit', Step> = {
    check: { label: t('bde.step.bookCheck'), icon: 'calendar-outline', run: () => setDialog('check') },
    checkDone: { label: t('bde.step.checkDone'), icon: 'clipboard-outline', run: () => router.push({ pathname: '/sales/check', params: { leadId: lead.id } }) },
    quote: { label: t('bde.step.quote'), icon: 'document-text-outline', run: () => openQuote() },
    plan: { label: t('bde.action.SEND_PLAN'), icon: 'repeat-outline', run: () => openQuote(true) },
    next: { label: t('bde.step.next'), icon: 'alarm-outline', run: () => setDialog('next') },
    park: { label: t('bde.step.park'), icon: 'pause-circle-outline', run: () => setDialog('park') },
    lose: { label: t('bde.step.lost'), icon: 'close-circle-outline', run: () => setDialog('lose') },
    edit: { label: t('bde.step.edit'), icon: 'create-outline', run: () => router.push({ pathname: '/sales/edit', params: { leadId: lead.id } }) },
  };
  // The step that usually comes next at this stage, as the main button.
  const mainKey = lead.status === 'LOST' ? null : primaryStep(lead);
  const others = (['check', 'checkDone', 'quote', 'next', 'park', 'lose', 'edit'] as const)
    .filter((key) => key !== mainKey && !(key === 'park' && lead.status === 'PARKED') && !(key === 'lose' && lead.status === 'LOST'))
    .map((key): SheetOption => ({ label: steps[key].label, icon: steps[key].icon, danger: key === 'lose', onPress: () => {
      setMoreOpen(false);
      steps[key].run();
    } }));

  const next = nextStepWords(lead, t, language);
  // The lead's details, each under its own label (the same labels as on Change details).
  const details: [string, string | null][] = [
    [t('bde.form.contact'), lead.contactName],
    // Digits kept left to right in Urdu, so the groups of the number do not swap places.
    [t('bde.form.phone'), lead.contactPhone ? ltrText(formatPhone(lead.contactPhone)) : null],
    [t('bde.form.kitchens'), String(lead.kitchens)],
    [t('bde.form.source'), `${t(`bde.source.${lead.source}`)}${lead.referrerName ? ` · ${lead.referrerName}` : ''}`],
    [t('bde.form.address'), lead.address],
  ];

  return (
    <Screen back backLabel={t('bde.tab.leads')} onRefresh={load}>
      {view.held > 0 && view.holdReason && <HeldNotice subject="lead" subjectId={lead.id} reason={view.holdReason} count={view.held} />}
      <ErrorText message={error} onRetry={() => void load()} />
      {!hasSignal && saved && <SavedCopyNote at={saved.at} />}

      {/* The name and stage, with the shop board's photo small beside them (it opens full size): the steps come right after. */}
      <View style={styles.headRow}>
        <View style={[styles.head, styles.flex]}>
          <ThemedText type="subtitle" style={styles.name}>
            {lead.businessName}
          </ThemedText>
          <View style={styles.row}>
            <StageTag stage={lead.stage} status={lead.status} />
            {lead.area && (
              <ThemedText type="small" themeColor="textSecondary">
                {lead.area}
              </ThemedText>
            )}
          </View>
        </View>
        <LeadPhoto photo={lead.photo} small />
      </View>
      {view.unsent > 0 && <UnsentMark sending={hasSignal} text={view.isNew ? t('bde.newOnPhone') : undefined} />}

      {/* What needs doing, or why it is waiting, before anything else. */}
      {lead.toDo ? (
        <Notice tone={lead.toDo.bucket === 'OVERDUE' ? 'danger' : 'info'} text={todoLine(lead.toDo, t, language)} />
      ) : lead.stale ? (
        <Notice tone="danger" text={staleWords(lead.stale, t, language)} />
      ) : null}
      {lead.status === 'PARKED' && (
        <ThemedText type="small" themeColor="warning">
          {t('bde.parkedUntil', { date: lead.parkedUntil ? formatDate(lead.parkedUntil, language) : '' })}
          {lead.parkedReason ? ` · “${lead.parkedReason}”` : ''}
        </ThemedText>
      )}
      {lead.status === 'LOST' && (
        <ThemedText type="small" themeColor="danger">
          {t('bde.lostBecause', { reason: lead.lostReason ?? '' })}
        </ThemedText>
      )}

      <View style={styles.actions}>
        {lead.contactPhone && (
          <View style={styles.flex}>
            {/* Tonal: the lead's next main step below is the one filled button (Material 3). */}
            <Button fill icon="call" label={t('bde.step.call')} variant="tonal" onPress={() => void run(() => callLead(lead), t('bde.callLogged'))} />
          </View>
        )}
        <View style={styles.flex}>
          <Button fill icon="walk" label={t('bde.step.visited')} variant="secondary" onPress={() => void run(() => queueStep(lead.id, { kind: 'VISIT' }))} />
        </View>
        <View style={styles.flex}>
          <Button fill icon="create" label={t('bde.step.note')} variant="secondary" onPress={() => setDialog('note')} />
        </View>
      </View>
      {mainKey && <Button icon={steps[mainKey].icon} label={steps[mainKey].label} onPress={steps[mainKey].run} />}
      <Button icon="ellipsis-horizontal" label={t('bde.step.more')} variant="secondary" onPress={() => setMoreOpen(true)} />
      <ErrorText message={problem} />

      <Card onPress={() => setDialog('next')} accessibilityLabel={`${t('bde.next.title')}: ${next ?? t('bde.next.none')}. ${t('bde.change')}`}>
        <View style={styles.line}>
          <Ionicons name="alarm-outline" size={22} color={theme.primary} />
          <View style={styles.flex}>
            <ThemedText type="smallBold" themeColor="textSecondary">
              {t('bde.next.title')}
            </ThemedText>
            <ThemedText type="default">{next ?? t('bde.next.none')}</ThemedText>
          </View>
          <ThemedText type="smallBold" themeColor="primary">
            {t('bde.change')}
          </ThemedText>
        </View>
      </Card>

      <Card>
        {details.map(([label, value]) =>
          value ? (
            <View key={label} style={styles.detail}>
              <ThemedText type="small" themeColor="textSecondary">
                {label}
              </ThemedText>
              <ThemedText type="default">{value}</ThemedText>
            </View>
          ) : null,
        )}
        <Button variant="link" align="start" icon="create-outline" label={t('bde.step.edit')} onPress={steps.edit.run} />
      </Card>

      <ThemedText type="smallBold" themeColor="textSecondary" style={styles.sectionGap}>
        {t('bde.timeline')}
      </ThemedText>
      {lead.activities.map((entry) => (
        <TimelineEntry key={entry.id} entry={entry} unsent={view.unsentActivities.has(entry.id)} sending={hasSignal} />
      ))}

      <OptionSheet visible={moreOpen} title={lead.businessName} options={others} onClose={() => setMoreOpen(false)} />
      {dialog === 'note' && <NoteDialog onCancel={() => setDialog(null)} onSave={(note) => void run(() => queueStep(lead.id, { kind: 'NOTE', note }))} />}
      {dialog === 'check' && (
        <BookCheckDialog onCancel={() => setDialog(null)} onSave={(input) => void run(() => queueStep(lead.id, { kind: 'CHECK_BOOKED', ...input }))} />
      )}
      {dialog === 'next' && (
        <NextStepDialog current={lead.nextAction} onCancel={() => setDialog(null)} onSave={(input) => void run(() => queueUpdate(lead.id, input), t('common.saved'))} />
      )}
      {dialog === 'park' && (
        <ParkDialog onCancel={() => setDialog(null)} onSave={(input) => void run(() => queuePark(lead.id, input.until, input.reason), t('bde.parked'))} />
      )}
      {dialog === 'lose' && <LoseDialog onCancel={() => setDialog(null)} onSave={(reason) => void run(() => queueLose(lead.id, reason), t('bde.markedLost'))} />}
    </Screen>
  );
}

/** Steps whose own words already name the stage they move a lead to. */
const STAGE_IN_WORDS: readonly LeadActivityDto['kind'][] = ['CHECK_BOOKED', 'CHECK_DONE', 'QUOTE_SENT'];

/** The step that usually comes next at a lead's stage. */
function primaryStep(lead: Pick<LeadDetailDto, 'stage'>): 'check' | 'checkDone' | 'quote' | 'plan' | 'next' {
  switch (lead.stage) {
    case 'NEW':
    case 'CONTACTED':
      return 'check';
    case 'CHECK_BOOKED':
      return 'checkDone';
    case 'CHECK_DONE':
      return 'quote';
    case 'FIRST_JOB':
      return 'plan';
    default:
      return 'next';
  }
}


/** One thing that happened, with who and when; a free check with what needs fixing and its photos. */
function TimelineEntry({ entry, unsent, sending }: { entry: LeadActivityDto; unsent: boolean; sending: boolean }) {
  const theme = useTheme();
  const { t, language } = useSession();
  const toFix = entry.scorecard?.answers.filter((answer) => answer.answer === 'FIX') ?? [];
  return (
    <View style={[styles.entry, { borderColor: theme.border }]}>
      <Ionicons name={ACTIVITY_ICONS[entry.kind] ?? 'ellipse-outline'} size={20} color={theme.textSecondary} />
      <View style={styles.entryText}>
        <ThemedText type="default" style={styles.entryTitle}>
          {activityWords(entry, t, language)}
          {/* Where it moved the lead, unless the step's own words already say so (a free check booked or done, a quote sent). */}
          {entry.toStage && !STAGE_IN_WORDS.includes(entry.kind) ? ` · ${t('bde.movedTo', { stage: t(`bde.stage.${entry.toStage}`) })}` : ''}
        </ThemedText>
        {entry.note && entry.kind !== 'PARKED' && entry.kind !== 'LOST' ? <ThemedText type="small">{entry.note}</ThemedText> : null}
        {(entry.kind === 'PARKED' || entry.kind === 'LOST') && entry.note ? <ThemedText type="small">“{entry.note}”</ThemedText> : null}
        {toFix.map((answer) => (
          <View key={answer.point} style={styles.fix}>
            <ThemedText type="small" style={styles.flex}>
              • {t(`bde.check.point.${answer.point}`)}: {t(`bde.check.fix.${answer.point}`)}
            </ThemedText>
            <LeadPhoto photo={answer.photo} small />
          </View>
        ))}
        <ThemedText type="small" themeColor="textSecondary">
          {[momentWords(entry.at, t, language), entry.byName ?? (entry.kind === 'QUOTE_OPENED' ? t('bde.byOwner') : null)].filter(Boolean).join(' · ')}
        </ThemedText>
        {unsent && <UnsentMark sending={sending} />}
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  head: { gap: Spacing.one },
  headRow: { flexDirection: 'row', alignItems: 'flex-start', gap: Spacing.three },
  name: { fontSize: 24, lineHeight: 30 },
  row: { flexDirection: 'row', alignItems: 'center', flexWrap: 'wrap', gap: Spacing.two },
  flex: { flex: 1 },
  actions: { flexDirection: 'row', gap: Spacing.two },
  line: { flexDirection: 'row', alignItems: 'center', gap: Spacing.three },
  detail: { gap: Spacing.half },
  sectionGap: { marginTop: Spacing.two },
  entry: { flexDirection: 'row', gap: Spacing.two, borderBottomWidth: 1, paddingBottom: Spacing.two },
  entryText: { flex: 1, gap: Spacing.half },
  entryTitle: { fontWeight: 600 },
  fix: { flexDirection: 'row', alignItems: 'center', gap: Spacing.two },
});
