// The two copies of the recovery watchdog must not drift apart.
//
// The plugin ships the GA4 measurement-recovery watchdog twice: minified inside
// get_ga4_fallback_js() in class-gtm-server-side-tracking-code.php for inline
// mode, and readable in assets/tail.js for edge-sender mode. Exactly one of the
// two is live on any given site, decided by a setting, so a fix applied to one
// and forgotten in the other is invisible until a customer on the other mode
// reports it - and the functional suites only exercise tail.js.
//
// This does two things the functional suites cannot:
//   1. parses the inline copy, which is otherwise only ever checked by a
//      browser on a customer's site;
//   2. asserts that both copies implement the same load-bearing behaviours,
//      by naming each behaviour and the token that proves it on each side.
//
// A behaviour added to one copy should be added here at the same time.
import fs from 'node:fs';
import vm from 'node:vm';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { instrument, runMatrix } from './identity-matrix.mjs';

const dir = path.dirname(fileURLToPath(import.meta.url));
const arg = (n, d) => { const i = process.argv.indexOf(n); return i !== -1 && process.argv[i + 1] ? process.argv[i + 1] : d; };
const PLUGIN = path.join(dir, '..', arg('--plugin', 'synapse-conversion-tracking v2.0.2'), 'synapse-conversion-tracking');

const php = fs.readFileSync(path.join(PLUGIN, 'includes', 'class-gtm-server-side-tracking-code.php'), 'utf8');
const tail = fs.readFileSync(path.join(PLUGIN, 'assets', 'tail.js'), 'utf8');

let pass = 0, fail = 0;
const T = (name, fn) => {
  try { fn(); pass++; console.log(`  OK  ${name}`); }
  catch (e) { fail++; console.log(`FAIL  ${name} -> ${e.message}`); }
};
const ok = (c, what) => { if (!c) throw new Error(what); };

// Evaluate the PHP concatenation in one method's final return, binding each
// interpolated variable to a test literal. Mirrors render-boot.mjs's evaluator;
// kept here so this check has no ordering dependency on a render.
function inlineJs(method, env) {
  const at = php.indexOf('private function ' + method + '(');
  ok(at > -1, `method ${method} not found`);
  const end = php.indexOf('\n\t}', at);
  const body = php.slice(at, end);
  const KEY = '\n\t\treturn ';
  const r = body.lastIndexOf(KEY);
  ok(r > -1, `no return in ${method}`);
  const expr = body.slice(r + KEY.length);

  let i = 0, out = '';
  while (i < expr.length) {
    while (i < expr.length && /[\s.]/.test(expr[i])) i++;
    if (i >= expr.length || expr[i] === ';') break;
    if (expr[i] === "'") {
      i++;
      while (i < expr.length) {
        if (expr[i] === '\\' && (expr[i + 1] === "'" || expr[i + 1] === '\\')) { out += expr[i + 1]; i += 2; continue; }
        if (expr[i] === "'") { i++; break; }
        out += expr[i++];
      }
      continue;
    }
    const m = /^\$([A-Za-z_]\w*)/.exec(expr.slice(i));
    ok(!!m, `unparsed token near ${JSON.stringify(expr.slice(i, i + 40))}`);
    ok(m[1] in env, `no test value bound for $${m[1]}`);
    out += env[m[1]];
    i += m[0].length;
  }
  return out;
}

const watchdog = inlineJs('get_ga4_fallback_js', {
  tid_js: '"G-TEST"', prefix_js: '"/lmr"', cid_js: '"GTM-TEST"', suffix_js: '"_synapse"',
});

console.log(`\ninline / tail parity  (${path.basename(path.dirname(PLUGIN))})\n`);

T('P1 the inline watchdog is syntactically valid JavaScript', () => {
  new vm.Script(watchdog, { filename: 'inline-watchdog.js' });
});

