import {
  can,
  STAFF_JOB_SUGGESTIONS,
  type RestaurantUserDto,
  type StaffMemberDto,
  type StaffPayType,
} from '@eccs/shared';
import { Redirect, router, useLocalSearchParams } from 'expo-router';
import { useEffect, useState, type ReactNode } from 'react';
import { ActivityIndicator, StyleSheet, View } from 'react-native';

import { OutletChips, parseRupees, typedRupees, weekdayName } from '@/components/team-parts';
import { ThemedText } from '@/components/themed-text';
import { Button } from '@/components/ui/button';
import { ConfirmDialog } from '@/components/ui/confirm-dialog';
import { ErrorText } from '@/components/ui/error-text';
import { OptionChip } from '@/components/ui/option-chip';
import { Screen } from '@/components/ui/screen';
import { useSnackbar } from '@/components/ui/snackbar';
import { TextField } from '@/components/ui/text-field';
import { Spacing } from '@/constants/theme';
import { useTheme } from '@/hooks/use-theme';
import { errorMessage } from '@/lib/errors';
import { indiaToday, maskTypedDate, parseTypedDate, toTypedDate } from '@/lib/format';
import { useSession } from '@/lib/session';
import { useOutlet } from '@/lib/use-outlet';

/**
 * Adds a person to the outlet's staff, or (with `staffId`) changes their
 * details, marks them as having left, or brings them back.
 */
