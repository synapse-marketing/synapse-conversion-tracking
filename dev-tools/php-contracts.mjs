// PHP-side contracts, checked without a PHP interpreter.
//
// The settings and helper layer cannot be executed on a machine with no PHP,
// which is how two defects in it survived a full green suite: the container URL
// was never normalised, so one trailing slash produced "host/path//name.js" for
// the container script, and the generated file names were cached for a year
// behind update_option_ hooks that only exist inside wp-admin, so any change
// made by WP-CLI, a migration or an importer left the site serving the previous
// name with nothing on the settings screen to show it.
//
// These assertions are structural, not behavioural. They cannot prove the PHP
// runs correctly. They can and do prove that the properties those two fixes
// depend on are still present, which is what a future edit is likely to undo.
//
// Usage:  node dev-tools/php-contracts.mjs [--plugin "<folder>"]
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const dir = path.dirname(fileURLToPath(import.meta.url));
const arg = (n, d) => { const i = process.argv.indexOf(n); return i !== -1 && process.argv[i + 1] ? process.argv[i + 1] : d; };
const PLUGIN = path.join(dir, '..', arg('--plugin', 'synapse-conversion-tracking v2.0.2'), 'synapse-conversion-tracking');

const read = (rel) => fs.readFileSync(path.join(PLUGIN, rel), 'utf8');
const helpers = read('includes/class-gtm-server-side-helpers.php');
const general = read('includes/class-gtm-server-side-admin-settings-general.php');
const dataLayer = read('includes/class-gtm-server-side-admin-settings-data-layer.php');

let pass = 0, fail = 0;
const T = (name, fn) => {
  try { fn(); pass++; console.log(`  OK  ${name}`); }
  catch (e) { fail++; console.log(`FAIL  ${name} -> ${e.message}`); }
};
const ok = (c, what) => { if (!c) throw new Error(what); };

console.log(`\nPHP contracts  (${path.basename(path.dirname(PLUGIN))})\n`);

/* ---------------- the container URL ---------------- */

T('C1 a normaliser for the container URL exists', () => {
  ok(/function normalize_container_url\(\s*\$url\s*\)/.test(helpers), 'normalize_container_url is gone');
});

T('C2 it strips surrounding whitespace and trailing slashes', () => {
  const body = /function normalize_container_url\([\s\S]*?\n\t\}/.exec(helpers)[0];
  ok(body.includes("trim( (string) $url )"), 'no trim');
  ok(body.includes("rtrim( $url, '/' )"), 'no rtrim of the trailing slash');
});

T('C3 the getter normalises, so existing installs are fixed without a re-save', () => {
  const body = /function get_gtm_container_url\(\)[\s\S]*?\n\t\}/.exec(helpers)[0];
  ok(body.includes('normalize_container_url('), 'the getter returns the raw option again');
});

T('C4 the loader still builds its src from the normalised getter', () => {
  const code = read('includes/class-gtm-server-side-tracking-code.php');
  const uses = code.split('get_gtm_container_url()').length - 1;
  ok(uses >= 2, `expected the loader snippets to use the getter, saw ${uses}`);
  ok(!code.includes('get_raw_gtm_container_url()'), 'a snippet reads the raw option directly');
});

/* ---------------- every setting is sanitised on save ---------------- */

T('C5 every registered setting has a sanitize_callback', () => {
  const missing = [];
  for (const [file, src] of [['general', general], ['data-layer', dataLayer]]) {
    const re = /register_setting\(([\s\S]*?)\n\t\t\);|register_setting\(([^;]*?)\);/g;
    let m;
    while ((m = re.exec(src))) {
      const call = m[0];
      const name = /GTM_SERVER_SIDE_FIELD_[A-Z_]+/.exec(call.replace('GTM_SERVER_SIDE_ADMIN_GROUP', ''));
      if (!call.includes('sanitize_callback')) { missing.push(`${file}:${name ? name[0] : call.slice(0, 60)}`); }
    }
  }
  ok(missing.length === 0, `unsanitised: ${missing.join(', ')}`);
});

T('C6 the container URL is cleaned on save as well as on read', () => {
  const at = general.indexOf('GTM_SERVER_SIDE_FIELD_WEB_CONTAINER_URL');
  const call = general.slice(at - 120, at + 500);
  ok(call.includes('normalize_container_url'), 'the save path does not normalise');
});

/* ---------------- the generated-name cache ---------------- */

T('C7 the cache is keyed on the settings it was generated from', () => {
  const body = /function get_cache_field\([\s\S]*?\n\t\}/.exec(helpers)[0];
  ok(/\$fingerprint/.test(body), 'no fingerprint parameter');
  ok(body.includes("$cache['f'] === $fingerprint"), 'the stored fingerprint is not compared');
});

T('C8 a value from an older version is regenerated rather than trusted', () => {
  const body = /function get_cache_field\([\s\S]*?\n\t\}/.exec(helpers)[0];
  ok(body.includes('is_array( $cache )'), 'a bare string from a previous release would be returned as-is');
});

