# Synapse Conversion Tracking

WordPress plugin for server-side tagging through a self-hosted Google Tag Manager server
container: first-party custom loader, enhanced ad-blocker protection, GA4 measurement
recovery, Data Client transport rescue, WooCommerce data layer events and click ID
restoration. Free, GPL-2.0+.

## Install

Download the latest `updates/synapse-conversion-tracking-<version>.zip` and upload it in
WordPress under Plugins > Add New > Upload Plugin. From 2.0.0 on the plugin updates itself:
it checks `updates/manifest.json` in this repository through WordPress's own update
mechanism and installs new versions like any other plugin. Every package is signed with an
Ed25519 key that never leaves the release machine; the plugin refuses a package that does not
verify against the public key built into it.

## Layout

- `synapse-conversion-tracking/` - the plugin, exactly what the zip contains
- `dev-tools/` - the test suite and the release tools; `node dev-tools/run-all.mjs` runs everything
- `updates/` - the update manifest and the signed release packages WordPress installs from

## Release

1. Bump `Version:` in `synapse-conversion-tracking/synapse-conversion-tracking.php` and `Stable tag:` in its `README.txt`.
2. `node dev-tools/build-sender.mjs --plugin .` then `node dev-tools/run-all.mjs`.
3. Zip the `synapse-conversion-tracking/` folder.
4. `node dev-tools/sign-release.mjs --zip <zip> --version X.Y.Z --base https://raw.githubusercontent.com/synapse-marketing/synapse-conversion-tracking/main/updates/ --out updates`
5. Commit and push. Sites see the new version within twelve hours, or at once from Dashboard > Updates.
