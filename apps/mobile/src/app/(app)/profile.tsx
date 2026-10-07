import type { ProfileDto } from '@eccs/shared';
import { useFocusEffect } from 'expo-router';
import { useCallback, useState } from 'react';
import Ionicons from '@expo/vector-icons/Ionicons';
import { ActivityIndicator, Platform, Pressable, StyleSheet, View } from 'react-native';

import { Avatar } from '@/components/avatar';
import { ThemedText } from '@/components/themed-text';
import { Button } from '@/components/ui/button';
import { ErrorText } from '@/components/ui/error-text';
import { OptionSheet, type SheetOption } from '@/components/ui/option-sheet';
import { Screen } from '@/components/ui/screen';
import { useSnackbar } from '@/components/ui/snackbar';
import { TextField } from '@/components/ui/text-field';
import { Spacing } from '@/constants/theme';
import { useTheme } from '@/hooks/use-theme';
import { ltrText } from '@/lib/direction';
import { errorMessage } from '@/lib/errors';
import { formatDate } from '@/lib/format';
import { CameraPermissionError, chooseProfilePhoto } from '@/lib/photo';
import { useSession } from '@/lib/session';

/**
 * "My profile": the person's photo, name and role, their restaurant and its
 * branches, and the branches they work at. The language is chosen at the foot of the side menu.
 */
