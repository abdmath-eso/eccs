import Ionicons from '@expo/vector-icons/Ionicons';
import { ApiError, type UploadFile } from '@eccs/api-client';
import { can, localize, type ChecklistItemDto, type ChecklistRunDto } from '@eccs/shared';
import { useLocalSearchParams } from 'expo-router';
import { useEffect, useRef, useState } from 'react';
import { ActivityIndicator, Pressable, StyleSheet, View, type ScrollView } from 'react-native';

import { ProofPhoto } from '@/components/proof-photo';
import { StatusBadge } from '@/components/status-badge';
import { ThemedText } from '@/components/themed-text';
import { Button } from '@/components/ui/button';
import { ErrorText } from '@/components/ui/error-text';
import { OptionChip } from '@/components/ui/option-chip';
import { Screen } from '@/components/ui/screen';
import { useSnackbar } from '@/components/ui/snackbar';
import { TextField } from '@/components/ui/text-field';
import { MinTouchSize, Spacing } from '@/constants/theme';
import { useTheme } from '@/hooks/use-theme';
import { errorMessage } from '@/lib/errors';
import { formatDateTime, formatDayLong } from '@/lib/format';
import { CameraPermissionError, takeProofPhoto } from '@/lib/photo';
import { scrollToY } from '@/lib/scroll';
import { useSession } from '@/lib/session';

/** The id of the photo behind a signed photo path such as /attachments/<id>/content?... */
const photoId = (photoPath: string) => photoPath.split('/')[2] ?? '';

/**
 * A photo taken on this phone for an item. It is kept, with its file, until
 * the server has it, so a failed upload can be sent again without retaking it.
 */
interface PendingPhoto {
  uri: string;
  file: UploadFile;
  capturedAt: string;
  /** Set once the picture itself is stored, so a retry only repeats the step that failed. */
  attachmentId?: string;
  status: 'sending' | 'failed' | 'sent';
}

/** What the person has started on an item and the server does not have yet. */
interface ItemDraft {
  /** True after tapping Problem and before the reason has been saved. */
  describing: boolean;
  /** The reason as typed; null means "as saved". */
  note: string | null;
  photo: PendingPhoto | null;
}

const NO_DRAFT: ItemDraft = { describing: false, note: null, photo: null };

// A photo item is done once it has its photo; a tick-only item once it is ticked or reported.
const isMissing = (item: ChecklistItemDto) => (item.photoRequired ? !item.response?.photoPath : !item.response);

/** A problem was started, or its reason reworded, and not saved. */
const hasUnsavedReason = (item: ChecklistItemDto, draft: ItemDraft) =>
  draft.describing ||
  (item.response?.passed === false && draft.note !== null && draft.note.trim() !== (item.response.note ?? ''));

const hasUnsentPhoto = (draft: ItemDraft) => draft.photo !== null && draft.photo.status !== 'sent';

type Blocker = { itemId: string; why: 'reason' | 'photo' | 'missing' };

