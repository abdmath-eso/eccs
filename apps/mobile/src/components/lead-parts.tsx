import Ionicons from '@expo/vector-icons/Ionicons';
import { TARGET_FIGURES, type BdeWeekDto, type DoTodayItemDto, type LeadRowDto, type LeadStage, type LeadStatus } from '@eccs/shared';
import type { ComponentProps } from 'react';
import { Pressable, StyleSheet, View } from 'react-native';

import { DocumentPhoto } from '@/components/document-photo';
import { tallScript, ThemedText } from '@/components/themed-text';
import { Card } from '@/components/ui/card';
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
export function CompactAction({
  label,
  icon,
  onPress,
  primary,
  tonal,
  accessibilityLabel,
}: {
  label: string;
  icon: IconName;
  onPress: () => void;
  primary?: boolean;
  /**
   * The soft teal of a second action that matters (Material 3's filled tonal button): Map beside
   * a visit, which also has to show on a grey card, where the plain grey button would not.
   */
  tonal?: boolean;
  /** What a screen reader says when the word alone does not tell which row it is for ("Map" for which outlet). */
  accessibilityLabel?: string;
}) {
  const theme = useTheme();
  const color = primary ? theme.onPrimary : tonal ? theme.onPrimaryContainer : theme.primary;
  const background = primary ? theme.primary : tonal ? theme.primaryContainer : theme.backgroundElement;
  return (
    <Pressable
      accessibilityRole="button"
      accessibilityLabel={accessibilityLabel ?? label}
      onPress={onPress}
      style={({ pressed }) => [styles.compact, { backgroundColor: background, opacity: pressed ? 0.8 : 1 }]}>
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
  // A plan goes out as a quote too: the paper plane reads "send", where the old circling arrows read "repeat".
  SEND_PLAN: 'paper-plane-outline',
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
    // Red only on the "when" line: with most rows overdue, red borders on every one stopped saying anything.
    // The app's one card (components/ui/card), as the lead cards on Leads are.
    <Card style={styles.todo}>
      <View style={styles.todoText}>
        <Pressable accessibilityRole="button" onPress={onOpen} style={({ pressed }) => [styles.todoOpen, pressed && styles.pressed]}>
          {/* The mark on the first line of a "when" that wraps, not halfway down it. */}
          <View style={styles.firstLine}>
            {overdue && <Ionicons name="alert-circle" size={16} color={theme.danger} style={styles.todoIcon} />}
            <ThemedText type="smallBold" style={[styles.flexShrink, { color: overdue ? theme.danger : theme.primary }]}>
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
    </Card>
  );
}

/**
 * This week against target in one row: leads, free checks, first jobs, plans, each with how it is
 * going in an icon too. Drawn as the stat tiles on the restaurant's Home are (a grey tile, the number
 * first and its word under it, read from the top), without the orange edge a figure behind target
 * used to have: the icon and the screen reader's "behind" already say so.
 */
export function WeekRow({ week }: { week: BdeWeekDto }) {
  const theme = useTheme();
  const { t, language } = useSession();
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
            style={[styles.figure, { backgroundColor: theme.backgroundElement }]}>
            <View style={styles.row}>
              <ThemedText type="default" style={styles.figureValue}>
                {week.actual[figure]}
              </ThemedText>
              <ThemedText type="small" themeColor="textSecondary" style={styles.figureLabel}>
                /{week.targets[figure]}
              </ThemedText>
              <Ionicons name={behind ? 'alert-circle' : 'checkmark-circle'} size={16} color={behind ? theme.warning : theme.primary} />
            </View>
            <ThemedText type="small" themeColor="textSecondary" style={[styles.figureName, tallScript(language) && styles.figureNameTall]}>
              {label}
            </ThemedText>
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
    // The app's one card, in the same look as the to-dos on Home; its lines sit a little closer than the card's own gap.
    <Card onPress={onPress} style={styles.card}>
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
        <View style={styles.firstLine}>
          <Ionicons name="time-outline" size={18} color={theme.danger} style={styles.lineIcon} />
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
    </Card>
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
  // An icon on the first line of words that may wrap, not halfway down them.
  firstLine: { flexDirection: 'row', alignItems: 'flex-start', gap: Spacing.one },
  lineIcon: { marginTop: 1 },
  todoIcon: { marginTop: 2 },
  flex: { flex: 1 },
  flexShrink: { flexShrink: 1 },
  tag: { flexDirection: 'row', alignItems: 'center', gap: Spacing.half, borderRadius: Spacing.two, paddingHorizontal: Spacing.two, paddingVertical: Spacing.half },
  tagText: { fontWeight: 600 },
  // One width for every row's button, so they line up in a column down the list.
  compact: {
    minHeight: MinTouchSize,
    width: 92,
    borderRadius: Spacing.three,
    paddingHorizontal: Spacing.three,
    alignItems: 'center',
    justifyContent: 'center',
    gap: Spacing.half,
  },
  todo: { flexDirection: 'row', alignItems: 'center' },
  todoText: { flex: 1, gap: Spacing.half },
  todoOpen: { gap: Spacing.half },
  pressed: { opacity: 0.7 },
  name: { fontWeight: 700 },
  second: { alignSelf: 'flex-start', paddingVertical: Spacing.one },
  week: { flexDirection: 'row', gap: Spacing.two },
  // As Home's stat tiles (components/outlet-overview.tsx): from the top, so the numbers stay level however the words wrap.
  figure: { flex: 1, borderRadius: Spacing.three, paddingVertical: Spacing.two + Spacing.one, paddingHorizontal: Spacing.two, justifyContent: 'flex-start', gap: Spacing.half },
  figureValue: { fontWeight: 700, fontSize: 22, lineHeight: 28 },
  figureLabel: { flexShrink: 1, marginEnd: Spacing.half },
  figureName: { fontSize: 12, lineHeight: 16 },
  figureNameTall: { fontSize: 13, lineHeight: 19 },
  card: { gap: Spacing.one },
  cardTop: { flexDirection: 'row', alignItems: 'flex-start', gap: Spacing.two },
  thumb: { width: 88, height: 88, borderRadius: Spacing.two },
});
