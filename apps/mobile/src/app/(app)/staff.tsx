import Ionicons from '@expo/vector-icons/Ionicons';
import { can, type OutletSummaryDto, type RestaurantUserDto } from '@eccs/shared';
import { Redirect } from 'expo-router';
import { useEffect, useState } from 'react';
import { ActivityIndicator, Platform, StyleSheet, View } from 'react-native';

import { Avatar } from '@/components/avatar';
import { PinReveal } from '@/components/pin-reveal';
import { ThemedText } from '@/components/themed-text';
import { Button } from '@/components/ui/button';
import { Card } from '@/components/ui/card';
import { ConfirmDialog } from '@/components/ui/confirm-dialog';
import { ErrorText } from '@/components/ui/error-text';
import { ListRow } from '@/components/ui/list-row';
import { OptionChip } from '@/components/ui/option-chip';
import { OptionSheet } from '@/components/ui/option-sheet';
import { OutletPicker } from '@/components/ui/outlet-picker';
import { Screen } from '@/components/ui/screen';
import { useSnackbar } from '@/components/ui/snackbar';
import { TextField } from '@/components/ui/text-field';
import { Spacing } from '@/constants/theme';
import { useTheme } from '@/hooks/use-theme';
import { errorMessage } from '@/lib/errors';
import { useSession } from '@/lib/session';

type StaffRole = 'MANAGER' | 'HEAD_CHEF';
type ActionKind = 'reset' | 'deactivate' | 'restore';
type PendingAction = { kind: ActionKind; person: RestaurantUserDto };

// An iPhone will not open the question while the sheet of actions is still closing.
const AFTER_SHEET_MS = Platform.OS === 'ios' ? 500 : 0;

