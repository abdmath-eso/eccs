import Ionicons from '@expo/vector-icons/Ionicons';
import { ApiError, type UploadFile } from '@eccs/api-client';
import type { MessageKey } from '@eccs/i18n';
import { ATTENDANCE_ERROR, FACE_CONSENT_VERSION, FACE_RULES, can, type FaceStatusDto, type StaffMemberDto } from '@eccs/shared';
import { Redirect, router, useLocalSearchParams } from 'expo-router';
import { useState } from 'react';
import { ActivityIndicator, Image, StyleSheet, View } from 'react-native';

import { FaceCapture } from '@/components/face-capture';
import { useLoaded } from '@/components/team-parts';
import { ThemedText } from '@/components/themed-text';
import { Button } from '@/components/ui/button';
import { ConfirmDialog } from '@/components/ui/confirm-dialog';
import { ErrorText } from '@/components/ui/error-text';
import { Screen } from '@/components/ui/screen';
import { useSnackbar } from '@/components/ui/snackbar';
import { Spacing } from '@/constants/theme';
import { useTheme } from '@/hooks/use-theme';
import { errorMessage } from '@/lib/errors';
import { formatDate, indiaToday } from '@/lib/format';
import { useSession } from '@/lib/session';

// A person's face for attendance: where it stands, and for the Owner the way
// to add it, replace it or remove it.
//
// The order is the one the law and good practice ask for (research_notes/Face
// attendance/law-and-privacy.md, checklist A): first a notice that stands by
// itself, in the app's language, which the EMPLOYEE reads and answers with
// their own tap ("I agree" and "I do not agree" the same size, neither chosen
// beforehand); only then the camera. Saying no costs the person nothing: the
// Owner or Manager clocks them in instead. As in Jibble's set-up of face data,
// several photos from slightly different angles are taken, and all must pass.

// One instruction for each enrolment photo, in the order they are taken.
const POSES: { instruction: MessageKey; icon: 'happy-outline' | 'arrow-back-circle-outline' | 'arrow-forward-circle-outline' }[] = [
  { instruction: 'face.pose.straight', icon: 'happy-outline' },
  { instruction: 'face.pose.left', icon: 'arrow-back-circle-outline' },
  { instruction: 'face.pose.right', icon: 'arrow-forward-circle-outline' },
];

interface Taken {
  file: UploadFile;
  uri: string;
}

type Step =
  | { at: 'status' }
  | { at: 'consent' }
  // `acceptedAt`: the moment the employee tapped "I agree". `retake`: the one photo the server asked for again.
  | { at: 'capture'; acceptedAt: string; photos: (Taken | null)[]; camera: boolean; retake: boolean }
  | { at: 'done' };

// The consent notice, one short paragraph each, in the order it is read.
const NOTICE: { icon: 'business-outline' | 'camera-outline' | 'time-outline' | 'ban-outline' | 'hand-left-outline' | 'trash-outline' | 'chatbubble-outline'; text: MessageKey }[] = [
  { icon: 'business-outline', text: 'face.consent.who' },
  { icon: 'camera-outline', text: 'face.consent.what' },
  { icon: 'time-outline', text: 'face.consent.why' },
  { icon: 'ban-outline', text: 'face.consent.not' },
  { icon: 'hand-left-outline', text: 'face.consent.choice' },
  { icon: 'trash-outline', text: 'face.consent.withdraw' },
  { icon: 'chatbubble-outline', text: 'face.consent.ask' },
];

