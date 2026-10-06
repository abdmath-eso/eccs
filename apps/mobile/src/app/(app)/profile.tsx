import type { ProfileDto } from '@eccs/shared';
import { useFocusEffect } from 'expo-router';
import { useCallback, useState } from 'react';
import { ActivityIndicator, StyleSheet, View } from 'react-native';

import { Avatar } from '@/components/avatar';
import { LanguagePicker } from '@/components/language-picker';
import { ThemedText } from '@/components/themed-text';
import { Button } from '@/components/ui/button';
import { ErrorText } from '@/components/ui/error-text';
import { Screen } from '@/components/ui/screen';
import { TextField } from '@/components/ui/text-field';
import { Spacing } from '@/constants/theme';
import { useTheme } from '@/hooks/use-theme';
import { errorMessage } from '@/lib/errors';
import { formatDate } from '@/lib/format';
import { CameraPermissionError, chooseProfilePhoto } from '@/lib/photo';
import { useSession } from '@/lib/session';

/**
 * "My profile": the person's photo, name and role, their restaurant and its
 * branches, and their own preferences, which for now is the language.
 */
export default function ProfileScreen() {
  const theme = useTheme();
  const { t, api, language, refreshUser } = useSession();
  const [profile, setProfile] = useState<ProfileDto | null>(null);
  const [busy, setBusy] = useState<'photo' | 'name' | null>(null);
  const [editingName, setEditingName] = useState(false);
  const [name, setName] = useState('');
  const [error, setError] = useState<string | null>(null);

  useFocusEffect(
    useCallback(() => {
      let cancelled = false;
      (async () => {
        try {
          const loaded = await api.profile.get();
          if (cancelled) return;
          setProfile(loaded);
          setError(null);
        } catch (e) {
          if (!cancelled) setError(errorMessage(e, t));
        }
      })();
      return () => {
        cancelled = true;
      };
      // `t` changes with language; reloading for that is unnecessary.
      // eslint-disable-next-line react-hooks/exhaustive-deps
    }, [api]),
  );

  async function changePhoto(source: 'camera' | 'gallery') {
    setError(null);
    try {
      const photo = await chooseProfilePhoto(source);
      if (!photo) return;
      setBusy('photo');
      setProfile(await api.profile.setPhoto(photo.file));
    } catch (e) {
      setError(
        e instanceof CameraPermissionError ? t('profile.cameraNeeded') : errorMessage(e, t, { 0: 'error.upload' }),
      );
    } finally {
      setBusy(null);
    }
  }

  async function removePhoto() {
    setBusy('photo');
    setError(null);
    try {
      setProfile(await api.profile.removePhoto());
    } catch (e) {
      setError(errorMessage(e, t));
    } finally {
      setBusy(null);
    }
  }

  async function saveName() {
    setBusy('name');
    setError(null);
    try {
      await api.auth.updateProfile({ name: name.trim() });
      // The greeting on the home screen and the menu use the name held with the login.
      await refreshUser();
      setProfile(await api.profile.get());
      setEditingName(false);
    } catch (e) {
      setError(errorMessage(e, t));
    } finally {
      setBusy(null);
    }
  }

  const line = (label: string, value: string) => (
    <View style={styles.line}>
      <ThemedText type="small" themeColor="textSecondary">
        {label}
      </ThemedText>
      <ThemedText type="default">{value}</ThemedText>
    </View>
  );

  return (
    <Screen back title={t('profile.title')}>
      {!profile && !error && <ActivityIndicator color={theme.primary} />}

      {profile && (
        <>
          {/* ── Photo, name and role ── */}
          <View style={styles.top}>
            <Avatar
              name={profile.name}
              photoUrl={profile.photoPath ? api.fileUrl(profile.photoPath) : null}
              size={112}
            />
            <ThemedText type="subtitle" style={styles.name}>
              {profile.name}
            </ThemedText>
            <ThemedText type="default" themeColor="primary" style={styles.centered}>
              {t(`role.${profile.role}`)}
              {profile.organizationName ? ` · ${profile.organizationName}` : ''}
            </ThemedText>
          </View>

          <View style={styles.pair}>
            <View style={styles.flex}>
              <Button
                fill
                label={t('profile.takePhoto')}
                variant="secondary"
                loading={busy === 'photo'}
                onPress={() => void changePhoto('camera')}
              />
            </View>
            <View style={styles.flex}>
              <Button
                fill
                label={t('profile.choosePhoto')}
                variant="secondary"
                disabled={busy === 'photo'}
                onPress={() => void changePhoto('gallery')}
              />
            </View>
          </View>
          {profile.photoPath && (
            <Button
              label={t('profile.removePhoto')}
              variant="link"
              disabled={busy === 'photo'}
              onPress={() => void removePhoto()}
            />
          )}

          {editingName ? (
            <View style={[styles.card, { borderColor: theme.primary }]}>
              <TextField label={t('profile.name')} value={name} onChangeText={setName} maxLength={100} autoFocus />
              <Button
                label={t('profile.saveName')}
                loading={busy === 'name'}
                disabled={name.trim().length === 0 || name.trim() === profile.name}
                onPress={() => void saveName()}
              />
              <Button label={t('common.cancel')} variant="link" onPress={() => setEditingName(false)} />
            </View>
          ) : profile.canEditName ? (
            <Button
              label={t('profile.editName')}
              variant="link"
              onPress={() => {
                setName(profile.name);
                setEditingName(true);
              }}
            />
          ) : (
            <ThemedText type="small" themeColor="textSecondary" style={styles.centered}>
              {t('profile.nameHint')}
            </ThemedText>
          )}

          <ErrorText message={error} />

          {/* ── Their own details ── */}
          <ThemedText type="smallBold" themeColor="textSecondary" style={styles.sectionGap}>
            {t('profile.details')}
          </ThemedText>
          <View style={[styles.card, { borderColor: theme.border }]}>
            {line(t('profile.role'), t(`role.${profile.role}`))}
            {profile.phone && line(t('profile.phone'), profile.phone.replace(/^\+91(\d{5})(\d{5})$/, '+91 $1 $2'))}
            {profile.email && line(t('profile.email'), profile.email)}
            {line(t('profile.memberSince'), formatDate(profile.memberSince.slice(0, 10), language))}
          </View>

          {/* ── The restaurant and its branches ── */}
          {profile.organizationName && (
            <>
              <ThemedText type="smallBold" themeColor="textSecondary" style={styles.sectionGap}>
                {t(profile.outlets.length > 1 ? 'profile.restaurantAndBranches' : 'profile.restaurant')}
              </ThemedText>
              <View style={[styles.card, { borderColor: theme.border }]}>
                <ThemedText type="default" style={styles.strong}>
                  {profile.organizationName}
                </ThemedText>
                {profile.outlets.map((outlet) => (
                  <View key={outlet.id} style={[styles.outlet, { borderColor: theme.border }]}>
                    <ThemedText type="default" style={styles.strong}>
                      {outlet.name}
                    </ThemedText>
                    <ThemedText type="small" themeColor="textSecondary">
                      {[outlet.address, outlet.city].filter(Boolean).join(', ')}
                    </ThemedText>
                    {outlet.code && (
                      <ThemedText type="small" themeColor="primary" selectable>
                        {t('profile.code', { code: outlet.code })}
                      </ThemedText>
                    )}
                  </View>
                ))}
                {profile.outlets.some((outlet) => outlet.code) && (
                  <ThemedText type="small" themeColor="textSecondary">
                    {t('profile.codeHint')}
                  </ThemedText>
                )}
              </View>
            </>
          )}

          {/* ── Preferences ── */}
          <ThemedText type="smallBold" themeColor="textSecondary" style={styles.sectionGap}>
            {t('profile.preferences')}
          </ThemedText>
          <View style={[styles.card, { borderColor: theme.border }]}>
            <ThemedText type="small" themeColor="textSecondary">
              {t('profile.language')}
            </ThemedText>
            <LanguagePicker />
          </View>
        </>
      )}
      {!profile && <ErrorText message={error} />}
    </Screen>
  );
}

const styles = StyleSheet.create({
  top: { alignItems: 'center', gap: Spacing.two, paddingTop: Spacing.two },
  name: { fontSize: 24, lineHeight: 30, textAlign: 'center' },
  centered: { textAlign: 'center' },
  pair: { flexDirection: 'row', gap: Spacing.two },
  flex: { flex: 1 },
  card: { borderWidth: 1.5, borderRadius: Spacing.three, padding: Spacing.three, gap: Spacing.three },
  line: { gap: Spacing.half },
  strong: { fontWeight: 700 },
  outlet: { borderTopWidth: StyleSheet.hairlineWidth, paddingTop: Spacing.three, gap: Spacing.half },
  sectionGap: { marginTop: Spacing.three },
});
