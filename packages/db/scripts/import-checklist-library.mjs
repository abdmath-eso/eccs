// Converts docs/Restaurant_Master_Checklist_Library.xlsx into
// prisma/data/checklist-library.json, which the database loads.
//
// Run from packages/db after the sheet changes:  pnpm library:import
// then load it into the database without touching other data:  pnpm library:load
//
// Reads the .xlsx directly (it is a zip of XML files) so no extra packages are needed.

import { readFileSync, writeFileSync } from 'node:fs';
import { inflateRawSync } from 'node:zlib';

const SOURCE = new URL('../../../docs/Restaurant_Master_Checklist_Library.xlsx', import.meta.url);
const OUTPUT = new URL('../prisma/data/checklist-library.json', import.meta.url);

/** Returns the files inside a zip as { name: text }. */
function unzip(buffer) {
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

function readSheets(files) {
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

const sheets = readSheets(unzip(readFileSync(SOURCE)));
const library = sheets['Checklist Library'];
const keywordRows = sheets['Keyword Index'];
if (!library || !keywordRows) throw new Error('Expected sheets "Checklist Library" and "Keyword Index"');

const header = library[0];
const at = (name) => {
  const index = header.indexOf(name);
  if (index < 0) throw new Error(`Column "${name}" not found`);
  return index;
};
const col = {
  id: at('Checklist ID'),
  name: at('Checklist Name'),
  category: at('Category'),
  frequency: at('Frequency'),
  role: at('Responsible Role'),
  area: at('Area'),
  number: at('Task No.'),
  text: at('Checklist Item'),
  priority: at('Priority'),
  status: at('Status'),
};

// "fridge" -> ["Storage & Inventory", "Equipment Specific"], turned around so each category knows its search words.
const keywordsByCategory = {};
for (const [keyword, category] of keywordRows.slice(1)) {
  if (keyword && category) (keywordsByCategory[category] ??= []).push(keyword.toLowerCase());
}

const items = library
  .slice(1)
  .filter((row) => row[col.text] && row[col.status] !== 'Inactive')
  .map((row) => ({
    code: `${row[col.id]}-${String(row[col.number]).padStart(2, '0')}`,
    checklistName: row[col.name],
    category: row[col.category],
    area: row[col.area] || null,
    frequency: row[col.frequency] || null,
    role: row[col.role] || null,
    priority: row[col.priority] === 'High' ? 'HIGH' : 'MEDIUM',
    text: row[col.text],
    keywords: keywordsByCategory[row[col.category]] ?? [],
  }));

writeFileSync(OUTPUT, JSON.stringify(items, null, 1) + '\n');
console.log(`Wrote ${items.length} checks from ${new Set(items.map((item) => item.checklistName)).size} checklists to ${OUTPUT.pathname}`);
