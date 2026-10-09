// A camera writes more into a JPEG than the picture: where the phone was, its make and
// model, the exact time, sometimes a small second copy of the image. None of that
// belongs on a public page, so it is cut out of the file as it is served. The picture
// itself is not touched or re-compressed.
//
// A JPEG is a run of segments, each starting 0xFF and a marker byte. The details live
// in the "application" segments APP1 to APP15 (Exif, XMP, maker notes) and in comments.
// APP0 (the plain JFIF header) and APP2 when it holds a colour profile are kept, since
// dropping them can change how the picture looks. Any other kind of image, or a file
// that does not parse, is returned unchanged.

const MARKER_SOI = 0xd8;
const MARKER_SOS = 0xda;
const MARKER_COM = 0xfe;
const MARKER_APP0 = 0xe0;
const MARKER_APP2 = 0xe2;
const MARKER_APP15 = 0xef;

export function stripPhotoDetails(file: Buffer, mimeType: string): Buffer {
  if (mimeType !== 'image/jpeg' || file.length < 4 || file[0] !== 0xff || file[1] !== MARKER_SOI) return file;

  const kept: Buffer[] = [file.subarray(0, 2)];
  let at = 2;
  while (at + 4 <= file.length) {
    if (file[at] !== 0xff) return file; // not where a segment should start: leave the file alone
    const marker = file[at + 1]!;
    // From "start of scan" on it is the picture's own data, to the end of the file.
    if (marker === MARKER_SOS) {
      kept.push(file.subarray(at));
      return Buffer.concat(kept);
    }
    const length = file.readUInt16BE(at + 2);
    const end = at + 2 + length;
    if (length < 2 || end > file.length) return file;

    const isColourProfile = marker === MARKER_APP2 && file.subarray(at + 4, at + 15).toString('latin1') === 'ICC_PROFILE';
    const isDetails = (marker > MARKER_APP0 && marker <= MARKER_APP15 && !isColourProfile) || marker === MARKER_COM;
    if (!isDetails) kept.push(file.subarray(at, end));
    at = end;
  }
  // Ran off the end without reaching the picture: not a file we understand.
  return file;
}