T('P2 the inline watchdog still installs itself once', () => {
  ok(watchdog.includes('w.__synGa4Fb'), 'the once-only guard is gone');
});

// Each row: what the behaviour is, the token that proves it inline, the token
// that proves it in the tail. Both must be present, or the two have drifted.
const BEHAVIOURS = [
  ['consent is re-read on every hit, not captured at fire()',
    'con=consent();', 'con = consent();'],
  ['identity is chosen per hit from the consent just read',
    'ses=state(con.an);hn++', 'ses = state(con.an);'],
  ['a denied visitor is measured with the ephemeral identity',
    'function state(an){if(!an)return ephemeral(false)', 'if (!an) { return ephemeral(false); }'],
  ['denied and granted ephemeral identities are separate objects',
    'var ephD=null,ephG=null;', 'var ephD = null, ephG = null;'],
  ['the denied identity is never taken from a cookie',
    'ephD={cid:mkid(n)', 'ephD = { cid: mkid(n)'],
  ['the stored identity is attempted once per page, not retried per hit',
    'persTried=true', 'persTried = true;'],
  ['a storage write is proven by reading it back, not by !!sessionStorage',
    'if(!s.getItem("_synfb"))return null', "if (!s.getItem('_synfb')) { return null; }"],
  ['the ephemeral identities are minted once per page load',
    'if(!ephG){', 'if (!ephG) {'],
  ['a first visit is not claimed on top of an existing GA4 client id',
    'if(ga)first=false', 'if (ga) { first = false; }'],
  ['a new recovery session and a first visit are separate flags',
    'if(ses.fresh&&1===hn)q.push("_ss=1","_nsi=1")', "if (ses.fresh && 1 === hn) { q.push('_ss=1', '_nsi=1'); }"],
  ['a new identity adopts the real GA4 client id when one exists',
    'function gaCid()', 'var gaCid = function ()'],
  ['consent also comes from the state GTM itself resolved, read from its entries table',
    'pick("ad_storage")', "pick('ad_storage')"],
  ['...and never through getConsentState(), which throws on a live container without a context',
    null, null],
  ['a measurement id carried only in the POST body is still identified',
    'function ga4(u,b)', null],
  ['...and only bodies that can be read without consuming a stream',
    'b instanceof w.URLSearchParams', null],
  ['sending stops once the real Google tag is heard',
    'stopped=true', 'stopped = true;'],
  ['a stopped watchdog skips the backlog rather than replaying it',
    'di=(w.dataLayer||[]).length', 'di = (w.dataLayer || []).length;'],
  ['send() bails when the watchdog has handed over',
    '||stopped)return', '|| stopped) { return; }'],
  ['the watchdog hides its own traffic from the proof-of-life flag',
    'var pre=seen;', 'var preS = w.__synSeen;'],
  ['...and restores the flag afterwards',
    'if(!pre)seen=pre', 'if (!preS) { w.__synSeen = preS; }'],
  ['the tail matches the measurement id through the sentinel map',
    'a.searchParams.get("tid")', "var m = w.__synSeenT;"],
  ['a hit for a different measurement id is not proof of life',
    'a.searchParams.get("tid")', null],
  ['an XHR counts only once it is actually sent',
    'X.prototype.send=function()', null],
];

for (const [what, inlineTok, tailTok] of BEHAVIOURS) {
  T(`P: ${what}`, () => {
    if (inlineTok === null && tailTok === null) {
      // A call has a dot before it; the comment explaining why there is no call does not.
      ok(!watchdog.includes('.getConsentState('), 'the INLINE copy still calls getConsentState()');
      ok(!tail.includes('.getConsentState('), 'tail.js still calls getConsentState()');
      return;
    }
    ok(watchdog.includes(inlineTok), `missing from the INLINE copy: ${JSON.stringify(inlineTok)}`);
    if (tailTok !== null) ok(tail.includes(tailTok), `missing from tail.js: ${JSON.stringify(tailTok)}`);
  });
}