/** One checklist: fill it in with a photo per item, submit it, or look back at what was recorded. */
export default function ChecklistRunScreen() {
  const theme = useTheme();
  const { t, api, user, language } = useSession();
  const notify = useSnackbar();
  const { runId } = useLocalSearchParams<{ runId: string }>();
  const [run, setRun] = useState<ChecklistRunDto | null>(null);
  const [loadError, setLoadError] = useState<string | null>(null);
  // An error from Submit or Mark as reviewed, shown beside that button.
  const [actionError, setActionError] = useState<string | null>(null);
  // Said at the top when someone else submitted the checklist while it was open here.
  const [lockedNote, setLockedNote] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [drafts, setDrafts] = useState<Record<string, ItemDraft>>({});
  // The item Submit last pointed at, and why it stops the checklist being submitted.
  const [blocker, setBlocker] = useState<Blocker | null>(null);
  const scrollRef = useRef<ScrollView>(null);
  // Where each item sits in the scrolling page, so Submit can jump to one.
  const positions = useRef<Record<string, number>>({});

  useEffect(() => {
    let cancelled = false;
    api.checklists
      .run(runId)
      .then((loaded) => !cancelled && setRun(loaded))
      .catch((e) => !cancelled && setLoadError(errorMessage(e, t)));
    return () => {
      cancelled = true;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [api, runId]);

  /** Loads the checklist again: for pull-to-refresh and "Try again". */
  async function load() {
    try {
      setRun(await api.checklists.run(runId));
      setLoadError(null);
    } catch (e) {
      setLoadError(errorMessage(e, t));
    }
  }

  if (!run) {
    return (
      <Screen back>
        <ErrorText message={loadError} onRetry={() => void load()} />
        {!loadError && <ActivityIndicator color={theme.primary} />}
      </Screen>
    );
  }

  const memberships = user?.memberships ?? [];
  const open = run.status === 'PENDING' || run.status === 'IN_PROGRESS';
  const mayFill = open && can(memberships, 'checklists', 'create', { outletId: run.outletId });
  const mayReview =
    run.status === 'SUBMITTED' && !run.reviewedAt && can(memberships, 'checklists', 'approve', { outletId: run.outletId });
  const total = run.items.length;
  const done = run.items.filter((item) => !isMissing(item)).length;
  const draftOf = (itemId: string) => drafts[itemId] ?? NO_DRAFT;

  function patchDraft(itemId: string, patch: Partial<ItemDraft>) {
    setDrafts((current) => ({ ...current, [itemId]: { ...(current[itemId] ?? NO_DRAFT), ...patch } }));
  }

  /** What, if anything, still stops this checklist being submitted: the first such item, top to bottom. */
  function findBlocker(): Blocker | null {
    const items = run?.items ?? [];
    const unsaved = items.find((item) => hasUnsavedReason(item, draftOf(item.id)));
    if (unsaved) return { itemId: unsaved.id, why: 'reason' };
    const unsent = items.find((item) => hasUnsentPhoto(draftOf(item.id)));
    if (unsent) return { itemId: unsent.id, why: 'photo' };
    const missing = items.find(isMissing);
    if (missing) return { itemId: missing.id, why: 'missing' };
    return null;
  }

  /** Whether the item Submit pointed at is still in the way; once it is dealt with the message goes. */
  function stillBlocked(found: Blocker): boolean {
    const item = run?.items.find((candidate) => candidate.id === found.itemId);
    if (!item) return false;
    if (found.why === 'reason') return hasUnsavedReason(item, draftOf(item.id));
    if (found.why === 'photo') return hasUnsentPhoto(draftOf(item.id));
    return isMissing(item);
  }

  const shownBlocker = blocker && stillBlocked(blocker) ? blocker : null;
  const blockerNumber = shownBlocker ? run.items.findIndex((item) => item.id === shownBlocker.itemId) + 1 : 0;
  const blockerMessage = shownBlocker
    ? t(
        shownBlocker.why === 'reason'
          ? 'checklists.unsavedReason'
          : shownBlocker.why === 'photo'
            ? 'checklists.unsentPhoto'
            : 'checklists.itemMissing',
        { number: blockerNumber },
      )
    : null;

  /**
   * Another person at the outlet submitted this checklist while it was open
   * here. Loads what they submitted, which locks the screen, and says who.
   */
  async function showLocked() {
    try {
      const latest = await api.checklists.run(runId);
      setRun(latest);
      setLockedNote(latest.submittedByName ? t('checklists.lockedBy', { name: latest.submittedByName }) : null);
      scrollToY(scrollRef, 0);
    } catch (e) {
      setActionError(errorMessage(e, t));
    }
  }

  async function act(action: () => Promise<ChecklistRunDto>, savedMessage: string) {
    setBusy(true);
    setActionError(null);
    try {
      setRun(await action());
      notify(savedMessage);
    } catch (e) {
      if (e instanceof ApiError && e.status === 409) await showLocked();
      else setActionError(errorMessage(e, t));
    } finally {
      setBusy(false);
    }
  }

  /** Submits, or, if something is still to do, scrolls to the first such item and marks it. */
  function pressSubmit() {
    const found = findBlocker();
    if (found) {
      setBlocker(found);
      setActionError(null);
      scrollToY(scrollRef, positions.current[found.itemId] ?? 0);
      return;
    }
    setBlocker(null);
    void act(() => api.checklists.submit(run!.id), t('checklists.submitted'));
  }

  const footer = mayFill ? (
    <>
      <ThemedText type="smallBold" themeColor="textSecondary">
        {t('checklists.progress', { done, total })}
      </ThemedText>
      <View
        accessibilityRole="progressbar"
        accessibilityValue={{ min: 0, max: total, now: done }}
        style={[styles.track, { backgroundColor: theme.border }]}>
        <View style={[styles.trackFill, { backgroundColor: theme.primary, width: `${total ? (done / total) * 100 : 0}%` }]} />
      </View>
      <ErrorText message={blockerMessage ?? actionError} />
      <Button label={t('checklists.submit')} onPress={pressSubmit} loading={busy} />
    </>
  ) : mayReview ? (
    <>
      <ErrorText message={actionError} />
      <Button
        label={t('checklists.markReviewed')}
        onPress={() => void act(() => api.checklists.review(run.id), t('checklists.reviewed'))}
        loading={busy}
      />
    </>
  ) : undefined;

  return (
    <Screen
      back
      title={localize(run.title, language)}
      subtitle={formatDayLong(run.date, language)}
      footer={footer}
      onRefresh={load}
      scrollRef={scrollRef}>
      <StatusBadge status={run.status} reviewed={run.reviewedAt !== null} />
      <ErrorText message={lockedNote} />
      {/* A refresh that fails leaves the checklist as it was, and says so here. */}
      <ErrorText message={loadError} onRetry={() => void load()} />
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
          draft={draftOf(item.id)}
          onDraft={(patch) => patchDraft(item.id, patch)}
          flagged={shownBlocker?.itemId === item.id && shownBlocker.why === 'missing'}
          onPlaced={(y) => {
            positions.current[item.id] = y;
          }}
          onSaved={setRun}
          onLocked={() => void showLocked()}
        />
      ))}
    </Screen>
  );
}

