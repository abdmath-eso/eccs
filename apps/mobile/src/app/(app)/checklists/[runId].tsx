import { can, localize, type ChecklistItemDto, type ChecklistRunDto } from '@eccs/shared';
import { useLocalSearchParams } from 'expo-router';
import { useEffect, useState } from 'react';
import { ActivityIndicator, Image, Pressable, StyleSheet, View } from 'react-native';

import { StatusBadge } from '@/components/status-badge';
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

/** The id of the photo behind a signed photo path such as /attachments/<id>/content?... */
const photoId = (photoPath: string) => photoPath.split('/')[2] ?? '';

/** One checklist: fill it in with a photo per item, submit it, or look back at what was recorded. */
export default function ChecklistRunScreen() {
  const theme = useTheme();
  const { t, api, user, language } = useSession();
  const { runId } = useLocalSearchParams<{ runId: string }>();
  const [run, setRun] = useState<ChecklistRunDto | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    let cancelled = false;
    api.checklists
      .run(runId)
      .then((loaded) => !cancelled && setRun(loaded))
      .catch((e) => !cancelled && setError(errorMessage(e, t)));
    return () => {
      cancelled = true;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [api, runId]);

  if (!run) {
    return (
      <Screen back>
        <ErrorText message={error} />
        {!error && <ActivityIndicator color={theme.primary} />}
      </Screen>
    );
  }

  const memberships = user?.memberships ?? [];
  const open = run.status === 'PENDING' || run.status === 'IN_PROGRESS';
  const mayFill = open && can(memberships, 'checklists', 'create', { outletId: run.outletId });
  const mayReview =
    run.status === 'SUBMITTED' && !run.reviewedAt && can(memberships, 'checklists', 'approve', { outletId: run.outletId });
  const missing = run.items.filter((item) => !item.response?.photoPath).length;

  async function act(action: () => Promise<ChecklistRunDto>) {
    setBusy(true);
    setError(null);
    try {
      setRun(await action());
    } catch (e) {
      setError(errorMessage(e, t));
    } finally {
      setBusy(false);
    }
  }

  return (
    <Screen back title={localize(run.title, language)} subtitle={run.date}>
      <StatusBadge status={run.status} reviewed={run.reviewedAt !== null} />
      {run.status === 'MISSED' && (
        <ThemedText type="default" themeColor="danger">
          {t('checklists.missedNote')}
        </ThemedText>
      )}
      {run.submittedByName && (
        <ThemedText type="small" themeColor="textSecondary">
          {t('checklists.submittedBy', { name: run.submittedByName })}
          {run.reviewedByName ? ` · ${t('checklists.reviewedBy', { name: run.reviewedByName })}` : ''}
        </ThemedText>
      )}

      {run.items.map((item, index) => (
        <ItemCard
          key={item.id}
          number={index + 1}
          item={item}
          run={run}
          editable={mayFill}
          onSaved={setRun}
        />
      ))}

      <ErrorText message={error} />

      {mayFill && (
        <>
          {missing > 0 && (
            <ThemedText type="default" themeColor="textSecondary" style={styles.center}>
              {t('checklists.photosNeeded', { count: missing })}
            </ThemedText>
          )}
          <Button
            label={t('checklists.submit')}
            onPress={() => void act(() => api.checklists.submit(run.id))}
            loading={busy}
            disabled={missing > 0}
          />
        </>
      )}
      {mayReview && (
        <Button
          label={t('checklists.markReviewed')}
          onPress={() => void act(() => api.checklists.review(run.id))}
          loading={busy}
        />
      )}
    </Screen>
  );
}

interface ItemCardProps {
  number: number;
  item: ChecklistItemDto;
  run: ChecklistRunDto;
  editable: boolean;
  onSaved: (run: ChecklistRunDto) => void;
}

