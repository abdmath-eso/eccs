import type { InspectionGrade, InspectionSectionDto, InspectionStatus, InspectionSummaryDto } from '@eccs/shared';
import Ionicons from '@expo/vector-icons/Ionicons';
import { router } from 'expo-router';
import { Pressable, StyleSheet, View } from 'react-native';

import { ThemedText } from '@/components/themed-text';
import { MinTouchSize, Spacing, type ThemeColor } from '@/constants/theme';
import { useTheme } from '@/hooks/use-theme';
import { formatDayShort } from '@/lib/format';
import { useSession } from '@/lib/session';

// Pieces shared by the inspection screens: the status label, the score with its
// grade, the bar for a section's score, and one inspection in a list.

/** The colour a grade is shown in. The grade is always written out too, never colour alone. */
export const gradeColor = (grade: InspectionGrade | null): ThemeColor =>
  grade === 'A_PLUS' || grade === 'A' ? 'primary' : grade === 'B' ? 'warning' : grade === null ? 'textSecondary' : 'danger';

/** A small coloured label for where an inspection stands. */
export function InspectionStatusBadge({ status }: { status: InspectionStatus }) {
  const theme = useTheme();
  const { t } = useSession();
  const color =
    status === 'APPROVED'
      ? theme.primary
      : status === 'SUBMITTED'
        ? theme.warning
        : status === 'IN_PROGRESS'
          ? theme.info
          : theme.text;
  return (
    <View style={[styles.badge, { borderColor: color }]}>
      {status === 'APPROVED' && <Ionicons name="checkmark" size={16} color={color} />}
      <ThemedText type="smallBold" style={{ color }}>
        {t(`insp.status.${status}`)}
      </ThemedText>
    </View>
  );
}

/** The overall score, large, with the grade in words beside it. */
export function ScoreSummary({ score, grade }: { score: number; grade: InspectionGrade | null }) {
  const theme = useTheme();
  const { t } = useSession();
  const color = theme[gradeColor(grade)];
  return (
    <View
      accessible
      accessibilityLabel={`${t('insp.scoreOutOf', { score })}. ${grade ? t(`insp.grade.${grade}`) : ''}`}
      style={[styles.score, { backgroundColor: theme.backgroundElement }]}>
      <View style={[styles.scoreRing, { borderColor: color }]}>
        <ThemedText type="title" style={[styles.scoreNumber, { color }]}>
          {score}
        </ThemedText>
        <ThemedText type="small" themeColor="textSecondary">
          / 100
        </ThemedText>
      </View>
      <View style={styles.scoreWords}>
        <ThemedText type="small" themeColor="textSecondary">
          {t('insp.score')}
        </ThemedText>
        {grade && (
          <ThemedText type="subtitle" style={[styles.grade, { color }]}>
            {t(`insp.grade.${grade}`)}
          </ThemedText>
        )}
      </View>
    </View>
  );
}

/** One section's score as a labelled bar. The number is always written; the bar only helps comparing. */
export function SectionScoreRow({ section }: { section: InspectionSectionDto }) {
  const theme = useTheme();
  const { t } = useSession();
  const score = section.score;
  const color = score === null ? theme.textSecondary : score >= 80 ? theme.primary : score >= 68 ? theme.warning : theme.danger;
  return (
    <View
      accessible
      accessibilityLabel={`${section.title}: ${score === null ? t('insp.sectionNothingApplies') : t('insp.scoreOutOf', { score })}`}
      style={styles.sectionRow}>
      <View style={styles.sectionLine}>
        <ThemedText type="default" style={styles.sectionTitle}>
          {section.key}. {section.title}
        </ThemedText>
        <ThemedText type="default" style={[styles.sectionScore, { color }]}>
          {score === null ? t('insp.sectionNothingApplies') : score}
        </ThemedText>
      </View>
      <View style={[styles.track, { backgroundColor: theme.backgroundSelected }]}>
        {score !== null && <View style={[styles.bar, { width: `${score}%`, backgroundColor: color }]} />}
      </View>
    </View>
  );
}

