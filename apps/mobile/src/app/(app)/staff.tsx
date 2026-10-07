import { can, type OutletSummaryDto, type RestaurantUserDto } from '@eccs/shared';
import { Redirect } from 'expo-router';
import { useEffect, useState } from 'react';
import { ActivityIndicator, StyleSheet, View } from 'react-native';

import { PinReveal } from '@/components/pin-reveal';
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
import { useSession } from '@/lib/session';

type StaffRole = 'MANAGER' | 'HEAD_CHEF';
type ActionKind = 'reset' | 'deactivate' | 'restore';
type PendingAction = { kind: ActionKind; person: RestaurantUserDto };

/** Where the Owner or a Manager adds people and hands out their PINs. */
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

  return (
    <Screen back title={t('staff.title')} subtitle={t('staff.help')} onRefresh={load}>
      {outlets.some((outlet) => outlet.code) && (
        <View style={[styles.card, { borderColor: theme.border, backgroundColor: theme.backgroundElement }]}>
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
        </View>
      )}

      {adding ? (
        <View style={[styles.card, { borderColor: theme.border }]}>
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
              <View style={styles.options} accessibilityRole="radiogroup">
                {outlets.map((outlet) => (
                  <OptionChip
                    key={outlet.id}
                    label={outlet.name}
                    selected={outletId === outlet.id}
                    onPress={() => setOutletId(outlet.id)}
                  />
                ))}
              </View>
            </>
          )}

          <ErrorText message={createError} />
          <Button label={t('staff.create')} onPress={() => void create()} loading={busy} />
          <Button label={t('common.cancel')} variant="secondary" onPress={() => setAdding(false)} disabled={busy} />
        </View>
      ) : (
        <Button label={t('staff.add')} onPress={() => setAdding(true)} />
      )}

      <ErrorText message={loadError} onRetry={() => void load()} />
      {people === null && !loadError && <ActivityIndicator color={theme.primary} />}
      {people?.length === 0 && (
        <ThemedText type="default" themeColor="textSecondary">
          {t('staff.empty')}
        </ThemedText>
      )}

      {people?.map((person) => {
        // Owners are managed by ECCS and by their own one-time code, and nobody edits themselves here.
        const editable =
          person.role !== 'OWNER' && person.id !== user?.id && (person.role === 'HEAD_CHEF' || mayAddManager);
        const running = working?.personId === person.id ? working.kind : null;
        return (
          <View key={person.id} style={[styles.card, { borderColor: theme.border }]}>
            <ThemedText type="default" style={styles.personName}>
              {person.name}
            </ThemedText>
            <ThemedText type="small" themeColor="textSecondary">
              {t(`role.${person.role}`)}
              {person.outletName ? ` · ${person.outletName}` : ''}
              {person.isActive ? '' : ` · ${t('staff.inactive')}`}
            </ThemedText>
            {editable && person.isActive && (
              <View style={styles.actions}>
                <View style={styles.flex}>
                  <Button
                    fill
                    label={t('staff.resetPin')}
                    variant="secondary"
                    loading={running === 'reset'}
                    disabled={working !== null}
                    onPress={() => setPending({ kind: 'reset', person })}
                  />
                </View>
                <View style={styles.flex}>
                  <Button
                    fill
                    label={t('staff.deactivate')}
                    variant="danger"
                    loading={running === 'deactivate'}
                    disabled={working !== null}
                    onPress={() => setPending({ kind: 'deactivate', person })}
                  />
                </View>
              </View>
            )}
            {editable && !person.isActive && (
              <Button
                label={t('staff.restore')}
                variant="secondary"
                loading={running === 'restore'}
                disabled={working !== null}
                onPress={() => setPending({ kind: 'restore', person })}
              />
            )}
            <ErrorText message={actionError?.personId === person.id ? actionError.message : null} />
          </View>
        );
      })}

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
  card: { borderWidth: 1, borderRadius: Spacing.three, padding: Spacing.three, gap: Spacing.two },
  personName: { fontWeight: 700 },
  code: { fontSize: 24, lineHeight: 32, fontWeight: 700, letterSpacing: 1 },
  options: { flexDirection: 'row', flexWrap: 'wrap', gap: Spacing.two },
  actions: { flexDirection: 'row', gap: Spacing.two },
  flex: { flex: 1 },
});
