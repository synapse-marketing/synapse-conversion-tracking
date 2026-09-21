// One entry point for the whole suite.
//
// Ten separate entry points with different defaults is how three of them ended
// up silently testing a two-month-old render while reporting green. This runs
// everything against ONE version, prints one summary, and distinguishes the two
// ways a suite can be untrustworthy: assertions that failed, and assertions
// that passed against a snapshot nobody can vouch for.
//
// Usage:  node dev-tools/run-all.mjs [--plugin "<folder>"]
import fs from 'node:fs';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { checkFreshness } from './snapshot-freshness.mjs';

const dir = path.dirname(fileURLToPath(import.meta.url));
const arg = (n, d) => { const i = process.argv.indexOf(n); return i !== -1 && process.argv[i + 1] ? process.argv[i + 1] : d; };
// In the release checkout the plugin sits in a versioned folder next to
// dev-tools; in the git repository it sits directly at ./synapse-conversion-tracking.
const versioned = 'synapse-conversion-tracking v2.0.0';
const PLUGIN = arg('--plugin', fs.existsSync(path.join(dir, '..', versioned)) ? versioned : '.');

// Suites that read the plugin source directly. These are the ones whose green
// means something on any machine, with or without PHP.
const LIVE = [
  'build-sender.mjs --check',
  'template-drift-check.mjs',
  'twin-parity-check.mjs',
  'javascript-test.mjs',
  'sentinel-shim-test.mjs',
  'edge-sender17-test.mjs',
  'worker-sender-test.mjs',
  'cfg-encoding-durability.mjs',
  'php-contracts.mjs',
];

// Suites that read snapshots rendered by render-ga4fb.php. Their assertions are
// real, but only as current as the last render.
const SNAPSHOT = [
  'ga4fb-test.mjs',
  'data-rescue-test.mjs',
  'edge-sender-test.mjs',
  'clickid-restorer-test.mjs',
];

const num = (s) => { const m = /(\d+)\/(\d+)\s+(?:passed|pins hold)/.exec(s); return m ? [Number(m[1]), Number(m[2])] : null; };

function run(entry) {
  const [file, ...extra] = entry.split(' ');
  const r = spawnSync(process.execPath, [path.join(dir, file), '--plugin', PLUGIN, ...extra], { encoding: 'utf8' });
  const out = (r.stdout || '') + (r.stderr || '');
  return { file, code: r.status, out, counts: num(out) };
}

let hardFail = 0, softFail = 0, totalPass = 0, totalAll = 0, snapPass = 0, snapAll = 0;
const rows = [];

console.log(`\nSynapse test suite - ${PLUGIN}\n`);
console.log('  live source');
for (const e of LIVE) {
  const r = run(e);
  if (r.counts) { totalPass += r.counts[0]; totalAll += r.counts[1]; }
  const okc = r.code === 0;
  const skipped = okc && /^\s*SKIP\b/m.test(r.out);
  if (!okc) hardFail++;
  const label = skipped ? 'SKIP' : (okc ? 'PASS' : 'FAIL');
  rows.push([label, r.file, r.counts ? `${r.counts[0]}/${r.counts[1]}` : (okc ? 'ok' : 'error'), r]);
  console.log(`    ${label.padEnd(4)}  ${r.file.padEnd(30)} ${r.counts ? r.counts[0] + '/' + r.counts[1] : ''}`);
  if (skipped) { console.log(r.out.split('\n').filter((l) => /SKIP/.test(l)).map((l) => '      ' + l.trim()).join('\n')); }
  if (!okc) { console.log(r.out.split('\n').filter((l) => /FAIL|Error|STALE/.test(l)).slice(0, 6).map((l) => '          ' + l).join('\n')); }
}

const fresh = checkFreshness(PLUGIN);
console.log(`\n  snapshots  (${fresh.fresh ? 'current' : 'STALE - ' + fresh.reason})`);
for (const e of SNAPSHOT) {
  const r = run(e);
  if (r.counts) { snapPass += r.counts[0]; snapAll += r.counts[1]; }
  // A snapshot suite failing only because the render is stale is a soft failure:
  // its assertions still passed, they just cannot be vouched for.
  const skipped = /^\s*SKIP\b/m.test(r.out);
  const assertionsOk = r.counts ? r.counts[0] === r.counts[1] : r.code === 0;
  const label = skipped ? 'SKIP' : (assertionsOk ? (fresh.fresh ? 'PASS' : 'STALE') : 'FAIL');
  if (label === 'FAIL') hardFail++;
  if (label === 'STALE') softFail++;
  if (label === 'SKIP') { console.log(r.out.split('\n').filter((l) => /SKIP|install PHP/.test(l)).map((l) => '      ' + l.trim()).join('\n')); }
  console.log(`    ${label.padEnd(5)} ${r.file.padEnd(30)} ${r.counts ? r.counts[0] + '/' + r.counts[1] : ''}`);
  if (label === 'FAIL') { console.log(r.out.split('\n').filter((l) => /FAIL|Error/.test(l)).slice(0, 6).map((l) => '          ' + l).join('\n')); }
}

// The two totals are kept apart on purpose. Merging them is how a green line
// came to include assertions that were passing against a two-month-old render:
// the number went up, and nothing in it said which half could be vouched for.
console.log(`\n  ${totalPass}/${totalAll} assertions passed against the live source`);
if (snapAll) {
  console.log(`  ${snapPass}/${snapAll} more passed against snapshots${fresh.fresh ? '' : ' of unverified age, which prove nothing about the current code'}`);
}
if (softFail) {
  console.log(`  ${softFail} suite(s) run against snapshots of unverified age.`);
  console.log('  To refresh, on a machine with PHP:');
  console.log(`    php dev-tools/render-ga4fb.php "${PLUGIN}/synapse-conversion-tracking" dev-tools`);
  console.log(`    node dev-tools/render-boot.mjs --plugin "${PLUGIN}"`);
  console.log(`    node dev-tools/snapshot-freshness.mjs --stamp --plugin "${PLUGIN}"`);
}
console.log(hardFail ? `\n  ${hardFail} suite(s) FAILED\n` : '\n  no failures\n');
process.exit(hardFail ? 1 : 0);
