// Tests for the Click ID Restorer and its rescue marker (v1.7.4).
//
// The script under test is not written here - it is rendered by the real PHP
// class through dev-tools/render-clickid.php and then executed in a VM against
// a fake window/history. So a change to the plugin that breaks a claim below
// fails here, and a test that quietly stops exercising the plugin cannot pass.
//
// The question these answer: does the marker appear exactly on the landings
// that were rescued, never on the ones that were not, and does it still exist
// by the time the request reaches the server log - where the page URL arrives
// percent-encoded inside the hit's "dl" parameter.
//
// Usage:
//   node dev-tools/clickid-restorer-test.mjs [--php "<php.exe>"] [--plugin "<folder>"]

import fs from 'node:fs';
import path from 'node:path';
import vm from 'node:vm';
import { execFileSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';

const dir = path.dirname(fileURLToPath(import.meta.url));

// This suite renders its subject through the real PHP class, so it needs a PHP
// binary. Say so and stop, rather than dying on spawnSync ENOENT halfway
// through a run and looking like a broken test.
try {
  execFileSync('php', ['-v'], { stdio: 'ignore' });
} catch (e) {
  console.log('  SKIP  clickid-restorer-test: no php on this machine.');
  console.log('        It renders the restorer through render-clickid.php; install PHP to run it.');
  process.exit(0);
}
const arg = (flag, dflt) => {
  const i = process.argv.indexOf(flag);
  return i !== -1 && process.argv[i + 1] ? process.argv[i + 1] : dflt;
};

const PLUGIN = arg('--plugin', 'synapse-conversion-tracking v1.7.4');
const PHP = arg('--php', 'php');
const CONTROL = arg('--control', 'synapse-conversion-tracking v1.7.3');

let pass = 0;
let fail = 0;
const ok = (name, cond, extra) => {
  if (cond) { pass++; console.log(`  ok   ${name}`); }
  else { fail++; console.log(`  FAIL ${name}${extra ? `\n       ${extra}` : ''}`); }
};

// --- the script, straight out of the plugin -------------------------------

function render(plugin, google = 'backup', ms = '') {
  const out = execFileSync(PHP, ['-n', path.join(dir, 'render-clickid.php'), plugin, google, ms],
    { encoding: 'utf8' });
  const m = /<script>([\s\S]*)<\/script>/.exec(out);
  if (!m) { throw new Error(`no <script> in render of ${plugin} (${google})`); }
  return m[1];
}

// The marker the plugin declares. Read from the source, not typed in twice.
const restorerSrc = fs.readFileSync(
  path.join(dir, '..', PLUGIN, 'synapse-conversion-tracking', 'includes',
    'class-gtm-server-side-click-id-restorer.php'), 'utf8');
const MARKER = /const MARKER\s*=\s*'([^']+)'/.exec(restorerSrc)?.[1];

// --- harness --------------------------------------------------------------

const ORIGIN = 'https://lamore-bg.com';

function run(script, href) {
  let url = null;
  let calls = 0;
  const ctx = {
    URL, URLSearchParams,
    window: { location: { href } },
    history: {
      state: { wp: 1 },
      replaceState(state, title, next) { calls++; url = next; },
    },
  };
  vm.createContext(ctx);
  vm.runInContext(script, ctx);
  // No replaceState means the script left the URL exactly as it found it.
  return { calls, href: calls ? ORIGIN + url : href };
}

const CID = 'CjwKCAjwvsvTBhBaEiwAmf-3npVjRbzTDZKXvU-1Be2wboRuLwH9S44pmLnE9D-yP3stLg8J31Big';
const q = (href) => new URL(href).searchParams;

// --- 1. the two landings that matter --------------------------------------

console.log('\nclickid-restorer-test');
console.log(`  plugin  ${PLUGIN}`);
console.log(`  marker  ${MARKER}\n`);

const S = render(PLUGIN);

ok('marker constant is declared', !!MARKER);

{
  // Chrome: Google's auto-tagging gclid arrived intact, the Final URL suffix
  // rode along unused. Nothing to restore.
  const r = run(S, `${ORIGIN}/kontakti/?backup=${CID}&gad_source=1&gclid=${CID}`);
  ok('healthy landing: no history write at all', r.calls === 0, `calls=${r.calls}`);
  ok('healthy landing: backup left where it was', q(r.href).get('backup') === CID);
  ok('healthy landing: NOT marked', !q(r.href).has(MARKER));
}

{
  // Safari ITP / Brave: gclid stripped, the unknown backup parameter survived.
  const r = run(S, `${ORIGIN}/kontakti/?backup=${CID}&gad_source=1`);
  ok('rescued landing: exactly one history write', r.calls === 1, `calls=${r.calls}`);
  ok('rescued landing: gclid restored', q(r.href).get('gclid') === CID);
  ok('rescued landing: backup consumed', !q(r.href).has('backup'));
  ok('rescued landing: marked', q(r.href).get(MARKER) === '1');
  ok('rescued landing: unrelated params kept', q(r.href).get('gad_source') === '1');
}

{
  const r = run(S, `${ORIGIN}/kontakti/`);
  ok('organic visit: untouched', r.calls === 0 && !q(r.href).has(MARKER));
}

