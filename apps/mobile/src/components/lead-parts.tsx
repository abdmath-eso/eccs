import Ionicons from '@expo/vector-icons/Ionicons';
import { TARGET_FIGURES, type BdeWeekDto, type DoTodayItemDto, type LeadRowDto, type LeadStage, type LeadStatus } from '@eccs/shared';
import type { ComponentProps } from 'react';
import { Pressable, StyleSheet, View } from 'react-native';

import { DocumentPhoto } from '@/components/document-photo';
import { ThemedText } from '@/components/themed-text';
import { UnsentMark } from '@/components/unsent-mark';
import { MinTouchSize, Spacing } from '@/constants/theme';
import { useTheme } from '@/hooks/use-theme';
import { keptPhotoUri } from '@/lib/offline/files';
import { momentWords, nextStepWords, staleWords, todoLine, todoWhen } from '@/lib/sales';
import { useSession } from '@/lib/session';

// Small pieces the BDE's screens share (B2): the stage tag, a lead's row in the list, a
// to-do on Home, the week against target, a compact button, and a lead's photo.

type IconName = ComponentProps<typeof Ionicons>['name'];

/** The stage in words, and Parked or Lost with an icon, so it never relies on colour. */
export function StageTag({ stage, status }: { stage: LeadStage; status: LeadStatus }) {
  const theme = useTheme();
  const { t } = useSession();
  const closed = status !== 'OPEN';
  const color = status === 'LOST' ? theme.danger : status === 'PARKED' ? theme.warning : theme.text;
  return (
    <View style={[styles.tag, { backgroundColor: theme.backgroundElement }]}>
      {closed && <Ionicons name={status === 'LOST' ? 'close-circle' : 'pause-circle'} size={16} color={color} />}
      <ThemedText type="small" style={[styles.tagText, { color }]}>
        {closed ? t(status === 'LOST' ? 'bde.status.LOST' : 'bde.status.PARKED') : t(`bde.stage.${stage}`)}
      </ThemedText>
    </View>
  );
}

/** A small button for a row: a picture and a word, as tall as every tap target in the app. */
export function CompactAction({ label, icon, onPress, primary }: { label: string; icon: IconName; onPress: () => void; primary?: boolean }) {
  const theme = useTheme();
  const color = primary ? theme.onPrimary : theme.primary;
  return (
    <Pressable
      accessibilityRole="button"
      accessibilityLabel={label}
      onPress={onPress}
      style={({ pressed }) => [
        styles.compact,
        { backgroundColor: primary ? theme.primary : theme.backgroundElement, opacity: pressed ? 0.8 : 1 },
      ]}>
      <Ionicons name={icon} size={20} color={color} />
      <ThemedText type="smallBold" style={{ color }}>
        {label}
      </ThemedText>
    </Pressable>
  );
}

const ACTION_ICONS: Record<DoTodayItemDto['action'], IconName> = {
  CALL: 'call',
  PARK_AGAIN: 'pause-circle-outline',
  SEND_QUOTE: 'document-text-outline',
  OPEN: 'open-outline',
  SEND_PLAN: 'repeat-outline',
};

/** One of today's to-dos: when, the lead, why in one line, and its one action. */
export function TodoRow({
  item,
  done,
  sending,
  onOpen,
  onAction,
}: {
  item: DoTodayItemDto;
  /** Something was logged on it on this phone since: shown as done, waiting to go. */
  done: boolean;
  sending: boolean;
  onOpen: () => void;
  onAction: (action: DoTodayItemDto['action']) => void;
}) {
  const theme = useTheme();
  const { t, language } = useSession();
  const overdue = item.bucket === 'OVERDUE';
  // The row opens the lead, and its buttons sit beside that, never inside it (a button
  // within a button cannot be pressed on its own on the web, and screen readers merge them).
  return (
    <View style={[styles.todo, { borderColor: overdue ? theme.danger : theme.border }]}>
      <View style={styles.todoText}>
        <Pressable accessibilityRole="button" onPress={onOpen} style={({ pressed }) => [styles.todoOpen, pressed && styles.pressed]}>
          <View style={styles.row}>
            {overdue && <Ionicons name="alert-circle" size={16} color={theme.danger} />}
            <ThemedText type="smallBold" style={{ color: overdue ? theme.danger : theme.primary }}>
              {todoWhen(item, t, language)}
            </ThemedText>
          </View>
          <ThemedText type="default" style={styles.name} numberOfLines={2}>
            {item.businessName}
          </ThemedText>
          <ThemedText type="small" themeColor="textSecondary">
            {todoLine(item, t, language)}
          </ThemedText>
        </Pressable>
        {done ? (
          <UnsentMark sending={sending} text={t('bde.todo.logged')} />
        ) : (
          item.secondAction && (
            <Pressable accessibilityRole="button" hitSlop={12} onPress={() => onAction(item.secondAction!)} style={styles.second}>
              <ThemedText type="smallBold" themeColor="primary">
                {t(`bde.action.${item.secondAction}`)}
              </ThemedText>
            </Pressable>
          )
        )}
      </View>
      {!done && <CompactAction label={t(`bde.action.${item.action}`)} icon={ACTION_ICONS[item.action]} onPress={() => onAction(item.action)} />}
    </View>
  );
}