export default function FaceScreen() {
  const theme = useTheme();
  const { t, api, user, language } = useSession();
  const notify = useSnackbar();
  // `fresh` is set when the Owner has just added this person: the screen then offers "Do this later".
  const { staffId, fresh } = useLocalSearchParams<{ staffId: string; fresh?: string }>();
  const [step, setStep] = useState<Step>({ at: 'status' });
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [confirmRemove, setConfirmRemove] = useState(false);
  // True after "I do not agree", so the status page says what happens instead.
  const [declined, setDeclined] = useState(false);

  const memberships = user?.memberships ?? [];
  // The Owner and the Manager may see where it stands; only the Owner may change it (the server checks the same).
  const allowed = can(memberships, 'staff', 'update');
  const isOwner = memberships.some((membership) => membership.role === 'OWNER');
  const employer = memberships[0]?.organizationName ?? memberships[0]?.outletName ?? '';

  const { data, error: loadError, reload, set } = useLoaded<{ person: StaffMemberDto; status: FaceStatusDto }>(allowed ? staffId : null, async () => {
    const [month, status] = await Promise.all([
      // There is no call for one person alone; their month carries their details.
      api.team.personMonth(staffId, indiaToday().slice(0, 7)),
      api.team.faceStatus(staffId),
    ]);
    return { person: month.staff, status };
  });

  if (!allowed) return <Redirect href="/" />;

  if (!data) {
    return (
      <Screen back title={t('face.title')}>
        <ErrorText message={loadError} onRetry={() => void reload()} />
        {!loadError && <ActivityIndicator color={theme.primary} />}
      </Screen>
    );
  }
  const { person, status } = data;
  const setStatus = (next: FaceStatusDto) => set({ person, status: next });

  const name = person.name;
  const date = (iso: string) => formatDate(iso.slice(0, 10), language);

  async function send(acceptedAt: string, photos: Taken[]) {
    setBusy(true);
    setError(null);
    try {
      const enrolled = await api.team.faceEnrol(staffId, {
        photos: photos.map((photo) => photo.file),
        consent: { consentVersion: FACE_CONSENT_VERSION, language, acceptedAt, acceptedBy: 'EMPLOYEE' },
      });
      setStatus(enrolled);
      setDeclined(false);
      setStep({ at: 'done' });
    } catch (e) {
      const code = e instanceof ApiError ? e.code : undefined;
      const details = e instanceof ApiError ? e.details : undefined;
      // The server says which photo it could not use (1, 2 or 3), where it was one photo's fault.
      const bad = typeof details?.photo === 'number' && details.photo >= 1 && details.photo <= photos.length ? details.photo - 1 : null;
      const retakeAll = (message: string) => {
        setError(message);
        setStep({ at: 'capture', acceptedAt, photos: POSES.map(() => null), camera: false, retake: false });
      };
      if (code === ATTENDANCE_ERROR.facesDiffer) return retakeAll(t('face.error.FACES_DIFFER'));
      if (code === ATTENDANCE_ERROR.faceAlreadyEnrolled) {
        const other = details?.staff as { name?: unknown } | undefined;
        setError(typeof other?.name === 'string' ? t('face.error.alreadyAs', { name: other.name }) : t('face.error.already'));
        return setStep({ at: 'status' });
      }
      if (code === ATTENDANCE_ERROR.consentRequired) {
        // The agreement was given too long ago (the phone was put down): it is asked again.
        setError(t('face.error.CONSENT_REQUIRED'));
        return setStep({ at: 'status' });
      }
      if (code === ATTENDANCE_ERROR.engineUnavailable) {
        setError(t('face.error.unavailable'));
        return setStep({ at: 'status' });
      }
      const key = code ? PHOTO_ERROR[code] : undefined;
      if (key && bad !== null) {
        setError(t('face.error.photoN', { number: bad + 1, problem: t(key) }));
        return setStep({ at: 'capture', acceptedAt, photos: photos.map((photo, index) => (index === bad ? null : photo)), camera: false, retake: true });
      }
      if (key) return retakeAll(t(key));
      // No signal or a fault: the photos are kept, so "Try again" sends the same ones.
      setError(errorMessage(e, t));
      setStep({ at: 'capture', acceptedAt, photos, camera: false, retake: false });
    } finally {
      setBusy(false);
    }
  }

  async function remove() {
    setConfirmRemove(false);
    setBusy(true);
    setError(null);
    try {
      setStatus(await api.team.faceWithdraw(staffId));
      notify(t('face.removed'));
    } catch (e) {
      setError(errorMessage(e, t));
    } finally {
      setBusy(false);
    }
  }

  /** Away from this screen: to the person's page after adding them, otherwise back where the Owner came from. */
  function leave() {
    if (fresh) router.dismissTo('/team');
    else if (router.canGoBack()) router.back();
    else router.replace('/team');
  }

  // ── The notice, for the employee to read and answer ──
  if (step.at === 'consent') {
    return (
      <Screen back onBack={() => setStep({ at: 'status' })} title={t('face.consent.title')} subtitle={t('face.consent.for', { name })}>
        <ThemedText type="default" style={styles.strong}>
          {t('face.consent.intro')}
        </ThemedText>
        {NOTICE.map((line) => (
          <View key={line.text} style={styles.noticeRow}>
            <Ionicons name={line.icon} size={24} color={theme.primary} />
            <ThemedText type="default" style={styles.flex}>
              {t(line.text, { employer, days: FACE_RULES.punchPhotoDays })}
            </ThemedText>
          </View>
        ))}
        <ThemedText type="default" themeColor="textSecondary">
          {t('face.consent.under18')}
        </ThemedText>
        {/* The two answers look the same and sit side by side: neither is made the easier one. */}
        <View style={styles.answers}>
          <View style={styles.flex}>
            <Button
              fill
              variant="secondary"
              icon="close-circle-outline"
              label={t('face.consent.disagree')}
              onPress={() => {
                setDeclined(true);
                setStep({ at: 'status' });
              }}
            />
          </View>
          <View style={styles.flex}>
            <Button
              fill
              variant="secondary"
              icon="checkmark-circle-outline"
              label={t('face.consent.agree')}
              onPress={() => {
                setError(null);
                setStep({ at: 'capture', acceptedAt: new Date().toISOString(), photos: POSES.map(() => null), camera: false, retake: false });
              }}
            />
          </View>
        </View>
      </Screen>
    );
  }

  // ── The photos, one pose at a time ──
  if (step.at === 'capture') {
    const next = step.photos.findIndex((photo) => photo === null);
    const taken = step.photos.filter((photo): photo is Taken => photo !== null);
    const pose = next >= 0 ? POSES[next] : undefined;
    return (
      <Screen back={!busy && !step.camera} onBack={() => setStep({ at: 'status' })} title={t('face.capture.title', { name })}>
        {/* Progress in pictures and in words: a tick for each photo taken. */}
        <View style={styles.progress}>
          {step.photos.map((photo, index) =>
            photo ? (
              <Image key={index} source={{ uri: photo.uri }} style={[styles.thumb, { borderColor: theme.primary }]} accessibilityLabel={t('face.photoTaken', { number: index + 1 })} />
            ) : (
              <View key={index} style={[styles.thumb, styles.thumbEmpty, { borderColor: index === next ? theme.primary : theme.outline }]}>
                <ThemedText type="subtitle" themeColor={index === next ? 'primary' : 'textSecondary'}>
                  {index + 1}
                </ThemedText>
              </View>
            ),
          )}
        </View>
        <ErrorText message={error} />

        {pose && next >= 0 ? (
          step.camera ? (
            <FaceCapture
              purpose="enrol"
              instruction={t(pose.instruction)}
              onCaptured={(shot) => {
                setError(null);
                const photos = step.photos.map((photo, index) => (index === next ? { file: shot.photo, uri: shot.uri } : photo));
                setStep({ ...step, photos, camera: false });
                // After the one photo the server asked for again, send straight away.
                const all = photos.filter((photo): photo is Taken => photo !== null);
                if (step.retake && all.length === POSES.length) void send(step.acceptedAt, all);
              }}
              onCancel={() => setStep({ ...step, camera: false })}
            />
          ) : (
            <>
              <ThemedText type="smallBold" themeColor="textSecondary" style={styles.center}>
                {t('face.photoOf', { number: next + 1, total: POSES.length })}
              </ThemedText>
              <Ionicons name={pose.icon} size={72} color={theme.primary} style={styles.icon} />
              <ThemedText type="subtitle" style={styles.instruction}>
                {t(pose.instruction)}
              </ThemedText>
              <ThemedText type="default" themeColor="textSecondary" style={styles.center}>
                {t('face.capture.tips')}
              </ThemedText>
              <Button icon="camera-outline" label={t('face.takePhoto')} onPress={() => setStep({ ...step, camera: true })} />
            </>
          )
        ) : (
          <>
            <ThemedText type="default" style={styles.center}>
              {t(busy ? 'face.saving' : 'face.allTaken')}
            </ThemedText>
            <Button icon="cloud-upload-outline" label={t(error ? 'common.retry' : 'face.save')} loading={busy} onPress={() => void send(step.acceptedAt, taken)} />
            <Button
              variant="secondary"
              icon="refresh"
              label={t('face.retakeAll')}
              disabled={busy}
              onPress={() => {
                setError(null);
                setStep({ ...step, photos: POSES.map(() => null), retake: false });
              }}
            />
          </>
        )}
      </Screen>
    );
  }

  if (step.at === 'done') {
    return (
      <Screen title={t('face.title')}>
        <Ionicons name="checkmark-circle" size={96} color={theme.primary} style={styles.icon} />
        <ThemedText type="subtitle" style={styles.instruction}>
          {t('face.done', { name })}
        </ThemedText>
        <ThemedText type="default" themeColor="textSecondary" style={styles.center}>
          {t('face.doneHelp')}
        </ThemedText>
        <Button label={t('common.done')} onPress={leave} />
      </Screen>
    );
  }

  // ── Where it stands ──
  return (
    <Screen back title={t('face.title')} subtitle={[name, person.jobTitle].filter(Boolean).join(' · ')}>
      <View style={[styles.card, { borderColor: theme.border }]}>
        <Ionicons
          name={status.enrolled ? 'happy-outline' : 'remove-circle-outline'}
          size={40}
          color={status.enrolled ? theme.primary : theme.textSecondary}
        />
        <View style={styles.flex}>
          <ThemedText type="default" style={styles.strong}>
            {status.enrolled && status.enrolledAt
              ? t('face.enrolledOn', { date: date(status.enrolledAt) })
              : status.withdrawnAt
                ? t('face.withdrawnOn', { date: date(status.withdrawnAt) })
                : t('face.notEnrolled')}
          </ThemedText>
          <ThemedText type="small" themeColor="textSecondary">
            {t(status.enrolled ? 'face.enrolledHelp' : declined ? 'face.declinedHelp' : 'face.notEnrolledHelp')}
          </ThemedText>
        </View>
      </View>

      <ErrorText message={error} />
      {!person.isActive && (
        <ThemedText type="default" themeColor="textSecondary">
          {t('face.leftHelp')}
        </ThemedText>
      )}
      {!isOwner && (
        <ThemedText type="default" themeColor="textSecondary">
          {t('face.ownerOnly')}
        </ThemedText>
      )}

      {isOwner && person.isActive && (
        <>
          <Button
            icon="scan-circle-outline"
            label={t(status.enrolled ? 'face.again' : 'face.start')}
            hint={t('face.startHint', { name })}
            disabled={busy}
            onPress={() => {
              setError(null);
              setStep({ at: 'consent' });
            }}
          />
          {status.enrolled && (
            <Button variant="danger" icon="trash-outline" label={t('face.remove')} loading={busy} onPress={() => setConfirmRemove(true)} />
          )}
          {fresh && !status.enrolled && <Button variant="secondary" label={t('face.later')} onPress={leave} />}
        </>
      )}

      <ConfirmDialog
        visible={confirmRemove}
        message={t('face.removeConfirm', { name })}
        confirmLabel={t('face.remove')}
        danger
        onCancel={() => setConfirmRemove(false)}
        onConfirm={() => void remove()}
      />
    </Screen>
  );
}

