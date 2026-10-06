// Converts docs/Restaurant_Master_Checklist_Library.xlsx into
// prisma/data/checklist-library.json, which the database loads.
//
// Run from packages/db after the sheet changes:  pnpm library:import
// then load it into the database without touching other data:  pnpm library:load
//
import { readFileSync, writeFileSync } from 'node:fs';
import { readSheets, unzip } from './xlsx.mjs';

const SOURCE = new URL('../../../docs/Restaurant_Master_Checklist_Library.xlsx', import.meta.url);
const OUTPUT = new URL('../prisma/data/checklist-library.json', import.meta.url);

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
