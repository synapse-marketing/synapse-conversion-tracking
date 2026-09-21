<?php
/**
 * The public-facing functionality of the plugin.
 *
 * @package    GTM_Server_Side
 * @subpackage GTM_Server_Side/includes
 * @since      2.0.0
 */

defined( 'ABSPATH' ) || exit;

/**
 * Tracking by code.
 */
class GTM_Server_Side_Tracking_Code {
	use GTM_Server_Side_Singleton;

	/**
	 * Init.
	 *
	 * @return void
	 */
	public function init() {
		if (
			! GTM_Server_Side_Helpers::is_enable_placement_code() &&
			! GTM_Server_Side_Helpers::is_enable_placement_gtm_consent()
		) {
			return;
		}

		add_action( 'wp_head', array( $this, 'wp_head' ) );
	}

	/**
	 * Add GTM Head.
	 *
	 * @return void
	 */
	public function wp_head() {
		if ( is_user_logged_in() && GTM_Server_Side_Helpers::is_enable_gtm_exclude_roles() ) {
			$current_user  = wp_get_current_user();
			$exclude_roles = GTM_Server_Side_Helpers::get_gtm_exclude_list_roles();

			if ( array_intersect( $exclude_roles, $current_user->roles ) ) {
				return;
			}
		}

		if ( GTM_Server_Side_Helpers::is_enable_placement_gtm_consent() ) {
			$this->print_gtm_consent_loader();
		}

		if ( GTM_Server_Side_Helpers::has_gtm_container_identifier() ) {
			$this->print_synapse_gtm_code();
			return;
		}

		$this->print_default_gtm_code();
	}

	/**
	 * Print default GTM Code.
	 *
	 * @return void
	 */
	private function print_default_gtm_code() {
		// phpcs:ignore Squiz.Strings.DoubleQuoteUsage.NotRequired
		echo "\n<script" . $this->print_tag_script_attrs() /* phpcs:ignore WordPress.Security.EscapeOutput.OutputNotEscaped */ . ">(function(w,d,s,l,i){w[l]=w[l]||[];w[l].push({'gtm.start':new Date().getTime(),event:'gtm.js'});var f=d.getElementsByTagName(s)[0],j=d.createElement(s),dl=l!='dataLayer'?'&l='+l:'';j.async=true;j.src='" . esc_js( GTM_Server_Side_Helpers::get_gtm_container_url() ) . '/' . esc_js( GTM_Server_Side_Helpers::get_gtm_container_identifier() ) . ".js?id='+i+dl;f.parentNode.insertBefore(j,f);})(window,document,'script','dataLayer','" . esc_js( GTM_Server_Side_Helpers::get_gtm_container_id() ) . "');</script>\n";
	}

	/**
	 * Print custom-loader GTM Code.
	 *
	 * @return void
	 */
	private function print_synapse_gtm_code() {
		// The enhanced ad-blocker shim (when enabled) is emitted as the first
		// statement INSIDE the loader's own <script>, so a single first-party
		// script both installs the network-API wrappers and injects the
		// container - in that order. Wrappers are in place before the container
		// script runs, so every hit it later sends is rewritten; if the shim is
		// disabled the string is empty and only the loader is printed.
		// The Data Client transport rescue (when enabled) is emitted AFTER the
		// shim: its wrappers sit on top of the shim's, so it observes the plain
		// (pre-encoding) hit URLs and bodies, while its rescue pixel is a bare
		// Image request - the same naked first-party shape as the Data Tag's
		// own small pixels, which is exactly the transport that passes.
		// The GA4 recovery watchdog (when enabled) is emitted LAST on purpose:
		// its observers then wrap on top of both, so they see the plain
		// (pre-encoding) hit URLs, while its own recovery hit - sent via a
		// fetch reference captured after the shim installed - still gets encoded.
		$head = $this->get_enhanced_adblocker_shim_js() . $this->get_data_rescue_js() . $this->get_ga4_fallback_js();

		// The container loader closes the script. Normally it runs inline right
		// after the wrappers. When the Data Tag sender is served from the edge
		// (edge-sender mode) get_edge_sender_boot_js() instead gates the loader
		// behind the external sender's load: the sender defines the transport
		// functions and the loaded-cache seed is set before the container - and
		// therefore the Data Tag - ever runs. If edge-sender is off the loader is
		// returned unchanged, byte-for-byte the inline behavior.
		$loader = $this->get_edge_sender_boot_js( $this->get_gtm_loader_js() );

		// phpcs:ignore Squiz.Strings.DoubleQuoteUsage.NotRequired
		echo "\n<script" . $this->print_tag_script_attrs() /* phpcs:ignore WordPress.Security.EscapeOutput.OutputNotEscaped */ . ">" . $head /* phpcs:ignore WordPress.Security.EscapeOutput.OutputNotEscaped */ . $loader /* phpcs:ignore WordPress.Security.EscapeOutput.OutputNotEscaped */ . "</script>\n";
	}

	/**
	 * Build the GTM container loader IIFE (the closing statement of the head
	 * script). Byte-for-byte the snippet that used to be inlined in
	 * print_synapse_gtm_code(); extracted so the edge-sender boot can gate it.
	 *
	 * @return string
	 */
	private function get_gtm_loader_js() {
		// phpcs:ignore Squiz.Strings.DoubleQuoteUsage.NotRequired
		return "(function(w,d,s,l,i){w[l]=w[l]||[];w[l].push({'gtm.start':new Date().getTime(),event:'gtm.js'});var f=d.getElementsByTagName(s)[0],j=d.createElement(s);j.async=true;j.src=\"" . esc_js( GTM_Server_Side_Helpers::get_gtm_container_url() ) . '/' . esc_js( GTM_Server_Side_Helpers::get_gtm_container_identifier() ) . ".js?\"+i;f.parentNode.insertBefore(j,f);})(window,document,'script','dataLayer','" . esc_js( GTM_Server_Side_Helpers::get_gtm_container_id() ) . "');";
	}

