// Data Client transport rescue (v1.6.0) + first-party Data Tag sender (v1.6.1)
// - functional tests over the EXACT rendered JS.
// Run render-ga4fb.php first (produces rescue-only.js / combined-v16.js / rescue-noshim.js).
// Since v1.6.1 the rescue render also carries the vendored Data Tag sender
// (assets/data-tag-sender.js) + the gtm_dataTagScriptLoadedCache seed, so the
// Data Tag template skips its list-blocked stapecdn.com injection and calls
// window.dataTagSendData() first-party (T15-T20).
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
const rescueOnly = fs.readFileSync(path.join(dir, 'rescue-only.js'), 'utf8');
const combinedV16 = fs.readFileSync(path.join(dir, 'combined-v16.js'), 'utf8');

// A realistic Data Tag ecommerce body (what the wire carries as the POST body,
// Cyrillic included - the rescue must round-trip it byte-identically).
const BODY = JSON.stringify({
  page_location: 'https://lamore-bg.com/detski-torti/torti-za-bebeta/',
  page_title: "Бутикови торти за бебета | L'amore",
  consent_state: { ad_storage: true, analytics_storage: true },
  common_cookie: { _fbp: 'fb.1.1771157359510.1820557488.AQYAAQMA' },
  event_id: '1784145719210_17841462379145',
  ecommerce: {
    currency: 'EUR',
    value: 999.9,
    items: Array.from({ length: 10 }, (_, i) => ({
      item_id: String(2847 + i),
      item_name: `№ 00${i + 1} Торта за бебе`,
      item_category: 'Детски торти',
      price: 99.99,
      quantity: 1,
    })),
  },
});
const DATA_URL = 'https://lamore-bg.com/lmr/data?v=2&event=view_item_list_synapse';

function makeEnv() {
  const net = [];
  const pixels = [];
  const xhrs = [];
  const fetchMode = { reject: false, responseText: '' };
  const beaconMode = { ok: true };

  function Img() {
    const o = {};
    Object.defineProperty(o, 'src', {
      set(v) { pixels.push(String(v)); },
      get() { return ''; },
    });
    return o;
  }

  const w = {
    location: { href: 'https://lamore-bg.com/detski-torti/', origin: 'https://lamore-bg.com' },
    navigator: {
      language: 'bg-BG',
      sendBeacon: (u, d) => { net.push({ api: 'beacon', u: String(u), d }); return beaconMode.ok; },
    },
    screen: { width: 2560, height: 1440 },
    document: {
      title: 'Тест',
      referrer: '',
      getElementsByTagName: () => [{ parentNode: { insertBefore() {} } }],
      createElement: () => ({}),
    },
    dataLayer: [],
    Image: Img,
    btoa: (s) => Buffer.from(s, 'binary').toString('base64'),
    atob: (s) => Buffer.from(s, 'base64').toString('binary'),
    fetch: (u, o) => {
      net.push({ api: 'fetch', u: String(u), o });
      if (fetchMode.reject) {
        const p = Promise.reject(new TypeError('Failed to fetch'));
        p.catch(() => {});
        return p;
      }
      return Promise.resolve({ ok: true, status: 200, text: () => Promise.resolve(fetchMode.responseText) });
    },
    setInterval: () => 1,
    setTimeout: () => 1,
    clearInterval: () => {},
    clearTimeout: () => {},
    addEventListener: () => {},
    sessionStorage: { getItem: () => null, setItem: () => {} },
  };

  function XHR() { this._ls = {}; xhrs.push(this); }
  XHR.prototype.open = function (m, u) { this._m = m; this._u = String(u || ''); net.push({ api: 'xhr-open', m, u: this._u }); };
  XHR.prototype.send = function (b) { this._b = b; net.push({ api: 'xhr-send' }); };
  XHR.prototype.setRequestHeader = function () {};
  XHR.prototype.addEventListener = function (ev, fn) { (this._ls[ev] = this._ls[ev] || []).push(fn); };
  w.XMLHttpRequest = XHR;

  const sandbox = { window: w, document: w.document, URL, console };
  vm.createContext(sandbox);

  return {
    w, net, pixels, xhrs, fetchMode, beaconMode, sandbox,
    run: (code) => vm.runInContext(code, sandbox),
    flush: () => new Promise((r) => setImmediate(r)),
  };
}

