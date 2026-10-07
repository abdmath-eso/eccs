import { localize, type VisitDto, type VisitPhotoKind, type VisitTaskDto } from '@eccs/shared';
import { useFocusEffect, useLocalSearchParams } from 'expo-router';
import { useCallback, useState } from 'react';
import { ActivityIndicator, Pressable, StyleSheet, View } from 'react-native';

import { ProofPhoto } from '@/components/proof-photo';
import { ThemedText } from '@/components/themed-text';
import { Button } from '@/components/ui/button';
import { ConfirmDialog } from '@/components/ui/confirm-dialog';
import { ErrorText } from '@/components/ui/error-text';
import { Screen } from '@/components/ui/screen';
import { TextField } from '@/components/ui/text-field';
import { VisitStatusBadge } from '@/components/visit-card';
import { MinTouchSize, Spacing } from '@/constants/theme';
import { useTheme } from '@/hooks/use-theme';
import { errorMessage } from '@/lib/errors';
import { formatDateTime, formatDayLong, formatSlot } from '@/lib/format';
import { CameraPermissionError, takeProofPhoto } from '@/lib/photo';
import { useSession } from '@/lib/session';

const splitNames = (text: string) =>
  text
    .split(/[,\n]/)
    .map((name) => name.trim())
    .filter(Boolean);

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

  const [visit, setVisit] = useState<VisitDto | null>(null);
  const [error, setError] = useState<string | null>(null);
  /** What is being sent to the server, so the right button shows as busy. */
  const [busy, setBusy] = useState<string | null>(null);
  /** The task being marked as not done, and the reason being typed for it. */
  const [explaining, setExplaining] = useState<string | null>(null);
  const [reason, setReason] = useState('');
  /** The team and notes as typed; null until the person changes them. */
  const [team, setTeam] = useState<string | null>(null);
  const [notes, setNotes] = useState<string | null>(null);
  const [savedDetails, setSavedDetails] = useState(false);
  const [confirming, setConfirming] = useState<'finish' | 'signOff' | null>(null);

  useFocusEffect(
    useCallback(() => {
      let cancelled = false;
      api.visits
        .get(visitId)
        .then((loaded) => !cancelled && setVisit(loaded))
        .catch((e) => !cancelled && setError(errorMessage(e, t)));
      return () => {
        cancelled = true;
      };
      // eslint-disable-next-line react-hooks/exhaustive-deps
    }, [api, visitId]),
  );

  /** Sends one change and shows the visit as the server now has it. */
  async function run(key: string, action: () => Promise<VisitDto>): Promise<boolean> {
    setBusy(key);
    setError(null);
    try {
      setVisit(await action());
      return true;
    } catch (e) {
      setError(errorMessage(e, t));
      return false;
    } finally {
      setBusy(null);
    }
  }

  async function addPhoto(kind: VisitPhotoKind) {
    setError(null);
    let photo;
    try {
      photo = await takeProofPhoto();
    } catch (e) {
      setError(t(e instanceof CameraPermissionError ? 'error.camera' : 'error.generic'));
      return;
    }
    if (!photo) return;
    const file = photo.file;
    await run(`photo-${kind}`, () => api.visits.addPhoto(visitId, kind, file));
  }

  if (!visit) {
    return (
      <Screen back title={t('visit.title')}>
        <ErrorText message={error} />
        {!error && <ActivityIndicator color={theme.primary} />}
      </Screen>
    );
  }

  const started = visit.status !== 'SCHEDULED' && visit.status !== 'ASSIGNED' && visit.status !== 'CANCELLED';
  const recording = visit.canRecord && visit.status === 'IN_PROGRESS';
  const isReport = visit.status === 'COMPLETED' || visit.status === 'APPROVED';
  const readyToFinish =
    visit.tasks.every((task) => task.done !== null) && visit.photos.some((photo) => photo.kind === 'AFTER');
  const teamText = team ?? visit.technicianNames.join(', ');
  const notesText = notes ?? visit.notes ?? '';

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

    const choice = (done: boolean) => {
      const selected = task.done === done && explaining !== task.itemId;
      const color = done ? theme.primary : theme.danger;
      return (
        <Pressable
          accessibilityRole="radio"
          accessibilityState={{ selected, busy: busy === `task-${task.itemId}` }}
          disabled={busy !== null}
          onPress={() => {
            if (done) {
              setExplaining(null);
              void run(`task-${task.itemId}`, () => api.visits.answerTask(visitId, task.itemId, { done: true }));
            } else {
              setExplaining(task.itemId);
              setReason(task.done === false ? (task.note ?? '') : '');
            }
          }}
          style={[
            styles.choice,
            { borderColor: selected ? color : theme.border },
            selected && { backgroundColor: theme.backgroundElement },
          ]}>
          <ThemedText type="default" style={selected ? { color, fontWeight: 700 } : undefined}>
            {done ? `✓ ${t('visit.done')}` : `✗ ${t('visit.notDone')}`}
          </ThemedText>
        </Pressable>
      );
    };

    return (
      <View key={task.itemId} style={[styles.task, { borderColor: theme.border }]}>
        <ThemedText type="default" style={styles.taskLabel}>
          {label}
        </ThemedText>
        <View style={styles.choices}>
          {choice(true)}
          {choice(false)}
        </View>
        {explaining === task.itemId ? (
          <>
            <TextField
              value={reason}
              onChangeText={setReason}
              placeholder={t('visit.notDoneWhy')}
              accessibilityLabel={t('visit.notDoneWhy')}
              maxLength={300}
              autoFocus
            />
            <Button
              label={t('visit.saveReason')}
              variant="secondary"
              loading={busy === `task-${task.itemId}`}
              disabled={reason.trim().length === 0}
              onPress={() =>
                void run(`task-${task.itemId}`, () =>
                  api.visits.answerTask(visitId, task.itemId, { done: false, note: reason.trim() }),
                ).then((ok) => ok && setExplaining(null))
              }
            />
          </>
        ) : (
          task.done === false &&
          task.note && (
            <ThemedText type="small" themeColor="textSecondary">
              {task.note}
            </ThemedText>
          )
        )}
      </View>
    );
  };

  const photos = (kind: VisitPhotoKind) => {
    const shown = visit.photos.filter((photo) => photo.kind === kind);
    const title = t(kind === 'BEFORE' ? 'visit.photosBefore' : 'visit.photosAfter');
    if (!recording && shown.length === 0 && !isReport) return null;
    return (
      <>
        {heading(title)}
        {shown.length === 0 && !recording && (
          <ThemedText type="default" themeColor="textSecondary">
            {t('visit.noPhotos')}
          </ThemedText>
        )}
        {shown.map((photo) => (
          <View key={photo.id} style={styles.photo}>
            <ProofPhoto uri={api.fileUrl(photo.path)} label={title} />
            {recording && (
              <Button
                label={t('visit.removePhoto')}
                variant="link"
                disabled={busy !== null}
                onPress={() => void run('remove', () => api.visits.removePhoto(visitId, photo.id))}
              />
            )}
          </View>
        ))}
        {recording && (
          <Button
            label={`📷  ${t(kind === 'BEFORE' ? 'visit.addBefore' : 'visit.addAfter')}`}
            variant="secondary"
            loading={busy === `photo-${kind}`}
            disabled={busy !== null}
            onPress={() => void addPhoto(kind)}
          />
        )}
      </>
    );
  };

  return (
    <Screen
      back
      title={localize(visit.serviceName, language)}
      subtitle={[visit.outletName, visit.organizationName].filter((name, index, all) => all.indexOf(name) === index).join(' · ')}>
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
            onPress={() => void run('checkIn', () => api.visits.checkIn(visitId))}
          />
          <ThemedText type="small" themeColor="textSecondary">
            {t('visit.checkInHint')}
          </ThemedText>
        </>
      )}

      <ErrorText message={error} />

      {photos('BEFORE')}

      {visit.tasks.length > 0 && (
        <>
          {heading(t('visit.tasks'))}
          {visit.tasks.map(taskRow)}
        </>
      )}

      {photos('AFTER')}

      {recording ? (
        <>
          {heading(t('visit.team'))}
          <TextField
            label={t('visit.teamLabel')}
            value={teamText}
            onChangeText={(text) => {
              setTeam(text);
              setSavedDetails(false);
            }}
            placeholder={t('visit.teamPlaceholder')}
            maxLength={300}
          />
          <TextField
            label={t('visit.notes')}
            value={notesText}
            onChangeText={(text) => {
              setNotes(text);
              setSavedDetails(false);
            }}
            placeholder={t('visit.notesPlaceholder')}
            maxLength={1000}
            multiline
            style={styles.notes}
          />
          <Button
            label={savedDetails ? `✓ ${t('visit.saved')}` : t('visit.saveDetails')}
            variant="secondary"
            loading={busy === 'details'}
            disabled={busy !== null || (team === null && notes === null)}
            onPress={() =>
              void run('details', () =>
                api.visits.updateRecord(visitId, { technicianNames: splitNames(teamText), notes: notesText.trim() }),
              ).then((ok) => ok && setSavedDetails(true))
            }
          />

          <View style={styles.sectionGap}>
            <Button
              label={t('visit.finish')}
              loading={busy === 'finish'}
              disabled={busy !== null || !readyToFinish}
              onPress={() => setConfirming('finish')}
            />
          </View>
          {!readyToFinish && (
            <ThemedText type="small" themeColor="textSecondary">
              {t('visit.finishNeeds')}
            </ThemedText>
          )}
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
        </View>
      )}
      {visit.status === 'COMPLETED' && !visit.canSignOff && (
        <ThemedText type="default" themeColor="warning" style={styles.sectionGap}>
          {t('visit.awaitingSignOff')}
        </ThemedText>
      )}
      {visit.canSignOff && (
        <View style={styles.signOff}>
          <ThemedText type="default">{t('visit.signOffHelp')}</ThemedText>
          <Button label={t('visit.signOff')} loading={busy === 'signOff'} onPress={() => setConfirming('signOff')} />
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
          if (action === 'signOff') void run('signOff', () => api.visits.signOff(visitId));
          else if (action === 'finish') void run('finish', () => api.visits.complete(visitId));
        }}
        onCancel={() => setConfirming(null)}
      />
    </Screen>
  );
}

const styles = StyleSheet.create({
  reportNumber: { fontWeight: 700 },
  facts: { borderRadius: Spacing.three, padding: Spacing.three, gap: Spacing.two },
  when: { fontWeight: 700, fontSize: 18 },
  fact: { gap: Spacing.half },
  sectionGap: { marginTop: Spacing.four },
  task: { borderWidth: 1, borderRadius: Spacing.three, padding: Spacing.three, gap: Spacing.two },
  taskLabel: { fontSize: 17 },
  choices: { flexDirection: 'row', gap: Spacing.two },
  choice: {
    flex: 1,
    minHeight: MinTouchSize,
    borderWidth: 2,
    borderRadius: Spacing.three,
    paddingHorizontal: Spacing.two,
    alignItems: 'center',
    justifyContent: 'center',
  },
  photo: { gap: Spacing.one },
  notes: { minHeight: 100, paddingVertical: Spacing.two, fontSize: 17, textAlignVertical: 'top' },
  signed: { marginTop: Spacing.four, borderWidth: 2, borderRadius: Spacing.three, padding: Spacing.three, gap: Spacing.one },
  signedText: { fontWeight: 700 },
  signOff: { marginTop: Spacing.four, gap: Spacing.three },
});
