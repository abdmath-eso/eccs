import type { UploadFile } from '@eccs/api-client';
import { CameraView, PermissionStatus, useCameraPermissions } from 'expo-camera';
import { File } from 'expo-file-system';
import { ImageManipulator, SaveFormat } from 'expo-image-manipulator';
import * as ImagePicker from 'expo-image-picker';
import { useEffect, useRef, useState } from 'react';
import { ActivityIndicator, AppState, Linking, Modal, Platform, StyleSheet, useWindowDimensions, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

import { DirectionView } from '@/components/direction-view';
import { ThemedText } from '@/components/themed-text';
import { Button } from '@/components/ui/button';
import { ErrorText } from '@/components/ui/error-text';
import { MaxContentWidth, Spacing } from '@/constants/theme';
import { useTheme } from '@/hooks/use-theme';
import { useSession } from '@/lib/session';

// The one place in the app that takes a photo of a face.
//
// It shows the front camera live inside our own screen, the way face clocks
// and identity checks do (research_notes/Face attendance/product-patterns.md,
// section 3): an oval to line the face up in, one short instruction in large
// letters, the photo taken by itself, and a "Take photo" button for anyone the
// automatic photo does not suit. The surround is kept bright on purpose, in
// dark mode too: the screen itself lights the face in a dim kitchen.
//
// "Taken by itself" here means a 3-2-1 countdown. The app has nothing installed
// that can find a face in the live picture on the phone, so it cannot wait
// until the face is inside the oval and steady; the server checks the photo
// afterwards and says "move closer", "no face found" and so on.
//
// Clocking in takes two photos: looking at the camera, then with the head
// turned a little. The server compares the two to check that a real person,
// and not a printed photo, is in front of the phone (it does not stop a video
// being played to the camera). Enrolling takes one photo each time it is shown.
//
// The old way, opening the phone's own camera app, is kept for two cases: a
// phone whose camera will not start inside the app, and a browser with no
// webcam. That way takes one photo only, so there is no turned-head check.

/** The photo is shrunk to this many pixels on its longer side: plenty for a face, and quick to send on a weak signal. */
const LONG_SIDE = 720;
/** JPEG quality. At this size a photo comes to well under 200 KB; the server accepts up to 1.5 MB. */
const JPEG_QUALITY = 0.7;
/** The countdown before the photo looking at the camera: 3, 2, 1. */
const LOOK_SECONDS = 3;
/** The shorter countdown before the photo with the head turned. */
const TURN_SECONDS = 2;
/** If the live camera has not started after this long, the phone's own camera app is offered instead. */
const START_TIMEOUT_MS = 8000;
/** How much taller than wide the oval is. */
const OVAL_STRETCH = 1.3;
// The camera screen's own colours, the same in light and dark mode (see the note on the bright surround above).
const SURROUND = 'rgba(255,255,255,0.9)';
const INK = '#111111';
/**
 * Android only: ask the camera for a picture of about this size instead of its
 * largest. A face photo ends up 720 pixels tall anyway, and a 12-megapixel
 * picture is slow to handle and can run a cheap phone out of memory. The phone
 * picks its nearest size if it has no such one.
 */
const ANDROID_PICTURE_SIZE = '1280x960';

export interface FaceShot {
  /** The photo of the face, ready to hand to the API client. */
  photo: UploadFile;
  /** Clocking in only: a second photo with the head turned a little. Missing when the phone's own camera app had to be used. */
  turned?: UploadFile;
  /** Where the photo sits on the phone, for showing it on screen. */
  uri: string;
}

interface FaceCaptureProps {
  /**
   * What the photo is for. Clocking in takes two photos (looking at the camera,
   * then head turned). Enrolling is done with the Owner beside the person, one
   * pose each time this is shown, so it takes one.
   */
  purpose: 'clock' | 'enrol';
  /** One line telling the person what to do: "Look straight at the camera". */
  instruction?: string;
  onCaptured: (shot: FaceShot) => void;
  /** The person closed the camera without taking a photo. */
  onCancel: () => void;
}

/** Thrown inside this file when the person has not allowed the app to use the camera. */
class NoCameraPermission extends Error {}

interface RawPhoto {
  uri: string;
  width: number;
  height: number;
}

/** Shrinks a photo and saves it as a JPEG, ready to send. */
async function shrink(raw: RawPhoto): Promise<{ photo: UploadFile; uri: string }> {
  const context = ImageManipulator.manipulate(raw.uri);
  if (raw.width >= raw.height && raw.width > LONG_SIDE) context.resize({ width: LONG_SIDE });
  else if (raw.height > raw.width && raw.height > LONG_SIDE) context.resize({ height: LONG_SIDE });
  const rendered = await context.renderAsync();
  const saved = await rendered.saveAsync({ compress: JPEG_QUALITY, format: SaveFormat.JPEG });
  // On a phone the photo is handed over as an Expo `File` (see lib/photo.ts for why).
  const photo: UploadFile =
    Platform.OS === 'web' ? await (await fetch(saved.uri)).blob() : (new File(saved.uri) as unknown as Blob);
  return { photo, uri: saved.uri };
}

/** The old way: one photo from the phone's own camera app (in a browser, a picture file). Null when the person backs out. */
async function takeWithPhoneCamera(): Promise<FaceShot | null> {
  let result: ImagePicker.ImagePickerResult;
  if (Platform.OS === 'web') {
    result = await ImagePicker.launchImageLibraryAsync({ mediaTypes: ['images'], quality: 1 });
  } else {
    const permission = await ImagePicker.requestCameraPermissionsAsync();
    if (!permission.granted) throw new NoCameraPermission();
    // No cropping step: it would add a tap, and the server finds the face itself.
    result = await ImagePicker.launchCameraAsync({
      mediaTypes: ['images'],
      cameraType: ImagePicker.CameraType.front,
      allowsEditing: false,
      quality: 1,
    });
  }
  const asset = result.canceled ? undefined : result.assets[0];
  if (!asset) return null;
  return shrink(asset);
}

/**
 * Takes a photo of a face. Show it only while a photo is wanted
 * (`{capturing && <FaceCapture ... />}`): it covers the screen with the camera
 * as soon as it appears, and answers through `onCaptured` or `onCancel`.
 */
export function FaceCapture({ purpose, instruction, onCaptured, onCancel }: FaceCaptureProps) {
  const theme = useTheme();
  const { t } = useSession();
  const insets = useSafeAreaInsets();
  const screen = useWindowDimensions();
  const [permission, requestPermission, readPermission] = useCameraPermissions();
  // 'live': our own camera screen. 'failed': it did not start. 'phone': the phone's own camera app is in front.
  const [mode, setMode] = useState<'live' | 'failed' | 'phone'>('live');
  const [ready, setReady] = useState(false);
  // Which photo is being taken: 0 looking at the camera, 1 with the head turned (clocking in only).
  const [step, setStep] = useState<0 | 1>(0);
  const [count, setCount] = useState(LOOK_SECONDS);
  // True from the moment a photo is being taken until the next countdown may start.
  const [busy, setBusy] = useState(false);
  const [phoneError, setPhoneError] = useState<string | null>(null);
  // Where the space left for the oval sits on the screen, once it has been laid out.
  const [space, setSpace] = useState<{ y: number; height: number } | null>(null);

  const camera = useRef<CameraView>(null);
  // The first photo of a clock-in, kept until the second is taken.
  const first = useRef<RawPhoto | null>(null);
  // Stops a second photo starting while one is being taken (the countdown and the button can fire together).
  const taking = useRef(false);
  const asked = useRef(false);

  // False once this has left the screen, so a late answer from the camera is dropped.
  const shown = useRef(false);
  useEffect(() => {
    shown.current = true;
    return () => {
      shown.current = false;
    };
  }, []);

  const granted = permission?.granted === true;
  const refused = permission?.status === PermissionStatus.DENIED;
  const canAsk = permission !== null && !permission.granted && permission.canAskAgain;

  // Asks for the camera once, as the screen opens.
  useEffect(() => {
    if (!canAsk || asked.current) return;
    asked.current = true;
    // A browser with no camera at all answers with an error rather than "no".
    requestPermission().catch(() => {
      if (shown.current) setMode('failed');
    });
  }, [canAsk, requestPermission]);

  // Coming back from the phone's settings: look again at whether the camera is allowed now.
  useEffect(() => {
    const listener = AppState.addEventListener('change', (state) => {
      if (state === 'active') void readPermission().catch(() => undefined);
    });
    return () => listener.remove();
  }, [readPermission]);

  // A camera that has not started in good time: offer the phone's own camera app.
  const starting = granted && mode === 'live' && !ready;
  useEffect(() => {
    if (!starting) return;
    const timer = setTimeout(() => setMode('failed'), START_TIMEOUT_MS);
    return () => clearTimeout(timer);
  }, [starting]);

  // The newest callbacks, kept where the camera's answer can find them: the
  // screen that asked may have been drawn again since.
  const callbacks = useRef({ onCaptured, onCancel });
  useEffect(() => {
    callbacks.current = { onCaptured, onCancel };
  });

  async function shoot() {
    if (taking.current || !camera.current) return;
    taking.current = true;
    setBusy(true);
    let finished = false;
    try {
      // Not mirrored and already turned upright: see the note on <CameraView> below.
      const picture = await camera.current.takePictureAsync({ quality: 0.85 });
      if (!shown.current) return;
      if (purpose === 'clock' && step === 0) {
        first.current = picture;
        setStep(1);
        setCount(TURN_SECONDS);
        return;
      }
      const main = await shrink(first.current ?? picture);
      const turned = first.current ? await shrink(picture) : null;
      if (!shown.current) return;
      // Stays "busy" from here, so no new countdown starts while the screen that asked takes over.
      finished = true;
      callbacks.current.onCaptured({ ...main, ...(turned && { turned: turned.photo }) });
    } catch {
      if (shown.current) setMode('failed');
    } finally {
      taking.current = false;
      if (shown.current && !finished) setBusy(false);
    }
  }

  // The newest `shoot`, for the countdown to call: it knows which photo is next.
  const shooter = useRef(shoot);
  useEffect(() => {
    shooter.current = shoot;
  });

  // The countdown: one tick a second, and the photo is taken at the end of it.
  const counting = granted && mode === 'live' && ready && !busy;
  useEffect(() => {
    if (!counting) return;
    let left = step === 0 ? LOOK_SECONDS : TURN_SECONDS;
    const timer = setInterval(() => {
      left -= 1;
      setCount(left);
      if (left <= 0) {
        clearInterval(timer);
        void shooter.current();
      }
    }, 1000);
    return () => clearInterval(timer);
  }, [counting, step]);

  /** Starts the live camera afresh, from the first photo. */
  function restart() {
    first.current = null;
    setStep(0);
    setCount(LOOK_SECONDS);
    setReady(false);
    setBusy(false);
    setMode('live');
  }

  async function openPhoneCamera() {
    setMode('phone');
    setPhoneError(null);
    try {
      const shot = await takeWithPhoneCamera();
      if (!shown.current) return;
      if (shot) callbacks.current.onCaptured(shot);
      else callbacks.current.onCancel();
    } catch (e) {
      if (shown.current) setPhoneError(t(e instanceof NoCameraPermission ? 'face.cameraNeeded' : 'face.cameraFailed'));
    }
  }

  const label = t(purpose === 'enrol' ? 'face.capture.enrol' : 'face.capture.clock');
  // A browser has no "phone settings" to send anyone to: it is offered a picture file instead.
  const blocked = refused && Platform.OS !== 'web';
  const live = granted && mode === 'live';

  // The oval is as wide as the screen allows and never taller than the space left for it.
  const hole = space ? Math.max(120, Math.min(screen.width * 0.7, MaxContentWidth * 0.7, (space.height - Spacing.four) / OVAL_STRETCH)) : 0;
  // The surround is one very large ring with the oval as its hole, wide enough to reach every corner of the screen.
  const rim = Math.max(screen.width, screen.height);
  const centre = space ? space.y + space.height / 2 : 0;

  return (
    <Modal visible animationType="fade" onRequestClose={onCancel}>
      {live ? (
        <DirectionView style={styles.liveRoot} accessibilityLabel={label}>
          <CameraView
            ref={camera}
            style={StyleSheet.absoluteFill}
            facing="front"
            // The picture on screen is shown like a mirror by the phone itself for the
            // front camera. `mirror` is a different thing in this version of the camera
            // package: it flips the SAVED photo. It stays off, so the photo kept for the
            // Owner to look at shows the person the way others see them.
            mirror={false}
            mode="picture"
            pictureSize={Platform.OS === 'android' ? ANDROID_PICTURE_SIZE : undefined}
            onCameraReady={() => setReady(true)}
            onMountError={() => setMode('failed')}
          />

          {/* The bright surround with the oval cut out of it, and a dark line round the oval. */}
          {space && (
            <View style={styles.surroundLayer}>
              <View
                style={[
                  styles.surround,
                  { top: centre - hole / 2 - rim, width: hole + rim * 2, height: hole + rim * 2, borderRadius: hole / 2 + rim, borderWidth: rim },
                ]}
              />
              <View style={[styles.ring, { top: centre - hole / 2, width: hole, height: hole, borderRadius: hole / 2 }]} />
            </View>
          )}

          <View style={[styles.liveColumn, { paddingTop: insets.top + Spacing.three, paddingBottom: insets.bottom + Spacing.three }]}>
            <View style={styles.liveText} accessibilityLiveRegion="polite">
              {purpose === 'clock' && (
                <ThemedText type="smallBold" style={styles.stepLine}>
                  {t('face.photoOf', { number: step + 1, total: 2 })}
                </ThemedText>
              )}
              <ThemedText type="subtitle" style={styles.liveInstruction}>
                {step === 1 ? t('face.live.turn') : (instruction ?? t('clock.look'))}
              </ThemedText>
            </View>

            {/* Nothing is drawn here: this is the room the oval sits in, and the face must stay uncovered. */}
            <View style={styles.ovalSpace} onLayout={(event) => setSpace({ y: event.nativeEvent.layout.y, height: event.nativeEvent.layout.height })} />

            <View style={styles.liveControls}>
              <View style={styles.countBox}>
                {!ready ? (
                  <>
                    <ActivityIndicator size="large" color={INK} />
                    <ThemedText type="default" style={styles.inkCentre}>
                      {t('face.openingCamera')}
                    </ThemedText>
                  </>
                ) : busy || count <= 0 ? (
                  <>
                    <ActivityIndicator size="large" color={INK} />
                    <ThemedText type="default" style={styles.inkCentre}>
                      {t('face.live.hold')}
                    </ThemedText>
                  </>
                ) : (
                  // The number is the message: large, and read out as "Photo in 3".
                  <ThemedText type="title" style={styles.count} accessibilityLabel={t('face.live.photoIn', { seconds: count })}>
                    {count}
                  </ThemedText>
                )}
              </View>
              <Button icon="camera-outline" label={t('face.takePhoto')} disabled={!ready || busy} onPress={() => void shoot()} />
              <Button variant="secondary" label={t('common.cancel')} onPress={onCancel} />
            </View>
          </View>
        </DirectionView>
      ) : (
        <DirectionView
          style={[styles.panelRoot, { backgroundColor: theme.background, paddingTop: insets.top + Spacing.four, paddingBottom: insets.bottom + Spacing.four }]}
          accessibilityLabel={label}>
          <View style={styles.panel}>
            {mode === 'phone' ? (
              phoneError ? (
                <>
                  <ErrorText message={phoneError} />
                  <Button icon="camera-outline" label={t('common.retry')} onPress={() => void openPhoneCamera()} />
                  <Button variant="secondary" label={t('common.cancel')} onPress={onCancel} />
                </>
              ) : (
                <>
                  <ActivityIndicator size="large" color={theme.primary} />
                  <ThemedText type="default" themeColor="textSecondary" style={styles.centre}>
                    {t('face.openingCamera')}
                  </ThemedText>
                </>
              )
            ) : blocked ? (
              <>
                <ThemedText type="subtitle" style={styles.panelTitle}>
                  {t('face.cameraNeeded')}
                </ThemedText>
                {permission?.canAskAgain ? (
                  <Button icon="camera-outline" label={t('common.retry')} onPress={() => void requestPermission().catch(() => undefined)} />
                ) : (
                  // Android stops asking after two refusals; from then on only the phone's settings can allow it.
                  <Button icon="settings-outline" label={t('push.openSettings')} onPress={() => void Linking.openSettings().catch(() => undefined)} />
                )}
                <Button variant="secondary" label={t('common.cancel')} onPress={onCancel} />
              </>
            ) : mode === 'failed' || refused ? (
              <>
                <ThemedText type="subtitle" style={styles.panelTitle}>
                  {t('face.live.notStarted')}
                </ThemedText>
                <Button icon="camera-outline" label={t('face.live.usePhoneCamera')} onPress={() => void openPhoneCamera()} />
                {!refused && <Button variant="secondary" icon="refresh" label={t('common.retry')} onPress={restart} />}
                <Button variant="secondary" label={t('common.cancel')} onPress={onCancel} />
              </>
            ) : (
              // Waiting for the phone to say whether the camera is allowed, or for the person to answer.
              <>
                <ActivityIndicator size="large" color={theme.primary} />
                <ThemedText type="default" themeColor="textSecondary" style={styles.centre}>
                  {t('face.openingCamera')}
                </ThemedText>
                <Button variant="secondary" label={t('common.cancel')} onPress={onCancel} />
              </>
            )}
          </View>
        </DirectionView>
      )}
    </Modal>
  );
}

const styles = StyleSheet.create({
  liveRoot: { flex: 1, backgroundColor: '#000000' },
  // Centred by the row, never by `left`, so it is the same in Urdu.
  surroundLayer: { ...StyleSheet.absoluteFill, alignItems: 'center', overflow: 'hidden', pointerEvents: 'none' },
  // A circle stretched upwards into an oval; its thick edge is the surround.
  surround: { position: 'absolute', borderColor: SURROUND, transform: [{ scaleY: OVAL_STRETCH }] },
  ring: { position: 'absolute', borderWidth: 3, borderColor: INK, transform: [{ scaleY: OVAL_STRETCH }] },
  liveColumn: { flex: 1, alignSelf: 'center', width: '100%', maxWidth: MaxContentWidth, paddingHorizontal: Spacing.four },
  liveText: { gap: Spacing.one },
  stepLine: { textAlign: 'center', color: INK },
  // Readable at arm's length: the phone is often propped up or held by someone else.
  liveInstruction: { textAlign: 'center', fontSize: 28, lineHeight: 36, color: INK },
  ovalSpace: { flex: 1, minHeight: 160 },
  liveControls: { gap: Spacing.two },
  countBox: { height: 96, alignItems: 'center', justifyContent: 'center', gap: Spacing.one },
  count: { fontSize: 80, lineHeight: 92, fontWeight: 700, textAlign: 'center', color: INK },
  inkCentre: { textAlign: 'center', color: INK },
  panelRoot: { flex: 1, alignItems: 'center', justifyContent: 'center', paddingHorizontal: Spacing.four },
  panel: { width: '100%', maxWidth: MaxContentWidth, gap: Spacing.three },
  panelTitle: { textAlign: 'center', fontSize: 24, lineHeight: 32 },
  centre: { textAlign: 'center' },
});