interface ItemCardProps {
  number: number;
  item: ChecklistItemDto;
  run: ChecklistRunDto;
  editable: boolean;
  draft: ItemDraft;
  onDraft: (patch: Partial<ItemDraft>) => void;
  /** Submit was pressed while this item was still to do. */
  flagged: boolean;
  /** Reports how far down the page this card starts. */
  onPlaced: (y: number) => void;
  onSaved: (run: ChecklistRunDto) => void;
  /** Called when the server says the checklist was already submitted by someone else. */
  onLocked: () => void;
}

const isLocked = (error: unknown) => error instanceof ApiError && error.status === 409;

function ItemCard({ number, item, run, editable, draft, onDraft, flagged, onPlaced, onSaved, onLocked }: ItemCardProps) {
  const theme = useTheme();
  const { t, api, language } = useSession();
  const notify = useSnackbar();
  const response = item.response;
  // Each error is shown beside the control that caused it.
  const [error, setError] = useState<{ at: 'photo' | 'answer' | 'reason'; message: string } | null>(null);
  const [noteError, setNoteError] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);
  const tickOnly = !item.photoRequired;

  const pending = draft.photo;
  const uploading = pending?.status === 'sending';
  const photoFailed = pending?.status === 'failed';
  const photoUri = pending?.uri ?? (response?.photoPath ? api.fileUrl(response.photoPath) : null);
  const problem = response?.passed === false;
  const note = draft.note ?? response?.note ?? '';
  // "Problem" was tapped, or the reason reworded, and the server does not know yet.
  const unsaved = hasUnsavedReason(item, draft);
  const showReason = problem || draft.describing;

  /** Sends a photo and records it against the item. Also used to send a failed one again. */
  async function sendPhoto(photo: PendingPhoto) {
    setError(null);
    onDraft({ photo: { ...photo, status: 'sending' } });
    let attachmentId = photo.attachmentId;
    try {
      if (!attachmentId) {
        const uploaded = await api.attachments.upload({
          outletId: run.outletId,
          file: photo.file,
          capturedAt: photo.capturedAt,
        });
        attachmentId = uploaded.id;
      }
      const saved = await api.checklists.answer(run.id, item.id, {
        passed: response?.passed ?? true,
        note: response?.note ?? undefined,
        attachmentId,
        capturedAt: photo.capturedAt,
      });
      onDraft({ photo: { ...photo, attachmentId, status: 'sent' } });
      onSaved(saved);
    } catch (e) {
      // The photo stays on the card, marked as not sent, so it can be sent again as it is.
      onDraft({ photo: { ...photo, attachmentId, status: 'failed' } });
      if (isLocked(e)) onLocked();
      else setError({ at: 'photo', message: errorMessage(e, t, { 0: 'error.upload' }) });
    }
  }

  async function takePhoto() {
    setError(null);
    let photo;
    try {
      photo = await takeProofPhoto();
    } catch (e) {
      setError({ at: 'photo', message: t(e instanceof CameraPermissionError ? 'error.camera' : 'error.generic') });
      return;
    }
    if (!photo) return;
    await sendPhoto({ uri: photo.uri, file: photo.file, capturedAt: new Date().toISOString(), status: 'sending' });
  }

  /**
   * Saves OK / Problem and the note. A photo item keeps the photo already
   * taken and cannot be answered before it has one; a tick-only item can.
   * Returns whether it was saved.
   */
  async function update(passed: boolean, nextNote: string, at: 'answer' | 'reason'): Promise<boolean> {
    if (item.photoRequired && !response?.photoPath) return false;
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
      return true;
    } catch (e) {
      if (isLocked(e)) onLocked();
      else setError({ at, message: errorMessage(e, t) });
      return false;
    } finally {
      setSaving(false);
    }
  }

  /** Tick-only items: one tap marks it done, another tap takes the tick back. */
  async function toggleTick() {
    if (saving) return;
    if (!response) {
      await update(true, '', 'answer');
      return;
    }
    setError(null);
    setSaving(true);
    try {
      onSaved(await api.checklists.clearAnswer(run.id, item.id));
      onDraft({ note: null });
    } catch (e) {
      if (isLocked(e)) onLocked();
      else setError({ at: 'answer', message: errorMessage(e, t) });
    } finally {
      setSaving(false);
    }
  }

  /** Puts the reason box back to what is saved. */
  function cancelReason() {
    onDraft({ describing: false, note: null });
    setNoteError(null);
    setError(null);
  }

  async function saveReason() {
    const text = note.trim();
    if (!text) {
      setNoteError(t('checklists.noteNeeded'));
      return;
    }
    if (await update(false, text, 'reason')) {
      onDraft({ describing: false, note: null });
      notify(t('checklists.problemFound'));
    }
  }

  async function chooseOk() {
    if (!problem) {
      cancelReason();
      return;
    }
    if (await update(true, '', 'answer')) cancelReason();
  }

  // The proof details shown on the photo: when it was taken and by whom.
  const when = response ? formatDateTime(response.capturedAt, language) : null;
  const stamp = when ? (response?.takenByName ? `${when} · ${response.takenByName}` : when) : null;

  const state: { icon: keyof typeof Ionicons.glyphMap | null; text: string; color: string } = unsaved
    ? { icon: 'create', text: t('checklists.notSavedYet'), color: theme.warning }
    : !response
      ? { icon: null, text: t(tickOnly ? 'checklists.toDo' : 'checklists.photoNeeded'), color: theme.textSecondary }
      : problem
        ? { icon: 'alert', text: t('checklists.problemFound'), color: theme.danger }
        : { icon: 'checkmark', text: t('checklists.done'), color: theme.primary };
  const filled = state.icon !== null;

  return (
    <View
      onLayout={(event) => onPlaced(event.nativeEvent.layout.y)}
      style={[
        styles.card,
        { borderColor: filled ? state.color : theme.outline },
        flagged && { borderColor: theme.danger, borderWidth: 3 },
      ]}>
      <View style={styles.header}>
        <ThemedText type="default" style={styles.label}>
          {number}. {localize(item.label, language)}
        </ThemedText>
        <View style={[styles.mark, { borderColor: state.color }, filled && { backgroundColor: state.color }]}>
          {state.icon && <Ionicons name={state.icon} size={20} color={theme.onPrimary} />}
        </View>
      </View>
      <ThemedText type="smallBold" style={{ color: state.color }}>
        {state.text}
        {item.isCustom ? `  ·  ${t('checklists.yourItem')}` : ''}
      </ThemedText>
      {flagged && <ErrorText message={t('checklists.stillToDo')} />}

      {photoUri && (
        <ProofPhoto
          uri={photoUri}
          label={localize(item.label, language)}
          stamp={stamp}
          state={uploading ? 'sending' : photoFailed ? 'failed' : null}
          onRetry={pending ? () => void sendPhoto(pending) : undefined}
        />
      )}
      {error?.at === 'photo' && <ErrorText message={error.message} />}

      {editable && !tickOnly && photoFailed && pending && (
        <Button label={t('checklists.sendAgain')} onPress={() => void sendPhoto(pending)} />
      )}
      {editable && !tickOnly && (
        <Button
          icon="camera"
          label={uploading ? t('checklists.uploading') : photoUri ? t('checklists.retakePhoto') : t('checklists.takePhoto')}
          variant={photoUri ? 'secondary' : 'primary'}
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
            { borderColor: response ? theme.primary : theme.outline },
            (response || pressed) && { backgroundColor: theme.backgroundElement },
          ]}>
          {saving && !draft.describing ? (
            <ActivityIndicator color={theme.primary} style={styles.tickBusy} />
          ) : (
            <Ionicons
              name={response ? 'checkmark-circle' : 'ellipse-outline'}
              size={44}
              color={response ? theme.primary : theme.textSecondary}
            />
          )}
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
      {editable && tickOnly && !problem && !draft.describing && (
        <Button label={t('checklists.reportProblem')} variant="link" onPress={() => onDraft({ describing: true })} />
      )}
      {tickOnly && response && (problem || !editable) && stamp && (
        <ThemedText type="small" themeColor="textSecondary">
          {stamp}
        </ThemedText>
      )}

      {/* The chips show what is saved. Tapping Problem only opens the reason box below; it is saved from there. */}
      {editable && response && (!tickOnly || problem) && (
        <View style={styles.choices}>
          <View style={styles.choice}>
            <OptionChip label={t('checklists.ok')} selected={!problem} onPress={() => void chooseOk()} disabled={saving} />
          </View>
          <View style={styles.choice}>
            <OptionChip
              label={t('checklists.problem')}
              selected={problem}
              onPress={() => onDraft({ describing: true })}
              disabled={saving}
            />
          </View>
        </View>
      )}
      {error?.at === 'answer' && <ErrorText message={error.message} />}

      {editable && showReason && (response || tickOnly) && (
        <View style={[styles.reason, unsaved && [styles.reasonUnsaved, { borderColor: theme.warning }]]}>
          {unsaved && (
            <View style={styles.unsavedNote}>
              <Ionicons name="create" size={22} color={theme.warning} />
              <ThemedText type="smallBold" themeColor="warning" style={styles.unsavedText}>
                {t('checklists.problemNotSaved')}
              </ThemedText>
            </View>
          )}
          <TextField
            label={t('checklists.noteLabel')}
            hint={t('checklists.noteHint')}
            error={noteError}
            value={note}
            onChangeText={(text) => {
              onDraft({ note: text });
              setNoteError(null);
            }}
            maxLength={500}
            multiline
            autoFocus={draft.describing}
            style={styles.note}
          />
          {error?.at === 'reason' && <ErrorText message={error.message} />}
          {unsaved && (
            <>
              <Button label={t('checklists.saveNote')} variant="danger" loading={saving} onPress={() => void saveReason()} />
              <Button label={t('common.cancel')} variant="link" onPress={cancelReason} disabled={saving} />
            </>
          )}
        </View>
      )}

      {!editable && response && (
        <View style={styles.recorded}>
          <Ionicons
            name={problem ? 'alert-circle' : 'checkmark-circle'}
            size={22}
            color={problem ? theme.danger : theme.primary}
          />
          <ThemedText type="default" themeColor={problem ? 'danger' : 'primary'} style={styles.recordedText}>
            {t(problem ? 'checklists.problem' : 'checklists.ok')}
            {response.note ? `: ${response.note}` : ''}
          </ThemedText>
        </View>
      )}
    </View>
  );
}

