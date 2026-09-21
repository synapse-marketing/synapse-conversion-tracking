// One oracle for the recovery identity state machine, shared by the tail suite
// and the inline-twin suite so both copies answer to the same set of rules.
//
// Three rounds of review found three consent/identity defects, each on a
// transition nobody had written down: re-minting per hit when storage failed,
// the stored id surviving a withdrawal, and a cookie id surviving one. Each
// was patched where it was found and the next transition broke. This file is
// the table instead: every storage failure mode, with and without a _ga cookie,
// through every consent sequence, checked against invariants rather than
// against the one path a reviewer happened to try.
//
// Invariants:
//   I1  within one consent state the client id is stable for the page
//   I2  a denied hit never carries the granted id, and never the cookie id
//   I3  a denied hit reads neither the cookie nor sessionStorage
//   I4  a granted hit adopts the _ga client id when the cookie exists
//   I5  gcs reflects the consent of that hit
//   I6  _ss=1 exactly once, on the first hit
//   I7  _fv=1 only on the first hit, and not when a cookie proved a prior visit

export const STORAGE_MODES = ['ok', 'missing', 'blocked', 'read-throws', 'write-throws', 'lying'];
export const COOKIE = '_ga=GA1.1.1234567890.1700000000; _gid=GA1.1.1.1';
export const COOKIE_CID = '1234567890.1700000000';
export const SEQUENCES = ['GGG', 'DDD', 'GDG', 'DGD', 'GDDG', 'DGGD'];

// Put a storage of the given failure mode and a cookie jar on a window and a
// document, both counting how often they are looked at.
export function instrument(w, d, mode, cookie) {
  const reads = { cookie: 0, storage: 0 };
  const store = {};
  Object.defineProperty(d, 'cookie', {
    configurable: true,
    get() { reads.cookie++; return cookie || ''; },
  });
  const storage = {
    getItem: (k) => { if (mode === 'read-throws') { throw new Error('read'); } return k in store ? store[k] : null; },
    setItem: (k, v) => { if (mode === 'write-throws') { throw new Error('write'); } if (mode !== 'lying') { store[k] = String(v); } },
  };
  delete w.sessionStorage;
  Object.defineProperty(w, 'sessionStorage', {
    configurable: true,
    get() {
      reads.storage++;
      if (mode === 'blocked') { throw new Error('SecurityError'); }
      if (mode === 'missing') { return undefined; }
      return storage;
    },
  });
  return reads;
}

export function parseHit(url) {
  const g = (k) => { const m = new RegExp('[?&]' + k + '=([^&]*)').exec(url); return m ? m[1] : null; };
  return { cid: g('cid'), gcs: g('gcs'), fv: g('_fv') === '1', ss: g('_ss') === '1' };
}

// h.make(mode, cookie) -> env with env.reads
// h.arm(env, 'G'|'D')      arms and fires the first hit under that consent
// h.consent(env, 'G'|'D')  changes consent for later hits
// h.hit(env)               pushes one recoverable event
// h.urls(env) -> string[]  every recovery request so far
export function runMatrix(h) {
  const failures = [];
  let scenarios = 0;
  for (const mode of STORAGE_MODES) {
    for (const cookie of [null, COOKIE]) {
      for (const seq of SEQUENCES) {
        scenarios++;
        const label = `[storage=${mode} cookie=${cookie ? 'yes' : 'no'} seq=${seq}]`;
        const fail = (m) => failures.push(`${label} ${m}`);
        try {
          const env = h.make(mode, cookie);
          const hits = [];
          let broken = false;
          for (let i = 0; i < seq.length; i++) {
            const c = seq[i];
            const before = { cookie: env.reads.cookie, storage: env.reads.storage };
            const n0 = h.urls(env).length;
            if (i === 0) { h.arm(env, c); } else { h.consent(env, c); h.hit(env); }
            const urls = h.urls(env);
            if (urls.length !== n0 + 1) { fail(`hit ${i + 1} (${c}) produced ${urls.length - n0} requests, expected 1`); broken = true; break; }
            hits.push(Object.assign({ c }, parseHit(urls[urls.length - 1]), {
              reads: { cookie: env.reads.cookie - before.cookie, storage: env.reads.storage - before.storage },
            }));
          }
          if (broken) { continue; }

          const G = hits.filter((x) => x.c === 'G');
          const D = hits.filter((x) => x.c === 'D');
          const distinct = (a) => new Set(a.map((x) => x.cid)).size;

          if (G.length && distinct(G) !== 1) { fail(`I1 granted hits carried ${distinct(G)} different ids`); }
          if (D.length && distinct(D) !== 1) { fail(`I1 denied hits carried ${distinct(D)} different ids`); }
          if (G.length && D.length && G[0].cid === D[0].cid) { fail('I2 denied hits reuse the granted id'); }
          for (const x of D) {
            if (cookie && x.cid === COOKIE_CID) { fail('I2 denied hit carries the cookie id'); }
            if (x.reads.cookie) { fail(`I3 denied hit read the cookie ${x.reads.cookie}x`); }
            if (x.reads.storage) { fail(`I3 denied hit touched sessionStorage ${x.reads.storage}x`); }
            if (x.gcs !== 'G100') { fail(`I5 denied hit marked ${x.gcs}`); }
          }
          for (const x of G) {
            if (cookie && x.cid !== COOKIE_CID) { fail(`I4 granted hit ignored the cookie id, sent ${x.cid}`); }
            if (x.gcs !== 'G111') { fail(`I5 granted hit marked ${x.gcs}`); }
          }
          hits.forEach((x, i) => {
            if (i === 0 && !x.ss) { fail('I6 first hit lacks _ss=1'); }
            if (i > 0 && x.ss) { fail(`I6 hit ${i + 1} repeats _ss=1`); }
            if (i > 0 && x.fv) { fail(`I7 hit ${i + 1} repeats _fv=1`); }
          });
          const expectFv = !(hits[0].c === 'G' && cookie);
          if (hits[0].fv !== expectFv) { fail(`I7 first hit _fv=${hits[0].fv ? 1 : 0}, expected ${expectFv ? 1 : 0}`); }
        } catch (e) {
          fail('threw: ' + e.message);
        }
      }
    }
  }
  return { failures, scenarios };
}
