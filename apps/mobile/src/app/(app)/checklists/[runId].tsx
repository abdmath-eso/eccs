import Ionicons from '@expo/vector-icons/Ionicons';
import { ApiError } from '@eccs/api-client';
import { can, localize, type ChecklistItemDto, type ChecklistRunDto } from '@eccs/shared';
import { useFocusEffect, useLocalSearchParams } from 'expo-router';
import { useCallback, useEffect, useRef, useState, useSyncExternalStore } from 'react';
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
import { UnsentMark } from '@/components/unsent-mark';
import { MinTouchSize, Spacing } from '@/constants/theme';
import { useTheme } from '@/hooks/use-theme';
import { errorMessage } from '@/lib/errors';
import { formatDateTime, formatDayLong } from '@/lib/format';
import { checklistCache } from '@/lib/offline/checklist-cache';
import { keepPhoto, keptPhotoUri, newId } from '@/lib/offline/files';
import { isNoSignal, outbox, useOutbox } from '@/lib/offline/outbox';
import { applyPending, type NewOp, type RunView } from '@/lib/offline/outbox-core';
import { CameraPermissionError, takeProofPhoto } from '@/lib/photo';
import { scrollToY } from '@/lib/scroll';
import { useSession } from '@/lib/session';

// How this screen works without signal. Everything the person does (a photo,
// a tick, OK or Problem, Submit) is first saved on the phone in the "outbox"
// and shown as done at once; the outbox sends it to the server in the
// background, in order, whenever there is signal (see lib/offline). The
// checklist itself is the server's last copy, kept on the phone, with whatever
// is still waiting laid over it. So the screen never waits for the network,
// and nothing here fails just because the signal dropped.

/** The id of the photo behind a signed photo path such as /attachments/<id>/content?... */
const photoId = (photoPath: string) => photoPath.split('/')[2] ?? '';

/** What the person has started on an item and not saved yet. */
interface ItemDraft {
  /** True after tapping Problem and before the reason has been saved. */
  describing: boolean;
  /** The reason as typed; null means "as saved". */
  note: string | null;
}

const NO_DRAFT: ItemDraft = { describing: false, note: null };

/** What is known on this phone about an item beyond the server's copy. */
type LocalItem = RunView['items'][string] | undefined;

// A photo item is done once it has its photo (on the server, or taken and kept on this phone);
// a tick-only item once it is ticked or reported.
const isMissing = (item: ChecklistItemDto, local: LocalItem) =>
  item.photoRequired ? !(item.response && (item.response.photoPath || local?.localPhotoId)) : !item.response;

/** A problem was started, or its reason reworded, and not saved. */
const hasUnsavedReason = (item: ChecklistItemDto, draft: ItemDraft) =>
  draft.describing ||
  (item.response?.passed === false && draft.note !== null && draft.note.trim() !== (item.response.note ?? ''));

type Blocker = { itemId: string; why: 'reason' | 'missing' };

