import {
  INSPECTION_ANSWERS,
  INSPECTION_MAX_PHOTOS,
  INSPECTION_NOTE_MAX,
  INSPECTION_SEVERITIES,
  isEccsRole,
  localize,
  type InspectionAnswer,
  type InspectionCheckDto,
  type InspectionDto,
  type InspectionPhotoDto,
  type InspectionSectionDto,
  type InspectionSeverity,
} from '@eccs/shared';
import { ApiError } from '@eccs/api-client';
import Ionicons from '@expo/vector-icons/Ionicons';
import { useFocusEffect, useLocalSearchParams } from 'expo-router';
import { useCallback, useEffect, useRef, useState, useSyncExternalStore, type ComponentProps } from 'react';
import { ActivityIndicator, Linking, Pressable, ScrollView, StyleSheet, View } from 'react-native';

import { HeldNotice, SavedCopyNote } from '@/components/field-sync-parts';
import { InspectionStatusBadge, ScoreSummary, SectionScoreRow } from '@/components/inspection-parts';
import { ProofPhoto } from '@/components/proof-photo';
import { ThemedText } from '@/components/themed-text';
import { Button } from '@/components/ui/button';
import { ConfirmDialog } from '@/components/ui/confirm-dialog';
import { ErrorText } from '@/components/ui/error-text';
import { OptionChip } from '@/components/ui/option-chip';
import { Screen } from '@/components/ui/screen';
import { useSnackbar } from '@/components/ui/snackbar';
import { TextField } from '@/components/ui/text-field';
import { UnsentMark } from '@/components/unsent-mark';
import { MinTouchSize, Spacing } from '@/constants/theme';
import { useTheme } from '@/hooks/use-theme';
import { errorMessage } from '@/lib/errors';
import { addDays, formatDate, indiaToday, maskTypedDate, parseTypedDate, toTypedDate } from '@/lib/format';
import { fieldCache } from '@/lib/offline/field-cache';
import { applyInspectionPending, type NewFieldOp } from '@/lib/offline/field-ops';
import { keepPhoto, keptPhotoUri, newId } from '@/lib/offline/files';
import { isNoSignal, outbox, useOutbox } from '@/lib/offline/outbox';
import { useReloadOnSignal } from '@/lib/offline/use-signal';
import { CameraPermissionError, takeEvidencePhoto } from '@/lib/photo';
import { scrollToY } from '@/lib/scroll';
import { useSession } from '@/lib/session';

type IconName = ComponentProps<typeof Ionicons>['name'];

// How each answer looks: an outline until chosen, filled once chosen, so the
// choice never depends on colour alone.
const ANSWER_ICON: Record<InspectionAnswer, [IconName, IconName]> = {
  COMPLIANT: ['checkmark-circle-outline', 'checkmark-circle'],
  NON_COMPLIANT: ['close-circle-outline', 'close-circle'],
  NOT_APPLICABLE: ['remove-circle-outline', 'remove-circle'],
};

// Long enough for a section to open or close before its place on the page is read.
const AFTER_LAYOUT_MS = 150;

// One-tap dates for putting a non-compliance right, in days from today.
const DUE_IN_DAYS = [1, 3, 7, 15, 30] as const;

/** The details of a non-compliance as they are being typed, before they are saved. */
interface Draft {
  note: string;
  severity: InspectionSeverity | null;
  action: string;
  /** YYYY-MM-DD once a real date is chosen or typed. */
  dueDate: string | null;
  /** The date field as typed (DD/MM/YYYY). */
  typedDate: string;
}

const draftOf = (check: InspectionCheckDto): Draft => ({
  note: check.note ?? '',
  severity: check.severity,
  action: check.correctiveAction ?? '',
  dueDate: check.dueDate,
  typedDate: check.dueDate ? toTypedDate(check.dueDate) : '',
});

const flat = (inspection: InspectionDto) => inspection.sections.flatMap((section) => section.checks);
const sectionDone = (section: InspectionSectionDto) => section.checks.every((check) => check.complete);

/** The India calendar day (YYYY-MM-DD) of a moment. */
const indiaDay = (iso: string) => {
  try {
    return new Intl.DateTimeFormat('en-CA', { timeZone: 'Asia/Kolkata' }).format(new Date(iso));
  } catch {
    return iso.slice(0, 10);
  }
};

// How this screen works without signal. Every answer, every detail of a
// non-compliance, every photo and the Finish is first saved on the phone in the
// "outbox" and shown as done at once; the outbox sends it to the server in the
// background, in order, whenever there is signal (see lib/offline). The
// inspection itself is the server's last copy, kept on the phone, with whatever
// is still waiting laid over it, and its score is worked out on the phone by the
// same function the server uses. So answering 92 checks never waits for the network.

/**
 * One inspection. While it is being carried out this is where the Supervisor
 * answers the checks, section by section; each answer is saved as it is given.
 * Once finished it is the inspection report: the score and grade, the section
 * scores and the non-compliances with their photos.
 */