	/**
	 * Whether the Data Tag sender is served from the edge instead of inlined.
	 *
	 * Requires the rescue feature (the sender belongs to it), its own toggle,
	 * and a container URL with a path prefix to derive a routable sender URL.
	 *
	 * @return bool
	 */
	private function is_edge_sender_active() {
		return GTM_Server_Side_Helpers::is_enable_data_rescue()
			&& GTM_Server_Side_Helpers::is_enable_edge_sender()
			&& '' !== GTM_Server_Side_Helpers::get_edge_sender_url();
	}

	/**
	 * Wrap the container loader so it boots only after the edge-served Data Tag
	 * sender has loaded (or provably failed), or return it unchanged when
	 * edge-sender mode is off.
	 *
	 * In edge-sender mode the ~23 KB vendored sender no longer travels inline in
	 * every page; the worker serves it as an immutable first-party file. The
	 * template still needs window.dataTagSendData defined and the
	 * gtm_dataTagScriptLoadedCache seed set before it fires, so a small
	 * bootstrap loads the sender script and, on load, sets the seed and then
	 * injects the container. On error or a timeout it injects the container
	 * anyway WITHOUT the seed: the Data Tag then falls back to its own (list-
	 * blocked) injection - exactly the pre-edge-sender behavior - so a missing
	 * or slow sender degrades gracefully and never blocks tracking.
	 *
	 * The seed itself no longer lives here. Since v1.7.0 the sender file is
	 * built as the vendored core plus a tail (assets/tail.js) that carries the
	 * seed, the signature tripwire, the transport rescue and the GA4 recovery
	 * watchdog. That code is identical for every site - it reads what differs
	 * from window.__synCfg, emitted just below - so it caches once at the edge
	 * instead of being re-sent inline with every page view. This method is what
	 * remains inline: the config object, the loader, and the ordering guarantee
	 * that the container never boots before them.
	 *
	 * Three load outcomes, all of which end with the container running:
	 *   - sender loads with its tail  -> everything installed, then boot
	 *   - sender loads without a tail -> pull assets/tail.js, then boot
	 *     (an edge worker still serving the pre-1.7.0 core-only build)
	 *   - sender fails outright       -> retry once from the plugin folder;
	 *     if that fails too, boot anyway WITHOUT the seed, so the Data Tag
	 *     falls back to its own (list-blocked) injection - exactly the
	 *     pre-edge-sender behaviour
	 * and a 3s timeout boots the container regardless, so nothing on the page
	 * can ever wait on this. The container is booted exactly once.
	 *
	 * @param string $loader The container loader IIFE from get_gtm_loader_js().
	 * @return string
	 */
	private function get_edge_sender_boot_js( $loader ) {
		if ( ! $this->is_edge_sender_active() ) {
			return $loader;
		}

		$primary_js  = wp_json_encode( GTM_Server_Side_Helpers::get_edge_sender_url() );
		$fallback_js = wp_json_encode( GTM_Server_Side_Helpers::get_edge_sender_fallback_url() );
		$tail_js     = wp_json_encode( GTM_Server_Side_Helpers::get_edge_sender_tail_url() );

		return $this->get_synapse_cfg_js()
			. '(function(w,d){if(w.__synEdgeBoot)return;w.__synEdgeBoot=1;function boot(){' . $loader . '}'
			. 'var done=0,alt=0,PR=' . $primary_js . ',FB=' . $fallback_js . ',TL=' . $tail_js . ';'
			. 'function go(){if(done)return;done=1;boot()}'
			. 'function ld(u,ok,bad){try{if(!u){bad();return}var s=d.createElement("script");s.async=true;s.src=u;s.onload=ok;s.onerror=bad;var f=d.getElementsByTagName("script")[0];if(f&&f.parentNode){f.parentNode.insertBefore(s,f)}else{(d.head||d.documentElement).appendChild(s)}}catch(x){bad()}}'
			. 'function ready(){if("function"==typeof w.dataTagSendData){if(w.__synTail){go();return}ld(TL,go,go);return}if(alt){go();return}alt=1;ld(FB,ready,go)}'
			. 'try{ld(PR,ready,ready);w.setTimeout(go,3000)}catch(x){go()}})(window,document);';
	}