/** One checklist: fill it in with a photo per item, submit it, or look back at what was recorded. */
export default function ChecklistRunScreen() {
  const theme = useTheme();
  const { t, api, user, language } = useSession();
  const notify = useSnackbar();
  const { runId } = useLocalSearchParams<{ runId: string }>();
  const box = useOutbox();
  // The checklist as the server last sent it, from the copy kept on the phone.
  const getSaved = useCallback(() => checklistCache.getRun(runId), [runId]);
  const saved = useSyncExternalStore(checklistCache.subscribe, getSaved, getSaved);
  const [loadError, setLoadError] = useState<string | null>(null);
  // An error from Submit or Mark as reviewed, shown beside that button.
  const [actionError, setActionError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [drafts, setDrafts] = useState<Record<string, ItemDraft>>({});
  // The item Submit last pointed at, and why it stops the checklist being submitted.
  const [blocker, setBlocker] = useState<Blocker | null>(null);
  const scrollRef = useRef<ScrollView>(null);
  // Where each item sits in the scrolling page, so Submit can jump to one.
  const positions = useRef<Record<string, number>>({});

  const userId = user?.id ?? null;
  const myName = user?.name ?? null;
  // False only once the server could not be reached; the line at the bottom of the app says so.
  const hasSignal = box.online !== false;

  /**
   * Fetches the checklist and keeps it on the phone. With no signal the copy
   * already on the phone stays on screen, which is not an error.
   */
  const load = useCallback(async () => {
    if (!userId) return;
    await checklistCache.load(userId);
    try {
      checklistCache.putRun(await api.checklists.run(runId));
      outbox.noteReachable(true);
      setLoadError(null);
    } catch (e) {
      if (isNoSignal(e)) {
        outbox.noteReachable(false);
        setLoadError(checklistCache.getRun(runId) ? null : t('offline.notOnPhone'));
      } else {
        setLoadError(errorMessage(e, t));
      }
    }
    // `t` changes with language; reloading for that is unnecessary.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [api, runId, userId]);

  // Loads on opening and whenever the screen comes back into view.
  useFocusEffect(
    useCallback(() => {
      void load();
    }, [load]),
  );

  // And again the moment the signal comes back.
  useEffect(() => {
    let before = outbox.getSnapshot().online;
    return outbox.subscribe(() => {
      const now = outbox.getSnapshot().online;
      if (before === false && now === true) void load();
      before = now;
    });
  }, [load]);

  const view = saved ? applyPending(saved, box.ops, myName) : null;
  const submitWaiting = view?.submitPending ?? false;
  const submittedByMe = saved?.status === 'SUBMITTED' && saved.submittedByName === myName;

  // "Checklist submitted" is said when the server has it, not when Submit was pressed.
  const wasWaiting = useRef(false);
  useEffect(() => {
    if (wasWaiting.current && !submitWaiting && submittedByMe) notify(t('checklists.submitted'));
    wasWaiting.current = submitWaiting;
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [submitWaiting, submittedByMe]);

  if (!view) {
    return (
      <Screen back>
        <ErrorText message={loadError} onRetry={() => void load()} />
        {!loadError && <ActivityIndicator color={theme.primary} />}
      </Screen>
    );
  }

  const run = view.run;
  const localItems = view.items;
  const memberships = user?.memberships ?? [];
  const open = run.status === 'PENDING' || run.status === 'IN_PROGRESS';
  const mayFill = open && can(memberships, 'checklists', 'create', { outletId: run.outletId });
  const mayReview =
    run.status === 'SUBMITTED' &&
    !submitWaiting &&
    !run.reviewedAt &&
    can(memberships, 'checklists', 'approve', { outletId: run.outletId });
  const total = run.items.length;
  const done = run.items.filter((item) => !isMissing(item, localItems[item.id])).length;
  const draftOf = (itemId: string) => drafts[itemId] ?? NO_DRAFT;

  function patchDraft(itemId: string, patch: Partial<ItemDraft>) {
    setDrafts((current) => ({ ...current, [itemId]: { ...(current[itemId] ?? NO_DRAFT), ...patch } }));
  }

  /** What, if anything, still stops this checklist being submitted: the first such item, top to bottom. */
  function findBlocker(): Blocker | null {
    const unsaved = run.items.find((item) => hasUnsavedReason(item, draftOf(item.id)));
    if (unsaved) return { itemId: unsaved.id, why: 'reason' };
    const missing = run.items.find((item) => isMissing(item, localItems[item.id]));
    if (missing) return { itemId: missing.id, why: 'missing' };
    return null;
  }

  /** Whether the item Submit pointed at is still in the way; once it is dealt with the message goes. */
  function stillBlocked(found: Blocker): boolean {
    const item = run.items.find((candidate) => candidate.id === found.itemId);
    if (!item) return false;
    if (found.why === 'reason') return hasUnsavedReason(item, draftOf(item.id));
    return isMissing(item, localItems[item.id]);
  }

  const shownBlocker = blocker && stillBlocked(blocker) ? blocker : null;
  const blockerNumber = shownBlocker ? run.items.findIndex((item) => item.id === shownBlocker.itemId) + 1 : 0;
  const blockerMessage = shownBlocker
    ? t(shownBlocker.why === 'reason' ? 'checklists.unsavedReason' : 'checklists.itemMissing', { number: blockerNumber })
    : null;

  /**
   * Submits, or, if something is still to do, scrolls to the first such item
   * and marks it. Submit joins the outbox behind the answers and photos still
   * waiting, so the server gets them in the order they were done. If someone
   * else has submitted meanwhile, the outbox drops it and says so.
   */
  async function pressSubmit() {
    const found = findBlocker();
    if (found) {
      setBlocker(found);
      setActionError(null);
      scrollToY(scrollRef, positions.current[found.itemId] ?? 0);
      return;
    }
    setBlocker(null);
    setBusy(true);
    setActionError(null);
    try {
      await outbox.enqueue({ kind: 'submit', runId: run.id });
      if (!hasSignal) notify(t('offline.submitSaved'));
      scrollToY(scrollRef, 0);
    } catch {
      setActionError(t('offline.saveFailed'));
    } finally {
      setBusy(false);
    }
  }

  /** Marking as reviewed is the Manager's or Owner's step and needs signal. */
  async function markReviewed() {
    setBusy(true);
    setActionError(null);
    try {
      checklistCache.putRun(await api.checklists.review(run.id));
      notify(t('checklists.reviewed'));
    } catch (e) {
      if (e instanceof ApiError && e.status === 409) await load();
      else setActionError(errorMessage(e, t));
    } finally {
      setBusy(false);
    }
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
      <Button label={t('checklists.submit')} onPress={() => void pressSubmit()} loading={busy} />
    </>
  ) : mayReview ? (
    <>
      <ErrorText message={actionError} />
      <Button label={t('checklists.markReviewed')} onPress={() => void markReviewed()} loading={busy} />
    </>
  ) : undefined;

  return (
    <Screen
      back
      title={localize(run.title, language)}
      subtitle={formatDayLong(run.date, language)}
      footer={footer}
      onRefresh={async () => {
        // Pulling down also sends anything still waiting, without waiting for the next automatic try.
        outbox.kick();
        await load();
      }}
      scrollRef={scrollRef}>
      {/* Until the server has the Submit, the checklist is not shown as "Submitted": nobody else can see it yet. */}
      <StatusBadge status={submitWaiting ? 'IN_PROGRESS' : run.status} reviewed={run.reviewedAt !== null} />
      {submitWaiting && <UnsentMark sending={hasSignal} text={t('offline.submitWaiting')} />}
      {/* A refresh that fails leaves the checklist as it was, and says so here. */}
      <ErrorText message={loadError} onRetry={() => void load()} />
      {run.status === 'MISSED' && (
        <ThemedText type="default" themeColor="danger">
          {t('checklists.missedNote')}
        </ThemedText>
      )}
      {run.submittedByName && !submitWaiting && (
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
          local={localItems[item.id]}
          run={run}
          editable={mayFill}
          hasSignal={hasSignal}
          draft={draftOf(item.id)}
          onDraft={(patch) => patchDraft(item.id, patch)}
          flagged={shownBlocker?.itemId === item.id && shownBlocker.why === 'missing'}
          onPlaced={(y) => {
            positions.current[item.id] = y;
          }}
        />
      ))}
    </Screen>
  );
}

interface ItemCardProps {
  number: number;
  /** The item with any answer still waiting on this phone already laid over it. */
  item: ChecklistItemDto;
  /** Set when this item has an answer or photo the server does not have yet. */
  local: LocalItem;
  run: ChecklistRunDto;
  editable: boolean;
  hasSignal: boolean;
  draft: ItemDraft;
  onDraft: (patch: Partial<ItemDraft>) => void;
  /** Submit was pressed while this item was still to do. */
  flagged: boolean;
  /** Reports how far down the page this card starts. */
  onPlaced: (y: number) => void;
}

function ItemCard({ number, item, local, run, editable, hasSignal, draft, onDraft, flagged, onPlaced }: ItemCardProps) {
  const theme = useTheme();
  const { t, api, language } = useSession();
  const notify = useSnackbar();
  const response = item.response;
  // Each error is shown beside the control that caused it.
  const [error, setError] = useState<{ at: 'photo' | 'answer' | 'reason'; message: string } | null>(null);
  const [noteError, setNoteError] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);
  const [keeping, setKeeping] = useState(false);
  const tickOnly = !item.photoRequired;

  // A photo taken on this phone is shown from the phone until the server has it.
  const localPhotoId = local?.localPhotoId ?? null;
  const photoUri = localPhotoId
    ? keptPhotoUri(localPhotoId)
    : response?.photoPath
      ? api.fileUrl(response.photoPath)
      : null;
  // The photo an answer points at: the one waiting on this phone, or the one on the server.
  const attachmentId = localPhotoId ?? (response?.photoPath ? photoId(response.photoPath) : undefined);
  const problem = response?.passed === false;
  const note = draft.note ?? response?.note ?? '';
  // "Problem" was tapped, or the reason reworded, and it is not saved yet.
  const unsaved = hasUnsavedReason(item, draft);
  const showReason = problem || draft.describing;

  /**
   * Saves something the person did: onto the phone first, then the outbox
   * sends it. The only way this fails is the phone refusing to store it.
   */
  async function save(op: NewOp, at: 'photo' | 'answer' | 'reason'): Promise<boolean> {
    setError(null);
    setSaving(true);
    try {
      await outbox.enqueue(op);
      return true;
    } catch {
      setError({ at, message: t('offline.saveFailed') });
      return false;
    } finally {
      setSaving(false);
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
    // The proof time is the moment the photo was taken, however much later it reaches the server.
    const capturedAt = new Date().toISOString();
    // The phone chooses the photo's id, so sending it twice stores it once.
    const id = newId();
    setKeeping(true);
    try {
      // The camera saves into a folder the phone may clear; keep our own copy until it is sent.
      await keepPhoto(id, photo);
      await save(
        {
          kind: 'answer',
          runId: run.id,
          outletId: run.outletId,
          itemId: item.id,
          passed: response?.passed ?? true,
          note: response?.note ?? undefined,
          attachmentId: id,
          photo: 'toUpload',
          capturedAt,
        },
        'photo',
      );
    } catch {
      setError({ at: 'photo', message: t('offline.saveFailed') });
    } finally {
      setKeeping(false);
    }
  }

  /**
   * Saves OK / Problem and the note. A photo item keeps the photo already
   * taken and cannot be answered before it has one; a tick-only item can.
   * Returns whether it was saved.
   */
  async function update(passed: boolean, nextNote: string, at: 'answer' | 'reason'): Promise<boolean> {
    if (item.photoRequired && !attachmentId) return false;
    return save(
      {
        kind: 'answer',
        runId: run.id,
        outletId: run.outletId,
        itemId: item.id,
        passed,
        note: passed ? undefined : nextNote,
        attachmentId,
        capturedAt: response?.capturedAt ?? new Date().toISOString(),
      },
      at,
    );
  }

  /** Tick-only items: one tap marks it done, another tap takes the tick back. */
  async function toggleTick() {
    if (saving) return;
    if (!response) {
      await update(true, '', 'answer');
      return;
    }
    if (await save({ kind: 'clear', runId: run.id, itemId: item.id }, 'answer')) onDraft({ note: null });
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
      {/* Done here and on its way. The person can carry on; this mark goes once the server has it. */}
      {local && <UnsentMark sending={hasSignal} />}
      {flagged && <ErrorText message={t('checklists.stillToDo')} />}

      {photoUri && <ProofPhoto uri={photoUri} label={localize(item.label, language)} stamp={stamp} />}
      {error?.at === 'photo' && <ErrorText message={error.message} />}

      {editable && !tickOnly && (
        <Button
          icon="camera"
          label={photoUri ? t('checklists.retakePhoto') : t('checklists.takePhoto')}
          variant={photoUri ? 'secondary' : 'primary'}
          onPress={() => void takePhoto()}
          loading={keeping}
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
