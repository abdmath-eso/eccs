// Converts docs/Restaurant_SOP_Knowledge_Base_Expanded_Cuisine_Dishes.xlsx
// into prisma/data/sop-library.json, which the database loads.
//
// Run from packages/db after the workbook changes:  pnpm soplibrary:import
// then load it into the database without touching other data:  pnpm soplibrary:load
//
// Two sheets are used: "SOP Knowledge Base" (how the restaurant is run) and
// "Cuisine & Dish SOP Directory" (dishes, sauces, cooking methods). The other
// sheets repeat the same rows. Columns that hold the same sentence on every
// row (prerequisites, records, training and so on) are left out.

import { readFileSync, writeFileSync } from 'node:fs';
import { readSheets, unzip } from './xlsx.mjs';

const SOURCE = new URL('../../../docs/Restaurant_SOP_Knowledge_Base_Expanded_Cuisine_Dishes.xlsx', import.meta.url);
const OUTPUT = new URL('../prisma/data/sop-library.json', import.meta.url);

// The workbook's 27 modules, sorted into the app's SOP categories
// (SOP_CATEGORIES in packages/shared/src/sops.ts).
const CATEGORY_OF_MODULE = {
  'Food Safety & Hygiene': 'PERSONAL_HYGIENE',
  'Allergen Management': 'PERSONAL_HYGIENE',
  'Quality Control': 'PERSONAL_HYGIENE',
  'Raw Material Preparation': 'FOOD_PREP',
  'Food Preparation & Cooking': 'FOOD_PREP',
  'Kitchen Operations': 'FOOD_PREP',
  'Food Storage & Cold Chain': 'FOOD_STORAGE',
  'Inventory Management': 'FOOD_STORAGE',
  'Supplier & Receiving': 'FOOD_STORAGE',
  'Cleaning & Sanitation': 'CLEANING',
  'Dishwashing & Stewarding': 'CLEANING',
  'Equipment & Maintenance': 'EQUIPMENT',
  'Utilities & Environment': 'EQUIPMENT',
  'Pest Management': 'PEST_CONTROL',
  'Waste Management': 'WASTE',
  'Fire, Health & Emergency Safety': 'SAFETY',
  Security: 'SAFETY',
  'Front Desk & Reception': 'SERVICE',
  'Customer Service': 'SERVICE',
  'POS, Cash & Billing': 'SERVICE',
  'Takeaway & Delivery': 'SERVICE',
  'Staff Management': 'STAFF',
  'Training & Competency': 'STAFF',
  'General Operations': 'MANAGEMENT',
  'Documentation & Compliance': 'MANAGEMENT',
  'Management & Business Control': 'MANAGEMENT',
  'New Restaurant Pre-Opening': 'MANAGEMENT',
};

// The sentence every "Critical Controls" cell starts with; only what follows it is specific.
const COMMON_CONTROL =
  'Follow approved restaurant specifications, manufacturer instructions, applicable food-safety requirements and validated critical limits. Stop and escalate when a safety or quality requirement cannot be met.';

const sheets = readSheets(unzip(readFileSync(SOURCE)));

function table(name) {
  const rows = sheets[name]?.filter((row) => row.some(Boolean));
  if (!rows) throw new Error(`Sheet "${name}" not found`);
  const [header, ...body] = rows;
  return body.map((row) => {
    const record = Object.fromEntries(header.map((title, index) => [title, row[index] ?? '']));
    return (column) => {
      if (!(column in record)) throw new Error(`Column "${column}" not found in "${name}"`);
      return record[column];
    };
  });
}

/** "1. Do this.\n2. Do that." as ["Do this.", "Do that."]. */
const steps = (text) =>
  text
    .split('\n')
    .map((line) => line.replace(/^\s*\d+[.)]\s*/, '').trim())
    .filter(Boolean);

const operations = table('SOP Knowledge Base')
  .filter((cell) => cell('SOP Name') && cell('Status') !== 'Inactive')
  .map((cell) => {
    const module = cell('Module');
    const category = CATEGORY_OF_MODULE[module];
    if (!category) throw new Error(`Module "${module}" has no category; add it to CATEGORY_OF_MODULE`);
    return {
      code: cell('SOP ID'),
      kind: 'OPERATION',
      name: cell('SOP Name'),
      category,
      section: module,
      role: cell('Primary Role') || null,
      area: cell('Area') || null,
      frequency: cell('Frequency') || null,
      purpose: cell('Purpose'),
      steps: steps(cell('Procedure Steps')),
      controls: cell('Critical Controls / Acceptance Criteria').replace(COMMON_CONTROL, '').trim() || null,
      keywords: [],
    };
  });

const recipes = table('Cuisine & Dish SOP Directory')
  .filter((cell) => cell('Dish / Preparation'))
  .map((cell) => ({
    code: cell('Cuisine SOP ID'),
    kind: 'RECIPE',
    name: cell('Dish / Preparation'),
    category: 'RECIPES',
    section: cell('Cuisine / Library'),
    role: null,
    area: 'Kitchen',
    frequency: null,
    purpose: cell('Purpose'),
    steps: steps(cell('Procedure Steps')),
    controls: cell('Allergen Considerations') || null,
    keywords: [
      cell('SOP Type'),
      ...cell('Search Keywords')
        .split(',')
        .map((word) => word.trim().toLowerCase())
        .filter(Boolean),
    ],
  }));

const items = [...operations, ...recipes];
const codes = new Set(items.map((item) => item.code));
if (codes.size !== items.length) throw new Error('Two SOPs share an id');
if (items.some((item) => item.steps.length === 0)) throw new Error('An SOP has no steps');

writeFileSync(OUTPUT, JSON.stringify(items, null, 1) + '\n');
console.log(
  `Wrote ${operations.length} operating SOPs in ${new Set(operations.map((item) => item.section)).size} modules and ` +
    `${recipes.length} dish and recipe SOPs in ${new Set(recipes.map((item) => item.section)).size} cuisines to ${OUTPUT.pathname}`,
);
