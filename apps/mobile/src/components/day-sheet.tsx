import Ionicons from '@expo/vector-icons/Ionicons';
import type { LanguageCode, Translator } from '@eccs/i18n';
import { localize, type DaySheetDto, type DaySheetVisitDto, type SheetToDoDto, type SheetToDoKind } from '@eccs/shared';
import { router } from 'expo-router';
import { useEffect, useState, useSyncExternalStore, type ComponentProps } from 'react';
import { Linking, Pressable, StyleSheet, View } from 'react-native';

import { CompactAction } from '@/components/lead-parts';
import { ThemedText } from '@/components/themed-text';
import { Button } from '@/components/ui/button';
import { ErrorText } from '@/components/ui/error-text';
import { MinTouchSize, Spacing } from '@/constants/theme';
import { useTheme } from '@/hooks/use-theme';
import { useDirection } from '@/lib/direction';
import { formatTime, formatTimeOfDay } from '@/lib/format';
import { carryKey, packedCount, stillToDoShown, ticksThatApply } from '@/lib/offline/day-sheet';
import { fieldSummary } from '@/lib/offline/field-ops';
import { useOutbox } from '@/lib/offline/outbox';
import { sheetTicks } from '@/lib/offline/sheet-ticks';
import { useSession } from '@/lib/session';

type IconName = ComponentProps<typeof Ionicons>['name'];

// The Supervisor's own work first; the sign-off is the restaurant's, so it reads as a reminder.
const TO_DO_ICONS: Record<SheetToDoKind, IconName> = {
  FINISH: 'flag-outline',
  PHOTOS: 'camera-outline',
  RETURNED: 'arrow-undo-outline',
  INSPECTION: 'clipboard-outline',
  SIGN_OFF: 'time-outline',
};

/** When a visit starts, as the sheet lists it: "3:30 pm", "After closing". */
function startWords(visit: Pick<DaySheetVisitDto, 'time' | 'slot'>, language: LanguageCode, t: Translator) {
  if (visit.time) return formatTime(visit.time, language);
  return visit.slot === 'AFTER_CLOSING' ? t('slot.AFTER_CLOSING') : t('sheet.noTime');
}

function openVisit(visitId: string) {
  router.push({ pathname: '/services/[visitId]', params: { visitId } });
}

function openToDo(item: SheetToDoDto) {
  if (item.inspectionId) router.push({ pathname: '/inspections/[inspectionId]', params: { inspectionId: item.inspectionId } });
  else if (item.visitId) openVisit(item.visitId);
}

interface DaySheetProps {
  sheet: DaySheetDto;
  /** When the screen last loaded (milliseconds): "Still to do today" shows from 4 pm. */
  now: number;
}

/**
 * The day's sheet at the top of a Supervisor's visits (console plan step 3, 20 Oct 2026): the
 * office sends it in the morning. In the evening, what the office's Evening close still lists for
 * these visits comes first; then the visits in time order, each with its address, a Map button
 * and the note from the outlet's last visit; then what to carry, ticked as the van is loaded.
 * The ticks stay on this phone, for the day (lib/offline/sheet-ticks.ts). With no signal it is
 * the copy saved on this phone with the visit lists.
 *
 * PATTERN FOLLOWED: the technician's day in Jobber's app (today's visits in time order with the
 * address on each, prefetched for the day so it works without signal; help.getjobber.com,
 * "Schedule in the Jobber app") and ServiceTitan's field app (today's jobs with the arrival time,
 * directions and the job's notes; help.servicetitan.com, "Field mobile app cheat sheet"); and a
 * job-materials pick list, each item once with the jobs it is for, ticked as it is loaded, with
 * a count of what is picked (Ply's pick list, help.getply.com). Checked items fold away once all
 * are done, as checklist apps put ticked items out of the way (Google Keep).
 */