{
  const r = run(S, `${ORIGIN}/kontakti/?gclid=${CID}`);
  ok('gclid without backup: untouched', r.calls === 0 && !q(r.href).has(MARKER));
}

{
  // An empty value is not a click ID; q.get() returns "" which is falsy.
  const r = run(S, `${ORIGIN}/kontakti/?backup=`);
  ok('empty backup: no restore, no marker', r.calls === 0 && !q(r.href).has(MARKER));
}

// --- 2. the marker does not depend on the site's chosen name --------------

{
  const S2 = render(PLUGIN, 'saved');
  const r = run(S2, `${ORIGIN}/p/?saved=${CID}`);
  ok('another site names it "saved": still restores', q(r.href).get('gclid') === CID);
  ok('another site names it "saved": same marker', q(r.href).get(MARKER) === '1');

  const r2 = run(S2, `${ORIGIN}/p/?backup=${CID}`);
  ok('"saved" site ignores a stray backup param', r2.calls === 0);
}

{
  const S3 = render(PLUGIN, 'backup', 'bmsclkid');
  const r = run(S3, `${ORIGIN}/p/?bmsclkid=ABC123`);
  ok('microsoft: msclkid restored', q(r.href).get('msclkid') === 'ABC123');
  ok('microsoft: marked', q(r.href).get(MARKER) === '1');

  const both = run(S3, `${ORIGIN}/p/?backup=${CID}&bmsclkid=ABC123`);
  ok('both platforms stripped: still one history write', both.calls === 1, `calls=${both.calls}`);
  ok('both platforms stripped: both restored', q(both.href).get('gclid') === CID &&
    q(both.href).get('msclkid') === 'ABC123');
  ok('both platforms stripped: marker written once',
    (both.href.match(new RegExp(MARKER, 'g')) || []).length === 1);
}

// --- 3. shape of the URL the visitor is left with --------------------------

{
  const r = run(S, `${ORIGIN}/p/?utm_source=fb&backup=${CID}&page=2#reviews`);
  ok('hash preserved', r.href.endsWith('#reviews'), r.href);
  ok('other query params preserved',
    q(r.href).get('utm_source') === 'fb' && q(r.href).get('page') === '2');
}

{
  // A visitor who lands on an already-marked URL (shared link) and is stripped
  // must not accumulate markers.
  const r = run(S, `${ORIGIN}/p/?${MARKER}=1&backup=${CID}`);
  ok('pre-existing marker is not duplicated',
    (r.href.match(new RegExp(MARKER, 'g')) || []).length === 1, r.href);
}

// --- 4. the marker survives the trip to the request log -------------------
//
// This is the property the whole design rests on. The page URL reaches the
// server only inside the tracking hit's "dl" parameter, percent-encoded there:
// "?" becomes %3F, "&" becomes %26 and "=" becomes %3D, while unreserved
// characters - letters, digits, "_" - are written literally. So a marker that
// is a bare parameter NAME survives the encoding and one that includes "=" in
// the token does not.

const dl = (href) => `/g/collect?v=2&tid=G-X&dl=${encodeURIComponent(href)}&en=page_view`;

{
  const rescued = run(S, `${ORIGIN}/kontakti/?backup=${CID}`).href;
  const healthy = run(S, `${ORIGIN}/kontakti/?backup=${CID}&gclid=${CID}`).href;

  ok('marker token carries no "="', !MARKER.includes('='));
  ok('marker is literal inside the encoded dl parameter', dl(rescued).includes(MARKER),
    dl(rescued).slice(0, 160));
  ok('a marker with "=" would NOT survive - the reason for the rule',
    !dl(rescued).includes('_synr=2') && dl(rescued).includes('_syncid%3D1'));

  // The panel builds one alternation out of RESCUE_MARKERS and substring-matches
  // it against the logged request line. Same construction here.
  const esc = (s) => s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  const RESCUE = new RegExp(['synapse_recovered', '_synr=1', MARKER].map(esc).join('|'), 'i');

  ok('panel matcher counts the rescued hit', RESCUE.test(dl(rescued)));
  ok('panel matcher ignores the healthy hit', !RESCUE.test(dl(healthy)), dl(healthy).slice(0, 160));
  ok('marker is distinct from the other two rescue markers',
    MARKER !== 'synapse_recovered' && !'_synr=1'.includes(MARKER) && !MARKER.includes('_synr'));
}

// --- 5. control: the previous version must fail the marker claims ----------
//
// Without this the suite could pass on a plugin that never learned to mark.

if (fs.existsSync(path.join(dir, '..', CONTROL))) {
  const C = render(CONTROL);
  const r = run(C, `${ORIGIN}/kontakti/?backup=${CID}`);
  ok(`control ${CONTROL}: restores`, q(r.href).get('gclid') === CID);
  ok(`control ${CONTROL}: does NOT mark (proves the test bites)`, !q(r.href).has(MARKER));
} else {
  console.log(`  --   control ${CONTROL} not on disk, skipped`);
}

console.log(`\n${fail ? 'FAIL' : 'PASS'}  ${pass}/${pass + fail}\n`);
process.exit(fail ? 1 : 0);