/** One inspection in a list. Tapping it opens the inspection or, once finished, its report. */
export function InspectionCard({ inspection, showOutlet }: { inspection: InspectionSummaryDto; showOutlet?: boolean }) {
  const theme = useTheme();
  const { t, language } = useSession();
  const finished = inspection.overallScore !== null;
  const day = formatDayShort(inspection.date, language);
  return (
    <Pressable
      accessibilityRole="button"
      onPress={() => router.push({ pathname: '/inspections/[inspectionId]', params: { inspectionId: inspection.id } })}
      style={({ pressed }) => [styles.card, { backgroundColor: pressed ? theme.backgroundSelected : theme.backgroundElement }]}>
      <View style={styles.cardHeader}>
        <ThemedText type="default" style={styles.cardTitle}>
          {showOutlet ? inspection.outletName : day}
        </ThemedText>
        <Ionicons name="chevron-forward" size={22} color={theme.textSecondary} />
      </View>
      {showOutlet && (
        <ThemedText type="default">
          {inspection.status === 'PLANNED' ? t('insp.plannedFor', { date: day }) : day}
        </ThemedText>
      )}
      {showOutlet && inspection.outletAddress && (
        <View style={styles.address}>
          <Ionicons name="location-outline" size={18} color={theme.textSecondary} />
          <ThemedText type="small" themeColor="textSecondary" style={styles.flexText}>
            {inspection.outletAddress}
          </ThemedText>
        </View>
      )}
      {finished ? (
        <ThemedText type="default" themeColor={gradeColor(inspection.grade)} style={styles.cardScore}>
          {t('insp.scoreOutOf', { score: inspection.overallScore ?? 0 })}
          {inspection.grade ? ` · ${t(`insp.grade.${inspection.grade}`)}` : ''}
        </ThemedText>
      ) : (
        inspection.status === 'IN_PROGRESS' && (
          <ThemedText type="default" themeColor="textSecondary">
            {t('insp.progress', { done: inspection.answered, total: inspection.total })}
          </ThemedText>
        )
      )}
      <View style={styles.cardFooter}>
        <InspectionStatusBadge status={inspection.status} />
        {inspection.reportNumber && (
          <ThemedText type="small" themeColor="textSecondary">
            {inspection.reportNumber}
          </ThemedText>
        )}
      </View>
    </Pressable>
  );
}

const styles = StyleSheet.create({
  badge: {
    alignSelf: 'flex-start',
    flexDirection: 'row',
    alignItems: 'center',
    gap: Spacing.one,
    borderWidth: 1,
    borderRadius: Spacing.two,
    paddingHorizontal: Spacing.two,
    paddingVertical: Spacing.half,
  },
  score: { flexDirection: 'row', alignItems: 'center', gap: Spacing.three, borderRadius: Spacing.three, padding: Spacing.three },
  scoreRing: {
    width: 112,
    height: 112,
    borderRadius: 56,
    borderWidth: 6,
    alignItems: 'center',
    justifyContent: 'center',
  },
  scoreNumber: { fontSize: 40, lineHeight: 46, fontWeight: 700 },
  scoreWords: { flex: 1, gap: Spacing.one },
  grade: { fontSize: 22, lineHeight: 28, fontWeight: 700 },
  sectionRow: { gap: Spacing.one },
  sectionLine: { flexDirection: 'row', alignItems: 'flex-start', justifyContent: 'space-between', gap: Spacing.two },
  sectionTitle: { flex: 1 },
  sectionScore: { fontWeight: 700 },
  track: { height: 8, borderRadius: 4, overflow: 'hidden' },
  bar: { height: 8, borderRadius: 4 },
  card: { minHeight: MinTouchSize, borderRadius: Spacing.three, padding: Spacing.three, gap: Spacing.two },
  cardHeader: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', gap: Spacing.two },
  cardTitle: { flex: 1, fontWeight: 700, fontSize: 18 },
  cardScore: { fontWeight: 700 },
  cardFooter: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', gap: Spacing.two },
  address: { flexDirection: 'row', alignItems: 'flex-start', gap: Spacing.one },
  flexText: { flex: 1 },
});