T('P3 both copies agree on the recovery marker', () => {
  ok(watchdog.includes('ep.synapse_recovered=1'), 'inline marker');
  ok(tail.includes('ep.synapse_recovered=1'), 'tail marker');
});

T('P4 both copies agree on the eight-second grace period', () => {
  ok(/G=8000/.test(watchdog), 'inline G');
  ok(/var G = 8000;/.test(tail), 'tail G');
});

/* The rows above prove the two copies say the same things. These run the
 * inline copy, so it also DOES the same things. The edge half of this is
 * covered functionally by edge-sender17-test E41..E44; the inline half had
 * nothing but a stale snapshot, which is how a per-hit client id shipped in
 * both copies at once. */

function inlineEnv(storage, cookie, ics) {
  const fetched = [], timeouts = [], intervals = [], store = {};
  const w = {
    location: { origin: 'https://shop.test', href: 'https://shop.test/p' },
    document: { title: 'T', referrer: '', cookie: cookie || '' },
    google_tag_data: ics ? { ics: { entries: Object.fromEntries(Object.entries(ics).map(([k, v]) => [k, { update: v === 1 }])) } } : undefined,
    screen: { width: 1280, height: 800 },
    navigator: { language: 'bg-BG' },
    dataLayer: undefined,
    fetch: (u) => { fetched.push(String(u)); return { catch() {} }; },
    setTimeout: (fn, ms) => { timeouts.push([fn, ms]); return timeouts.length; },
    setInterval: (fn, ms) => { intervals.push([fn, ms]); return intervals.length; },
    clearInterval: () => {},
    addEventListener: () => {},
  };
  if ('blocked' === storage) {
    Object.defineProperty(w, 'sessionStorage', {
      configurable: true,
      get() { throw new Error('SecurityError'); },
    });
  } else {
    w.sessionStorage = {
      getItem: (k) => (k in store ? store[k] : null),
      setItem: (k, v) => { store[k] = String(v); },
    };
  }
  const sandbox = { window: w, URL };
  vm.createContext(sandbox);
  vm.runInContext(watchdog, sandbox, { filename: 'inline-watchdog.js' });
  return { w, fetched, timeouts, intervals };
}

const GRANTED = ['consent', 'update', { ad_storage: 'granted', analytics_storage: 'granted' }];
const DENIED = ['consent', 'update', { ad_storage: 'denied', analytics_storage: 'denied' }];

function armInline(env, consentEntry) {
  env.w.dataLayer = [];
  if (consentEntry) { env.w.dataLayer.push(consentEntry); }
  env.w.google_tag_manager = { 'GTM-TEST': {} };
  ok(env.intervals.length > 0, 'the watchdog installed a poll');
  env.intervals[0][0]();
  const armed = env.timeouts.filter(([, ms]) => ms === 8000);
  ok(armed.length === 1, 'the watchdog armed');
  armed[0][0]();
}

const inlineCids = (env) => env.fetched.map((u) => /[?&]cid=([^&]*)/.exec(u)[1]);
const pushThree = (env) => {
  env.w.dataLayer.push({ event: 'view_item_synapse', ecommerce: { currency: 'BGN', value: 1, items: [{ item_id: 'A' }] } });
  env.w.dataLayer.push({ event: 'add_to_cart_synapse', ecommerce: { currency: 'BGN', value: 2, items: [{ item_id: 'A' }] } });
  env.w.dataLayer.push({ event: 'purchase_synapse', ecommerce: { currency: 'BGN', value: 3, transaction_id: 'T', items: [{ item_id: 'A' }] } });
};

T('P5 inline: one client id for the whole page when storage throws', () => {
  const env = inlineEnv('blocked');
  armInline(env, GRANTED);
  pushThree(env);
  const c = inlineCids(env);
  ok(c.length >= 4, 'expected page_view plus three events, got ' + c.length);
  ok(new Set(c).size === 1, 'every hit must carry the same cid, saw ' + new Set(c).size);
});

