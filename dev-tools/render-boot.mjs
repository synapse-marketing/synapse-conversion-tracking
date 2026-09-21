// Renders the v1.7.0 inline head pieces from the PHP source, without PHP.
//
// render-ga4fb.php is still the reference renderer (it runs the real methods
// through reflection), but it needs a PHP binary. This does the same job for
// the pieces the JS tests care about by reading the actual return expressions
// out of class-gtm-server-side-tracking-code.php and evaluating the PHP string
// concatenation directly.
//
// The point is that nothing here restates what the plugin emits: every literal
// byte comes from the PHP file. If someone edits the boot, these renders change
// with it - and if the boot is ever written in a form this small evaluator does
// not understand, it throws instead of quietly rendering a half-boot.
//
// Usage:  node dev-tools/render-boot.mjs [--plugin "<folder>"] [--out <dir>]
// Writes: edge-boot17.js, edge-sentinel17.js, shim17.js
//   --plugin : version folder to render, e.g. "synapse-conversion-tracking v1.7.1"
//              - lets an older release be re-rendered for version-skew tests
//   --out    : directory to write the two files into (default: dev-tools)
import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import { fileURLToPath } from 'node:url';

const dir = path.dirname(fileURLToPath(import.meta.url));
const arg = (name, fallback) => {
  const i = process.argv.indexOf(name);
  return i !== -1 && process.argv[i + 1] ? process.argv[i + 1] : fallback;
};
const PLUGIN = path.join(dir, '..', arg('--plugin', 'synapse-conversion-tracking v2.0.0'), 'synapse-conversion-tracking');
const OUT_DIR = arg('--out', dir);
const PHP = fs.readFileSync(path.join(PLUGIN, 'includes', 'class-gtm-server-side-tracking-code.php'), 'utf8');

// ---------------------------------------------------------------------------
// Test site - the same options render-ga4fb.php uses, so the two renderers can
// be compared byte-for-byte on any machine that does have PHP.
// ---------------------------------------------------------------------------
const SITE = 'https://lamore-bg.com';
const PREFIX = '/lmr';
const PLUGIN_URL = SITE + '/wp-content/plugins/synapse-conversion-tracking/';
const CFG = { p: PREFIX, t: 'G-SYYEZHP7BL', c: 'GTM-NQHQHZLR', s: '_synapse', d: 1 };

const sha8 = (f) => crypto.createHash('sha256').update(fs.readFileSync(path.join(PLUGIN, 'assets', f))).digest('hex').slice(0, 8);

