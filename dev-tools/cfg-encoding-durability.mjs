// Durability tests for the 1.7.2 __synCfg id encoding.
//
// The question these answer is not "does it work today" - edge-sender17-test
// covers that - but "can this break later, on its own, without anyone touching
// it". Three things could:
//
//   1. the encoding itself producing a value the reader mistakes for a plain id
//      (or vice versa), for some id it has not been tried with yet;
//   2. a page built by one version of the plugin meeting a cached copy of the
//      sender built by another version;
//   3. a future edit quietly changing the alphabet or the reader's rule.
//
// Nothing here restates the shipped code: the reader is extracted verbatim out
// of assets/tail.js and run in a VM, the head is rendered from the PHP source,
// and the worker's cache behaviour is read out of the worker file.
//
// Usage:  node dev-tools/cfg-encoding-durability.mjs
import fs from 'node:fs';
import os from 'node:os';
import vm from 'node:vm';
import path from 'node:path';
import crypto from 'node:crypto';
import { execFileSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';

const dir = path.dirname(fileURLToPath(import.meta.url));
// NEW is the release under test; OLD is an earlier one kept deliberately, so
// the pairing "current page meets a cached sender from a previous release" is
// exercised rather than assumed. Override NEW with --plugin.
const __pluginIdx = process.argv.indexOf('--plugin');
const NEW = __pluginIdx !== -1 && process.argv[__pluginIdx + 1]
  ? process.argv[__pluginIdx + 1]
  : 'synapse-conversion-tracking v2.0.3';
const OLD = 'synapse-conversion-tracking v1.7.1';
const plug = (v) => path.join(dir, '..', v, 'synapse-conversion-tracking');

const WORKER = path.join(dir, '..', '..', 'lamore-sgtm', 'cloudflare', 'worker-lmr-proxy-LEAN-v2-BARE.js');

for (const [what, where] of [['the previous release ' + OLD, path.join(plug(OLD), 'assets', 'tail.js')], ['the edge worker source', WORKER]]) {
  if (!fs.existsSync(where)) {
    // Durability is measured across releases and against the worker; both live
    // next to the release checkout, not in the plugin repository.
    console.log(`  SKIP  cfg-encoding-durability: needs ${what} at ${where}, which is not part of this checkout.`);
    process.exit(0);
  }
}
const tailNew = fs.readFileSync(path.join(plug(NEW), 'assets', 'tail.js'), 'utf8');
const tailOld = fs.readFileSync(path.join(plug(OLD), 'assets', 'tail.js'), 'utf8');
const phpNew = fs.readFileSync(path.join(plug(NEW), 'includes', 'class-gtm-server-side-tracking-code.php'), 'utf8');

let pass = 0, fail = 0;
function T(name, fn) {
  try { fn(); pass++; console.log('  OK  ' + name); }
  catch (e) { fail++; console.log('FAIL  ' + name + ' -> ' + e.message); }
}
function eq(a, b, what) { if (a !== b) throw new Error(`${what}: ${JSON.stringify(a)} !== ${JSON.stringify(b)}`); }
function ok(c, what) { if (!c) throw new Error(what); }

const b64 = (s) => Buffer.from(s, 'utf8').toString('base64');

/* ===========================================================================
 * The reader under test, taken out of the shipped file rather than rewritten.
 * ======================================================================== */
function extractDecId(src, label) {
  const at = src.indexOf('var decId = function (v) {');
  if (at < 0) { throw new Error(`${label}: decId not found - the reader was renamed or removed`); }
  let i = src.indexOf('{', at), depth = 0;
  for (; i < src.length; i++) {
    if (src[i] === '{') { depth++; }
    else if (src[i] === '}') { depth--; if (depth === 0) { break; } }
  }
  return src.slice(at, i + 1) + ';';
}

// Build a callable decId over a window double, so the atob dependency is
// controllable (that is a real browser variable, not a test convenience).
function makeDecId(opts) {
  opts = opts || {};
  const w = {};
  if (opts.atob !== false) {
    w.atob = (s) => {
      // Node's Buffer is lenient where the browser's atob is strict; reject
      // the same inputs a browser rejects so the test is not more forgiving
      // than production.
      const t = String(s).replace(/=+$/, '');
      if (!/^[A-Za-z0-9+/]*$/.test(t) || t.length % 4 === 1) { throw new Error('InvalidCharacterError'); }
      return Buffer.from(s, 'base64').toString('binary');
    };
  }
  const sandbox = { w };
  vm.createContext(sandbox);
  vm.runInContext(extractDecId(tailNew, 'tail v1.7.2'), sandbox);
  return sandbox.decId;
}

const decId = makeDecId();

const PREFIXES = ['G', 'GTM', 'AW', 'DC', 'UA', 'MC', 'DT'];

/* ===========================================================================
 * 1. The encoding can never collide with the plain form
 * ======================================================================== */

// C1 - the whole premise: standard base64 cannot emit "-". Exhaustive over 1
// and 2 byte inputs, then a wide random sweep. Also asserts no "<", which is
// what keeps the value safe to print inside a <script> block.
T('C1 base64 output never contains "-" or "<"', () => {
  const bad = (s) => s.indexOf('-') !== -1 || s.indexOf('<') !== -1;
  for (let a = 0; a < 256; a++) {
    if (bad(Buffer.from([a]).toString('base64'))) { throw new Error('1-byte ' + a); }
    for (let b = 0; b < 256; b++) {
      if (bad(Buffer.from([a, b]).toString('base64'))) { throw new Error(`2-byte ${a},${b}`); }
    }
  }
  for (let n = 0; n < 200000; n++) {
    const len = 1 + (n % 30);
    if (bad(crypto.randomBytes(len).toString('base64'))) { throw new Error('random ' + n); }
  }
});

// C2 - every plausible id shape survives encode -> read, at every length that
// produces each of the three base64 padding cases.
T('C2 round-trip holds for every id prefix and length (all padding cases)', () => {
  let pad0 = 0, pad1 = 0, pad2 = 0;
  for (const p of PREFIXES) {
    for (let n = 1; n <= 40; n++) {
      const id = p + '-' + 'ABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789ABCD'.slice(0, n);
      const enc = b64(id);
      const pads = (enc.match(/=+$/) || [''])[0].length;
      if (pads === 0) { pad0++; } else if (pads === 1) { pad1++; } else { pad2++; }
      eq(decId(enc), id, `${id} round-trip`);
      eq(decId(id), id, `${id} plain passthrough`);
    }
  }
  ok(pad0 > 0 && pad1 > 0 && pad2 > 0, `all three padding cases exercised (${pad0}/${pad1}/${pad2})`);
});

// C3 - the two base64 characters that need care in a page are "+" and "/"
// ("/" is what wp_json_encode writes as "\/"). Exhaustively: a Google id is
// drawn from [A-Z0-9-], and no combination of those bytes can produce either
// one. So the encoded value is always plain [A-Za-z0-9=] and the page source
// never carries an escape at all.
T('C3 an encoded Google id can never contain "+" or "/"', () => {
  const AL = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789-';
  for (let i = 0; i < AL.length; i++) {
    for (let j = 0; j < AL.length; j++) {
      for (let k = 0; k < AL.length; k++) {
        const enc = b64(AL[i] + AL[j] + AL[k]);
        if (/[+/]/.test(enc)) { throw new Error(`${AL[i]}${AL[j]}${AL[k]} -> ${enc}`); }
        if (!/^[A-Za-z0-9=]+$/.test(enc)) { throw new Error(`unexpected character in ${enc}`); }
      }
    }
  }
});

// C3b - and if one ever did appear (a future id alphabet), it would still
// survive being written into the page as JSON and parsed back. Real JSON
// parse in a VM, not a string comparison.
T('C3b a value containing "+" and "/" survives the page-source round trip', () => {
  const wpJson = (v) => JSON.stringify(v).replace(/\//g, '\\/');
  let seenPlus = 0, seenSlash = 0;

  for (let n = 0; n < 4000; n++) {
    const raw = crypto.randomBytes(3 + (n % 12)).toString('binary');
    const enc = Buffer.from(raw, 'binary').toString('base64');
    if (enc.indexOf('+') !== -1) { seenPlus++; }
    if (enc.indexOf('/') !== -1) { seenSlash++; }

    const src = 'window.__synCfg=' + wpJson({ p: '/lmr', t: enc, c: enc, s: '', d: 1 }) + ';';
    const sandbox = { window: {} };
    vm.createContext(sandbox);
    vm.runInContext(src, sandbox);
    eq(sandbox.window.__synCfg.t, enc, 'the value reaches the browser unchanged');
  }
  ok(seenPlus > 0, `at least one "+" case was exercised (${seenPlus})`);
  ok(seenSlash > 0, `at least one "/" case was exercised (${seenSlash})`);
});

/* ===========================================================================
 * 2. The reader's contract
 * ======================================================================== */

// C4 - "feature off" and "key absent" must both mean off, because a page
// cached from before the key existed will simply not have it.
T('C4 empty, missing and non-string values all read as "off"', () => {
  eq(decId(''), '', 'empty string');
  eq(decId(undefined), '', 'missing key');
  eq(decId(null), '', 'null');
  eq(decId(0), '', 'number');
  eq(decId({}), '', 'object');
  eq(decId([]), '', 'array');
  eq(decId(true), '', 'boolean');
});

// C5 - a value that is neither a plain id nor decodable must disable the
// watchdog rather than arm it against a wrong key. Fail closed, never throw.
T('C5 undecodable values fail closed instead of throwing', () => {
  for (const v of ['!!!!', 'ab', 'A', '====', 'ЮНИКОД', 'AAAA AAAA', '\u0000\u0001']) {
    let out;
    try { out = decId(v); } catch (e) { throw new Error(`threw on ${JSON.stringify(v)}: ${e.message}`); }
    ok(out === '' || out.indexOf('-') === -1, `${JSON.stringify(v)} -> ${JSON.stringify(out)}`);
  }
});

// C6 - atob is used unguarded elsewhere in the tail only inside its own try;
// here the reader must survive a window that has no atob at all.
T('C6 a window without atob does not throw and reads as "off"', () => {
  const d2 = makeDecId({ atob: false });
  eq(d2(b64('G-SYYEZHP7BL')), '', 'encoded value with no atob');
  eq(d2('G-SYYEZHP7BL'), 'G-SYYEZHP7BL', 'plain value still works without atob');
});

// C7 - reading twice must be the same as reading once. Nothing does that
// today, but it is what makes the rule safe to apply anywhere later.
T('C7 the reader is idempotent', () => {
  for (const p of PREFIXES) {
    const id = p + '-ABC123XYZ';
    eq(decId(decId(id)), decId(id), `${id} plain`);
    eq(decId(decId(b64(id))), decId(b64(id)), `${id} encoded`);
  }
});

/* ===========================================================================
 * 3. Version skew - a page from one version meeting a sender from another
 * ======================================================================== */

const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'syn-skew-'));
const renderBoot = (version) => {
  const out = path.join(tmp, version.replace(/[^\w.]/g, '_'));
  fs.mkdirSync(out, { recursive: true });
  execFileSync(process.execPath, [path.join(dir, 'render-boot.mjs'), '--plugin', version, '--out', out], { stdio: 'pipe' });
  return {
    boot: fs.readFileSync(path.join(out, 'edge-boot17.js'), 'utf8'),
    sentinel: fs.readFileSync(path.join(out, 'edge-sentinel17.js'), 'utf8'),
  };
};
const R = { [NEW]: renderBoot(NEW), [OLD]: renderBoot(OLD) };

