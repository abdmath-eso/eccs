import { isEccsRole, localize, type VisitDto, type VisitPhotoDto, type VisitPhotoKind, type VisitTaskDto } from '@eccs/shared';
import Ionicons from '@expo/vector-icons/Ionicons';
import { useFocusEffect, useLocalSearchParams } from 'expo-router';
import { useCallback, useRef, useState } from 'react';
import { ActivityIndicator, Image, Linking, Modal, Pressable, ScrollView, StyleSheet, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

import { ThemedText } from '@/components/themed-text';
import { Button } from '@/components/ui/button';
import { ConfirmDialog } from '@/components/ui/confirm-dialog';
import { ErrorText } from '@/components/ui/error-text';
import { OptionChip } from '@/components/ui/option-chip';
import { Screen } from '@/components/ui/screen';
import { StarRating, type Stars } from '@/components/ui/star-rating';
import { useSnackbar } from '@/components/ui/snackbar';
import { TextField } from '@/components/ui/text-field';
import { VisitStatusBadge } from '@/components/visit-card';
import { MinTouchSize, Spacing } from '@/constants/theme';
import { useTheme } from '@/hooks/use-theme';
import { errorMessage } from '@/lib/errors';
import { formatDateTime, formatDayLong, formatSlot } from '@/lib/format';
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

  const [visit, setVisit] = useState<VisitDto | null>(null);
  const [loadError, setLoadError] = useState<string | null>(null);
  /** What went wrong and which control caused it, so the message shows beside that control. */
  const [failed, setFailed] = useState<{ at: string; message: string } | null>(null);
  /** What is being sent to the server, so the right button shows as busy. */
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

  const load = useCallback(async () => {
    try {
      setVisit(await api.visits.get(visitId));
      setLoadError(null);
    } catch (e) {
      setLoadError(errorMessage(e, t));
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [api, visitId]);

  useFocusEffect(
    useCallback(() => {
      void load();
    }, [load]),
  );

  /**
   * Sends one change and shows the visit as the server now has it. `key` is
   * what shows as busy, `at` is where an error is shown, `done` is the brief
   * message shown when it worked.
   */
  async function run(key: string, at: string, action: () => Promise<VisitDto>, done?: string): Promise<boolean> {
    setBusy(key);
    setFailed(null);
    try {
      setVisit(await action());
      if (done) notify(done);
      return true;
    } catch (e) {
      setFailed({ at, message: errorMessage(e, t) });
      return false;
    } finally {
      setBusy(null);
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
    const file = photo.file;
    await run(`photo-${kind}`, `photo-${kind}`, () => api.visits.addPhoto(visitId, kind, file));
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

  if (!visit) {
    return (
      <Screen back title={t('visit.title')} onRefresh={load}>
        <ErrorText message={loadError} onRetry={() => void load()} />
        {!loadError && <ActivityIndicator color={theme.primary} />}
      </Screen>
    );
  }

  const started = visit.status !== 'SCHEDULED' && visit.status !== 'ASSIGNED' && visit.status !== 'CANCELLED';
  const recording = visit.canRecord && visit.status === 'IN_PROGRESS';
  const isReport = visit.status === 'IN_REVIEW' || visit.status === 'COMPLETED' || visit.status === 'APPROVED';
  // ECCS checks a finished report before the restaurant may read it.
  const viewerRole = user?.memberships[0]?.role;
  const withheld = visit.status === 'IN_REVIEW' && (viewerRole === undefined || !isEccsRole(viewerRole));
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
    const unanswered = visit?.tasks.find((task) => task.done === null);
    const lacking = unanswered ? `task-${unanswered.itemId}` : hasAfterPhoto ? null : 'photo-AFTER';
    if (lacking) {
      setMissing(lacking);
      scrollTo(lacking);
      return;
    }
    setMissing(null);
    setConfirming('finish');
  }

  const details = () => ({ technicianNames: splitNames(teamText), notes: notesText.trim() });

  async function saveDetails() {
    if (busy !== null) return;
    if (await run('details', 'details', () => api.visits.updateRecord(visitId, details()), t('common.saved'))) {
      setDirty(false);
    }
  }

  async function finish() {
    // A team or note typed but not saved would be lost once the visit is closed, so it is saved first.
    if (dirty) {
      if (!(await run('finish', 'finish', () => api.visits.updateRecord(visitId, details())))) return;
      setDirty(false);
    }
    await run('finish', 'finish', () => api.visits.complete(visitId), t('visit.finishedDone'));
  }

  function closeReason() {
    setExplaining(null);
    setTyping(false);
    setReasonMissing(false);
  }

  function saveNotDone(task: VisitTaskDto, note: string) {
    if (busy !== null) return;
    void run(`task-${task.itemId}`, `task-${task.itemId}`, () =>
      api.visits.answerTask(visitId, task.itemId, { done: false, note }),
    ).then((ok) => ok && closeReason());
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
              void run(key, key, () => api.visits.answerTask(visitId, task.itemId, { done: true }));
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
        {busy === key && <ActivityIndicator color={theme.primary} />}
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
                  loading={busy === key}
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
          const uri = api.fileUrl(photo.path);
          const label = t('visit.photoNumber', {
            title,
            number: rowIndex * PHOTOS_PER_ROW + index + 1,
            total: shown.length,
          });
          return (
            <View key={photo.id} style={styles.photoCell}>
              <Pressable
                accessibilityRole="imagebutton"
                accessibilityLabel={label}
                accessibilityHint={t('checklists.viewPhoto')}
                onPress={() => setViewing({ uri, label })}
                style={[styles.thumb, { backgroundColor: theme.backgroundElement }]}>
                <Image source={{ uri }} style={styles.thumbImage} resizeMode="cover" />
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
        {recording && (
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
      <Button label={t('visit.finish')} loading={busy === 'finish'} onPress={pressFinish} />
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
      onRefresh={load}
      scrollRef={scrollRef}
      footer={footer}>
      {/* A refresh that failed: the visit shown is the last one loaded. */}
      <ErrorText message={loadError} onRetry={() => void load()} />

      <VisitStatusBadge status={visit.status} />
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

      {visit.canRecord && !started && (
        <>
          <Button
            label={t('visit.checkIn')}
            loading={busy === 'checkIn'}
            onPress={() => void run('checkIn', 'checkIn', () => api.visits.checkIn(visitId), t('visit.checkedIn'))}
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
      {!withheld && photos('BEFORE')}
      {!withheld && isReport && photos('AFTER')}
      {!withheld && tasks}
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
          <Button
            label={t('visit.saveDetails')}
            variant="secondary"
            loading={busy === 'details'}
            onPress={() => void saveDetails()}
          />
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
      {visit.signOff && (
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
      {visit.status === 'IN_REVIEW' && (
        <ThemedText type="default" themeColor="warning" style={styles.sectionGap}>
          {t(withheld ? 'visit.inReviewRestaurant' : 'visit.inReviewEccs')}
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
            void run(
              'remove',
              `photo-${photo.kind}`,
              () => api.visits.removePhoto(visitId, photo.id),
              t('visit.photoRemoved'),
            );
          }
        }}
        onCancel={() => setRemoving(null)}
      />

      <Modal visible={viewing !== null} transparent animationType="fade" onRequestClose={() => setViewing(null)}>
        <View
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
        </View>
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
