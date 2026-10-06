import type { UploadFile } from '@eccs/api-client';
import { File } from 'expo-file-system';
import { ImageManipulator, SaveFormat } from 'expo-image-manipulator';
import * as ImagePicker from 'expo-image-picker';
import { Platform } from 'react-native';

/** Thrown when the person has not allowed the app to use the camera. */
export class CameraPermissionError extends Error {}

const MAX_WIDTH = 1280;
const JPEG_QUALITY = 0.6;

export interface ProofPhoto {
  /** What to hand to the API client for upload. */
  file: UploadFile;
  /** Local address of the photo, for showing it before the upload finishes. */
  uri: string;
}

/**
 * Takes a proof photo and shrinks it so it uploads quickly on a weak signal.
 * On a phone this always opens the camera, never the gallery, so the photo
 * is of the kitchen as it is now. The browser preview has no camera access
 * and opens a file picker instead. Returns null if the person cancels.
 */
const PROFILE_PHOTO_WIDTH = 600;

/**
 * Takes or chooses a photo of the person for their profile, cropped square
 * and shrunk. Unlike a proof photo this may come from the gallery. Returns
 * null if the person cancels.
 */
export async function chooseProfilePhoto(source: 'camera' | 'gallery'): Promise<ProofPhoto | null> {
  const options: ImagePicker.ImagePickerOptions = {
    mediaTypes: ['images'],
    allowsEditing: true,
    aspect: [1, 1],
    quality: 0.8,
  };
  let result: ImagePicker.ImagePickerResult;
  // The browser preview has no camera access, so both buttons open the file picker there.
  if (source === 'camera' && Platform.OS !== 'web') {
    const permission = await ImagePicker.requestCameraPermissionsAsync();
    if (!permission.granted) throw new CameraPermissionError();
    result = await ImagePicker.launchCameraAsync({ ...options, cameraType: ImagePicker.CameraType.front });
  } else {
    result = await ImagePicker.launchImageLibraryAsync(options);
  }

  const asset = result.canceled ? undefined : result.assets[0];
  if (!asset) return null;

  const context = ImageManipulator.manipulate(asset.uri);
  if (asset.width > PROFILE_PHOTO_WIDTH) context.resize({ width: PROFILE_PHOTO_WIDTH });
  const rendered = await context.renderAsync();
  const saved = await rendered.saveAsync({ compress: 0.8, format: SaveFormat.JPEG });
  // See takeProofPhoto for why a phone hands over an Expo `File`.
  const file: UploadFile =
    Platform.OS === 'web' ? await (await fetch(saved.uri)).blob() : (new File(saved.uri) as unknown as Blob);
  return { file, uri: saved.uri };
}

export async function takeProofPhoto(options: { maxWidth?: number } = {}): Promise<ProofPhoto | null> {
  // Documents are photographed at a higher width so small print stays readable.
  const maxWidth = options.maxWidth ?? MAX_WIDTH;
  let result: ImagePicker.ImagePickerResult;
  if (Platform.OS === 'web') {
    result = await ImagePicker.launchImageLibraryAsync({ mediaTypes: ['images'], quality: JPEG_QUALITY });
  } else {
    const permission = await ImagePicker.requestCameraPermissionsAsync();
    if (!permission.granted) throw new CameraPermissionError();
    result = await ImagePicker.launchCameraAsync({ mediaTypes: ['images'], quality: JPEG_QUALITY });
  }

  const asset = result.canceled ? undefined : result.assets[0];
  if (!asset) return null;

  const context = ImageManipulator.manipulate(asset.uri);
  if (asset.width > maxWidth) context.resize({ width: maxWidth });
  const rendered = await context.renderAsync();
  const saved = await rendered.saveAsync({ compress: JPEG_QUALITY, format: SaveFormat.JPEG });

  // On a phone the photo is handed over as an Expo `File`, which reads the
  // saved image from disk when it is sent. React Native's older
  // `{ uri, name, type }` form is NOT accepted by Expo's fetch and fails with
  // a misleading "network" error, so do not go back to it.
  const file: UploadFile =
    Platform.OS === 'web' ? await (await fetch(saved.uri)).blob() : (new File(saved.uri) as unknown as Blob);
  return { file, uri: saved.uri };
}
