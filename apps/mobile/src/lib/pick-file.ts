import type { UploadFile } from '@eccs/api-client';
import * as DocumentPicker from 'expo-document-picker';
import { File } from 'expo-file-system';
import { Platform } from 'react-native';

import { takeProofPhoto } from './photo';

/** A photo or PDF chosen for a licence or the document vault, ready to upload. */
export interface ChosenFile {
  file: UploadFile;
  name: string;
}

/** Thrown when the chosen file is neither an image nor a PDF. */
export class UnsupportedFileError extends Error {}

const DOCUMENT_PHOTO_WIDTH = 2000;

/** Photographs a paper document with the camera. Returns null if the person cancels. */
export async function photographDocument(): Promise<ChosenFile | null> {
  const photo = await takeProofPhoto({ maxWidth: DOCUMENT_PHOTO_WIDTH });
  return photo ? { file: photo.file, name: 'photo.jpg' } : null;
}

/** Lets the person pick an existing PDF or image from the phone. Returns null if they cancel. */
export async function chooseDocument(): Promise<ChosenFile | null> {
  const result = await DocumentPicker.getDocumentAsync({
    type: ['application/pdf', 'image/*'],
    copyToCacheDirectory: true,
    multiple: false,
  });
  const asset = result.canceled ? undefined : result.assets[0];
  if (!asset) return null;

  const type = asset.mimeType ?? '';
  const looksRight = type === 'application/pdf' || type.startsWith('image/') || /\.(pdf|jpe?g|png|webp)$/i.test(asset.name);
  if (!looksRight) throw new UnsupportedFileError();

  // In a browser the picker hands over a real File; on a phone it gives a path,
  // which is wrapped in an Expo File so it can be uploaded (see photo.ts).
  const file: UploadFile = Platform.OS === 'web' && asset.file ? asset.file : (new File(asset.uri) as unknown as Blob);
  return { file, name: asset.name };
}