// What to say when the server cannot use an enrolment photo.
const PHOTO_ERROR: Record<string, MessageKey> = {
  [ATTENDANCE_ERROR.noFace]: 'clock.problem.NO_FACE',
  [ATTENDANCE_ERROR.manyFaces]: 'clock.problem.MANY_FACES',
  [ATTENDANCE_ERROR.faceTooSmall]: 'clock.problem.FACE_TOO_SMALL',
  [ATTENDANCE_ERROR.tooDarkOrBlurred]: 'clock.problem.TOO_DARK_OR_BLURRED',
  [ATTENDANCE_ERROR.photoUnreadable]: 'clock.problem.PHOTO',
  [ATTENDANCE_ERROR.photoTooLarge]: 'clock.problem.PHOTO',
};

const styles = StyleSheet.create({
  flex: { flex: 1 },
  strong: { fontWeight: 700 },
  center: { textAlign: 'center' },
  icon: { alignSelf: 'center' },
  instruction: { textAlign: 'center', fontSize: 26, lineHeight: 34 },
  noticeRow: { flexDirection: 'row', alignItems: 'flex-start', gap: Spacing.three },
  answers: { flexDirection: 'row', alignItems: 'stretch', gap: Spacing.three, marginTop: Spacing.two },
  progress: { flexDirection: 'row', justifyContent: 'center', gap: Spacing.three },
  thumb: { width: 72, height: 72, borderRadius: 36, borderWidth: 3 },
  thumbEmpty: { alignItems: 'center', justifyContent: 'center', borderStyle: 'dashed' },
  card: { flexDirection: 'row', alignItems: 'center', gap: Spacing.three, borderWidth: 1, borderRadius: Spacing.three, padding: Spacing.three },
});
