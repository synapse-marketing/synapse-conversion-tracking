// Edge-served Data Tag sender, v1.7.0 - functional tests over the EXACT
// rendered inline pieces and the real assets/tail.js.
//
// Run `node dev-tools/render-boot.mjs` first (produces edge-boot17.js and
// edge-sentinel17.js straight from the PHP source).
//
// v1.7.0 splits what used to be one inline block into three parts:
//   inline : ad-blocker shim, __synCfg, the /g/collect sentinel, the loader
//   edge   : assets/s.js = vendored core + assets/tail.js (seed, signature
//            tripwire, injection detector, transport rescue, GA4 watchdog)
// so these tests have to prove two things the old suite did not have to:
// that the boot still boots the container under every load outcome, and that
// the code which moved out of the page still behaves exactly as it did in it.
//
// The v1.6.4 suite (edge-sender-test.mjs) stays as-is and still passes against
// the v1.6.4 render - the old version has to remain a working fallback.
import vm from 'node:vm';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { execFileSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { instrument, runMatrix } from './identity-matrix.mjs';

const dir = path.dirname(fileURLToPath(import.meta.url));
const plugArg = process.argv.indexOf('--plugin');
const PLUGIN = path.join(dir, '..', plugArg !== -1 && process.argv[plugArg + 1] ? process.argv[plugArg + 1] : 'synapse-conversion-tracking v2.0.3', 'synapse-conversion-tracking');

// The head is rendered here rather than read from the checked-in fixture, so
// --plugin switches the head and the sender together. Reading the fixture
// meant a fixture rendered from one version could be run against another
// version's tail - which is a real skew scenario, but not the one the suite
// below is asserting (cfg-encoding-durability.mjs tests that on purpose).
const rendered = fs.mkdtempSync(path.join(os.tmpdir(), 'syn-boot-'));
execFileSync(process.execPath, [path.join(dir, 'render-boot.mjs'), '--plugin', plugArg !== -1 && process.argv[plugArg + 1] ? process.argv[plugArg + 1] : 'synapse-conversion-tracking v2.0.3', '--out', rendered], { stdio: 'pipe' });
const boot = fs.readFileSync(path.join(rendered, 'edge-boot17.js'), 'utf8');
const sentinel = fs.readFileSync(path.join(rendered, 'edge-sentinel17.js'), 'utf8');
fs.rmSync(rendered, { recursive: true, force: true });
const tail = fs.readFileSync(path.join(PLUGIN, 'assets', 'tail.js'), 'utf8');
const built = fs.readFileSync(path.join(PLUGIN, 'assets', 's.js'), 'utf8');

const ORIGIN = 'https://lamore-bg.com';
const SENDER_URL = ORIGIN + '/lmr/s.js';
const SEED_PREFIX = 'https://stapecdn.com/dtag/';

// ---------------------------------------------------------------------------
// A window/document double rich enough to actually run the tail: script
// injection, timers, fetch/beacon/XHR, Image pixels, session storage, URL.
// Every side effect is recorded so a test can assert on it.
// ---------------------------------------------------------------------------
function makeEnv(opts) {
  opts = opts || {};

  const scripts = [];    // every createElement('script'), in order
  const inserted = [];   // scripts actually inserted
  const timeouts = [];   // [fn, ms]
  const intervals = [];  // [fn, ms]
  const images = [];     // every Image whose src was set
  const fetched = [];    // [url, init] reaching the base fetch
  const beacons = [];    // [url, data] reaching the base sendBeacon
  const xhrSent = [];    // [method, url, body] reaching the base XHR

  let fetchResult = () => Promise.resolve({ ok: true });
  let beaconResult = () => true;

  const parent = { insertBefore: (node) => { inserted.push(node); } };
  const firstScript = { parentNode: parent };

  const d = {
    title: 'Test page',
    referrer: '',
    cookie: opts.cookie || '',
    scripts: [],
    createElement: () => {
      const el = { tagName: 'SCRIPT', async: undefined, src: '', onload: null, onerror: null };
      scripts.push(el);
      return el;
    },
    getElementsByTagName: (t) => (t === 'script' ? [firstScript] : []),
    head: { appendChild: (node) => { inserted.push(node); } },
    documentElement: { appendChild: (node) => { inserted.push(node); } },
  };

  function FakeImage() { const self = { _img: true }; images.push(self); return self; }

  function FakeXHR() {
    this._listeners = {};
    this.addEventListener = (ev, fn) => { (this._listeners[ev] = this._listeners[ev] || []).push(fn); };
    this.dispatch = (ev) => { (this._listeners[ev] || []).forEach((fn) => fn()); };
  }
  FakeXHR.prototype.open = function (m, u) { this._m = m; this._u = u; };
  FakeXHR.prototype.send = function (b) { xhrSent.push([this._m, this._u, b]); };

  const store = {};

  const w = {
    document: d,
    dataLayer: undefined,
    URL,
    location: { origin: ORIGIN, href: ORIGIN + '/product/x' },
    screen: { width: 1280, height: 800 },
    Image: FakeImage,
    XMLHttpRequest: FakeXHR,
    atob: (s) => Buffer.from(s, 'base64').toString('binary'),
    btoa: (s) => Buffer.from(s, 'binary').toString('base64'),
    navigator: {
      language: 'bg-BG',
      sendBeacon: (u, data) => { beacons.push([String(u), data]); return beaconResult(); },
    },
    sessionStorage: {
      getItem: (k) => (k in store ? store[k] : null),
      setItem: (k, v) => { store[k] = String(v); },
    },
    setTimeout: (fn, ms) => { timeouts.push([fn, ms]); return timeouts.length; },
    setInterval: (fn, ms) => { intervals.push([fn, ms]); return intervals.length; },
    clearInterval: (id) => { if (intervals[id - 1]) { intervals[id - 1][2] = 'cleared'; } },
    addEventListener: (ev, fn) => { (w._on = w._on || {})[ev] = fn; },
  };

  // Storage that is not simply present and working. Both shapes are real:
  // "blocked" is a browser that throws SecurityError on the property itself
  // when site data is disallowed, "lying" is a storage object that accepts a
  // write and keeps nothing - which is why !!sessionStorage never proved that
  // an identity had actually been persisted.
  // A CMP wired through GTM's own consent templates never writes consent
  // entries into the dataLayer; GTM resolves them into google_tag_data.ics.
  // opts.ics is {type: 1|2} (granted|denied) and becomes an update entry;
  // opts.icsEntries is the raw entries table, for shapes seen on live sites.
  if (opts.ics) {
    const entries = {};
    for (const k of Object.keys(opts.ics)) { entries[k] = { update: opts.ics[k] === 1 }; }
    w.google_tag_data = { ics: { entries } };
  } else if (opts.icsEntries) {
    w.google_tag_data = { ics: { entries: opts.icsEntries } };
  }

  // The identity matrix installs its own counted storage and cookie jar.
  let reads = null;
  if (opts.identity) { reads = instrument(w, d, opts.identity.mode, opts.identity.cookie); }

  if (opts.storage === 'blocked') {
    delete w.sessionStorage;
    Object.defineProperty(w, 'sessionStorage', {
      configurable: true,
      get() { throw new Error('SecurityError'); },
    });
  } else if (opts.storage === 'lying') {
    w.sessionStorage = { getItem: () => null, setItem: () => {} };
  }

  if (opts.fetch !== false) {
    w.fetch = function (i, init) { fetched.push([typeof i === 'string' ? i : (i && i.url), init]); return fetchResult(); };
  }

  const sandbox = { window: w, document: d, URL };
  vm.createContext(sandbox);

  const api = {
    w, d, scripts, inserted, timeouts, intervals, images, fetched, beacons, xhrSent, reads,
    run: (code) => vm.runInContext(code, sandbox),
    setFetchResult: (fn) => { fetchResult = fn; },
    setBeaconResult: (fn) => { beaconResult = fn; },
    byUrl: (u) => scripts.find((s) => norm(s.src) === u || norm(s.src).split('?')[0] === u),
    senderScript: () => api.byUrl(SENDER_URL),
    fallbackScript: () => scripts.find((s) => norm(s.src).indexOf('/wp-content/plugins/') !== -1 && norm(s.src).indexOf('/s.js') !== -1),
    // 2.0.1: every fallback attempt, in order (the plugin copy, then the same with an hourly "&r=")
    fallbackScripts: () => scripts.filter((s) => norm(s.src).indexOf('/wp-content/plugins/') !== -1 && norm(s.src).indexOf('/s.js') !== -1),
    tailScript: () => scripts.find((s) => norm(s.src).indexOf('/tail.js') !== -1),
    loaderBooted: () => Array.isArray(w.dataLayer) && w.dataLayer.some((e) => e && e.event === 'gtm.js'),
    containerInjected: () => inserted.some((s) => String(s.src).indexOf('bca96fbh8l.js') !== -1),
    seeded: (v) => !!(w.gtm_dataTagScriptLoadedCache && w.gtm_dataTagScriptLoadedCache[SEED_PREFIX + 'v' + v + '.js'] === true),
    signals: () => images.map((i) => String(i.src || '')).filter((s) => s.indexOf('_syng=1') !== -1),
    rescues: () => images.map((i) => String(i.src || '')).filter((s) => s.indexOf('_synr=1') !== -1),
    // Pretend the edge sender arrived: define the two globals the core exports,
    // then optionally run the real tail on top (which is what s.js does).
    landSender: (withTail, core) => {
      w.dataTagSendData = core || function () { w.__lastSend = Array.prototype.slice.call(arguments); };
      w.dataTagGetData = function () { return {}; };
      if (withTail) { api.run(tail); }
    },
  };
  return api;
}

const norm = (s) => String(s).replace(/\\\//g, '/');

let pass = 0, fail = 0;
const queue = [];
function T(name, fn, opts) { queue.push({ name, fn, opts }); }
function eq(a, b, what) { if (a !== b) throw new Error(`${what}: ${JSON.stringify(a)} !== ${JSON.stringify(b)}`); }
function ok(c, what) { if (!c) throw new Error(what); }
function has(s, sub, what) { if (!s.includes(sub)) throw new Error(`${what}: missing "${sub}"`); }
function not(s, sub, what) { if (s.includes(sub)) throw new Error(`${what}: unexpected "${sub}"`); }
const tick = () => new Promise((r) => setImmediate(r));

/* ===========================================================================
 * Boot - the inline half. Every path must end with the container running.
 * ======================================================================== */

// E1 - happy path: sender first, container gated behind it.
T('E1 sender injected, container gated until the sender lands', (env) => {
  env.run(boot);
  const s = env.senderScript();
  ok(s, 'sender script created with the s.js URL');
  eq(s.async, true, 'sender async');
  ok(typeof s.onload === 'function', 'onload handler set');
  ok(typeof s.onerror === 'function', 'onerror handler set');
  eq(env.loaderBooted(), false, 'container NOT booted before the sender lands');
  env.landSender(true);
  s.onload();
  eq(env.loaderBooted(), true, 'container booted after the sender lands');
  eq(env.containerInjected(), true, 'container script injected');
});

// E2 - edge fails, origin fallback succeeds. This is the new second chance:
// v1.6.4 gave up here and let the Data Tag self-inject from the blocked CDN.
T('E2 edge error -> origin fallback loads, container boots WITH the tail', (env) => {
  env.run(boot);
  env.senderScript().onerror();
  const fb = env.fallbackScript();
  ok(fb, 'fallback script requested from the plugin folder');
  ok(/[?&]fb=1(&|$)/.test(norm(fb.src)), 'fallback carries its own marker, never the address the worker fetches (2.0.1)');
  eq(env.loaderBooted(), false, 'container still gated while the fallback loads');
  env.landSender(true);
  fb.onload();
  eq(env.loaderBooted(), true, 'container booted after the fallback lands');
  eq(env.seeded(9), true, 'seed set - the blocked injection is still avoided');
});

// E3 - every source fails: boot anyway, unseeded (pre-edge-sender behaviour).
// 2.0.1: the fallback gets a second, cache-busted try before the page gives up.
T('E3 all sources fail -> container boots without the seed', (env) => {
  env.run(boot);
  env.senderScript().onerror();
  env.fallbackScript().onerror();
  eq(env.loaderBooted(), false, 'still gated: the fallback is tried once more');
  const [, second] = env.fallbackScripts();
  ok(second, 'second fallback requested');
  second.onerror();
  eq(env.loaderBooted(), true, 'container booted despite no sender');
  eq(env.seeded(9), false, 'no seed without a sender (Data Tag self-injects)');
  eq(env.fallbackScripts().length, 2, 'exactly two fallback attempts, never a third');
});

// E3b - a stored error on the fallback address: the cache-busted retry recovers it.
T('E3b fallback returns a stored error -> cache-busted retry loads, boots WITH the seed', (env) => {
  env.run(boot);
  env.senderScript().onerror();
  env.fallbackScript().onerror();
  const [first, second] = env.fallbackScripts();
  const hour = Math.floor(Date.now() / 36e5);
  eq(norm(second.src), norm(first.src) + '&r=' + hour, 'retry = the fallback plus an hourly "&r="');
  env.landSender(true);
  second.onload();
  eq(env.loaderBooted(), true, 'container booted after the retry lands');
  eq(env.seeded(9), true, 'seed set - the blocked injection is avoided after all');
});

// E4 - hang: the 3s timeout boots the container regardless.
T('E4 no load/error -> 3s timeout boots the container', (env) => {
  env.run(boot);
  eq(env.loaderBooted(), false, 'not booted yet');
  const [fn, ms] = env.timeouts[0];
  eq(ms, 3000, 'timeout is 3s');
  fn();
  eq(env.loaderBooted(), true, 'container booted by the timeout');
});

// E5 - exactly once, timeout then a late load.
T('E5 container boots exactly once (timeout, then late onload)', (env) => {
  env.run(boot);
  env.timeouts[0][0]();
  const before = env.w.dataLayer.length;
  env.landSender(true);
  env.senderScript().onload();
  eq(env.w.dataLayer.length, before, 'no second gtm.js push');
  eq(env.seeded(9), true, 'a late sender still seeds - later events benefit');
});

// E6 - exactly once, load then timeout.
T('E6 container boots exactly once (onload, then timeout)', (env) => {
  env.run(boot);
  env.landSender(true);
  env.senderScript().onload();
  const before = env.w.dataLayer.length;
  env.timeouts[0][0]();
  eq(env.w.dataLayer.length, before, 'timeout after boot is a no-op');
});

// E7 - HTTP 200 with a body that is not the sender (a worker error page).
// onload fires, so only checking the global catches it.
T('E7 sender loads but defines nothing -> falls back, then boots', (env) => {
  env.run(boot);
  env.senderScript().onload();          // "loaded", but no dataTagSendData
  ok(env.fallbackScript(), 'fallback requested when the global is missing');
  eq(env.loaderBooted(), false, 'still gated');
  env.fallbackScript().onload();        // fallback is broken too
  eq(env.loaderBooted(), false, 'still gated: one cache-busted retry (2.0.1)');
  env.fallbackScripts()[1].onload();    // and so is the retry
  eq(env.loaderBooted(), true, 'container boots rather than waiting forever');
});

// E8 - old worker, new plugin: the sender has no tail, so pull it separately.
// This is what makes the deploy order irrelevant.
T('E8 core-only sender (old worker) -> tail pulled from origin, then boot', (env) => {
  env.run(boot);
  env.landSender(false);                // core lands, __synTail never set
  env.senderScript().onload();
  const tl = env.tailScript();
  ok(tl, 'tail.js requested from the plugin folder');
  eq(env.loaderBooted(), false, 'container gated until the tail lands');
  env.run(tail);
  tl.onload();
  eq(env.loaderBooted(), true, 'container booted after the tail');
  eq(env.seeded(9), true, 'seed recovered despite the old worker');
});

// E9 - and if that extra fetch also fails, still boot.
T('E9 tail fetch fails -> container still boots', (env) => {
  env.run(boot);
  env.landSender(false);
  env.senderScript().onload();
  env.tailScript().onerror();
  eq(env.loaderBooted(), true, 'container booted without the tail');
});

// E10 - re-entry guard: the head script running twice must not double-inject.
T('E10 boot is idempotent (guard blocks a second run)', (env) => {
  env.run(boot);
  env.run(boot);
  eq(env.scripts.length, 1, 'exactly one sender request');
});

// E11 - the config object carries every field the tail reads, and is emitted
// before the boot IIFE so it is set no matter when the tail arrives.
//
// Since 1.7.2 the two Google ids travel base64-encoded. The values the tail
// ends up with must be unchanged - that is what makes this camouflage and not
// a behaviour change - so this decodes them the same way the tail does and
// compares against the plain ids.
T('E11 __synCfg emitted first, with the fields the tail reads', (env) => {
  ok(boot.indexOf('window.__synCfg=') === 0, '__synCfg is the first statement');
  env.run(boot);
  const c = env.w.__synCfg;
  const dec = (v) => (v.indexOf('-') !== -1 ? v : Buffer.from(v, 'base64').toString('utf8'));
  eq(c.p, '/lmr', 'path prefix');
  eq(dec(c.t), 'G-SYYEZHP7BL', 'GA4 measurement id');
  eq(dec(c.c), 'GTM-NQHQHZLR', 'raw container id');
  eq(c.s, '_synapse', 'event suffix');
  eq(c.d, 1, 'rescue flag');
});

// E32 - the point of the encoding: from 1.7.2 on, no Google id is readable in
// the head. Gated on the plugin's own version so the suite can still be run
// against an older release with --plugin, where plain ids are correct.
T('E32 no readable Google id in the inline head (1.7.2+)', () => {
  const head = boot + sentinel;
  const ver = /Version:\s*([\d.]+)/.exec(fs.readFileSync(path.join(PLUGIN, 'synapse-conversion-tracking.php'), 'utf8'));
  ok(ver, 'plugin version readable');
  const num = ver[1].split('.').map(Number);
  const encodes = num[0] > 1 || (num[0] === 1 && (num[1] > 7 || (num[1] === 7 && num[2] >= 2)));

  if (!encodes) {
    has(head, 'G-SYYEZHP7BL', `pre-1.7.2 (${ver[1]}) carries the plain id, as it should`);
    return;
  }
  not(head, 'G-SYYEZHP7BL', 'measurement id not in clear text');
  not(head, 'GTM-NQHQHZLR', 'container id not in clear text');
  ok(!/\b(?:G|GTM|AW|DC|UA|MC|DT)-[A-Z0-9]{6,}/.test(head), 'no Google id shape anywhere in the head');
});

// E12 - the inline block no longer carries the moved code at all. This is the
// size win, asserted rather than eyeballed.
T('E12 inline boot carries no seed, no rescue, no watchdog, no brand string', () => {
  not(boot, 'stapecdn', 'brand string absent from the inline block');
  not(boot, 'gtm_dataTagScriptLoadedCache', 'seed no longer inline');
  not(boot, '__synDataRescue', 'rescue no longer inline');
  not(boot, 'synapse_recovered', 'watchdog no longer inline');
  ok(boot.length < 1600, `inline boot stays small (${boot.length} B)`);
});

/* ===========================================================================
 * Sentinel - the observing half of the watchdog, which must stay inline.
 * ======================================================================== */

// E13 - records the Google tag speaking, and forwards the call untouched.
T('E13 sentinel records /g/collect and forwards the request', async (env) => {
  env.run(sentinel);
  await env.w.fetch(ORIGIN + '/lmr/g/collect?v=2&tid=G-X');
  eq(env.w.__synSeen, 1, 'seen flag set');
  eq(env.fetched.length, 1, 'the real fetch still ran');
  eq(env.fetched[0][0], ORIGIN + '/lmr/g/collect?v=2&tid=G-X', 'URL untouched');
});

// E14 - beacon and XHR paths too, and nothing unrelated is recorded.
T('E14 sentinel covers beacon + XHR, ignores unrelated requests', (env) => {
  env.run(sentinel);
  env.w.navigator.sendBeacon(ORIGIN + '/lmr/g/collect?v=2', 'x');
  eq(env.w.__synSeen, 1, 'beacon path recorded');
  const env2 = makeEnv();
  env2.run(sentinel);
  const x = new env2.w.XMLHttpRequest();
  x.open('POST', ORIGIN + '/lmr/g/collect');
  // Since 1.7.5 an XHR counts at send(), not at open(): a request that is
  // opened and then abandoned never reached Google, and treating it as proof
  // of life suppressed a recovery that should have happened.
  eq(env2.w.__synSeen, undefined, 'open() alone is not proof of life');
  x.send('v=2');
  eq(env2.w.__synSeen, 1, 'XHR path recorded once sent');
  const env3 = makeEnv();
  env3.run(sentinel);
  env3.w.fetch('https://www.google-analytics.com/g/collect');
  env3.w.fetch(ORIGIN + '/lmr/data');
  eq(env3.w.__synSeen, undefined, 'cross-origin and non-collect ignored');
});

/* ===========================================================================
 * Tail - everything that moved out of the page.
 * ======================================================================== */

// E15 - the seed covers a range, so a template version bump does not silently
// fall back to the blocked CDN injection.
T('E15 tail seeds v9..v12 and sets the tail marker', (env) => {
  env.run(tail);
  for (let v = 9; v <= 12; v++) { eq(env.seeded(v), true, `v${v} seeded`); }
  eq(env.seeded(8), false, 'below the range not seeded');
  eq(env.seeded(13), false, 'above the range not seeded');
  eq(env.w.__synTail, 1, 'tail marker set');
});

// E16 - the brand string is never readable in the file.
T('E16 tail hides the brand string, decodes the seed key at runtime', () => {
  not(tail, 'stapecdn.com', 'brand string not in the tail source');
  not(built, 'stapecdn.com', 'brand string not in the built s.js');
  has(tail, 'aHR0cHM6Ly9zdGFwZWNkbi5jb20vZHRhZy8=', 'seed prefix present base64-encoded');
});

// E17 - the tripwire forwards a correct call and stays silent.
T('E17 tripwire: a correct 7-arg call is forwarded and silent', (env) => {
  env.run(boot);
  const calls = [];
  env.landSender(true, function () { calls.push(Array.prototype.slice.call(arguments)); });
  env.w.dataTagSendData({ ev: 1 }, 'https://lamore-bg.com/lmr', '/data', 'e', 'dl', true, true);
  eq(calls.length, 1, 'forwarded to the real sender');
  eq(calls[0][2], '/data', 'arguments untouched');
  eq(env.signals().length, 0, 'no signal on a healthy call');
  eq(env.w.dataTagSendData.length, 7, 'arity preserved for feature detection');
});

// E18 - a changed call shape signals ONCE and is still forwarded. This is the
// failure the user was most worried about: a template update that breaks the
// contract quietly. It must be loud, and it must not stop tracking.
T('E18 tripwire: a changed signature signals once, never blocks the call', (env) => {
  env.run(boot);
  const calls = [];
  env.landSender(true, function () { calls.push(Array.prototype.slice.call(arguments)); });
  env.w.dataTagSendData({ ev: 1 }, 'https://lamore-bg.com/lmr', '/data', 'e', 'dl', true, true, 'NEW');
  env.w.dataTagSendData({ ev: 2 }, 'https://lamore-bg.com/lmr', '/data', 'e', 'dl', true, true, 'NEW');
  eq(calls.length, 2, 'both calls still reached the real sender');
  const sigs = env.signals();
  eq(sigs.length, 1, 'exactly one signal per page, not one per call');
  has(sigs[0], '/lmr/_sg?k=send_sig', 'signal path and kind');
  has(sigs[0], 'n=8', 'signal carries the observed argument count');
});

// E19 - same guard on the other half of the contract.
T('E19 tripwire: dataTagGetData arity change signals, call still forwarded', (env) => {
  env.run(boot);
  let ran = 0;
  env.w.dataTagSendData = function () { };
  env.w.dataTagGetData = function () { ran++; return { a: 1 }; };
  env.run(tail);
  const r = env.w.dataTagGetData('GTM-X', 'evt');
  eq(ran, 1, 'real getter ran');
  eq(r.a, 1, 'return value passed through');
  eq(env.signals().length, 1, 'signalled');
  has(env.signals()[0], 'k=get_sig', 'correct signal kind');
});

// E20 - the injection detector: if the template ever injects the CDN script
// despite the seed, say so.
T('E20 detector reports a CDN injection it could not prevent', (env) => {
  env.run(boot);
  env.run(tail);
  env.d.scripts.push({ src: SEED_PREFIX + 'v14.js' });
  const polls = env.timeouts.filter(([, ms]) => ms === 2000 || ms === 5000 || ms === 10000 || ms === 30000);
  eq(polls.length, 4, 'four polls scheduled');
  polls[0][0]();
  polls[1][0]();
  const sigs = env.signals();
  eq(sigs.length, 1, 'reported once, not once per poll');
  has(sigs[0], 'k=cdn_inject', 'correct signal kind');
  has(sigs[0], 'n=v14.js', 'reports which version was injected');
});

// E30 - D4: the detector must also see the sender injected from a DIFFERENT
// CDN host. A host change would otherwise be invisible - the seed cannot cover
// an unknown URL, Brave-class browsers lose every POST-shaped event, and
// nothing would ever say so. The match is the "/dtag/" path shape, derived at
// runtime from the decoded prefix (no new literal in the file).
T('E30 detector reports a CDN injection from a changed host', (env) => {
  env.run(boot);
  env.run(tail);
  env.d.scripts.push({ src: 'https://cdn.example-new.com/dtag/v13.js' });
  const polls = env.timeouts.filter(([, ms]) => ms === 2000 || ms === 5000 || ms === 10000 || ms === 30000);
  eq(polls.length, 4, 'four polls scheduled');
  polls[0][0]();
  polls[1][0]();
  const sigs = env.signals();
  eq(sigs.length, 1, 'reported once, not once per poll');
  has(sigs[0], 'k=cdn_inject', 'correct signal kind');
  has(sigs[0], encodeURIComponent('https://cdn.example-new.com/dtag/'), 'note carries the foreign URL');
});

// E31 - and it stays precise: our own first-party copies, the container
// loader, and near-miss paths (no full "/dtag/" segment) never trip it.
T('E31 detector ignores first-party and unrelated scripts', (env) => {
  env.run(boot);
  env.run(tail);
  env.d.scripts.push({ src: ORIGIN + '/lmr/s.js?v=abc12345' });
  env.d.scripts.push({ src: ORIGIN + '/lmr/bca96fbh8l.js?x=1' });
  env.d.scripts.push({ src: 'https://cdn.example.com/dtagged/v9.js' });
  env.d.scripts.push({ src: 'https://cdn.example.com/assets/app.js' });
  const polls = env.timeouts.filter(([, ms]) => ms === 2000 || ms === 5000 || ms === 10000 || ms === 30000);
  for (const [fn] of polls) { fn(); }
  eq(env.signals().length, 0, 'no false positive from any of them');
});

// E21 - the rescue still fires from its new home, on a provable transit
// failure, as the Data Client's own GET pixel form.
T('E21 rescue: a failed POST to /data is resent as a dtdc pixel', async (env) => {
  env.run(boot);
  env.setFetchResult(() => Promise.reject(new Error('blocked')));
  env.landSender(true);
  env.w.fetch(ORIGIN + '/lmr/data?x=1', { method: 'POST', body: 'PAYLOAD' }).catch(() => { });
  await tick();
  const r = env.rescues();
  eq(r.length, 1, 'one rescue pixel');
  has(r[0], '/lmr/data?x=1&dtdc=', 'same path, dtdc appended');
  has(r[0], encodeURIComponent(Buffer.from('PAYLOAD').toString('base64')), 'payload base64-encoded');
});

// E22 - and never on a healthy request, nor on a non-/data one.
T('E22 rescue stays silent on success and on unrelated failures', async (env) => {
  env.run(boot);
  env.landSender(true);
  env.w.fetch(ORIGIN + '/lmr/data', { method: 'POST', body: 'A' });
  await tick();
  eq(env.rescues().length, 0, 'no rescue when the POST resolves');
  env.setFetchResult(() => Promise.reject(new Error('x')));
  env.w.fetch(ORIGIN + '/other', { method: 'POST', body: 'B' }).catch(() => { });
  await tick();
  eq(env.rescues().length, 0, 'no rescue for a path outside the transport');
});

// E23 - beacon and XHR rescue paths.
T('E23 rescue covers beacon refusal and XHR network error', async (env) => {
  env.run(boot);
  env.landSender(true);
  env.setBeaconResult(() => false);
  env.w.navigator.sendBeacon(ORIGIN + '/lmr/data', 'BODY');
  eq(env.rescues().length, 1, 'beacon refusal rescued');
  const x = new env.w.XMLHttpRequest();
  x.open('POST', ORIGIN + '/lmr/data');
  x.send('XBODY');
  x.dispatch('error');
  eq(env.rescues().length, 2, 'XHR error rescued');
  x.dispatch('timeout');
  eq(env.rescues().length, 2, 'not rescued twice for the same request');
});

// E24 - the watchdog stays quiet when the Google tag was heard. The flag comes
// from the inline sentinel, which is the whole reason a late tail is safe.
T('E24 watchdog does nothing when the sentinel saw a hit', (env) => {
  env.run(boot);
  env.landSender(true);
  env.w.__synSeen = 1;
  env.w.google_tag_manager = { 'GTM-NQHQHZLR': {} };
  env.intervals[0][0]();
  const armed = env.timeouts.filter(([, ms]) => ms === 8000);
  eq(armed.length, 0, 'never armed');
  eq(env.fetched.length, 0, 'no recovery hit');
});

// E25 - and recovers when it was not: container up, Google tag silent.
T('E25 watchdog recovers page_view + queued events when nothing was heard', (env) => {
  env.run(boot);
  env.landSender(true);
  env.w.dataLayer = env.w.dataLayer || [];
  env.w.dataLayer.push({ event: 'view_item_synapse', ecommerce: { currency: 'BGN', value: 10, items: [{ item_id: 'A1', item_name: 'X' }] } });
  env.w.google_tag_manager = { 'GTM-NQHQHZLR': {} };
  env.intervals[0][0]();
  const armed = env.timeouts.filter(([, ms]) => ms === 8000);
  eq(armed.length, 1, 'armed once the container was up');
  armed[0][0]();
  eq(env.fetched.length, 2, 'page_view + the queued event');
  has(env.fetched[0][0], 'en=page_view', 'page_view first');
  has(env.fetched[0][0], 'ep.synapse_recovered=1', 'marked as recovered');
  has(env.fetched[0][0], '/lmr/g/collect?', 'sent through the server container');
  // The byte that proves the 1.7.2 encoding is camouflage only: the id is
  // hidden in the page, and plain again on the wire. Both hits carry it.
  has(env.fetched[0][0], 'tid=G-SYYEZHP7BL', 'decoded measurement id on the wire');
  has(env.fetched[1][0], 'tid=G-SYYEZHP7BL', 'decoded measurement id on the queued hit');
  has(env.fetched[1][0], 'en=view_item', 'suffix stripped');
  has(env.fetched[1][0], 'cu=BGN', 'ecommerce translated');
  has(env.fetched[1][0], 'pr1=', 'items translated');
});

// E26 - a late-arriving tail must not double-count. Same scenario as E25 but
// the container booted on the 3s timeout before the tail ran.
T('E26 late tail does not duplicate a hit the sentinel already saw', (env) => {
  env.run(sentinel);
  env.run(boot);
  env.timeouts[0][0]();                       // container boots on timeout
  env.w.fetch(ORIGIN + '/lmr/g/collect?v=2'); // Google tag speaks
  env.landSender(true);                       // tail finally arrives
  env.w.google_tag_manager = { 'GTM-NQHQHZLR': {} };
  const iv = env.intervals[env.intervals.length - 1];
  iv[0]();
  eq(env.timeouts.filter(([, ms]) => ms === 8000).length, 0, 'watchdog never armed');
  eq(env.fetched.length, 1, 'only the container own hit - no duplicate');
});

// E27 - the tail is idempotent: running it twice (boot pulled it, then the
// worker was fixed mid-session) must not double-wrap anything.
T('E27 tail is idempotent', (env) => {
  env.run(boot);
  env.landSender(true);
  env.run(tail);
  env.run(tail);
  eq(env.intervals.length, 1, 'one watchdog poller');
  const calls = [];
  env.w.dataTagSendData = function () { };
  eq(env.w.__synTail, 1, 'marker stays set');
  eq(env.w.__synDataRescue, 1, 'rescue installed once');
});

// E28 - the built file really is core + tail with nothing lost or rewritten,
// and the whole thing parses. What is actually being guarded here is the
// concatenation itself: a syntax error in the joined file would take down the
// sender for every browser at once, and would surface in the browser rather
// than in any of the checks above.
T('E28 s.js = vendored core + separator + tail, and the whole file parses', () => {
  const core = fs.readFileSync(path.join(PLUGIN, 'assets', 'data-tag-sender.js'), 'utf8');
  eq(built.slice(0, core.length), core, 'core embedded byte-for-byte');
  eq(built.slice(core.length, core.length + 2), ';\n', 'separator statement present');
  eq(built.slice(core.length + 2), tail, 'tail embedded byte-for-byte');
  new vm.Script(built);   // throws on a syntax error
});

// E29 - a page with no config at all (edge mode off, or an old page still in a
// cache) must still get the seed and must not throw.
T('E29 tail without __synCfg still seeds and stays silent', (env) => {
  env.run(tail);
  eq(env.seeded(9), true, 'seed still applied');
  eq(env.signals().length, 0, 'no signals without a prefix to send them to');
  eq(env.intervals.length, 0, 'no watchdog without a measurement id');
  eq(env.w.__synTail, 1, 'completed cleanly');
});

/* ========================================================================
 * Recovery lifecycle: consent freshness and handing over to a late tag.
 *
 * These cover the two defects found in the 2026-09-20 review: consent and
 * identity were captured once at fire() and reused for the whole page, and the
 * dataLayer.push hook installed by fire() was never disarmed, so a Google tag
 * that woke up late produced a duplicate of every subsequent event.
 * ======================================================================== */

// Arm the watchdog and fire it, with an optional consent entry pushed first.
function arm(env, consentEntry) {
  env.run(boot);
  env.landSender(true);
  env.w.dataLayer = env.w.dataLayer || [];
  if (consentEntry) { env.w.dataLayer.push(consentEntry); }
  env.w.google_tag_manager = { 'GTM-NQHQHZLR': {} };
  env.intervals[0][0]();
  const armed = env.timeouts.filter(([, ms]) => ms === 8000);
  ok(armed.length === 1, 'watchdog armed');
  armed[0][0]();
  return env;
}
const denied = ['consent', 'update', { ad_storage: 'denied', analytics_storage: 'denied' }];
const granted = ['consent', 'update', { ad_storage: 'granted', analytics_storage: 'granted' }];

T('E33 consent granted at arm time is reflected in the first hit', (env) => {
  arm(env, granted);
  has(env.fetched[0][0], 'gcs=G111', 'granted');
  has(env.fetched[0][0], 'npa=0', 'ads allowed');
});

T('E34 consent denied at arm time still sends, with a denied signal', (env) => {
  arm(env, denied);
  ok(env.fetched.length >= 1, 'a cookieless ping is still sent');
  has(env.fetched[0][0], 'gcs=G100', 'denied');
  has(env.fetched[0][0], 'npa=1', 'ads restricted');
});

T('E35 a consent change AFTER arming is picked up by later hits', (env) => {
  arm(env, denied);
  const before = env.fetched.length;
  env.w.dataLayer.push(granted);
  env.w.dataLayer.push({ event: 'add_to_cart_synapse', ecommerce: { currency: 'BGN', value: 5, items: [{ item_id: 'A' }] } });
  ok(env.fetched.length > before, 'the new event was recovered');
  const last = env.fetched[env.fetched.length - 1][0];
  has(last, 'gcs=G111', 'the later hit carries the NEW consent, not the state at arm time');
  has(last, 'npa=0', 'ads allowed on the later hit');
});

T('E36 a withdrawal after arming is picked up too', (env) => {
  arm(env, granted);
  env.w.dataLayer.push(denied);
  env.w.dataLayer.push({ event: 'purchase_synapse', ecommerce: { currency: 'BGN', value: 9, transaction_id: 'T1', items: [{ item_id: 'A' }] } });
  const last = env.fetched[env.fetched.length - 1][0];
  has(last, 'gcs=G100', 'the later hit reflects the withdrawal');
});

T('E37 identity moves onto the persisted id once analytics is granted', (env) => {
  arm(env, denied);
  const firstCid = /[?&]cid=([^&]*)/.exec(env.fetched[0][0])[1];
  env.w.dataLayer.push(granted);
  env.w.dataLayer.push({ event: 'add_to_cart_synapse', ecommerce: { currency: 'BGN', value: 5, items: [{ item_id: 'A' }] } });
  const lastCid = /[?&]cid=([^&]*)/.exec(env.fetched[env.fetched.length - 1][0])[1];
  ok(!!lastCid, 'a cid is present');
  ok(lastCid !== firstCid, 'the throwaway id is replaced once storage is allowed');
});

T('E38 the watchdog does not disarm itself on its own traffic', (env) => {
  arm(env, granted);
  const after = env.fetched.length;
  ok(after >= 1, 'it sent at least the page_view');
  ok(!env.w.__synSeen, 'its own hit did not set the sentinel flag');
  env.w.dataLayer.push({ event: 'add_to_cart_synapse', ecommerce: { currency: 'BGN', value: 5, items: [{ item_id: 'A' }] } });
  ok(env.fetched.length > after, 'it keeps recovering');
});

T('E39 a real Google tag hit stops further recovery', (env) => {
  arm(env, granted);
  const after = env.fetched.length;
  // The inline sentinel sets this when the real tag finally sends.
  env.w.__synSeen = 1;
  env.w.dataLayer.push({ event: 'add_to_cart_synapse', ecommerce: { currency: 'BGN', value: 5, items: [{ item_id: 'A' }] } });
  eq(env.fetched.length, after, 'no duplicate alongside the real tag');
});

T('E40 once handed over it stays handed over', (env) => {
  arm(env, granted);
  env.w.__synSeen = 1;
  env.w.dataLayer.push({ event: 'add_to_cart_synapse', ecommerce: { currency: 'BGN', items: [{ item_id: 'A' }] } });
  const after = env.fetched.length;
  env.w.__synSeen = 0;
  env.w.dataLayer.push({ event: 'purchase_synapse', ecommerce: { currency: 'BGN', transaction_id: 'T2', items: [{ item_id: 'B' }] } });
  eq(env.fetched.length, after, 'a cleared flag does not restart a replay of the backlog');
});

/* ------------------------------------------------------------------------
 * E41..E44  identity must not be re-minted per hit.
 *
 * 1.7.5 adopted the persisted id once analytics storage was granted, by
 * re-running state() whenever the current identity was not persisted. When
 * storage is unavailable that condition never clears, so every hit minted a
 * fresh client id and one visitor arrived as several. These pin one identity
 * per page load, and keep denied hits off the stored one.
 * --------------------------------------------------------------------- */

const cids = (env) => env.fetched.map(([u]) => /[?&]cid=([^&]*)/.exec(u)[1]);
const threeMore = (env) => {
  env.w.dataLayer.push({ event: 'view_item_synapse', ecommerce: { currency: 'BGN', value: 1, items: [{ item_id: 'A' }] } });
  env.w.dataLayer.push({ event: 'add_to_cart_synapse', ecommerce: { currency: 'BGN', value: 2, items: [{ item_id: 'A' }] } });
  env.w.dataLayer.push({ event: 'purchase_synapse', ecommerce: { currency: 'BGN', value: 3, transaction_id: 'T', items: [{ item_id: 'A' }] } });
};

T('E41 one client id for the whole page when storage throws', (env) => {
  arm(env, granted);
  threeMore(env);
  const c = cids(env);
  ok(c.length >= 4, 'expected page_view plus three events, got ' + c.length);
  eq(new Set(c).size, 1, 'every hit must carry the same cid, saw ' + new Set(c).size);
}, { storage: 'blocked' });

T('E42 one client id when storage accepts writes and keeps nothing', (env) => {
  arm(env, granted);
  threeMore(env);
  const c = cids(env);
  eq(new Set(c).size, 1, 'every hit must carry the same cid, saw ' + new Set(c).size);
}, { storage: 'lying' });

T('E43 a working storage still yields one stable client id', (env) => {
  arm(env, granted);
  threeMore(env);
  const c = cids(env);
  eq(new Set(c).size, 1, 'every hit must carry the same cid, saw ' + new Set(c).size);
});

T('E44 a withdrawal stops the persisted id being sent', (env) => {
  arm(env, granted);
  const grantedCid = cids(env)[0];
  env.w.dataLayer.push(denied);
  env.w.dataLayer.push({ event: 'view_item_synapse', ecommerce: { currency: 'BGN', value: 1, items: [{ item_id: 'A' }] } });
  const last = env.fetched[env.fetched.length - 1][0];
  has(last, 'gcs=G100', 'the hit is marked denied');
  const deniedCid = /[?&]cid=([^&]*)/.exec(last)[1];
  ok(deniedCid !== grantedCid, 'a denied hit must not carry the stored identity');
});

/* ------------------------------------------------------------------------
 * E45..E48  consent that never reaches the dataLayer, and the real client id.
 * --------------------------------------------------------------------- */

T('E45 a CMP that only sets GTM consent state is honoured', (env) => {
  arm(env);                       // no dataLayer consent entry at all
  has(env.fetched[0][0], 'gcs=G100', 'denied through GTM, not through the dataLayer');
  has(env.fetched[0][0], 'npa=1', 'ads restricted');
}, { ics: { ad_storage: 2, analytics_storage: 2 } });

T('E46 GTM resolved state wins over a dataLayer entry it did not produce', (env) => {
  arm(env, granted);
  has(env.fetched[0][0], 'gcs=G100', 'the resolved state decides');
}, { ics: { ad_storage: 2, analytics_storage: 2 } });

T('E46b a default-only entry, as a live container shows before any answer, is honoured', (env) => {
  arm(env);
  has(env.fetched[0][0], 'gcs=G100', 'default:false with no update means denied');
}, { icsEntries: { ad_storage: { default: false, implicit: true, quiet: false }, analytics_storage: { default: false, implicit: true, quiet: false } } });

T('E47 a new identity adopts the real GA4 client id when one exists', (env) => {
  arm(env, granted);
  has(env.fetched[0][0], 'cid=1234567890.1700000000', 'recovered hits land on the same user');
}, { cookie: '_ga=GA1.1.1234567890.1700000000; _gid=GA1.1.9.9' });

T('E48 without that cookie a client id is still minted', (env) => {
  arm(env, granted);
  const cid = /[?&]cid=([^&]*)/.exec(env.fetched[0][0])[1];
  ok(/^\d+\.\d+$/.test(cid), 'a usable client id, got ' + JSON.stringify(cid));
});

/* ------------------------------------------------------------------------
 * E49..E51  a new recovery session is not the same thing as a first visit.
 *
 * "first" used to be decided solely by the absence of our own _synfb record,
 * and it drove _fv=1, _ss=1 and _nsi=1 together. Once the client id could be
 * adopted from _ga, that meant claiming a first visit on top of a visitor the
 * Google tag had demonstrably already counted.
 * --------------------------------------------------------------------- */

T('E49 an adopted client id does not also claim a first visit', (env) => {
  arm(env, granted);
  const first = env.fetched[0][0];
  has(first, 'cid=1234567890.1700000000', 'the existing identity is used');
  not(first, '_fv=1', 'the Google tag has already counted this visitor');
  has(first, '_ss=1', 'it is still a new recovery session');
  has(first, '_nsi=1', 'with a new session id');
}, { cookie: '_ga=GA1.1.1234567890.1700000000' });

T('E50 a genuinely unknown visitor is still reported as a first visit', (env) => {
  arm(env, granted);
  has(env.fetched[0][0], '_fv=1', 'nothing on the domain says otherwise');
  has(env.fetched[0][0], '_ss=1', 'and it is a new session');
});

T('E51 only the first hit of the session carries the session flags', (env) => {
  arm(env, granted);
  env.w.dataLayer.push({ event: 'view_item_synapse', ecommerce: { currency: 'BGN', value: 1, items: [{ item_id: 'A' }] } });
  const last = env.fetched[env.fetched.length - 1][0];
  not(last, '_ss=1', 'the second hit is not a session start');
  not(last, '_fv=1', 'nor a first visit');
});

/* ------------------------------------------------------------------------
 * E52  the whole identity table, not one transition at a time.
 * See identity-matrix.mjs for the invariants.
 * --------------------------------------------------------------------- */

T('E52 identity invariants hold across every storage mode, cookie and consent sequence', () => {
  const view = (env) => env.w.dataLayer.push({ event: 'view_item_synapse', ecommerce: { currency: 'BGN', value: 1, items: [{ item_id: 'A' }] } });
  const r = runMatrix({
    make: (mode, cookie) => makeEnv({ identity: { mode, cookie } }),
    arm: (env, c) => arm(env, c === 'G' ? granted : denied),
    consent: (env, c) => env.w.dataLayer.push(c === 'G' ? granted : denied),
    hit: view,
    urls: (env) => env.fetched.map(([u]) => u),
  });
  ok(r.scenarios === 72, 'expected 72 scenarios, ran ' + r.scenarios);
  ok(r.failures.length === 0, r.failures.length + ' invariant failures:\n      ' + r.failures.slice(0, 12).join('\n      '));
});

/* ======================================================================== */

const run = async () => {
  for (const { name, fn, opts } of queue) {
    const env = makeEnv(opts);
    try {
      await fn(env);
      pass++;
      console.log('  OK  ' + name);
    } catch (e) {
      fail++;
      console.log('FAIL  ' + name + ' -> ' + e.message);
    }
  }
  console.log(`\n${pass}/${pass + fail} passed`);
  process.exit(fail ? 1 : 0);
};
run();
