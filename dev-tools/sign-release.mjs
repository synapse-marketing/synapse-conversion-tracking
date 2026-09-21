// Sign a release and write the update manifest.
//
// The plugin installs an update only when the manifest carries an Ed25519
// signature, made with the private key that lives on the release machine and
// nowhere else, over "<sha256 of the zip>\n<version>". Binding the version in
// stops a hostile host from re-labelling an old, genuinely signed zip as a new
// version; WordPress's own newer-than check does the rest. The matching public
// key is baked into includes/class-gtm-server-side-plugin-update.php.
//
//   node dev-tools/sign-release.mjs --generate
//       Creates ~/.synapse-release/synapse-conversion-tracking-ed25519.pem
//       (mode 600) and prints the public key to paste into the plugin. Refuses
//       to overwrite an existing key.
//
//   node dev-tools/sign-release.mjs --zip "<built zip>" --version 2.0.0 \
//        --base https://host/path/ --out updates/synapse-conversion-tracking
//       Copies the zip into --out as synapse-conversion-tracking-<version>.zip,
//       signs it, verifies the signature with the public key, and writes
//       manifest.json next to it. Existing "sections" (the changelog shown in
//       WordPress) are kept unless --changelog <file.html> replaces them.
import crypto from 'node:crypto';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

const arg = (n, d) => { const i = process.argv.indexOf(n); return i !== -1 && process.argv[i + 1] ? process.argv[i + 1] : d; };
const has = (n) => process.argv.includes(n);
const fail = (m) => { console.error('sign-release: ' + m); process.exit(1); };

const KEY = arg('--key', path.join(os.homedir(), '.synapse-release', 'synapse-conversion-tracking-ed25519.pem'));
const PUB = KEY + '.pub';

const rawPublic = (publicKey) => publicKey.export({ type: 'spki', format: 'der' }).subarray(-32);

if (has('--generate')) {
  if (fs.existsSync(KEY)) fail(`refusing to overwrite ${KEY}`);
  fs.mkdirSync(path.dirname(KEY), { recursive: true, mode: 0o700 });
  const { privateKey, publicKey } = crypto.generateKeyPairSync('ed25519');
  fs.writeFileSync(KEY, privateKey.export({ type: 'pkcs8', format: 'pem' }), { mode: 0o600 });
  const pub = rawPublic(publicKey).toString('base64');
  fs.writeFileSync(PUB, pub + '\n', { mode: 0o644 });
  console.log('private key:', KEY, '(keep it here; never commit, never upload)');
  console.log('public key :', pub);
  console.log('paste the public key into PUBLIC_KEY in includes/class-gtm-server-side-plugin-update.php');
  process.exit(0);
}

if (has('--print-public')) {
  if (!fs.existsSync(PUB)) fail(`no public key at ${PUB}`);
  console.log(fs.readFileSync(PUB, 'utf8').trim());
  process.exit(0);
}

const zip = arg('--zip'), version = arg('--version'), base = arg('--base'), out = arg('--out');
if (!zip || !version || !base || !out) fail('need --zip, --version, --base and --out (or --generate)');
if (!/^\d+\.\d+\.\d+$/.test(version)) fail('version must be X.Y.Z');
if (!/^https:\/\/[^\s]+\/$/.test(base)) fail('--base must be an https URL ending with /');
if (!fs.existsSync(KEY)) fail(`no private key at ${KEY}; run --generate first`);
if (!fs.existsSync(zip)) fail(`no such zip: ${zip}`);

const privateKey = crypto.createPrivateKey(fs.readFileSync(KEY));
const publicKey = crypto.createPublicKey(privateKey);
const bytes = fs.readFileSync(zip);
const sha = crypto.createHash('sha256').update(bytes).digest('hex');
const message = Buffer.from(sha + '\n' + version, 'utf8');
const signature = crypto.sign(null, message, privateKey);
if (!crypto.verify(null, message, publicKey, signature)) fail('self-check failed');

fs.mkdirSync(out, { recursive: true });
const name = `synapse-conversion-tracking-${version}.zip`;
fs.copyFileSync(zip, path.join(out, name));

const manifestPath = path.join(out, 'manifest.json');
let sections = { description: '<p>Server-side tagging for a self-hosted Google Tag Manager server container.</p>' };
if (fs.existsSync(manifestPath)) {
  try { const prev = JSON.parse(fs.readFileSync(manifestPath, 'utf8')); if (prev.sections) sections = prev.sections; } catch (x) { /* start fresh */ }
}
const changelog = arg('--changelog');
if (changelog) sections = Object.assign({}, sections, { changelog: fs.readFileSync(changelog, 'utf8') });

const manifest = {
  slug: 'synapse-conversion-tracking',
  version,
  package: base + name,
  homepage: arg('--homepage', 'https://synapse-marketing.com/'),
  requires: '5.8',
  tested: arg('--tested', '6.9'),
  requires_php: '7.2',
  last_updated: new Date().toISOString().slice(0, 10),
  package_bytes: bytes.length,
  package_sha256: sha,
  signature: signature.toString('base64'),
  signed: 'ed25519 over sha256(zip) + "\\n" + version',
  public_key: rawPublic(publicKey).toString('base64'),
  sections,
};
fs.writeFileSync(manifestPath, JSON.stringify(manifest, null, 2) + '\n');
console.log(`signed ${name} (${bytes.length} B, sha256 ${sha.slice(0, 12)}…) -> ${manifestPath}`);
