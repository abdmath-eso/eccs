import Ionicons from '@expo/vector-icons/Ionicons';
import { can, type RestaurantUserDto, type StaffMemberDto } from '@eccs/shared';
import { Redirect, router, type Href } from 'expo-router';
import { useState, type ComponentProps } from 'react';
import { ActivityIndicator, Pressable, StyleSheet, View } from 'react-native';

import { EnrolledMark } from '@/components/attendance-parts';
import { useLoaded } from '@/components/team-parts';
import { ThemedText } from '@/components/themed-text';
import { Button } from '@/components/ui/button';
import { ErrorText } from '@/components/ui/error-text';
import { OutletPicker } from '@/components/ui/outlet-picker';
import { Screen } from '@/components/ui/screen';
import { useSnackbar } from '@/components/ui/snackbar';
import { MinTouchSize, Spacing } from '@/constants/theme';
import { useTheme } from '@/hooks/use-theme';
import { formatMoney } from '@/lib/billing';
import { useDirection } from '@/lib/direction';
import { errorMessage } from '@/lib/errors';
import { formatDate } from '@/lib/format';
import { useSession } from '@/lib/session';
import { useOutlet } from '@/lib/use-outlet';

type IconName = ComponentProps<typeof Ionicons>['name'];

/**
 * "Staff" in the More menu, for the Owner and Manager: one place for everything
 * about the people who work at the outlet. Attendance and the salary tracker
 * are about every employee; "App logins and PINs" is the separate, smaller list
 * of the few who use this app.
 *
 * For the Owner it also names any Manager login that is not linked to a person
 * on the staff list, with the people to link it to. The rule that a Manager
 * cannot change their own attendance or pay (`ownRecordLocked` in @eccs/shared)
 * only knows who a Manager is on the staff list through that link, so an
 * unlinked Manager is the one gap in it, and it is put in front of the one
 * person who can close it.
 */
