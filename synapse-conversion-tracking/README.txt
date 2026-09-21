=== Synapse Conversion Tracking ===
Contributors: synapse
Tags: google tag manager, server-side tagging, sgtm, woocommerce, data layer
Requires at least: 5.8
Tested up to: 6.9
Stable tag: 2.0.0
Requires PHP: 7.2
License: GPLv2 or later
License URI: http://www.gnu.org/licenses/gpl-2.0.html

Server-side tagging for a self-hosted Google Tag Manager server container.

== Description ==

Synapse Conversion Tracking connects a WordPress site to a self-hosted
server-side Google Tag Manager (sGTM) container:

* Embeds the web GTM snippet on every page, optionally gated behind CMP
  consent (Google Consent Mode).
* First-party custom loader: with a container identifier configured, the GTM
  script is served under a disguised file name from your own domain instead
  of gtm.js. The edge worker in front of your sGTM container must be
  configured to recognize the same identifier.
* Enhanced ad-blocker protection (optional): with the custom loader active,
  a small client-side shim encodes every tracking hit so ad blockers cannot
  match the "/g/collect" URL pattern; the edge worker decodes it back before
  the server container, which still receives and previews the plain request.
* WooCommerce Data Layer events (Login, SignUp, ViewItem, AddToCart,
  BeginCheckout, Purchase and more), optionally suffixed with '_synapse'.

No third-party service is involved: everything talks only to your own
domains and your own sGTM container.

== Credits ==

This plugin is a GPL fork of "GTM Server Side" v2.3.0. All third-party
service integrations were removed; loader serving is delegated to your own
edge infrastructure.

== Changelog ==

= 2.0.0 =
* New: the plugin updates itself through WordPress. It carries an "Update URI"
  header pointing at a manifest in its public GitHub repository, and answers the
  update check WordPress already performs twice a day with whatever version
  that manifest names. A newer version shows up under Plugins and Dashboard >
  Updates and installs with the ordinary one-click flow, or unattended once
  auto-updates are switched on for it. Nothing beyond that check is ever
  contacted, the package must be served over HTTPS from the same host as the
  manifest, and every failure to reach or read the manifest means "no update"
  rather than an error. This is why this release is 2.0.0 rather than 1.7.5:
  it is the last one that has to be uploaded by hand.
* New: every update package is signed. The release is signed on the release
  machine with an Ed25519 key that exists nowhere else, over the package's
  SHA-256 and its version together, and the plugin verifies that signature
  against a public key built into it before anything is installed. A package
  that does not verify, a manifest without a signature, or a PHP without the
  sodium extension all end with nothing installed and a plain message saying
  so. WordPress does not check packages from outside wordpress.org; this does.
  PHP 7.2 is therefore the minimum, which is where sodium arrived.
* Changed: WordPress 5.8 is now the minimum, because that is where the update
  mechanism above was introduced. Older installations keep working but will
  not see updates.
* Fixed: add_to_cart was never sent for a grouped product. WooCommerce hands
  the handler an array of children, and the code copied it with Object.assign
  before iterating, which turns an array into a plain object with numeric keys
  and no iterator. Every click on a grouped product's add-to-cart threw
  "item is not iterable" and the event was lost, while the product itself went
  into the cart normally - so the shop looked fine and the funnel did not. The
  shape is now branched on before anything is copied.
* Fixed: children of a grouped product that were NOT ordered are no longer
  reported. WooCommerce renders every child with quantity="0", and "0" is a
  truthy string in JavaScript, so the old emptiness test kept those rows and
  sent them with a quantity of zero. Quantities are now parsed before they are
  tested, in both places that test them. A click with nothing ordered now
  sends nothing at all.
* Fixed: add_to_cart and remove_from_cart could be lost outright when the
  cart-state request failed. With "Decorate dataLayer event name" on, both
  events wait for an admin-ajax call that had a success callback and nothing
  else - no .fail(), no timeout - so an HTTP 403 from a stale nonce on a cached
  page, a 500, a network drop or a parse error meant the event was never
  pushed. It is now pushed exactly once whatever happens, without the cart
  state when the request could not supply it, and the failure raises a signal.