	/**
	 * Emit window.__synCfg - the only site-specific data the edge-served tail
	 * needs.
	 *
	 * Keeping the configuration inline and the code external is what makes the
	 * sender file byte-identical across every site the worker serves, so one
	 * edge cache entry answers all of them. The keys are short because this
	 * object is the part that does travel with every page view:
	 *   p - container URL path prefix ("/lmr")
	 *   t - GA4 measurement id for the recovery watchdog, "" when off
	 *   c - raw web container id, "" when the watchdog cannot arm
	 *   s - data-layer custom event suffix, "" for whitelist matching
	 *   d - 1 when the Data Client transport rescue is enabled
	 *
	 * Values the tail treats as "feature off" are emitted as empty strings
	 * rather than omitted, so the tail never has to distinguish "absent" from
	 * "disabled".
	 *
	 * "t" and "c" are base64-encoded so the page carries no readable Google
	 * id. This is camouflage against automated scanning of the HTML, nothing
	 * more - the tail decodes them and every downstream byte is unchanged.
	 * See encode_cfg_id() for why standard base64 is the right alphabet here.
	 *
	 * @return string
	 */
	private function get_synapse_cfg_js() {
		$prefix = wp_parse_url( GTM_Server_Side_Helpers::get_gtm_container_url(), PHP_URL_PATH );
		$prefix = is_string( $prefix ) ? rtrim( $prefix, '/' ) : '';

		$tid          = '';
		$container_id = '';
		$suffix       = '';
		if ( GTM_Server_Side_Helpers::is_enable_ga4_fallback() ) {
			$tid          = (string) GTM_Server_Side_Helpers::get_ga4_fallback_id();
			$container_id = (string) GTM_Server_Side_Helpers::get_raw_gtm_container_id();
			$suffix       = GTM_Server_Side_Helpers::is_enable_data_layer_custom_event_name() ? GTM_SERVER_SIDE_DATA_LAYER_CUSTOM_EVENT_NAME : '';

			// The watchdog polls window.google_tag_manager[<raw id>]; without
			// both the id and the measurement id it can never arm, so say so
			// here rather than shipping a half-configured watchdog.
			if ( '' === $tid || '' === $container_id ) {
				$tid          = '';
				$container_id = '';
				$suffix       = '';
			}
		}

		$cfg = array(
			'p' => $prefix,
			't' => self::encode_cfg_id( $tid ),
			'c' => self::encode_cfg_id( $container_id ),
			's' => $suffix,
			'd' => GTM_Server_Side_Helpers::is_enable_data_rescue() ? 1 : 0,
		);

		return 'window.__synCfg=' . wp_json_encode( $cfg ) . ';';
	}

	/**
	 * Encode a Google id for __synCfg so it is not readable in the page source.
	 *
	 * Standard base64 is deliberate, not incidental: its alphabet contains no
	 * "-", while every Google id (G-, GTM-, AW-, DC-, UA-) does. That single
	 * property lets the tail tell an encoded value from a plain one with no
	 * flag, no version handshake and no ambiguity - which is what makes any
	 * combination of plugin version and cached tail version safe. Changing to
	 * base64url (which uses "-") would break that and must not be done.
	 *
	 * An empty id stays empty: the watchdog's "feature off" signal is the empty
	 * string, and base64 of "" is "" anyway, but saying so explicitly keeps the
	 * guard above readable.
	 *
	 * @param string $id Raw id, '' when the feature is off.
	 * @return string
	 */
	private static function encode_cfg_id( $id ) {
		$id = (string) $id;

		return '' === $id ? '' : base64_encode( $id );
	}

	/**
	 * Print GTM Consent Loader Code.
	 *
	 * @return void
	 */
	private function print_gtm_consent_loader() {
		echo '<script>!function(){"use strict";for(var t={window:window,gtmVariable:"dataLayer",onConsentGranted:function(){var t,e,n;t="custom-loader",(t=document.getElementById(t))&&"text/plain"===t.type&&(t.type="text/javascript",n=t.cloneNode(!0),null!=(e=t.parentNode))&&e.replaceChild(n,t)}},e=t.window,n=t.gtmVariable,a=t.onConsentGranted,r=((t=e)[n]||(t[n]=[]),!1),o=t[n],d=function(){r||(r=!0,a())},i=function(t){return!(!t||"consent"!==t[0]||-1===["default","update"].indexOf(t[1])||!(t=t[2])||"object"!=typeof t||"granted"!==t.ad_storage&&"granted"!==t.analytics_storage)},u=o.push,l=(o.push=function(){for(var t=[],e=0;e<arguments.length;e++)t[e]=arguments[e];var n=u.apply(o,t);return i(t[0])&&d(),n},t[n]),c=l.length-1;0<=c;c--){var p=l[c];if(i(p))return d()}}();</script>';
	}