export default function ProfileScreen() {
  const theme = useTheme();
  const { t, api, language, refreshUser } = useSession();
  const [profile, setProfile] = useState<ProfileDto | null>(null);
  const [busy, setBusy] = useState<'photo' | 'name' | null>(null);
  const [photoSheet, setPhotoSheet] = useState(false);
  const [editingName, setEditingName] = useState(false);
  const [name, setName] = useState('');
  // Each error is shown beside what caused it: the page failing to load, the photo, or the name.
  const [loadError, setLoadError] = useState<string | null>(null);
  const [photoError, setPhotoError] = useState<string | null>(null);
  const [nameError, setNameError] = useState<string | null>(null);
  const notify = useSnackbar();

  useFocusEffect(
    useCallback(() => {
      let cancelled = false;
      (async () => {
        try {
          const loaded = await api.profile.get();
          if (cancelled) return;
          setProfile(loaded);
          setLoadError(null);
        } catch (e) {
          if (!cancelled) setLoadError(errorMessage(e, t));
        }
      })();
      return () => {
        cancelled = true;
      };
      // `t` changes with language; reloading for that is unnecessary.
      // eslint-disable-next-line react-hooks/exhaustive-deps
    }, [api]),
  );

  /** Loads the profile again: for pulling down to refresh and for "Try again". */
  async function reload() {
    setLoadError(null);
    try {
      setProfile(await api.profile.get());
    } catch (e) {
      setLoadError(errorMessage(e, t));
    }
  }

  async function changePhoto(source: 'camera' | 'gallery') {
    setPhotoError(null);
    try {
      const photo = await chooseProfilePhoto(source);
      if (!photo) return;
      setBusy('photo');
      setProfile(await api.profile.setPhoto(photo.file));
      notify(t('profile.photoSaved'));
    } catch (e) {
      setPhotoError(
        e instanceof CameraPermissionError ? t('profile.cameraNeeded') : errorMessage(e, t, { 0: 'error.upload' }),
      );
    } finally {
      setBusy(null);
    }
  }

  async function removePhoto() {
    setBusy('photo');
    setPhotoError(null);
    try {
      setProfile(await api.profile.removePhoto());
      notify(t('profile.photoRemoved'));
    } catch (e) {
      setPhotoError(errorMessage(e, t));
    } finally {
      setBusy(null);
    }
  }

  async function saveName() {
    if (name.trim().length === 0) return setNameError(t('profile.nameNeeded'));
    // Nothing was changed, so there is nothing to send.
    if (name.trim() === profile?.name) return setEditingName(false);
    setBusy('name');
    setNameError(null);
    try {
      await api.auth.updateProfile({ name: name.trim() });
      // The greeting on the home screen and the menu use the name held with the login.
      await refreshUser();
      setProfile(await api.profile.get());
      setEditingName(false);
      notify(t('profile.nameSaved'));
    } catch (e) {
      setNameError(errorMessage(e, t));
    } finally {
      setBusy(null);
    }
  }

  // Closes the sheet, then acts. An iPhone will not open the camera or gallery
  // while the sheet is still sliding away, so it is given a moment first.
  const fromSheet = (action: () => void) => () => {
    setPhotoSheet(false);
    setTimeout(action, Platform.OS === 'ios' ? 500 : 50);
  };
  const photoOptions: SheetOption[] = [
    { label: t('profile.takePhoto'), icon: 'camera-outline', onPress: fromSheet(() => void changePhoto('camera')) },
    { label: t('profile.choosePhoto'), icon: 'images-outline', onPress: fromSheet(() => void changePhoto('gallery')) },
    ...(profile?.photoPath
      ? [
          {
            label: t('profile.removePhoto'),
            icon: 'trash-outline' as const,
            danger: true,
            onPress: fromSheet(() => void removePhoto()),
          },
        ]
      : []),
  ];

  const line = (label: string, value: string) => (
    <View style={styles.line}>
      <ThemedText type="small" themeColor="textSecondary">
        {label}
      </ThemedText>
      <ThemedText type="default">{value}</ThemedText>
    </View>
  );

  return (
    <Screen back title={t('profile.title')} onRefresh={reload}>
      <ErrorText message={loadError} onRetry={() => void reload()} />
      {!profile && !loadError && <ActivityIndicator color={theme.primary} />}

      {profile && (
        <>
          {/* ── Photo, name and role ── */}
          <View style={styles.top}>
            <Pressable
              accessibilityRole="button"
              accessibilityLabel={t('profile.changePhoto')}
              disabled={busy === 'photo'}
              onPress={() => setPhotoSheet(true)}
              style={({ pressed }) => pressed && { opacity: 0.8 }}>
              <Avatar
                name={profile.name}
                photoUrl={profile.photoPath ? api.fileUrl(profile.photoPath) : null}
                size={112}
              />
              {busy === 'photo' && (
                <View style={styles.uploading}>
                  <ActivityIndicator color="#ffffff" />
                </View>
              )}
              <View style={[styles.badge, { backgroundColor: theme.primary, borderColor: theme.background }]}>
                <Ionicons name="camera" size={18} color={theme.onPrimary} />
              </View>
            </Pressable>
            <ErrorText message={photoError} />
            <ThemedText type="subtitle" style={styles.name}>
              {profile.name}
            </ThemedText>
            <ThemedText type="default" themeColor="primary" style={styles.centered}>
              {t(`role.${profile.role}`)}
              {profile.organizationName ? ` · ${profile.organizationName}` : ''}
            </ThemedText>
          </View>

          {editingName ? (
            <View style={[styles.card, { borderColor: theme.primary }]}>
              <TextField
                label={t('profile.name')}
                value={name}
                onChangeText={(next) => {
                  setName(next);
                  setNameError(null);
                }}
                maxLength={100}
                autoFocus
                error={nameError}
              />
              <Button label={t('profile.saveName')} loading={busy === 'name'} onPress={() => void saveName()} />
              <Button label={t('common.cancel')} variant="link" onPress={() => setEditingName(false)} />
            </View>
          ) : profile.canEditName ? (
            <Button
              label={t('profile.editName')}
              variant="link"
              onPress={() => {
                setName(profile.name);
                setNameError(null);
                setEditingName(true);
              }}
            />
          ) : (
            <ThemedText type="small" themeColor="textSecondary" style={styles.centered}>
              {t('profile.nameHint')}
            </ThemedText>
          )}

          {/* ── Their own details ── */}
          <ThemedText type="smallBold" themeColor="textSecondary" style={styles.sectionGap}>
            {t('profile.details')}
          </ThemedText>
          <View style={[styles.card, { borderColor: theme.border }]}>
            {line(t('profile.role'), t(`role.${profile.role}`))}
            {profile.phone &&
              line(
                t('profile.phone'), // Wrapped in left-to-right marks so the groups keep their order when the app is in Urdu.
                ltrText(profile.phone.replace(/^\+91(\d{5})(\d{5})$/, '+91 $1 $2')),
              )}
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
        </>
      )}

      <OptionSheet
        visible={photoSheet}
        title={t('profile.photoTitle')}
        options={photoOptions}
        onClose={() => setPhotoSheet(false)}
      />
    </Screen>
  );
}

const styles = StyleSheet.create({
  top: { alignItems: 'center', gap: Spacing.two, paddingTop: Spacing.two },
  name: { fontSize: 24, lineHeight: 30, textAlign: 'center' },
  centered: { textAlign: 'center' },
  badge: {
    position: 'absolute',
    end: 0,
    bottom: 0,
    width: 36,
    height: 36,
    borderRadius: 18,
    borderWidth: 3,
    alignItems: 'center',
    justifyContent: 'center',
  },
  uploading: {
    ...StyleSheet.absoluteFill,
    borderRadius: 56,
    backgroundColor: 'rgba(0,0,0,0.45)',
    alignItems: 'center',
    justifyContent: 'center',
  },
  card: { borderWidth: 1.5, borderRadius: Spacing.three, padding: Spacing.three, gap: Spacing.three },
  line: { gap: Spacing.half },
  strong: { fontWeight: 700 },
  outlet: { borderTopWidth: StyleSheet.hairlineWidth, paddingTop: Spacing.three, gap: Spacing.half },
  sectionGap: { marginTop: Spacing.three },
});
