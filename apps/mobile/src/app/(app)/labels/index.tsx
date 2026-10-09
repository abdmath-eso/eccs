import Ionicons from '@expo/vector-icons/Ionicons';
import { formatLabelMoment, indiaWeekday, type DiscardReason, type FoodLabelBoardDto, type FoodLabelDto } from '@eccs/shared';
import { router, useFocusEffect } from 'expo-router';
import { useCallback, useState, type ComponentProps } from 'react';
import { ActivityIndicator, StyleSheet, View } from 'react-native';

import { DayMark } from '@/components/food-label';
import { LabelPrintSheet } from '@/components/label-print-sheet';
import { ThemedText } from '@/components/themed-text';
import { Button } from '@/components/ui/button';
import { ErrorText } from '@/components/ui/error-text';
import { OptionChip } from '@/components/ui/option-chip';
import { OptionSheet } from '@/components/ui/option-sheet';
import { Screen } from '@/components/ui/screen';
import { useSnackbar } from '@/components/ui/snackbar';
import { Spacing } from '@/constants/theme';
import { useTheme } from '@/hooks/use-theme';
import { errorMessage } from '@/lib/errors';
import { recallLabelSize, type PrintJob, type PrintOutcome } from '@/lib/label-print';
import { queuedLabels, sendQueuedLabels } from '@/lib/label-queue';
import { labelPrintData } from '@/lib/labels';
import { isNoSignal } from '@/lib/offline/outbox';
import { useSession } from '@/lib/session';
import { useOutlet } from '@/lib/use-outlet';

type IconName = ComponentProps<typeof Ionicons>['name'];
type Group = 'expired' | 'today' | 'later';

// Each group has its own icon and heading as well as its colour.
const GROUP_ICON: Record<Group, IconName> = { expired: 'alert-circle', today: 'time', later: 'calendar-outline' };
const DISCARD_ICON: Record<DiscardReason, IconName> = { EXPIRED: 'time-outline', SPOILED: 'warning-outline', OTHER: 'ellipsis-horizontal' };
const DISCARD_ORDER: DiscardReason[] = ['EXPIRED', 'SPOILED', 'OTHER'];

/**
 * Food labels: what is in the fridge now. Every label that has been made
 * stays here until someone marks the food used up or thrown away, grouped as
 * past its use-by, to use today, and later. The button at the bottom makes a
 * new label. For the Owner, the Manager and the Head Chef.
 */
