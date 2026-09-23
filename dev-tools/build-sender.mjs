// Builds assets/s.js = vendored sender core + ";" + tail.js
//
// The core (data-tag-sender.js) stays byte-for-byte the upstream file - it is
// the md5 anchor that template-drift-check.mjs pins, and it is what inline
// (non-edge) mode still ships. The tail is our own code. Concatenating them
// into a single first-party file means the browser makes ONE request for
// everything the container needs, and the edge worker just proxies a static
// origin asset instead of carrying a 31 KB base64 blob in its source.
//
// The ";" between them is insurance, not a requirement today: the core's last
// byte is the "}" of a function declaration, which terminates without ASI, so
// the current two files happen to concatenate cleanly on their own (verified -
// both forms parse). It matters the day the core ends in an expression instead
// - a re-minified upstream drop, say - where a bare join would silently fuse
// the last statement of one file into the first of the other. The cost is two
// bytes; the failure it prevents would surface only in the browser.
//
// Usage:  node dev-tools/build-sender.mjs [--check] [--plugin "<folder>"]
//   default  : writes assets/s.js in the current plugin folder (PLUGIN_DIR)
//   --check  : verifies the committed s.js matches a fresh build (CI-style),
//              exit 1 on mismatch, writes nothing
//   --plugin : version folder to build, e.g. "synapse-conversion-tracking v1.7.1"
//              - lets an older release be re-checked without editing this file
import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import { fileURLToPath } from 'node:url';

const dir = path.dirname(fileURLToPath(import.meta.url));
const PLUGIN_DIR = 'synapse-conversion-tracking v2.0.3';
const argIdx = process.argv.indexOf('--plugin');
const version = argIdx !== -1 && process.argv[argIdx + 1] ? process.argv[argIdx + 1] : PLUGIN_DIR;
const PLUGIN = path.join(dir, '..', version, 'synapse-conversion-tracking');
const ASSETS = path.join(PLUGIN, 'assets');

const CORE = path.join(ASSETS, 'data-tag-sender.js');
const TAIL = path.join(ASSETS, 'tail.js');
const OUT = path.join(ASSETS, 's.js');

// md5 of the upstream vendored sender as shipped in v1.6.2 .. v1.6.4.
// If this changes, the sender core was edited - which is exactly what must not
// happen silently, because the Data Tag template calls into it by signature.
const CORE_MD5 = '48dbff711a327d387d9fdfc3e472a1a9';

const check = process.argv.includes('--check');

const core = fs.readFileSync(CORE);
const tail = fs.readFileSync(TAIL);

const coreMd5 = crypto.createHash('md5').update(core).digest('hex');
if (coreMd5 !== CORE_MD5) {
  console.error(`FAIL  sender core changed: ${coreMd5} != ${CORE_MD5}`);
  console.error('      data-tag-sender.js must stay byte-identical to upstream.');
  process.exit(1);
}

// Guard the two properties the concatenation depends on.
if (/\bstapecdn\b/i.test(tail.toString('utf8'))) {
  console.error('FAIL  tail.js contains the third-party brand string in clear text');
  process.exit(1);
}
if (!/function dataTagSendData\(/.test(core.toString('utf8'))) {
  console.error('FAIL  sender core is missing dataTagSendData');
  process.exit(1);
}

const built = Buffer.concat([core, Buffer.from(';\n', 'utf8'), tail]);
const sha = crypto.createHash('sha256').update(built).digest('hex');

if (check) {
  if (!fs.existsSync(OUT)) {
    console.error('FAIL  assets/s.js does not exist - run without --check first');
    process.exit(1);
  }
  const have = fs.readFileSync(OUT);
  if (!have.equals(built)) {
    console.error(`FAIL  assets/s.js is stale (${have.length} B on disk, ${built.length} B rebuilt)`);
    console.error('      run: node dev-tools/build-sender.mjs');
    process.exit(1);
  }
  console.log(`  OK  assets/s.js is up to date (${built.length} B, sha256 ${sha.slice(0, 8)})`);
  process.exit(0);
}

fs.writeFileSync(OUT, built);
console.log(`built assets/s.js`);
console.log(`  core   ${core.length} B  (md5 ${coreMd5})`);
console.log(`  tail   ${tail.length} B`);
console.log(`  total  ${built.length} B`);
console.log(`  sha256 ${sha}`);
console.log(`  ?v=    ${sha.slice(0, 8)}   <- cache-busting token the plugin appends`);
