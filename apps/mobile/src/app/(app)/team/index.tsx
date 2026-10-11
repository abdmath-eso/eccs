import Ionicons from '@expo/vector-icons/Ionicons';
import { can, type StaffMemberDto } from '@eccs/shared';
import { Redirect, router, type Href } from 'expo-router';
import { useState, type ComponentProps } from 'react';
import { ActivityIndicator, Pressable, StyleSheet, View } from 'react-native';

import { EnrolledMark } from '@/components/attendance-parts';
import { OutletChips, useLoaded } from '@/components/team-parts';
import { ThemedText } from '@/components/themed-text';
import { Button } from '@/components/ui/button';
import { ErrorText } from '@/components/ui/error-text';
import { Screen } from '@/components/ui/screen';
import { MinTouchSize, Spacing } from '@/constants/theme';
import { useTheme } from '@/hooks/use-theme';
import { formatMoney } from '@/lib/billing';
import { useDirection } from '@/lib/direction';
import { formatDate } from '@/lib/format';
import { useSession } from '@/lib/session';
import { useOutlet } from '@/lib/use-outlet';

type IconName = ComponentProps<typeof Ionicons>['name'];

/**
 * "Staff" in the More menu, for the Owner and Manager: one place for everything
 * about the people who work at the outlet. Attendance and the salary tracker
 * are about every employee; "App logins and PINs" is the separate, smaller list
 * of the few who use this app.
 */
