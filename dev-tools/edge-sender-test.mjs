// Edge-served Data Tag sender (v1.6.2) - functional tests over the EXACT
// rendered boot JS + rescue-only output.
// Run render-ga4fb.php first (produces edge-boot.js / edge-rescue.js).
//
// Edge-sender mode moves the ~23 KB vendored sender out of the inline head and
// onto the edge worker. The container loader is gated behind the sender's load
// by get_edge_sender_boot_js():
//   - sender loads   -> set gtm_dataTagScriptLoadedCache seed, THEN boot loader
//   - sender errors  -> boot loader WITHOUT the seed (Data Tag self-injects)
//   - neither (hang) -> a 3s timeout boots the loader anyway
// and the container is booted exactly once. get_data_rescue_js() drops the
// inline sender+seed in this mode and ships only the rescue wrappers.
import vm from 'node:vm';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { requireFresh } from './snapshot-freshness.mjs';

const dir = path.dirname(fileURLToPath(import.meta.url));

// This suite reads snapshots rendered from the PHP by render-ga4fb.php /
// render-boot.mjs. A snapshot cannot report that it has gone stale, so refuse
// to claim coverage the files cannot back - see snapshot-freshness.mjs.
const __pluginIdx = process.argv.indexOf('--plugin');
const PLUGIN_DIR = __pluginIdx !== -1 && process.argv[__pluginIdx + 1]
  ? process.argv[__pluginIdx + 1]
  : 'synapse-conversion-tracking v2.0.2';
const __fresh = requireFresh(PLUGIN_DIR, path.basename(fileURLToPath(import.meta.url)));
const boot = fs.readFileSync(path.join(dir, 'edge-boot.js'), 'utf8');
const rescueOnly = fs.readFileSync(path.join(dir, 'edge-rescue.js'), 'utf8');

const SENDER_URL = 'https://lamore-bg.com/lmr/s.js';
const SEED_KEY = 'https://stapecdn.com/dtag/v9.js';

