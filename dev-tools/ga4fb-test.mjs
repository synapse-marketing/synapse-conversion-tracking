// GA4 measurement-recovery watchdog - functional tests over the EXACT rendered JS.
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
  : 'synapse-conversion-tracking v2.0.3';
const __fresh = requireFresh(PLUGIN_DIR, path.basename(fileURLToPath(import.meta.url)));
const combinedOn = fs.readFileSync(path.join(dir, 'combined-shim-on.js'), 'utf8');
const combinedOff = fs.readFileSync(path.join(dir, 'combined-shim-off.js'), 'utf8');

// Representative loader IIFE (same shape print_synapse_gtm_code emits after the shim+watchdog).
const loader = `(function(w,d,s,l,i){w[l]=w[l]||[];w[l].push({'gtm.start':new Date().getTime(),event:'gtm.js'});var f=d.getElementsByTagName(s)[0],j=d.createElement(s);j.async=true;j.src="https://lamore-bg.com/lmr/Bbca96fbh8l.js?"+i;f.parentNode.insertBefore(j,f);})(window,document,'script','dataLayer','dY=aWQ9R1RNLU5RSFFIWkxS&asq=2');`;

const GRANT = [
  ['consent', 'default', { ad_storage: 'denied', analytics_storage: 'denied' }],
  ['consent', 'update', { ad_storage: 'granted', ad_user_data: 'granted', ad_personalization: 'granted', analytics_storage: 'granted' }],
];
const DENY = [['consent', 'default', { ad_storage: 'denied', analytics_storage: 'denied' }]];

function makeEnv({ consent = GRANT, storage = 'ok', prefill = null } = {}) {
  const net = [];
  const timers = { q: [], seq: 1 };
  const clock = { now: 1784111000000 };
  const listeners = {};
  const bag = new Map();
  if (prefill) bag.set('_synfb', prefill);

  const w = {
    location: { href: 'https://lamore-bg.com/detski-torti/', origin: 'https://lamore-bg.com' },
    navigator: { language: 'bg-BG', sendBeacon: (u) => { net.push({ api: 'beacon', u: String(u) }); return true; } },
    screen: { width: 390, height: 844 },
    document: {
      title: 'Тест',
      referrer: 'https://www.google.com/',
      getElementsByTagName: () => [{ parentNode: { insertBefore() {} } }],
      createElement: () => ({}),
    },
    dataLayer: consent.map((e) => e.slice()),
    btoa: (s) => Buffer.from(s, 'binary').toString('base64'),
    fetch: (u, o) => { net.push({ api: 'fetch', u: String(u), o }); return { catch() { return this; } }; },
    setInterval: (fn, ms) => { const id = timers.seq++; timers.q.push({ id, fn, at: clock.now + ms, every: ms }); return id; },
    setTimeout: (fn, ms) => { const id = timers.seq++; timers.q.push({ id, fn, at: clock.now + ms }); return id; },
    clearInterval: (id) => { timers.q = timers.q.filter((t) => t.id !== id); },
    clearTimeout: (id) => { timers.q = timers.q.filter((t) => t.id !== id); },
    addEventListener: (ev, fn) => { (listeners[ev] = listeners[ev] || []).push(fn); },
  };
  function XHR() {}
  XHR.prototype.open = function () { net.push({ api: 'xhr', u: String(arguments[1] || '') }); };
  w.XMLHttpRequest = XHR;

  if (storage === 'ok') {
    w.sessionStorage = { getItem: (k) => (bag.has(k) ? bag.get(k) : null), setItem: (k, v) => bag.set(k, String(v)) };
  } else if (storage === 'throw') {
    Object.defineProperty(w, 'sessionStorage', { get() { throw new Error('denied'); } });
  }

  function FakeDate() { return { getTime: () => clock.now }; }
  FakeDate.now = () => clock.now;

  const sandbox = { window: w, document: w.document, URL, Date: FakeDate, console };
  vm.createContext(sandbox);

  function advance(ms) {
    const end = clock.now + ms;
    for (;;) {
      timers.q.sort((a, b) => a.at - b.at);
      const t = timers.q.find((t) => t.at <= end);
      if (!t) break;
      clock.now = Math.max(clock.now, t.at);
      if (t.every) t.at += t.every; else timers.q = timers.q.filter((x) => x.id !== t.id);
      t.fn();
    }
    clock.now = end;
  }

  return {
    w, net, timers, clock, listeners, bag, sandbox, advance,
    run: (code) => vm.runInContext(code, sandbox),
    containerUp: () => { w.google_tag_manager = { 'GTM-NQHQHZLR': {} }; },
    pagehide: () => (listeners.pagehide || []).forEach((f) => f()),
  };
}