T('P6 inline: a withdrawal stops the persisted id being sent', () => {
  const env = inlineEnv();
  armInline(env, GRANTED);
  const grantedCid = inlineCids(env)[0];
  env.w.dataLayer.push(DENIED);
  env.w.dataLayer.push({ event: 'view_item_synapse', ecommerce: { currency: 'BGN', value: 1, items: [{ item_id: 'A' }] } });
  const last = env.fetched[env.fetched.length - 1];
  ok(last.includes('gcs=G100'), 'the hit is marked denied');
  ok(/[?&]cid=([^&]*)/.exec(last)[1] !== grantedCid, 'a denied hit must not carry the stored identity');
});

T('P7 inline: a CMP that only sets GTM consent state is honoured', () => {
  const env = inlineEnv(null, '', { ad_storage: 2, analytics_storage: 2 });
  armInline(env);                        // nothing in the dataLayer about consent
  ok(env.fetched[0].includes('gcs=G100'), 'denied through GTM, not through the dataLayer');
  ok(env.fetched[0].includes('npa=1'), 'ads restricted');
});

T('P8 inline: a new identity adopts the real GA4 client id', () => {
  const env = inlineEnv(null, '_ga=GA1.1.1234567890.1700000000');
  armInline(env, GRANTED);
  ok(env.fetched[0].includes('cid=1234567890.1700000000'),
    'recovered hits must land on the same user, got ' + env.fetched[0]);
});

T('P9 inline: a tid carried only in the POST body is not mistaken for ours', () => {
  const env = inlineEnv();
  armInline(env, GRANTED);
  const before = env.fetched.length;
  env.w.fetch('https://shop.test/lmr/g/collect', { method: 'POST', body: 'v=2&tid=G-OTHER' });
  env.w.dataLayer.push({ event: 'view_item_synapse', ecommerce: { currency: 'BGN', value: 1, items: [{ item_id: 'A' }] } });
  ok(env.fetched.length > before + 1, 'another property speaking must not silence recovery for ours');
});

T('P10 inline: an adopted client id does not also claim a first visit', () => {
  const env = inlineEnv(null, '_ga=GA1.1.1234567890.1700000000');
  armInline(env, GRANTED);
  const first = env.fetched[0];
  ok(first.indexOf('cid=1234567890.1700000000') !== -1, 'the existing identity is used');
  ok(first.indexOf('_fv=1') === -1, 'must not claim a first visit, got ' + first);
  ok(first.indexOf('_ss=1') !== -1, 'still a new recovery session');
});

T('P11 inline: a genuinely unknown visitor is still a first visit', () => {
  const env = inlineEnv();
  armInline(env, GRANTED);
  ok(env.fetched[0].indexOf('_fv=1') !== -1, 'nothing on the domain says otherwise');
});

T('P12 inline: identity invariants hold across every storage mode, cookie and consent sequence', () => {
  const view = (env) => env.w.dataLayer.push({ event: 'view_item_synapse', ecommerce: { currency: 'BGN', value: 1, items: [{ item_id: 'A' }] } });
  const r = runMatrix({
    make: (mode, cookie) => { const env = inlineEnv(); env.reads = instrument(env.w, env.w.document, mode, cookie); return env; },
    arm: (env, c) => armInline(env, c === 'G' ? GRANTED : DENIED),
    consent: (env, c) => env.w.dataLayer.push(c === 'G' ? GRANTED : DENIED),
    hit: view,
    urls: (env) => env.fetched,
  });
  ok(r.scenarios === 72, 'expected 72 scenarios, ran ' + r.scenarios);
  ok(r.failures.length === 0, r.failures.length + ' invariant failures:\n      ' + r.failures.slice(0, 12).join('\n      '));
});

console.log(`\n${pass}/${pass + fail} passed\n`);
process.exit(fail ? 1 : 0);