// wp_json_encode() leaves JSON_UNESCAPED_SLASHES off, so "/" is emitted as "\/".
const wpJson = (v) => JSON.stringify(v).replace(/\//g, '\\/');

// The container loader is byte-unchanged since v1.6.x; take it from the
// PHP-rendered v1.6.4 boot so it is a real render, not a restatement.
const OLD = fs.readFileSync(path.join(dir, 'edge-boot.js'), 'utf8');
const lo = OLD.indexOf('function boot(){') + 'function boot(){'.length;
const hi = OLD.indexOf('}var done=0,go=');
if (lo < 16 || hi < 0) { throw new Error('render-boot: cannot locate the loader inside edge-boot.js'); }
const LOADER = OLD.slice(lo, hi);

// ---------------------------------------------------------------------------
// A minimal evaluator for PHP concatenation of single-quoted strings and known
// value tokens. Stops at the top-level ";" that ends the return statement.
// ---------------------------------------------------------------------------
function evalConcat(expr, env) {
  const out = [];
  let i = 0;

  while (i < expr.length) {
    while (i < expr.length && /[\s.]/.test(expr[i])) { i++; }
    if (i >= expr.length || expr[i] === ';') { return out.join(''); }

    if (expr[i] === "'") {
      i++;
      let s = '';
      while (i < expr.length) {
        const c = expr[i];
        if (c === '\\' && (expr[i + 1] === "'" || expr[i + 1] === '\\')) { s += expr[i + 1]; i += 2; continue; }
        if (c === "'") { i++; break; }
        s += c; i++;
      }
      out.push(s);
      continue;
    }

    const m = /^(\$this->[A-Za-z_]\w*\(\)|\$[A-Za-z_]\w*)/.exec(expr.slice(i));
    if (!m) { throw new Error('render-boot: unparsed token near ' + JSON.stringify(expr.slice(i, i + 60))); }
    if (!(m[1] in env)) { throw new Error('render-boot: no test value bound for ' + m[1]); }
    out.push(env[m[1]]);
    i += m[1].length;
  }

  throw new Error('render-boot: return statement never terminated');
}

// Body of a private method, then its LAST return expression (methods here open
// with early-return guards and end with the statement we want).
function lastReturn(fn) {
  const at = PHP.indexOf('\tprivate function ' + fn + '(');
  if (at < 0) { throw new Error('render-boot: method not found: ' + fn); }
  const end = PHP.indexOf('\n\t}', at);
  if (end < 0) { throw new Error('render-boot: method never closed: ' + fn); }
  const body = PHP.slice(at, end);
  // Anchored on the PHP indentation of a statement inside a class method: the
  // emitted JS itself contains "return " many times over.
  const KEY = '\n\t\treturn ';
  const r = body.lastIndexOf(KEY);
  if (r < 0) { throw new Error('render-boot: no return statement in ' + fn); }
  return body.slice(r + KEY.length);
}

// ---------------------------------------------------------------------------
// __synCfg is a PHP array literal, not a concatenation, so evalConcat cannot
// render it. Read the array body and bind each value expression to its test
// value - including the encoding wrapper, so a change in how the plugin encodes
// an id shows up in the rendered fixture instead of being restated here. An
// unknown expression throws: a new key or a new wrapper must be taught to this
// renderer, never silently rendered as the old shape.
// ---------------------------------------------------------------------------
function renderCfg() {
  const at = PHP.indexOf('\tprivate function get_synapse_cfg_js(');
  if (at < 0) { throw new Error('render-boot: get_synapse_cfg_js not found'); }
  const body = PHP.slice(at, PHP.indexOf('\n\t}', at));

  const lo = body.indexOf('$cfg = array(');
  const hi = body.indexOf('\n\t\t);', lo);
  if (lo < 0 || hi < 0) { throw new Error('render-boot: cannot locate the $cfg array literal'); }

  // The wrapper the plugin uses must be standard base64, not base64url: the
  // tail tells encoded from plain by looking for "-", which standard base64
  // cannot produce and every Google id contains. Assert it here so switching
  // alphabets fails the render instead of shipping an undecodable id.
  const enc = /private static function encode_cfg_id\([^)]*\)\s*\{([\s\S]*?)\n\t\}/.exec(PHP);
  if (enc && !/\bbase64_encode\(/.test(enc[1])) {
    throw new Error('render-boot: encode_cfg_id no longer uses base64_encode');
  }
  if (enc && /strtr|base64url|rtrim\(\s*\$?\w+\s*,\s*[\'"]=/.test(enc[1])) {
    throw new Error('render-boot: encode_cfg_id looks like base64url - the tail cannot tell that from a plain id');
  }

  const b64 = (s) => Buffer.from(s, 'utf8').toString('base64');
  const VALUES = {
    '$prefix': CFG.p,
    '$suffix': CFG.s,
    '$tid': CFG.t,
    '$container_id': CFG.c,
    'self::encode_cfg_id( $tid )': b64(CFG.t),
    'self::encode_cfg_id( $container_id )': b64(CFG.c),
    'GTM_Server_Side_Helpers::is_enable_data_rescue() ? 1 : 0': CFG.d,
  };

  const out = {};
  for (const line of body.slice(lo, hi).split('\n').slice(1)) {
    const m = /^\s*'(\w+)'\s*=>\s*(.+?),\s*$/.exec(line);
    if (!m) {
      if (line.trim() === '') { continue; }
      throw new Error('render-boot: unparsed $cfg line ' + JSON.stringify(line));
    }
    if (!(m[2] in VALUES)) {
      throw new Error(`render-boot: no test value bound for $cfg['${m[1]}'] = ${m[2]}`);
    }
    out[m[1]] = VALUES[m[2]];
  }

  // Mirror the PHP's own return statement rather than assuming its shape.
  const ret = lastReturn('get_synapse_cfg_js');
  const shape = /^'([^']*)'\s*\.\s*wp_json_encode\(\s*\$cfg\s*\)\s*\.\s*'([^']*)';/.exec(ret);
  if (!shape) { throw new Error('render-boot: unexpected get_synapse_cfg_js return ' + JSON.stringify(ret.slice(0, 80))); }

  return shape[1] + wpJson(out) + shape[2];
}

// get_edge_sender_url() appends a "&b=" asset-directory hint when the site's
// plugin path is NOT the one the worker guesses first. The test site below uses
// the standard path, so the hint is empty and $primary_js is exactly what the
// PHP returns. Assert it rather than assume it: if PLUGIN_URL is ever changed
// to a non-standard layout, this render would silently stop matching the plugin.
{
  const php = fs.readFileSync(path.join(PLUGIN, 'includes', 'class-gtm-server-side-helpers.php'), 'utf8');
  const guess = /const EDGE_SENDER_GUESSED_BASE = '([^']+)'/.exec(php);
  if (!guess) { throw new Error('render-boot: cannot read EDGE_SENDER_GUESSED_BASE from the plugin'); }
  const assets = new URL(PLUGIN_URL + 'assets/').pathname;
  if (assets !== guess[1]) {
    throw new Error(`render-boot: the test site is at ${assets}, not the guessed ${guess[1]} - the plugin would emit a "b=" hint this renderer does not model`);
  }
}

const env = {
  '$loader': LOADER,
  '$primary_js': wpJson(SITE + PREFIX + '/s.js?v=' + sha8('s.js')),
  '$fallback_js': wpJson(PLUGIN_URL + 'assets/s.js?v=' + sha8('s.js')),
  '$tail_js': wpJson(PLUGIN_URL + 'assets/tail.js?v=' + sha8('tail.js')),
  '$this->get_synapse_cfg_js()': renderCfg(),
};

const boot = evalConcat(lastReturn('get_edge_sender_boot_js'), env);
// The sentinel deliberately takes no bindings: it must not carry the
// measurement id, which is camouflaged in the page source.
const sentinel = evalConcat(lastReturn('get_ga4_sentinel_js'), {});

const shim = evalConcat(lastReturn('get_enhanced_adblocker_shim_js'), { '$prefix_js': wpJson(PREFIX) });

fs.writeFileSync(path.join(OUT_DIR, 'edge-boot17.js'), boot);
fs.writeFileSync(path.join(OUT_DIR, 'edge-sentinel17.js'), sentinel);
fs.writeFileSync(path.join(OUT_DIR, 'shim17.js'), shim);

console.log(`rendered from PHP source (no PHP binary needed)`);
console.log(`  edge-boot17.js      ${boot.length} B`);
console.log(`  edge-sentinel17.js  ${sentinel.length} B`);
console.log(`  shim17.js           ${shim.length} B`);
console.log(`  s.js    ?v=${sha8('s.js')}`);
console.log(`  tail.js ?v=${sha8('tail.js')}`);