function ItemCard({ number, item, run, editable, onSaved }: ItemCardProps) {
  const theme = useTheme();
  const { t, api, language } = useSession();
  const response = item.response;
  const [uploading, setUploading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [note, setNote] = useState(response?.note ?? '');
  const [localPhoto, setLocalPhoto] = useState<string | null>(null);

  const photoUri = localPhoto ?? (response?.photoPath ? api.fileUrl(response.photoPath) : null);
  const problem = response?.passed === false;

  async function takePhoto() {
    setError(null);
    let photo;
    try {
      photo = await takeProofPhoto();
    } catch (e) {
      setError(t(e instanceof CameraPermissionError ? 'error.camera' : 'error.generic'));
      return;
    }
    if (!photo) return;

    setLocalPhoto(photo.uri);
    setUploading(true);
    try {
      const capturedAt = new Date().toISOString();
      const uploaded = await api.attachments.upload({ outletId: run.outletId, file: photo.file, capturedAt });
      onSaved(
        await api.checklists.answer(run.id, item.id, {
          passed: response?.passed ?? true,
          note: response?.note ?? undefined,
          attachmentId: uploaded.id,
          capturedAt,
        }),
      );
    } catch (e) {
      setLocalPhoto(null);
      setError(errorMessage(e, t, { 0: 'error.upload' }));
    } finally {
      setUploading(false);
    }
  }

  /** Changes OK / Problem or the note, keeping the photo already taken. */
  async function update(passed: boolean, nextNote: string) {
    if (!response?.photoPath) return;
    setError(null);
    try {
      onSaved(
        await api.checklists.answer(run.id, item.id, {
          passed,
          note: passed ? undefined : nextNote,
          attachmentId: photoId(response.photoPath),
          capturedAt: response.capturedAt,
        }),
      );
    } catch (e) {
      setError(errorMessage(e, t));
    }
  }

  const choice = (selected: boolean, color: string) => [
    styles.choice,
    { borderColor: selected ? color : theme.border },
    selected && { backgroundColor: theme.backgroundElement },
  ];

  return (
    <View style={[styles.card, { borderColor: response ? (problem ? theme.danger : theme.primary) : theme.border }]}>
      <ThemedText type="default" style={styles.label}>
        {number}. {localize(item.label, language)}
      </ThemedText>
      {item.isCustom && (
        <ThemedText type="small" themeColor="textSecondary">
          {t('checklists.yourItem')}
        </ThemedText>
      )}

      {photoUri && (
        <Image
          source={{ uri: photoUri }}
          style={[styles.photo, { backgroundColor: theme.backgroundElement }]}
          resizeMode="cover"
          accessibilityLabel={localize(item.label, language)}
        />
      )}

      {editable && (
        <Button
          label={uploading ? t('checklists.uploading') : response ? t('checklists.retakePhoto') : `📷  ${t('checklists.takePhoto')}`}
          variant={response ? 'secondary' : 'primary'}
          onPress={() => void takePhoto()}
          loading={uploading}
        />
      )}

      {editable && response && (
        <View style={styles.choices}>
          <Pressable
            accessibilityRole="button"
            accessibilityState={{ selected: !problem }}
            onPress={() => void update(true, '')}
            style={choice(!problem, theme.primary)}>
            <ThemedText type="default" themeColor={!problem ? 'primary' : 'text'}>
              ✓ {t('checklists.ok')}
            </ThemedText>
          </Pressable>
          <Pressable
            accessibilityRole="button"
            accessibilityState={{ selected: problem }}
            onPress={() => void update(false, note)}
            style={choice(problem, theme.danger)}>
            <ThemedText type="default" themeColor={problem ? 'danger' : 'text'}>
              ✕ {t('checklists.problem')}
            </ThemedText>
          </Pressable>
        </View>
      )}

      {editable && problem && (
        <>
          <TextField value={note} onChangeText={setNote} placeholder={t('checklists.notePlaceholder')} maxLength={500} />
          {note.trim() !== (response?.note ?? '') && (
            <Button label={t('checklists.saveNote')} variant="secondary" onPress={() => void update(false, note)} />
          )}
        </>
      )}

      {!editable && response && (
        <ThemedText type="default" themeColor={problem ? 'danger' : 'primary'}>
          {problem ? `✕ ${t('checklists.problem')}` : `✓ ${t('checklists.ok')}`}
          {response.note ? `: ${response.note}` : ''}
        </ThemedText>
      )}

      <ErrorText message={error} />
    </View>
  );
}

const styles = StyleSheet.create({
  card: { borderWidth: 2, borderRadius: Spacing.three, padding: Spacing.three, gap: Spacing.two },
  label: { fontWeight: 700, fontSize: 18, lineHeight: 26 },
  photo: { width: '100%', height: 180, borderRadius: Spacing.two },
  choices: { flexDirection: 'row', gap: Spacing.two },
  choice: {
    flex: 1,
    minHeight: MinTouchSize,
    borderWidth: 2,
    borderRadius: Spacing.three,
    alignItems: 'center',
    justifyContent: 'center',
  },
  center: { textAlign: 'center' },
});