function realUrl(u) {
  const m = /[?&]ei=([A-Za-z0-9_-]+)/.exec(u);
  if (!m) return u;
  const b = m[1].replace(/-/g, '+').replace(/_/g, '/');
  return 'https://lamore-bg.com/lmr' + Buffer.from(b + '='.repeat((4 - (b.length % 4)) % 4), 'base64').toString('utf8');
}
const recovered = (net) => net.filter((e) => realUrl(e.u).includes('synapse_recovered'));

let pass = 0, fail = 0;
function T(name, fn) {
  try { fn(); pass++; console.log('  OK  ' + name); }
  catch (e) { fail++; console.log('FAIL  ' + name + ' -> ' + e.message); }
}
function eq(a, b, what) { if (a !== b) throw new Error(`${what}: ${JSON.stringify(a)} !== ${JSON.stringify(b)}`); }
function has(s, sub, what) { if (!s.includes(sub)) throw new Error(`${what}: missing "${sub}" in ${s.slice(0, 220)}`); }
function not(s, sub, what) { if (s.includes(sub)) throw new Error(`${what}: unexpected "${sub}"`); }

// T1 - normal browser: gtag alive -> watchdog silent.
T('T1 gtag alive -> no recovery hit', () => {
  const env = makeEnv();
  env.run(combinedOn + loader);
  env.advance(1000); env.containerUp();
  env.advance(500);
  env.run(`window.fetch('https://lamore-bg.com/lmr/g/collect?v=2&tid=G-SYYEZHP7BL&en=page_view')`);
  env.advance(15000);
  eq(recovered(env.net).length, 0, 'recovered count');
  const g = env.net.filter((e) => realUrl(e.u).includes('/g/collect'));
  eq(g.length, 1, 'gtag hits pass through');
  has(g[0].u, '?ei=', 'gtag hit still shim-encoded on the wire');
});

// T2 - iOS-private shape: container runs, gtag silent -> exactly one recovered page_view.
T('T2 gtag dead -> one recovered page_view (granted)', () => {
  const env = makeEnv();
  env.run(combinedOn + loader);
  env.advance(1000); env.containerUp();
  env.advance(15000);
  const r = recovered(env.net);
  eq(r.length, 1, 'recovered count');
  eq(r[0].api, 'fetch', 'sent via fetch');
  eq(r[0].o && r[0].o.keepalive, true, 'keepalive');
  has(r[0].u, '?ei=', 'wire URL encoded');
  not(r[0].u, '/g/collect', 'plain path hidden on the wire');
  const d = realUrl(r[0].u);
  has(d, '/g/collect?v=2&tid=G-SYYEZHP7BL', 'decoded endpoint');
  has(d, 'en=page_view', 'event');
  has(d, 'ep.synapse_recovered=1', 'marker');
  has(d, 'gcs=G111', 'consent granted');
  has(d, 'npa=0', 'npa');
  has(d, '_fv=1', 'first visit'); has(d, '_ss=1', 'session start'); has(d, '_nsi=1', 'nsi');
  has(d, 'seg=0', 'seg first');
  has(d, 'sr=390x844', 'screen'); has(d, 'ul=bg-bg', 'lang');
  has(d, 'dl=' + encodeURIComponent('https://lamore-bg.com/detski-torti/'), 'dl');
  has(d, 'dr=' + encodeURIComponent('https://www.google.com/'), 'dr');
  if (!/cid=\d{9}\.\d{10}/.test(d)) throw new Error('cid format: ' + d);
  if (!/sid=\d{10}/.test(d)) throw new Error('sid format');
});