* Fixed: the same two events could still be lost outright when the page did not
  stay long enough. They wait up to 1500 ms for the cart-state call, and a cart
  form that submits and navigates takes the listener and the timer with it, so
  nothing was ever pushed. Anything still waiting is now pushed on the way out,
  without the cart state it never received. A tab that is backgrounded rather
  than closed counts as leaving, since it may never be given the chance again.
* Fixed: remove_from_cart carried no ecommerce.value, an unformatted price and
  no index, because it built its payload by hand instead of going through the
  shared push. It now takes the same path as every other ecommerce event.
* Fixed: a click on an icon or label inside an archive add-to-cart button was
  not tracked. The handler read event.target, which is the child that was
  clicked, instead of event.currentTarget, which is the button carrying the
  data attributes.
* Fixed: the archive handler and the block-grid handler could both match one
  click. They are now a single handler that resolves the item data from the
  button, falling back to the nearest ancestor that carries an item id.
* Fixed: removed_from_cart threw when a theme triggered it without the button
  argument, which took out every other handler listening to the same event.
* Fixed: a quantity REDUCTION on the cart page is now reported as
  remove_from_cart with the delta. Only increases were reported before, so the
  negative half of the cart funnel was silently missing. Both sides of the
  comparison are parsed as numbers, so an empty field can no longer read as 0.
* Changed: a quantity change is only reported once the change is confirmed,
  by pressing Update cart or by pressing Enter in the field. It used to be
  reported on every key. A keypress runs before the browser inserts the
  character, so replacing 10 with 12 passed through "1" on the way, which with
  the new reduction reporting would have been sent as nine items removed that
  nobody removed.
* Changed: the delta is measured from the last quantity reported for that
  field rather than from the quantity the page was rendered with. On a cart
  that updates without a reload, editing 10 to 12 and then to 15 used to send
  +2 followed by +5 for a real change of +5.
* Fixed: item_id and item_sku changed JavaScript type depending on which code
  path read them, because jQuery's data accessor converts anything numeric to a
  Number while dataset always yields strings. The same product was reported as
  "123" on one event and 123 on another. Identity fields are now strings
  everywhere, matching what the PHP side emits.
* Fixed: the front-end script no longer assumes its own environment. It is
  wrapped in a guarded IIFE that does nothing at all when jQuery is absent
  instead of throwing on its first statement, it reads its configuration
  lazily so a bundler that reorders the localize block degrades to an
  undecorated event rather than a ReferenceError, it creates window.dataLayer
  if the loader never ran, and it is written in ES5 so a concatenating minifier
  with an older parser cannot fail on it.
* Fixed: GA4 measurement recovery froze the visitor's consent at the moment it
  armed, eight seconds after the container loaded, and reused it for the rest
  of the page. A visitor who answered the banner after that had every later
  recovered hit - including purchase - labelled with the earlier state.
  Consent is now read fresh for each hit. A denied hit is still sent as a
  cookieless ping with gcs=G100 and npa=1, which is what Consent Mode does and
  what keeps conversion modelling working.
* Fixed: consent was only ever read from the data layer. A consent platform
  wired through Google Tag Manager's own consent templates calls
  setDefaultConsentState and updateConsentState, which never appear in the data
  layer at all, so a visitor who declined through such a platform was treated
  as unmanaged and every recovered hit went out as fully granted. The state
  Tag Manager itself resolved is now read as well, and it decides. It is read
  from Tag Manager's entries table: the getConsentState() call takes a
  container context on a live container and throws without one, which a test
  against a stand-in could not show and a real site did.
* Fixed: in the same place, the identity was frozen too. If analytics storage
  was denied when the watchdog armed, a throwaway client id was minted and kept
  even after the visitor accepted, so every page of that session arrived as a
  new user. Recovery now keeps two identities and picks between them per hit
  from the consent it just read. The stored one lives in sessionStorage and is
  only touched while analytics storage is granted, so the session stitches
  together once the visitor accepts. The other is minted once per page load
  and is what a visitor who refused is measured with, so a denied hit is a
  genuine cookieless ping rather than the stored identity wearing gcs=G100.
  A browser that refuses storage altogether gets that same one-per-page
  identity instead of a new client id on every hit.