export default function FoodLabelsScreen() {
  const theme = useTheme();
  const notify = useSnackbar();
  const { t, api, language, user } = useSession();
  const { outletId, outlets, loading: outletLoading, choose } = useOutlet();

  const [board, setBoard] = useState<FoodLabelBoardDto | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [waiting, setWaiting] = useState(0);
  // The label being marked, the one being thrown away (its reasons are showing), and the last one marked.
  const [busy, setBusy] = useState<string | null>(null);
  const [discarding, setDiscarding] = useState<FoodLabelDto | null>(null);
  const [lastClosed, setLastClosed] = useState<FoodLabelDto | null>(null);
  const [failed, setFailed] = useState<{ id: string; message: string } | null>(null);
  const [printing, setPrinting] = useState<{ job: PrintJob; labelId: string } | null>(null);

  const role = user?.memberships[0]?.role;
  const manages = role === 'OWNER' || role === 'MANAGER';
  const userId = user?.id;

  const load = useCallback(async () => {
    if (!outletId || !userId) return;
    try {
      // Labels made without signal go up first, so they are on the list that comes back.
      const { refused } = await sendQueuedLabels(api, userId);
      if (refused > 0) notify(t('labels.queue.refused', { count: refused }));
      setBoard(await api.foodLabels.board(outletId));
      setError(null);
    } catch (e) {
      setError(isNoSignal(e) ? t('labels.noSignalList') : errorMessage(e, t));
    }
    setWaiting((await queuedLabels(userId, outletId)).length);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [api, outletId, userId]);

  // Reloads on coming back from making a label, so the new one is there.
  useFocusEffect(
    useCallback(() => {
      void load();
    }, [load]),
  );

  async function close(label: FoodLabelDto, outcome: 'USED' | 'DISCARDED', reason?: DiscardReason) {
    if (busy) return;
    setBusy(label.id);
    setFailed(null);
    try {
      const closed = await api.foodLabels.close(label.id, { outcome, ...(reason && { reason }) });
      setLastClosed(closed);
      await load();
    } catch (e) {
      setFailed({ id: label.id, message: errorMessage(e, t, { 409: 'labels.alreadyMarked' }) });
      void load();
    } finally {
      setBusy(null);
    }
  }

  async function putBack(label: FoodLabelDto) {
    setLastClosed(null);
    try {
      await api.foodLabels.reopen(label.id);
      notify(t('labels.putBackDone'));
    } catch (e) {
      setError(errorMessage(e, t, { 409: 'labels.putBackLate' }));
    }
    await load();
  }

  async function printAgain(label: FoodLabelDto) {
    if (!board) return;
    const size = (await recallLabelSize()) ?? 'L50X30';
    setPrinting({ job: { labels: [labelPrintData(label, board.outletName, t, language)], size }, labelId: label.id });
  }

  function printed(outcome: PrintOutcome, labelId: string) {
    if (outcome === 'sent') void api.foodLabels.markPrinted(labelId).catch(() => undefined);
    else notify(t(outcome === 'needsSignal' ? 'labels.print.needsSignal' : 'labels.print.unavailable'));
  }

  const groupColor = { expired: theme.danger, today: theme.warning, later: theme.textSecondary } as const;

  const card = (label: FoodLabelDto, group: Group) => (
    <View key={label.id} style={[styles.card, { borderColor: group === 'later' ? theme.border : groupColor[group] }]}>
      <View style={styles.cardHeader}>
        {/* The use-by day's shape, on white so its colour shows in the dark theme too; the day is in words below. */}
        <View style={styles.mark}>
          <DayMark dayIndex={indiaWeekday(label.expiresAt)} size={24} />
        </View>
        <ThemedText type="default" style={styles.cardTitle}>
          {label.itemName}
        </ThemedText>
      </View>
      <ThemedText type="default" style={group !== 'later' && { color: groupColor[group], fontWeight: 700 }}>
        {t(group === 'expired' ? 'labels.expiredAt' : 'labels.useByAt', { when: formatLabelMoment(label.expiresAt, language) })}
      </ThemedText>
      <ThemedText type="small" themeColor="textSecondary">
        {[
          t('labels.preparedAt', { when: formatLabelMoment(label.preparedAt, language) }),
          t('labels.print.by', { name: label.preparedByName }),
          t(`labels.storage.${label.storage}`),
          label.quantityNote,
        ]
          .filter(Boolean)
          .join(' · ')}
      </ThemedText>
      {label.overrideReason && (
        <ThemedText type="small" themeColor="textSecondary">
          {t('labels.keptLonger', { name: label.overrideByName ?? '', reason: label.overrideReason })}
        </ThemedText>
      )}
      <View style={styles.actions}>
        <View style={styles.action}>
          <Button
            fill
            icon="checkmark-circle-outline"
            label={t('labels.usedUp')}
            variant="secondary"
            loading={busy === label.id}
            disabled={busy !== null && busy !== label.id}
            onPress={() => void close(label, 'USED')}
          />
        </View>
        <View style={styles.action}>
          <Button
            fill
            icon="trash-outline"
            label={t('labels.thrownAway')}
            variant="danger"
            disabled={busy !== null}
            onPress={() => setDiscarding(label)}
          />
        </View>
      </View>
      <ErrorText message={failed?.id === label.id ? failed.message : null} />
      <Button icon="print-outline" label={t('labels.printAgain')} variant="link" onPress={() => void printAgain(label)} />
    </View>
  );

  const section = (group: Group, labels: FoodLabelDto[]) =>
    labels.length > 0 && (
      <>
        <View style={styles.sectionHeader}>
          <Ionicons name={GROUP_ICON[group]} size={22} color={groupColor[group]} />
          <ThemedText type="smallBold" style={{ color: groupColor[group] }}>
            {t(`labels.group.${group}`, { count: labels.length })}
          </ThemedText>
        </View>
        {group === 'expired' && (
          <ThemedText type="small" themeColor="textSecondary">
            {t('labels.expiredHelp')}
          </ThemedText>
        )}
        {labels.map((label) => card(label, group))}
      </>
    );

  const empty = board !== null && board.expired.length + board.today.length + board.later.length === 0;

  return (
    <Screen
      back
      title={t('labels.title')}
      subtitle={t('labels.help')}
      onRefresh={load}
      headerRight={manages ? <Button label={t('labels.items')} icon="list-outline" variant="link" onPress={() => router.push('/labels/items')} /> : undefined}
      footer={<Button icon="pricetag-outline" label={t('labels.make')} onPress={() => router.push('/labels/new')} />}>
      {outlets.length > 1 && (
        <View style={styles.options} accessibilityRole="radiogroup" accessibilityLabel={t('checklists.chooseOutlet')}>
          {outlets.map((outlet) => (
            <OptionChip
              key={outlet.id}
              label={outlet.name}
              selected={outlet.id === outletId}
              onPress={() => {
                if (outlet.id === outletId) return;
                setBoard(null);
                setError(null);
                setLastClosed(null);
                choose(outlet.id);
              }}
            />
          ))}
        </View>
      )}

      <ErrorText message={error} onRetry={() => void load()} />
      {(outletLoading || (board === null && !error && outletId)) && <ActivityIndicator color={theme.primary} />}

      {waiting > 0 && (
        <View style={[styles.notice, { borderColor: theme.warning }]}>
          <Ionicons name="cloud-offline-outline" size={22} color={theme.warning} />
          <ThemedText type="default" style={styles.noticeText}>
            {t('labels.queue.waiting', { count: waiting })}
          </ThemedText>
        </View>
      )}

      {/* A wrong tap can be taken back for a few minutes. */}
      {lastClosed && (
        <View style={[styles.notice, { borderColor: theme.border }]}>
          <ThemedText type="default" style={styles.noticeText}>
            {t(lastClosed.status === 'USED' ? 'labels.markedUsed' : 'labels.markedDiscarded', { name: lastClosed.itemName })}
          </ThemedText>
          <Button label={t('labels.putBack')} variant="link" onPress={() => void putBack(lastClosed)} />
        </View>
      )}

      {empty && (
        <ThemedText type="default" themeColor="textSecondary">
          {t('labels.none')}
        </ThemedText>
      )}

      {board && section('expired', board.expired)}
      {board && section('today', board.today)}
      {board && section('later', board.later)}

      <OptionSheet
        visible={discarding !== null}
        title={t('labels.discardWhy')}
        onClose={() => setDiscarding(null)}
        options={DISCARD_ORDER.map((reason) => ({
          label: t(`labels.discard.${reason}`),
          icon: DISCARD_ICON[reason],
          onPress: () => {
            const label = discarding;
            setDiscarding(null);
            if (label) void close(label, 'DISCARDED', reason);
          },
        }))}
      />

      <LabelPrintSheet
        job={printing?.job ?? null}
        onClose={() => setPrinting(null)}
        onResult={(outcome) => printing && printed(outcome, printing.labelId)}
      />
    </Screen>
  );
}

const styles = StyleSheet.create({
  options: { flexDirection: 'row', flexWrap: 'wrap', gap: Spacing.two },
  sectionHeader: { flexDirection: 'row', alignItems: 'center', gap: Spacing.two, marginTop: Spacing.two },
  card: { borderWidth: 2, borderRadius: Spacing.three, padding: Spacing.three, gap: Spacing.two },
  cardHeader: { flexDirection: 'row', alignItems: 'center', gap: Spacing.two },
  cardTitle: { flex: 1, fontWeight: 700, fontSize: 18 },
  mark: {
    width: 36,
    height: 36,
    borderRadius: Spacing.two,
    backgroundColor: '#ffffff',
    borderWidth: 1,
    borderColor: '#7A858C',
    alignItems: 'center',
    justifyContent: 'center',
  },
  actions: { flexDirection: 'row', gap: Spacing.two, marginTop: Spacing.one },
  action: { flex: 1 },
  notice: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: Spacing.two,
    borderWidth: 2,
    borderRadius: Spacing.three,
    paddingHorizontal: Spacing.three,
    paddingVertical: Spacing.two,
  },
  noticeText: { flex: 1 },
});