// A DOM/window double that records script creation, insertion, dataLayer pushes
// and the deferred setTimeout callback so each branch can be driven by hand.
function makeEnv() {
  const scripts = [];   // every createElement('script') result, in order
  const inserted = [];  // scripts actually inserted into the "DOM"
  const timeouts = [];  // [callback, ms] captured from setTimeout

  const parent = { insertBefore: (node) => { inserted.push(node); } };
  const firstScript = { parentNode: parent };

  const d = {
    createElement: () => {
      const el = { tagName: 'SCRIPT', async: undefined, src: '', onload: null, onerror: null };
      scripts.push(el);
      return el;
    },
    getElementsByTagName: (t) => (t === 'script' ? [firstScript] : []),
    head: { appendChild: (node) => { inserted.push(node); } },
    documentElement: { appendChild: (node) => { inserted.push(node); } },
  };

  const w = {
    document: d,
    dataLayer: undefined,
    atob: (s) => Buffer.from(s, 'base64').toString('binary'),
    setTimeout: (fn, ms) => { timeouts.push([fn, ms]); return timeouts.length; },
  };

  const sandbox = { window: w, document: d };
  vm.createContext(sandbox);

  return {
    w, d, scripts, inserted, timeouts, sandbox,
    run: (code) => vm.runInContext(code, sandbox),
    senderScript: () => scripts.find((s) => String(s.src).replace(/\\\//g, '/') === SENDER_URL),
    loaderBooted: () => Array.isArray(w.dataLayer) && w.dataLayer.some((e) => e && e.event === 'gtm.js'),
    containerInjected: () => inserted.some((s) => String(s.src).indexOf('bca96fbh8l.js') !== -1),
    seedSet: () => !!(w.gtm_dataTagScriptLoadedCache && w.gtm_dataTagScriptLoadedCache[SEED_KEY] === true),
  };
}

let pass = 0, fail = 0;
const queue = [];
function T(name, fn) { queue.push({ name, fn }); }
function eq(a, b, what) { if (a !== b) throw new Error(`${what}: ${JSON.stringify(a)} !== ${JSON.stringify(b)}`); }
function ok(c, what) { if (!c) throw new Error(what); }
function has(s, sub, what) { if (!s.includes(sub)) throw new Error(`${what}: missing "${sub}"`); }
function not(s, sub, what) { if (s.includes(sub)) throw new Error(`${what}: unexpected "${sub}"`); }

// E1 - on load: sender script injected first, container gated until it loads.
T('E1 sender injected, loader gated until sender onload', (env) => {
  env.run(boot);
  const s = env.senderScript();
  ok(s, 'sender script created with the s.js URL');
  eq(s.async, true, 'sender async');
  ok(typeof s.onload === 'function', 'onload handler set');
  ok(typeof s.onerror === 'function', 'onerror handler set');
  eq(env.loaderBooted(), false, 'loader NOT booted before sender load');
  eq(env.seedSet(), false, 'seed NOT set before sender load');
  s.onload();
  eq(env.seedSet(), true, 'seed set on sender load');
  eq(env.loaderBooted(), true, 'loader booted after sender load');
  eq(env.containerInjected(), true, 'container script injected');
});

// E2 - on error: loader still boots, but WITHOUT the seed (graceful degrade).
T('E2 sender onerror -> loader boots without seed', (env) => {
  env.run(boot);
  env.senderScript().onerror();
  eq(env.loaderBooted(), true, 'loader booted on sender error');
  eq(env.seedSet(), false, 'seed NOT set on error (Data Tag self-injects)');
});

// E3 - hang: the 3s timeout boots the loader anyway.
T('E3 no load/error -> timeout boots loader', (env) => {
  env.run(boot);
  eq(env.loaderBooted(), false, 'not booted yet');
  const [fn, ms] = env.timeouts[0];
  eq(ms, 3000, 'timeout is 3s');
  fn();
  eq(env.loaderBooted(), true, 'loader booted by timeout');
});

// E4 - boot exactly once across timeout THEN a late load.
T('E4 loader boots exactly once (timeout then late onload)', (env) => {
  env.run(boot);
  env.timeouts[0][0]();       // timeout fires first
  const beforeLen = env.w.dataLayer.length;
  env.senderScript().onload(); // sender arrives late
  eq(env.w.dataLayer.length, beforeLen, 'no second gtm.js push');
  eq(env.seedSet(), true, 'late load still sets the seed (helps later events)');
});

// E5 - boot exactly once across onload THEN timeout.
T('E5 loader boots exactly once (onload then timeout)', (env) => {
  env.run(boot);
  env.senderScript().onload();
  const beforeLen = env.w.dataLayer.length;
  env.timeouts[0][0]();
  eq(env.w.dataLayer.length, beforeLen, 'timeout after boot is a no-op');
});

// E6 - rescue-only output carries NO inline sender/seed, keeps the wrappers.
T('E6 edge get_data_rescue_js is rescue-only (no vendored sender, no seed)', () => {
  not(rescueOnly, 'function dataTagSendData', 'no vendored sender inlined');
  not(rescueOnly, 'function dataTagMD5', 'no vendored MD5 inlined');
  not(rescueOnly, 'gtm_dataTagScriptLoadedCache', 'no inline seed');
  has(rescueOnly, '__synDataRescue', 'rescue wrappers present');
  has(rescueOnly, '_synr=1', 'rescue marker present');
  ok(rescueOnly.length < 3000, `rescue-only stays small (${rescueOnly.length} B)`);
});

// E7 - the boot hides the third-party brand string; the seed key is base64-
// decoded at runtime (E1 proves the decoded key lands in the cache).
T('E7 boot hides the brand string, seeds via base64', () => {
  not(boot, 'stapecdn.com', 'third-party brand string hidden from source');
  has(boot, 'aHR0cHM6Ly9zdGFwZWNkbi5jb20vZHRhZy92OS5qcw==', 'seed key present base64-encoded');
  has(boot.replace(/\\\//g, '/'), SENDER_URL, 'sender URL present');
  has(boot, 'w.setTimeout(go,3000)', 'timeout fallback present');
});

for (const { name, fn } of queue) {
  const env = makeEnv();
  try {
    fn(env);
    pass++;
    console.log('  OK  ' + name);
  } catch (e) {
    fail++;
    console.log('FAIL  ' + name + ' -> ' + e.message);
  }
}
console.log(`\n${pass}/${pass + fail} passed`);
process.exit((fail || !__fresh) ? 1 : 0);
