// Edge worker - sender resolution tests (worker-lmr-proxy-LEAN-v2.js).
//
// The worker is the piece every hit goes through, and loadSender() is the only
// part of it that talks to an origin, so this pins its behaviour directly. The
// module is not imported: it is a Cloudflare Worker with an `export default`
// fetch handler and module-scope constants, so the region under test is read
// out of the real file and evaluated with a stubbed fetch. Nothing here
// restates the worker's logic - if someone edits it, these tests move with it.
//
// Two cross-file pins live here as well, because the page and the worker have
// to agree about the "b=" asset-directory hint and nothing else checks that.
//
// Usage:  node dev-tools/worker-sender-test.mjs
import vm from 'node:vm';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const dir = path.dirname(fileURLToPath(import.meta.url));
const plugArg = process.argv.indexOf('--plugin');
const PLUGIN = path.join(dir, '..', plugArg !== -1 && process.argv[plugArg + 1] ? process.argv[plugArg + 1] : 'synapse-conversion-tracking v2.0.0', 'synapse-conversion-tracking');
// Defaults to the commented release file. Pass a filename to run the identical
// suite against a variant - the comment-stripped BARE build has to pass every
// one of these before it may be pasted into Cloudflare:
//   node dev-tools/worker-sender-test.mjs worker-lmr-proxy-LEAN-v2-BARE.js
const positional = process.argv.slice(2).filter((a, i, all) => a.charAt(0) !== '-' && (i === 0 || all[i - 1].charAt(0) !== '-'));
const WORKER_FILE = positional[0] || 'worker-lmr-proxy-LEAN-v2.js';
const WORKER = path.join(dir, '..', '..', 'lamore-sgtm', 'cloudflare', WORKER_FILE);

if (!fs.existsSync(WORKER)) {
  // The worker lives in the lamore-sgtm checkout next to this one, not in the
  // plugin repository. Without it there is nothing to test the contract against.
  console.log(`  SKIP  worker-sender-test: needs the edge worker source at ${WORKER}, which is not part of this checkout.`);
  process.exit(0);
}
const src = fs.readFileSync(WORKER, 'utf8');

// The region from the sender constants through the end of loadSender().
const from = src.indexOf('const SENDER_FILES');
const to = src.indexOf('function decodeEab(');
if (from < 0 || to < 0 || to <= from) {
  throw new Error('cannot locate the sender region in the worker - did the file change shape?');
}
const region = src.slice(from, to);

const ORIGIN = 'https://shop.example';
const STANDARD = '/wp-content/plugins/synapse-conversion-tracking/assets/';
const CORE = 'function dataTagSendData(a,b,c,d,e,f,g){}';

let pass = 0;
let fail = 0;

function ok(name, cond, detail) {
  if (cond) {
    pass++;
    console.log('  OK  ' + name + (detail ? '  -> ' + detail : ''));
  } else {
    fail++;
    console.log(' FAIL ' + name + (detail ? '  -> ' + detail : ''));
  }
}

function eq(name, got, want) {
  ok(name, got === want, got === want ? String(got) : `${JSON.stringify(got)} != ${JSON.stringify(want)}`);
}

// Builds a fresh copy of the region with a fetch stub. `routes` maps a full
// request URL to either a {status, body} or a thrown error.
function load(routes) {
  const calls = [];
  const context = {
    URL,
    console,
    fetch: async (u, init) => {
      calls.push({ url: u, cf: init && init.cf });
      const r = routes[u];
      if (r === undefined) return { ok: false, status: 404, text: async () => 'not here' };
      if (r instanceof Error) throw r;
      return { ok: r.status >= 200 && r.status < 300, status: r.status, text: async () => r.body };
    },
  };
  vm.createContext(context);
  vm.runInContext(region + '\nglobalThis.__loadSender = loadSender;\nglobalThis.__bases = senderBases;\nglobalThis.__max = MAX_SENDER_TRIES;', context);
  return { context, calls };
}

const url = (qs) => new URL(ORIGIN + '/lmr/s.js' + (qs || ''));

