/*!
 * Synapse Conversion Tracking - edge sender tail (v2.0.0)
 *
 * Concatenated after the vendored Data Tag sender core into assets/s.js, which
 * the edge worker serves as one immutable first-party file. Everything here used
 * to travel inline in every page's <head>; moving it into the cached file cuts
 * the inline block by roughly two thirds while keeping identical behaviour.
 *
 * Ordering guarantee that makes the move safe: the container loader is gated
 * behind THIS file's load (see get_edge_sender_boot_js), so every wrapper
 * installed here is in place before the GTM container - and therefore before any
 * Data Tag or Google tag hit - ever runs.
 *
 * Site-specific configuration is read from window.__synCfg, emitted inline by
 * the plugin, so this file stays byte-identical for every tenant and caches
 * once at the edge:
 *   p - container URL path prefix, e.g. "/lmr"
 *   t - GA4 measurement id for the recovery watchdog, "" when disabled
 *   c - raw web container id, e.g. "GTM-XXXXXXX"
 *   s - data-layer custom event suffix, "" for whitelist mode
 *   d - 1 when the Data Client transport rescue is enabled
 *
 * Everything fails open: any error leaves the page untouched. Nothing here can
 * block a request, and no wrapper ever swallows a call.
 */
(function (w, d) {
  try {
    if (w.__synTail) { return; }

    var CFG = w.__synCfg || {};
    var P = typeof CFG.p === 'string' ? CFG.p : '';
    var O = w.location && w.location.origin;
    var SIGNALLED = {};

    /* ----------------------------------------------------------------
     * 1. Loaded-cache seed
     *
     * The Data Tag template skips injecting its own sender when the URL it
     * would inject is already marked true in gtm_dataTagScriptLoadedCache.
     * That URL is "<third-party CDN>/dtag/v<N>.js" - the CDN sits on the
     * EasyPrivacy list, so in Brave (and any blocker using it) the injection
     * fails and every POST-shaped event is lost. Seeding the key makes the
     * template call the first-party copy loaded above instead.
     *
     * The key prefix is base64-decoded at runtime so the third-party brand
     * string never appears in this file or in the page source.
     *
     * SEED_LO..SEED_HI is the range of template versions covered. The current
     * template is v9; the window reaches three versions ahead so a template
     * update keeps working instead of silently falling back to the blocked
     * CDN injection. Widening it is a deliberate edit: every version inside
     * the window is a version whose payload contract we are asserting the
     * vendored core still satisfies. The signature tripwire in section 2 and
     * dev-tools/template-drift-check.mjs are what make a broken assertion
     * loud instead of silent.
     * ---------------------------------------------------------------- */
    var SEED_LO = 9;
    var SEED_HI = 12;
    var PREFIX = '';

    try {
      PREFIX = w.atob('aHR0cHM6Ly9zdGFwZWNkbi5jb20vZHRhZy8=');
      var k = 'gtm_dataTagScriptLoadedCache';
      var cache = w[k] = w[k] || {};
      for (var i = SEED_LO; i <= SEED_HI; i++) {
        cache[PREFIX + 'v' + i + '.js'] = true;
      }
    } catch (x) { /* seeding is best-effort; template self-injects if it fails */ }

    /* One 1x1 pixel per signal class per page. Deliberately a bare Image GET:
     * the ad-blocker shim only wraps fetch/XHR/sendBeacon, so this arrives at
     * the worker verbatim and lands in the request log for the panel to read.
     * Never fires on a healthy page. */
    function sig(kind, note) {
      try {
        if (SIGNALLED[kind] || !P || !O || !w.Image) { return; }
        SIGNALLED[kind] = 1;
        var px = new w.Image(1, 1);
        px.src = O + P + '/_sg?k=' + encodeURIComponent(kind) +
          '&n=' + encodeURIComponent(String(note).slice(0, 40)) + '&_syng=1';
      } catch (x) { /* never let observability break delivery */ }
    }

    /* Published so the rest of the plugin can report an anomaly through the
     * same channel - assets/js/javascript.js raises "cart_state" here when the
     * cart-state request fails. Guarded at every call site, so a page without
     * the tail simply has no signals. */
    try { w.__synSig = sig; } catch (x) { /* frozen window */ }

    /* ----------------------------------------------------------------
     * 2. Signature tripwire
     *
     * Guards the contract between the template and the vendored core. The
     * template calls dataTagSendData with exactly 7 positional arguments
     * (data, serverDomain, requestPath, dlEventName, dlVariableName,
     * waitForCookies, useFetchInsteadOfXHR) and dataTagGetData with 4. If a
     * future template version changes either shape, the core would receive
     * mismatched arguments and quietly send wrong data - the one failure mode
     * that does not announce itself.
     *
     * The wrappers NEVER block: they inspect, signal at most once, and always
     * forward the original arguments to the original function. A tripped
     * tripwire means "look at the panel", not "tracking stopped".
     *
     * The named parameters keep Function.length at 7 and 4, so any template
     * that ever feature-detects by arity is not misled.
     * ---------------------------------------------------------------- */
    try {
      var realSend = w.dataTagSendData;
      if (typeof realSend === 'function' && !realSend.__syn) {
        var send = function (a1, a2, a3, a4, a5, a6, a7) {
          try {
            var a = arguments;
            if (a.length !== 7 ||
              !a[0] || typeof a[0] !== 'object' ||
              typeof a[1] !== 'string' || a[1].slice(0, 4) !== 'http' ||
              typeof a[2] !== 'string' || a[2].charAt(0) !== '/') {
              sig('send_sig', a.length);
            }
          } catch (x) { /* inspection must never affect the call */ }
          return realSend.apply(this, arguments);
        };
        send.__syn = 1;
        w.dataTagSendData = send;
      }

      var realGet = w.dataTagGetData;
      if (typeof realGet === 'function' && !realGet.__syn) {
        var get = function (a1, a2, a3, a4) {
          try {
            if (arguments.length !== 4) { sig('get_sig', arguments.length); }
          } catch (x) { /* inspection must never affect the call */ }
          return realGet.apply(this, arguments);
        };
        get.__syn = 1;
        w.dataTagGetData = get;
      }
    } catch (x) { /* leave the originals untouched on any error */ }

    /* ----------------------------------------------------------------
     * 3. Injection detector
     *
     * The only way the template reaches its own injectScript call is a seed
     * miss - i.e. it wants a version outside SEED_LO..SEED_HI. That is
     * exactly the event worth knowing about, because in Brave it means lost
     * POSTs. Four cheap polls of document.scripts instead of a live observer:
     * no permanent cost on a heavy DOM, and the signal carries only the
     * script URL or version filename (no user data).
     *
     * Two matches, not one. The exact-prefix match reports the familiar
     * "v<N>.js" note. The second match is the CDN path shape alone (the
     * "/dtag/" segment, derived at runtime from the decoded prefix so no new
     * literal appears in this file): if a future template moves the sender to
     * a DIFFERENT host, the injection is still reported instead of becoming
     * invisible - a host change would otherwise silently kill Brave-class
     * POST events with no signal at all. The note then carries the head of
     * the foreign URL so the panel shows where the template went.
     * ---------------------------------------------------------------- */
    try {
      if (PREFIX && w.setTimeout && d && d.scripts) {
        var si = PREFIX.indexOf('/', 8);
        var SHAPE = si > 0 && PREFIX.length - si > 2 ? PREFIX.slice(si) : '';
        var checkInjection = function () {
          try {
            for (var j = 0; j < d.scripts.length; j++) {
              var src = String(d.scripts[j].src || '');
              if (src.slice(0, PREFIX.length) === PREFIX) {
                sig('cdn_inject', src.slice(PREFIX.length));
                return;
              }
              if (SHAPE && src.indexOf(SHAPE) > 0) {
                sig('cdn_inject', src);
                return;
              }
            }
          } catch (x) { /* polling is best-effort */ }
        };
        var delays = [2000, 5000, 10000, 30000];
        for (var n = 0; n < delays.length; n++) { w.setTimeout(checkInjection, delays[n]); }
      }
    } catch (x) { /* detector is optional */ }

    /* ----------------------------------------------------------------
     * 4. Data Client transport rescue
     *
     * If a Data Tag POST is attempted and provably fails in transit (fetch
     * rejection, beacon refusal, XHR network error - never on an HTTP
     * response of any status), the exact payload is resent once as the Data
     * Client's own GET pixel form: the body base64-encoded into "dtdc". The
     * Data Client parses both forms into the same event model, so the rescued
     * event is byte-identical, event_id included. Rescued hits carry
     * "_synr=1" so they stay identifiable in the request log.
     *
     * Byte-for-byte the wrappers that shipped inline in v1.6.x; only their
     * location changed. They sit on top of the shim's, so they observe the
     * plain pre-encoding URLs and bodies, while the rescue pixel itself is a
     * bare Image - the same naked first-party shape as the Data Tag's own
     * small pixels, which is exactly the transport that passes.
     * ---------------------------------------------------------------- */
    if (CFG.d && P && O) {
      try {
        if (!w.__synDataRescue) {
          w.__synDataRescue = 1;

          var dc = function (u) {
            try {
              var a = new URL(u, w.location.href);
              if (a.origin !== O) { return null; }
              if (a.pathname.slice(0, P.length + 1) !== P + '/') { return null; }
              var r = a.pathname.slice(P.length);
              if (r !== '/data' && r !== '/data/') { return null; }
              return a;
            } catch (x) { return null; }
          };

          var R = function (a, b) {
            try {
              if (!b || typeof b !== 'string') { return; }
              if (a.searchParams && a.searchParams.has('dtdc')) { return; }
              if (!w.Image) { return; }
              var q = a.search ? a.search.slice(1) + '&' : '';
              (new w.Image(1, 1)).src = O + a.pathname + '?' + q + 'dtdc=' +
                encodeURIComponent(w.btoa(unescape(encodeURIComponent(b)))) + '&_synr=1';
            } catch (x) { /* rescue is best-effort */ }
          };

          if (w.fetch) {
            var origFetch = w.fetch;
            w.fetch = function (i2, o2) {
              var p = origFetch.apply(w, arguments);
              try {
                var u = (typeof i2 === 'string' || (w.URL && i2 instanceof w.URL)) ? String(i2) : (i2 && i2.url) || '';
                var m = String((o2 && o2.method) || (i2 && typeof i2 === 'object' && i2.method) || 'GET').toUpperCase();
                if ('POST' === m && u) {
                  var a3 = dc(u);
                  var b3 = o2 && typeof o2.body === 'string' ? o2.body : null;
                  if (a3 && b3 && p && typeof p.catch === 'function') { p.catch(function () { R(a3, b3); }); }
                }
              } catch (x) { /* observation must not affect the call */ }
              return p;
            };
          }

          var nav0 = w.navigator;
          if (nav0 && nav0.sendBeacon) {
            var sb0 = nav0.sendBeacon.bind(nav0);
            nav0.sendBeacon = function (u, dd) {
              var okB = sb0.apply(nav0, arguments);
              try {
                if (!okB) {
                  var a4 = dc(String(u));
                  if (a4 && typeof dd === 'string' && dd) { R(a4, dd); }
                }
              } catch (x) { /* observation must not affect the call */ }
              return okB;
            };
          }

          var XR = w.XMLHttpRequest;
          if (XR && XR.prototype && XR.prototype.open && XR.prototype.send) {
            var xo = XR.prototype.open;
            var xs = XR.prototype.send;
            XR.prototype.open = function (m, u) {
              try { this.__synDR = 'POST' === String(m || '').toUpperCase() ? dc(String(u)) : null; }
              catch (x) { this.__synDR = null; }
              return xo.apply(this, arguments);
            };
            XR.prototype.send = function (b) {
              try {
                var a5 = this.__synDR;
                if (a5 && typeof b === 'string' && b) {
                  var fired = 0;
                  var g5 = function () { if (!fired) { fired = 1; R(a5, b); } };
                  this.addEventListener('error', g5);
                  this.addEventListener('timeout', g5);
                }
              } catch (x) { /* observation must not affect the call */ }
              return xs.apply(this, arguments);
            };
          }
        }
      } catch (x) { /* rescue never breaks the page */ }
    }

    /* ----------------------------------------------------------------
     * 5. GA4 measurement recovery watchdog
     *
     * Some browser privacy modes (most notably iOS Safari Private Browsing)
     * let the container run but silently prevent its Google tag from ever
     * dispatching a /g/collect hit, while plain first-party fetches keep
     * working. If the container has loaded and the Google tag is still silent
     * after the grace period, the visit is recovered through the existing
     * server container pipeline: a minimal page_view first, then every
     * data-layer event the plugin pushed, ecommerce translated to the GA4
     * protocol. Every hit carries "synapse_recovered" so recovered traffic
     * stays identifiable in GA4 and in the logs.
     *
     * The "has the Google tag spoken" observation is NOT made here - it is
     * made by the inline sentinel, which is installed before this file even
     * starts loading and writes window.__synSeen. That split is what makes it
     * safe to move the watchdog out of the inline block: if this file arrives
     * late (say after the boot timeout already started the container), the
     * sentinel has been watching the whole time, so a hit that already went
     * out is still counted and no duplicate recovery is produced.
     *
     * In normal browsers the Google tag sends within a couple of seconds, the
     * sentinel records it, and this does nothing - zero behaviour change. If
     * the container never loads (blocked, or consent-gated and never granted)
     * the watchdog never arms, so no unconsented hit is ever produced.
     * ---------------------------------------------------------------- */
    /* The ids arrive base64-encoded so the page source carries no readable
     * Google id. Both forms are accepted, on purpose and permanently: the
     * discriminator is "-", which every Google id contains (G-, GTM-, AW-,
     * DC-, UA-) and which standard base64 can never produce. So a plain value
     * is passed through untouched and an encoded one is decoded, with no
     * version flag anywhere. That is what makes every combination of plugin
     * version and cached copy of this file safe: an old plugin emitting plain
     * ids works against this file, and this file's predecessor - which reads
     * the value literally - only ever meets plain ids, because the ?v= token
     * is a content hash, so a page that carries encoded ids can only have
     * asked for the build that decodes them.
     *
     * A decode failure returns "" rather than the raw value: an undecodable
     * id would make the container lookup below miss anyway, and "" is the
     * established "feature off" signal, so the watchdog simply never arms
     * instead of arming against a wrong key. */
    var decId = function (v) {
      if (typeof v !== 'string' || '' === v) { return ''; }
      if (-1 !== v.indexOf('-')) { return v; }
      try { return w.atob(v); } catch (x) { return ''; }
    };

    var T = decId(CFG.t);
    var C = decId(CFG.c);
    var SUF = typeof CFG.s === 'string' ? CFG.s : '';

    if (T && C && P && O) {
      try {
        if (!w.__synGa4Fb) {
          w.__synGa4Fb = 1;

          var G = 8000;
          var sent = false, armT = 0, hn = 0, di = 0, hooked = false, ses = null, con = null, stopped = false;
          var nav = w.navigator, doc = w.document, eu = encodeURIComponent;
          var WL = {
            view_item: 1, view_item_list: 1, select_item: 1, add_to_cart: 1,
            remove_from_cart: 1, view_cart: 1, begin_checkout: 1, add_payment_info: 1,
            add_shipping_info: 1, purchase: 1, refund: 1, search: 1, login: 1, sign_up: 1
          };

          /* Captured after the shim (and the rescue) installed, so the recovery
           * hit is encoded exactly like every other container hit. */
          var IF = w.fetch ? w.fetch.bind(w) : null;

          /* Did the Google tag for OUR property speak? __synSeenT is the
           * sentinel's per-property map, with "*" for a hit that carried no id
           * in the query (GA4 may post its parameters in the body). Falling
           * back to the coarse __synSeen flag keeps a page working against a
           * sender cached from a release whose sentinel only had that. */
          var heard = function () {
            try {
              var m = w.__synSeenT;
              if (m) { return !!(m[T] || m['*']); }
            } catch (x) { /* fall through to the coarse flag */ }
            return !!w.__synSeen;
          };

          var consent = function () {
            var got = false, ad = false, an = false;
            try {
              var dl = w.dataLayer || [];
              for (var i6 = 0; i6 < dl.length; i6++) {
                var e6 = dl[i6];
                if (e6 && 'consent' === e6[0] && ('default' === e6[1] || 'update' === e6[1]) && e6[2] && 'object' === typeof e6[2]) {
                  got = true;
                  if (void 0 !== e6[2].ad_storage) { ad = 'granted' === e6[2].ad_storage; }
                  if (void 0 !== e6[2].analytics_storage) { an = 'granted' === e6[2].analytics_storage; }
                }
              }
            } catch (x) { /* absent consent data means unmanaged consent */ }

            /* A CMP wired through GTM's own consent templates calls
             * setDefaultConsentState / updateConsentState, which never appear
             * in the dataLayer as consent entries at all. GTM resolves them
             * into google_tag_data.ics, and that is the authoritative state,
             * so it wins over anything read above. Without this a visitor who
             * declined through such a CMP was treated as unmanaged and every
             * recovered hit went out as gcs=G111.
             *
             * 1 is granted, 2 is denied, absent means that particular signal
             * was never set - so each one is only taken when it is known. */
            try {
              /* The entries table, not getConsentState(). On a live container
               * that function takes a container context as its second
               * argument and throws without one, so the call never returned
               * anything on a real site and this whole branch was dead. An
               * entry carries update (the CMP's answer) over default (the
               * initial state); either may be absent. */
              var ics = w.google_tag_data && w.google_tag_data.ics;
              var en7 = ics && ics.entries;
              var pick = function (k) {
                var e7 = en7 && en7[k];
                if (!e7) { return void 0; }
                if (void 0 !== e7.update) { return !!e7.update; }
                if (void 0 !== e7['default']) { return !!e7['default']; }
                return void 0;
              };
              var a7 = pick('ad_storage'), n7 = pick('analytics_storage');
              if (void 0 !== a7) { got = true; ad = a7; }
              if (void 0 !== n7) { got = true; an = n7; }
            } catch (x) { /* GTM internals are best-effort */ }

            if (!got) { ad = true; an = true; }
            return { ad: ad, an: an };
          };

          /* Identity, deliberately in two parts.
           *
           * The persisted one lives in sessionStorage and is only ever touched
           * while analytics storage is granted. The ephemeral one is minted
           * once per page load and is what a visitor who refused, or whose
           * browser refuses storage, is measured with.
           *
           * Keeping them apart is the point. There used to be a single state()
           * that was re-run whenever the current identity was not persisted, so
           * that a denied -> granted visitor would move onto the stored id.
           * When storage is unavailable that condition never clears, so every
           * hit minted a fresh client id and one visitor arrived as several -
           * in exactly the browsers recovery exists to serve. */
          var mkid = function (now) { return Math.floor(9e8 * Math.random() + 1e8) + '.' + now; };

          /* GA4's own client id, if the real tag has already set _ga on this
           * domain. Adopting it puts a recovered hit on the same user as the
           * hits that got through, instead of inventing a parallel one that
           * splits the same person in two.
           *
           * Only read when a NEW identity is being minted: switching away from
           * an id that has already sent hits this session would recreate the
           * split it is meant to prevent. A cookie read is storage access, and
           * persisted() is the only caller - it is reached only when analytics
           * storage is granted. */
          var gaCid = function () {
            try {
              var m9 = /(?:^|;\s*)_ga=GA\d+\.\d+\.(\d+\.\d+)/.exec((doc && doc.cookie) || '');
              return m9 ? m9[1] : null;
            } catch (x) { return null; }
          };

          /* Two separate questions, which used to share one answer:
           *   fresh - recovery has no record of this browser session,
           *   first - Analytics has never seen this visitor at all.
           * The absence of our own record only answers the first of them. A
           * _ga cookie is proof the Google tag already counted this person,
           * so claiming a first visit on top of their existing client id
           * would inflate new users for no reason. */
          /* Two ephemeral identities, not one, and never the same object.
           *
           * ephD is what a denied visitor is measured with: random, minted
           * once per page, and it never sees a cookie or storage - a denied
           * hit must be a genuine cookieless ping. ephG is for a granted
           * visitor whose browser gives us no working storage: also minted
           * once, and it may adopt the _ga client id because consent allows
           * the read. One shared object used to serve both, so an id taken
           * from the cookie under consent was still being sent after that
           * consent was withdrawn. Each is decided once and never revised,
           * so within either consent state the id is stable for the page. */
          var ephD = null, ephG = null;
          var ephemeral = function (an) {
            var n;
            if (!an) {
              if (!ephD) {
                n = Math.floor(Date.now() / 1e3);
                ephD = { cid: mkid(n), sid: n, first: true, fresh: true };
              }
              return ephD;
            }
            if (!ephG) {
              n = Math.floor(Date.now() / 1e3);
              var ga = gaCid();
              ephG = { cid: ga || mkid(n), sid: n, first: !ga, fresh: true };
            }
            return ephG;
          };

          /* Null means the identity could not be kept, which is not the same as
           * sessionStorage being absent: a storage object can exist, accept a
           * write and keep nothing. The round trip is proven rather than
           * assumed, and a null sends the caller to the ephemeral identity -
           * stable for the page - instead of to a new id on every hit. */
          var persisted = function () {
            var s = null;
            try { s = w.sessionStorage; } catch (x) { return null; }
            if (!s) { return null; }
            var now = Math.floor(Date.now() / 1e3), st = null;
            try { st = JSON.parse(s.getItem('_synfb') || 'null'); } catch (x) { st = null; }
            var first = !st || !st.cid;
            var fresh = first;
            if (first) {
              var ga = gaCid();
              st = { cid: ga || mkid(now), sid: now };
              /* Still a new recovery session, but not a new visitor. */
              if (ga) { first = false; }
            }
            try {
              s.setItem('_synfb', JSON.stringify(st));
              if (!s.getItem('_synfb')) { return null; }
            } catch (x) { return null; }
            return { cid: st.cid, sid: st.sid, first: first, fresh: fresh };
          };

          /* The stored identity is attempted exactly once per page. Retrying
           * on every hit while it fails would let storage that starts working
           * mid-page move the visitor onto a new id after hits have already
           * gone out under the ephemeral one - the same split, from the other
           * direction. */
          var pers = null, persTried = false;
          var state = function (an) {
            if (!an) { return ephemeral(false); }
            if (!persTried) { persTried = true; pers = persisted(); }
            return pers || ephemeral(true);
          };

          var itstr = function (a) {
            var M = {
              item_id: 'id', item_name: 'nm', item_brand: 'br', item_variant: 'va',
              item_category: 'ca', item_category2: 'c2', item_category3: 'c3',
              item_category4: 'c4', item_category5: 'c5', price: 'pr', quantity: 'qt',
              coupon: 'cp', discount: 'ds', index: 'lp', item_list_id: 'li',
              item_list_name: 'ln', affiliation: 'af'
            };
            var out = [], i7, k7, it, p7, v7;
            for (i7 = 0; i7 < a.length && i7 < 60; i7++) {
              it = a[i7] || {}; p7 = [];
              for (k7 in M) {
                v7 = it[k7];
                if (v7 === void 0 || v7 === null || v7 === '') { continue; }
                v7 = String(v7).replace(/~/g, ' ');
                if (v7.length > 100) { v7 = v7.slice(0, 100); }
                p7.push(M[k7] + v7);
              }
              if (p7.length) { out.push('pr' + (i7 + 1) + '=' + eu(p7.join('~'))); }
            }
            return out;
          };

          var ecom = function (ec) {
            var ex = [];
            try {
              if (!ec || 'object' !== typeof ec) { return ex; }
              if (ec.currency) { ex.push('cu=' + eu(ec.currency)); }
              if (ec.value !== void 0 && ec.value !== null && ec.value !== '') { ex.push('epn.value=' + eu(ec.value)); }
              if (ec.transaction_id) { ex.push('ep.transaction_id=' + eu(ec.transaction_id)); }
              if (ec.tax) { ex.push('epn.tax=' + eu(ec.tax)); }
              if (ec.shipping) { ex.push('epn.shipping=' + eu(ec.shipping)); }
              if (ec.coupon) { ex.push('ep.coupon=' + eu(ec.coupon)); }
              if (ec.items && ec.items.length) { ex = ex.concat(itstr(ec.items)); }
            } catch (x) { /* malformed ecommerce object */ }
            return ex;
          };

          var send2 = function (en, extra) {
            if (!IF || stopped) { return; }
            try {
              /* Consent is read per hit, not captured once at fire(). A visitor
               * who answers the banner after the watchdog armed would otherwise
               * have every later hit - including purchase - labelled with the
               * state as it was at second eight, for the whole page. */
              con = consent();
              /* Identity follows the consent that was just read. Granted moves
               * onto the stored id so the session stitches together; withdrawn
               * drops back to the ephemeral one, so a denied hit is a genuine
               * cookieless ping and not the stored identity wearing gcs=G100. */
              ses = state(con.an);
              hn++;
              var q = [
                'v=2', 'tid=' + eu(T), 'cid=' + eu(ses.cid), 'sid=' + ses.sid, 'sct=1',
                'seg=' + (ses.fresh && 1 === hn ? '0' : '1'),
                '_p=' + Math.floor(9e8 * Math.random() + 1e8), '_s=' + hn,
                'gcs=G1' + (con.ad ? '1' : '0') + (con.an ? '1' : '0'),
                'npa=' + (con.ad ? '0' : '1'),
                'ul=' + eu(((nav && nav.language) || '').toLowerCase()),
                'sr=' + (w.screen ? w.screen.width + 'x' + w.screen.height : ''),
                'dl=' + eu(w.location.href),
                'dt=' + eu((doc && doc.title) || ''),
                'en=' + eu(en),
                'ep.synapse_recovered=1'
              ];
              if (doc && doc.referrer) { q.push('dr=' + eu(doc.referrer)); }
              if (ses.fresh && 1 === hn) { q.push('_ss=1', '_nsi=1'); }
              if (ses.first && 1 === hn) { q.push('_fv=1'); }
              if (extra && extra.length) { q = q.concat(extra); }
              /* Our own hit travels through the sentinel, which would set the
               * "the Google tag spoke" flag and make the watchdog disarm itself
               * on its very first send. The sentinel writes that flag
               * synchronously inside its fetch wrapper, so restoring it right
               * after the call is exact rather than racy. */
              var preS = w.__synSeen;
              var preT = w.__synSeenT && w.__synSeenT[T];
              IF(O + P + '/g/collect?' + q.join('&'), { method: 'GET', keepalive: true }).catch(function () { });
              try {
                if (!preS) { w.__synSeen = preS; }
                if (w.__synSeenT && !preT) { delete w.__synSeenT[T]; }
              } catch (xr) { /* frozen window */ }
            } catch (x) { /* recovery is best-effort */ }
          };

          var evName = function (nm) {
            if ('string' !== typeof nm || !nm) { return null; }
            if (SUF) {
              if (nm.length > SUF.length && nm.slice(-SUF.length) === SUF) { return nm.slice(0, nm.length - SUF.length); }
              return null;
            }
            return WL[nm] ? nm : null;
          };

          var pump = function () {
            try {
              /* A Google tag that wakes up late takes over from here. Without
               * this the push hook installed by fire() stays live for the rest
               * of the page and every further event is sent twice: once by the
               * real tag and once as a recovered duplicate. */
              if (heard()) { stopped = true; }
              if (stopped) { di = (w.dataLayer || []).length; return; }
              var dl = w.dataLayer || [];
              for (; di < dl.length; di++) {
                var e8 = dl[di];
                if (!e8 || 'object' !== typeof e8 || Array.isArray(e8)) { continue; }
                var en = evName(e8.event);
                if (!en || 'page_view' === en) { continue; }
                send2(en, ecom(e8.ecommerce));
              }
            } catch (x) { /* replay is best-effort */ }
          };

          var fire = function () {
            if (heard() || sent) { return; }
            sent = true;
            try {
              con = consent();
              /* ses is not set here: send2 picks the identity from the consent
               * it reads per hit, so there is one place that decides it. */
              send2('page_view');
              pump();
              if (!hooked) {
                hooked = true;
                var dl = w.dataLayer = w.dataLayer || [];
                var dp = dl.push;
                dl.push = function () {
                  var r = dp.apply(dl, arguments);
                  try { pump(); } catch (x) { /* replay is best-effort */ }
                  return r;
                };
              }
            } catch (x) { /* recovery never breaks the page */ }
          };

          var polls = 0;
          var pt = w.setInterval(function () {
            try {
              if (heard() || sent) { w.clearInterval(pt); return; }
              if (w.google_tag_manager && w.google_tag_manager[C]) {
                w.clearInterval(pt);
                armT = Date.now();
                w.setTimeout(fire, G);
                return;
              }
              if (++polls > 240) { w.clearInterval(pt); }
            } catch (x) { w.clearInterval(pt); }
          }, 500);

          if (w.addEventListener) {
            w.addEventListener('pagehide', function () {
              try { if (!heard() && !sent && armT && Date.now() - armT > 2500) { fire(); } }
              catch (x) { /* unload path is best-effort */ }
            });
          }
        }
      } catch (x) { /* watchdog never breaks the page */ }
    }

    /* Set last: the boot reads this to know the tail actually ran end-to-end.
     * A worker still serving a core-only s.js leaves it unset, and the boot
     * then pulls assets/tail.js from the origin - so plugin and worker can be
     * deployed in either order without a broken window. */
    w.__synTail = 1;
  } catch (x) { /* nothing in this file may ever surface as a page error */ }
})(window, document);