// T3 - container never loads -> nothing ever sent, poller gives up, pagehide inert.
T('T3 container never loads -> inert', () => {
  const env = makeEnv();
  env.run(combinedOn + loader);
  env.advance(200000);
  env.pagehide();
  eq(recovered(env.net).length, 0, 'recovered count');
  eq(env.timers.q.length, 0, 'poller gave up');
});

// T4 - consent denied -> G100 ping, storage untouched.
T('T4 denied consent -> G100/npa=1, no storage', () => {
  const env = makeEnv({ consent: DENY });
  env.run(combinedOn + loader);
  env.advance(1000); env.containerUp();
  env.advance(15000);
  const r = recovered(env.net); eq(r.length, 1, 'recovered count');
  const d = realUrl(r[0].u);
  has(d, 'gcs=G100', 'gcs denied'); has(d, 'npa=1', 'npa denied');
  eq(env.bag.size, 0, 'sessionStorage untouched');
});

// T5 - second page of the session -> stored cid/sid, no _fv/_ss, seg=1.
T('T5 second page -> stored ids, seg=1', () => {
  const env = makeEnv({ prefill: '{"cid":"123456789.1784110000","sid":1784110000}' });
  env.run(combinedOn + loader);
  env.advance(1000); env.containerUp();
  env.advance(15000);
  const d = realUrl(recovered(env.net)[0].u);
  has(d, 'cid=123456789.1784110000', 'stored cid');
  has(d, 'sid=1784110000', 'stored sid');
  has(d, 'seg=1', 'engaged');
  not(d, '_fv=1', 'no first-visit'); not(d, '_ss=1', 'no session-start');
});

// T6 - sessionStorage throws -> memory fallback still fires.
T('T6 storage throws -> still recovers', () => {
  const env = makeEnv({ storage: 'throw' });
  env.run(combinedOn + loader);
  env.advance(1000); env.containerUp();
  env.advance(15000);
  const d = realUrl(recovered(env.net)[0].u);
  has(d, '_fv=1', 'treated as first');
  if (!/cid=\d{9}\.\d{10}/.test(d)) throw new Error('cid format');
});

// T7 - pagehide after arm+2.5s fires early, later timer does not double-send.
T('T7 pagehide early-fire, no double send', () => {
  const env = makeEnv();
  env.run(combinedOn + loader);
  env.advance(1000); env.containerUp();
  env.advance(4000); // armT at ~1500 (first poll tick), now well past +2500
  env.pagehide();
  eq(recovered(env.net).length, 1, 'fired on pagehide');
  env.advance(20000);
  eq(recovered(env.net).length, 1, 'no double send');
});

// T8 - pagehide within 2.5s of arm is guarded; the 8s timer still recovers.
T('T8 pagehide guard <2.5s', () => {
  const env = makeEnv();
  env.run(combinedOn + loader);
  env.advance(1000); env.containerUp();
  env.advance(1000);
  env.pagehide();
  eq(recovered(env.net).length, 0, 'guarded');
  env.advance(15000);
  eq(recovered(env.net).length, 1, 'timer recovered later');
});

// T9/T10 - gtag via XHR / sendBeacon counts as alive.
T('T9 XHR gtag counts as alive', () => {
  const env = makeEnv();
  env.run(combinedOn + loader);
  env.advance(1000); env.containerUp();
  env.run(`var x=new window.XMLHttpRequest();x.open('POST','https://lamore-bg.com/lmr/g/collect?v=2&tid=G-X');`);
  env.advance(15000);
  eq(recovered(env.net).length, 0, 'no recovery');
});
T('T10 sendBeacon gtag counts as alive', () => {
  const env = makeEnv();
  env.run(combinedOn + loader);
  env.advance(1000); env.containerUp();
  env.run(`window.navigator.sendBeacon('https://lamore-bg.com/lmr/g/collect?v=2&tid=G-X','x')`);
  env.advance(15000);
  eq(recovered(env.net).length, 0, 'no recovery');
});

