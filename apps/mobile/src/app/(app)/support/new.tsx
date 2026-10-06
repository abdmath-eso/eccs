import { ISSUE_CATEGORIES, type IssueCategory } from '@eccs/shared';
import { router } from 'expo-router';
import { useState } from 'react';
import { ActivityIndicator, Image, Pressable, StyleSheet, View } from 'react-native';

import { ThemedText } from '@/components/themed-text';
import { Button } from '@/components/ui/button';
import { ErrorText } from '@/components/ui/error-text';
import { Screen } from '@/components/ui/screen';
import { TextField } from '@/components/ui/text-field';
import { MinTouchSize, Spacing } from '@/constants/theme';
import { useTheme } from '@/hooks/use-theme';
import { errorMessage } from '@/lib/errors';
import { CameraPermissionError, takeProofPhoto } from '@/lib/photo';
import { useSession } from '@/lib/session';
import { useOutlet } from '@/lib/use-outlet';

const MAX_PHOTOS = 4;
const MIN_DESCRIPTION = 5;

/** Raises an issue for ECCS to act on: what it is about, what happened, and optional photos. */
export default function NewIssueScreen() {
  const theme = useTheme();
  const { t, api } = useSession();
  const { outletId, outlets, loading: outletLoading, choose } = useOutlet();
  const [category, setCategory] = useState<IssueCategory | null>(null);
  const [description, setDescription] = useState('');
  const [photos, setPhotos] = useState<{ id: string; uri: string }[]>([]);
  const [uploading, setUploading] = useState(false);
  const [sending, setSending] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function addPhoto() {
    if (!outletId) return;
    setError(null);
    let photo;
    try {
      photo = await takeProofPhoto();
    } catch (e) {
      setError(t(e instanceof CameraPermissionError ? 'error.camera' : 'error.generic'));
      return;
    }
    if (!photo) return;

    setUploading(true);
    try {
      const uploaded = await api.attachments.upload({ outletId, file: photo.file, capturedAt: new Date().toISOString() });
      setPhotos((current) => [...current, { id: uploaded.id, uri: photo.uri }]);
    } catch (e) {
      setError(errorMessage(e, t, { 0: 'error.upload' }));
    } finally {
      setUploading(false);
    }
  }

  async function send() {
    if (!outletId || !category) return;
    setSending(true);
    setError(null);
    try {
      const issue = await api.issues.create({
        outletId,
        category,
        description: description.trim(),
        attachmentIds: photos.map((photo) => photo.id),
      });
      // Replace this form with the new issue, so Back returns to the list rather than the form.
      router.replace({ pathname: '/support/[issueId]', params: { issueId: issue.id } });
    } catch (e) {
      setError(errorMessage(e, t));
      setSending(false);
    }
  }

  const option = (selected: boolean) => [
    styles.option,
    { borderColor: selected ? theme.primary : theme.border },
    selected && { backgroundColor: theme.backgroundElement },
  ];

  return (
    <Screen back title={t('support.raise')}>
      {outletLoading && <ActivityIndicator color={theme.primary} />}

      {outlets.length > 1 && (
        <>
          <ThemedText type="smallBold" themeColor="textSecondary">
            {t('checklists.chooseOutlet')}
          </ThemedText>
          <View style={styles.options}>
            {outlets.map((outlet) => (
              <Pressable
                key={outlet.id}
                accessibilityRole="radio"
                accessibilityState={{ selected: outlet.id === outletId }}
                onPress={() => {
                  // Photos are stored per outlet, so changing outlet starts them again.
                  setPhotos([]);
                  choose(outlet.id);
                }}
                style={option(outlet.id === outletId)}>
                <ThemedText type="default" themeColor={outlet.id === outletId ? 'primary' : 'text'}>
                  {outlet.name}
                </ThemedText>
              </Pressable>
            ))}
          </View>
        </>
      )}

      <ThemedText type="smallBold" themeColor="textSecondary">
        {t('support.category')}
      </ThemedText>
      <View style={styles.options}>
        {ISSUE_CATEGORIES.map((value) => (
          <Pressable
            key={value}
            accessibilityRole="radio"
            accessibilityState={{ selected: category === value }}
            onPress={() => setCategory(value)}
            style={option(category === value)}>
            <ThemedText type="default" themeColor={category === value ? 'primary' : 'text'}>
              {t(`category.${value}`)}
            </ThemedText>
          </Pressable>
        ))}
      </View>

      <TextField
        label={t('support.describe')}
        value={description}
        onChangeText={setDescription}
        placeholder={t('support.describePlaceholder')}
        maxLength={1000}
        multiline
        style={styles.description}
      />

      {photos.length > 0 && (
        <View style={styles.photos}>
          {photos.map((photo) => (
            <Image key={photo.id} source={{ uri: photo.uri }} style={[styles.photo, { backgroundColor: theme.backgroundElement }]} />
          ))}
        </View>
      )}
      {photos.length < MAX_PHOTOS && (
        <Button
          label={`📷  ${t('support.addPhoto')}`}
          variant="secondary"
          onPress={() => void addPhoto()}
          loading={uploading}
          disabled={!outletId}
        />
      )}

      <ErrorText message={error} />
      <Button
        label={t('support.send')}
        onPress={() => void send()}
        loading={sending}
        disabled={!outletId || !category || description.trim().length < MIN_DESCRIPTION || uploading}
      />
    </Screen>
  );
}

const styles = StyleSheet.create({
  options: { flexDirection: 'row', flexWrap: 'wrap', gap: Spacing.two },
  option: {
    minHeight: MinTouchSize,
    borderWidth: 2,
    borderRadius: Spacing.three,
    paddingHorizontal: Spacing.three,
    justifyContent: 'center',
  },
  description: { minHeight: 120, paddingVertical: Spacing.two, fontSize: 17, textAlignVertical: 'top' },
  photos: { flexDirection: 'row', flexWrap: 'wrap', gap: Spacing.two },
  photo: { width: 96, height: 96, borderRadius: Spacing.two },
});
