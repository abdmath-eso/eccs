import Ionicons from '@expo/vector-icons/Ionicons';
import { ApiError } from '@eccs/api-client';
import type { MessageKey } from '@eccs/i18n';
import { ATTENDANCE_ERROR, AUTH_ERROR, PIN_LENGTH, type ClockIdentifyDto, type ClockPunchResultDto, type ClockRosterDto } from '@eccs/shared';
import { Redirect, router } from 'expo-router';
import { useEffect, useState } from 'react';
import { ActivityIndicator, Pressable, StyleSheet, View } from 'react-native';

import { EnrolledMark, formatWorked, PUNCH_KIND } from '@/components/attendance-parts';
import { FaceCapture, type FaceShot } from '@/components/face-capture';
import { ThemedText } from '@/components/themed-text';
import { Button } from '@/components/ui/button';
import { ErrorText } from '@/components/ui/error-text';
import { PinPad } from '@/components/ui/pin-pad';
import { Screen } from '@/components/ui/screen';
import { TextField } from '@/components/ui/text-field';
import { MinTouchSize, Spacing } from '@/constants/theme';
import { useTheme } from '@/hooks/use-theme';
import { useDirection } from '@/lib/direction';
import { formatTimeOfDay } from '@/lib/format';
import { useSession } from '@/lib/session';

// Clock in / Clock out, from the PIN screen, with nobody logged in.
//
// The pattern is the one face time clocks on a shared device use (Jibble's
// kiosk, Truein, PagarBook Lens; see research_notes/Face attendance): the face
// alone says who it is, the app decides between IN and OUT from the person's
// last punch, and when the camera cannot recognise someone the Owner or a
// Manager vouches with their own PIN and picks the name. We add one step those
// products leave out: the person confirms "Yes, that's me" before anything is
// recorded, because a wrong match here would pay the wrong person.
//
// Nothing is ever recorded without signal: the server's clock is the one that
// counts, so a punch is not kept on the phone to send later.

/** After this many failed scans in a row the way through the Owner or Manager is offered up front. */
const TRIES_BEFORE_HELP = 3;
/** How long the "done" screen stays before the PIN screen comes back by itself. */
const DONE_SECONDS = 5;
/** The name list gets a search box once it is longer than this. */
const SEARCH_FROM = 8;

type RosterPerson = ClockRosterDto['people'][number];
/** An answer from the server that names someone. */
type Found = ClockIdentifyDto & { candidate: { staffId: string; name: string }; ticket: string };

type Step =
  | { at: 'scan'; problem: string | null }
  | { at: 'camera' }
  | { at: 'checking' }
  | { at: 'confirm'; found: Found }
  | { at: 'done'; result: ClockPunchResultDto; assisted: boolean }
  // Face clock-in cannot be used just now: the server's face part is off, or there is no signal.
  | { at: 'unavailable'; why: 'engine' | 'network' }
  | { at: 'assist' }
  | { at: 'approve'; person: RosterPerson };

// What to say for each reason the server gives for not accepting a photo.
const PHOTO_PROBLEM: Record<string, MessageKey> = {
  [ATTENDANCE_ERROR.noFace]: 'clock.problem.NO_FACE',
  [ATTENDANCE_ERROR.manyFaces]: 'clock.problem.MANY_FACES',
  [ATTENDANCE_ERROR.faceTooSmall]: 'clock.problem.FACE_TOO_SMALL',
  [ATTENDANCE_ERROR.tooDarkOrBlurred]: 'clock.problem.TOO_DARK_OR_BLURRED',
  [ATTENDANCE_ERROR.photoUnreadable]: 'clock.problem.PHOTO',
  [ATTENDANCE_ERROR.photoTooLarge]: 'clock.problem.PHOTO',
};
const TICKET_PROBLEMS: string[] = [ATTENDANCE_ERROR.ticketExpired, ATTENDANCE_ERROR.ticketUsed, ATTENDANCE_ERROR.ticketInvalid];