export function DaySheet({ sheet, now }: DaySheetProps) {
  const theme = useTheme();
  const { t, language, user } = useSession();
  const { forwardGlyph } = useDirection();
  const box = useOutbox();
  const userId = user?.id ?? null;
  const ticksFile = useSyncExternalStore(sheetTicks.subscribe, sheetTicks.get, sheetTicks.get);
  // Opened again by the person once everything is packed (the list folds to its count).
  const [showPacked, setShowPacked] = useState(false);
  /** The visit whose map could not be opened, so the message shows on that row. */
  const [mapFailed, setMapFailed] = useState<string | null>(null);

  useEffect(() => {
    if (userId) void sheetTicks.load(userId, sheet.date);
  }, [userId, sheet.date]);

  const ticks = ticksThatApply(ticksFile, sheet.date, sheet.carry);
  const { packed, total } = packedCount(sheet.carry, ticks);
  const allPacked = total > 0 && packed === total;
  const toDo = stillToDoShown(sheet.stillToDo, new Date(now), (visitId) => fieldSummary(box.ops, 'visit', visitId).finishPending);
  // An outlet visited twice today is named with the visit's time in "Still to do", so the two can be told apart.
  const visitsAt = new Map<string, number>();
  for (const visit of sheet.visits) visitsAt.set(visit.outletName, (visitsAt.get(visit.outletName) ?? 0) + 1);
  const toDoOutlet = (item: SheetToDoDto) => {
    const visit = sheet.visits.find((entry) => entry.visitId === item.visitId);
    return visit && (visitsAt.get(item.outletName) ?? 0) > 1 ? `${item.outletName} (${startWords(visit, language, t)})` : item.outletName;
  };

  async function openMap(visit: DaySheetVisitDto) {
    if (!visit.mapUrl) return;
    setMapFailed(null);
    try {
      await Linking.openURL(visit.mapUrl);
    } catch {
      setMapFailed(visit.visitId);
    }
  }

  const sentLine =
    sheet.sent &&
    t(sheet.sent.changedSince ? 'sheet.sentByChanged' : 'sheet.sentBy', {
      name: sheet.sent.byName,
      time: formatTimeOfDay(sheet.sent.at, language),
    });

  return (
    <View style={styles.sheet}>
      <View style={styles.titles}>
        <ThemedText type="smallBold" themeColor="textSecondary" accessibilityRole="header">
          {t('sheet.title')}
        </ThemedText>
        {!!sentLine && (
          <ThemedText type="small" themeColor="textSecondary">
            {sentLine}
          </ThemedText>
        )}
      </View>

      {/* The evening: what the office's close still lists for these visits. */}
      {toDo.length > 0 && (
        <View style={[styles.toDo, { borderColor: theme.warning }]}>
          <ThemedText type="default" themeColor="warning" style={styles.bold} accessibilityRole="header">
            {t('sheet.stillToDo')}
          </ThemedText>
          {toDo.map((item) => {
            const theirs = item.kind === 'SIGN_OFF';
            return (
              <Pressable
                key={`${item.kind}:${item.visitId ?? item.inspectionId}`}
                accessibilityRole="button"
                onPress={() => openToDo(item)}
                style={({ pressed }) => [styles.toDoRow, pressed && { backgroundColor: theme.backgroundElement }]}>
                <Ionicons name={TO_DO_ICONS[item.kind]} size={22} color={theirs ? theme.textSecondary : theme.warning} />
                <ThemedText type="default" themeColor={theirs ? 'textSecondary' : 'text'} style={styles.flex}>
                  {t(`sheet.todo.${item.kind}`, { outlet: toDoOutlet(item) })}
                </ThemedText>
                <ThemedText type="default" themeColor="textSecondary">
                  {forwardGlyph}
                </ThemedText>
              </Pressable>
            );
          })}
        </View>
      )}

      {/* The visits in order. The row opens the visit; Map sits beside it, never inside it. */}
      <View style={[styles.visits, { borderColor: theme.border }]}>
        {sheet.visits.map((visit, index) => {
          const extra = [
            localize(visit.serviceName, language),
            visit.free ? t('sheet.free') : null,
            visit.partnerName ? t('sheet.partner', { name: visit.partnerName }) : null,
          ].filter(Boolean);
          return (
            <View key={visit.visitId} style={[styles.visit, index > 0 && { borderTopWidth: 1, borderColor: theme.border }]}>
              <View style={styles.visitRow}>
                <Pressable
                  accessibilityRole="button"
                  onPress={() => openVisit(visit.visitId)}
                  style={({ pressed }) => [styles.visitText, pressed && styles.pressed]}>
                  <ThemedText type="smallBold" themeColor="primary">
                    {startWords(visit, language, t)}
                  </ThemedText>
                  <ThemedText type="default" style={styles.bold}>
                    {visit.outletName}
                  </ThemedText>
                  {!!visit.address && (
                    <View style={styles.line}>
                      <Ionicons name="location-outline" size={16} color={theme.textSecondary} />
                      <ThemedText type="small" themeColor="textSecondary" style={styles.flex}>
                        {visit.address}
                      </ThemedText>
                    </View>
                  )}
                  <ThemedText type="small">{extra.join(' · ')}</ThemedText>
                  {!!visit.lastNote && (
                    <ThemedText type="small" themeColor="textSecondary">
                      {t('sheet.lastNote', { note: visit.lastNote })}
                    </ThemedText>
                  )}
                </Pressable>
                {!!visit.mapUrl && (
                  <CompactAction
                    icon="navigate-outline"
                    label={t('sheet.map')}
                    accessibilityLabel={t('sheet.mapOpen', { outlet: visit.outletName })}
                    onPress={() => void openMap(visit)}
                  />
                )}
              </View>
              <ErrorText message={mapFailed === visit.visitId ? t('vendors.directionsFailed') : null} />
            </View>
          );
        })}
      </View>

      {/* What to carry: each thing once, with the visits that need it. */}
      {total > 0 && (
        <>
          <View style={[styles.line, styles.carryTop]}>
            <ThemedText type="smallBold" themeColor="textSecondary" style={styles.flex} accessibilityRole="header">
              {t('sheet.carry')}
            </ThemedText>
            {!allPacked && (
              <ThemedText type="smallBold" themeColor="textSecondary">
                {t('sheet.packed', { count: packed, total })}
              </ThemedText>
            )}
          </View>
          {allPacked && (
            <View style={styles.line}>
              <Ionicons name="checkmark-circle" size={22} color={theme.primary} />
              <ThemedText type="default" themeColor="primary" style={[styles.flex, styles.bold]}>
                {t('sheet.allPacked', { count: total })}
              </ThemedText>
              <Button
                label={t(showPacked ? 'sheet.hideList' : 'sheet.showList')}
                variant="link"
                onPress={() => setShowPacked((open) => !open)}
              />
            </View>
          )}
          {/* One card of short rows, as a packing list: the visits are listed just above, so each thing names them by time. */}
          {(!allPacked || showPacked) && (
            <View style={[styles.visits, { borderColor: theme.border }]}>
              {sheet.carry.map((entry, index) => {
                const checked = ticks.has(carryKey(entry.item));
                const forWhich = entry.visits.map((visit) => (visit.time ? formatTime(visit.time, language) : visit.outletName)).join(', ');
                const inFull = entry.visits.map((visit) => [visit.time ? formatTime(visit.time, language) : null, visit.outletName].filter(Boolean).join(' ')).join(', ');
                return (
                  <Pressable
                    key={carryKey(entry.item)}
                    accessibilityRole="checkbox"
                    accessibilityState={{ checked }}
                    accessibilityLabel={`${entry.item}. ${inFull}`}
                    onPress={() => sheetTicks.set(sheet.date, sheet.carry, entry.item, !checked)}
                    style={({ pressed }) => [
                      styles.carryRow,
                      index > 0 && { borderTopWidth: 1, borderColor: theme.border },
                      (checked || pressed) && { backgroundColor: theme.backgroundElement },
                    ]}>
                    <Ionicons name={checked ? 'checkbox' : 'square-outline'} size={26} color={checked ? theme.primary : theme.outline} />
                    <ThemedText type="default" style={styles.flex}>
                      {entry.item}
                      <ThemedText type="small" themeColor="textSecondary">
                        {'  '}
                        {forWhich}
                      </ThemedText>
                    </ThemedText>
                  </Pressable>
                );
              })}
            </View>
          )}
        </>
      )}
    </View>
  );
}

const styles = StyleSheet.create({
  sheet: { gap: Spacing.two },
  titles: { gap: Spacing.half },
  flex: { flex: 1 },
  bold: { fontWeight: 700 },
  pressed: { opacity: 0.7 },
  line: { flexDirection: 'row', alignItems: 'center', gap: Spacing.two },
  toDo: { borderWidth: 2, borderRadius: Spacing.three, padding: Spacing.three, gap: Spacing.one },
  toDoRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: Spacing.two,
    minHeight: MinTouchSize,
    borderRadius: Spacing.two,
    paddingHorizontal: Spacing.one,
  },
  visits: { borderWidth: 1, borderRadius: Spacing.three, overflow: 'hidden' },
  visit: { padding: Spacing.three, gap: Spacing.two },
  visitRow: { flexDirection: 'row', alignItems: 'center', gap: Spacing.two },
  visitText: { flex: 1, gap: Spacing.half },
  carryTop: { marginTop: Spacing.two },
  carryRow: { flexDirection: 'row', alignItems: 'center', gap: Spacing.two, minHeight: MinTouchSize, paddingHorizontal: Spacing.three, paddingVertical: Spacing.two },
});