export default function TeamScreen() {
  const theme = useTheme();
  const { t, api, user, language } = useSession();
  const { forwardIcon } = useDirection();
  const { outletId, outlets, choose } = useOutlet();
  const [showLeft, setShowLeft] = useState(false);

  const memberships = user?.memberships ?? [];
  const manages = can(memberships, 'staff', 'create');
  const { data: people, error, reload } = useLoaded<StaffMemberDto[]>(
    manages && outletId ? `${outletId}|${showLeft ? 'all' : 'working'}` : null,
    () => api.team.people(outletId!, showLeft),
  );

  // Beside the list: whose face is enrolled (from today's sheet) and how much is waiting for the
  // Owner to look at. Either may fail without spoiling the list; it then just shows less.
  const { data: extra } = useLoaded<{ enrolled: Record<string, boolean>; waiting: number | null }>(
    manages && outletId ? outletId : null,
    async () => {
      const [sheet, review] = await Promise.all([
        api.team.day(outletId!).catch(() => null),
        api.attendance.review(outletId!).catch(() => null),
      ]);
      return {
        enrolled: Object.fromEntries((sheet?.people ?? []).map((person) => [person.staffId, person.enrolled])),
        waiting: review ? review.punches.length + review.days.length : null,
      };
    },
  );

  // The Head Chef has one thing to see here: who is in today.
  if (!manages) return <Redirect href={can(memberships, 'staff', 'read') ? '/team/attendance' : '/'} />;

  const section = (icon: IconName, title: string, hint: string, href: Href, count = 0) => (
    <Pressable
      accessibilityRole="button"
      onPress={() => router.push(href)}
      style={({ pressed }) => [styles.section, { borderColor: theme.border }, pressed && { backgroundColor: theme.backgroundElement }]}>
      <Ionicons name={icon} size={28} color={theme.primary} />
      <View style={styles.flex}>
        <ThemedText type="default" style={styles.bold}>
          {title}
        </ThemedText>
        <ThemedText type="small" themeColor="textSecondary">
          {hint}
        </ThemedText>
      </View>
      {/* How many are waiting: a number in a filled circle, read out with the row. */}
      {count > 0 && (
        <View style={[styles.badge, { backgroundColor: theme.danger }]} accessibilityLabel={t('att.review.waiting', { count })}>
          <ThemedText type="smallBold" style={{ color: theme.background }}>
            {count > 99 ? '99+' : count}
          </ThemedText>
        </View>
      )}
      <Ionicons name={forwardIcon} size={20} color={theme.textSecondary} />
    </Pressable>
  );

  return (
    <Screen back title={t('team.title')} onRefresh={reload}>
      <OutletChips outlets={outlets} outletId={outletId} onChoose={choose} />

      {section('checkmark-done-circle-outline', t('team.att.title'), t('team.att.hint'), '/team/attendance')}
      {can(memberships, 'attendance', 'read') &&
        section(
          'flag-outline',
          t('att.review.title'),
          extra?.waiting ? t('att.review.waiting', { count: extra.waiting }) : t('att.review.hint'),
          '/team/review',
          extra?.waiting ?? 0,
        )}
      {can(memberships, 'salary', 'read') && section('wallet-outline', t('team.pay.title'), t('team.pay.hint'), '/team/salary')}
      {can(memberships, 'attendance', 'read') && section('time-outline', t('att.settings.title'), t('att.settings.hint'), '/team/settings')}
      {can(memberships, 'restaurantUsers', 'create') && section('key-outline', t('team.logins'), t('team.loginsHint'), '/staff')}

      {/* ── The people ── */}
      <ThemedText type="smallBold" themeColor="textSecondary" style={styles.heading}>
        {t('team.people.title')}
        {people ? ` (${people.length})` : ''}
      </ThemedText>
      <Button icon="person-add-outline" label={t('team.people.add')} onPress={() => router.push('/team/person')} />

      <ErrorText message={error} onRetry={() => void reload()} />
      {!people && !error && <ActivityIndicator color={theme.primary} />}
      {people?.length === 0 && (
        <ThemedText type="default" themeColor="textSecondary">
          {t('team.people.empty')}
        </ThemedText>
      )}

      {people?.map((person) => (
        <Pressable
          key={person.id}
          accessibilityRole="button"
          onPress={() => router.push({ pathname: '/team/[staffId]', params: { staffId: person.id } })}
          style={({ pressed }) => [styles.person, { borderColor: theme.border }, pressed && { backgroundColor: theme.backgroundElement }]}>
          <View style={styles.flex}>
            <ThemedText type="default" style={[styles.bold, !person.isActive && styles.left]}>
              {person.name}
            </ThemedText>
            <ThemedText type="small" themeColor="textSecondary">
              {[
                person.jobTitle,
                person.pay
                  ? t(person.pay.payType === 'DAILY' ? 'team.pay.perDay' : 'team.pay.perMonth', {
                      amount: formatMoney(person.pay.payPaise, language),
                    })
                  : null,
              ]
                .filter(Boolean)
                .join(' · ')}
            </ThemedText>
            {person.leftOn && (
              <ThemedText type="small" themeColor="textSecondary">
                {t('team.people.leftOn', { date: formatDate(person.leftOn, language) })}
              </ThemedText>
            )}
            {/* Whether the camera can recognise them; shown once known, and only for people still working here. */}
            {person.isActive && extra && person.id in extra.enrolled && <EnrolledMark enrolled={extra.enrolled[person.id] === true} />}
          </View>
          <Ionicons name={forwardIcon} size={20} color={theme.textSecondary} />
        </Pressable>
      ))}

      <Button
        variant="link"
        label={t(showLeft ? 'team.people.hideLeft' : 'team.people.showLeft')}
        onPress={() => setShowLeft((current) => !current)}
      />
    </Screen>
  );
}

const styles = StyleSheet.create({
  flex: { flex: 1, gap: Spacing.half },
  bold: { fontWeight: 700 },
  left: { opacity: 0.6 },
  heading: { marginTop: Spacing.two },
  badge: { minWidth: 28, height: 28, borderRadius: 14, paddingHorizontal: Spacing.two, alignItems: 'center', justifyContent: 'center' },
  section: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: Spacing.three,
    minHeight: MinTouchSize + Spacing.three,
    borderWidth: 1,
    borderRadius: Spacing.three,
    padding: Spacing.three,
  },
  person: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: Spacing.two,
    minHeight: MinTouchSize,
    borderWidth: 1,
    borderRadius: Spacing.three,
    padding: Spacing.three,
  },
});