export default function InspectionScreen() {
  const theme = useTheme();
  const { inspectionId } = useLocalSearchParams<{ inspectionId: string }>();
  const { t, api, language, user } = useSession();
  const notify = useSnackbar();

  const box = useOutbox();
  // The inspection as the server last sent it, from the copy kept on the phone.
  const getSaved = useCallback(() => fieldCache.getInspection(inspectionId), [inspectionId]);
  const saved = useSyncExternalStore(fieldCache.subscribe, getSaved, getSaved);
  const [loadError, setLoadError] = useState<string | null>(null);
  /** The section whose checks are showing. One at a time keeps a 92-check list short. */
  const [openSection, setOpenSection] = useState<string | null>(null);
  /** An answered check opened again to change it. */
  const [editing, setEditing] = useState<string | null>(null);
  /** What went wrong and at which check (or `finish`), so the message shows beside it. */
  const [failed, setFailed] = useState<Record<string, string>>({});
  const [drafts, setDrafts] = useState<Record<string, Draft>>({});
  /** The check whose details were saved with something missing: its fields show what. */
  const [checked, setChecked] = useState<string | null>(null);
  /** What should show as busy: `photo-<id>` while a photo is being kept on the phone, `pdf` while the PDF is fetched. */
  const [busy, setBusy] = useState<string | null>(null);
  /** The check Finish found unanswered or incomplete. */
  const [missing, setMissing] = useState<string | null>(null);
  const [confirming, setConfirming] = useState(false);
  const [removing, setRemoving] = useState<InspectionPhotoDto | null>(null);
  /** A non-compliance about to be changed to another answer, which would remove its note and photos. */
  const [changing, setChanging] = useState<{ check: InspectionCheckDto; value: InspectionAnswer } | null>(null);

  const scrollRef = useRef<ScrollView>(null);
  /** How far down the page each section sits, and each check inside its section. */
  const sectionY = useRef<Record<string, number>>({});
  const checkY = useRef<Record<string, number>>({});

  const userId = user?.id ?? null;
  // False only once the server could not be reached; the line at the bottom of the app says so.
  const hasSignal = box.online !== false;

  /** The inspection as it stands on this phone this instant: the saved copy with everything waiting laid over it. */
  const standing = useCallback((): InspectionDto | null => {
    const copy = fieldCache.getInspection(inspectionId);
    return copy ? applyInspectionPending(copy.data, outbox.getSnapshot().ops).inspection : null;
  }, [inspectionId]);

  /**
   * Fetches the inspection and keeps it on the phone. With no signal the copy
   * already on the phone stays on screen, which is not an error.
   */
  const load = useCallback(async () => {
    if (!userId) return;
    await fieldCache.load(userId);
    await fieldCache.open('inspection', inspectionId);
    try {
      fieldCache.putInspection(await api.inspections.get(inspectionId));
      outbox.noteReachable(true);
      setLoadError(null);
    } catch (e) {
      if (isNoSignal(e)) {
        outbox.noteReachable(false);
        setLoadError(fieldCache.getInspection(inspectionId) ? null : t('offline.inspectionNotOnPhone'));
      } else if (e instanceof ApiError && (e.status === 403 || e.status === 404)) {
        // Given to someone else, or removed. The old copy goes, unless answers for it are still on this phone.
        if (!outbox.hasFieldWork('inspection', inspectionId)) fieldCache.forget('inspection', inspectionId);
        setLoadError(t('offline.inspectionGone'));
      } else {
        setLoadError(errorMessage(e, t));
      }
    }
    // Opens at the first section with something still to do.
    const first = standing()?.sections.find((section) => !sectionDone(section));
    setOpenSection((current) => current ?? first?.key ?? null);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [api, inspectionId, standing, userId]);

  useFocusEffect(
    useCallback(() => {
      void load();
    }, [load]),
  );
  // And again the moment the signal comes back.
  useReloadOnSignal(load);

  const view = saved ? applyInspectionPending(saved.data, box.ops) : null;
  const finishWaiting = view?.finishPending ?? false;
  const finishedOnServer = saved !== null && (saved.data.status === 'SUBMITTED' || saved.data.status === 'APPROVED');

  // "Inspection finished" is said when the server has it, not when Finish was pressed.
  const wasWaiting = useRef(false);
  useEffect(() => {
    if (wasWaiting.current && !finishWaiting && finishedOnServer) notify(t('insp.finished'));
    wasWaiting.current = finishWaiting;
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [finishWaiting, finishedOnServer]);

  if (!view) {
    return (
      <Screen back title={t('insp.title')} onRefresh={load}>
        <ErrorText message={loadError} onRetry={() => void load()} />
        {!loadError && <ActivityIndicator color={theme.primary} />}
      </Screen>
    );
  }

  // The server's copy with this Supervisor's waiting answers laid over it.
  const inspection = view.inspection;
  // Answers the server refused are kept on the phone; nothing more is recorded until that is settled.
  const held = view.holdReason !== null;
  // Once Finish is pressed the inspection is closed on this phone, even while the Finish waits to be sent.
  const recording = inspection.canRecord && !finishWaiting && !held;
  // The scores of the answers as they stand on this phone, by the rule the server uses.
  const score = view.score;
  const checks = flat(inspection);
  const done = checks.filter((check) => check.complete).length;
  const viewerRole = user?.memberships[0]?.role;
  const eccs = viewerRole !== undefined && isEccsRole(viewerRole);
  const today = indiaToday();

  const clearFailure = (at: string) =>
    setFailed((current) => {
      const { [at]: _gone, ...rest } = current;
      return rest;
    });

  /**
   * Saves one thing the Supervisor did: onto the phone first, then the outbox
   * sends it. The only way this fails is the phone refusing to store it.
   * `at` is the check (or `finish`) an error is shown beside.
   */
  async function save(at: string, step: Record<string, unknown> & { kind: NewFieldOp['kind'] }): Promise<boolean> {
    clearFailure(at);
    try {
      await outbox.enqueue({ subject: 'inspection', subjectId: inspectionId, ...step } as NewFieldOp);
      return true;
    } catch {
      setFailed((current) => ({ ...current, [at]: t('offline.saveFailed') }));
      return false;
    }
  }

  // The server refuses a date to fix something by that is before the inspection itself.
  const startDay = inspection.startedAt ? indiaDay(inspection.startedAt) : today;

  // Opening one section closes another, which moves everything below it, so the
  // positions are read only after the screen has had time to lay itself out again.
  const scrollToCheck = (sectionKey: string, itemId?: string) => {
    setTimeout(() => {
      const top = sectionY.current[sectionKey];
      if (top === undefined) return;
      scrollToY(scrollRef, top + (itemId ? (checkY.current[itemId] ?? 0) : 0));
    }, AFTER_LAYOUT_MS);
  };

  /** Once a section is complete, moves on to the next one with something left to do. */
  function moveOn(next: InspectionDto, fromItemId: string) {
    const section = next.sections.find((entry) => entry.checks.some((check) => check.itemId === fromItemId));
    if (!section || !sectionDone(section)) return;
    const index = next.sections.indexOf(section);
    const ahead = [...next.sections.slice(index + 1), ...next.sections.slice(0, index)].find((entry) => !sectionDone(entry));
    if (!ahead) return;
    setOpenSection(ahead.key);
    scrollToCheck(ahead.key);
  }

  /**
   * Saves an answer the moment it is tapped: onto the phone, where it shows at
   * once, and from there to the server whenever there is signal. `at` is the
   * moment it was answered, which is what the inspection is dated by.
   */
  async function answer(check: InspectionCheckDto, value: InspectionAnswer) {
    const id = check.itemId;
    if (missing === id) setMissing(null);
    const draft = drafts[id] ?? draftOf(check);
    // Tapping "Not compliant" again must not wipe details already given.
    const details =
      value === 'NON_COMPLIANT'
        ? {
            note: draft.note.trim(),
            severity: draft.severity,
            correctiveAction: draft.action.trim(),
            dueDate: draft.dueDate && draft.dueDate >= startDay ? draft.dueDate : null,
          }
        : {};
    if (value === 'NON_COMPLIANT') setEditing(id);
    if (!(await save(id, { kind: 'inspAnswer', itemId: id, answer: value, ...details, at: new Date().toISOString() }))) return;
    if (value !== 'NON_COMPLIANT') {
      setEditing((current) => (current === id ? null : current));
      const next = standing();
      if (next) moveOn(next, id);
    }
  }

  const setDraft = (check: InspectionCheckDto, change: Partial<Draft>) =>
    setDrafts((current) => ({ ...current, [check.itemId]: { ...(current[check.itemId] ?? draftOf(check)), ...change } }));

  /** Saves what was typed about a non-compliance. Anything still missing is pointed out, but what is there is kept. */
  async function saveDetails(check: InspectionCheckDto) {
    if (busy !== null) return;
    const id = check.itemId;
    const draft = drafts[id] ?? draftOf(check);
    if (draft.dueDate && draft.dueDate < startDay) {
      setFailed((current) => ({ ...current, [id]: t('offline.dueTooEarly') }));
      return;
    }
    const kept = await save(id, {
      kind: 'inspAnswer',
      itemId: id,
      answer: 'NON_COMPLIANT',
      note: draft.note.trim(),
      severity: draft.severity,
      correctiveAction: draft.action.trim(),
      dueDate: draft.dueDate,
      at: new Date().toISOString(),
    });
    if (!kept) return;
    const next = standing();
    const now = next ? flat(next).find((entry) => entry.itemId === id) : undefined;
    if (next && now?.complete) {
      notify(t('common.saved'));
      setChecked(null);
      setEditing(null);
      setDrafts((current) => {
        const { [id]: _saved, ...rest } = current;
        return rest;
      });
      moveOn(next, id);
    } else {
      setChecked(id);
    }
  }

  async function addPhoto(check: InspectionCheckDto) {
    if (busy !== null) return;
    const id = check.itemId;
    clearFailure(id);
    let photo;
    try {
      photo = await takeEvidencePhoto();
    } catch (e) {
      setFailed((current) => ({ ...current, [id]: t(e instanceof CameraPermissionError ? 'error.camera' : 'error.generic') }));
      return;
    }
    if (!photo) return;
    // The time is when the photo was taken, however much later it reaches the server.
    const capturedAt = new Date().toISOString();
    // The phone chooses the photo's id, so sending it twice stores it once.
    const photoId = newId();
    setBusy(`photo-${id}`);
    try {
      // The camera saves into a folder the phone may clear; keep our own copy until it is sent.
      // With it go the facts noted at that moment (where the phone was, if allowed), sent when the photo is.
      await keepPhoto(photoId, photo, photo.facts);
      await save(id, { kind: 'inspPhoto', itemId: id, photoId, capturedAt });
    } catch {
      setFailed((current) => ({ ...current, [id]: t('offline.saveFailed') }));
    } finally {
      setBusy(null);
    }
  }

  async function removePhoto(photo: InspectionPhotoDto) {
    setRemoving(null);
    const owner = checks.find((check) => check.photos.some((entry) => entry.id === photo.id));
    if (owner) await save(owner.itemId, { kind: 'inspPhotoRemove', itemId: owner.itemId, photoId: photo.id });
  }

  /** A photo taken on this phone is shown from the phone until the server has it. */
  const photoUri = (photo: InspectionPhotoDto) =>
    view.localPhotos.has(photo.id) ? (keptPhotoUri(photo.id) ?? '') : api.fileUrl(photo.path);

  /** Finish is always pressable: if something is missing it goes there, instead of sitting greyed out. */
  function pressFinish() {
    if (busy !== null) return;
    const lacking = checks.find((check) => !check.complete);
    if (lacking) {
      const section = inspection.sections.find((entry) => entry.checks.includes(lacking));
      setMissing(lacking.itemId);
      if (lacking.answer === 'NON_COMPLIANT') setChecked(lacking.itemId);
      if (section) {
        setOpenSection(section.key);
        scrollToCheck(section.key, lacking.itemId);
      }
      return;
    }
    setMissing(null);
    // The server refuses an inspection in which nothing applies; say so here rather than after sending.
    if (score.possible === 0) {
      setFailed((current) => ({ ...current, finish: t('offline.nothingApplies') }));
      return;
    }
    clearFailure('finish');
    setConfirming(true);
  }

  /**
   * Finish joins the outbox behind the answers and photos still waiting, so the
   * server gets them in the order they were given. `at` is the moment Finish was
   * pressed: the server uses it to recognise the same Finish arriving twice.
   */
  async function finish() {
    setConfirming(false);
    if (await save('finish', { kind: 'inspFinish', at: new Date().toISOString() })) {
      if (!hasSignal) notify(t('offline.submitSaved'));
      scrollToY(scrollRef, 0);
    }
  }

  /** Opens the approved report as a PDF in the phone's viewer. The first time, the server makes it, which takes a few seconds. */
  async function openPdf() {
    if (busy !== null) return;
    setBusy('pdf');
    clearFailure('pdf');
    try {
      const { path } = await api.inspections.reportPdf(inspectionId);
      await Linking.openURL(api.fileUrl(path));
    } catch (e) {
      setFailed((current) => ({ ...current, pdf: errorMessage(e, t) }));
    } finally {
      setBusy(null);
    }
  }

  // ───────────────────────── Carrying it out ─────────────────────────

  const answerButton = (check: InspectionCheckDto, value: InspectionAnswer, chosen: InspectionAnswer | null) => {
    const selected = chosen === value;
    const color = value === 'COMPLIANT' ? theme.primary : value === 'NON_COMPLIANT' ? theme.danger : theme.textSecondary;
    return (
      <Pressable
        key={value}
        accessibilityRole="radio"
        accessibilityState={{ selected, checked: selected }}
        accessibilityLabel={t(value === 'NOT_APPLICABLE' ? 'insp.notApplicable' : `insp.answer.${value}`)}
        onPress={() => {
          const recorded = check.answer === 'NON_COMPLIANT' && (check.note !== null || check.photos.length > 0);
          // One slip of a wet thumb must not throw away a note and photos.
          if (recorded && value !== 'NON_COMPLIANT') setChanging({ check, value });
          else void answer(check, value);
        }}
        style={({ pressed }) => [
          styles.answer,
          { borderColor: selected ? color : theme.outline },
          selected && styles.answerSelected,
          (selected || pressed) && { backgroundColor: theme.backgroundElement },
        ]}>
        <Ionicons name={ANSWER_ICON[value][selected ? 1 : 0]} size={30} color={selected ? color : theme.textSecondary} />
        <ThemedText
          type="small"
          numberOfLines={2}
          style={[styles.answerLabel, { color: selected ? color : theme.text }, selected && styles.bold]}>
          {t(`insp.answer.${value}`)}
        </ThemedText>
      </Pressable>
    );
  };

  const detailsForm = (check: InspectionCheckDto) => {
    const id = check.itemId;
    const draft = drafts[id] ?? draftOf(check);
    // What is missing is only pointed out after a save, not while the person is still typing.
    const need = (lacking: boolean, key: 'note' | 'severity' | 'action' | 'dueDate' | 'photo') =>
      checked === id && lacking ? t(`insp.need.${key}`) : null;
    const typedIsWrong = draft.typedDate.length > 0 && parseTypedDate(draft.typedDate) === null;
    return (
      <View style={[styles.details, { borderColor: theme.border }]}>
        <TextField
          label={t('insp.found')}
          value={draft.note}
          onChangeText={(note) => setDraft(check, { note })}
          maxLength={INSPECTION_NOTE_MAX}
          multiline
          style={styles.multiline}
          error={need(check.note === null, 'note')}
        />

        <ThemedText type="smallBold" themeColor="textSecondary">
          {t('insp.severity')}
        </ThemedText>
        <View style={styles.chips} accessibilityRole="radiogroup" accessibilityLabel={t('insp.severity')}>
          {INSPECTION_SEVERITIES.map((severity) => (
            <OptionChip
              key={severity}
              label={t(`insp.severity.${severity}`)}
              selected={draft.severity === severity}
              onPress={() => setDraft(check, { severity })}
            />
          ))}
        </View>
        <ErrorText message={need(check.severity === null, 'severity')} />

        <TextField
          label={t('insp.action')}
          value={draft.action}
          onChangeText={(action) => setDraft(check, { action })}
          maxLength={INSPECTION_NOTE_MAX}
          multiline
          style={styles.multiline}
          error={need(check.correctiveAction === null, 'action')}
        />

        <ThemedText type="smallBold" themeColor="textSecondary">
          {t('insp.dueDate')}
        </ThemedText>
        <View style={styles.chips} accessibilityRole="radiogroup" accessibilityLabel={t('insp.dueDate')}>
          {DUE_IN_DAYS.map((days) => {
            const date = addDays(today, days);
            return (
              <OptionChip
                key={days}
                label={days === 1 ? t('insp.dueTomorrow') : t('insp.dueIn', { count: days })}
                selected={draft.dueDate === date}
                onPress={() => setDraft(check, { dueDate: date, typedDate: toTypedDate(date) })}
              />
            );
          })}
        </View>
        <TextField
          label={t('insp.dueOther')}
          value={draft.typedDate}
          onChangeText={(text) => {
            const typedDate = maskTypedDate(text, draft.typedDate);
            setDraft(check, { typedDate, dueDate: parseTypedDate(typedDate) });
          }}
          keyboardType="number-pad"
          placeholder="DD/MM/YYYY"
          hint={draft.dueDate ? formatDate(draft.dueDate, language) : null}
          error={typedIsWrong && draft.typedDate.length >= 10 ? t('error.date') : need(check.dueDate === null, 'dueDate')}
        />

        <ThemedText type="smallBold" themeColor="textSecondary">
          {t('insp.photos')}
        </ThemedText>
        {check.photos.length > 0 && (
          <View style={styles.photos}>
            {check.photos.map((photo, index) => (
              <ProofPhoto
                key={photo.id}
                compact
                uri={photoUri(photo)}
                label={t('insp.photoLabel', { number: index + 1, total: check.photos.length })}
                onRemove={() => setRemoving(photo)}
              />
            ))}
          </View>
        )}
        {check.photos.some((photo) => view.localPhotos.has(photo.id)) && <UnsentMark sending={hasSignal} />}
        {check.photos.length < INSPECTION_MAX_PHOTOS && (
          <Button
            icon="camera"
            label={t('insp.addPhoto')}
            variant="secondary"
            loading={busy === `photo-${id}`}
            onPress={() => void addPhoto(check)}
          />
        )}
        <ErrorText message={need(check.photos.length === 0, 'photo')} />

        <Button label={t('insp.saveDetails')} onPress={() => void saveDetails(check)} />
      </View>
    );
  };

  const checkRow = (check: InspectionCheckDto) => {
    const id = check.itemId;
    const label = localize(check.label, language);
    const chosen = check.answer;
    // Answered on this phone and not on the server yet.
    const unsent = view.unsentChecks.has(id);
    const open = !check.complete || editing === id || failed[id] !== undefined;
    const remember = (y: number) => {
      checkY.current[id] = y;
    };

    // Answered and complete: one line, so what is left to do stays in view. Tap to change.
    if (!open && check.answer) {
      const failedCheck = check.answer === 'NON_COMPLIANT';
      return (
        <Pressable
          key={id}
          accessibilityRole="button"
          accessibilityLabel={`${check.number}. ${label}. ${t(check.answer === 'NOT_APPLICABLE' ? 'insp.notApplicable' : `insp.answer.${check.answer}`)}`}
          accessibilityHint={t('insp.tapToChange')}
          onLayout={(event) => remember(event.nativeEvent.layout.y)}
          onPress={() => setEditing(id)}
          style={({ pressed }) => [styles.doneRow, { borderColor: theme.border }, pressed && { backgroundColor: theme.backgroundElement }]}>
          <Ionicons
            name={ANSWER_ICON[check.answer][1]}
            size={24}
            color={check.answer === 'COMPLIANT' ? theme.primary : failedCheck ? theme.danger : theme.textSecondary}
          />
          <View style={styles.flexText}>
            <ThemedText type="small" numberOfLines={failedCheck ? 3 : 1}>
              {check.number}. {label}
            </ThemedText>
            {check.answer !== 'COMPLIANT' && (
              <ThemedText type="smallBold" themeColor={failedCheck ? 'danger' : 'textSecondary'}>
                {failedCheck
                  ? [
                      t('insp.answer.NON_COMPLIANT'),
                      check.severity && t(`insp.severity.${check.severity}`),
                      check.dueDate && t('insp.fixBy', { date: formatDate(check.dueDate, language) }),
                    ]
                      .filter(Boolean)
                      .join(' · ')
                  : t('insp.notApplicable')}
              </ThemedText>
            )}
          </View>
          {/* A cloud at the end of a row whose answer is on this phone only; the line at the bottom of the app says how many are waiting. */}
          {unsent && (
            <Ionicons
              name="cloud-upload-outline"
              size={20}
              color={theme.textSecondary}
              accessibilityLabel={t('offline.photoWaiting')}
            />
          )}
        </Pressable>
      );
    }

    const flagged = missing === id && !check.complete;
    return (
      <View
        key={id}
        onLayout={(event) => remember(event.nativeEvent.layout.y)}
        style={[styles.check, { borderColor: flagged ? theme.danger : theme.border }, flagged && styles.flagged]}>
        <ThemedText type="default" style={styles.checkLabel}>
          {check.number}. {label}
        </ThemedText>
        {check.critical && (
          <View style={styles.critical}>
            <Ionicons name="star" size={16} color={theme.warning} />
            <ThemedText type="smallBold" themeColor="warning">
              {t('insp.critical')}
            </ThemedText>
          </View>
        )}
        <View style={styles.answers} accessibilityRole="radiogroup" accessibilityLabel={label}>
          {INSPECTION_ANSWERS.map((value) => answerButton(check, value, chosen))}
        </View>
        {/* Answered here and on its way. The Supervisor can carry on; this mark goes once the server has it. */}
        {unsent && <UnsentMark sending={hasSignal} />}
        <ErrorText
          message={
            failed[id] ??
            (flagged ? t(check.answer === 'NON_COMPLIANT' ? 'insp.needDetails' : 'insp.needAnswer') : null)
          }
        />
        {check.answer === 'NON_COMPLIANT' && detailsForm(check)}
      </View>
    );
  };

  const sectionBlock = (section: InspectionSectionDto) => {
    const open = openSection === section.key;
    const complete = section.checks.filter((check) => check.complete).length;
    const all = complete === section.checks.length;
    return (
      <View
        key={section.key}
        onLayout={(event) => {
          sectionY.current[section.key] = event.nativeEvent.layout.y;
        }}
        style={styles.section}>
        <Pressable
          accessibilityRole="button"
          accessibilityState={{ expanded: open }}
          accessibilityLabel={`${section.key}. ${section.title}. ${t('insp.progress', { done: complete, total: section.checks.length })}`}
          onPress={() => setOpenSection(open ? null : section.key)}
          style={({ pressed }) => [
            styles.sectionHeader,
            { backgroundColor: pressed ? theme.backgroundSelected : theme.backgroundElement },
          ]}>
          <Ionicons
            name={all ? 'checkmark-circle' : 'ellipse-outline'}
            size={24}
            color={all ? theme.primary : theme.textSecondary}
            accessibilityLabel={all ? t('insp.sectionDone') : undefined}
          />
          <ThemedText type="default" style={styles.sectionTitle}>
            {section.key}. {section.title}
          </ThemedText>
          <ThemedText type="smallBold" themeColor={all ? 'primary' : 'textSecondary'}>
            {t('insp.progressCount', { done: complete, total: section.checks.length })}
          </ThemedText>
          <Ionicons name={open ? 'chevron-up' : 'chevron-down'} size={22} color={theme.textSecondary} />
        </Pressable>
        {open && section.checks.map(checkRow)}
      </View>
    );
  };

  // ───────────────────────── The report ─────────────────────────

  const fact = (label: string, value: string | null) =>
    value ? (
      <View style={styles.fact}>
        <ThemedText type="small" themeColor="textSecondary">
          {label}
        </ThemedText>
        <ThemedText type="default">{value}</ThemedText>
      </View>
    ) : null;

  const findings = checks.filter((check) => check.answer === 'NON_COMPLIANT');
  const notApplicable = checks.filter((check) => check.answer === 'NOT_APPLICABLE').length;

  const report = (
    <>
      {inspection.overallScore !== null && <ScoreSummary score={inspection.overallScore} grade={inspection.grade} />}
      {/* Finished without signal: the score is the phone's own working, by the rule the server uses. */}
      {finishWaiting && (
        <ThemedText type="small" themeColor="textSecondary">
          {t('offline.scoreOnPhone')}
        </ThemedText>
      )}
      {inspection.status === 'SUBMITTED' && eccs && (
        <ThemedText type="default" themeColor="warning">
          {t('insp.waitingEccs')}
        </ThemedText>
      )}
      {inspection.criticalFailed > 0 && (
        <View style={styles.warning}>
          <Ionicons name="alert-circle" size={22} color={theme.danger} />
          <ThemedText type="default" themeColor="danger" style={styles.flexText}>
            {t('insp.criticalFailed', { count: inspection.criticalFailed })}
          </ThemedText>
        </View>
      )}
      <ThemedText type="default" themeColor="textSecondary">
        {t('insp.counts', {
          compliant: checks.length - findings.length - notApplicable,
          failed: findings.length,
          na: notApplicable,
        })}
      </ThemedText>

      <ThemedText type="smallBold" themeColor="textSecondary" style={styles.sectionGap}>
        {t('insp.sections')}
      </ThemedText>
      {inspection.sections.map((section) => (
        <SectionScoreRow key={section.key} section={section} />
      ))}
      <ThemedText type="small" themeColor="textSecondary">
        {t('insp.howScored')}
      </ThemedText>

      <ThemedText type="smallBold" themeColor="textSecondary" style={styles.sectionGap}>
        {t('insp.findings', { count: findings.length })}
      </ThemedText>
      {findings.length === 0 && (
        <ThemedText type="default" themeColor="textSecondary">
          {t('insp.noFindings')}
        </ThemedText>
      )}
      {findings.map((check) => (
        <View key={check.itemId} style={[styles.finding, { borderColor: theme.border }]}>
          <ThemedText type="default" style={styles.checkLabel}>
            {check.number}. {localize(check.label, language)}
          </ThemedText>
          <ThemedText type="smallBold" themeColor={check.severity === 'LOW' ? 'textSecondary' : 'danger'}>
            {[check.critical && t('insp.critical'), check.severity && t(`insp.severity.${check.severity}`)]
              .filter(Boolean)
              .join(' · ')}
          </ThemedText>
          {check.note && <ThemedText type="default">{check.note}</ThemedText>}
          {fact(t('insp.correctiveAction'), check.correctiveAction)}
          {check.dueDate && (
            <View style={styles.due}>
              <Ionicons name="calendar-outline" size={20} color={theme.text} />
              <ThemedText type="default" style={styles.bold}>
                {t('insp.fixBy', { date: formatDate(check.dueDate, language) })}
              </ThemedText>
            </View>
          )}
          {check.photos.length > 0 && (
            <View style={styles.photos}>
              {check.photos.map((photo, index) => (
                <ProofPhoto
                  key={photo.id}
                  compact
                  uri={photoUri(photo)}
                  label={t('insp.photoLabel', { number: index + 1, total: check.photos.length })}
                />
              ))}
            </View>
          )}
        </View>
      ))}
    </>
  );

  // The main button stays in view at the bottom, with how far the inspection has got.
  const footer = recording ? (
    <>
      <View accessibilityLiveRegion="polite" style={styles.progress}>
        <ThemedText type="smallBold">{t('insp.progress', { done, total: checks.length })}</ThemedText>
        <View style={[styles.track, { backgroundColor: theme.backgroundSelected }]}>
          <View
            style={[styles.bar, { width: `${checks.length ? (done / checks.length) * 100 : 0}%`, backgroundColor: theme.primary }]}
          />
        </View>
      </View>
      <ErrorText message={failed.finish ?? null} />
      <Button label={t('insp.finish')} onPress={pressFinish} />
    </>
  ) : undefined;

  return (
    <Screen
      back
      title={inspection.outletName}
      subtitle={recording ? (inspection.outletAddress ?? inspection.organizationName) : t('insp.report')}
      onRefresh={async () => {
        // Pulling down also sends anything still waiting, without waiting for the next automatic try.
        outbox.kick();
        await load();
      }}
      scrollRef={scrollRef}
      footer={footer}>
      {/* A refresh that failed: the inspection shown is the last one loaded. */}
      <ErrorText message={loadError} onRetry={() => void load()} />
      {/* No signal: this is the phone's own copy, and how old it is. */}
      {!hasSignal && saved && <SavedCopyNote at={saved.at} />}
      {view.holdReason && (
        <HeldNotice subject="inspection" subjectId={inspectionId} reason={view.holdReason} count={view.held} />
      )}

      {/* Until the server has the Finish, the inspection is not shown as finished: nobody else can see it yet. */}
      <InspectionStatusBadge status={inspection.status} />
      {finishWaiting && !held && <UnsentMark sending={hasSignal} text={t('offline.finishWaiting')} />}

      {recording && inspection.correctionNote && (
        <View style={[styles.correction, { borderColor: theme.warning }]}>
          <ThemedText type="smallBold" themeColor="warning">
            {t('insp.correction')}
          </ThemedText>
          <ThemedText type="default">{inspection.correctionNote}</ThemedText>
        </View>
      )}

      {recording ? (
        inspection.sections.map(sectionBlock)
      ) : (
        <>
          <View style={[styles.facts, { backgroundColor: theme.backgroundElement }]}>
            {inspection.reportNumber && (
              <ThemedText type="default" style={styles.bold}>
                {t('insp.report')} · {inspection.reportNumber}
              </ThemedText>
            )}
            {fact(t('insp.inspectedOn'), formatDate(inspection.date, language))}
            {fact(t('insp.inspectedBy'), inspection.supervisorName)}
            {inspection.grade === null && inspection.status === 'PLANNED' && (
              <ThemedText type="default" themeColor="textSecondary">
                {t('insp.plannedFor', { date: formatDate(inspection.date, language) })}
              </ThemedText>
            )}
          </View>
          {/* Only an approved report is final, so only then is there a PDF to keep or pass on. */}
          {inspection.status === 'APPROVED' && (
            <>
              <Button
                icon="document-text"
                label={t('visit.pdf')}
                variant="secondary"
                loading={busy === 'pdf'}
                onPress={() => void openPdf()}
              />
              <ErrorText message={failed.pdf ?? null} />
            </>
          )}
          {inspection.status !== 'PLANNED' && report}
        </>
      )}

      <ConfirmDialog
        visible={confirming}
        message={t('insp.finishConfirm')}
        confirmLabel={t('insp.finish')}
        onConfirm={() => void finish()}
        onCancel={() => setConfirming(false)}
      />
      <ConfirmDialog
        visible={changing !== null}
        message={t('insp.changeConfirm')}
        confirmLabel={t('insp.changeAnswer')}
        danger
        onConfirm={() => {
          if (changing) void answer(changing.check, changing.value);
          setChanging(null);
        }}
        onCancel={() => setChanging(null)}
      />
      <ConfirmDialog
        visible={removing !== null}
        message={t('insp.removePhotoConfirm')}
        confirmLabel={t('insp.removePhoto')}
        danger
        onConfirm={() => removing && void removePhoto(removing)}
        onCancel={() => setRemoving(null)}
      />
    </Screen>
  );
}

const styles = StyleSheet.create({
  section: { gap: Spacing.two },
  sectionHeader: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: Spacing.two,
    minHeight: MinTouchSize + Spacing.two,
    borderRadius: Spacing.three,
    paddingHorizontal: Spacing.three,
    paddingVertical: Spacing.two,
  },
  sectionTitle: { flex: 1, fontWeight: 700 },
  sectionGap: { marginTop: Spacing.four },
  check: { borderWidth: 1, borderRadius: Spacing.three, padding: Spacing.three, gap: Spacing.two },
  flagged: { borderWidth: 2 },
  checkLabel: { fontWeight: 600 },
  critical: { flexDirection: 'row', alignItems: 'center', gap: Spacing.one },
  answers: { flexDirection: 'row', gap: Spacing.two },
  answer: {
    flex: 1,
    minHeight: MinTouchSize + Spacing.four,
    alignItems: 'center',
    justifyContent: 'center',
    gap: Spacing.half,
    borderWidth: 1,
    borderRadius: Spacing.three,
    paddingHorizontal: Spacing.one,
    paddingVertical: Spacing.two,
  },
  answerSelected: { borderWidth: 2 },
  answerLabel: { textAlign: 'center' },
  bold: { fontWeight: 700 },
  doneRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: Spacing.two,
    minHeight: MinTouchSize,
    borderBottomWidth: 1,
    paddingHorizontal: Spacing.two,
    paddingVertical: Spacing.two,
  },
  flexText: { flex: 1 },
  details: { borderTopWidth: 1, paddingTop: Spacing.three, gap: Spacing.two },
  multiline: { minHeight: 88, paddingVertical: Spacing.two, textAlignVertical: 'top' },
  chips: { flexDirection: 'row', flexWrap: 'wrap', gap: Spacing.two },
  photos: { flexDirection: 'row', flexWrap: 'wrap', gap: Spacing.two },
  progress: { gap: Spacing.one },
  track: { height: 8, borderRadius: 4, overflow: 'hidden' },
  bar: { height: 8, borderRadius: 4 },
  correction: { borderWidth: 2, borderRadius: Spacing.three, padding: Spacing.three, gap: Spacing.one },
  facts: { borderRadius: Spacing.three, padding: Spacing.three, gap: Spacing.two },
  fact: { gap: Spacing.half },
  warning: { flexDirection: 'row', alignItems: 'flex-start', gap: Spacing.two },
  finding: { borderWidth: 1, borderRadius: Spacing.three, padding: Spacing.three, gap: Spacing.two },
  due: { flexDirection: 'row', alignItems: 'center', gap: Spacing.two },
});