// --- 1. The standard install is untouched by any of this. --------------------
{
  const hit = ORIGIN + STANDARD + 's.js?v=abc12345';
  const { context, calls } = load({ [hit]: { status: 200, body: CORE } });
  const body = await context.__loadSender(url('?v=abc12345'));
  eq('W1 standard install serves the core on the first try', body, CORE);
  eq('W1 exactly one origin request', calls.length, 1);
  eq('W1 versioned request is cached for a year', calls[0].cf.cacheTtl, 31536000);
}

// --- 2. An unversioned request is only held briefly. -------------------------
{
  const hit = ORIGIN + STANDARD + 's.js';
  const { context, calls } = load({ [hit]: { status: 200, body: CORE } });
  await context.__loadSender(url(''));
  eq('W2 unversioned request is cached for an hour', calls[0].cf.cacheTtl, 3600);
}

// --- 3. The pre-1.7.0 filename still answers, so a worker deployed ahead of --
// the plugin serves something the Data Tag can call.
{
  const hit = ORIGIN + STANDARD + 'data-tag-sender.js?v=abc12345';
  const { context, calls } = load({ [hit]: { status: 200, body: CORE } });
  const body = await context.__loadSender(url('?v=abc12345'));
  eq('W3 falls back to the core-only filename', body, CORE);
  eq('W3 tried s.js first', calls[0].url.endsWith('assets/s.js?v=abc12345'), true);
}

// --- 4. A non-standard tenant: the hint is what makes the edge path work. ----
{
  const base = '/blog/wp-content/plugins/synapse-conversion-tracking-1/assets/';
  const qs = '?v=abc12345&b=' + encodeURIComponent(base);
  const hit = ORIGIN + base + 's.js' + qs;
  const { context, calls } = load({ [hit]: { status: 200, body: CORE } });
  const body = await context.__loadSender(url(qs));
  eq('W4 a renamed folder in a subdirectory install is served', body, CORE);
  eq('W4 the hint is tried first', calls.length, 1);
}

// --- 5. Hints that must be ignored. ------------------------------------------
// A bad hint may never be worse than no hint, so each of these has to fall
// straight through to the guessed path.
{
  const bad = {
    'W5 traversal': '/wp-content/../../etc/',
    'W5 protocol-relative': '//evil.example/a/',
    'W5 absolute URL': 'https://evil.example/a/',
    'W5 no leading slash': 'wp-content/plugins/x/assets/',
    'W5 not a directory': '/wp-content/plugins/x/assets/s.js',
    'W5 backslash': '/wp-content\\plugins/x/assets/',
    'W5 query injection': '/a/?x=1&',
    'W5 space': '/a b/assets/',
    'W5 overlong': '/' + 'a'.repeat(210) + '/',
    'W5 empty': '',
  };
  for (const [name, hint] of Object.entries(bad)) {
    const qs = '?v=abc12345&b=' + encodeURIComponent(hint);
    const hit = ORIGIN + STANDARD + 's.js' + qs;
    const { context, calls } = load({ [hit]: { status: 200, body: CORE } });
    const body = await context.__loadSender(url(qs));
    ok(name + ' is ignored, guessed path used', body === CORE && calls[0].url === hit,
      calls.length ? calls[0].url.slice(ORIGIN.length, ORIGIN.length + 46) : 'no request');
  }
}

// --- 6. A hint equal to the guess must not double the work. ------------------
{
  const qs = '?b=' + encodeURIComponent(STANDARD);
  const { context, calls } = load({});
  await context.__loadSender(url(qs));
  const urls = calls.map((c) => c.url);
  eq('W6 an identical hint is not tried twice', new Set(urls).size, urls.length);
}

// --- 7. Fan-out is capped, and total failure is a clean null. ----------------
{
  const qs = '?v=abc12345&b=' + encodeURIComponent('/custom/assets/');
  const { context, calls } = load({});
  const body = await context.__loadSender(url(qs));
  eq('W7 every candidate missing returns null (the 503 path)', body, null);
  ok('W7 fan-out is capped at MAX_SENDER_TRIES', calls.length <= context.__max, `${calls.length} <= ${context.__max}`);
}