// The vendored sender resolves fetch/Image/navigator/XMLHttpRequest as BARE
// globals (in a real page window === the global scope; in the vm they differ),
// so sender tests rebind them onto the vm global AFTER the wrappers installed.
const BIND = 'fetch = window.fetch; Image = window.Image; navigator = window.navigator; XMLHttpRequest = window.XMLHttpRequest;';

function dtdcOf(src) {
  const m = /[?&]dtdc=([^&]+)/.exec(src);
  if (!m) return null;
  return Buffer.from(decodeURIComponent(m[1]), 'base64').toString('utf8');
}

let pass = 0, fail = 0;
const queue = [];
function T(name, fn) { queue.push({ name, fn }); }
function eq(a, b, what) { if (a !== b) throw new Error(`${what}: ${JSON.stringify(a)} !== ${JSON.stringify(b)}`); }
function has(s, sub, what) { if (!s.includes(sub)) throw new Error(`${what}: missing "${sub}" in ${s.slice(0, 220)}`); }
function not(s, sub, what) { if (s.includes(sub)) throw new Error(`${what}: unexpected "${sub}"`); }

// T1 - healthy page: POST resolves -> rescue never fires.
T('T1 healthy POST /data -> no pixel', async (env) => {
  env.run(rescueOnly);
  env.run(`window.fetch(${JSON.stringify(DATA_URL)}, { method: 'POST', body: ${JSON.stringify(BODY)} })`);
  await env.flush();
  eq(env.pixels.length, 0, 'pixel count');
});

// T2 - blocked POST -> exactly one naked pixel, payload byte-identical.
T('T2 blocked POST /data -> one pixel, dtdc == body (UTF-8 roundtrip)', async (env) => {
  env.fetchMode.reject = true;
  env.run(rescueOnly);
  env.run(`window.fetch(${JSON.stringify(DATA_URL)}, { method: 'POST', body: ${JSON.stringify(BODY)} }).catch(function(){})`);
  await env.flush();
  eq(env.pixels.length, 1, 'pixel count');
  const src = env.pixels[0];
  has(src, 'https://lamore-bg.com/lmr/data?', 'naked first-party /data path');
  has(src, 'v=2&event=view_item_list_synapse&', 'original query preserved');
  has(src, '&_synr=1', 'rescue marker');
  eq(dtdcOf(src), BODY, 'dtdc payload');
});

// T3 - rejected POST to /g/collect -> not rescued (GA4 is the watchdog's job).
T('T3 blocked POST /g/collect -> no pixel', async (env) => {
  env.fetchMode.reject = true;
  env.run(rescueOnly);
  env.run(`window.fetch('https://lamore-bg.com/lmr/g/collect?v=2&en=page_view', { method: 'POST', body: 'en=x' }).catch(function(){})`);
  await env.flush();
  eq(env.pixels.length, 0, 'pixel count');
});

// T4 - rejected cross-origin /data -> untouched.
T('T4 blocked cross-origin /lmr/data -> no pixel', async (env) => {
  env.fetchMode.reject = true;
  env.run(rescueOnly);
  env.run(`window.fetch('https://other.example/lmr/data?v=2&event=x', { method: 'POST', body: '{}' }).catch(function(){})`);
  await env.flush();
  eq(env.pixels.length, 0, 'pixel count');
});

// T5 - rejected GET /data -> out of scope (small hits already travel as pixels).
T('T5 blocked GET /data -> no pixel', async (env) => {
  env.fetchMode.reject = true;
  env.run(rescueOnly);
  env.run(`window.fetch(${JSON.stringify(DATA_URL)}).catch(function(){})`);
  await env.flush();
  eq(env.pixels.length, 0, 'pixel count');
});

// T6 - non-string body -> skipped, no throw.
T('T6 blocked POST with Blob-like body -> no pixel, no throw', async (env) => {
  env.fetchMode.reject = true;
  env.run(rescueOnly);
  env.run(`window.fetch(${JSON.stringify(DATA_URL)}, { method: 'POST', body: { fake: 'blob' } }).catch(function(){})`);
  await env.flush();
  eq(env.pixels.length, 0, 'pixel count');
});

