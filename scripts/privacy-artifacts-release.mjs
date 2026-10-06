#!/usr/bin/env node
/**
 * Prepares a GitHub release mirroring a C6 pool instance's proving files.
 *
 * By default the app downloads the 18 files of an instance (circuit .wasm,
 * .zkey and verifying keys, ~88 MB) from the testnet web wallet. A release
 *   https://github.com/<repo>/releases/download/c6-test-<commitment[0:12]>/<file>
 * is an alternative the user can set as the URL in the privacy screen. Any
 * host works: the app keeps a file only if its size and SHA-256 match the pins
 * built into it, so this script first checks the local files against them.
 *
 * Usage:
 *   node scripts/privacy-artifacts-release.mjs <xna|asset> <dir> [--repo owner/name] [--publish]
 *
 * <dir> is the folder with the instance's files, e.g. the web wallet's
 * public/privacy-c6 (XNA) or public/privacy-c6-assets/C6ASSET261004A (asset).
 * Without --publish it only verifies and prints the `gh release create`
 * command; with --publish it runs it (needs an authenticated GitHub CLI).
 */

import { createHash } from 'node:crypto';
import { readFileSync, statSync } from 'node:fs';
import { spawnSync } from 'node:child_process';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const args = process.argv.slice(2);
const kind = args[0];
const dir = args[1];
const repo = args.includes('--repo') ? args[args.indexOf('--repo') + 1] : 'NeuraiProject/neurai-privacy';
const publish = args.includes('--publish');

const manifests = {
  xna: 'blue_modules/neurai/privacy/c6-testnet.json',
  asset: 'blue_modules/neurai/privacy/c6-assets-testnet.json',
};
if (!manifests[kind] || !dir) {
  console.error('Usage: node scripts/privacy-artifacts-release.mjs <xna|asset> <dir> [--repo owner/name] [--publish]');
  process.exit(2);
}

const { config } = JSON.parse(readFileSync(join(root, manifests[kind]), 'utf8'));
const commitment = config.expectedCommitment;
const tag = `c6-test-${commitment.slice(0, 12)}`;
const identity = config.manifest.identity ?? commitment;

let failed = false;
const files = [];
for (const [name, pin] of Object.entries(config.artifacts.files)) {
  const path = join(dir, name);
  let ok = false;
  let detail = '';
  try {
    const size = statSync(path).size;
    const sha256 = createHash('sha256').update(readFileSync(path)).digest('hex');
    ok = size === pin.bytes && sha256 === pin.sha256;
    detail = ok ? `${(size / 1048576).toFixed(1)} MB` : `size ${size}/${pin.bytes}, sha256 ${sha256 === pin.sha256 ? 'ok' : 'MISMATCH'}`;
  } catch (error) {
    detail = error.code === 'ENOENT' ? 'missing' : error.message;
  }
  console.log(`${ok ? 'ok  ' : 'FAIL'} ${name} ${detail}`);
  if (!ok) failed = true;
  files.push(path);
}
if (failed) {
  console.error('\nThe folder does not match the pins of this app build; nothing was published.');
  process.exit(1);
}

const notes = [
  `Proving files of the C6 TEST pool ${identity} (testnet), commitment ${commitment}.`,
  'Pinned by size and SHA-256 in the Neurai wallets; do not replace them in place.',
  '',
  ...Object.entries(config.artifacts.files).map(([name, pin]) => `${pin.sha256}  ${name}`),
].join('\n');
const releaseCommand = releaseNotes => [
  'gh',
  'release',
  'create',
  tag,
  '--repo',
  repo,
  '--prerelease',
  '--title',
  `C6 TEST proving files · ${identity}`,
  '--notes',
  releaseNotes,
  ...files,
];

console.log(`\nRelease ${tag} on ${repo}; the app downloads from:`);
console.log(`  https://github.com/${repo}/releases/download/${tag}/<file>`);
if (!publish) {
  console.log('\nVerified. To publish, run again with --publish, or:');
  // One-line notes so the printed command can be pasted into a shell.
  const printable = releaseCommand(
    `C6 TEST proving files of ${identity}, commitment ${commitment}. Pinned by SHA-256 in the Neurai wallets.`,
  );
  console.log(printable.map(part => (/[\s"'$#]/.test(part) ? `'${part.replace(/'/g, "'\\''")}'` : part)).join(' '));
  process.exit(0);
}
const command = releaseCommand(notes);
const result = spawnSync(command[0], command.slice(1), { stdio: 'inherit' });
process.exit(result.status ?? 1);