* Changed: when recovery mints a stored identity for the first time and the
  Google tag has already set its own _ga cookie on the domain, that client id
  is adopted instead of a new one. A recovered hit then lands on the same user
  as the hits that got through, rather than creating a second visitor for the
  same person. The cookie is only read where analytics storage is granted, and
  never once an identity has already sent hits this session.
* Fixed: a new recovery session was reported as a first visit. One flag drove
  both, decided only by the absence of the plugin's own session record, so
  once the client id could be adopted from the Google tag's cookie the first
  recovered hit claimed a brand new visitor on top of someone Analytics had
  demonstrably already counted. The two are now separate: a session that
  recovery has not seen before still starts a session, but a first visit is
  only claimed where nothing on the domain says otherwise.
* Fixed: a client id adopted from the Google tag's cookie under consent could
  still be sent after that consent was withdrawn. One object served both as
  the identity for a granted visitor without working storage and as the
  identity for a denied visitor, so whatever it had picked up under consent
  travelled on. They are now two objects that never meet: the denied one is
  random, minted once per page and never sees a cookie or storage, so a
  denied hit is a genuine cookieless ping; the granted one may adopt the
  cookie, and is equally minted once. The stored identity is likewise
  attempted once per page rather than retried per hit, so storage that
  starts working mid-page cannot move a visitor onto a new id after hits have
  already gone out. The whole state machine - six storage failure modes, with
  and without the cookie, through six consent sequences - is now checked
  against written invariants in both the edge and the inline copy, instead of
  one transition at a time.
* Fixed: a Google tag that started working late did not stop the recovery. The
  dataLayer hook installed when the watchdog fires was never removed, so from
  then on every event was sent twice, once by the real tag and once as a
  recovered duplicate. The watchdog now hands over the first time it hears a
  genuine hit, and it hides its own traffic from that test so it cannot disarm
  itself on its first send.
* Fixed: the proof-of-life check treated any "/g/collect" request as evidence
  that the Google tag had spoken, so a hit for a different GA4 property
  suppressed recovery for the configured one, and an XHR that was opened and
  then abandoned counted as a send. It now matches the configured measurement
  id, still accepting a hit that carries no id in the query because GA4 may
  post its parameters in the body, and it counts an XHR at send rather than at
  open.
* Fixed: the ad-blocker shim silently dropped the caller's options when fetch
  was called with a Request object and a second argument, so such a request
  went out with the original method and body instead of the intended ones.
* Fixed: a hit whose measurement id was in the POST body rather than the query
  counted as proof of life for every property, so another GA4 property on the
  same page could silence recovery for yours. The id is now also read out of
  the body, and only from values that can be read without touching a stream -
  a plain string or URLSearchParams - so the request that goes out is byte for
  byte the one the caller made. A hit whose property genuinely cannot be
  identified still counts for everyone, which is the safe side of the choice.
* Fixed: several WooCommerce calls could fatal where the cart is legitimately
  absent - the view_cart and begin_checkout footers, the cart-item remove-link
  filter and the cart total helper. All four now degrade instead.
* Fixed: user data was always empty for guests. The code verified the live
  session customer and then threw it away, rebuilding a customer from its id -
  which is 0 for a guest, so every field came back blank and the setting looked
  enabled while doing nothing. NOTE: on sites with "user data" enabled this
  means guest details now actually reach the data layer, as the setting always
  intended. Confirm that matches your consent setup before updating.
* Fixed: a trailing slash on the Server GTM container URL produced a container
  script at "https://host/path//name.js". Whether that double slash 404s is up
  to the edge worker, so the failure is invisible in WordPress and total on the
  site. The value is now cleaned when it is saved and again when it is read, so
  an installation that already has one is fixed without anyone re-saving the
  settings. The container id and the container identifier are trimmed the same
  way; a stray space in the identifier becomes a file name the worker cannot
  match.
* Fixed: the generated container id and file name were cached for a year and
  only invalidated by update_option hooks that are registered inside the admin
  class. A setting changed by WP-CLI, a migration, an importer, or by deleting
  and re-adding the option left the site serving the previous disguised file
  name, with nothing on the settings screen to show it. The cache now stores a
  fingerprint of the settings it was generated from and regenerates the moment
  they no longer match, so the hooks are a convenience rather than the only
  defence.