// T7 - dtdc already in the URL -> ambiguous, never guess.
T('T7 blocked POST with dtdc already in URL -> no pixel', async (env) => {
  env.fetchMode.reject = true;
  env.run(rescueOnly);
  env.run(`window.fetch('https://lamore-bg.com/lmr/data?v=2&event=x&dtdc=eyJ9', { method: 'POST', body: '{}' }).catch(function(){})`);
  await env.flush();
  eq(env.pixels.length, 0, 'pixel count');
});

// T8 - sendBeacon refusal -> pixel; success -> none. Return value preserved.
T('T8 sendBeacon false -> pixel (true -> none, retval preserved)', async (env) => {
  env.run(rescueOnly);
  env.beaconMode.ok = true;
  let r1 = env.run(`window.navigator.sendBeacon(${JSON.stringify(DATA_URL)}, ${JSON.stringify(BODY)})`);
  eq(r1, true, 'retval on success');
  eq(env.pixels.length, 0, 'no pixel on success');
  env.beaconMode.ok = false;
  let r2 = env.run(`window.navigator.sendBeacon(${JSON.stringify(DATA_URL)}, ${JSON.stringify(BODY)})`);
  eq(r2, false, 'retval on refusal');
  eq(env.pixels.length, 1, 'pixel on refusal');
  eq(dtdcOf(env.pixels[0]), BODY, 'dtdc payload');
});

// T9 - XHR network error -> pixel once (error+timeout double-fire guarded).
T('T9 XHR POST /data error -> one pixel; success -> none', async (env) => {
  env.run(rescueOnly);
  const x = env.run(`(function(){var x=new window.XMLHttpRequest();x.open('POST',${JSON.stringify(DATA_URL)});x.send(${JSON.stringify(BODY)});return x})()`);
  eq(env.pixels.length, 0, 'no pixel before error');
  (x._ls.error || []).forEach((f) => f());
  (x._ls.timeout || []).forEach((f) => f());
  eq(env.pixels.length, 1, 'exactly one pixel after error+timeout');
  eq(dtdcOf(env.pixels[0]), BODY, 'dtdc payload');
  const y = env.run(`(function(){var x=new window.XMLHttpRequest();x.open('POST',${JSON.stringify(DATA_URL)});x.send(${JSON.stringify(BODY)});return x})()`);
  eq(env.pixels.length, 1, 'successful XHR adds nothing');
});

// T10 - XHR GET /data -> listeners not even attached.
T('T10 XHR GET /data error -> no pixel', async (env) => {
  env.run(rescueOnly);
  const x = env.run(`(function(){var x=new window.XMLHttpRequest();x.open('GET','https://lamore-bg.com/lmr/data?v=2&event=p');x.send();return x})()`);
  (x._ls && x._ls.error || []).forEach((f) => f());
  eq(env.pixels.length, 0, 'pixel count');
});

// T11 - double include -> single wrap, single pixel.
T('T11 double include -> still exactly one pixel per failure', async (env) => {
  env.fetchMode.reject = true;
  env.run(rescueOnly);
  env.run(rescueOnly);
  env.run(`window.fetch(${JSON.stringify(DATA_URL)}, { method: 'POST', body: ${JSON.stringify(BODY)} }).catch(function(){})`);
  await env.flush();
  eq(env.pixels.length, 1, 'pixel count');
});

// T12 - no Image constructor -> fail open silently.
T('T12 window.Image missing -> no throw', async (env) => {
  env.fetchMode.reject = true;
  delete env.w.Image;
  env.run(rescueOnly);
  env.run(`window.fetch(${JSON.stringify(DATA_URL)}, { method: 'POST', body: '{}' }).catch(function(){})`);
  await env.flush();
  eq(env.pixels.length, 0, 'pixel count');
});