T('C9 both cached getters pass a fingerprint', () => {
  const calls = helpers.split('self::get_cache_field(').slice(1);
  ok(calls.length === 2, `expected two cached getters, found ${calls.length}`);
  for (const c of calls) {
    const upto = c.slice(0, c.indexOf('\n\t\t);'));
    ok(/md5\(/.test(upto), 'a cached getter still caches on the field name alone');
  }
});

T('C10 the identifier fingerprint follows the identifier', () => {
  const at = helpers.indexOf('GTM_SERVER_SIDE_FIELD_WEB_IDENTIFIER,\n\t\t\tfunction()');
  ok(at > -1, 'the identifier getter changed shape');
  const call = helpers.slice(at, at + 900);
  ok(call.includes('md5( (string) self::get_raw_gtm_container_identifier() )'), 'wrong or missing fingerprint');
});

/* ---------------- whitespace in the values the worker matches ---------------- */

T('C11 the container id and identifier are trimmed on read', () => {
  for (const fn of ['get_raw_gtm_container_id', 'get_raw_gtm_container_identifier']) {
    const body = new RegExp(`function ${fn}\\(\\)[\\s\\S]*?\\n\\t\\}`).exec(helpers)[0];
    ok(body.includes('trim('), `${fn} does not trim`);
  }
});

/* ---------------- diagnostics reach the worker in both modes ---------------- */

T('C12 the front-end script is told where to send a signal', () => {
  const src = read('includes/class-gtm-server-side-frontend-assets.php');
  ok(src.includes("$scripts['signal_path']"), 'signal_path is not localized');
  ok(src.includes('has_gtm_container_identifier()'), 'it is sent even where no worker exists');
});

T('C13 the signal path is the container path, without a trailing slash', () => {
  const src = read('includes/class-gtm-server-side-frontend-assets.php');
  const at = src.indexOf("$scripts['signal_path']");
  const line = src.slice(at - 200, at + 200);
  ok(line.includes('get_gtm_container_url()'), 'derived from something other than the container URL');
  ok(line.includes("rtrim( $prefix, '/' )"), 'a trailing slash would produce "//_sg"');
});

/* ---------------- enqueued assets bust their own cache ---------------- */

T('C14 an enqueued asset version follows the file, not the plugin version', () => {
  ok(/public static function get_asset_version\(\s*\$rel\s*\)/.test(helpers), 'get_asset_version is gone');
  const body = /public static function get_asset_version\([\s\S]*?\n\t\}/.exec(helpers)[0];
  ok(body.includes('get_asset_version_query('), 'it no longer derives from the content hash');
  ok(body.includes('get_gtm_server_side_version()'), 'the plugin version should stay visible in the string');
});

T('C15 nothing is enqueued on the bare plugin version any more', () => {
  const offenders = [];
  for (const f of ['includes/class-gtm-server-side-frontend-assets.php', 'includes/class-gtm-server-side-admin-assets.php']) {
    for (const line of read(f).split('\n')) {
      if (!/wp_(enqueue|register)_(script|style)\(/.test(line)) { continue; }
      if (line.includes('get_gtm_server_side_version()')) { offenders.push(`${f}: ${line.trim().slice(0, 70)}`); }
    }
  }
  ok(offenders.length === 0, `a corrected file behind an unchanged version would keep serving stale bytes:\n      ${offenders.join('\n      ')}`);
});

/* ---------------- self-update through WordPress ---------------- */

const mainFile = read('synapse-conversion-tracking.php');
const updater = read('includes/class-gtm-server-side-plugin-update.php');

T('C16 the plugin declares an HTTPS Update URI on the product host', () => {
  const m = /^\s\*\s*Update URI:\s*(\S+)/m.exec(mainFile);
  ok(m, 'no Update URI header');
  ok(m[1] === 'https://raw.githubusercontent.com/synapse-marketing/synapse-conversion-tracking/main/updates/manifest.json', 'unexpected Update URI: ' + m[1]);
});

T('C17 the updater is registered on the always-hook, because update checks also run from cron', () => {
  ok(/add_action\(\s*'synapse_ct',\s*array\(\s*GTM_Server_Side_Plugin_Update::class/.test(mainFile), 'registered on the wrong hook or not at all');
});

T('C18 a package is only believed over HTTPS from the manifest host', () => {
  ok(updater.includes("'https' !== strtolower( $pkg['scheme'] )"), 'scheme not pinned');
  ok(updater.includes("strtolower( $pkg['host'] ) === strtolower( $src['host'] )"), 'host not pinned');
});

T('C19 a failed or malformed manifest means no update, never an error', () => {
  ok(updater.includes('is_wp_error( $res )'), 'transport errors not handled');
  ok(/return \$update;/.test(updater), 'check() does not fall back to what core had');
  ok(/'timeout'\s*=>\s*8/.test(updater), 'no request timeout');
});

T('C20 the version WordPress installs is the version the manifest names', () => {
  ok(/'version'\s*=>\s*\$m\['version'\]/.test(updater) && /'new_version'\s*=>\s*\$m\['version'\]/.test(updater), 'version fields');
  ok(/'package'\s*=>\s*\$m\['package'\]/.test(updater), 'package field');
});

T('C21 the version and the minimum WordPress agree with the manifest mechanism', () => {
  const hv = /^\s\*\s*Version:\s*(\d+)\.(\d+)\.(\d+)\s*$/m.exec(mainFile);
  ok(hv, 'header version is not X.Y.Z');
  ok(Number(hv[1]) >= 2, 'a header version below 2.0.0 cannot update itself');
  ok(/^\s\*\s*Requires at least:\s*5\.8\s*$/m.test(mainFile), 'Update URI needs WordPress 5.8');
  ok(read('README.txt').includes('Stable tag: ' + hv.slice(1, 4).join('.')), 'README stable tag differs from the header version');
});

T('C22 every download of our package is verified before install, and fails closed', () => {
  ok(/add_filter\(\s*'upgrader_pre_download'/.test(updater), 'no pre-download hook');
  ok(updater.includes('sodium_crypto_sign_verify_detached('), 'no signature verification');
  for (const code of ['synapse_ct_no_sodium', 'synapse_ct_unsigned', 'synapse_ct_bad_signature']) {
    ok(updater.includes(code), 'missing failure path ' + code);
  }
  ok(updater.includes('@unlink( $tmp )'), 'a rejected package is not removed');
});

T('C23 the baked public key is a real 32-byte Ed25519 key, and matches the release key on this machine', () => {
  const m = /const PUBLIC_KEY = '([A-Za-z0-9+\/=]+)';/.exec(updater);
  ok(m, 'no PUBLIC_KEY');
  ok(Buffer.from(m[1], 'base64').length === 32, 'not 32 bytes');
  const pub = path.join(process.env.HOME || '', '.synapse-release', 'synapse-conversion-tracking-ed25519.pem.pub');
  if (fs.existsSync(pub)) { ok(fs.readFileSync(pub, 'utf8').trim() === m[1], 'plugin key differs from the release key'); }
});

T('C24 the signed message binds the version, so an old signed zip cannot be re-labelled', () => {
  ok(updater.includes('$hash . "\\n" . (string) $m[\'version\']'), 'PHP verifies over hash + newline + version');
  const signer = fs.readFileSync(path.join(dir, 'sign-release.mjs'), 'utf8');
  ok(signer.includes("sha + '\\n' + version"), 'signer signs over hash + newline + version');
});

T('C25 PHP 7.2 is declared, where sodium arrived', () => {
  ok(/^\s\*\s*Requires PHP:\s*7\.2\s*$/m.test(mainFile), 'header');
  ok(read('README.txt').includes('Requires PHP: 7.2'), 'README');
});

/* ---------------- 2.0.1: the edge sender can no longer fail silently ---------------- */

T('C26 the fallback copy never shares an address with what the worker fetches', () => {
  ok(/const EDGE_SENDER_FALLBACK_MARK = 'fb=1';/.test(helpers), 'marker constant');
  const body = /function get_edge_sender_fallback_url\(\)[\s\S]*?\n\t\}/.exec(helpers)[0];
  ok(body.includes('self::EDGE_SENDER_FALLBACK_MARK'), 'the fallback URL does not carry the marker');
  const code = read('includes/class-gtm-server-side-tracking-code.php');
  ok(code.includes('"&r="+Math.floor(new Date().getTime()/36e5)'), 'no hourly cache-busted retry in the boot');
});

T('C27 the edge health check is wired, scoped, and never cries wolf', () => {
  ok(/add_action\(\s*'synapse_ct',\s*array\(\s*GTM_Server_Side_Edge_Health::class,\s*'instance'\s*\)\s*\);/.test(mainFile), 'not registered on synapse_ct');
  const h = read('includes/class-gtm-server-side-edge-health.php');
  ok(h.includes("const CRON_HOOK = 'synapse_ct_edge_health';"), 'cron hook name');
  ok(read('includes/class-gtm-server-side-plugin-deactivate.php').includes("wp_clear_scheduled_hook( 'synapse_ct_edge_health' )"), 'cron not cleared on deactivation');
  ok(h.includes('! is_admin() && ! wp_doing_cron()'), 'scheduling runs on page views');
  ok(h.includes("'cf-ray'") && h.includes("'cf-mitigated'"), 'an answer that bypassed Cloudflare, or a challenge, would count as a failure');
  ok(/substr\(\s*hash\(\s*'sha256',\s*\$body\s*\),\s*0,\s*8\s*\)\s*===\s*\$want/.test(h), 'the version is not verified');
  ok(h.includes("'dashboard', 'plugins', 'settings_page_' . GTM_SERVER_SIDE_ADMIN_SLUG"), 'notice screens');
});

console.log(`\n${pass}/${pass + fail} passed\n`);
process.exit(fail ? 1 : 0);