// T11 - shim disabled -> recovery hit goes out PLAIN but still goes out.
T('T11 shim off -> plain first-party hit', () => {
  const env = makeEnv();
  env.run(combinedOff + loader);
  env.advance(1000); env.containerUp();
  env.advance(15000);
  const r = recovered(env.net); eq(r.length, 1, 'recovered count');
  has(r[0].u, 'https://lamore-bg.com/lmr/g/collect?', 'plain URL');
  not(r[0].u, '?ei=', 'no encoding without shim');
});

// T12 - loader still works alongside (gtm.start pushed, script injected).
T('T12 loader unaffected', () => {
  const env = makeEnv();
  env.run(combinedOn + loader);
  const started = env.w.dataLayer.some((e) => e && typeof e === 'object' && !Array.isArray(e) && e.event === 'gtm.js');
  eq(started, true, 'gtm.start pushed');
});

// T13 - double inclusion is idempotent.
T('T13 idempotent on double include', () => {
  const env = makeEnv();
  env.run(combinedOn + loader);
  env.run(combinedOn);
  env.advance(1000); env.containerUp();
  env.advance(15000);
  eq(recovered(env.net).length, 1, 'single hit despite double include');
});

// T14 - no CMP entries at all -> treated as granted (consent mode inactive).
T('T14 no consent entries -> G111', () => {
  const env = makeEnv({ consent: [] });
  env.run(combinedOn + loader);
  env.advance(1000); env.containerUp();
  env.advance(15000);
  const d = realUrl(recovered(env.net)[0].u);
  has(d, 'gcs=G111', 'implicit grant');
});

// ===== v1.5.0: full-event recovery =====
const combinedNoSuf = fs.readFileSync(path.join(dir, 'combined-nosuffix.js'), 'utf8');
const VI = {
  event: 'view_item_synapse',
  ecomm_pagetype: 'product',
  ecommerce: { currency: 'EUR', value: '99.9', items: [{ item_id: 2891, item_name: 'Торта за бебе', item_sku: 'T-001', price: '99.9', item_category: 'Детски торти', imageUrl: 'https://x/y.jpg' }] },
};
const VIL = {
  event: 'view_item_list_synapse',
  ecommerce: { currency: 'EUR', items: [{ item_id: 1, item_name: 'A~B' }, { item_id: 2, item_name: 'C' }] },
};

// T15 - events already in dataLayer are replayed once after page_view, translated.
T('T15 replay: view_item + view_item_list recovered with items', () => {
  const env = makeEnv();
  env.w.dataLayer.push({ ecommerce: null }, VI, { ecommerce: null }, VIL);
  env.run(combinedOn + loader);
  env.advance(1000); env.containerUp();
  env.advance(15000);
  const r = recovered(env.net).map((e) => realUrl(e.u));
  eq(r.length, 3, 'page_view + 2 events');
  has(r[0], 'en=page_view', 'first is page_view');
  has(r[0], '_s=1', 'hit 1'); has(r[0], '_fv=1', 'first flags only on hit 1');
  has(r[1], 'en=view_item', 'suffix stripped');
  not(r[1], '_fv=1', 'no first flags on later hits');
  has(r[1], '_s=2', 'hit counter');
  has(r[1], 'cu=EUR', 'currency'); has(r[1], 'epn.value=99.9', 'value');
  has(decodeURIComponent(r[1]), 'pr1=id2891~nmТорта за бебе~caДетски торти~pr99.9', 'items translated');
  not(decodeURIComponent(r[1]), 'imageUrl', 'unknown item keys skipped');
  has(r[2], 'en=view_item_list', 'second event');
  has(decodeURIComponent(r[2]), 'pr1=id1~nmA B', 'tilde stripped from values');
  has(decodeURIComponent(r[2]), 'pr2=id2~nmC', 'second item');
});