export default function TeamScreen() {
  const theme = useTheme();
  const { t, api, user, language } = useSession();
  const { forwardIcon } = useDirection();
  const { outletId, outlets, choose } = useOutlet();
  const notify = useSnackbar();
  const [showLeft, setShowLeft] = useState(false);
  // The Manager login the Owner is choosing a person for, while that list is open.
  const [linking, setLinking] = useState<RestaurantUserDto | null>(null);
  const [linkBusy, setLinkBusy] = useState(false);
  const [linkError, setLinkError] = useState<string | null>(null);

  const memberships = user?.memberships ?? [];
  const manages = can(memberships, 'staff', 'create');
  const isOwner = memberships.some((membership) => membership.role === 'OWNER');
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

  // Manager logins of this outlet that no one on the staff list, working or left, is linked to. Only the
  // Owner is shown them: a Manager cannot link their own login. If it cannot be read, nothing is shown.
  const { data: unlinked, reload: reloadUnlinked } = useLoaded<RestaurantUserDto[]>(
    manages && isOwner && outletId ? `unlinked|${outletId}` : null,
    async () => {
      const [logins, everyone] = await Promise.all([api.restaurantUsers.list(), api.team.people(outletId!, true)]);
      const linked = new Set(everyone.map((person) => person.userId));
      return logins.filter((login) => login.outletId === outletId && login.role === 'MANAGER' && login.isActive && !linked.has(login.id));
    },
  );

  // Nothing here for the Head Chef, who has no part in staff, attendance or pay (13 Oct 2026).
  if (!manages) return <Redirect href="/" />;

  /** Links the Manager login being dealt with to the person chosen, and takes the card away. */
  async function link(person: StaffMemberDto) {
    if (!linking || linkBusy) return;
    setLinkBusy(true);
    setLinkError(null);
    try {
      await api.team.updatePerson(person.id, { userId: linking.id });
      setLinking(null);
      notify(t('team.link.done'));
      await Promise.all([reload(), reloadUnlinked()]);
    } catch (e) {
      setLinkError(errorMessage(e, t));
    } finally {
      setLinkBusy(false);
    }
  }
  // Whoever is working here and has no login yet can be the person behind one.
  const linkable = (people ?? []).filter((person) => person.isActive && !person.userId);

  // The ways in are one plain list with a thin line between, not a pile of boxes: a list is quicker
  // to run the eye down than cards and takes less room (Nielsen Norman Group on cards against lists;
  // Material's two-line list item).
  const section = (icon: IconName, title: string, hint: string, href: Href, count = 0, first = false) => (
    <Pressable
      accessibilityRole="button"
      onPress={() => router.push(href)}
      style={({ pressed }) => [
        styles.section,
        !first && { borderTopWidth: StyleSheet.hairlineWidth, borderTopColor: theme.border },
        pressed && { backgroundColor: theme.backgroundElement },
      ]}>
      <Ionicons name={icon} size={26} color={theme.primary} />
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
      <OutletPicker outlets={outlets} outletId={outletId} onChoose={choose} />

      {/* For the Owner: a Manager's login that is not yet tied to that Manager on the staff list. */}
      {(unlinked ?? []).map((login) => (
        <View key={login.id} style={[styles.linkCard, { borderColor: theme.warning }]}>
          <View style={styles.linkText}>
            <Ionicons name="link" size={22} color={theme.warning} />
            <ThemedText type="small" style={styles.flex}>
              {t('team.link.body', { name: login.name })}
            </ThemedText>
          </View>
          {linking?.id === login.id ? (
            <>
              <ThemedText type="smallBold">{t('team.link.pick', { name: login.name })}</ThemedText>
              {linkable.map((person) => (
                <Button
                  key={person.id}
                  variant="secondary"
                  icon="person-outline"
                  label={person.name}
                  hint={person.jobTitle ?? undefined}
                  disabled={linkBusy}
                  onPress={() => void link(person)}
                />
              ))}
              <ErrorText message={linkError} />
              <Button variant="link" label={t('common.cancel')} disabled={linkBusy} onPress={() => setLinking(null)} />
            </>
          ) : (
            <Button
              variant="secondary"
              icon="link"
              label={t('team.link.button', { name: login.name })}
              onPress={() => {
                setLinkError(null);
                setLinking(login);
              }}
            />
          )}
        </View>
      ))}

      <View>
        {section('checkmark-done-circle-outline', t('team.att.title'), t('team.att.hint'), '/team/attendance', 0, true)}
        {can(memberships, 'attendance', 'read') &&
          section(
            'flag-outline',
            t('att.review.title'),
            extra?.waiting ? t('att.review.waiting', { count: extra.waiting }) : t('att.review.hint'),
            '/team/review',
            extra?.waiting ?? 0,
          )}
        {can(memberships, 'salary', 'read') && section('wallet-outline', t('team.pay.title'), t('team.pay.hint'), '/team/salary')}
        {can(memberships, 'attendance', 'read') && section('options-outline', t('att.settings.title'), t('att.settings.hint'), '/team/settings')}
        {can(memberships, 'restaurantUsers', 'create') && section('key-outline', t('team.logins'), t('team.loginsHint'), '/staff')}
      </View>

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

      <View>
        {people?.map((person, index) => (
          <Pressable
            key={person.id}
            accessibilityRole="button"
            onPress={() => router.push({ pathname: '/team/[staffId]', params: { staffId: person.id } })}
            style={({ pressed }) => [
              styles.person,
              index > 0 && { borderTopWidth: StyleSheet.hairlineWidth, borderTopColor: theme.border },
              pressed && { backgroundColor: theme.backgroundElement },
            ]}>
            <View style={styles.flex}>
              <ThemedText type="default" numberOfLines={1} style={[styles.bold, !person.isActive && styles.left]}>
                {person.name}
              </ThemedText>
              <ThemedText type="small" themeColor="textSecondary" numberOfLines={1}>
                {[
                  person.jobTitle,
                  person.pay
                    ? t(person.pay.payType === 'DAILY' ? 'team.pay.perDay' : 'team.pay.perMonth', {
                        amount: formatMoney(person.pay.payPaise, language),
                      })
                    : null,
                  person.leftOn ? t('team.people.leftOn', { date: formatDate(person.leftOn, language) }) : null,
                ]
                  .filter(Boolean)
                  .join(' · ')}
              </ThemedText>
              {/* Only the exception is said here: someone the camera cannot recognise yet. "Face added" is on the
                  person's own page. Shown once known, and only for people still working here. */}
              {person.isActive && extra && extra.enrolled[person.id] === false && <EnrolledMark enrolled={false} />}
            </View>
            <Ionicons name={forwardIcon} size={20} color={theme.textSecondary} />
          </Pressable>
        ))}
      </View>

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
  linkCard: { borderWidth: 2, borderRadius: Spacing.three, padding: Spacing.three, gap: Spacing.two },
  linkText: { flexDirection: 'row', alignItems: 'flex-start', gap: Spacing.two },
  badge: { minWidth: 28, height: 28, borderRadius: 14, paddingHorizontal: Spacing.two, alignItems: 'center', justifyContent: 'center' },
  // Plain rows with a thin line between: tall enough for a thumb, no box around each.
  section: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: Spacing.three,
    minHeight: MinTouchSize + Spacing.three,
    paddingVertical: Spacing.two + Spacing.one,
  },
  person: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: Spacing.two,
    minHeight: MinTouchSize + Spacing.three,
    paddingVertical: Spacing.two + Spacing.one,
  },
});
