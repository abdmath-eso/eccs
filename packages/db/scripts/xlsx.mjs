// A small reader for .xlsx workbooks, used by the import scripts. An .xlsx is a
// zip of XML files, so it is read directly and no extra packages are needed.

import { inflateRawSync } from 'node:zlib';

/** Returns the files inside a zip as { name: text }. */
export function unzip(buffer) {
  const files = {};
  // The end-of-central-directory record sits at the end of the file.
  let end = buffer.length - 22;
  while (end >= 0 && buffer.readUInt32LE(end) !== 0x06054b50) end--;
  if (end < 0) throw new Error('Not a zip file');
  let offset = buffer.readUInt32LE(end + 16);
  const count = buffer.readUInt16LE(end + 10);

  for (let i = 0; i < count; i++) {
    if (buffer.readUInt32LE(offset) !== 0x02014b50) throw new Error('Corrupt zip directory');
    const method = buffer.readUInt16LE(offset + 10);
    const compressedSize = buffer.readUInt32LE(offset + 20);
    const nameLength = buffer.readUInt16LE(offset + 28);
    const extraLength = buffer.readUInt16LE(offset + 30);
    const commentLength = buffer.readUInt16LE(offset + 32);
    const localOffset = buffer.readUInt32LE(offset + 42);
    const name = buffer.toString('utf8', offset + 46, offset + 46 + nameLength);

    const dataStart = localOffset + 30 + buffer.readUInt16LE(localOffset + 26) + buffer.readUInt16LE(localOffset + 28);
    const data = buffer.subarray(dataStart, dataStart + compressedSize);
    files[name] = (method === 0 ? data : inflateRawSync(data)).toString('utf8');
    offset += 46 + nameLength + extraLength + commentLength;
  }
  return files;
}

const decode = (text) =>
  text
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&quot;/g, '"')
    .replace(/&apos;/g, "'")
    .replace(/&#(\d+);/g, (_, code) => String.fromCodePoint(Number(code)))
    .replace(/&amp;/g, '&');

export function readSheets(files) {
  const shared = [...(files['xl/sharedStrings.xml'] ?? '').matchAll(/<si>([\s\S]*?)<\/si>/g)].map((match) =>
    decode([...match[1].matchAll(/<t[^>]*>([\s\S]*?)<\/t>/g)].map((t) => t[1]).join('')),
  );
  const targets = Object.fromEntries(
    [...files['xl/_rels/workbook.xml.rels'].matchAll(/<Relationship\b[^>]*>/g)].map((match) => [
      /Id="([^"]+)"/.exec(match[0])[1],
      /Target="([^"]+)"/.exec(match[0])[1].replace(/^\/?(xl\/)?/, 'xl/'),
    ]),
  );
  const column = (ref) => [...ref.replace(/\d+/g, '')].reduce((n, ch) => n * 26 + ch.charCodeAt(0) - 64, 0) - 1;

  const sheets = {};
  for (const match of files['xl/workbook.xml'].matchAll(/<sheet\b[^>]*>/g)) {
    const name = decode(/name="([^"]+)"/.exec(match[0])[1]);
    const xml = files[targets[/r:id="([^"]+)"/.exec(match[0])[1]]];
    sheets[name] = [...xml.matchAll(/<row\b[^>]*>([\s\S]*?)<\/row>/g)].map((row) => {
      const cells = [];
      for (const cell of row[1].matchAll(/<c\b([^>]*?)(?:\/>|>([\s\S]*?)<\/c>)/g)) {
        const ref = /r="([A-Z]+\d+)"/.exec(cell[1]);
        const isShared = /t="s"/.test(cell[1]);
        const value = /<v>([\s\S]*?)<\/v>/.exec(cell[2] ?? '');
        const inline = /<is>[\s\S]*?<t[^>]*>([\s\S]*?)<\/t>/.exec(cell[2] ?? '');
        cells[ref ? column(ref[1]) : cells.length] = isShared && value ? shared[Number(value[1])] : decode((inline ?? value)?.[1] ?? '');
      }
      return Array.from(cells, (value) => (value ?? '').trim());
    });
  }
  return sheets;
}
