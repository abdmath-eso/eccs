import type { UploadFile } from '@eccs/api-client';
import { File } from 'expo-file-system';
import { ImageManipulator, SaveFormat } from 'expo-image-manipulator';
import * as ImagePicker from 'expo-image-picker';
import { Platform } from 'react-native';

import { CameraPermissionError, type ProofPhoto } from './photo';

// The photo of a shop board (B2, 16 Oct 2026), and a free check's photo of something to
// fix. Unlike a checklist's proof photo, it may come from the gallery: a BDE often snaps
// the board from the road and logs the lead later. It is kept at about 1568 pixels on its
// long side, the size Anthropic's vision guide says is read without being shrunk again, so
// a phone number painted small on the board can still be read.

const LONG_SIDE = 1568;
const QUALITY = 0.7;

/** Takes (camera) or chooses (gallery) a photo, shrunk for a weak signal. Null if the person cancels. */
export async function pickLeadPhoto(source: 'camera' | 'gallery'): Promise<ProofPhoto | null> {
  let result: ImagePicker.ImagePickerResult;
  // The browser preview has no camera, so both open the file picker there.
  if (source === 'camera' && Platform.OS !== 'web') {
    const permission = await ImagePicker.requestCameraPermissionsAsync();
    if (!permission.granted) throw new CameraPermissionError();
    result = await ImagePicker.launchCameraAsync({ mediaTypes: ['images'], quality: QUALITY });
  } else {
    result = await ImagePicker.launchImageLibraryAsync({ mediaTypes: ['images'], quality: QUALITY });
  }
  const asset = result.canceled ? undefined : result.assets[0];
  if (!asset) return null;

  const context = ImageManipulator.manipulate(asset.uri);
  if (Math.max(asset.width, asset.height) > LONG_SIDE) context.resize(asset.width >= asset.height ? { width: LONG_SIDE } : { height: LONG_SIDE });
  const rendered = await context.renderAsync();
  const saved = await rendered.saveAsync({ compress: QUALITY, format: SaveFormat.JPEG });
  // See lib/photo.ts for why a phone hands over an Expo `File`.
  const file: UploadFile = Platform.OS === 'web' ? await (await fetch(saved.uri)).blob() : (new File(saved.uri) as unknown as Blob);
  return { file, uri: saved.uri };
}