* Fixed: a worker that does not decode the encoded "ei" request lost every hit
  silently. The ad-blocker shim rewrote each request and forwarded it without
  ever looking at the answer, so a 404 from a missing route, or a 400 from a
  server container handed an unknown path, meant no event arrived and nothing
  in the plugin knew. The shim now reads the response where one exists, fetch
  and XMLHttpRequest, and on the first 4xx it resends that request in its
  original plain form, stops encoding for the rest of the page so no other
  hit is doubled, and raises one "ei" signal with the status. A 5xx raises
  the signal but is not resent, because a server that failed after accepting
  the hit would count it twice. A network error changes nothing: that is the
  blocker case the encoding exists for, and falling back there would hand the
  hit to the blocker. sendBeacon has no response to read; it is covered by the
  breaker once fetch or XHR has tripped it.
* Fixed: the diagnostic signals only existed on sites running the edge-served
  sender. They are raised through a function the edge-served tail publishes,
  and nothing publishes it in inline mode, so on most installations a
  cart-state failure was reported to nobody. The front-end script now sends
  the same pixel itself when the tail is absent, once per kind of problem per
  page, and only where a container identifier says there is an edge worker to
  receive it.
* Fixed: scripts and styles were enqueued with the plugin version as their
  cache-busting parameter, so a corrected file behind an unchanged version
  number could keep being served from a browser or CDN cache. Each asset now
  carries a hash of its own contents alongside the version, so a changed file
  always arrives changed. The hash is memoised, as the edge sender's already
  was, so this costs nothing per page view.
* Internal: the front-end WooCommerce script, which had never had a test, now
  has one - 46 assertions covering every case above. The
  ad-blocker shim and the proof-of-life sentinel are now rendered from the PHP
  source on each run and tested directly, instead of through a snapshot. A
  parity check asserts that the inline and edge-served copies of the recovery
  watchdog implement the same behaviours, since exactly one of the two is live
  on any given site. The suites that still read pre-rendered snapshots now
  refuse to report a clean pass when the snapshot's provenance cannot be
  verified, and dev-tools/run-all.mjs runs everything against one version and
  prints a single summary, counting what was proved against the live source
  separately from what was only proved against a snapshot. The inline copy of
  the watchdog is now run and its behaviour asserted, not just compared token
  by token against the edge copy - a defect present in both at once was
  otherwise invisible. The settings and helper layer, which needs a PHP
  interpreter to execute and therefore has none in this suite, has structural
  contracts asserted instead.

= 1.7.4 =
* Added: a restored ad click ID is now marked. When the click ID restorer
  actually puts a click ID back, it stamps "_syncid=1" on the page URL, so a
  rescued landing is identifiable in the request log. Nothing is marked when
  there was nothing to restore. The marker is fixed and does not depend on the
  backup parameter name each site configures, and it is only written on the
  branch that already rewrites the URL, so healthy landings are untouched.

= 1.7.3 =
* Fixed: the cart-state AJAX endpoint no longer calls WooCommerce when
  WooCommerce is not installed. The endpoint is registered from the plugin's
  own data layer setting, so it could be reached on a site with no
  WooCommerce at all; the guard tested for the opposite condition and let
  that case through. It now answers with a plain error response, and the
  browser keeps pushing the event without the cart state, as it already did
  for every other failure.
* Fixed: the cart token no longer assumes a WooCommerce session object
  exists. The session handler is only loaded on frontend-shaped requests, so
  it can legitimately be missing while WooCommerce itself is active.
* Fixed: the cart line builder now reads the cart it was given instead of
  discarding it and reading the global one. Both are the same cart on every
  current call path, so no data changes today.

= 1.7.2 =
* Changed: the GA4 measurement id and the web container id are no longer
  written in readable form in the page source. They are base64-encoded in the
  inline configuration and decoded by the sender at runtime, so the page
  carries no recognisable Google id while every request that leaves the
  browser is byte for byte what it was before. This is camouflage against
  automated scanning of the HTML; it is not a security measure.
* Changed: the sender accepts both the encoded and the plain form of those two
  ids, so any combination of plugin version and cached sender keeps working.

