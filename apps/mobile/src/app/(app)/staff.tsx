import { can, type OutletSummaryDto, type RestaurantUserDto } from '@eccs/shared';
import { Redirect } from 'expo-router';
import { useEffect, useState } from 'react';
import { ActivityIndicator, Pressable, StyleSheet, View } from 'react-native';

import { PinReveal } from '@/components/pin-reveal';
import { ThemedText } from '@/components/themed-text';
import { Button } from '@/components/ui/button';
import { ConfirmDialog } from '@/components/ui/confirm-dialog';
import { ErrorText } from '@/components/ui/error-text';
import { Screen } from '@/components/ui/screen';
import { TextField } from '@/components/ui/text-field';
import { MinTouchSize, Spacing } from '@/constants/theme';
import { useTheme } from '@/hooks/use-theme';
import { errorMessage } from '@/lib/errors';
import { useSession } from '@/lib/session';

type StaffRole = 'MANAGER' | 'HEAD_CHEF';
type PendingAction = { kind: 'reset' | 'deactivate'; person: RestaurantUserDto };

/** Where the Owner or a Manager adds people and hands out their PINs. */
export default function StaffScreen() {
  const theme = useTheme();
  const { t, api, user } = useSession();

  const [people, setPeople] = useState<RestaurantUserDto[] | null>(null);
  const [outlets, setOutlets] = useState<OutletSummaryDto[]>([]);
  const [error, setError] = useState<string | null>(null);
  const [adding, setAdding] = useState(false);
  const [name, setName] = useState('');
  const [role, setRole] = useState<StaffRole>('HEAD_CHEF');
  const [outletId, setOutletId] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [revealed, setRevealed] = useState<{ pin: string; name: string } | null>(null);
  const [pending, setPending] = useState<PendingAction | null>(null);

  const memberships = user?.memberships ?? [];
  const allowed = can(memberships, 'restaurantUsers', 'create');
  // Only an Owner (or ECCS admin) may create Managers; a Manager adds kitchen staff.
  const mayAddManager = memberships.some((m) => m.role === 'OWNER' || m.role === 'SUPER_ADMIN' || m.role === 'OPS_MANAGER');

  useEffect(() => {
    if (!allowed) return;
    let cancelled = false;
    (async () => {
      try {
        const [list, outletList] = await Promise.all([api.restaurantUsers.list(), api.outlets.list()]);
        if (cancelled) return;
        setPeople(list);
        setOutlets(outletList);
        setOutletId((current) => current ?? outletList[0]?.id ?? null);
      } catch (e) {
        if (!cancelled) setError(errorMessage(e, t));
      }
    })();
    return () => {
      cancelled = true;
    };
    // Loaded once when the screen opens; `t` changing language must not refetch.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [api, allowed]);

  if (!allowed) return <Redirect href="/" />;

  async function reload() {
    setPeople(await api.restaurantUsers.list());
  }

  async function create() {
    if (!outletId) return;
    setBusy(true);
    setError(null);
    try {
      const created = await api.restaurantUsers.create({ name, role, outletId });
      setRevealed({ pin: created.pin, name: created.user.name });
      setAdding(false);
      setName('');
      await reload();
    } catch (e) {
      setError(errorMessage(e, t));
    } finally {
      setBusy(false);
    }
  }

  async function runPending() {
    if (!pending) return;
    const { kind, person } = pending;
    setPending(null);
    setError(null);
    try {
      if (kind === 'reset') {
        const result = await api.restaurantUsers.resetPin(person.id);
        setRevealed({ pin: result.pin, name: person.name });
      } else {
        await api.restaurantUsers.update(person.id, { isActive: false });
      }
      await reload();
    } catch (e) {
      setError(errorMessage(e, t));
    }
  }

  if (revealed) {
    return (
      <Screen title={revealed.name}>
        <PinReveal
          pin={revealed.pin}
          message={t('newPin.staffHelp', { name: revealed.name })}
          onDone={() => setRevealed(null)}
        />
      </Screen>
    );
  }

  const option = (selected: boolean) => [
    styles.option,
    { borderColor: selected ? theme.primary : theme.border },
    selected && { backgroundColor: theme.backgroundElement },
  ];

  return (
    <Screen back title={t('staff.title')} subtitle={t('staff.help')}>
      <ErrorText message={error} />

      {adding ? (
        <View style={[styles.card, { borderColor: theme.border }]}>
          <TextField label={t('staff.name')} value={name} onChangeText={setName} autoFocus autoCapitalize="words" />

          <ThemedText type="smallBold" themeColor="textSecondary">
            {t('staff.role')}
          </ThemedText>
          <View style={styles.options}>
            {(mayAddManager ? (['HEAD_CHEF', 'MANAGER'] as const) : (['HEAD_CHEF'] as const)).map((value) => (
              <Pressable
                key={value}
                accessibilityRole="button"
                accessibilityState={{ selected: role === value }}
                onPress={() => setRole(value)}
                style={option(role === value)}>
                <ThemedText type="default">{t(`role.${value}`)}</ThemedText>
              </Pressable>
            ))}
          </View>

          {outlets.length > 1 && (
            <>
              <ThemedText type="smallBold" themeColor="textSecondary">
                {t('staff.outlet')}
              </ThemedText>
              <View style={styles.optionsColumn}>
                {outlets.map((outlet) => (
                  <Pressable
                    key={outlet.id}
                    accessibilityRole="button"
                    accessibilityState={{ selected: outletId === outlet.id }}
                    onPress={() => setOutletId(outlet.id)}
                    style={option(outletId === outlet.id)}>
                    <ThemedText type="default">{outlet.name}</ThemedText>
                  </Pressable>
                ))}
              </View>
            </>
          )}

          <Button label={t('staff.create')} onPress={create} loading={busy} disabled={!name.trim() || !outletId} />
          <Button label={t('common.cancel')} variant="secondary" onPress={() => setAdding(false)} />
        </View>
      ) : (
        <Button label={t('staff.add')} onPress={() => setAdding(true)} />
      )}

      {people === null && !error && <ActivityIndicator color={theme.primary} />}
      {people?.length === 0 && (
        <ThemedText type="default" themeColor="textSecondary">
          {t('staff.empty')}
        </ThemedText>
      )}

      {people?.map((person) => {
        // Owners are managed by ECCS and by their own one-time code, and nobody edits themselves here.
        const editable =
          person.role !== 'OWNER' && person.id !== user?.id && (person.role === 'HEAD_CHEF' || mayAddManager);
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
              <View style={styles.options}>
                <View style={styles.flex}>
                  <Button label={t('staff.resetPin')} variant="secondary" onPress={() => setPending({ kind: 'reset', person })} />
                </View>
                <View style={styles.flex}>
                  <Button
                    label={t('staff.deactivate')}
                    variant="danger"
                    onPress={() => setPending({ kind: 'deactivate', person })}
                  />
                </View>
              </View>
            )}
          </View>
        );
      })}

      <ConfirmDialog
        visible={pending !== null}
        message={
          pending
            ? t(pending.kind === 'reset' ? 'staff.resetConfirm' : 'staff.deactivateConfirm', { name: pending.person.name })
            : ''
        }
        confirmLabel={pending?.kind === 'deactivate' ? t('staff.deactivate') : t('staff.resetPin')}
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
  options: { flexDirection: 'row', gap: Spacing.two },
  optionsColumn: { gap: Spacing.two },
  option: {
    flex: 1,
    minHeight: MinTouchSize,
    borderWidth: 2,
    borderRadius: Spacing.three,
    alignItems: 'center',
    justifyContent: 'center',
    paddingHorizontal: Spacing.three,
    paddingVertical: Spacing.two,
  },
  flex: { flex: 1 },
});