// --- 8. The proof check is what stops an HTML page becoming the sender. ------
{
  const qs = '?v=abc12345';
  const html = '<!DOCTYPE html><html><body>404 Not Found</body></html>';
  const { context, calls } = load({
    [ORIGIN + STANDARD + 's.js' + qs]: { status: 200, body: html },
    [ORIGIN + STANDARD + 'data-tag-sender.js' + qs]: { status: 200, body: CORE },
  });
  const body = await context.__loadSender(url(qs));
  eq('W8 a 200 HTML page is refused as the sender', body, CORE);
  eq('W8 it moved on instead of serving it', calls.length, 2);
}

// --- 9. Nothing a fetch does can escape loadSender. --------------------------
{
  const qs = '?v=abc12345';
  const { context } = load({
    [ORIGIN + STANDARD + 's.js' + qs]: new Error('connection reset'),
    [ORIGIN + STANDARD + 'data-tag-sender.js' + qs]: new Error('tls handshake failed'),
  });
  let threw = false;
  let body;
  try {
    body = await context.__loadSender(url(qs));
  } catch (e) {
    threw = true;
  }
  ok('W9 a throwing origin never rejects, it returns null', !threw && body === null, threw ? 'it threw' : String(body));
}

// --- 10. A 5xx is not mistaken for content. ----------------------------------
{
  const qs = '?v=abc12345';
  const { context } = load({
    [ORIGIN + STANDARD + 's.js' + qs]: { status: 503, body: CORE },
    [ORIGIN + STANDARD + 'data-tag-sender.js' + qs]: { status: 200, body: CORE },
  });
  const body = await context.__loadSender(url(qs));
  eq('W10 a 5xx body is skipped even when it looks right', body, CORE);
}

// --- 11. Cross-file: the tail must never pass the proof check. ---------------
// If it could, a tail-only response would be served as the sender and the Data
// Tag would call a function that is not there.
{
  const proof = /const SENDER_PROOF = '([^']+)'/.exec(src);
  ok('W11 SENDER_PROOF is readable from the worker', !!proof, proof ? proof[1] : 'not found');
  const tail = fs.readFileSync(path.join(PLUGIN, 'assets', 'tail.js'), 'utf8');
  const core = fs.readFileSync(path.join(PLUGIN, 'assets', 'data-tag-sender.js'), 'utf8');
  ok('W11 tail.js does not satisfy the proof', tail.indexOf(proof[1]) === -1);
  ok('W11 the vendored core does satisfy it', core.indexOf(proof[1]) !== -1);
}

// --- 12. Cross-file: the page and the worker agree about the hint. -----------
// The plugin stays silent when its path equals the worker's first guess. If
// either side changes that string alone, every non-standard tenant silently
// loses the edge cache again - which is the defect this whole parameter exists
// to close.
{
  const php = fs.readFileSync(path.join(PLUGIN, 'includes', 'class-gtm-server-side-helpers.php'), 'utf8');

  const phpBase = /const EDGE_SENDER_GUESSED_BASE = '([^']+)'/.exec(php);
  const firstGuess = /const SENDER_BASES = \[\s*'([^']+)'/.exec(src);
  ok('W12 both sides name the same guessed base',
    !!phpBase && !!firstGuess && phpBase[1] === firstGuess[1],
    phpBase && firstGuess ? `${phpBase[1]} == ${firstGuess[1]}` : 'one side not found');

  const phpParam = /\. 'b=' \. rawurlencode/.test(php);
  const workerParam = /const BASE_HINT_PARAM = '([^']+)'/.exec(src);
  ok('W12 both sides use the same parameter name',
    phpParam && !!workerParam && workerParam[1] === 'b',
    workerParam ? workerParam[1] : 'not found');

  // Same accepted shape on both sides, allowing for PHP's # delimiter.
  const phpRe = /preg_match\( '#\^(.+)\$#'/.exec(php);
  const workerRe = /const BASE_HINT_RE = \/\^(.+)\$\//.exec(src);
  ok('W12 both sides accept the same path shape',
    !!phpRe && !!workerRe && phpRe[1].replace(/\\\//g, '/') === workerRe[1].replace(/\\\//g, '/'),
    phpRe && workerRe ? phpRe[1] : 'one side not found');
}

console.log('');
console.log(`${pass}/${pass + fail} passed`);
process.exit(fail ? 1 : 0);
