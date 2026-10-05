import Ionicons from '@expo/vector-icons/Ionicons';
import { ApiError } from '@eccs/api-client';
import { can, localize, type ChecklistItemDto, type ChecklistRunDto } from '@eccs/shared';
import { useLocalSearchParams } from 'expo-router';
import { useEffect, useState } from 'react';
import { ActivityIndicator, Pressable, StyleSheet, View } from 'react-native';

import { ProofPhoto } from '@/components/proof-photo';
import { StatusBadge } from '@/components/status-badge';
import { ThemedText } from '@/components/themed-text';
import { Button } from '@/components/ui/button';
import { ErrorText } from '@/components/ui/error-text';
import { Screen } from '@/components/ui/screen';
import { TextField } from '@/components/ui/text-field';
import { MinTouchSize, Spacing } from '@/constants/theme';
import { useTheme } from '@/hooks/use-theme';
import { errorMessage } from '@/lib/errors';
import { formatDateTime } from '@/lib/format';
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
  // A photo item is done once it has its photo; a tick-only item once it is ticked or reported.
  const missing = run.items.filter((item) => (item.photoRequired ? !item.response?.photoPath : !item.response)).length;

  /**
   * Another person at the outlet submitted this checklist while it was open
   * here. Loads what they submitted, which locks the screen, and says who.
   */
  async function showLocked() {
    try {
      const latest = await api.checklists.run(runId);
      setRun(latest);
      setError(latest.submittedByName ? t('checklists.lockedBy', { name: latest.submittedByName }) : null);
    } catch (e) {
      setError(errorMessage(e, t));
    }
  }

  async function act(action: () => Promise<ChecklistRunDto>) {
    setBusy(true);
    setError(null);
    try {
      setRun(await action());
    } catch (e) {
      if (e instanceof ApiError && e.status === 409) await showLocked();
      else setError(errorMessage(e, t));
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
          onLocked={() => void showLocked()}
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
  /** Called when the server says the checklist was already submitted by someone else. */
  onLocked: () => void;
}

const isLocked = (error: unknown) => error instanceof ApiError && error.status === 409;

function ItemCard({ number, item, run, editable, onSaved, onLocked }: ItemCardProps) {
  const theme = useTheme();
  const { t, api, language } = useSession();
  const response = item.response;
  const [uploading, setUploading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [note, setNote] = useState(response?.note ?? '');
  const [localPhoto, setLocalPhoto] = useState<string | null>(null);
  // True after tapping Problem and before the reason has been saved.
  const [describing, setDescribing] = useState(false);
  const [saving, setSaving] = useState(false);
  const tickOnly = !item.photoRequired;

  const photoUri = localPhoto ?? (response?.photoPath ? api.fileUrl(response.photoPath) : null);
  const problem = response?.passed === false;
  const showProblem = problem || describing;

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
      if (isLocked(e)) onLocked();
      else setError(errorMessage(e, t, { 0: 'error.upload' }));
    } finally {
      setUploading(false);
    }
  }

  /**
   * Saves OK / Problem and the note. A photo item keeps the photo already
   * taken and cannot be answered before it has one; a tick-only item can.
   */
  async function update(passed: boolean, nextNote: string) {
    if (item.photoRequired && !response?.photoPath) return;
    setError(null);
    setSaving(true);
    try {
      onSaved(
        await api.checklists.answer(run.id, item.id, {
          passed,
          note: passed ? undefined : nextNote,
          attachmentId: response?.photoPath ? photoId(response.photoPath) : undefined,
          capturedAt: response?.capturedAt ?? new Date().toISOString(),
        }),
      );
    } catch (e) {
      if (isLocked(e)) onLocked();
      else setError(errorMessage(e, t));
    } finally {
      setSaving(false);
    }
  }

  /** Tick-only items: one tap marks it done, another tap takes the tick back. */
  async function toggleTick() {
    if (saving) return;
    if (!response) {
      await update(true, '');
      return;
    }
    setError(null);
    setSaving(true);
    try {
      onSaved(await api.checklists.clearAnswer(run.id, item.id));
      setNote('');
    } catch (e) {
      if (isLocked(e)) onLocked();
      else setError(errorMessage(e, t));
    } finally {
      setSaving(false);
    }
  }

  const choice = (selected: boolean, color: string) => [
    styles.choice,
    { borderColor: selected ? color : theme.border },
    selected && { backgroundColor: theme.backgroundElement },
  ];

  // The proof details shown on the photo: when it was taken and by whom.
  const when = response ? formatDateTime(response.capturedAt, language) : null;
  const stamp = when ? (response?.takenByName ? `${when} · ${response.takenByName}` : when) : null;

  const state = !response
    ? { mark: '○', text: t(tickOnly ? 'checklists.toDo' : 'checklists.photoNeeded'), color: theme.textSecondary }
    : problem
      ? { mark: '!', text: t('checklists.problemFound'), color: theme.danger }
      : { mark: '✓', text: t('checklists.done'), color: theme.primary };

  return (
    <View style={[styles.card, { borderColor: response ? state.color : theme.border }]}>
      <View style={styles.header}>
        <ThemedText type="default" style={styles.label}>
          {number}. {localize(item.label, language)}
        </ThemedText>
        <View style={[styles.mark, { borderColor: state.color }, response && { backgroundColor: state.color }]}>
          <ThemedText style={[styles.markText, { color: response ? theme.onPrimary : state.color }]}>{state.mark}</ThemedText>
        </View>
      </View>
      <ThemedText type="smallBold" style={{ color: state.color }}>
        {state.text}
        {item.isCustom ? `  ·  ${t('checklists.yourItem')}` : ''}
      </ThemedText>

      {photoUri && <ProofPhoto uri={photoUri} label={localize(item.label, language)} stamp={uploading ? null : stamp} />}

      {editable && !tickOnly && (
        <Button
          label={uploading ? t('checklists.uploading') : response ? t('checklists.retakePhoto') : `📷  ${t('checklists.takePhoto')}`}
          variant={response ? 'secondary' : 'primary'}
          onPress={() => void takePhoto()}
          loading={uploading}
        />
      )}

      {/* Tick-only items: one large tap target instead of the camera. */}
      {editable && tickOnly && !problem && (
        <Pressable
          accessibilityRole="checkbox"
          accessibilityState={{ checked: response !== null, busy: saving }}
          accessibilityLabel={localize(item.label, language)}
          onPress={() => void toggleTick()}
          style={({ pressed }) => [
            styles.tickRow,
            { borderColor: response ? theme.primary : theme.border },
            (response || pressed) && { backgroundColor: theme.backgroundElement },
          ]}>
          <Ionicons
            name={response ? 'checkmark-circle' : 'ellipse-outline'}
            size={44}
            color={response ? theme.primary : theme.textSecondary}
          />
          <View style={styles.tickText}>
            <ThemedText type="default" style={styles.tickLabel} themeColor={response ? 'primary' : 'text'}>
              {response ? t('checklists.done') : t('checklists.tapToTick')}
            </ThemedText>
            <ThemedText type="small" themeColor="textSecondary">
              {response ? `${stamp}  ·  ${t('checklists.tapToUndo')}` : t('checklists.noPhotoNeeded')}
            </ThemedText>
          </View>
        </Pressable>
      )}
      {editable && tickOnly && !problem && !describing && (
        <Button label={`✕  ${t('checklists.reportProblem')}`} variant="link" onPress={() => setDescribing(true)} />
      )}
      {tickOnly && response && (problem || !editable) && stamp && (
        <ThemedText type="small" themeColor="textSecondary">
          {stamp}
        </ThemedText>
      )}

      {editable && response && (!tickOnly || problem) && (
        <View style={styles.choices}>
          <Pressable
            accessibilityRole="button"
            accessibilityState={{ selected: !showProblem }}
            onPress={() => {
              setDescribing(false);
              if (problem) void update(true, '');
            }}
            style={choice(!showProblem, theme.primary)}>
            <ThemedText type="default" themeColor={!showProblem ? 'primary' : 'text'}>
              ✓ {t('checklists.ok')}
            </ThemedText>
          </Pressable>
          <Pressable
            accessibilityRole="button"
            accessibilityState={{ selected: showProblem }}
            onPress={() => setDescribing(true)}
            style={choice(showProblem, theme.danger)}>
            <ThemedText type="default" themeColor={showProblem ? 'danger' : 'text'}>
              ✕ {t('checklists.problem')}
            </ThemedText>
          </Pressable>
        </View>
      )}

      {editable && showProblem && (response || tickOnly) && (
        <>
          <TextField
            value={note}
            onChangeText={setNote}
            placeholder={t('checklists.notePlaceholder')}
            maxLength={500}
            multiline
            style={styles.note}
          />
          {note.trim() !== (response?.note ?? '') && (
            <Button
              label={t('checklists.saveNote')}
              variant="danger"
              disabled={note.trim().length === 0}
              onPress={() => void update(false, note.trim()).then(() => setDescribing(false))}
            />
          )}
          {tickOnly && !problem && (
            <Button label={t('common.cancel')} variant="link" onPress={() => setDescribing(false)} />
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
  header: { flexDirection: 'row', alignItems: 'flex-start', gap: Spacing.two },
  label: { flex: 1, fontWeight: 700, fontSize: 18, lineHeight: 26 },
  mark: { width: 32, height: 32, borderRadius: 16, borderWidth: 2, alignItems: 'center', justifyContent: 'center' },
  markText: { fontSize: 18, lineHeight: 22, fontWeight: 700 },
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
  tickRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: Spacing.three,
    minHeight: MinTouchSize * 1.4,
    borderWidth: 2,
    borderRadius: Spacing.three,
    paddingHorizontal: Spacing.three,
    paddingVertical: Spacing.two,
  },
  tickText: { flex: 1, gap: Spacing.half },
  tickLabel: { fontWeight: 700, fontSize: 18 },
  note: { minHeight: 88, paddingVertical: Spacing.two, fontSize: 17, textAlignVertical: 'top' },
});
