// Template drift check - the static half of the "do not break silently"
// requirement.
//
// Three separate files have to agree about how the Data Tag template talks to
// the sender, and none of them imports the others:
//
//   1. the GTM web template   (stape gtm templates/data-tag-main/template.js)
//      - decides the script version, the URL, the cache key and how many
//        arguments it passes
//   2. the vendored core      (assets/data-tag-sender.js)
//      - defines the functions that receive them
//   3. our tail               (assets/tail.js)
//      - seeds the cache key and trips a wire when the call shape changes
//
// If the template is ever updated in GTM, re-export it over
// "stape gtm templates/data-tag-main/template.js" and run this. Any
// disagreement is reported here, at build time, instead of turning into
// mis-shaped payloads in production. The runtime tripwire in tail.js is the
// same guard for the case where the template changes without anyone
// re-exporting it.
//
// Usage:  node dev-tools/template-drift-check.mjs
import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import { fileURLToPath } from 'node:url';

const dir = path.dirname(fileURLToPath(import.meta.url));
const plugArg = process.argv.indexOf('--plugin');
const PLUGIN = path.join(dir, '..', plugArg !== -1 && process.argv[plugArg + 1] ? process.argv[plugArg + 1] : 'synapse-conversion-tracking v2.0.2', 'synapse-conversion-tracking');
// dev-tools -> synapse-conversion-tracking -> sGTM Configuration -> claude
const TEMPLATE = path.join(dir, '..', '..', '..', 'stape gtm templates', 'data-tag-main', 'template.js');

const core = fs.readFileSync(path.join(PLUGIN, 'assets', 'data-tag-sender.js'), 'utf8');
const tail = fs.readFileSync(path.join(PLUGIN, 'assets', 'tail.js'), 'utf8');

let pass = 0, fail = 0;
function pin(name, fn) {
  try { const detail = fn(); pass++; console.log('  PIN  ' + name + (detail ? '  -> ' + detail : '')); }
  catch (e) { fail++; console.log(' DRIFT ' + name + '  -> ' + e.message); }
}
function eq(a, b, what) { if (a !== b) { throw new Error(`${what}: ${JSON.stringify(a)} !== ${JSON.stringify(b)}`); } }

// Split a call's arguments on top-level commas, respecting nesting and strings.
function callArgs(src, openParen) {
  let i = openParen + 1, depth = 1, cur = '', q = null;
  const args = [];
  while (i < src.length) {
    const c = src[i];
    if (q) {
      if (c === '\\') { cur += c + src[i + 1]; i += 2; continue; }
      if (c === q) { q = null; }
      cur += c; i++; continue;
    }
    if (c === '"' || c === "'" || c === '`') { q = c; cur += c; i++; continue; }
    if (c === '(' || c === '[' || c === '{') { depth++; }
    if (c === ')' || c === ']' || c === '}') {
      depth--;
      if (depth === 0) { args.push(cur); return args.map((a) => a.trim()); }
    }
    if (c === ',' && depth === 1) { args.push(cur); cur = ''; i++; continue; }
    cur += c; i++;
  }
  throw new Error('unterminated call expression');
}

function callInWindowArgs(src, fnName) {
  let from = 0;
  for (;;) {
    const at = src.indexOf('callInWindow(', from);
    if (at < 0) { throw new Error(`no callInWindow for ${fnName}`); }
    const args = callArgs(src, at + 'callInWindow'.length);
    if (args[0] === `'${fnName}'` || args[0] === `"${fnName}"`) { return args.slice(1); }
    from = at + 1;
  }
}

// Parameter names of a top-level "function name(...)" declaration.
function declaredParams(src, fnName) {
  const m = new RegExp('function\\s+' + fnName + '\\s*\\(([^)]*)\\)').exec(src);
  if (!m) { throw new Error(`no declaration of ${fnName}`); }
  return m[1].split(',').map((s) => s.trim()).filter(Boolean);
}

const haveTemplate = fs.existsSync(TEMPLATE);
const template = haveTemplate ? fs.readFileSync(TEMPLATE, 'utf8') : '';

console.log(`template : ${haveTemplate ? TEMPLATE : 'NOT FOUND - template pins skipped'}`);
console.log('');

// --- 1. The vendored core is the upstream file, untouched. -------------------
pin('core is the untouched upstream sender', () => {
  const md5 = crypto.createHash('md5').update(fs.readFileSync(path.join(PLUGIN, 'assets', 'data-tag-sender.js'))).digest('hex');
  eq(md5, '48dbff711a327d387d9fdfc3e472a1a9', 'assets/data-tag-sender.js md5');
  return 'md5 ' + md5.slice(0, 8);
});

// --- 2. Seed key name. ------------------------------------------------------
pin('loaded-cache key name matches the template', () => {
  if (!haveTemplate) { return 'skipped'; }
  const m = /dataTagScriptLoadedCacheKey\s*=\s*'([^']+)'/.exec(template);
  if (!m) { throw new Error('cannot find the cache key in the template'); }
  const key = m[1];
  if (tail.indexOf("'" + key + "'") === -1) { throw new Error(`tail.js does not seed "${key}"`); }
  return key;
});

