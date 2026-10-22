import Ionicons from '@expo/vector-icons/Ionicons';
import { can, type RestaurantUserDto, type StaffMemberDto } from '@eccs/shared';
import { Redirect, router, type Href } from 'expo-router';
import { useState, type ComponentProps } from 'react';
import { ActivityIndicator, StyleSheet, View } from 'react-native';

import { EnrolledMark } from '@/components/attendance-parts';
import { Avatar } from '@/components/avatar';
import { useLoaded } from '@/components/team-parts';
import { ThemedText } from '@/components/themed-text';
import { Button } from '@/components/ui/button';
import { ErrorText } from '@/components/ui/error-text';
import { ListRow } from '@/components/ui/list-row';
import { Notice } from '@/components/ui/notice';
import { OutletPicker } from '@/components/ui/outlet-picker';
import { Screen } from '@/components/ui/screen';
import { useSnackbar } from '@/components/ui/snackbar';
import { Spacing } from '@/constants/theme';
import { useTheme } from '@/hooks/use-theme';
import { formatMoney } from '@/lib/billing';
import { errorMessage } from '@/lib/errors';
import { formatDate } from '@/lib/format';
import { useSession } from '@/lib/session';
import { useOutlet } from '@/lib/use-outlet';

type IconName = ComponentProps<typeof Ionicons>['name'];

/**
 * "Staff" in the More menu, for the Owner and Manager: one place for everything
 * about the people who work at the outlet. Attendance and the salary tracker
 * are about every employee; "App logins" is the separate, smaller list
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
  // Material's two-line list item). The icons sit in the same 40-wide slot as the people's initials
  // below, so all the names start on one line.
  const section = (icon: IconName, title: string, hint: string, href: Href, count = 0, first = false) => (
    <ListRow
      title={title}
      subtitle={hint}
      leading={<Ionicons name={icon} size={26} color={theme.primary} />}
      divider={!first}
      // The count is read out with the row: "To review. Waiting for the Owner to check. 4 waiting".
      accessibilityLabel={count > 0 ? `${title}. ${hint}. ${t('att.review.waiting', { count })}` : undefined}
      onPress={() => router.push(href)}
      trailing={
        // How many are waiting: a number in a filled circle.
        count > 0 ? (
          <View style={[styles.badge, { backgroundColor: theme.danger }]}>
            <ThemedText type="smallBold" style={{ color: theme.background }}>
              {count > 99 ? '99+' : count}
            </ThemedText>
          </View>
        ) : undefined
      }
    />
  );

  return (
    <Screen back title={t('team.title')} onRefresh={reload}>
      <OutletPicker outlets={outlets} outletId={outletId} onChoose={choose} />

      {/* For the Owner: a Manager's login that is not yet tied to that Manager on the staff list. One line
          and a short link (22 Oct 2026: four lines and a button naming the person); why it matters is said
          when the person is chosen, where it counts. */}
      {(unlinked ?? []).map((login) => (
        <Notice key={login.id} tone="warning" text={t('team.link.body', { name: login.name })}>
          {linking?.id === login.id ? (
            <>
              <ThemedText type="small">{t('team.link.pick', { name: login.name })}</ThemedText>
              <View>
                {linkable.map((person, index) => (
                  <ListRow
                    key={person.id}
                    title={person.name}
                    subtitle={person.jobTitle}
                    leading={<Avatar name={person.name} size={40} />}
                    divider={index > 0}
                    chevron={false}
                    accessibilityLabel={`${t('team.link.button')}: ${person.name}`}
                    onPress={() => {
                      if (!linkBusy) void link(person);
                    }}
                  />
                ))}
              </View>
              {linkBusy && <ActivityIndicator color={theme.primary} />}
              <ErrorText message={linkError} />
              <Button variant="link" align="start" label={t('common.cancel')} disabled={linkBusy} onPress={() => setLinking(null)} />
            </>
          ) : (
            <Button
              variant="link"
              align="start"
              icon="link"
              label={t('team.link.button')}
              onPress={() => {
                setLinkError(null);
                setLinking(login);
              }}
            />
          )}
        </Notice>
      ))}

      <View>
        {section('checkmark-done-circle-outline', t('team.att.title'), t('team.att.hint'), '/team/attendance', 0, true)}
        {/* How many are waiting is said once, by the red count at the row's end (as a mail app's unread
            count); the line under the title says what the list is (22 Oct 2026: "4" and "4 waiting"). */}
        {can(memberships, 'attendance', 'read') &&
          section('flag-outline', t('att.review.title'), t('att.review.hint'), '/team/review', extra?.waiting ?? 0)}
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
          <ListRow
            key={person.id}
            // Initials in a circle, as contact lists show people (Material's list item with an avatar).
            leading={<Avatar name={person.name} size={40} />}
            title={person.name}
            subtitle={[
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
            // Only the exception is said here: someone the camera cannot recognise yet. "Face added" is on the
            // person's own page. Shown once known, and only for people still working here.
            below={person.isActive && extra && extra.enrolled[person.id] === false ? <EnrolledMark enrolled={false} /> : undefined}
            dimmed={!person.isActive}
            divider={index > 0}
            onPress={() => router.push({ pathname: '/team/[staffId]', params: { staffId: person.id } })}
          />
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
  heading: { marginTop: Spacing.two },
  badge: { minWidth: 28, height: 28, borderRadius: 14, paddingHorizontal: Spacing.two, alignItems: 'center', justifyContent: 'center' },
});