export default function PersonScreen() {
  const theme = useTheme();
  const { t, api, user } = useSession();
  const { staffId } = useLocalSearchParams<{ staffId?: string }>();
  const { outletId, outlets, choose } = useOutlet();
  const [person, setPerson] = useState<StaffMemberDto | null>(null);
  const [logins, setLogins] = useState<RestaurantUserDto[]>([]);
  const [error, setError] = useState<string | null>(null);

  const allowed = can(user?.memberships ?? [], 'staff', 'create');

  useEffect(() => {
    if (!allowed) return;
    let cancelled = false;
    (async () => {
      try {
        const [loaded, list] = await Promise.all([
          // There is no call for one person alone; their month carries their details.
          staffId ? api.team.personMonth(staffId, indiaToday().slice(0, 7)) : Promise.resolve(null),
          api.restaurantUsers.list(),
        ]);
        if (cancelled) return;
        setPerson(loaded?.staff ?? null);
        setLogins(list);
      } catch (e) {
        if (!cancelled) setError(errorMessage(e, t));
      }
    })();
    return () => {
      cancelled = true;
    };
    // Loaded once when the screen opens; `t` changing language must not refetch.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [api, allowed, staffId]);

  if (!allowed) return <Redirect href="/" />;

  if (staffId && !person) {
    return (
      <Screen back title={t('team.person.edit')}>
        <ErrorText message={error} />
        {!error && <ActivityIndicator color={theme.primary} />}
      </Screen>
    );
  }

  const formOutletId = person?.outletId ?? outletId;
  return (
    <PersonForm
      // A fresh form for each person and outlet, so nothing typed for one leaks into another.
      key={`${person?.id ?? 'new'}|${formOutletId}`}
      person={person}
      outletId={formOutletId}
      // Only the logins of this outlet can be linked, and the Owner is not on the staff list.
      logins={logins.filter((login) => login.outletId === formOutletId && login.role !== 'OWNER' && login.isActive)}
      outletChoice={person ? null : <OutletChips outlets={outlets} outletId={outletId} onChoose={choose} />}
    />
  );
}

interface PersonFormProps {
  person: StaffMemberDto | null;
  outletId: string | null;
  logins: RestaurantUserDto[];
  outletChoice: ReactNode;
}

function PersonForm({ person, outletId, logins, outletChoice }: PersonFormProps) {
  const { t, api, language } = useSession();
  const notify = useSnackbar();

  const [name, setName] = useState(person?.name ?? '');
  const [jobTitle, setJobTitle] = useState(person?.jobTitle ?? '');
  const [phone, setPhone] = useState(person?.phone ?? '');
  const [joined, setJoined] = useState(person?.joinedOn ? toTypedDate(person.joinedOn) : '');
  const [payType, setPayType] = useState<StaffPayType>(person?.pay?.payType ?? 'MONTHLY');
  const [pay, setPay] = useState(typedRupees(person?.pay?.payPaise ?? 0));
  const [weeklyOffDay, setWeeklyOffDay] = useState<number | null>(person?.weeklyOffDay ?? null);
  const [userId, setUserId] = useState<string | null>(person?.userId ?? null);
  const [errors, setErrors] = useState<{ name?: string; joined?: string; pay?: string; left?: string }>({});
  const [saveError, setSaveError] = useState<string | null>(null);
  const [busy, setBusy] = useState<'save' | 'left' | 'back' | 'remove' | null>(null);
  // "Mark as left" opens a date box first; removing asks once.
  const [leaving, setLeaving] = useState(false);
  const [leftOn, setLeftOn] = useState(toTypedDate(indiaToday()));
  const [confirmRemove, setConfirmRemove] = useState(false);

  async function save() {
    const joinedOn = joined.trim() ? parseTypedDate(joined) : null;
    const payPaise = parseRupees(pay);
    const found = {
      ...(name.trim().length < 2 && { name: t('staff.nameNeeded') }),
      ...(joined.trim() && !joinedOn && { joined: t('team.person.badDate') }),
      ...((payPaise === null || payPaise <= 0) && { pay: t('team.person.payNeeded') }),
    };
    setErrors(found);
    if (Object.keys(found).length > 0 || payPaise === null || !outletId) return;

    setBusy('save');
    setSaveError(null);
    const fields = { name: name.trim(), jobTitle: jobTitle.trim() || null, phone: phone.trim() || null, joinedOn, payType, payPaise, weeklyOffDay, userId };
    try {
      if (person) await api.team.updatePerson(person.id, fields);
      else await api.team.addPerson({ outletId, ...fields });
      notify(t('common.saved'));
      router.back();
    } catch (e) {
      setSaveError(errorMessage(e, t, { 400: 'team.person.refused' }));
    } finally {
      setBusy(null);
    }
  }

  /** Marks the person as having left on the day typed, or (with null) brings them back. */
  async function setLeft(date: string | null, doing: 'left' | 'back') {
    if (!person) return;
    setBusy(doing);
    setSaveError(null);
    try {
      await api.team.updatePerson(person.id, { leftOn: date });
      notify(t('common.saved'));
      router.back();
    } catch (e) {
      setSaveError(errorMessage(e, t, { 400: 'team.person.leftRefused' }));
    } finally {
      setBusy(null);
    }
  }

  async function remove() {
    if (!person) return;
    setConfirmRemove(false);
    setBusy('remove');
    setSaveError(null);
    try {
      await api.team.removePerson(person.id);
      // Back past the person's own page, which no longer has anyone to show.
      router.dismissTo('/team');
    } catch (e) {
      setSaveError(errorMessage(e, t, { 409: 'team.person.hasRecords' }));
    } finally {
      setBusy(null);
    }
  }

  return (
    <Screen
      back
      title={t(person ? 'team.person.edit' : 'team.people.add')}
      footer={
        <>
          <ErrorText message={saveError} />
          <Button label={t('team.save')} loading={busy === 'save'} disabled={busy !== null} onPress={() => void save()} />
        </>
      }>
      {outletChoice}

      <TextField
        label={t('staff.name')}
        value={name}
        onChangeText={(text) => {
          setName(text);
          setErrors((current) => ({ ...current, name: undefined }));
        }}
        autoCapitalize="words"
        error={errors.name}
      />

      <TextField label={t('team.person.job')} value={jobTitle} onChangeText={setJobTitle} hint={t('team.person.jobHint')} />
      <View style={styles.options}>
        {STAFF_JOB_SUGGESTIONS.map((job) => {
          const label = t(`team.job.${job}`);
          return <OptionChip key={job} label={label} selected={jobTitle.trim() === label} onPress={() => setJobTitle(label)} />;
        })}
      </View>

      {/* ── Pay ── */}
      <ThemedText type="smallBold" themeColor="textSecondary">
        {t('team.person.howPaid')}
      </ThemedText>
      <View style={styles.options} accessibilityRole="radiogroup">
        {(['MONTHLY', 'DAILY'] as const).map((value) => (
          <OptionChip key={value} label={t(`team.payType.${value}`)} selected={payType === value} onPress={() => setPayType(value)} />
        ))}
      </View>
      <TextField
        label={t(payType === 'DAILY' ? 'team.person.dailyWage' : 'team.person.monthlySalary')}
        value={pay}
        onChangeText={(text) => {
          setPay(text);
          setErrors((current) => ({ ...current, pay: undefined }));
        }}
        keyboardType="decimal-pad"
        hint={person?.hasRecords ? t('team.person.payChangeHint') : null}
        error={errors.pay}
      />

      <ThemedText type="smallBold" themeColor="textSecondary">
        {t('team.person.weeklyOff')}
      </ThemedText>
      <View style={styles.options} accessibilityRole="radiogroup">
        <OptionChip label={t('team.person.noFixedDay')} selected={weeklyOffDay === null} onPress={() => setWeeklyOffDay(null)} />
        {[1, 2, 3, 4, 5, 6, 0].map((day) => (
          <OptionChip key={day} label={weekdayName(day, language)} selected={weeklyOffDay === day} onPress={() => setWeeklyOffDay(day)} />
        ))}
      </View>

      <TextField
        label={t('team.person.joined')}
        value={joined}
        onChangeText={(text) => {
          setJoined(maskTypedDate(text, joined));
          setErrors((current) => ({ ...current, joined: undefined }));
        }}
        keyboardType="number-pad"
        placeholder="DD/MM/YYYY"
        hint={t('team.person.optional')}
        error={errors.joined}
      />
      <TextField label={t('team.person.phone')} value={phone} onChangeText={setPhone} keyboardType="phone-pad" hint={t('team.person.optional')} />

      {/* ── Their app login, for the few who have one ── */}
      {logins.length > 0 && (
        <>
          <ThemedText type="smallBold" themeColor="textSecondary">
            {t('team.person.login')}
          </ThemedText>
          <ThemedText type="small" themeColor="textSecondary">
            {t('team.person.loginHint')}
          </ThemedText>
          <View style={styles.options} accessibilityRole="radiogroup">
            <OptionChip label={t('team.person.noLogin')} selected={userId === null} onPress={() => setUserId(null)} />
            {logins.map((login) => (
              <OptionChip
                key={login.id}
                label={`${login.name} (${t(`role.${login.role}`)})`}
                selected={userId === login.id}
                onPress={() => setUserId(login.id)}
              />
            ))}
          </View>
        </>
      )}

      {/* ── Leaving, coming back, or removing a mistake ── */}
      {person && (
        <View style={styles.leaving}>
          {person.isActive && !leaving && (
            <Button variant="secondary" icon="exit-outline" label={t('team.person.markLeft')} disabled={busy !== null} onPress={() => setLeaving(true)} />
          )}
          {person.isActive && leaving && (
            <>
              <TextField
                label={t('team.person.lastDay')}
                value={leftOn}
                onChangeText={(text) => {
                  setLeftOn(maskTypedDate(text, leftOn));
                  setErrors((current) => ({ ...current, left: undefined }));
                }}
                keyboardType="number-pad"
                placeholder="DD/MM/YYYY"
                hint={t('team.person.leftHint')}
                error={errors.left}
              />
              <Button
                variant="danger"
                label={t('team.person.confirmLeft')}
                loading={busy === 'left'}
                disabled={busy !== null}
                onPress={() => {
                  const date = parseTypedDate(leftOn);
                  if (!date) setErrors((current) => ({ ...current, left: t('team.person.badDate') }));
                  else void setLeft(date, 'left');
                }}
              />
              <Button variant="secondary" label={t('common.cancel')} disabled={busy !== null} onPress={() => setLeaving(false)} />
            </>
          )}
          {!person.isActive && (
            <Button
              variant="secondary"
              icon="enter-outline"
              label={t('team.person.bringBack')}
              loading={busy === 'back'}
              disabled={busy !== null}
              onPress={() => void setLeft(null, 'back')}
            />
          )}
          {!person.hasRecords && (
            <Button
              variant="danger"
              icon="trash-outline"
              label={t('team.person.remove')}
              loading={busy === 'remove'}
              disabled={busy !== null}
              onPress={() => setConfirmRemove(true)}
            />
          )}
        </View>
      )}

      <ConfirmDialog
        visible={confirmRemove}
        message={t('team.person.removeConfirm', { name: person?.name ?? '' })}
        confirmLabel={t('team.person.remove')}
        danger
        onCancel={() => setConfirmRemove(false)}
        onConfirm={() => void remove()}
      />
    </Screen>
  );
}

const styles = StyleSheet.create({
  options: { flexDirection: 'row', flexWrap: 'wrap', gap: Spacing.two },
  leaving: { gap: Spacing.three, marginTop: Spacing.three },
});