export default function ClockScreen() {
  const theme = useTheme();
  const { t, api, language, linkedDevice, unlinkDevice } = useSession();
  const { forwardIcon } = useDirection();
  const [step, setStep] = useState<Step>({ at: 'scan', problem: null });
  // Failed scans in a row; "No, not me" counts as one.
  const [fails, setFails] = useState(0);
  const [saving, setSaving] = useState(false);
  // The outlet's staff by name, for the way through the Owner or Manager.
  const [roster, setRoster] = useState<ClockRosterDto | null>(null);
  const [rosterError, setRosterError] = useState<string | null>(null);
  const [search, setSearch] = useState('');
  // The approver's PIN pad, with the same lock-out as the PIN screen.
  const [pin, setPin] = useState('');
  const [pinError, setPinError] = useState<string | null>(null);
  const [lockedUntil, setLockedUntil] = useState<number | null>(null);
  const [now, setNow] = useState(0);

  const deviceToken = linkedDevice?.deviceToken ?? null;

  /** The few answers that mean the same thing wherever they come from. True when dealt with. */
  async function handledEverywhere(e: unknown): Promise<boolean> {
    if (!(e instanceof ApiError)) return false;
    if (e.code === AUTH_ERROR.deviceNotLinked) {
      // The restaurant has removed this phone: back to the start, as the PIN screen does.
      await unlinkDevice();
      return true;
    }
    if (e.isNetworkError) {
      setStep({ at: 'unavailable', why: 'network' });
      return true;
    }
    if (e.code === ATTENDANCE_ERROR.engineUnavailable) {
      setStep({ at: 'unavailable', why: 'engine' });
      return true;
    }
    return false;
  }

  async function loadRoster() {
    if (!deviceToken) return;
    try {
      const loaded = await api.attendance.clock.roster(deviceToken);
      setRoster(loaded);
      setRosterError(null);
    } catch (e) {
      if (e instanceof ApiError && e.code === AUTH_ERROR.deviceNotLinked) return void unlinkDevice();
      setRosterError(t(e instanceof ApiError && e.isNetworkError ? 'clock.noSignal' : 'error.generic'));
    }
  }

  // The name list is fetched as the screen opens, so it is there if it is needed,
  // and so the screen knows at once when the server cannot recognise faces today.
  useEffect(() => {
    void (async () => {
      await loadRoster();
    })();
    // Once, when the screen opens.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // The "done" screen goes back to the PIN screen by itself, so the phone is ready for the next person.
  const doneAt = step.at === 'done' ? step.result.punchId : null;
  useEffect(() => {
    if (doneAt === null) return;
    const timer = setTimeout(leave, DONE_SECONDS * 1000);
    return () => clearTimeout(timer);
  }, [doneAt]);

  // Counts down a locked PIN pad by the clock, as on the PIN screen.
  useEffect(() => {
    if (lockedUntil === null) return;
    const timer = setInterval(() => {
      const current = Date.now();
      setNow(current);
      if (current >= lockedUntil) clearInterval(timer);
    }, 1000);
    return () => clearInterval(timer);
  }, [lockedUntil]);

  if (!linkedDevice || !deviceToken) return <Redirect href="/" />;
  // A phone linked to the restaurant as a whole has no outlet to clock in at.
  if (linkedDevice.outletName === null) return <Redirect href="/pin" />;

  const secondsLeft = lockedUntil === null ? 0 : Math.max(0, Math.ceil((lockedUntil - now) / 1000));
  const locked = secondsLeft > 0;
  const timeLeft = `${Math.floor(secondsLeft / 60)}:${String(secondsLeft % 60).padStart(2, '0')}`;
  const time = (iso: string) => formatTimeOfDay(iso, language);
  // The roster says when the server's face part is switched off; no point opening the camera then.
  const engineOff = roster !== null && !roster.faceReady;

  function failed(problem: string) {
    setFails((count) => count + 1);
    setStep({ at: 'scan', problem });
  }

  async function identify(shot: FaceShot) {
    if (!deviceToken) return;
    setStep({ at: 'checking' });
    try {
      const found = await api.attendance.clock.identify({
        deviceToken,
        photo: shot.photo,
        // Only once the live camera takes the "turn your head" photo; see face-capture.tsx.
        ...(shot.turned && { secondPhoto: shot.turned }),
      });
      if (found.result === 'NO_MATCH' || !found.candidate || !found.ticket) return failed(t('clock.problem.NO_MATCH'));
      setStep({ at: 'confirm', found: { ...found, candidate: found.candidate, ticket: found.ticket } });
    } catch (e) {
      if (await handledEverywhere(e)) return;
      if (e instanceof ApiError && e.code === ATTENDANCE_ERROR.tooManyScans) return setStep({ at: 'scan', problem: t('clock.wait') });
      const key = e instanceof ApiError && e.code ? PHOTO_PROBLEM[e.code] : undefined;
      failed(t(key ?? 'error.generic'));
    }
  }

  async function confirm(found: Found) {
    if (!deviceToken) return;
    setSaving(true);
    try {
      const result = await api.attendance.clock.confirm({ deviceToken, ticket: found.ticket });
      setFails(0);
      setStep({ at: 'done', result, assisted: false });
    } catch (e) {
      if (await handledEverywhere(e)) return;
      const slow = e instanceof ApiError && e.code !== undefined && TICKET_PROBLEMS.includes(e.code);
      // Not a failed scan: the face was fine, the answer just came too late.
      setStep({ at: 'scan', problem: t(slow ? 'clock.tooSlow' : 'error.generic') });
    } finally {
      setSaving(false);
    }
  }

  async function approve(person: RosterPerson, entered: string) {
    if (!deviceToken) return;
    setSaving(true);
    setPinError(null);
    try {
      const result = await api.attendance.clock.assisted({ deviceToken, approverPin: entered, staffId: person.staffId });
      setFails(0);
      setPin('');
      setStep({ at: 'done', result, assisted: true });
    } catch (e) {
      setPin('');
      if (!(e instanceof ApiError)) return setPinError(t('error.generic'));
      if (e.code === AUTH_ERROR.deviceNotLinked) return void unlinkDevice();
      if (e.status === 429 && e.retryAfterSeconds) {
        const started = Date.now();
        setNow(started);
        setLockedUntil(started + e.retryAfterSeconds * 1000);
        return;
      }
      if (e.isNetworkError) setPinError(t('clock.noSignal'));
      else if (e.code === ATTENDANCE_ERROR.approverNotAllowed) setPinError(t('clock.assist.notAllowed'));
      else if (e.code === ATTENDANCE_ERROR.tooManyScans) setPinError(t('clock.wait'));
      else if (e.code === ATTENDANCE_ERROR.notOnStaff) setPinError(t('clock.assist.notOnStaff'));
      else if (e.status === 401) setPinError(t('error.wrongPin'));
      else if (e.status === 429) setPinError(t('error.pinLocked'));
      else setPinError(t('error.generic'));
    } finally {
      setSaving(false);
    }
  }

  function changePin(person: RosterPerson, next: string) {
    setPin(next);
    if (pinError) setPinError(null);
    if (next.length === PIN_LENGTH) void approve(person, next);
  }

  function openAssist() {
    setSearch('');
    setStep({ at: 'assist' });
    if (!roster) void loadRoster();
  }

  // Back steps back inside the flow first; from the first step it returns to the PIN screen.
  function back() {
    if (step.at === 'approve') {
      setPin('');
      setPinError(null);
      return setStep({ at: 'assist' });
    }
    if (step.at === 'assist' || step.at === 'unavailable' || step.at === 'confirm') return setStep({ at: 'scan', problem: null });
    leave();
  }

  const assistButton = (primary: boolean) => (
    <Button
      variant={primary ? 'primary' : 'secondary'}
      icon="people-outline"
      label={t('clock.assist.open')}
      hint={t('clock.assist.openHint')}
      onPress={openAssist}
    />
  );

  const wanted = search.trim().toLowerCase();
  const people = (roster?.people ?? []).filter((person) => wanted === '' || person.name.toLowerCase().includes(wanted));

  return (
    <Screen back={step.at !== 'done' && step.at !== 'checking' && step.at !== 'camera'} onBack={back}>
      <ThemedText type="smallBold" themeColor="primary" style={styles.center}>
        {linkedDevice.outletName}
      </ThemedText>

      {/* ── Scan: the first step, and where a failed try comes back to ── */}
      {step.at === 'scan' && (
        <View style={styles.block}>
          <ThemedText type="subtitle" style={styles.heading}>
            {t('clock.title')}
          </ThemedText>
          {engineOff ? (
            <>
              <Ionicons name="cloud-offline-outline" size={72} color={theme.textSecondary} style={styles.icon} />
              <ThemedText type="default" style={styles.big}>
                {t('clock.unavailable.engine')}
              </ThemedText>
              {assistButton(true)}
            </>
          ) : (
            <>
              <Ionicons name="scan-circle-outline" size={96} color={theme.primary} style={styles.icon} />
              {step.problem ? (
                <ErrorText message={step.problem} />
              ) : (
                <ThemedText type="default" style={styles.big}>
                  {t('clock.look')}
                </ThemedText>
              )}
              <Button
                icon="camera-outline"
                label={t(step.problem ? 'common.retry' : 'clock.scan')}
                onPress={() => setStep({ at: 'camera' })}
              />
              {fails >= TRIES_BEFORE_HELP ? (
                assistButton(false)
              ) : (
                <Button variant="link" label={t('clock.cantScan')} onPress={openAssist} />
              )}
            </>
          )}
        </View>
      )}

      {step.at === 'camera' && (
        <FaceCapture
          purpose="clock"
          instruction={t('clock.look')}
          onCaptured={(shot) => void identify(shot)}
          onCancel={() => setStep({ at: 'scan', problem: null })}
        />
      )}

      {step.at === 'checking' && (
        <View style={styles.block}>
          <ActivityIndicator size="large" color={theme.primary} />
          <ThemedText type="subtitle" style={styles.heading}>
            {t('clock.checking')}
          </ThemedText>
        </View>
      )}

      {/* ── Is this you? Nothing is recorded until "Yes" ── */}
      {step.at === 'confirm' && (
        <View style={styles.block}>
          <ThemedText type="default" style={styles.big}>
            {/* Less sure of the match: asked as a question, with the name in the sentence as well as in large letters below. */}
            {step.found.result === 'UNSURE' ? t('clock.weThink', { name: step.found.candidate.name }) : t('clock.isThisYou')}
          </ThemedText>
          <ThemedText type="title" style={styles.name}>
            {step.found.candidate.name}
          </ThemedText>

          {step.found.already && step.found.lastPunchAt && step.found.lastPunchKind ? (
            <View style={[styles.action, { borderColor: theme.outline }]}>
              <Ionicons name="time-outline" size={36} color={theme.textSecondary} />
              <ThemedText type="default" style={styles.actionText}>
                {t(`clock.already.${step.found.lastPunchKind}`, { time: time(step.found.lastPunchAt) })}
              </ThemedText>
            </View>
          ) : (
            step.found.nextKind && (
              <>
                {/* A thick edge, a picture and capital letters: IN and OUT are told apart without colour. */}
                <View style={[styles.action, styles.actionStrong, { borderColor: theme.primary }]}>
                  <Ionicons name={PUNCH_KIND[step.found.nextKind].icon} size={44} color={theme.primary} />
                  <ThemedText type="subtitle" style={styles.actionText}>
                    {t(`clock.will.${step.found.nextKind}`)}
                  </ThemedText>
                </View>
                {step.found.lastPunchAt && step.found.lastPunchKind && (
                  <ThemedText type="default" themeColor="textSecondary" style={styles.center}>
                    {t(`clock.last.${step.found.lastPunchKind}`, { time: time(step.found.lastPunchAt) })}
                  </ThemedText>
                )}
              </>
            )
          )}

          <Button icon="checkmark-circle" label={t('clock.yes')} loading={saving} onPress={() => void confirm(step.found)} />
          <Button variant="secondary" icon="close-circle-outline" label={t('clock.no')} disabled={saving} onPress={() => failed(t('clock.notYou'))} />
        </View>
      )}

      {/* ── Done ── */}
      {step.at === 'done' && (
        <View style={styles.block} accessibilityLiveRegion="polite">
          <Ionicons name="checkmark-circle" size={112} color={theme.primary} style={styles.icon} />
          <ThemedText type="title" style={styles.name}>
            {step.result.name}
          </ThemedText>
          <View style={[styles.action, styles.actionStrong, { borderColor: theme.primary }]}>
            <Ionicons name={PUNCH_KIND[step.result.kind].icon} size={44} color={theme.primary} />
            <ThemedText type="subtitle" style={styles.actionText}>
              {t(step.result.result === 'ALREADY' ? `clock.already.${step.result.kind}` : `clock.done.${step.result.kind}`, {
                time: time(step.result.at),
              })}
            </ThemedText>
          </View>
          {step.result.workedMinutesToday > 0 && (
            <ThemedText type="default" style={styles.big}>
              {t('clock.workedToday', { time: formatWorked(step.result.workedMinutesToday, t) })}
            </ThemedText>
          )}
          {step.assisted && step.result.result === 'RECORDED' && (
            <ThemedText type="default" themeColor="textSecondary" style={styles.center}>
              {t('clock.withApproval')}
            </ThemedText>
          )}
          <Button label={t('common.done')} onPress={leave} />
        </View>
      )}

      {/* ── Face clock-in cannot be used right now ── */}
      {step.at === 'unavailable' && (
        <View style={styles.block}>
          <Ionicons name="cloud-offline-outline" size={72} color={theme.textSecondary} style={styles.icon} />
          <ThemedText type="default" style={styles.big}>
            {t(step.why === 'network' ? 'clock.unavailable.network' : 'clock.unavailable.engine')}
          </ThemedText>
          {step.why === 'network' ? (
            <Button icon="refresh" label={t('common.retry')} onPress={() => setStep({ at: 'scan', problem: null })} />
          ) : (
            assistButton(true)
          )}
        </View>
      )}

      {/* ── The one other way: the Owner or a Manager vouches ── */}
      {step.at === 'assist' && (
        <>
          <ThemedText type="subtitle" style={styles.heading}>
            {t('clock.assist.title')}
          </ThemedText>
          <ThemedText type="default" themeColor="textSecondary">
            {t('clock.assist.help')}
          </ThemedText>
          <ErrorText message={rosterError} onRetry={() => void loadRoster()} />
          {!roster && !rosterError && <ActivityIndicator color={theme.primary} />}
          {roster && roster.people.length > SEARCH_FROM && (
            <TextField label={t('common.search')} value={search} onChangeText={setSearch} autoCorrect={false} />
          )}
          {roster?.people.length === 0 && (
            <ThemedText type="default" themeColor="textSecondary">
              {t('clock.assist.empty')}
            </ThemedText>
          )}
          {people.map((person) => (
            <Pressable
              key={person.staffId}
              accessibilityRole="button"
              onPress={() => {
                setPin('');
                setPinError(null);
                setStep({ at: 'approve', person });
              }}
              style={({ pressed }) => [styles.person, { borderColor: theme.border }, pressed && { backgroundColor: theme.backgroundElement }]}>
              <View style={styles.personText}>
                <ThemedText type="default" style={styles.personName}>
                  {person.name}
                </ThemedText>
                {person.jobTitle && (
                  <ThemedText type="small" themeColor="textSecondary">
                    {person.jobTitle}
                  </ThemedText>
                )}
                {!person.enrolled && <EnrolledMark enrolled={false} />}
              </View>
              <Ionicons name={forwardIcon} size={20} color={theme.textSecondary} />
            </Pressable>
          ))}
        </>
      )}

      {step.at === 'approve' && (
        <>
          <View style={styles.block}>
            <ThemedText type="title" style={styles.name}>
              {step.person.name}
            </ThemedText>
            <ThemedText type="default" style={styles.big}>
              {t('clock.assist.pin')}
            </ThemedText>
          </View>
          <PinPad
            value={pin}
            onChange={(next) => changePin(step.person, next)}
            disabled={saving || locked}
            error={locked ? t('pin.locked') : pinError}
            note={locked ? t('pin.unlocksIn', { time: timeLeft }) : null}
          />
        </>
      )}
    </Screen>
  );
}

/** Back to the PIN screen, ready for the next person. */
function leave() {
  if (router.canGoBack()) router.back();
  else router.replace('/pin');
}

const styles = StyleSheet.create({
  block: { gap: Spacing.three, paddingTop: Spacing.three },
  center: { textAlign: 'center' },
  icon: { alignSelf: 'center' },
  heading: { textAlign: 'center', fontSize: 28, lineHeight: 36 },
  // Readable at arm's length: the phone is often propped up or held by someone else.
  big: { textAlign: 'center', fontSize: 22, lineHeight: 30 },
  name: { textAlign: 'center', fontSize: 40, lineHeight: 48 },
  action: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: Spacing.three,
    borderWidth: 1,
    borderRadius: Spacing.three,
    padding: Spacing.three,
  },
  actionStrong: { borderWidth: 3 },
  actionText: { flexShrink: 1, textAlign: 'center', fontSize: 26, lineHeight: 34 },
  person: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: Spacing.two,
    minHeight: MinTouchSize + Spacing.two,
    borderWidth: 1,
    borderRadius: Spacing.three,
    padding: Spacing.three,
  },
  personText: { flex: 1, gap: Spacing.half },
  personName: { fontWeight: 700, fontSize: 18 },
});