// --- 3. Seed URL prefix and version window. ---------------------------------
// The tail seeds a RANGE so a template version bump does not silently drop us
// back to the CDN injection. The template's current version must sit inside it.
pin('template script version sits inside the seeded range', () => {
  const lo = Number(/SEED_LO\s*=\s*(\d+)/.exec(tail)[1]);
  const hi = Number(/SEED_HI\s*=\s*(\d+)/.exec(tail)[1]);
  if (!haveTemplate) { return `tail seeds v${lo}..v${hi} (template not checked)`; }

  const v = /dataScriptVersion\s*=\s*'v(\d+)'/.exec(template);
  if (!v) { throw new Error('cannot find dataScriptVersion in the template'); }
  const n = Number(v[1]);
  if (n < lo || n > hi) {
    throw new Error(`template is v${n}, tail seeds only v${lo}..v${hi} - widen SEED_HI in tail.js and re-run build-sender.mjs`);
  }
  return `template v${n}, tail seeds v${lo}..v${hi}`;
});

pin('seed URL prefix matches the template default', () => {
  if (!haveTemplate) { return 'skipped'; }
  const m = /:\s*'(https:\/\/[^']*\/dtag\/)'\s*\+\s*dataScriptVersion/.exec(template);
  if (!m) { throw new Error('cannot find the default script URL in the template'); }
  const b64 = /w\.atob\('([A-Za-z0-9+/=]+)'\)/.exec(tail);
  if (!b64) { throw new Error('cannot find the base64 seed prefix in tail.js'); }
  eq(Buffer.from(b64[1], 'base64').toString('binary'), m[1], 'seed prefix');
  return 'prefix agrees (base64 in tail.js)';
});

// --- 4/5. The call contract: template call site vs core declaration vs the ---
// runtime tripwire. All three must state the same arity.
pin('dataTagSendData arity agrees across template, core and tripwire', () => {
  const declared = declaredParams(core, 'dataTagSendData').length;
  const tripwire = Number(/a\.length\s*!==\s*(\d+)/.exec(tail)[1]);
  eq(tripwire, declared, 'tripwire vs core declaration');
  if (!haveTemplate) { return `core & tripwire agree on ${declared} args (template not checked)`; }
  const passed = callInWindowArgs(template, 'dataTagSendData').length;
  eq(passed, declared, 'template call site vs core declaration');
  return `${declared} args everywhere`;
});

pin('dataTagGetData arity agrees across template, core and tripwire', () => {
  const declared = declaredParams(core, 'dataTagGetData').length;
  const tripwire = Number(/arguments\.length\s*!==\s*(\d+)/.exec(tail)[1]);
  eq(tripwire, declared, 'tripwire vs core declaration');
  if (!haveTemplate) { return `core & tripwire agree on ${declared} args (template not checked)`; }
  const passed = callInWindowArgs(template, 'dataTagGetData').length;
  eq(passed, declared, 'template call site vs core declaration');
  return `${declared} args everywhere`;
});

// --- 6. The shape assertions the tripwire makes about the first three args. --
// It reports when arg 2 is not an absolute URL or arg 3 is not a path; confirm
// the template still passes exactly those.
pin('tripwire shape assumptions still hold at the template call site', () => {
  if (!haveTemplate) { return 'skipped'; }
  const a = callInWindowArgs(template, 'dataTagSendData');
  if (!/gtmServerDomain/.test(a[1])) { throw new Error(`arg 2 is no longer the server domain: ${a[1]}`); }
  if (!/requestPath/.test(a[2])) { throw new Error(`arg 3 is no longer the request path: ${a[2].slice(0, 60)}`); }
  return 'arg2=gtmServerDomain, arg3=requestPath+query';
});

// --- 7. Every helper the template calls into the page must exist in the -----
// vendored core (D3/I2). A template version inside the seeded window is
// guaranteed a loaded-cache hit, so it never injects the newer CDN core - if
// it then calls a helper our vendored copy does not define, the tag either
// aborts (event lost) or proceeds with an undefined value (silent match-quality
// degradation), and NO runtime signal can fire because nothing was injected
// and dataTagSendData may never be reached. This pin catches a renamed or
// newly-added helper on the same template re-export the other pins already
// depend on. Today the contract is: dataTagSendData, dataTagGetData,
// dataTagMD5, and dataTag256 - the last one load-bearing for Meta advanced
// matching (sha256hex of user_data.email_address in 6 of the 7 Data Tags).
pin('every callInWindow helper exists in the vendored core', () => {
  if (!haveTemplate) { return 'skipped'; }
  const names = new Set();
  const re = /callInWindow\(\s*['"]([A-Za-z_$][\w$]*)['"]/g;
  let m;
  while ((m = re.exec(template)) !== null) { names.add(m[1]); }
  if (names.size === 0) { throw new Error('no callInWindow calls found in the template'); }
  const missing = [...names].filter((n) => core.indexOf('function ' + n + '(') === -1);
  if (missing.length) {
    throw new Error(`template calls ${missing.join(', ')} but the vendored core defines no such function - the tag would break silently on a seeded cache hit`);
  }
  return [...names].sort().join(', ') + ' - all defined in the core';
});

console.log('');
console.log(`${pass}/${pass + fail} pins hold`);
process.exit(fail ? 1 : 0);