// A window double just rich enough to arm the watchdog and record what it
// would send. Deliberately separate from the big harness: this asks one
// question only - does the recovery hit go out, and with which tid.
function skewEnv() {
  const fetched = [];
  const intervals = [];
  const timeouts = [];
  const store = {};
  const w = {
    document: {
      title: 't', referrer: '', scripts: [],
      createElement: () => ({ tagName: 'SCRIPT', src: '', onload: null, onerror: null }),
      getElementsByTagName: () => [{ parentNode: { insertBefore: () => { } } }],
      head: { appendChild: () => { } }, documentElement: { appendChild: () => { } },
    },
    URL,
    location: { origin: 'https://lamore-bg.com', href: 'https://lamore-bg.com/x' },
    screen: { width: 1280, height: 800 },
    navigator: { language: 'bg-BG', sendBeacon: () => true },
    Image: function () { return {}; },
    XMLHttpRequest: function () { this.addEventListener = () => { }; this.open = () => { }; this.send = () => { }; },
    atob: (s) => Buffer.from(s, 'base64').toString('binary'),
    btoa: (s) => Buffer.from(s, 'binary').toString('base64'),
    sessionStorage: { getItem: (k) => (k in store ? store[k] : null), setItem: (k, v) => { store[k] = String(v); } },
    setTimeout: (fn, ms) => { timeouts.push([fn, ms]); return timeouts.length; },
    setInterval: (fn, ms) => { intervals.push([fn, ms]); return intervals.length; },
    clearInterval: () => { },
    addEventListener: () => { },
    fetch: (i) => { fetched.push(String(i)); return Promise.resolve({ ok: true }); },
  };
  const sandbox = { window: w, document: w.document, URL };
  vm.createContext(sandbox);
  return {
    w, fetched, intervals, timeouts,
    run: (code) => vm.runInContext(code, sandbox),
  };
}

