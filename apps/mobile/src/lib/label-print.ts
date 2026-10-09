import type { ApiClient } from '@eccs/api-client';
import { LABEL_SIZES, labelsHtml, type LabelPrintData, type LabelSize } from '@eccs/shared';
import { File, Paths } from 'expo-file-system';
import { Platform } from 'react-native';

import { getItem, setItem } from './storage';

// Getting a label out of the phone and onto a sticker.
//
// No label printer has been chosen or bought yet, so nothing here talks to a
// particular printer. There are four ways out, and every one of them hands
// over a finished picture of the label, so the printer never needs to know a
// script or own a font:
//
//   SYSTEM  the phone's own print screen. Works with any printer that has an
//           Android print service installed, which includes many label
//           printers through their maker's plug-in, and Wi-Fi office printers.
//   SHEET   the same print screen, with 24 labels laid out on an A4 page, for
//           a kitchen with an ordinary printer and no label printer.
//   IMAGE   the label as a PNG picture, shared to another app: the way into
//           a label printer's own app (they all accept a picture). The server
//           draws the picture, so this one needs signal.
//   PDF     the label as a one-page PDF of exactly the label's size, shared
//           to another app. Made on the phone, so it works without signal.
//
// ADDING A BLUETOOTH PRINTER LATER: add a fifth route here, 'BLUETOOTH', and
// one case in `sendLabels` that calls `labelPicture` for each label (a black
// and white PNG at 8 dots to the millimetre, which is what TSPL's BITMAP and
// ESC/POS's raster command both take) and passes it to the driver. Nothing
// else in the app needs to change: the screens only ever call `sendLabels`.

export type PrintRoute = 'SYSTEM' | 'SHEET' | 'IMAGE' | 'PDF';

export interface PrintJob {
  /** One entry per sticker wanted: three copies of a label are three entries. */
  labels: LabelPrintData[];
  size: Exclude<LabelSize, 'A4'>;
}

/**
 * What happened:
 *  sent         handed to the print screen or the share screen (whether paper came out, the app cannot know);
 *  unavailable  this copy of the app was built before printing was added, or the phone cannot share;
 *  needsSignal  the picture is drawn by the server, which could not be reached.
 */
export type PrintOutcome = 'sent' | 'unavailable' | 'needsSignal';

const SIZE_KEY = 'eccs.labelSize';
const isLabelSize = (value: string | null): value is PrintJob['size'] => value === 'L50X30' || value === 'L50X25' || value === 'ROLL58';

/** The label size last used on this phone. */
export async function recallLabelSize(): Promise<PrintJob['size'] | null> {
  const stored = await getItem(SIZE_KEY).catch(() => null);
  return isLabelSize(stored) ? stored : null;
}
export const rememberLabelSize = (size: PrintJob['size']) => setItem(SIZE_KEY, size).catch(() => undefined);

// A PDF page is measured in points, 72 to the inch.
const mmToPoints = (mm: number) => Math.round((mm / 25.4) * 72);

/** The print and share pieces of Expo, or null in a copy of the app built before they were added. */
async function printModule() {
  try {
    return await import('expo-print');
  } catch {
    return null;
  }
}
async function shareModule() {
  try {
    const sharing = await import('expo-sharing');
    return (await sharing.isAvailableAsync()) ? sharing : null;
  } catch {
    return null;
  }
}

/** In the browser preview: opens the labels in a new tab and brings up the browser's print box. */
function printInBrowser(html: string): PrintOutcome {
  const tab = typeof window === 'undefined' ? null : window.open('', '_blank');
  if (!tab) return 'unavailable';
  tab.document.write(html);
  tab.document.close();
  tab.focus();
  tab.print();
  return 'sent';
}

/**
 * The label as a black-and-white PNG at a thermal printer's dots, drawn by
 * the server. Returns the picture as base64 with its size in dots. This is
 * also what a Bluetooth driver will be given.
 */
export const labelPicture = (api: ApiClient, label: LabelPrintData, size: PrintJob['size']) =>
  api.foodLabels.render({ size, label });

function base64ToBytes(base64: string): Uint8Array {
  const binary = atob(base64);
  const bytes = new Uint8Array(binary.length);
  for (let index = 0; index < binary.length; index += 1) bytes[index] = binary.charCodeAt(index);
  return bytes;
}

/** Sends the labels out by the chosen route. The only function the screens call to print. */
export async function sendLabels(job: PrintJob, route: PrintRoute, api: ApiClient): Promise<PrintOutcome> {
  const first = job.labels[0];
  if (!first) return 'sent';

  if (route === 'SYSTEM' || route === 'SHEET') {
    const html = labelsHtml(job.labels, route === 'SHEET' ? 'A4' : job.size);
    if (Platform.OS === 'web') return printInBrowser(html);
    const print = await printModule();
    if (!print) return 'unavailable';
    const { widthMm, heightMm } = LABEL_SIZES[job.size];
    try {
      await print.printAsync(
        // On an iPhone the page size is given here; on Android the person picks the paper in the print screen.
        route === 'SHEET' ? { html } : { html, width: mmToPoints(widthMm), height: mmToPoints(heightMm) },
      );
    } catch {
      // Closing the print screen without printing lands here on an iPhone. Nothing went wrong.
    }
    return 'sent';
  }

  if (route === 'PDF') {
    if (Platform.OS === 'web') return printInBrowser(labelsHtml(job.labels, job.size));
    const [print, sharing] = await Promise.all([printModule(), shareModule()]);
    if (!print || !sharing) return 'unavailable';
    const { widthMm, heightMm } = LABEL_SIZES[job.size];
    const pdf = await print.printToFileAsync({
      html: labelsHtml(job.labels, job.size),
      width: mmToPoints(widthMm),
      height: mmToPoints(heightMm),
      margins: { top: 0, right: 0, bottom: 0, left: 0 },
    });
    await sharing.shareAsync(pdf.uri, { mimeType: 'application/pdf', UTI: 'com.adobe.pdf' });
    return 'sent';
  }

  // IMAGE: one picture of the label. Copies are made in the printer's own app.
  let picture;
  try {
    picture = await labelPicture(api, first, job.size);
  } catch {
    return 'needsSignal';
  }
  if (Platform.OS === 'web') {
    window.open(`data:image/png;base64,${picture.pngBase64}`, '_blank');
    return 'sent';
  }
  const sharing = await shareModule();
  if (!sharing) return 'unavailable';
  const file = new File(Paths.cache, 'eccs-food-label.png');
  if (file.exists) file.delete();
  file.create();
  file.write(base64ToBytes(picture.pngBase64));
  await sharing.shareAsync(file.uri, { mimeType: 'image/png', UTI: 'public.png' });
  return 'sent';
}