// T13 - full v1.6 stack (shim + rescue + watchdog): the POST leaves ei=-encoded,
// the rescue pixel stays naked, the rejection still propagates to the caller.
T('T13 combined stack: wire hit ei=-encoded, rescue pixel naked, rejection propagates', async (env) => {
  env.fetchMode.reject = true;
  env.run(combinedV16);
  env.run(`window.__callerSawReject = false; window.fetch(${JSON.stringify(DATA_URL)}, { method: 'POST', body: ${JSON.stringify(BODY)} }).catch(function(){ window.__callerSawReject = true; })`);
  await env.flush();
  const wire = env.net.filter((e) => e.api === 'fetch');
  eq(wire.length, 1, 'one wire attempt');
  has(wire[0].u, '?ei=', 'wire hit shim-encoded');
  not(wire[0].u, '/data?v=2', 'plain /data not on the wire');
  eq(env.pixels.length, 1, 'rescue pixel fired');
  has(env.pixels[0], 'https://lamore-bg.com/lmr/data?v=2&event=view_item_list_synapse&', 'pixel is the naked form');
  not(env.pixels[0], 'ei=', 'pixel not shim-encoded');
  eq(dtdcOf(env.pixels[0]), BODY, 'dtdc payload');
  eq(env.run('window.__callerSawReject'), true, 'original rejection still reaches the caller');
});

// T14 - combined stack healthy: nothing fires, wire hit still encoded exactly once.
T('T14 combined stack healthy -> no pixel, single encoded wire hit', async (env) => {
  env.run(combinedV16);
  env.run(`window.fetch(${JSON.stringify(DATA_URL)}, { method: 'POST', body: ${JSON.stringify(BODY)} })`);
  await env.flush();
  const wire = env.net.filter((e) => e.api === 'fetch');
  eq(wire.length, 1, 'one wire attempt');
  has(wire[0].u, '?ei=', 'wire hit shim-encoded');
  eq(env.pixels.length, 0, 'no pixel');
});

// --- v1.6.1: first-party Data Tag sender (vendored v9 + loaded-cache seed). ---

// T15 - static structure: sender before seed before rescue, exact seeded URL.
T('T15 render order sender -> seed -> rescue, all v9 globals vendored', async (env) => {
  const iSend = rescueOnly.indexOf('function dataTagSendData');
  const iSeed = rescueOnly.indexOf('gtm_dataTagScriptLoadedCache');
  const iResc = rescueOnly.indexOf('__synDataRescue');
  if (!(iSend >= 0 && iSeed > iSend && iResc > iSeed)) {
    throw new Error(`order: send=${iSend} seed=${iSeed} rescue=${iResc}`);
  }
  not(rescueOnly, 'stapecdn.com', 'third-party brand string hidden from source');
  has(rescueOnly, 'aHR0cHM6Ly9zdGFwZWNkbi5jb20vZHRhZy92OS5qcw==', 'seed key present base64-encoded');
  has(rescueOnly, 'function dataTagGetData', 'dataTagGetData vendored');
  has(rescueOnly, 'function dataTagMD5', 'dataTagMD5 vendored');
  has(rescueOnly, 'function dataTag256', 'dataTag256 vendored');
});

// T16 - the seed makes the Data Tag template take its no-inject branch.
T('T16 cache seeded + sender defined -> template calls it directly', async (env) => {
  env.run(rescueOnly);
  eq(env.run(`window.gtm_dataTagScriptLoadedCache && window.gtm_dataTagScriptLoadedCache['https://stapecdn.com/dtag/v9.js']`), true, 'cache seeded');
  eq(env.run('typeof dataTagSendData'), 'function', 'sender defined');
  // Literal decision the template makes (template.tpl): inject vs direct call.
  eq(env.run(`(function(){var u='https://stapecdn.com/dtag/v9.js';var c=window.gtm_dataTagScriptLoadedCache||{};return !c[u] ? 'inject' : 'direct'})()`), 'direct', 'template branch');
});

// T17 - sender fetch path: exact POST shape + response body -> dataLayer push.
T('T17 sender fetch POST shape + response -> dataLayer', async (env) => {
  env.fetchMode.responseText = '{"ok":1}';
  env.run(rescueOnly);
  env.run(BIND);
  env.run(`dataTagSendData(${BODY}, 'https://lamore-bg.com', '/lmr/data?v=2&event=view_item_list_synapse', 'data_tag_resp', 'dataLayer', false, true)`);
  await env.flush();
  await env.flush();
  const wire = env.net.filter((e) => e.api === 'fetch');
  eq(wire.length, 1, 'one wire attempt');
  eq(wire[0].u, DATA_URL, 'url');
  eq(wire[0].o.method, 'POST', 'method');
  eq(wire[0].o.headers['Content-Type'], 'text/plain', 'content type');
  eq(wire[0].o.credentials, 'include', 'credentials');
  eq(wire[0].o.keepalive, true, 'keepalive');
  eq(wire[0].o.body, BODY, 'body byte-identical');
  eq(env.pixels.length, 0, 'no pixel on healthy send');
  eq(env.w.dataLayer.length, 1, 'dataLayer push count');
  eq(env.w.dataLayer[0].ok, 1, 'response body merged');
  eq(env.w.dataLayer[0].status, 200, 'status');
  eq(env.w.dataLayer[0].event, 'data_tag_resp', 'event name');
});