// T16 - events pushed AFTER gtag declared dead are sent immediately via the hook.
T('T16 live push after death -> immediate send', () => {
  const env = makeEnv();
  env.run(combinedOn + loader);
  env.advance(1000); env.containerUp();
  env.advance(15000);
  eq(recovered(env.net).length, 1, 'only page_view so far');
  env.w.dataLayer.push(VI);
  const r = recovered(env.net).map((e) => realUrl(e.u));
  eq(r.length, 2, 'event sent on push, no timer needed');
  has(r[1], 'en=view_item', 'translated');
});

// T17 - healthy browser: dataLayer.push NEVER wrapped, no events sent.
T('T17 gtag alive -> dataLayer untouched', () => {
  const env = makeEnv();
  const origPush = env.w.dataLayer.push;
  env.run(combinedOn + loader);
  env.advance(1000); env.containerUp();
  env.run(`window.fetch('https://lamore-bg.com/lmr/g/collect?v=2&tid=G-X&en=page_view')`);
  env.advance(20000);
  env.w.dataLayer.push(VI);
  eq(recovered(env.net).length, 0, 'nothing recovered');
  eq(env.w.dataLayer.push === origPush || env.w.dataLayer.push.name !== '', true, 'push not replaced by watchdog');
});

// T18 - non-suffixed / internal dataLayer entries are ignored.
T('T18 internal events ignored', () => {
  const env = makeEnv();
  env.w.dataLayer.push({ event: 'gtm.click' }, { event: 'cookie_consent_update' }, { ecommerce: null }, ['consent', 'update', { ad_storage: 'granted' }]);
  env.run(combinedOn + loader);
  env.advance(1000); env.containerUp();
  env.advance(15000);
  const r = recovered(env.net);
  eq(r.length, 1, 'only page_view');
});

// T19 - whitelist mode (custom naming off): plain standard names pass, others don't.
T('T19 no-suffix config -> whitelist mode', () => {
  const env = makeEnv();
  env.w.dataLayer.push({ event: 'view_item', ecommerce: VI.ecommerce }, { event: 'weird_event' });
  env.run(combinedNoSuf + loader);
  env.advance(1000); env.containerUp();
  env.advance(15000);
  const r = recovered(env.net).map((e) => realUrl(e.u));
  eq(r.length, 2, 'page_view + view_item');
  has(r[1], 'en=view_item', 'standard name passed');
  eq(r.some((u) => u.includes('weird_event')), false, 'non-standard skipped');
});

// T20 - pagehide fire also replays pending events.
T('T20 pagehide fire includes events', () => {
  const env = makeEnv();
  env.w.dataLayer.push(VI);
  env.run(combinedOn + loader);
  env.advance(1000); env.containerUp();
  env.advance(4000);
  env.pagehide();
  const r = recovered(env.net).map((e) => realUrl(e.u));
  eq(r.length, 2, 'page_view + view_item at pagehide');
});

// T21 - purchase mapping incl. transaction id.
T('T21 purchase params', () => {
  const env = makeEnv();
  env.w.dataLayer.push({ event: 'purchase_synapse', ecommerce: { transaction_id: 'ORD-77', currency: 'EUR', value: 123.5, tax: 1.5, shipping: 4, items: [{ item_id: 9, item_name: 'X', quantity: 2, price: 59 }] } });
  env.run(combinedOn + loader);
  env.advance(1000); env.containerUp();
  env.advance(15000);
  const d = recovered(env.net).map((e) => realUrl(e.u)).find((u) => u.includes('en=purchase'));
  if (!d) throw new Error('no purchase hit');
  has(d, 'ep.transaction_id=ORD-77', 'transaction id');
  has(d, 'epn.value=123.5', 'value'); has(d, 'epn.tax=1.5', 'tax'); has(d, 'epn.shipping=4', 'shipping');
  has(decodeURIComponent(d), 'pr1=id9~nmX~pr59~qt2', 'item with qty');
});

console.log(`\n${pass}/${pass + fail} passed${fail ? ' - FAILURES ABOVE' : ''}`);
process.exit((fail || !__fresh) ? 1 : 0);
