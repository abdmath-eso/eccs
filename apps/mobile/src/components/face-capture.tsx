import Ionicons from '@expo/vector-icons/Ionicons';
import type { UploadFile } from '@eccs/api-client';
import { File } from 'expo-file-system';
import { ImageManipulator, SaveFormat } from 'expo-image-manipulator';
import * as ImagePicker from 'expo-image-picker';
import { useEffect, useRef, useState } from 'react';
import { ActivityIndicator, Platform, StyleSheet, View } from 'react-native';

import { ThemedText } from '@/components/themed-text';
import { Button } from '@/components/ui/button';
import { ErrorText } from '@/components/ui/error-text';
import { Spacing } from '@/constants/theme';
import { useTheme } from '@/hooks/use-theme';
import { useSession } from '@/lib/session';

// The one place in the app that takes a photo of a face.
//
// Today it opens the phone's own camera app on the front camera (the camera
// package that shows a live picture inside our own screen is not installed
// yet). The screens that use it know nothing of that: they show
// `<FaceCapture>` when they want a face and get the photo back.
//
// When the live camera is added (an oval to line the face up in, the photo
// taken by itself once the face is steady, then "turn your head a little" for
// a second photo), only the inside of this file changes. That second photo is
// what `turned` below is for: the server uses it to check that a real person,
// and not a printed photo, is in front of the phone.
//
// FOR NOW NO SECOND PHOTO IS TAKEN. Going out to the phone's camera app twice
// for one clock-in is too clumsy for a queue at the kitchen door. The server
// therefore runs no "is this a live person" check on these photos; the photo
// kept with each clock-in for the Owner to look at is the safeguard meanwhile.

/** The photo is shrunk to this many pixels on its longer side: plenty for a face, and quick to send on a weak signal. */
const LONG_SIDE = 720;
/** JPEG quality. At this size a photo comes to well under 200 KB; the server accepts up to 1.5 MB. */
const JPEG_QUALITY = 0.7;

export interface FaceShot {
  /** The photo of the face, ready to hand to the API client. */
  photo: UploadFile;
  /** A second photo after "turn your head a little", once the live camera takes one. Not taken yet. */
  turned?: UploadFile;
  /** Where the photo sits on the phone, for showing it on screen. */
  uri: string;
}

interface FaceCaptureProps {
  /**
   * What the photo is for. Clocking in wants one quick photo; enrolling is done
   * with the Owner beside the person, one pose at a time. The live camera will
   * use this to decide how strict to be and whether to ask for the turned head.
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

async function takeFacePhoto(): Promise<FaceShot | null> {
  let result: ImagePicker.ImagePickerResult;
  if (Platform.OS === 'web') {
    // The browser preview cannot open a camera: it picks a picture file instead, for trying the screens out.
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

  const context = ImageManipulator.manipulate(asset.uri);
  if (asset.width >= asset.height && asset.width > LONG_SIDE) context.resize({ width: LONG_SIDE });
  else if (asset.height > asset.width && asset.height > LONG_SIDE) context.resize({ height: LONG_SIDE });
  const rendered = await context.renderAsync();
  const saved = await rendered.saveAsync({ compress: JPEG_QUALITY, format: SaveFormat.JPEG });
  // On a phone the photo is handed over as an Expo `File` (see lib/photo.ts for why).
  const photo: UploadFile =
    Platform.OS === 'web' ? await (await fetch(saved.uri)).blob() : (new File(saved.uri) as unknown as Blob);
  return { photo, uri: saved.uri };
}

/**
 * Takes a photo of a face. Show it only while a photo is wanted
 * (`{capturing && <FaceCapture ... />}`): it opens the camera as soon as it
 * appears, and answers through `onCaptured` or `onCancel`.
 */
export function FaceCapture({ purpose, instruction, onCaptured, onCancel }: FaceCaptureProps) {
  const theme = useTheme();
  const { t } = useSession();
  const [error, setError] = useState<string | null>(null);
  // Counts the tries, so "Try again" opens the camera once more.
  const [attempt, setAttempt] = useState(0);
  // The camera must open once per try, even if the screen is drawn twice.
  const opened = useRef(-1);
  // The newest callbacks, kept where the camera's answer can find them: the
  // screen may have been drawn again while the camera app was in front.
  const callbacks = useRef({ onCaptured, onCancel });
  useEffect(() => {
    callbacks.current = { onCaptured, onCancel };
  });

  // False once this has left the screen, so a late answer from the camera is dropped.
  const shown = useRef(false);
  useEffect(() => {
    shown.current = true;
    return () => {
      shown.current = false;
    };
  }, []);

  useEffect(() => {
    if (opened.current === attempt) return;
    opened.current = attempt;
    void (async () => {
      try {
        const shot = await takeFacePhoto();
        if (!shown.current) return;
        if (shot) callbacks.current.onCaptured(shot);
        else callbacks.current.onCancel();
      } catch (e) {
        if (shown.current) setError(t(e instanceof NoCameraPermission ? 'face.cameraNeeded' : 'face.cameraFailed'));
      }
    })();
    // Runs once for each try; `t` changing language must not open the camera again.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [attempt]);

  return (
    <View style={styles.wrapper} accessibilityLabel={t(purpose === 'enrol' ? 'face.capture.enrol' : 'face.capture.clock')}>
      <Ionicons name="scan-circle-outline" size={96} color={theme.primary} style={styles.icon} />
      {instruction && (
        <ThemedText type="subtitle" style={styles.instruction}>
          {instruction}
        </ThemedText>
      )}
      {error ? (
        <>
          <ErrorText message={error} />
          <Button
            icon="camera-outline"
            label={t('common.retry')}
            onPress={() => {
              setError(null);
              setAttempt((current) => current + 1);
            }}
          />
          <Button variant="secondary" label={t('common.cancel')} onPress={onCancel} />
        </>
      ) : (
        <>
          <ActivityIndicator size="large" color={theme.primary} />
          <ThemedText type="default" themeColor="textSecondary" style={styles.center}>
            {t('face.openingCamera')}
          </ThemedText>
        </>
      )}
    </View>
  );
}

const styles = StyleSheet.create({
  wrapper: { alignItems: 'stretch', gap: Spacing.three, paddingVertical: Spacing.four },
  icon: { alignSelf: 'center' },
  instruction: { textAlign: 'center', fontSize: 26, lineHeight: 34 },
  center: { textAlign: 'center' },
});