// Runs one (page version x sender version) pair through the recovery path and
// reports what actually left the browser.
function skew(pageVersion, tailSrc) {
  const env = skewEnv();
  env.run(R[pageVersion].sentinel);
  env.run(R[pageVersion].boot);
  env.w.dataTagSendData = function () { };
  env.w.dataTagGetData = function () { return {}; };
  env.run(tailSrc);
  env.w.google_tag_manager = { 'GTM-NQHQHZLR': {} };
  if (!env.intervals.length) { return { armed: 0, hits: [] }; }
  env.intervals[0][0]();
  const armed = env.timeouts.filter(([, ms]) => ms === 8000);
  if (!armed.length) { return { armed: 0, hits: [] }; }
  armed[0][0]();
  return { armed: armed.length, hits: env.fetched };
}

// C8 - the shipping combination.
T('C8 new page x new sender: recovery fires with the plain id on the wire', () => {
  const r = skew(NEW, tailNew);
  eq(r.armed, 1, 'watchdog armed');
  eq(r.hits.length, 1, 'one recovery hit');
  ok(r.hits[0].indexOf('tid=G-SYYEZHP7BL') !== -1, 'plain measurement id on the wire: ' + r.hits[0].slice(0, 90));
});

// C9 - the realistic skew: a page rendered before the update (plain ids, e.g.
// held by a page cache) meeting the updated sender. This is the direction that
// actually happens, and it must be indistinguishable from C8.
T('C9 old page x new sender: identical behaviour, byte for byte on the wire', () => {
  const a = skew(NEW, tailNew);
  const b = skew(OLD, tailNew);
  eq(b.armed, 1, 'watchdog armed');
  eq(b.hits.length, 1, 'one recovery hit');
  const strip = (u) => u.replace(/[?&](?:_p|sid|cid|_s|ul|sr|dl|dt|dr|seg|sct|_et)=[^&]*/g, '');
  eq(strip(b.hits[0]), strip(a.hits[0]), 'same hit as the new page produces');
});

