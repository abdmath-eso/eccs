import {
  isEccsRole,
  localize,
  VISIT_MAX_PHOTOS,
  VISIT_MAX_TECHNICIANS,
  type VisitDto,
  type VisitPhotoDto,
  type VisitPhotoKind,
  type VisitTaskDto,
} from '@eccs/shared';
import { ApiError } from '@eccs/api-client';
import Ionicons from '@expo/vector-icons/Ionicons';
import { useFocusEffect, useLocalSearchParams } from 'expo-router';
import { useCallback, useEffect, useRef, useState, useSyncExternalStore } from 'react';
import { ActivityIndicator, Image, Linking, Modal, Pressable, ScrollView, StyleSheet, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

import { DirectionView } from '@/components/direction-view';
import { HeldNotice, SavedCopyNote } from '@/components/field-sync-parts';
import { ThemedText } from '@/components/themed-text';
import { Button } from '@/components/ui/button';
import { ConfirmDialog } from '@/components/ui/confirm-dialog';
import { ErrorText } from '@/components/ui/error-text';
import { OptionChip } from '@/components/ui/option-chip';
import { Screen } from '@/components/ui/screen';
import { StarRating, type Stars } from '@/components/ui/star-rating';
import { useSnackbar } from '@/components/ui/snackbar';
import { TextField } from '@/components/ui/text-field';
import { UnsentMark } from '@/components/unsent-mark';
import { VisitStatusBadge } from '@/components/visit-card';
import { MinTouchSize, Spacing } from '@/constants/theme';
import { useTheme } from '@/hooks/use-theme';
import { errorMessage } from '@/lib/errors';
import { ltrText } from '@/lib/direction';
import { formatDate, formatDateTime, formatDayLong, formatSlot } from '@/lib/format';
import { fieldCache } from '@/lib/offline/field-cache';
import { applyVisitPending, type NewFieldOp } from '@/lib/offline/field-ops';
import { keepPhoto, keptPhotoUri, newId } from '@/lib/offline/files';
import { isNoSignal, outbox, useOutbox } from '@/lib/offline/outbox';
import { useReloadOnSignal } from '@/lib/offline/use-signal';
import { CameraPermissionError, takeProofPhoto } from '@/lib/photo';
import { scrollToY } from '@/lib/scroll';
import { useSession } from '@/lib/session';

const splitNames = (text: string) =>
  text
    .split(/[,\n]/)
    .map((name) => name.trim())
    .filter(Boolean);

// Sample one-tap reasons for a task that was not done, until the founder supplies the real list.
// Why a task could not be done, most common first. "Other" is offered after these.
const REASONS = ['inUse', 'noAccess', 'hot', 'notMoved', 'repair', 'noEquipment', 'noTime', 'notNeeded', 'skip'] as const;

const PHOTOS_PER_ROW = 3;

// How this screen works without signal, for the Supervisor. Everything they do
// on the visit (checking in, a task, a photo, the team and notes, Finish) is
// first saved on the phone in the "outbox" and shown as done at once; the outbox
// sends it to the server in the background, in order, whenever there is signal
// (see lib/offline). The visit itself is the server's last copy, kept on the
// phone, with whatever is still waiting laid over it. So recording never waits
// for the network. The restaurant's sign-off and the PDF still need signal.

/**
 * One service visit. Before it starts it shows what is booked. The ECCS
 * Supervisor checks in here and records the work: tasks, photos, who did it.
 * Once finished it is the service report, which the restaurant's Owner or
 * Manager signs off.
 */
export default function VisitScreen() {
  const theme = useTheme();
  const { visitId } = useLocalSearchParams<{ visitId: string }>();
  const { t, api, language, user } = useSession();
  const notify = useSnackbar();
  // Keeps the enlarged photo and its Close button clear of the status bar and home indicator.
  const insets = useSafeAreaInsets();

  const box = useOutbox();
  // The visit as the server last sent it, from the copy kept on the phone.
  const getSaved = useCallback(() => fieldCache.getVisit(visitId), [visitId]);
  const saved = useSyncExternalStore(fieldCache.subscribe, getSaved, getSaved);
  const [loadError, setLoadError] = useState<string | null>(null);
  /** What went wrong and which control caused it, so the message shows beside that control. */
  const [failed, setFailed] = useState<{ at: string; message: string } | null>(null);
  /** What is being sent to the server (sign-off, the PDF) or kept on the phone (a photo), so the right button shows as busy. */
  const [busy, setBusy] = useState<string | null>(null);
  /** The task being marked as not done; `typing` once "Other" is chosen and a reason is being typed. */
  const [explaining, setExplaining] = useState<string | null>(null);
  const [typing, setTyping] = useState(false);
  const [reason, setReason] = useState('');
  const [reasonMissing, setReasonMissing] = useState(false);
  /** The team and notes as typed; null until the person changes them. */
  const [team, setTeam] = useState<string | null>(null);
  const [notes, setNotes] = useState<string | null>(null);
  /** True while the team or notes have been typed but not saved. */
  const [dirty, setDirty] = useState(false);
  const [confirming, setConfirming] = useState<'finish' | 'signOff' | null>(null);
  const [removing, setRemoving] = useState<VisitPhotoDto | null>(null);
  const [viewing, setViewing] = useState<{ uri: string; label: string } | null>(null);
  /** What Finish found missing: a task (`task-<id>`) or the after photo (`photo-AFTER`). */
  const [missing, setMissing] = useState<string | null>(null);
  /** The restaurant's rating and comment, chosen before signing off. */
  const [rating, setRating] = useState<Stars | null>(null);
  const [comment, setComment] = useState('');
  const [ratingMissing, setRatingMissing] = useState(false);

  const scrollRef = useRef<ScrollView>(null);
  /** How far down the page each task and the photo button sit, for scrolling to them. */
  const positions = useRef<Record<string, number>>({});

  const userId = user?.id ?? null;
  const userName = user?.name ?? null;
  // False only once the server could not be reached; the line at the bottom of the app says so.
  const hasSignal = box.online !== false;

  /**
   * Fetches the visit and keeps it on the phone. With no signal the copy
   * already on the phone stays on screen, which is not an error.
   */
  const load = useCallback(async () => {
    if (!userId) return;
    await fieldCache.load(userId);
    await fieldCache.open('visit', visitId);
    try {
      fieldCache.putVisit(await api.visits.get(visitId));
      outbox.noteReachable(true);
      setLoadError(null);
    } catch (e) {
      if (isNoSignal(e)) {
        outbox.noteReachable(false);
        setLoadError(fieldCache.getVisit(visitId) ? null : t('offline.visitNotOnPhone'));
      } else if (e instanceof ApiError && (e.status === 403 || e.status === 404)) {
        // Given to someone else, or removed. The old copy goes, unless work for it is still on this phone.
        if (!outbox.hasFieldWork('visit', visitId)) fieldCache.forget('visit', visitId);
        setLoadError(t('offline.visitGone'));
      } else {
        setLoadError(errorMessage(e, t));
      }
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [api, visitId, userId]);

  useFocusEffect(
    useCallback(() => {
      void load();
    }, [load]),
  );
  // And again the moment the signal comes back.
  useReloadOnSignal(load);

  const view = saved
    ? applyVisitPending(saved.data, box.ops, userId && userName !== null ? { id: userId, name: userName } : null)
    : null;
  const finishWaiting = view?.finishPending ?? false;
  const finishedOnServer = saved !== null && saved.data.completedAt !== null && saved.data.status !== 'IN_PROGRESS';

  // "Visit finished" is said when the server has it, not when Finish was pressed.
  const wasWaiting = useRef(false);
  useEffect(() => {
    if (wasWaiting.current && !finishWaiting && finishedOnServer) notify(t('visit.finishedDone'));
    wasWaiting.current = finishWaiting;
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [finishWaiting, finishedOnServer]);

  /**
   * For the steps that need signal (the restaurant's sign-off): sends one change
   * and keeps the visit as the server now has it. `key` is what shows as busy,
   * `at` is where an error is shown, `done` is the brief message shown when it worked.
   */
  async function run(key: string, at: string, action: () => Promise<VisitDto>, done?: string): Promise<boolean> {
    setBusy(key);
    setFailed(null);
    try {
      fieldCache.putVisit(await action());
      if (done) notify(done);
      return true;
    } catch (e) {
      setFailed({ at, message: errorMessage(e, t) });
      return false;
    } finally {
      setBusy(null);
    }
  }

  /**
   * Saves one thing the Supervisor did: onto the phone first, then the outbox
   * sends it. The only way this fails is the phone refusing to store it.
   */
  async function save(at: string, step: Record<string, unknown> & { kind: NewFieldOp['kind'] }, done?: string): Promise<boolean> {
    setFailed(null);
    try {
      await outbox.enqueue({ subject: 'visit', subjectId: visitId, ...step } as NewFieldOp);
      if (done) notify(done);
      return true;
    } catch {
      setFailed({ at, message: t('offline.saveFailed') });
      return false;
    }
  }

  async function addPhoto(kind: VisitPhotoKind) {
    if (busy !== null) return;
    setFailed(null);
    let photo;
    try {
      photo = await takeProofPhoto();
    } catch (e) {
      setFailed({
        at: `photo-${kind}`,
        message: t(e instanceof CameraPermissionError ? 'error.camera' : 'error.generic'),
      });
      return;
    }
    if (!photo) return;
    // The time is when the photo was taken, however much later it reaches the server.
    const capturedAt = new Date().toISOString();
    // The phone chooses the photo's id, so sending it twice stores it once.
    const photoId = newId();
    setBusy(`photo-${kind}`);
    try {
      // The camera saves into a folder the phone may clear; keep our own copy until it is sent.
      await keepPhoto(photoId, photo);
      await save(`photo-${kind}`, { kind: 'visitPhoto', photoId, photoKind: kind, capturedAt });
    } catch {
      setFailed({ at: `photo-${kind}`, message: t('offline.saveFailed') });
    } finally {
      setBusy(null);
    }
  }

  /** Opens the signed-off report as a PDF in the phone's viewer. The first time, the server makes it, which takes a few seconds. */
  async function openPdf() {
    if (busy !== null) return;
    setBusy('pdf');
    setFailed(null);
    try {
      const { path } = await api.visits.reportPdf(visitId);
      await Linking.openURL(api.fileUrl(path));
    } catch (e) {
      setFailed({ at: 'pdf', message: errorMessage(e, t) });
    } finally {
      setBusy(null);
    }
  }

  /** Opens the certificate issued for this visit, as a PDF. Needs signal, like the report. */
  async function openCertificate() {
    const certificate = view?.visit.certificate;
    if (busy !== null || !certificate) return;
    setBusy('certificate');
    setFailed(null);
    try {
      const { path } = await api.certificates.pdf(certificate.id);
      await Linking.openURL(api.fileUrl(path));
    } catch (e) {
      setFailed({ at: 'certificate', message: errorMessage(e, t) });
    } finally {
      setBusy(null);
    }
  }

  if (!view) {
    return (
      <Screen back title={t('visit.title')} onRefresh={load}>
        <ErrorText message={loadError} onRetry={() => void load()} />
        {!loadError && <ActivityIndicator color={theme.primary} />}
      </Screen>
    );
  }

  // The server's copy with this Supervisor's waiting work laid over it.
  const visit = view.visit;
  // Work the server refused is kept on the phone; nothing more is recorded until that is settled.
  const held = view.holdReason !== null;
  const started = visit.status !== 'SCHEDULED' && visit.status !== 'ASSIGNED' && visit.status !== 'CANCELLED';
  // Once Finish is pressed the visit is closed on this phone, even while the Finish waits to be sent.
  const recording = visit.canRecord && visit.status === 'IN_PROGRESS' && !finishWaiting && !held;
  const isReport =
    visit.status === 'IN_REVIEW' || visit.status === 'COMPLETED' || visit.status === 'APPROVED' || finishWaiting;
  const viewerRole = user?.memberships[0]?.role;
  const forRestaurant = viewerRole === undefined || !isEccsRole(viewerRole);
  const answered = visit.tasks.filter((task) => task.done !== null).length;
  const hasAfterPhoto = visit.photos.some((photo) => photo.kind === 'AFTER');
  const teamText = team ?? visit.technicianNames.join(', ');
  const notesText = notes ?? visit.notes ?? '';
  const errorAt = (at: string) => (failed?.at === at ? failed.message : null);
  const reasonTexts: string[] = REASONS.map((key) => t(`visit.reason.${key}`));

  const scrollTo = (key: string) => {
    const y = positions.current[key];
    if (y !== undefined) scrollToY(scrollRef, y);
  };

  /** Finish is always pressable: if something is missing it shows what, instead of sitting greyed out. */
  function pressFinish() {
    if (busy !== null) return;
    const unanswered = visit.tasks.find((task) => task.done === null);
    const lacking = unanswered ? `task-${unanswered.itemId}` : hasAfterPhoto ? null : 'photo-AFTER';
    if (lacking) {
      setMissing(lacking);
      scrollTo(lacking);
      return;
    }
    setMissing(null);
    setConfirming('finish');
  }

  // Kept within what the server accepts, so a long list of names is never a reason for it to refuse the step later.
  const details = () => ({
    technicianNames: splitNames(teamText)
      .map((name) => name.slice(0, 60))
      .slice(0, VISIT_MAX_TECHNICIANS),
    notes: notesText.trim(),
  });

  async function saveDetails() {
    if (busy !== null) return;
    if (await save('details', { kind: 'visitRecord', ...details() }, t('common.saved'))) setDirty(false);
  }

  /**
   * Finish joins the outbox behind the tasks and photos still waiting, so the
   * server gets them in the order they were done. `at` is the moment Finish was
   * pressed: the report shows that time, and the server uses it to recognise the
   * same Finish arriving twice.
   */
  async function finish() {
    // A team or note typed but not saved would be lost once the visit is closed, so it is saved first.
    if (dirty) {
      if (!(await save('finish', { kind: 'visitRecord', ...details() }))) return;
      setDirty(false);
    }
    if (await save('finish', { kind: 'visitComplete', at: new Date().toISOString() })) {
      if (!hasSignal) notify(t('offline.submitSaved'));
      scrollToY(scrollRef, 0);
    }
  }

  function closeReason() {
    setExplaining(null);
    setTyping(false);
    setReasonMissing(false);
  }

  function saveNotDone(task: VisitTaskDto, note: string) {
    if (busy !== null) return;
    void save(`task-${task.itemId}`, { kind: 'visitTask', itemId: task.itemId, done: false, note }).then(
      (ok) => ok && closeReason(),
    );
  }

  const heading = (text: string) => (
    <ThemedText type="smallBold" themeColor="textSecondary" style={styles.sectionGap}>
      {text}
    </ThemedText>
  );
  const fact = (label: string, value: string | null) =>
    value ? (
      <View style={styles.fact}>
        <ThemedText type="small" themeColor="textSecondary">
          {label}
        </ThemedText>
        <ThemedText type="default">{value}</ThemedText>
      </View>
    ) : null;

  const taskRow = (task: VisitTaskDto) => {
    const label = localize(task.label, language);
    if (!recording) {
      return (
        <View key={task.itemId} style={[styles.task, { borderColor: theme.border }]}>
          <ThemedText type="default" style={styles.taskLabel}>
            {label}
          </ThemedText>
          {task.done !== null && (
            <ThemedText type="smallBold" themeColor={task.done ? 'primary' : 'danger'}>
              {task.done ? `✓ ${t('visit.done')}` : `✗ ${t('visit.notDone')}`}
            </ThemedText>
          )}
          {task.note && (
            <ThemedText type="small" themeColor="textSecondary">
              {task.note}
            </ThemedText>
          )}
          {view.unsentTasks.has(task.itemId) && view.held === 0 && <UnsentMark sending={hasSignal} />}
        </View>
      );
    }

    const key = `task-${task.itemId}`;
    const open = explaining === task.itemId;
    const flagged = missing === key && task.done === null;

    // Done is green and Not done is red, so these stay their own buttons; the
    // chosen one also carries an icon and a filled background, not colour alone.
    const choice = (done: boolean) => {
      const selected = open ? !done : task.done === done;
      const color = done ? theme.primary : theme.danger;
      return (
        <Pressable
          accessibilityRole="radio"
          accessibilityState={{ selected, checked: selected, busy: busy === key }}
          disabled={busy !== null}
          onPress={() => {
            setReasonMissing(false);
            if (done) {
              closeReason();
              void save(key, { kind: 'visitTask', itemId: task.itemId, done: true });
            } else {
              // An earlier typed reason comes back in the text field; a one-tap reason shows as its chip.
              const typed = task.done === false && task.note !== null && !reasonTexts.includes(task.note);
              setExplaining(task.itemId);
              setTyping(typed);
              setReason(typed ? (task.note ?? '') : '');
            }
          }}
          style={[
            styles.choice,
            { borderColor: selected ? color : theme.outline },
            selected && { backgroundColor: theme.backgroundElement },
          ]}>
          {selected && <Ionicons name={done ? 'checkmark-circle' : 'close-circle'} size={22} color={color} />}
          <ThemedText type="default" style={[styles.choiceText, selected && { color, fontWeight: 700 }]}>
            {t(done ? 'visit.done' : 'visit.notDone')}
          </ThemedText>
        </Pressable>
      );
    };

    return (
      <View
        key={task.itemId}
        onLayout={(event) => {
          positions.current[key] = event.nativeEvent.layout.y;
        }}
        style={[styles.task, { borderColor: flagged ? theme.danger : theme.border }, flagged && styles.flagged]}>
        <ThemedText type="default" style={styles.taskLabel}>
          {label}
        </ThemedText>
        <View style={styles.choices}>
          {choice(true)}
          {choice(false)}
        </View>
        {/* Done here and on its way. The Supervisor can carry on; this mark goes once the server has it. */}
        {view.unsentTasks.has(task.itemId) && <UnsentMark sending={hasSignal} />}
        {open ? (
          <>
            <ThemedText type="smallBold" themeColor="textSecondary">
              {t('visit.reasonHeading')}
            </ThemedText>
            <View style={styles.chips}>
              {REASONS.map((name, index) => {
                const text = reasonTexts[index]!;
                return (
                  <OptionChip
                    key={name}
                    label={text}
                    selected={!typing && task.done === false && task.note === text}
                    onPress={() => saveNotDone(task, text)}
                  />
                );
              })}
              <OptionChip
                label={t('visit.reason.other')}
                selected={typing}
                onPress={() => {
                  setTyping(true);
                  setReasonMissing(false);
                }}
              />
            </View>
            {typing && (
              <>
                <TextField
                  label={t('visit.reasonOtherLabel')}
                  value={reason}
                  onChangeText={(text) => {
                    setReason(text);
                    setReasonMissing(false);
                  }}
                  error={reasonMissing ? t('visit.needReason') : null}
                  maxLength={300}
                  autoFocus
                />
                <Button
                  label={t('visit.saveReason')}
                  variant="secondary"
                  onPress={() => {
                    if (reason.trim().length === 0) setReasonMissing(true);
                    else saveNotDone(task, reason.trim());
                  }}
                />
              </>
            )}
          </>
        ) : (
          task.done === false &&
          task.note && (
            <ThemedText type="small" themeColor="textSecondary">
              {task.note}
            </ThemedText>
          )
        )}
        <ErrorText message={errorAt(key) ?? (flagged ? t('visit.needAnswer') : null)} />
      </View>
    );
  };

  /** Square thumbnails, three to a row. Tapping one shows the whole photo. */
  const photoGrid = (shown: VisitPhotoDto[], title: string) => {
    const rows: VisitPhotoDto[][] = [];
    for (let index = 0; index < shown.length; index += PHOTOS_PER_ROW) {
      rows.push(shown.slice(index, index + PHOTOS_PER_ROW));
    }
    return rows.map((row, rowIndex) => (
      <View key={row[0]!.id} style={styles.photoRow}>
        {row.map((photo, index) => {
          // A photo taken on this phone is shown from the phone until the server has it.
          const waiting = view.localPhotos.has(photo.id);
          const uri = waiting ? (keptPhotoUri(photo.id) ?? '') : api.fileUrl(photo.path);
          const numbered = t('visit.photoNumber', {
            title,
            number: rowIndex * PHOTOS_PER_ROW + index + 1,
            total: shown.length,
          });
          const label = waiting ? `${numbered}. ${t('offline.photoWaiting')}` : numbered;
          return (
            <View key={photo.id} style={styles.photoCell}>
              <Pressable
                accessibilityRole="imagebutton"
                accessibilityLabel={label}
                accessibilityHint={t('checklists.viewPhoto')}
                onPress={() => setViewing({ uri, label })}
                style={[styles.thumb, { backgroundColor: theme.backgroundElement }]}>
                <Image source={{ uri }} style={styles.thumbImage} resizeMode="cover" />
                {/* A cloud in the corner of a photo that is on this phone only, as well as the words below. */}
                {waiting && (
                  <View style={styles.waitingMark}>
                    <Ionicons name="cloud-upload-outline" size={18} color="#ffffff" />
                  </View>
                )}
              </Pressable>
              {recording && (
                <Pressable
                  accessibilityRole="button"
                  accessibilityLabel={`${t('visit.removePhoto')} (${label})`}
                  disabled={busy !== null}
                  onPress={() => setRemoving(photo)}
                  style={({ pressed }) => [styles.remove, pressed && { backgroundColor: theme.backgroundElement }]}>
                  <Ionicons name="trash-outline" size={24} color={theme.danger} />
                </Pressable>
              )}
            </View>
          );
        })}
        {/* Empty cells keep a short last row's photos the same size as the others. */}
        {Array.from({ length: PHOTOS_PER_ROW - row.length }, (_, index) => (
          <View key={index} style={styles.photoCell} />
        ))}
      </View>
    ));
  };

  const photos = (kind: VisitPhotoKind) => {
    const shown = visit.photos.filter((photo) => photo.kind === kind);
    const title = t(kind === 'BEFORE' ? 'visit.photosBefore' : 'visit.photosAfter');
    if (!recording && shown.length === 0 && !isReport) return null;
    const key = `photo-${kind}`;
    const flagged = missing === key && !hasAfterPhoto;
    const full = visit.photos.length >= VISIT_MAX_PHOTOS;
    return (
      <View
        style={styles.section}
        onLayout={(event) => {
          positions.current[key] = event.nativeEvent.layout.y;
        }}>
        {heading(title)}
        {shown.length === 0 && !recording && (
          <ThemedText type="default" themeColor="textSecondary">
            {t('visit.noPhotos')}
          </ThemedText>
        )}
        {photoGrid(shown, title)}
        {shown.some((photo) => view.localPhotos.has(photo.id)) && view.held === 0 && <UnsentMark sending={hasSignal} />}
        {recording && full && (
          <ThemedText type="small" themeColor="textSecondary">
            {t('offline.maxPhotos', { count: VISIT_MAX_PHOTOS })}
          </ThemedText>
        )}
        {recording && !full && (
          <Button
            icon="camera"
            label={t(kind === 'BEFORE' ? 'visit.addBefore' : 'visit.addAfter')}
            variant="secondary"
            loading={busy === key}
            onPress={() => void addPhoto(kind)}
          />
        )}
        <ErrorText message={errorAt(key) ?? (flagged ? t('visit.needAfterPhoto') : null)} />
      </View>
    );
  };

  const tasks = visit.tasks.length > 0 && (
    <>
      <View style={[styles.tasksHeading, styles.sectionGap]}>
        <ThemedText type="smallBold" themeColor="textSecondary">
          {t('visit.tasks')}
        </ThemedText>
        {recording && (
          <ThemedText type="smallBold" themeColor="textSecondary">
            {t('visit.progressCount', { done: answered, total: visit.tasks.length })}
          </ThemedText>
        )}
      </View>
      {visit.tasks.map(taskRow)}
    </>
  );

  // The main button stays in view at the bottom, with what is still to do.
  const footer = recording ? (
    <>
      <View accessibilityLiveRegion="polite" style={styles.progress}>
        <ThemedText type="smallBold">{t('visit.progress', { done: answered, total: visit.tasks.length })}</ThemedText>
        <View style={styles.progressPhoto}>
          <Ionicons
            name={hasAfterPhoto ? 'checkmark-circle' : 'ellipse-outline'}
            size={18}
            color={hasAfterPhoto ? theme.primary : theme.textSecondary}
          />
          <ThemedText type="small" themeColor={hasAfterPhoto ? 'primary' : 'textSecondary'} style={styles.flexText}>
            {t(hasAfterPhoto ? 'visit.afterPhotoAdded' : 'visit.afterPhotoMissing')}
          </ThemedText>
        </View>
      </View>
      <ErrorText message={errorAt('finish')} />
      <Button label={t('visit.finish')} onPress={pressFinish} />
    </>
  ) : visit.canSignOff ? (
    <>
      <ErrorText message={errorAt('signOff')} />
      <Button
        label={t('visit.signOff')}
        loading={busy === 'signOff'}
        onPress={() => {
          if (busy !== null) return;
          // The rating is part of signing off: point at it rather than greying the button out.
          if (rating === null) {
            setRatingMissing(true);
            scrollTo('rating');
          } else setConfirming('signOff');
        }}
      />
    </>
  ) : undefined;

  return (
    <Screen
      back
      title={localize(visit.serviceName, language)}
      subtitle={[visit.outletName, visit.organizationName].filter((name, index, all) => all.indexOf(name) === index).join(' · ')}
      onRefresh={async () => {
        // Pulling down also sends anything still waiting, without waiting for the next automatic try.
        outbox.kick();
        await load();
      }}
      scrollRef={scrollRef}
      footer={footer}>
      {/* A refresh that failed: the visit shown is the last one loaded. */}
      <ErrorText message={loadError} onRetry={() => void load()} />
      {/* No signal: this is the phone's own copy, and how old it is. */}
      {!hasSignal && saved && <SavedCopyNote at={saved.at} />}
      {view.holdReason && (
        <HeldNotice subject="visit" subjectId={visitId} reason={view.holdReason} count={view.held} />
      )}

      {/* Until the server has the Finish, the visit is not shown as finished: nobody else can see it yet. */}
      <VisitStatusBadge status={visit.status} />
      {finishWaiting && !held && <UnsentMark sending={hasSignal} text={t('offline.finishWaiting')} />}
      {view.checkInPending && !finishWaiting && !held && <UnsentMark sending={hasSignal} />}
      {visit.reportNumber && (
        <ThemedText type="default" style={styles.reportNumber}>
          {t('visit.report')} · {visit.reportNumber}
        </ThemedText>
      )}

      <View style={[styles.facts, { backgroundColor: theme.backgroundElement }]}>
        <ThemedText type="default" style={styles.when}>
          {[formatDayLong(visit.date, language), formatSlot(visit.slot, language, t)].filter(Boolean).join(' · ')}
        </ThemedText>
        {fact(t('visit.address'), visit.canRecord ? visit.outletAddress : null)}
        {fact(t('visit.supervisor'), visit.supervisorName ?? (started ? null : t('visit.notAssigned')))}
        {fact(t('visit.arrived'), visit.checkInAt ? formatDateTime(visit.checkInAt, language) : null)}
        {fact(t('visit.finished'), visit.completedAt ? formatDateTime(visit.completedAt, language) : null)}
        {!recording && fact(t('visit.team'), visit.technicianNames.join(', ') || null)}
      </View>

      {visit.canRecord && !started && !held && (
        <>
          <Button
            label={t('visit.checkIn')}
            // The time is when the Supervisor tapped, however much later it reaches the server.
            onPress={() =>
              void save('checkIn', { kind: 'visitCheckIn', at: new Date().toISOString() }, t('visit.checkedIn'))
            }
          />
          <ErrorText message={errorAt('checkIn')} />
          <ThemedText type="small" themeColor="textSecondary">
            {t('visit.checkInHint')}
          </ThemedText>
        </>
      )}

      {visit.correctionNote && (
        <View style={[styles.correction, { borderColor: theme.warning }]}>
          <ThemedText type="default" themeColor="warning" style={styles.signedText}>
            {t('visit.correction')}
          </ThemedText>
          <ThemedText type="default">{visit.correctionNote}</ThemedText>
        </View>
      )}

      {/* While working: before photo, the tasks, then the after photo. In the
          finished report the before and after photos sit together, above the tasks. */}
      {photos('BEFORE')}
      {isReport && photos('AFTER')}
      {tasks}
      {!isReport && photos('AFTER')}

      {recording ? (
        <>
          {heading(t('visit.team'))}
          <TextField
            label={t('visit.teamLabel')}
            value={teamText}
            onChangeText={(text) => {
              setTeam(text);
              setDirty(true);
            }}
            placeholder={t('visit.teamPlaceholder')}
            maxLength={300}
          />
          <TextField
            label={t('visit.notes')}
            value={notesText}
            onChangeText={(text) => {
              setNotes(text);
              setDirty(true);
            }}
            placeholder={t('visit.notesPlaceholder')}
            maxLength={1000}
            multiline
            style={styles.notes}
          />
          <Button label={t('visit.saveDetails')} variant="secondary" onPress={() => void saveDetails()} />
          {view.recordPending && !dirty && <UnsentMark sending={hasSignal} />}
          <ErrorText message={errorAt('details')} />
        </>
      ) : (
        visit.notes && (
          <>
            {heading(t('visit.notes'))}
            <ThemedText type="default">{visit.notes}</ThemedText>
          </>
        )
      )}

      {visit.signOff && (
        <View style={[styles.signed, { borderColor: theme.primary }]}>
          <ThemedText type="default" themeColor="primary" style={styles.signedText}>
            ✓ {t('visit.signedBy', { name: visit.signOff.name })}
          </ThemedText>
          <ThemedText type="small" themeColor="textSecondary">
            {formatDateTime(visit.signOff.signedAt, language)}
          </ThemedText>
          {visit.signOff.rating !== null && (
            <View style={styles.rated}>
              <StarRating value={visit.signOff.rating} />
              <ThemedText type="default" style={styles.signedText}>
                {t(`visit.rating.${visit.signOff.rating as Stars}`)}
              </ThemedText>
            </View>
          )}
          {visit.signOff.comment && <ThemedText type="default">{visit.signOff.comment}</ThemedText>}
        </View>
      )}
      {/* The PDF exists once ECCS has approved the signed-off report. */}
      {visit.status === 'APPROVED' && visit.signOff && (
        <>
          <Button
            icon="document-text"
            label={t('visit.pdf')}
            variant="secondary"
            loading={busy === 'pdf'}
            onPress={() => void openPdf()}
          />
          <ErrorText message={errorAt('pdf')} />
        </>
      )}
      {/* Some kinds of visit (pest control, for one) also carry a certificate, issued with the approval. */}
      {visit.certificate && (
        <>
          <ThemedText type="default">
            {t('cert.number', { number: ltrText(visit.certificate.number) })} ·{' '}
            {t('cert.validUntil', { date: formatDate(visit.certificate.validUntil, language) })}
          </ThemedText>
          <Button
            icon="ribbon-outline"
            label={t('cert.open')}
            variant="secondary"
            loading={busy === 'certificate'}
            onPress={() => void openCertificate()}
          />
          <ErrorText message={errorAt('certificate')} />
        </>
      )}
      {visit.status === 'IN_REVIEW' && (
        <ThemedText type="default" themeColor="warning" style={styles.sectionGap}>
          {t(forRestaurant ? 'visit.inReviewRestaurant' : 'visit.inReviewEccs')}
        </ThemedText>
      )}
      {visit.status === 'COMPLETED' && !visit.canSignOff && (
        <ThemedText type="default" themeColor="warning" style={styles.sectionGap}>
          {t('visit.awaitingSignOff')}
        </ThemedText>
      )}
      {visit.canSignOff && (
        <View
          style={[styles.rate, { borderColor: ratingMissing && rating === null ? theme.danger : theme.border }]}
          onLayout={(event) => {
            positions.current.rating = event.nativeEvent.layout.y;
          }}>
          <ThemedText type="default" style={styles.rateTitle}>
            {t('visit.rate')}
          </ThemedText>
          <StarRating
            value={rating}
            disabled={busy !== null}
            onChange={(stars) => {
              setRating(stars);
              setRatingMissing(false);
            }}
          />
          {/* The word for the chosen number of stars, so the rating is not a guess. */}
          <ThemedText type="default" themeColor={rating ? 'text' : 'textSecondary'} style={styles.rateWord}>
            {rating ? t(`visit.rating.${rating}`) : t('visit.rateHelp')}
          </ThemedText>
          <ErrorText message={ratingMissing && rating === null ? t('visit.rateFirst') : null} />
          <TextField
            label={t('visit.comment')}
            value={comment}
            onChangeText={setComment}
            placeholder={t('visit.commentPlaceholder')}
            maxLength={500}
            multiline
            style={styles.notes}
          />
          <ThemedText type="small" themeColor="textSecondary">
            {t('visit.signOffHelp')}
          </ThemedText>
        </View>
      )}

      <ConfirmDialog
        visible={confirming !== null}
        message={
          confirming === 'signOff' ? t('visit.signOffConfirm', { name: user?.name ?? '' }) : t('visit.finishConfirm')
        }
        confirmLabel={t(confirming === 'signOff' ? 'visit.signOff' : 'visit.finish')}
        onConfirm={() => {
          const action = confirming;
          setConfirming(null);
          if (action === 'signOff') {
            const stars = rating;
            if (stars === null) return;
            void run(
              'signOff',
              'signOff',
              () => api.visits.signOff(visitId, { rating: stars, ...(comment.trim() && { comment: comment.trim() }) }),
              t('visit.signedOffDone'),
            );
          } else if (action === 'finish') void finish();
        }}
        onCancel={() => setConfirming(null)}
      />

      <ConfirmDialog
        visible={removing !== null}
        message={t('visit.removePhotoConfirm')}
        confirmLabel={t('visit.removePhoto')}
        danger
        onConfirm={() => {
          const photo = removing;
          setRemoving(null);
          if (photo) {
            void save(`photo-${photo.kind}`, { kind: 'visitPhotoRemove', photoId: photo.id }, t('visit.photoRemoved'));
          }
        }}
        onCancel={() => setRemoving(null)}
      />

      <Modal visible={viewing !== null} transparent animationType="fade" onRequestClose={() => setViewing(null)}>
        <DirectionView
          style={[
            styles.viewer,
            { paddingTop: Spacing.three + insets.top, paddingBottom: Spacing.three + insets.bottom },
          ]}>
          {viewing && (
            <>
              <Image
                source={{ uri: viewing.uri }}
                style={styles.full}
                resizeMode="contain"
                accessibilityLabel={viewing.label}
              />
              <ThemedText type="default" style={styles.viewerLabel}>
                {viewing.label}
              </ThemedText>
            </>
          )}
          <Button label={t('common.close')} variant="secondary" onPress={() => setViewing(null)} />
        </DirectionView>
      </Modal>
    </Screen>
  );
}

const styles = StyleSheet.create({
  correction: { borderWidth: 2, borderRadius: Spacing.three, padding: Spacing.three, gap: Spacing.one },
  rate: { marginTop: Spacing.four, borderWidth: 2, borderRadius: Spacing.three, padding: Spacing.three, gap: Spacing.two },
  rateTitle: { fontWeight: 700, fontSize: 18, textAlign: 'center' },
  rateWord: { textAlign: 'center', fontWeight: 600 },
  rated: { flexDirection: 'row', alignItems: 'center', gap: Spacing.two, marginTop: Spacing.one },
  reportNumber: { fontWeight: 700 },
  facts: { borderRadius: Spacing.three, padding: Spacing.three, gap: Spacing.two },
  when: { fontWeight: 700, fontSize: 18 },
  fact: { gap: Spacing.half },
  section: { gap: Spacing.three },
  sectionGap: { marginTop: Spacing.four },
  tasksHeading: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'baseline', gap: Spacing.two },
  task: { borderWidth: 1, borderRadius: Spacing.three, padding: Spacing.three, gap: Spacing.two },
  flagged: { borderWidth: 2 },
  taskLabel: { fontSize: 17 },
  choices: { flexDirection: 'row', gap: Spacing.two },
  choice: {
    flex: 1,
    flexDirection: 'row',
    gap: Spacing.one,
    minHeight: MinTouchSize,
    borderWidth: 2,
    borderRadius: Spacing.three,
    paddingHorizontal: Spacing.two,
    paddingVertical: Spacing.one,
    alignItems: 'center',
    justifyContent: 'center',
  },
  choiceText: { flexShrink: 1, textAlign: 'center' },
  chips: { flexDirection: 'row', flexWrap: 'wrap', gap: Spacing.two },
  photoRow: { flexDirection: 'row', gap: Spacing.two },
  photoCell: { flex: 1 },
  thumb: { width: '100%', aspectRatio: 1, borderRadius: Spacing.two, overflow: 'hidden' },
  thumbImage: { width: '100%', height: '100%' },
  waitingMark: {
    position: 'absolute',
    top: Spacing.one,
    end: Spacing.one,
    width: 28,
    height: 28,
    borderRadius: 14,
    backgroundColor: 'rgba(0,0,0,0.75)',
    alignItems: 'center',
    justifyContent: 'center',
  },
  remove: { minHeight: MinTouchSize, borderRadius: Spacing.two, alignItems: 'center', justifyContent: 'center' },
  progress: { gap: Spacing.half },
  progressPhoto: { flexDirection: 'row', alignItems: 'center', gap: Spacing.one },
  flexText: { flex: 1 },
  notes: { minHeight: 100, paddingVertical: Spacing.two, fontSize: 17, textAlignVertical: 'top' },
  signed: { marginTop: Spacing.four, borderWidth: 2, borderRadius: Spacing.three, padding: Spacing.three, gap: Spacing.one },
  signedText: { fontWeight: 700 },
  viewer: {
    flex: 1,
    backgroundColor: 'rgba(0,0,0,0.92)',
    padding: Spacing.three,
    gap: Spacing.three,
    justifyContent: 'center',
  },
  full: { width: '100%', flex: 1 },
  viewerLabel: { color: '#ffffff', textAlign: 'center' },
});
