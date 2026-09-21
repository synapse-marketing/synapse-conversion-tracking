// Read a JavaScript payload straight out of the PHP source.
//
// Why this exists: four of the test suites in this folder read pre-rendered
// snapshots (combined-shim-on.js and friends) produced by render-ga4fb.php.
// A snapshot cannot tell you it has gone stale, and on 2026-09-20 three of them
// were two months behind the source while still reporting green. Anything that
// can be read directly from the PHP should be, so the test always sees what
// ships.
//
// Scope, deliberately narrow: this handles a method whose body ends in a single
// `return '...';` built from single-quoted PHP string literals joined with
// `. $var .`. That covers the shim and the sentinel. It does NOT try to
// interpret PHP, so methods with branching string building still need the PHP
// renderer - see snapshot-freshness.mjs, which makes their staleness loud.
import fs from 'node:fs';

/**
 * Pull the returned JS string out of one PHP method.
 *
 * @param {string} phpPath  Path to the PHP class file.
 * @param {string} method   Method name, e.g. 'get_ga4_sentinel_js'.
 * @param {object} vars     Map of PHP variable name (no $) to the literal text
 *                          to splice in, e.g. { tid_js: '"G-TEST"' }.
 * @returns {string} The JavaScript source.
 */
export function extractReturnJs(phpPath, method, vars = {}) {
  const src = fs.readFileSync(phpPath, 'utf8');

  const sig = new RegExp(`function\\s+${method}\\s*\\(`);
  const at = src.search(sig);
  if (at === -1) throw new Error(`method ${method} not found in ${phpPath}`);

  // The last `return '` before the method's closing brace at tab-depth 1.
  const end = src.indexOf('\n\t}', at);
  const body = src.slice(at, end === -1 ? undefined : end);

  const rIdx = body.lastIndexOf("return '");
  if (rIdx === -1) throw new Error(`no single-quoted return in ${method}`);

  // Walk the PHP string expression, respecting \' escapes, to its terminating ;
  let i = rIdx + "return ".length;
  let out = '';
  while (i < body.length) {
    if (body[i] === "'") {
      i++;
      let lit = '';
      while (i < body.length) {
        if (body[i] === '\\' && (body[i + 1] === "'" || body[i + 1] === '\\')) { lit += body[i + 1]; i += 2; continue; }
        if (body[i] === "'") { i++; break; }
        lit += body[i++];
      }
      out += lit;
      continue;
    }
    if (body[i] === ';') break;
    // Between literals: ` . $var . `
    const m = /^\s*\.\s*\$([A-Za-z_][A-Za-z0-9_]*)\s*\.\s*/.exec(body.slice(i));
    if (m) {
      if (!(m[1] in vars)) throw new Error(`${method}: no value supplied for $${m[1]}`);
      out += vars[m[1]];
      i += m[0].length;
      continue;
    }
    const tail = /^\s*\.\s*$/.test(body.slice(i, body.indexOf(';', i)));
    if (tail) break;
    i++;
  }
  return out;
}