/** "App logins": where the Owner or a Manager adds the people who use this app and hands out their PINs. */
export default function StaffScreen() {
  const theme = useTheme();
  const { t, api, user } = useSession();
  const notify = useSnackbar();

  const [people, setPeople] = useState<RestaurantUserDto[] | null>(null);
  const [outlets, setOutlets] = useState<OutletSummaryDto[]>([]);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [createError, setCreateError] = useState<string | null>(null);
  const [nameError, setNameError] = useState<string | null>(null);
  // An error from New PIN, Remove access or Give access back, shown on that person's card.
  const [actionError, setActionError] = useState<{ personId: string; message: string } | null>(null);
  const [adding, setAdding] = useState(false);
  const [name, setName] = useState('');
  const [role, setRole] = useState<StaffRole>('HEAD_CHEF');
  const [outletId, setOutletId] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [revealed, setRevealed] = useState<{ pin: string; name: string; outletId: string | null } | null>(null);
  // The action waiting for a yes or no, and the one now running (its button shows a spinner).
  const [pending, setPending] = useState<PendingAction | null>(null);
  const [working, setWorking] = useState<{ kind: ActionKind; personId: string } | null>(null);
  // Whose sheet of actions (New PIN, Remove access) is open.
  const [menuFor, setMenuFor] = useState<string | null>(null);

  const memberships = user?.memberships ?? [];
  const allowed = can(memberships, 'restaurantUsers', 'create');
  // Only an Owner (or ECCS admin) may create Managers; a Manager adds kitchen staff.
  const mayAddManager = memberships.some(
    (m) => m.role === 'OWNER' || m.role === 'SUPER_ADMIN' || m.role === 'OPS_MANAGER',
  );

  useEffect(() => {
    if (!allowed) return;
    let cancelled = false;
    Promise.all([api.restaurantUsers.list(), api.outlets.list()])
      .then(([list, outletList]) => {
        if (cancelled) return;
        setPeople(list);
        setOutlets(outletList);
        setOutletId((current) => current ?? outletList[0]?.id ?? null);
      })
      .catch((e) => !cancelled && setLoadError(errorMessage(e, t)));
    return () => {
      cancelled = true;
    };
    // Loaded once when the screen opens; `t` changing language must not refetch.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [api, allowed]);

  /** Loads the people and outlets again: after a change, for pull-to-refresh and "Try again". */
  async function load() {
    try {
      const [list, outletList] = await Promise.all([api.restaurantUsers.list(), api.outlets.list()]);
      setPeople(list);
      setOutlets(outletList);
      setOutletId((current) => current ?? outletList[0]?.id ?? null);
      setLoadError(null);
    } catch (e) {
      setLoadError(errorMessage(e, t));
    }
  }

  if (!allowed) return <Redirect href="/" />;

  /** Owners are managed by ECCS and by their own one-time code, and nobody changes their own login here. */
  const mayChange = (person: RestaurantUserDto) =>
    person.role !== 'OWNER' && person.id !== user?.id && (person.role === 'HEAD_CHEF' || mayAddManager);

  /** From the sheet: closes it, then asks the same question as before. */
  function ask(kind: ActionKind, person: RestaurantUserDto) {
    setMenuFor(null);
    setTimeout(() => setPending({ kind, person }), AFTER_SHEET_MS);
  }

  async function create() {
    if (!name.trim()) {
      setNameError(t('staff.nameNeeded'));
      return;
    }
    if (!outletId) return;
    setBusy(true);
    setCreateError(null);
    try {
      const created = await api.restaurantUsers.create({ name: name.trim(), role, outletId });
      setRevealed({ pin: created.pin, name: created.user.name, outletId: created.user.outletId });
      setAdding(false);
      setName('');
      await load();
    } catch (e) {
      setCreateError(errorMessage(e, t));
    } finally {
      setBusy(false);
    }
  }

  async function runPending() {
    if (!pending) return;
    const { kind, person } = pending;
    setPending(null);
    setActionError(null);
    setWorking({ kind, personId: person.id });
    try {
      if (kind === 'deactivate') {
        await api.restaurantUsers.update(person.id, { isActive: false });
        notify(t('staff.removed'));
      } else {
        // Removing access also cancelled the person's PIN, so giving it back means a new PIN,
        // which is shown next like any other new PIN.
        if (kind === 'restore') await api.restaurantUsers.update(person.id, { isActive: true });
        const result = await api.restaurantUsers.resetPin(person.id);
        setRevealed({ pin: result.pin, name: person.name, outletId: person.outletId });
      }
    } catch (e) {
      setActionError({ personId: person.id, message: errorMessage(e, t) });
    } finally {
      setWorking(null);
      // Even after a failure, show where things now stand (access may be back although the PIN was not made).
      await load();
    }
  }

  if (revealed) {
    return (
      <Screen title={revealed.name}>
        <PinReveal
          pin={revealed.pin}
          message={t('newPin.staffHelp', { name: revealed.name })}
          restaurantCode={outlets.find((outlet) => outlet.id === revealed.outletId)?.code}
          shareFor={revealed.name}
          onDone={() => setRevealed(null)}
        />
      </Screen>
    );
  }

  const confirmText: Record<ActionKind, { message: 'staff.resetConfirm' | 'staff.deactivateConfirm' | 'staff.restoreConfirm'; label: 'staff.resetPin' | 'staff.deactivate' | 'staff.restore' }> = {
    reset: { message: 'staff.resetConfirm', label: 'staff.resetPin' },
    deactivate: { message: 'staff.deactivateConfirm', label: 'staff.deactivate' },
    restore: { message: 'staff.restoreConfirm', label: 'staff.restore' },
  };

  // The person whose row was tapped, with what may be done for them, while that sheet is open.
  const sheetFor = (people ?? []).find((person) => person.id === menuFor) ?? null;

  return (
    // What a PIN is for is read once: folded away at the end (22 Oct 2026).
    <Screen back title={t('staff.title')} about={t('staff.help')} onRefresh={load}>
      {outlets.some((outlet) => outlet.code) && (
        <Card variant="filled">
          <ThemedText type="smallBold" themeColor="textSecondary">
            {t('staff.code')}
          </ThemedText>
          {outlets.map(
            (outlet) =>
              outlet.code && (
                <View key={outlet.id}>
                  {outlets.length > 1 && <ThemedText type="small">{outlet.name}</ThemedText>}
                  <ThemedText type="default" themeColor="primary" style={styles.code} selectable>
                    {outlet.code}
                  </ThemedText>
                </View>
              ),
          )}
          <ThemedText type="small" themeColor="textSecondary">
            {t('staff.codeHelp')}
          </ThemedText>
        </Card>
      )}

      {adding ? (
        <Card>
          <TextField
            label={t('staff.name')}
            value={name}
            onChangeText={(text) => {
              setName(text);
              setNameError(null);
            }}
            autoFocus
            autoCapitalize="words"
            error={nameError}
          />

          <ThemedText type="smallBold" themeColor="textSecondary">
            {t('staff.role')}
          </ThemedText>
          <View style={styles.options} accessibilityRole="radiogroup">
            {(mayAddManager ? (['HEAD_CHEF', 'MANAGER'] as const) : (['HEAD_CHEF'] as const)).map((value) => (
              <OptionChip key={value} label={t(`role.${value}`)} selected={role === value} onPress={() => setRole(value)} />
            ))}
          </View>

          {outlets.length > 1 && (
            <>
              <ThemedText type="smallBold" themeColor="textSecondary">
                {t('staff.outlet')}
              </ThemedText>
              <OutletPicker outlets={outlets} outletId={outletId} onChoose={setOutletId} />
            </>
          )}

          <ErrorText message={createError} />
          <Button label={t('staff.create')} onPress={() => void create()} loading={busy} />
          <Button label={t('common.cancel')} variant="secondary" onPress={() => setAdding(false)} disabled={busy} />
        </Card>
      ) : (
        <Button icon="add" label={t('staff.add')} onPress={() => setAdding(true)} />
      )}

      <ErrorText message={loadError} onRetry={() => void load()} />
      {people === null && !loadError && <ActivityIndicator color={theme.primary} />}
      {people?.length === 0 && (
        <ThemedText type="default" themeColor="textSecondary">
          {t('staff.empty')}
        </ThemedText>
      )}

      {/* One plain row per login. Its actions are in a short sheet that the row opens, as admin consoles
          keep a member's "Reset password" and "Deactivate" behind the member (Slack's ⋮ beside each
          member; Google Workspace's user page), instead of two buttons on every card (22 Oct 2026). */}
      <View>
        {people?.map((person, index) => {
          const editable = mayChange(person);
          const running = working?.personId === person.id;
          return (
            <ListRow
              key={person.id}
              title={person.name}
              subtitle={[t(`role.${person.role}`), person.outletName, person.isActive ? null : t('staff.inactive')].filter(Boolean).join(' · ')}
              below={<ErrorText message={actionError?.personId === person.id ? actionError.message : null} />}
              leading={<Avatar name={person.name} size={40} />}
              dimmed={!person.isActive}
              divider={index > 0}
              chevron={false}
              accessibilityLabel={editable ? `${person.name}, ${t('common.moreActions')}` : undefined}
              trailing={
                running ? (
                  <ActivityIndicator color={theme.primary} />
                ) : editable ? (
                  <Ionicons name="ellipsis-vertical" size={22} color={theme.textSecondary} />
                ) : undefined
              }
              onPress={editable && working === null ? () => setMenuFor(person.id) : undefined}
            />
          );
        })}
      </View>

      <OptionSheet
        visible={sheetFor !== null}
        title={sheetFor?.name}
        onClose={() => setMenuFor(null)}
        options={
          sheetFor === null
            ? []
            : sheetFor.isActive
              ? [
                  { label: t('staff.resetPin'), icon: 'key-outline', onPress: () => ask('reset', sheetFor) },
                  { label: t('staff.deactivate'), icon: 'person-remove-outline', danger: true, onPress: () => ask('deactivate', sheetFor) },
                ]
              : [{ label: t('staff.restore'), icon: 'refresh-outline', onPress: () => ask('restore', sheetFor) }]
        }
      />

      <ConfirmDialog
        visible={pending !== null}
        message={pending ? t(confirmText[pending.kind].message, { name: pending.person.name }) : ''}
        confirmLabel={pending ? t(confirmText[pending.kind].label) : ''}
        danger={pending?.kind === 'deactivate'}
        onCancel={() => setPending(null)}
        onConfirm={() => void runPending()}
      />
    </Screen>
  );
}

const styles = StyleSheet.create({
  code: { fontSize: 24, lineHeight: 32, fontWeight: 700, letterSpacing: 1 },
  options: { flexDirection: 'row', flexWrap: 'wrap', gap: Spacing.two },
});