// C10 - the control: nothing about the old pairing changed.
T('C10 old page x old sender: unchanged from 1.7.1', () => {
  const r = skew(OLD, tailOld);
  eq(r.armed, 1, 'watchdog armed');
  eq(r.hits.length, 1, 'one recovery hit');
  ok(r.hits[0].indexOf('tid=G-SYYEZHP7BL') !== -1, 'measurement id on the wire');
});

// C11 - the one degrading direction, measured rather than assumed. It needs a
// cache that ignores query strings (the ?v= token otherwise makes it
// impossible - see C12/C13), and when it happens the 1.7.1 sender reads the
// encoded id literally, looks for a container that does not exist, and simply
// never arms. What matters is that it fails CLOSED: no hit with a wrong id, no
// duplicate, no exception. The seed and the transport rescue are untouched,
// because neither reads these two fields.
T('C11 new page x old sender: watchdog goes quiet, sends nothing wrong', () => {
  const r = skew(NEW, tailOld);
  eq(r.armed, 0, 'never armed');
  eq(r.hits.length, 0, 'nothing sent');

  const env = skewEnv();
  env.run(R[NEW].boot);
  env.w.dataTagSendData = function () { };
  env.w.dataTagGetData = function () { return {}; };
  env.run(tailOld);
  eq(env.w.__synTail, 1, 'the old sender still completed cleanly');
  eq(env.w.__synDataRescue, 1, 'the transport rescue still installed');
  ok(env.w.gtm_dataTagScriptLoadedCache, 'the loaded-cache seed still applied');
});