// T18 - THE Brave case, full stack: seed -> sender -> fetch rejected in
// transit -> exactly one naked rescue pixel with the byte-identical payload.
T('T18 BRAVE e2e: sender fetch rejected -> naked rescue pixel, wire ei=-encoded', async (env) => {
  env.fetchMode.reject = true;
  env.run(combinedV16);
  env.run(BIND);
  env.run(`dataTagSendData(${BODY}, 'https://lamore-bg.com', '/lmr/data?v=2&event=view_item_list_synapse', false, false, false, true)`);
  await env.flush();
  await env.flush();
  const wire = env.net.filter((e) => e.api === 'fetch');
  eq(wire.length, 1, 'one wire attempt');
  has(wire[0].u, '?ei=', 'wire attempt shim-encoded');
  not(wire[0].u, '/data?v=2', 'plain /data not on the wire');
  eq(env.pixels.length, 1, 'rescue pixel fired');
  has(env.pixels[0], 'https://lamore-bg.com/lmr/data?v=2&event=view_item_list_synapse&', 'naked pixel form');
  has(env.pixels[0], '&_synr=1', 'rescue marker');
  not(env.pixels[0], 'ei=', 'pixel not encoded');
  eq(dtdcOf(env.pixels[0]), BODY, 'payload byte-identical');
});

// T19 - SSE response: instructed send_pixel fires + response merged to dataLayer.
T('T19 sender SSE response: instructed pixel + dataLayer merge', async (env) => {
  env.fetchMode.responseText = 'event: message\ndata: {"send_pixel":["https://lamore-bg.com/px.gif"],"response":{"status_code":200,"body":"{\\"srv\\":1}"}}\n\n';
  env.run(rescueOnly);
  env.run(BIND);
  env.run(`dataTagSendData(${BODY}, 'https://lamore-bg.com', '/lmr/data?v=2&event=view_item_list_synapse', 'data_tag_resp', 'dataLayer', false, true)`);
  await env.flush();
  await env.flush();
  eq(env.pixels.length, 1, 'one instructed pixel');
  eq(env.pixels[0], 'https://lamore-bg.com/px.gif', 'instructed pixel url');
  not(env.pixels[0], '_synr', 'not a rescue pixel');
  eq(env.w.dataLayer.length, 1, 'dataLayer push count');
  eq(env.w.dataLayer[0].srv, 1, 'SSE response body merged');
  eq(env.w.dataLayer[0].status, 200, 'SSE status merged');
  eq(env.w.dataLayer[0].event, 'data_tag_resp', 'event name');
});

// T20 - sender XHR path (useFetchInsteadOfXHR=false) + rescue on network error.
T('T20 sender XHR path blocked -> rescue pixel', async (env) => {
  env.run(rescueOnly);
  env.run(BIND);
  env.run(`dataTagSendData(${BODY}, 'https://lamore-bg.com', '/lmr/data?v=2&event=view_item_list_synapse', false, false, false, false)`);
  const opens = env.net.filter((e) => e.api === 'xhr-open');
  eq(opens.length, 1, 'one xhr open');
  eq(opens[0].m, 'POST', 'method');
  eq(opens[0].u, DATA_URL, 'url');
  eq(env.pixels.length, 0, 'no pixel before error');
  const x = env.xhrs[env.xhrs.length - 1];
  (x._ls.error || []).forEach((f) => f());
  eq(env.pixels.length, 1, 'rescue pixel after xhr error');
  eq(dtdcOf(env.pixels[0]), BODY, 'payload byte-identical');
});

for (const { name, fn } of queue) {
  const env = makeEnv();
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
process.exit((fail || !__fresh) ? 1 : 0);
