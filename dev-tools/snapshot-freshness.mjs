// Staleness guard for the PHP-rendered snapshots.
//
// combined-shim-on.js, combined-v16.js, rescue-only.js, rescue-noshim.js,
// combined-nosuffix.js, edge-boot.js, edge-rescue.js and combined-edge.js are
// produced by render-ga4fb.php / render-boot.mjs. They are inputs to
// ga4fb-test, data-rescue-test and edge-sender-test.
//
// A snapshot cannot tell you it is out of date. On 2026-09-20 three suites were
// reporting green against a render from 16 July, two months and several
// releases behind - including a shim fix that none of them could see. That is
// worse than having no test, because it reads as coverage.
//
// So: the render writes a manifest of the source it was made from, and the
// suites refuse to trust a snapshot whose manifest is missing or no longer
// matches. Regenerating needs PHP:
//
//     php dev-tools/render-ga4fb.php "<plugin root>" dev-tools
//     node dev-tools/render-boot.mjs --plugin "<version folder>"
//     node dev-tools/snapshot-freshness.mjs --stamp --plugin "<version folder>"
//
import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import { fileURLToPath } from 'node:url';

const dir = path.dirname(fileURLToPath(import.meta.url));
const MANIFEST = path.join(dir, '.render-manifest.json');

// Everything a render's output depends on. A change to any of these can change
// what the renderer would emit, so it invalidates every snapshot.
const SOURCES = [
  'includes/class-gtm-server-side-tracking-code.php',
  'includes/class-gtm-server-side-helpers.php',
  'assets/tail.js',
  'assets/data-tag-sender.js',
];

export function fingerprint(pluginDir) {
  const root = path.join(dir, '..', pluginDir, 'synapse-conversion-tracking');
  const h = crypto.createHash('sha256');
  const parts = {};
  for (const rel of SOURCES) {
    const p = path.join(root, rel);
    const buf = fs.existsSync(p) ? fs.readFileSync(p) : Buffer.alloc(0);
    const one = crypto.createHash('sha256').update(buf).digest('hex');
    parts[rel] = one;
    h.update(rel).update(one);
  }
  return { combined: h.digest('hex'), parts };
}

/**
 * @returns {{fresh: boolean, reason: string}}
 */
export function checkFreshness(pluginDir) {
  const fp = fingerprint(pluginDir);
  if (!fs.existsSync(MANIFEST)) {
    return {
      fresh: false,
      reason: 'no .render-manifest.json - the snapshots in dev-tools/ have unknown provenance. '
        + 'Re-run render-ga4fb.php and render-boot.mjs on a machine with PHP, then stamp.',
    };
  }
  let man;
  try { man = JSON.parse(fs.readFileSync(MANIFEST, 'utf8')); }
  catch (e) { return { fresh: false, reason: 'unreadable .render-manifest.json: ' + e.message }; }

  if (man.plugin !== pluginDir) {
    return { fresh: false, reason: `snapshots were rendered from "${man.plugin}", not "${pluginDir}"` };
  }
  if (man.combined !== fp.combined) {
    const moved = Object.keys(fp.parts).filter((k) => man.parts[k] !== fp.parts[k]);
    return { fresh: false, reason: 'source changed since the render: ' + moved.join(', ') };
  }
  return { fresh: true, reason: `rendered from ${pluginDir} at ${man.stamped}` };
}

/**
 * Assert freshness from inside a test suite. Returns true when the caller may
 * trust its snapshots; prints a loud, actionable failure and returns false
 * otherwise.
 */
export function requireFresh(pluginDir, suite) {
  const r = checkFreshness(pluginDir);
  if (!r.fresh) {
    console.log(`FAIL  ${suite}: snapshots cannot be trusted -> ${r.reason}`);
  }
  return r.fresh;
}

const isMain = process.argv[1] && path.resolve(process.argv[1]) === path.resolve(fileURLToPath(import.meta.url));
if (isMain) {
  const i = process.argv.indexOf('--plugin');
  const plugin = i !== -1 && process.argv[i + 1] ? process.argv[i + 1] : 'synapse-conversion-tracking v2.0.3';
  if (process.argv.includes('--stamp')) {
    const fp = fingerprint(plugin);
    fs.writeFileSync(MANIFEST, JSON.stringify({
      plugin, stamped: new Date().toISOString(), combined: fp.combined, parts: fp.parts,
    }, null, 2) + '\n');
    console.log(`  OK  stamped .render-manifest.json for ${plugin}`);
  } else {
    const r = checkFreshness(plugin);
    console.log(r.fresh ? `  OK  snapshots are current (${r.reason})` : `  STALE  ${r.reason}`);
    process.exit(r.fresh ? 0 : 1);
  }
}
