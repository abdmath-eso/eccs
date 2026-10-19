// Writes fresh random values for a server's three secrets into a settings file (Stage H,
// 19 Oct 2026), without ever showing them:
//
//   node infra/scripts/new-secrets.mjs <settings file>             fill in the ones that are empty or missing
//   node infra/scripts/new-secrets.mjs <settings file> --replace   replace all three (read the warning first)
//
//   PIN_SECRET          the key restaurant PINs are stored with. Replacing it stops every PIN working.
//   FILE_URL_SECRET     signs the short-lived links that show photos. Replacing it only breaks links
//                       already handed out, for up to an hour.
//   FACE_TEMPLATE_KEY   locks every enrolled face. Replacing or losing it means every staff member
//                       must enrol their face again.
//
// The file is the server's .env (made from infra/server/server.env.example) or a copy of it. It
// must not be in git: the script refuses a file git tracks, or one inside the repo that git does
// not ignore. A value already set is kept unless --replace is given, so running it again on a
// live server's file changes nothing. Nothing secret is printed, only which keys were written.

import { randomBytes } from 'node:crypto';
import { execFileSync } from 'node:child_process';
import { chmodSync, existsSync, readFileSync, statSync, writeFileSync } from 'node:fs';
import { basename, dirname, resolve } from 'node:path';

const KEYS = ['PIN_SECRET', 'FILE_URL_SECRET', 'FACE_TEMPLATE_KEY'];

const args = process.argv.slice(2);
const replace = args.includes('--replace');
const target = args.find((arg) => !arg.startsWith('--'));
const stop = (message) => {
  console.error(message);
  process.exit(1);
};

if (!target || args.some((arg) => arg.startsWith('--') && arg !== '--replace')) {
  stop('Usage: node infra/scripts/new-secrets.mjs <settings file> [--replace]');
}
const file = resolve(target);
const folder = dirname(file);
if (!existsSync(folder) || !statSync(folder).isDirectory()) stop(`The folder ${folder} does not exist.`);

/** Whether git would ever see this file: "outside" a repo, "tracked", "ignored" or "not-ignored". */
function gitState() {
  const git = (...gitArgs) => execFileSync('git', ['-C', folder, ...gitArgs], { stdio: 'ignore' });
  try {
    git('rev-parse', '--is-inside-work-tree');
  } catch {
    return 'outside'; // not in a repo, or git is not installed (as on the server)
  }
  try {
    git('ls-files', '--error-unmatch', '--', basename(file));
    return 'tracked';
  } catch {
    // not tracked: carry on
  }
  try {
    git('check-ignore', '-q', '--', basename(file));
    return 'ignored';
  } catch {
    return 'not-ignored';
  }
}

const state = gitState();
if (state === 'tracked') stop(`${file} is in git. Secrets must never be committed: use a file outside the repo.`);
if (state === 'not-ignored') stop(`${file} is inside the repo and git does not ignore it, so it could be committed. Use a file outside the repo.`);

// Keep the file's own line endings and every other line as it is.
const before = existsSync(file) ? readFileSync(file, 'utf8') : '';
const eol = before.includes('\r\n') ? '\r\n' : '\n';
const lines = before === '' ? [] : before.replace(/\r?\n$/, '').split(/\r?\n/);
const fresh = () => randomBytes(48).toString('base64url'); // 64 letters, digits, "-" and "_": nothing a settings file reads specially

const report = [];
for (const key of KEYS) {
  const index = lines.findIndex((line) => line.startsWith(`${key}=`));
  const current = index === -1 ? '' : lines[index].slice(key.length + 1).trim();
  if (current && !replace) {
    report.push(`${key}: kept (already set)`);
    continue;
  }
  if (index === -1) lines.push(`${key}=${fresh()}`);
  else lines[index] = `${key}=${fresh()}`;
  report.push(`${key}: ${current ? 'REPLACED with a new value' : 'new value written'}`);
}

writeFileSync(file, lines.join(eol) + eol, 'utf8');
try {
  chmodSync(file, 0o600); // only its owner may read it (Linux and macOS; Windows ignores this)
} catch {
  // not supported here
}

console.log(`Secrets in ${file}:`);
for (const line of report) console.log(`  ${line}`);
console.log('');
console.log('The values are not shown. Keep a copy of this file in the password manager, off the server.');
console.log('WARNING: if FACE_TEMPLATE_KEY is lost or changed, every staff member has to enrol their face again.');
if (replace) console.log('WARNING: a replaced PIN_SECRET stops every restaurant PIN working; each person then needs a new PIN.');