= 1.7.1 =
* Changed: the injection detector now also reports a Data Tag sender injected
  from a different CDN host, not only from the known one. A future template
  that moves the sender would otherwise lose POST-shaped events in blocking
  browsers with no signal at all; now it shows up in the request log.
* Changed: the per-asset "?v=" content hash is memoized in a transient keyed
  on the file's mtime and size, instead of being recomputed on every page
  view. A changed file always re-hashes immediately; the stored value is
  never trusted across a file change.
* Changed: sites whose plugin assets are not in the standard location - a
  renamed plugin folder, a moved wp-content, or WordPress in a subdirectory -
  now tell the edge worker where the sender actually is. Those sites used to
  lose the edge copy entirely and fall back to loading it from the plugin
  folder on every page. A standard installation sends nothing and is byte for
  byte unchanged.

= 1.7.0 =
* Changed: in edge-sender mode the inline head script is about two thirds
  smaller. The transport rescue, the loaded-cache seed and the GA4 recovery
  logic moved out of the page and into the edge-served sender file, which is
  identical for every site and cached for a year. What stays inline is the
  ad-blocker shim, a small config object, the observers that record whether
  the Google tag spoke, and the loader. Behaviour is unchanged: the container
  still boots only after everything is installed.
* Added: the sender file is versioned by content hash ("?v="), so it can be
  cached immutably and still update the moment the plugin does. Path-based
  routing is unaffected, so no edge worker change is required for this.
* Added: fallback source for the sender. If the edge copy fails to load, the
  boot retries once from the plugin folder before giving up; only if both
  fail does it fall back to the old behaviour of letting the Data Tag inject
  its own (blockable) script.
* Added: forward compatibility for the Data Tag template. The loaded-cache is
  seeded for a range of template versions instead of only the current one, and
  a signature check reports - without ever blocking a call - if a future
  template version changes how it calls the sender. Both are reported through
  the request log rather than failing quietly.
* Added: self-healing across deploy order. A plugin newer than the edge worker
  detects the older sender file and pulls the missing half from the plugin
  folder, so the plugin and the worker can be updated in either order.

= 1.6.4 =
* Fixed: product and category names are no longer HTML-encoded before entering
  the data layer and webhook payloads. Names with apostrophes, quotes or
  ampersands (e.g. "L'amore & Co") previously reached GA4 and Meta as HTML
  entities; they are now sent as plain text, with tags and line breaks stripped.

= 1.6.3 =
* Changed: the Data Tag loaded-cache seed key is base64-decoded at runtime, so
  the third-party sender URL no longer appears as a readable string in the page
  source. Runtime behavior is unchanged - the decoded key is byte-identical, so
  the template still takes its no-inject branch. Applies to both edge-sender and
  inline modes.

= 1.6.2 =
* Added: Edge-served Data Tag sender (General tab, off by default). When on, the
  vendored ~23 KB Data Tag sender is loaded once from your edge worker as an
  immutable cached file instead of being inlined in every page's head, shrinking
  the inline head script by ~73%. The container loader waits for the sender to
  load and seeds the loaded-cache before the container runs; if the sender is
  missing or slow it falls back to the Data Tag's own injection, so tracking
  never blocks. Requires Data transport rescue and a worker route serving the
  sender at "<container-url>/s.js". With the option off the head output is
  byte-for-byte identical to 1.6.1.

= 1.3.1 =
* Changed: the enhanced ad-blocker shim now loads as the first statement inside
  the container loader's own script tag, so a single first-party script installs
  the network wrappers and then loads the container. No behaviour change.
* Changed: removed the HTML/JS comment markers from the printed head output
  (GTM, ad-blocker shim, Click ID Restorer) for a cleaner page source.

= 1.3.0 =
* Added: Enhanced ad-blocker protection (General tab). When the custom loader
  is active, a client-side shim encodes every tracking hit so ad blockers
  can't match the "/g/collect" pattern; the edge worker decodes it back. Off
  by default. Fails open: any error leaves the original request untouched.

= 1.0.0 =
* Initial Synapse release, forked and de-vendored.
* Removed: Cookie Keeper, Customer Match, remote custom-loader API,
  same-origin PHP proxy, order webhooks, all external service calls.
* Data Layer event suffix changed to '_synapse'.