	/**
	 * Build the enhanced ad-blocker protection shim as a JavaScript string.
	 *
	 * Wraps navigator.sendBeacon / fetch / XMLHttpRequest so every hit the GTM
	 * container sends to the custom-loader transport path is rewritten from the
	 * ad-block-recognisable "<prefix>/g/collect?v=2&tid=..." shape into
	 * "<prefix>/<random>?ei=<base64url(realPath+query)>". The edge worker
	 * decodes it back before the server container, which still previews the
	 * plain request. Ad blockers match the visible URL, never the body, so
	 * hiding the path+query defeats the filter lists. Fails open: any error
	 * leaves the original request untouched so tracking never breaks.
	 *
	 * Returned as a bare IIFE (no <script> wrapper) so the caller can emit it as
	 * the opening statement of the loader's own script tag - one first-party
	 * script installs the wrappers and then loads the container. Returns '' when
	 * the feature is off or the transport has no distinctive path prefix to
	 * scope the rewrite to (a bare origin), so nothing unrelated is touched.
	 *
	 * The "ei" param key must stay in sync with EAB_PARAM in the edge worker.
	 *
	 * A worker that does not decode "ei" answers the encoded request with a 4xx
	 * (404 where the route is missing, 400 where an unknown path is passed on
	 * to the server container). That used to lose every hit silently: the shim
	 * rewrote and forwarded, and never looked at what came back. It now reads
	 * the response where a response exists - fetch and XMLHttpRequest, not
	 * sendBeacon - and on the first 4xx it resends that one request in its
	 * original plain form, stops encoding for the rest of the page so nothing
	 * else is doubled, and raises one "ei" signal carrying the status. A 5xx
	 * raises the signal but is neither resent nor treated as a broken worker,
	 * because a server that failed after accepting the hit would count it
	 * twice. A network error changes nothing: that is the ad-blocker case the
	 * encoding exists for, and falling back there would hand the hit to the
	 * blocker.
	 *
	 * @return string
	 */
	private function get_enhanced_adblocker_shim_js() {
		if ( ! GTM_Server_Side_Helpers::is_enable_enhanced_adblocker() ) {
			return '';
		}

		$prefix = wp_parse_url( GTM_Server_Side_Helpers::get_gtm_container_url(), PHP_URL_PATH );
		$prefix = is_string( $prefix ) ? rtrim( $prefix, '/' ) : '';
		if ( '' === $prefix ) {
			return '';
		}

		$prefix_js = wp_json_encode( $prefix );

		return '(function(w){try{var P=' . $prefix_js . ',K="ei",O=w.location&&w.location.origin;if(!O)return;var off=false,s5=false;function b(s){return w.btoa(unescape(encodeURIComponent(s))).replace(/\+/g,"-").replace(/\//g,"_").replace(/=+$/,"")}function r(){for(var c="abcdefghijklmnopqrstuvwxyz0123456789",s="",n=1+(Math.random()*8|0),i=0;i<n;i++)s+=c.charAt(Math.random()*c.length|0);return s}function e(u){try{if(off)return null;var a=new URL(u,w.location.href);if(a.origin!==O)return null;if(a.pathname.slice(0,P.length+1)!==P+"/")return null;var rel=a.pathname.slice(P.length);if(rel==="/gtm.js"||rel==="/gtag/js"||/\.js$/.test(rel)||rel.slice(0,5)==="/gtm/")return null;if(a.searchParams.has(K))return null;return O+P+"/"+r()+"?"+K+"="+b(rel+a.search)}catch(x){return null}}function sig(st){try{if("function"===typeof w.__synSig){w.__synSig("ei",String(st));return}if(w.Image){var px=new w.Image(1,1);px.src=O+P+"/_sg?k=ei&n="+encodeURIComponent(String(st))+"&_syng=1"}}catch(x){}}function trip(st){if(off)return;off=true;try{w.__synEiOff=1}catch(x){}sig(st)}function five(st){if(s5)return;s5=true;sig(st)}function judge(st,again){try{if(st>=400&&st<500){trip(st);if(again)again()}else if(st>=500)five(st)}catch(x){}}var nav=w.navigator;if(nav&&nav.sendBeacon){var sb=nav.sendBeacon.bind(nav);nav.sendBeacon=function(u,d){var n=e(u);return n?sb(n,d):sb(u,d)}}if(w.fetch){var of=w.fetch;w.fetch=function(i,o){var args=arguments;try{var n=null,c=null,str=(typeof i==="string"||i instanceof URL);if(str){n=e(i)}else if(i&&i.url){n=e(i.url);if(n){try{c=i.clone?i.clone():null}catch(x){c=null}}}if(n){var p=str?of.call(w,n,o):of.call(w,new Request(n,i),o);try{if(p&&typeof p.then==="function")p.then(function(res){judge(res&&res.status,function(){try{if(c)of.call(w,c,o);else of.apply(w,args)}catch(x){}})},function(){})}catch(x){}return p}}catch(x){}return of.apply(w,args)}}var X=w.XMLHttpRequest;if(X&&X.prototype&&X.prototype.open){var oo=X.prototype.open,os=X.prototype.send,oh=X.prototype.setRequestHeader;X.prototype.open=function(){try{var n=e(arguments[1]);if(n){this.__synO=[arguments[0],String(arguments[1])];this.__synH=[];arguments[1]=n}}catch(x){}return oo.apply(this,arguments)};if(oh)X.prototype.setRequestHeader=function(k,v){try{if(this.__synH)this.__synH.push([k,v])}catch(x){}return oh.apply(this,arguments)};if(os)X.prototype.send=function(bd){try{var self=this;if(self.__synO&&self.addEventListener)self.addEventListener("load",function(){judge(self.status,function(){try{var x2=new X();x2.open(self.__synO[0],self.__synO[1],true);for(var j=0;j<self.__synH.length;j++)x2.setRequestHeader(self.__synH[j][0],self.__synH[j][1]);x2.send(bd)}catch(x){}})})}catch(x){}return os.apply(this,arguments)}}}catch(x){}})(window);';
	}

