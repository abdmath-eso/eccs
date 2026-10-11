// Downloads the two face models the API needs into apps/api/models/.
//
//   pnpm --filter @eccs/api face:models
//
// The files (about 39 MB together) are not kept in git. Each one is listed in
// models/manifest.json with the address it comes from and its SHA-256, and is
// checked against that after downloading: a file that does not match is thrown
// away, because a wrong model would give wrong matches without any error.
// Safe to run again: a file that is already there and correct is left alone.

import { createHash } from 'node:crypto';
import { existsSync, mkdirSync, readFileSync, renameSync, rmSync, writeFileSync } from 'node:fs';
import { resolve } from 'node:path';

const dir = process.env.FACE_MODELS_DIR || resolve(import.meta.dirname, '../models');
const manifest = JSON.parse(readFileSync(resolve(import.meta.dirname, '../models/manifest.json'), 'utf8'));
const sha256 = (bytes) => createHash('sha256').update(bytes).digest('hex');

mkdirSync(dir, { recursive: true });
let failed = false;
for (const model of manifest.models) {
  const path = resolve(dir, model.file);
  if (existsSync(path) && sha256(readFileSync(path)) === model.sha256) {
    console.log(`ok       ${model.file} (already here)`);
    continue;
  }
  console.log(`fetching ${model.file} from ${model.url}`);
  try {
    const response = await fetch(model.url, { redirect: 'follow' });
    if (!response.ok) throw new Error(`the server answered ${response.status}`);
    const bytes = Buffer.from(await response.arrayBuffer());
    const hash = sha256(bytes);
    if (hash !== model.sha256) throw new Error(`SHA-256 is ${hash}, expected ${model.sha256}`);
    // Written under another name first, so a download cut short never leaves a half file in place.
    const partial = `${path}.part`;
    writeFileSync(partial, bytes);
    if (existsSync(path)) rmSync(path);
    renameSync(partial, path);
    console.log(`ok       ${model.file} (${bytes.length} bytes, ${model.licence})`);
  } catch (error) {
    failed = true;
    console.error(`FAILED   ${model.file}: ${error instanceof Error ? error.message : error}`);
  }
}
if (failed) {
  console.error('\nNot every model could be fetched. The API will still start, but face attendance answers "not available" until they are here.');
  process.exit(1);
}
console.log(`\nFace models are in ${dir}. Restart the API to load them.`);