/** This week against target in one row: leads, free checks, first jobs, plans, each with how it is going in an icon too. */
export function WeekRow({ week }: { week: BdeWeekDto }) {
  const theme = useTheme();
  const { t } = useSession();
  return (
    <View style={styles.week}>
      {TARGET_FIGURES.map((figure) => {
        const behind = week.missed.includes(figure);
        const label = t(`bde.week.${figure}`);
        return (
          <View
            key={figure}
            accessible
            accessibilityLabel={`${label}: ${t('bde.week.ofTarget', { done: week.actual[figure], target: week.targets[figure] })}${behind ? `, ${t('bde.week.behind')}` : ''}`}
            style={[styles.figure, { backgroundColor: theme.backgroundElement, borderColor: behind ? theme.warning : 'transparent' }]}>
            <ThemedText type="small" themeColor="textSecondary" numberOfLines={1}>
              {label}
            </ThemedText>
            <View style={styles.row}>
              <ThemedText type="default" style={styles.figureValue}>
                {week.actual[figure]}
              </ThemedText>
              <ThemedText type="small" themeColor="textSecondary" style={styles.figureLabel}>
                /{week.targets[figure]}
              </ThemedText>
              <Ionicons name={behind ? 'alert-circle' : 'checkmark-circle'} size={16} color={behind ? theme.warning : theme.primary} />
            </View>
          </View>
        );
      })}
    </View>
  );
}

/** A lead in the list: its name and stage, where and when it was last worked, and why it is waiting if it is. */
export function LeadCard({ lead, unsent, sending, onPress }: { lead: LeadRowDto; unsent: boolean; sending: boolean; onPress: () => void }) {
  const theme = useTheme();
  const { t, language } = useSession();
  const next = nextStepWords(lead, t, language);
  return (
    <Pressable
      accessibilityRole="button"
      onPress={onPress}
      style={({ pressed }) => [styles.card, { borderColor: lead.stale ? theme.danger : theme.border }, pressed && { backgroundColor: theme.backgroundElement }]}>
      <View style={styles.cardTop}>
        <ThemedText type="default" style={[styles.name, styles.flex]} numberOfLines={2}>
          {lead.businessName}
        </ThemedText>
        <StageTag stage={lead.stage} status={lead.status} />
      </View>
      <ThemedText type="small" themeColor="textSecondary">
        {[lead.area, momentWords(lead.lastActivityAt, t, language)].filter(Boolean).join(' · ')}
      </ThemedText>
      {lead.stale && (
        <View style={styles.row}>
          <Ionicons name="time" size={16} color={theme.danger} />
          <ThemedText type="smallBold" themeColor="danger" style={styles.flex}>
            {staleWords(lead.stale, t, language)}
          </ThemedText>
        </View>
      )}
      {next && (
        <ThemedText type="small" numberOfLines={1}>
          {t('bde.next.label')} {next}
        </ThemedText>
      )}
      {unsent && <UnsentMark sending={sending} />}
    </Pressable>
  );
}

/**
 * A lead's photo: from the phone's own file while it has not reached the server, else
 * from the server. Tapping it opens it full size. Nothing when there is neither. Small,
 * it is a thumbnail beside the lead's name or a timeline entry.
 */
export function LeadPhoto({ photo, small }: { photo: { id: string; path: string } | null; small?: boolean }) {
  const { api } = useSession();
  if (!photo) return null;
  const uri = photo.path ? api.fileUrl(photo.path) : keptPhotoUri(photo.id);
  if (!uri) return null;
  return <DocumentPhoto uri={uri} previewStyle={small ? styles.thumb : undefined} />;
}

const styles = StyleSheet.create({
  row: { flexDirection: 'row', alignItems: 'center', gap: Spacing.one },
  flex: { flex: 1 },
  tag: { flexDirection: 'row', alignItems: 'center', gap: Spacing.half, borderRadius: Spacing.two, paddingHorizontal: Spacing.two, paddingVertical: Spacing.half },
  tagText: { fontWeight: 600 },
  compact: {
    minHeight: MinTouchSize,
    minWidth: MinTouchSize,
    borderRadius: Spacing.three,
    paddingHorizontal: Spacing.three,
    alignItems: 'center',
    justifyContent: 'center',
    gap: Spacing.half,
  },
  todo: { flexDirection: 'row', alignItems: 'center', gap: Spacing.two, borderWidth: 1, borderRadius: Spacing.three, padding: Spacing.three },
  todoText: { flex: 1, gap: Spacing.half },
  todoOpen: { gap: Spacing.half },
  pressed: { opacity: 0.7 },
  name: { fontWeight: 700 },
  second: { alignSelf: 'flex-start', paddingVertical: Spacing.one },
  week: { flexDirection: 'row', gap: Spacing.two },
  figure: { flex: 1, borderRadius: Spacing.three, borderWidth: 2, paddingVertical: Spacing.two, paddingHorizontal: Spacing.two, gap: Spacing.half },
  figureValue: { fontWeight: 700, fontSize: 22, lineHeight: 28 },
  figureLabel: { flexShrink: 1, marginEnd: Spacing.half },
  card: { borderWidth: 1, borderRadius: Spacing.three, padding: Spacing.three, gap: Spacing.one },
  cardTop: { flexDirection: 'row', alignItems: 'flex-start', gap: Spacing.two },
  thumb: { width: 88, height: 88, borderRadius: Spacing.two },
});