	/**
	 * Build the Data Client transport rescue as a JavaScript string.
	 *
	 * Two independent protections for Data Tag deliveries, one toggle:
	 *
	 * 1. First-party sender. The Data Tag template sends its POST events by
	 *    injecting an external sender script from stapecdn.com and calling its
	 *    window.dataTagSendData() - and stapecdn.com sits on the EasyPrivacy
	 *    filter list ("||stapecdn.com^$third-party"), which Brave Shields (and
	 *    any blocker with EasyPrivacy) enforces. The injection fails, so the
	 *    POST is never even attempted: the Data Client pipeline (Meta CAPI
	 *    etc.) silently loses every POST-shaped event while the small GET
	 *    pixels keep passing. The template, however, first consults the
	 *    window.gtm_dataTagScriptLoadedCache map and skips the injection when
	 *    the sender URL is already marked loaded. So this method inlines a
	 *    vendored copy of the sender (assets/data-tag-sender.js, byte-identical
	 *    to the v9 script the template would inject) and pre-seeds that cache
	 *    key - the template then calls the first-party copy directly, in every
	 *    browser, and the third-party CDN dependency disappears entirely.
	 *
	 * 2. Delivery rescue. If a POST is attempted and provably fails in transit
	 *    (fetch rejection, beacon refusal, XHR network error - never on an
	 *    HTTP response of any status), the exact payload is resent once as the
	 *    Data Client's own GET pixel form: the POST body base64-encoded into
	 *    the "dtdc" query parameter. The Data Client parses both forms into
	 *    the same event model, so the rescued event is byte-identical
	 *    (event_id included - even a hypothetical double delivery stays
	 *    deduplicatable downstream). Rescued hits carry "_synr=1" in the query
	 *    so they stay identifiable in the request logs. On healthy pages
	 *    requests resolve normally and the rescue never fires.
	 *
	 * Emitted between the ad-blocker shim and the GA4 watchdog inside the same
	 * script tag: the rescue wrappers sit on top of the shim's (seeing plain
	 * URLs and bodies before encoding), the sender's own runtime calls resolve
	 * through the wrapped chain (so its hits still get ei=-encoded), and the
	 * rescue pixel itself deliberately skips the shim - a bare Image request
	 * in the same naked first-party shape as the Data Tag's own small pixels.
	 * Fails open: any error leaves the original request untouched, and the
	 * cache seed is only emitted together with a readable sender file (a seed
	 * without a sender would make the template call a missing function).
	 *
	 * When edge-sender mode is on this method emits NOTHING: the sender, the
	 * seed and the rescue wrappers all live in the edge-served file, which the
	 * container loader is gated behind (see get_edge_sender_boot_js). Moving
	 * the rescue there in v1.7.0 put it back where it belongs - it exists to
	 * protect the sender's deliveries, so shipping it inline while the sender
	 * itself was external had the coupling backwards, and cost ~1.8 KB on every
	 * page view for code that cannot act until the sender has loaded anyway.
	 * With edge mode off the output is byte-for-byte the inline form.
	 *
	 * @return string Bare JS statements, or '' when the feature is off/unconfigured.
	 */
	private function get_data_rescue_js() {
		if ( ! GTM_Server_Side_Helpers::is_enable_data_rescue() ) {
			return '';
		}

		if ( $this->is_edge_sender_active() ) {
			return '';
		}

		$prefix = wp_parse_url( GTM_Server_Side_Helpers::get_gtm_container_url(), PHP_URL_PATH );
		$prefix = is_string( $prefix ) ? rtrim( $prefix, '/' ) : '';
		if ( '' === $prefix ) {
			return '';
		}

		$prefix_js = wp_json_encode( $prefix );

		$rescue = '(function(w){try{if(w.__synDataRescue)return;w.__synDataRescue=1;var P=' . $prefix_js . ',O=w.location&&w.location.origin;if(!O)return;function d(u){try{var a=new URL(u,w.location.href);if(a.origin!==O)return null;if(a.pathname.slice(0,P.length+1)!==P+"/")return null;var r=a.pathname.slice(P.length);if(r!=="/data"&&r!=="/data/")return null;return a}catch(x){return null}}function R(a,b){try{if(!b||"string"!=typeof b)return;if(a.searchParams&&a.searchParams.has("dtdc"))return;if(!w.Image)return;var q=a.search?a.search.slice(1)+"&":"";(new w.Image(1,1)).src=O+a.pathname+"?"+q+"dtdc="+encodeURIComponent(w.btoa(unescape(encodeURIComponent(b))))+"&_synr=1"}catch(x){}}if(w.fetch){var of=w.fetch;w.fetch=function(i,o){var p=of.apply(w,arguments);try{var u=(typeof i==="string"||(w.URL&&i instanceof w.URL))?String(i):(i&&i.url)||"";var m=String((o&&o.method)||(i&&"object"==typeof i&&i.method)||"GET").toUpperCase();if("POST"===m&&u){var a=d(u),b=o&&"string"==typeof o.body?o.body:null;if(a&&b&&p&&"function"==typeof p.catch)p.catch(function(){R(a,b)})}}catch(x){}return p}}var n=w.navigator;if(n&&n.sendBeacon){var sb=n.sendBeacon.bind(n);n.sendBeacon=function(u,dd){var ok=sb.apply(n,arguments);try{if(!ok){var a=d(String(u));if(a&&"string"==typeof dd&&dd)R(a,dd)}}catch(x){}return ok}}var X=w.XMLHttpRequest;if(X&&X.prototype&&X.prototype.open&&X.prototype.send){var oo=X.prototype.open,os=X.prototype.send;X.prototype.open=function(m,u){try{this.__synDR="POST"===String(m||"").toUpperCase()?d(String(u)):null}catch(x){this.__synDR=null}return oo.apply(this,arguments)};X.prototype.send=function(b){try{var a=this.__synDR;if(a&&"string"==typeof b&&b){var f=0,g=function(){if(!f){f=1;R(a,b)}};this.addEventListener("error",g);this.addEventListener("timeout",g)}}catch(x){}return os.apply(this,arguments)}}}catch(x){}})(window);';

		// Inline (default): vendored first-party Data Tag sender + loaded-cache
		// seed, then the rescue. The seeded key must equal the sender URL the
		// Data Tag template computes (its default,
		// "https://stapecdn.com/dtag/v9.js"); the vendored file must stay
		// byte-identical to that script. The key is base64-decoded at runtime so
		// the third-party brand string never appears in the page source.
		$sender      = '';
		$sender_file = GTM_SERVER_SIDE_PATH . 'assets/data-tag-sender.js';
		if ( is_readable( $sender_file ) ) {
			$sender_js = file_get_contents( $sender_file ); // phpcs:ignore WordPress.WP.AlternativeFunctions.file_get_contents_file_get_contents
			if ( is_string( $sender_js ) && '' !== $sender_js && false === strpos( $sender_js, '</script' ) ) {
				$sender = $sender_js . ';(function(w){try{var k="gtm_dataTagScriptLoadedCache",c=w[k]=w[k]||{};c[w.atob("aHR0cHM6Ly9zdGFwZWNkbi5jb20vZHRhZy92OS5qcw==")]=true}catch(x){}})(window);';
			}
		}

		return $sender . $rescue;
	}