const styles = StyleSheet.create({
  card: { borderWidth: 2, borderRadius: Spacing.three, padding: Spacing.three, gap: Spacing.two },
  header: { flexDirection: 'row', alignItems: 'flex-start', gap: Spacing.two },
  label: { flex: 1, fontWeight: 700, fontSize: 18, lineHeight: 26 },
  mark: { width: 32, height: 32, borderRadius: 16, borderWidth: 2, alignItems: 'center', justifyContent: 'center' },
  choices: { flexDirection: 'row', gap: Spacing.two },
  choice: { flex: 1 },
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
  tickBusy: { width: 44, height: 44 },
  tickText: { flex: 1, gap: Spacing.half },
  tickLabel: { fontWeight: 700, fontSize: 18 },
  reason: { gap: Spacing.two },
  // A dashed edge as well as the colour, so "not saved" does not rely on colour alone.
  reasonUnsaved: { borderWidth: 2, borderStyle: 'dashed', borderRadius: Spacing.three, padding: Spacing.three },
  unsavedNote: { flexDirection: 'row', alignItems: 'flex-start', gap: Spacing.two },
  unsavedText: { flex: 1 },
  note: { minHeight: 88, paddingVertical: Spacing.two, fontSize: 17, textAlignVertical: 'top' },
  recorded: { flexDirection: 'row', alignItems: 'flex-start', gap: Spacing.two },
  recordedText: { flex: 1 },
  track: { height: 6, borderRadius: 3, overflow: 'hidden' },
  trackFill: { height: '100%', borderRadius: 3 },
});
