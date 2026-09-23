// Ad-blocker shim + GA4 sentinel - tested against the LIVE PHP source.
//
// Both scripts are rendered out of class-gtm-server-side-tracking-code.php on
// every run by render-boot.mjs, so there is no snapshot to go stale. The only
// previous coverage of these two lived in combined-shim-on.js, a July render
// that was still reporting green two months after the source moved on.
import vm from 'node:vm';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { execFileSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';

const dir = path.dirname(fileURLToPath(import.meta.url));
const argIdx = process.argv.indexOf('--plugin');
const PLUGIN_DIR = argIdx !== -1 && process.argv[argIdx + 1] ? process.argv[argIdx + 1] : 'synapse-conversion-tracking v2.0.1';

// Rendered fresh from the PHP on every run by render-boot.mjs, into a temp
// directory - so there is no snapshot in the repo that can drift away from the
// source while still reporting green.
const OUT = fs.mkdtempSync(path.join(os.tmpdir(), 'syn-sentinel-'));
execFileSync(process.execPath, [path.join(dir, 'render-boot.mjs'), '--plugin', PLUGIN_DIR, '--out', OUT], { stdio: 'pipe' });

const TID = 'G-SYYEZHP7BL';   // the measurement id render-boot binds
const ORIGIN = 'https://shop.test';
const sentinelJs = fs.readFileSync(path.join(OUT, 'edge-sentinel17.js'), 'utf8');
const shimJs = fs.readFileSync(path.join(OUT, 'shim17.js'), 'utf8');

let pass = 0, fail = 0;
const T = (name, fn) => {
  try { fn(); pass++; console.log(`  OK  ${name}`); }
  catch (e) { fail++; console.log(`FAIL  ${name} -> ${e.message}`); }
};
const ok = (c, what) => { if (!c) throw new Error(what); };
const eq = (a, b, what) => { if (a !== b) throw new Error(`${what}: ${JSON.stringify(a)} !== ${JSON.stringify(b)}`); };

function makeWindow() {
  const calls = { fetch: [], beacon: [], xhrSent: [], xhrs: [], pixels: [] };
  // What the next fetch/XHR "server" answers with. 200 unless a test says so.
  const state = { fetchStatus: 200 };
  function FakeXHR() { this._h = []; this._l = {}; calls.xhrs.push(this); }
  FakeXHR.prototype.open = function (m, u) { this._m = m; this._u = u; };
  FakeXHR.prototype.setRequestHeader = function (k, v) { this._h.push([k, v]); };
  FakeXHR.prototype.addEventListener = function (ev, fn) { (this._l[ev] = this._l[ev] || []).push(fn); };
  FakeXHR.prototype.send = function (b) { this._b = b; calls.xhrSent.push([this._m, this._u, b]); };
  // The test plays the server: set a status and fire "load".
  FakeXHR.prototype._respond = function (status) { this.status = status; (this._l.load || []).forEach((fn) => fn.call(this)); };
  class FakeRequest {
    constructor(input, init) {
      this.url = typeof input === 'string' ? input : input.url;
      const base = typeof input === 'object' ? input : {};
      this.method = (init && init.method) || base.method || 'GET';
      this.body = (init && init.body) !== undefined ? init.body : base.body;
      this.keepalive = (init && init.keepalive) !== undefined ? init.keepalive : base.keepalive;
    }
    clone() { return new FakeRequest(this.url, { method: this.method, body: this.body, keepalive: this.keepalive }); }
  }
  const w = {
    location: { origin: ORIGIN, href: ORIGIN + '/product/x' },
    URL, URLSearchParams, Request: FakeRequest, btoa: (s) => Buffer.from(s, 'binary').toString('base64'),
    navigator: { sendBeacon: (u, d) => { calls.beacon.push([String(u), d]); return true; } },
    XMLHttpRequest: FakeXHR,
    // A synchronous thenable: the shim's .then(cb) runs cb during the call, so
    // a test can assert on a resend without awaiting. The logic under test
    // does not depend on when the response arrives, only on what it says.
    fetch: function (i, o) {
      calls.fetch.push([typeof i === 'string' ? i : (i && i.url), o, i]);
      const st = state.fetchStatus;
      const res = { status: st, ok: st < 300 };
      return { then(okFn) { try { okFn && okFn(res); } catch (x) {} return this; }, catch() { return this; } };
    },
    Image: function () { const img = {}; calls.pixels.push(img); return img; },
    __synSeen: undefined,
  };
  const sandbox = { window: w, URL, URLSearchParams, Request: FakeRequest };
  vm.createContext(sandbox);
  return { w, calls, state, run: (code) => vm.runInContext(code, sandbox) };
}

console.log(`\nsentinel + shim, read from live PHP  (${PLUGIN_DIR})\n`);

/* ---------------- sentinel ---------------- */
// The sentinel RECORDS; the watchdog decides. It must not carry the
// measurement id, which is camouflaged in the page source, so it notes which
// property each hit was for and leaves the matching to the tail.
T('S1 a /g/collect is recorded against the property it was for', () => {
  const e = makeWindow(); e.run(sentinelJs);
  e.w.fetch(ORIGIN + '/lmr/g/collect?v=2&tid=' + TID);
  eq(e.w.__synSeen, 1, 'coarse flag set');
  eq(e.w.__synSeenT[TID], 1, 'recorded under our property');
});
T('S2 a hit for a DIFFERENT property is not recorded as ours', () => {
  const e = makeWindow(); e.run(sentinelJs);
  e.w.fetch(ORIGIN + '/lmr/g/collect?v=2&tid=G-OTHER');
  eq(e.w.__synSeenT['G-OTHER'], 1, 'recorded under the other property');
  eq(e.w.__synSeenT[TID], undefined, 'ours stays unheard, so recovery still runs');
});
// GA4 can put its parameters in the POST body rather than the query. Reading
// the id out of the body is what stops a hit for somebody else's property
// being recorded as a wildcard and silencing recovery for ours. Only values
// that can be read without touching a stream are inspected, so the request
// that goes out is byte for byte the one the caller made.
T('S3 a tid carried only in the POST body is recorded under that property', () => {
  const e = makeWindow(); e.run(sentinelJs);
  e.w.fetch(ORIGIN + '/lmr/g/collect', { method: 'POST', body: 'v=2&tid=' + TID + '&en=page_view' });
  eq(e.w.__synSeenT[TID], 1, 'read out of the body');
  eq(e.w.__synSeenT['*'], undefined, 'not left as an unidentified hit');
});
T('S3b a body for a DIFFERENT property does not silence ours', () => {
  const e = makeWindow(); e.run(sentinelJs);
  e.w.fetch(ORIGIN + '/lmr/g/collect', { method: 'POST', body: 'v=2&tid=G-OTHER' });
  eq(e.w.__synSeenT['G-OTHER'], 1, 'recorded under the other property');
  eq(e.w.__synSeenT[TID], undefined, 'ours stays unheard');
  eq(e.w.__synSeenT['*'], undefined, 'and it is not a wildcard either');
});
T('S3c a hit with no tid anywhere is still recorded as a wildcard', () => {
  const e = makeWindow(); e.run(sentinelJs);
  e.w.fetch(ORIGIN + '/lmr/g/collect', { method: 'POST', body: 'v=2&en=page_view' });
  eq(e.w.__synSeenT['*'], 1, 'unidentified, so it counts for everyone');
});
T('S3d a URLSearchParams body is read without being consumed', () => {
  const e = makeWindow(); e.run(sentinelJs);
  const body = new URLSearchParams({ v: '2', tid: TID });
  e.w.fetch(ORIGIN + '/lmr/g/collect', { method: 'POST', body: body });
  eq(e.w.__synSeenT[TID], 1, 'read out of the params');
  eq(body.get('tid'), TID, 'and the caller\'s object is untouched');
});
T('S3e a Request body is never read, so its stream is never consumed', () => {
  const e = makeWindow(); e.run(sentinelJs);
  let touched = false;
  const req = { url: ORIGIN + '/lmr/g/collect', method: 'POST', get body() { touched = true; return 'tid=' + TID; } };
  e.w.fetch(req);
  ok(!touched, 'the request body was not touched');
  eq(e.w.__synSeenT['*'], 1, 'so it is recorded as unidentified, which is the safe side');
});
T('S3f the measurement id never appears in the sentinel source', () => {
  ok(sentinelJs.indexOf('G-') === -1, 'no readable Google id in the page');
});
T('S4 a cross-origin collect is not ours', () => {
  const e = makeWindow(); e.run(sentinelJs);
  e.w.fetch('https://www.google-analytics.com/g/collect?tid=' + TID);
  eq(e.w.__synSeen, undefined, 'flag untouched');
});
T('S5 an XHR that is opened but never sent is not proof of life', () => {
  const e = makeWindow(); e.run(sentinelJs);
  const x = new e.w.XMLHttpRequest();
  x.open('POST', ORIGIN + '/lmr/g/collect?tid=' + TID);
  eq(e.w.__synSeen, undefined, 'open() alone does not count');
  ok(!e.w.__synSeenT || !e.w.__synSeenT[TID], 'nothing recorded either');
});
T('S6 ...and the same XHR counts once it is actually sent', () => {
  const e = makeWindow(); e.run(sentinelJs);
  const x = new e.w.XMLHttpRequest();
  x.open('POST', ORIGIN + '/lmr/g/collect?tid=' + TID);
  x.send('body');
  eq(e.w.__synSeen, 1, 'send() counts');
});
T('S7 sendBeacon counts', () => {
  const e = makeWindow(); e.run(sentinelJs);
  e.w.navigator.sendBeacon(ORIGIN + '/lmr/g/collect?tid=' + TID, 'x');
  eq(e.w.__synSeen, 1, 'flag set');
});
T('S8 the sentinel installs only once', () => {
  const e = makeWindow(); e.run(sentinelJs);
  const first = e.w.fetch;
  e.run(sentinelJs);
  eq(e.w.fetch, first, 'second run is a no-op');
});

/* ---------------- shim ---------------- */
const decodeEi = (u) => {
  const q = new URL(u).searchParams.get('ei');
  return Buffer.from(q.replace(/-/g, '+').replace(/_/g, '/'), 'base64').toString('utf8');
};

T('H1 fetch(url, init) keeps the caller init', () => {
  const e = makeWindow(); e.run(shimJs);
  e.w.fetch(ORIGIN + '/lmr/g/collect?v=2', { method: 'POST', body: 'payload', keepalive: true });
  const [, init] = e.calls.fetch[0];
  eq(init.method, 'POST', 'method'); eq(init.body, 'payload', 'body'); eq(init.keepalive, true, 'keepalive');
});
T('H2 fetch(Request, init) keeps the caller init too', () => {
  const e = makeWindow(); e.run(shimJs);
  const req = new e.w.Request(ORIGIN + '/lmr/g/collect?v=2');   // a GET Request
  e.w.fetch(req, { method: 'POST', body: 'payload', keepalive: true });
  const [, init] = e.calls.fetch[0];
  ok(!!init, 'the second argument survived the masked branch');
  eq(init.method, 'POST', 'method'); eq(init.body, 'payload', 'body');
});
T('H3 the encoded URL decodes back to the original path and query', () => {
  const e = makeWindow(); e.run(shimJs);
  e.w.fetch(ORIGIN + '/lmr/g/collect?v=2&tid=' + TID);
  const sent = e.calls.fetch[0][0];
  ok(sent.indexOf('/g/collect') === -1, 'the blockable pattern is gone from the URL');
  eq(decodeEi(sent), '/g/collect?v=2&tid=' + TID, 'round-trips');
});
T('H4 the container script is never encoded', () => {
  const e = makeWindow(); e.run(shimJs);
  e.w.fetch(ORIGIN + '/lmr/gtm.js?id=GTM-X');
  eq(e.calls.fetch[0][0], ORIGIN + '/lmr/gtm.js?id=GTM-X', 'left alone');
});
T('H5 any .js under the prefix is left alone', () => {
  const e = makeWindow(); e.run(shimJs);
  e.w.fetch(ORIGIN + '/lmr/s.js');
  eq(e.calls.fetch[0][0], ORIGIN + '/lmr/s.js', 'left alone');
});
T('H6 a cross-origin request is left alone', () => {
  const e = makeWindow(); e.run(shimJs);
  e.w.fetch('https://other.test/lmr/g/collect?v=2');
  eq(e.calls.fetch[0][0], 'https://other.test/lmr/g/collect?v=2', 'left alone');
});
T('H7 an already-encoded request is not encoded twice', () => {
  const e = makeWindow(); e.run(shimJs);
  e.w.fetch(ORIGIN + '/lmr/abc?ei=Zm9v');
  eq(e.calls.fetch[0][0], ORIGIN + '/lmr/abc?ei=Zm9v', 'left alone');
});
T('H8 sendBeacon is encoded and keeps its payload', () => {
  const e = makeWindow(); e.run(shimJs);
  e.w.navigator.sendBeacon(ORIGIN + '/lmr/g/collect?v=2', 'data');
  const [u, d] = e.calls.beacon[0];
  ok(u.indexOf('ei=') !== -1, 'encoded'); eq(d, 'data', 'payload intact');
});
T('H9 XHR is encoded on open', () => {
  const e = makeWindow(); e.run(shimJs);
  const x = new e.w.XMLHttpRequest();
  x.open('POST', ORIGIN + '/lmr/g/collect?v=2');
  x.send('b');
  ok(e.calls.xhrSent[0][1].indexOf('ei=') !== -1, 'encoded');
});

/* A worker that does not decode "ei" must not cost the hit. */
const eiPixels = (e) => e.calls.pixels.map((p) => String(p.src || '')).filter((u) => u.indexOf('k=ei') !== -1);

T('H10 a 4xx on an encoded request resends it plain, once, with the caller init', () => {
  const e = makeWindow(); e.run(shimJs); e.state.fetchStatus = 404;
  e.w.fetch(ORIGIN + '/lmr/g/collect?v=2&tid=' + TID, { method: 'POST', body: 'payload', keepalive: true });
  eq(e.calls.fetch.length, 2, 'encoded attempt plus one plain resend');
  ok(e.calls.fetch[0][0].indexOf('ei=') !== -1, 'first attempt was encoded');
  eq(e.calls.fetch[1][0], ORIGIN + '/lmr/g/collect?v=2&tid=' + TID, 'the resend is the original URL');
  eq(e.calls.fetch[1][1].body, 'payload', 'with the original body');
  eq(e.calls.fetch[1][1].keepalive, true, 'and the original init');
});
T('H11 after a 4xx the page stops encoding, on every transport', () => {
  const e = makeWindow(); e.run(shimJs); e.state.fetchStatus = 404;
  e.w.fetch(ORIGIN + '/lmr/g/collect?v=2');
  e.state.fetchStatus = 200;
  e.w.fetch(ORIGIN + '/lmr/g/collect?v=2&en=b');
  e.w.navigator.sendBeacon(ORIGIN + '/lmr/g/collect?v=2&en=c', 'd');
  const x = new e.w.XMLHttpRequest(); x.open('POST', ORIGIN + '/lmr/g/collect?v=2&en=x'); x.send('b');
  eq(e.calls.fetch[2][0], ORIGIN + '/lmr/g/collect?v=2&en=b', 'later fetch is plain');
  eq(e.calls.beacon[0][0], ORIGIN + '/lmr/g/collect?v=2&en=c', 'later beacon is plain');
  eq(e.calls.xhrSent[0][1], ORIGIN + '/lmr/g/collect?v=2&en=x', 'later XHR is plain');
  eq(e.w.__synEiOff, 1, 'the breaker is visible on the window');
});
T('H12 exactly one "ei" signal, carrying the status', () => {
  const e = makeWindow(); e.run(shimJs); e.state.fetchStatus = 404;
  e.w.fetch(ORIGIN + '/lmr/g/collect?v=2&en=a');
  e.w.fetch(ORIGIN + '/lmr/g/collect?v=2&en=b');
  const px = eiPixels(e);
  eq(px.length, 1, 'one signal for the page');
  ok(px[0].indexOf(ORIGIN + '/lmr/_sg?k=ei&n=404&_syng=1') === 0, 'names the status, got ' + px[0]);
});
T('H13 a 2xx changes nothing: no resend, no signal, encoding stays on', () => {
  const e = makeWindow(); e.run(shimJs);
  e.w.fetch(ORIGIN + '/lmr/g/collect?v=2&en=a');
  e.w.fetch(ORIGIN + '/lmr/g/collect?v=2&en=b');
  eq(e.calls.fetch.length, 2, 'no extra requests');
  ok(e.calls.fetch[1][0].indexOf('ei=') !== -1, 'still encoding');
  eq(eiPixels(e).length, 0, 'no signal');
});
T('H14 a 5xx signals once but is not resent and does not trip the breaker', () => {
  const e = makeWindow(); e.run(shimJs); e.state.fetchStatus = 502;
  e.w.fetch(ORIGIN + '/lmr/g/collect?v=2&en=a');
  e.w.fetch(ORIGIN + '/lmr/g/collect?v=2&en=b');
  eq(e.calls.fetch.length, 2, 'nothing resent: a server that failed after accepting would count twice');
  ok(e.calls.fetch[1][0].indexOf('ei=') !== -1, 'still encoding');
  eq(eiPixels(e).length, 1, 'one signal');
  ok(eiPixels(e)[0].indexOf('n=502') !== -1, 'with the status');
});
T('H15 an XHR answered 4xx is replayed plain with its body and headers', () => {
  const e = makeWindow(); e.run(shimJs);
  const x = new e.w.XMLHttpRequest();
  x.open('POST', ORIGIN + '/lmr/g/collect?v=2&en=x');
  x.setRequestHeader('Content-Type', 'text/plain');
  x.send('body-1');
  ok(e.calls.xhrSent[0][1].indexOf('ei=') !== -1, 'first attempt encoded');
  x._respond(404);
  eq(e.calls.xhrSent.length, 2, 'one replay');
  eq(e.calls.xhrSent[1][1], ORIGIN + '/lmr/g/collect?v=2&en=x', 'plain URL');
  eq(e.calls.xhrSent[1][2], 'body-1', 'same body');
  eq(JSON.stringify(e.calls.xhrs[1]._h), JSON.stringify([['Content-Type', 'text/plain']]), 'same headers');
});
T('H16 a Request with a body is cloned before encoding, so the resend still has it', () => {
  const e = makeWindow(); e.run(shimJs); e.state.fetchStatus = 404;
  const req = new e.w.Request(ORIGIN + '/lmr/g/collect?v=2', { method: 'POST', body: 'payload' });
  e.w.fetch(req);
  eq(e.calls.fetch.length, 2, 'encoded attempt plus resend');
  eq(e.calls.fetch[1][2].body, 'payload', 'the resend carries the body');
  eq(e.calls.fetch[1][0], ORIGIN + '/lmr/g/collect?v=2', 'to the original URL');
});
T('H17 a network failure trips nothing: that is the blocker case the encoding exists for', () => {
  const e = makeWindow(); e.run(shimJs);
  e.w.fetch = function () { calls_fail.push(1); return { then(ok, err) { err && err(new Error('blocked')); return this; }, catch() { return this; } }; };
  const calls_fail = [];
  e.run(shimJs.replace('w.__synShimH', 'w.__synShimH2'));   // a second install on the replaced fetch, for this test only
  e.w.fetch(ORIGIN + '/lmr/g/collect?v=2&en=a');
  e.w.fetch(ORIGIN + '/lmr/g/collect?v=2&en=b');
  eq(calls_fail.length, 2, 'two attempts reached the transport');
  eq(e.w.__synEiOff, undefined, 'breaker untouched');
  eq(eiPixels(e).length, 0, 'no signal');
});

console.log(`\n${pass}/${pass + fail} passed\n`);
process.exit(fail ? 1 : 0);