	/**
	 * Build the GA4 measurement recovery watchdog as a JavaScript string.
	 *
	 * Some browser privacy modes (most notably iOS Safari Private Browsing)
	 * let the web GTM container run but silently prevent its Google tag from
	 * ever dispatching a /g/collect hit, while plain first-party fetches keep
	 * working. This watchdog observes the page's fetch/sendBeacon/XHR for any
	 * same-origin "/g/collect" attempt; if the container has loaded and the
	 * Google tag is still silent after a grace period, it recovers the visit
	 * through the existing server container pipeline: a minimal, standards-
	 * shaped GA4 page_view hit first, then every data-layer event the plugin
	 * pushed (view_item, view_item_list, purchase, ... - names matched by the
	 * plugin's custom event suffix, suffix stripped, ecommerce translated to
	 * GA4 protocol: items[] -> pr1..prN, currency -> cu, value -> epn.value,
	 * transaction_id/tax/shipping/coupon). Already-pushed events are replayed
	 * once; a dataLayer.push hook (installed ONLY after the Google tag is
	 * declared dead, so healthy pages are never touched) forwards later ones
	 * immediately. Every hit carries the "synapse_recovered" event parameter
	 * so recovered traffic stays identifiable in GA4 and in the server logs.
	 *
	 * In normal browsers the Google tag sends within a couple of seconds, the
	 * watchdog sees it, and does nothing - zero behavior change. If the
	 * container never loads (blocked, or consent-gated and never granted) the
	 * watchdog never arms, so no unconsented hit is ever produced. Consent
	 * state is read from the dataLayer's gtag consent entries and mirrored
	 * into the hit (gcs/npa); session continuity uses sessionStorage when
	 * analytics consent is granted and falls back to per-page values.
	 *
	 * Emitted after the ad-blocker shim inside the same script tag: the
	 * watchdog's observers wrap on top of the shim's wrappers (seeing plain
	 * URLs before encoding), while its own recovery hit is sent through a
	 * fetch reference captured after the shim installed - so it is encoded
	 * like every other hit. Fails open: any error leaves the page untouched.
	 *
	 * In edge-sender mode only the observers stay inline (the "sentinel"): the
	 * deciding and recovering half moves into the edge-served tail. The split
	 * is deliberate and is what makes the move safe. Observing has to start at
	 * time zero, before anything can send; deciding happens eight seconds after
	 * the container loads. If the whole watchdog travelled in a file that can
	 * arrive late, a hit sent before it arrived would look like silence and the
	 * watchdog would recover a visit that was never lost - a duplicate. With
	 * the sentinel inline, window.__synSeen has been recording from the first
	 * byte of the page, so a late tail still sees the truth and stays quiet.
	 *
	 * @return string Bare IIFE, or '' when the feature is off/unconfigured.
	 */
	private function get_ga4_fallback_js() {
		if ( ! GTM_Server_Side_Helpers::is_enable_ga4_fallback() ) {
			return '';
		}

		$tid = GTM_Server_Side_Helpers::get_ga4_fallback_id();
		if ( '' === $tid ) {
			return '';
		}

		$prefix = wp_parse_url( GTM_Server_Side_Helpers::get_gtm_container_url(), PHP_URL_PATH );
		$prefix = is_string( $prefix ) ? rtrim( $prefix, '/' ) : '';
		if ( '' === $prefix ) {
			return '';
		}

		// The RAW web container id ("GTM-XXXX") - the watchdog polls
		// window.google_tag_manager[<id>] to know the container has run.
		// (get_gtm_container_id() would return the obfuscated loader query
		// when the custom loader is active, which never appears as a key.)
		$container_id = GTM_Server_Side_Helpers::get_raw_gtm_container_id();
		if ( empty( $container_id ) ) {
			return '';
		}

		if ( $this->is_edge_sender_active() ) {
			return $this->get_ga4_sentinel_js();
		}

		$tid_js    = wp_json_encode( $tid );
		$prefix_js = wp_json_encode( $prefix );
		$cid_js    = wp_json_encode( $container_id );

		// Suffix the plugin appends to its data-layer event names ("_synapse");
		// the watchdog recovers exactly those events, suffix stripped. When the
		// custom naming is off it falls back to a whitelist of standard names.
		$suffix_js = wp_json_encode( GTM_Server_Side_Helpers::is_enable_data_layer_custom_event_name() ? GTM_SERVER_SIDE_DATA_LAYER_CUSTOM_EVENT_NAME : '' );

		return '(function(w){try{if(w.__synGa4Fb)return;w.__synGa4Fb=1;var T=' . $tid_js . ',P=' . $prefix_js . ',C=' . $cid_js . ',SUF=' . $suffix_js . ',G=8000,O=w.location&&w.location.origin;if(!O)return;var seen=false,sent=false,stopped=false,armT=0,hn=0,di=0,hooked=false,ses=null,con=null,nav=w.navigator,doc=w.document,eu=encodeURIComponent,WL={view_item:1,view_item_list:1,select_item:1,add_to_cart:1,remove_from_cart:1,view_cart:1,begin_checkout:1,add_payment_info:1,add_shipping_info:1,purchase:1,refund:1,search:1,login:1,sign_up:1};function bt(b){try{if("string"===typeof b)return b;if(w.URLSearchParams&&b instanceof w.URLSearchParams)return b.toString()}catch(x){}return ""}function ga4(u,b){try{var a=new URL(u,w.location.href);if(a.origin!==O||a.pathname.indexOf("/g/collect")===-1)return false;var t=a.searchParams?a.searchParams.get("tid"):null;if(!t){var s2=bt(b);if(s2){var m2=/(?:^|[&\n])tid=([^&\n]*)/.exec(s2);if(m2)t=decodeURIComponent(m2[1])}}return !t||!T||t===T}catch(x){return false}}var IF=w.fetch?w.fetch.bind(w):null;if(w.fetch){var of=w.fetch;w.fetch=function(i,o){try{var u=(typeof i==="string"||(w.URL&&i instanceof w.URL))?String(i):(i&&i.url);if(u&&ga4(u,o&&o.body))seen=true}catch(x){}return of.apply(w,arguments)}}if(nav&&nav.sendBeacon){var sb=nav.sendBeacon.bind(nav);nav.sendBeacon=function(u,d){try{if(ga4(u,d))seen=true}catch(x){}return sb.apply(nav,arguments)}}var X=w.XMLHttpRequest;if(X&&X.prototype&&X.prototype.open&&X.prototype.send){var oo=X.prototype.open;X.prototype.open=function(){try{this.__synU=arguments[1]}catch(x){}return oo.apply(this,arguments)};var os=X.prototype.send;X.prototype.send=function(){try{if(this.__synU&&ga4(this.__synU,arguments[0]))seen=true}catch(x){}return os.apply(this,arguments)}}function consent(){var got=false,ad=false,an=false;try{var dl=w.dataLayer||[];for(var i=0;i<dl.length;i++){var e=dl[i];if(e&&"consent"===e[0]&&("default"===e[1]||"update"===e[1])&&e[2]&&"object"===typeof e[2]){got=true;if(void 0!==e[2].ad_storage)ad="granted"===e[2].ad_storage;if(void 0!==e[2].analytics_storage)an="granted"===e[2].analytics_storage}}}catch(x){}try{var ics=w.google_tag_data&&w.google_tag_data.ics,en7=ics&&ics.entries;var pick=function(k){var e7=en7&&en7[k];if(!e7)return void 0;if(void 0!==e7.update)return!!e7.update;if(void 0!==e7["default"])return!!e7["default"];return void 0};var a7=pick("ad_storage"),n7=pick("analytics_storage");if(void 0!==a7){got=true;ad=a7}if(void 0!==n7){got=true;an=n7}}catch(x){}if(!got){ad=true;an=true}return{ad:ad,an:an}}function mkid(now){return Math.floor(9e8*Math.random()+1e8)+"."+now}function gaCid(){try{var m9=/(?:^|;\s*)_ga=GA\d+\.\d+\.(\d+\.\d+)/.exec((doc&&doc.cookie)||"");return m9?m9[1]:null}catch(x){return null}}var ephD=null,ephG=null;function ephemeral(an){var n;if(!an){if(!ephD){n=Math.floor(Date.now()/1e3);ephD={cid:mkid(n),sid:n,first:true,fresh:true}}return ephD}if(!ephG){n=Math.floor(Date.now()/1e3);var ga=gaCid();ephG={cid:ga||mkid(n),sid:n,first:!ga,fresh:true}}return ephG}function persisted(){var s=null;try{s=w.sessionStorage}catch(x){return null}if(!s)return null;var now=Math.floor(Date.now()/1e3),st=null;try{st=JSON.parse(s.getItem("_synfb")||"null")}catch(x){st=null}var first=!st||!st.cid,fresh=first;if(first){var ga=gaCid();st={cid:ga||mkid(now),sid:now};if(ga)first=false}try{s.setItem("_synfb",JSON.stringify(st));if(!s.getItem("_synfb"))return null}catch(x){return null}return{cid:st.cid,sid:st.sid,first:first,fresh:fresh}}var pers=null,persTried=false;function state(an){if(!an)return ephemeral(false);if(!persTried){persTried=true;pers=persisted()}return pers||ephemeral(true)}function itstr(a){var M={item_id:"id",item_name:"nm",item_brand:"br",item_variant:"va",item_category:"ca",item_category2:"c2",item_category3:"c3",item_category4:"c4",item_category5:"c5",price:"pr",quantity:"qt",coupon:"cp",discount:"ds",index:"lp",item_list_id:"li",item_list_name:"ln",affiliation:"af"},out=[],i,k,it,p,v;for(i=0;i<a.length&&i<60;i++){it=a[i]||{};p=[];for(k in M){v=it[k];if(v===void 0||v===null||v==="")continue;v=String(v).replace(/~/g," ");if(v.length>100)v=v.slice(0,100);p.push(M[k]+v)}if(p.length)out.push("pr"+(i+1)+"="+eu(p.join("~")))}return out}function ecom(ec){var ex=[];try{if(!ec||"object"!==typeof ec)return ex;if(ec.currency)ex.push("cu="+eu(ec.currency));if(ec.value!==void 0&&ec.value!==null&&ec.value!=="")ex.push("epn.value="+eu(ec.value));if(ec.transaction_id)ex.push("ep.transaction_id="+eu(ec.transaction_id));if(ec.tax)ex.push("epn.tax="+eu(ec.tax));if(ec.shipping)ex.push("epn.shipping="+eu(ec.shipping));if(ec.coupon)ex.push("ep.coupon="+eu(ec.coupon));if(ec.items&&ec.items.length)ex=ex.concat(itstr(ec.items))}catch(x){}return ex}function send(en,extra){if(!IF||stopped)return;try{con=consent();ses=state(con.an);hn++;var q=["v=2","tid="+eu(T),"cid="+eu(ses.cid),"sid="+ses.sid,"sct=1","seg="+(ses.fresh&&1===hn?"0":"1"),"_p="+Math.floor(9e8*Math.random()+1e8),"_s="+hn,"gcs=G1"+(con.ad?"1":"0")+(con.an?"1":"0"),"npa="+(con.ad?"0":"1"),"ul="+eu(((nav&&nav.language)||"").toLowerCase()),"sr="+(w.screen?w.screen.width+"x"+w.screen.height:""),"dl="+eu(w.location.href),"dt="+eu((doc&&doc.title)||""),"en="+eu(en),"ep.synapse_recovered=1"];if(doc&&doc.referrer)q.push("dr="+eu(doc.referrer));if(ses.fresh&&1===hn)q.push("_ss=1","_nsi=1");if(ses.first&&1===hn)q.push("_fv=1");if(extra&&extra.length)q=q.concat(extra);var pre=seen;IF(O+P+"/g/collect?"+q.join("&"),{method:"GET",keepalive:true}).catch(function(){});if(!pre)seen=pre}catch(x){}}function evName(n){if("string"!==typeof n||!n)return null;if(SUF){if(n.length>SUF.length&&n.slice(-SUF.length)===SUF)return n.slice(0,n.length-SUF.length);return null}return WL[n]?n:null}function pump(){try{if(seen)stopped=true;if(stopped){di=(w.dataLayer||[]).length;return}var dl=w.dataLayer||[];for(;di<dl.length;di++){var e=dl[di];if(!e||"object"!==typeof e||Array.isArray(e))continue;var en=evName(e.event);if(!en||"page_view"===en)continue;send(en,ecom(e.ecommerce))}}catch(x){}}function fire(){if(seen||sent)return;sent=true;try{con=consent();send("page_view");pump();if(!hooked){hooked=true;var dl=w.dataLayer=w.dataLayer||[];var dp=dl.push;dl.push=function(){var r=dp.apply(dl,arguments);try{pump()}catch(x){}return r}}}catch(x){}}var polls=0,pt=w.setInterval(function(){try{if(seen||sent){w.clearInterval(pt);return}if(w.google_tag_manager&&w.google_tag_manager[C]){w.clearInterval(pt);armT=Date.now();w.setTimeout(fire,G);return}if(++polls>240)w.clearInterval(pt)}catch(x){w.clearInterval(pt)}},500);if(w.addEventListener)w.addEventListener("pagehide",function(){try{if(!seen&&!sent&&armT&&Date.now()-armT>2500)fire()}catch(x){}})}catch(x){}})(window);';
	}