/* ===========================================================================
 * 4. Why that skew cannot happen by itself
 * ======================================================================== */

const sha8 = (v, f) => crypto.createHash('sha256').update(fs.readFileSync(path.join(plug(v), 'assets', f))).digest('hex').slice(0, 8);

// C12 - the sender URL is content-addressed, so a changed sender is a changed
// URL. A browser or cache holding the 1.7.1 file can never answer a request
// the 1.7.2 page makes.
T('C12 the sender URL changes whenever the sender changes', () => {
  const a = sha8(OLD, 's.js');
  const b = sha8(NEW, 's.js');
  ok(a !== b, `?v= differs across versions (${a} -> ${b})`);
  ok(R[OLD].boot.indexOf('?v=' + a) !== -1, '1.7.1 head asks for the 1.7.1 file');
  ok(R[NEW].boot.indexOf('?v=' + b) !== -1, '1.7.2 head asks for the 1.7.2 file');
  ok(R[NEW].boot.indexOf('?v=' + a) === -1, '1.7.2 head never references the old file');
});

// C13 - and the worker carries that token through to the origin, so its own
// cache is keyed on it too. Read out of the live worker rather than assumed:
// the year-long immutable answer is only given to a versioned request.
T('C13 the worker keys its cache on the version token', () => {
  const src = fs.readFileSync(WORKER, 'utf8');
  ok(/const search = url\.search;/.test(src), 'the worker captures the query string');
  ok(/fetch\(url\.origin \+ base \+ file \+ search,/.test(src), 'and forwards it to the origin fetch');
  ok(/cacheTtl: versioned \? YEAR : 3600/.test(src), 'a year is only cached for a versioned request');
  ok(/immutable/.test(src) && /url\.searchParams\.has\('v'\)/.test(src), 'immutable is gated on the token');
});

/* ===========================================================================
 * 5. Tripwires against a future edit
 * ======================================================================== */

// C14 - the plugin must keep using the standard alphabet. base64url uses "-",
// which is exactly the character the reader treats as "this is a plain id", so
// switching alphabets would make every encoded id undecodable.
T('C14 the plugin still encodes with the standard base64 alphabet', () => {
  const m = /private static function encode_cfg_id\([^)]*\)\s*\{([\s\S]*?)\n\t\}/.exec(phpNew);
  ok(m, 'encode_cfg_id present');
  ok(/\bbase64_encode\(/.test(m[1]), 'uses base64_encode');
  ok(!/strtr|base64url|urlsafe/i.test(m[1]), 'not base64url');
  ok(/'' === \$id \? '' : /.test(m[1]), 'an empty id stays empty');
});

// C15 - and the reader must keep accepting the plain form. Dropping it would
// break every page still served from a cache built by an older plugin.
T('C15 the reader still accepts the plain form', () => {
  const fn = extractDecId(tailNew, 'tail v1.7.2');
  ok(/indexOf\('-'\)/.test(fn), 'the "-" discriminator is still the rule');
  ok(/catch/.test(fn), 'a decode failure is still caught');
});

// C16 - the encoded ids are what actually reaches the page, and no readable
// Google id survives anywhere in the head.
T('C16 the rendered head carries the encoded ids and no readable one', () => {
  const boot = R[NEW].boot;
  ok(boot.indexOf(b64('G-SYYEZHP7BL')) !== -1, 'encoded measurement id present');
  ok(boot.indexOf(b64('GTM-NQHQHZLR')) !== -1, 'encoded container id present');
  ok(boot.indexOf('G-SYYEZHP7BL') === -1, 'plain measurement id absent');
  ok(boot.indexOf('GTM-NQHQHZLR') === -1, 'plain container id absent');
  ok(!/\b(?:G|GTM|AW|DC|UA|MC|DT)-[A-Z0-9]{6,}/.test(boot + R[NEW].sentinel), 'no Google id shape in the head at all');
});

console.log(`\n${pass}/${pass + fail} passed`);
fs.rmSync(tmp, { recursive: true, force: true });
process.exit(fail ? 1 : 0);