	/**
	 * Build the inline half of the GA4 recovery watchdog: the observers that
	 * record whether the Google tag ever spoke.
	 *
	 * Sets window.__synSeen the first time any same-origin "/g/collect" request
	 * is attempted through fetch, sendBeacon or XHR. Purely observational - it
	 * inspects and forwards, never rewrites, never blocks, and the recovery
	 * logic that reads the flag lives in the edge-served tail.
	 *
	 * Installed after the ad-blocker shim, so it sees the plain "/g/collect"
	 * URL before the shim encodes it into the "ei=" form. Being inline is what
	 * lets the tail's watchdog wrap nothing at all for this purpose - but the
	 * wrap COUNT is unchanged from v1.6.x: the page still carries three
	 * network-API wrappers (shim, this sentinel, the tail's rescue) where it
	 * carried three before (shim, rescue, watchdog observer). The observation
	 * layer moved out of the watchdog and into this sentinel so it can start
	 * at time zero; no layer was removed.
	 *
	 * @return string
	 */
	private function get_ga4_sentinel_js() {
		// Records every same-origin "/g/collect" attempt, and WHICH measurement id
		// it was for, without naming our own: the id is camouflaged in the page
		// source (see encode_cfg_id) and must not be reintroduced in clear text
		// here. The watchdog decodes it at runtime and does the matching itself.
		//
		// __synSeen stays exactly as it was - any collect at all - so a cached
		// sender from an earlier release keeps working against a newer page.
		// __synSeenT is the added detail: a map of measurement id to 1, with "*"
		// for a hit that carried no id in the query, since GA4 may post its
		// parameters in the body and treating that as silence would recover a
		// visit that was never lost.
		//
		// XHR is recorded at send(), not open(): a request that is opened and then
		// abandoned never reached Google.
		return '(function(w){try{if(w.__synSeenH)return;w.__synSeenH=1;var O=w.location&&w.location.origin;if(!O)return;function bt(b){try{if("string"===typeof b)return b;if(w.URLSearchParams&&b instanceof w.URLSearchParams)return b.toString()}catch(x){}return ""}function m(u,b){try{var a=new URL(u,w.location.href);if(a.origin!==O||a.pathname.indexOf("/g/collect")===-1)return;w.__synSeen=1;var t=a.searchParams?a.searchParams.get("tid"):null;if(!t){var s2=bt(b);if(s2){var m2=/(?:^|[&\n])tid=([^&\n]*)/.exec(s2);if(m2)t=decodeURIComponent(m2[1])}}var k=t||"*";(w.__synSeenT=w.__synSeenT||{})[k]=1}catch(x){}}if(w.fetch){var of=w.fetch;w.fetch=function(i,o){try{var u=(typeof i==="string"||(w.URL&&i instanceof w.URL))?String(i):(i&&i.url);if(u)m(u,o&&o.body)}catch(x){}return of.apply(w,arguments)}}var n=w.navigator;if(n&&n.sendBeacon){var sb=n.sendBeacon.bind(n);n.sendBeacon=function(u,d){try{m(u,d)}catch(x){}return sb.apply(n,arguments)}}var X=w.XMLHttpRequest;if(X&&X.prototype&&X.prototype.open&&X.prototype.send){var oo=X.prototype.open;X.prototype.open=function(){try{this.__synU=arguments[1]}catch(x){}return oo.apply(this,arguments)};var os=X.prototype.send;X.prototype.send=function(){try{if(this.__synU)m(this.__synU,arguments[0])}catch(x){}return os.apply(this,arguments)}}}catch(x){}})(window);';
	}

	/**
	 * Print tag script attrs.
	 *
	 * @return string
	 */
	private function print_tag_script_attrs() {
		if ( GTM_Server_Side_Helpers::is_enable_placement_gtm_consent() ) {
			return ' type="text/plain" id="custom-loader"';
		}
		return '';
	}
}
