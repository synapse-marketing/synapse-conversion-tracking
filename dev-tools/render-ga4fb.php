<?php
/**
 * Render harness: extracts the ad-blocker shim + GA4 fallback JS exactly as
 * print_synapse_gtm_code() would emit them, with WP functions mocked.
 * Usage: php render-ga4fb.php <plugin-root> <out-dir>
 */

define( 'ABSPATH', __DIR__ . '/' );

$GLOBALS['OPTS'] = array();

function get_option( $k, $d = false ) {
	return isset( $GLOBALS['OPTS'][ $k ] ) ? $GLOBALS['OPTS'][ $k ] : $d;
}
function wp_json_encode( $v ) {
	return json_encode( $v );
}
function wp_parse_url( $u, $c = -1 ) {
	return -1 === $c ? parse_url( $u ) : parse_url( $u, $c );
}
function esc_js( $s ) {
	return $s;
}
// The container loader (get_gtm_loader_js) resolves the obfuscated identifier
// through the transient cache + wp_rand; mock them so the loader renders.
function get_transient( $k ) {
	return false;
}
function set_transient( $k, $v, $t ) {
	return true;
}
function wp_rand( $min, $max ) {
	return random_int( $min, $max );
}
if ( ! defined( 'YEAR_IN_SECONDS' ) ) {
	define( 'YEAR_IN_SECONDS', 31536000 );
}
// build_asset_version_query() stores the "?v=" memo for a week.
if ( ! defined( 'WEEK_IN_SECONDS' ) ) {
	define( 'WEEK_IN_SECONDS', 604800 );
}
if ( ! function_exists( 'mb_substr' ) ) {
	function mb_substr( $s, $start, $length = null ) {
		return null === $length ? substr( $s, $start ) : substr( $s, $start, $length );
	}
}

// Defines used by the invoked methods (mirrors bootstrap.php).
define( 'GTM_SERVER_SIDE_FIELD_PLACEMENT', 'synapse_ct_placement' );
define( 'GTM_SERVER_SIDE_FIELD_WEB_CONTAINER_ID', 'synapse_ct_web_container_id' );
define( 'GTM_SERVER_SIDE_FIELD_WEB_CONTAINER_URL', 'synapse_ct_web_container_url' );
define( 'GTM_SERVER_SIDE_FIELD_WEB_IDENTIFIER', 'synapse_ct_web_identifier' );
define( 'GTM_SERVER_SIDE_FIELD_ENHANCED_ADBLOCKER', 'synapse_ct_enhanced_adblocker' );
define( 'GTM_SERVER_SIDE_FIELD_GA4_FALLBACK', 'synapse_ct_ga4_fallback' );
define( 'GTM_SERVER_SIDE_FIELD_GA4_FALLBACK_ID', 'synapse_ct_ga4_fallback_id' );
define( 'GTM_SERVER_SIDE_FIELD_DATA_RESCUE', 'synapse_ct_data_rescue' );
define( 'GTM_SERVER_SIDE_FIELD_EDGE_SENDER', 'synapse_ct_edge_sender' );
define( 'GTM_SERVER_SIDE_EDGE_SENDER_FILE', 's.js' );
define( 'GTM_SERVER_SIDE_FIELD_GTM_EXCLUDE_ROLES', 'synapse_ct_gtm_exclude_roles' );
define( 'GTM_SERVER_SIDE_FIELD_GTM_EXCLUDE_LIST_ROLES', 'synapse_ct_gtm_exclude_list_roles' );
define( 'GTM_SERVER_SIDE_FIELD_DATA_LAYER_ECOMMERCE', 'synapse_ct_data_layer_ecommerce' );
define( 'GTM_SERVER_SIDE_FIELD_DATA_LAYER_USER_DATA', 'synapse_ct_data_layer_user_data' );
define( 'GTM_SERVER_SIDE_FIELD_DATA_LAYER_CUSTOM_EVENT_NAME', 'synapse_ct_data_layer_custom_event_name' );
define( 'GTM_SERVER_SIDE_FIELD_VALUE_YES', 'yes' );
define( 'GTM_SERVER_SIDE_DATA_LAYER_CUSTOM_EVENT_NAME', '_synapse' );

$root = $argv[1];
$out  = $argv[2];

// Plugin root path constant (bootstrap.php defines it in WP; the tracking-code
// class reads the vendored Data Tag sender from it at render time).
define( 'GTM_SERVER_SIDE_PATH', rtrim( $root, '/\\' ) . '/' );

// bootstrap.php defines this as plugin_dir_url(). get_asset_base_hint() reads
// it to decide whether the page has to tell the worker where the assets are.
// A standard install is the case to render by default: the path then equals the
// worker's first guess and NOTHING is emitted. Pass a third argument to render
// a non-standard install and exercise the "&b=" hint instead.
define( 'GTM_SERVER_SIDE_URL', isset( $argv[3] ) ? $argv[3] : 'https://lamore-bg.com/wp-content/plugins/synapse-conversion-tracking/' );

require $root . '/includes/class-gtm-server-side-singleton.php';
require $root . '/includes/class-gtm-server-side-helpers.php';
require $root . '/includes/class-gtm-server-side-tracking-code.php';

function render_combo( $opts ) {
	$GLOBALS['OPTS'] = $opts;

	// Helpers caches are static; reset them between variants.
	$rh = new ReflectionClass( 'GTM_Server_Side_Helpers' );
	foreach ( array( 'is_enable_enhanced_adblocker', 'is_enable_ga4_fallback', 'is_enable_data_rescue', 'is_enable_edge_sender', 'is_enable_data_layer_custom_event_name' ) as $prop ) {
		if ( $rh->hasProperty( $prop ) ) {
			$p = $rh->getProperty( $prop );
			$p->setAccessible( true );
			$p->setValue( null, null );
		}
	}

	$rc = new ReflectionClass( 'GTM_Server_Side_Tracking_Code' );
	$o  = $rc->newInstanceWithoutConstructor();
	$m1 = $rc->getMethod( 'get_enhanced_adblocker_shim_js' );
	$m1->setAccessible( true );
	$m2 = $rc->getMethod( 'get_ga4_fallback_js' );
	$m2->setAccessible( true );
	$m3 = $rc->getMethod( 'get_data_rescue_js' );
	$m3->setAccessible( true );

	$shim = $m1->invoke( $o );
	$fb   = $m2->invoke( $o );
	$dr   = $m3->invoke( $o );
	return array( $shim, $fb, $dr );
}

$base = array(
	'synapse_ct_placement'                   => 'code',
	'synapse_ct_web_container_id'            => 'GTM-NQHQHZLR',
	'synapse_ct_web_container_url'           => 'https://lamore-bg.com/lmr',
	'synapse_ct_web_identifier'              => 'bca96fbh8l',
	'synapse_ct_enhanced_adblocker'          => 'yes',
	'synapse_ct_ga4_fallback'                => 'yes',
	'synapse_ct_ga4_fallback_id'             => 'G-SYYEZHP7BL',
	'synapse_ct_data_layer_custom_event_name' => 'yes',
);

list( $shim, $fb ) = render_combo( $base );
file_put_contents( $out . '/combined-shim-on.js', $shim . $fb );
echo 'shim-on: shim=' . strlen( $shim ) . ' fb=' . strlen( $fb ) . "\n";

list( $shim2, $fb2 ) = render_combo( array_merge( $base, array( 'synapse_ct_enhanced_adblocker' => '' ) ) );
file_put_contents( $out . '/combined-shim-off.js', $shim2 . $fb2 );
echo 'shim-off: shim=' . strlen( $shim2 ) . ' fb=' . strlen( $fb2 ) . "\n";

// Variant: feature off -> must be byte-empty (v1.3.1 behavior preserved).
list( $shim3, $fb3 ) = render_combo( array_merge( $base, array( 'synapse_ct_ga4_fallback' => '' ) ) );
echo 'fb-off: fb=' . strlen( $fb3 ) . ( '' === $fb3 ? ' (empty OK)' : ' (ERROR: not empty!)' ) . "\n";

// Variant: bad measurement id -> off.
list( $shim4, $fb4 ) = render_combo( array_merge( $base, array( 'synapse_ct_ga4_fallback_id' => 'UA-123' ) ) );
echo 'bad-id: fb=' . strlen( $fb4 ) . ( '' === $fb4 ? ' (empty OK)' : ' (ERROR: not empty!)' ) . "\n";

// Variant: custom event naming OFF -> whitelist mode (SUF="").
list( $shim5, $fb5 ) = render_combo( array_merge( $base, array( 'synapse_ct_data_layer_custom_event_name' => '' ) ) );
file_put_contents( $out . '/combined-nosuffix.js', $shim5 . $fb5 );
echo 'nosuffix: fb=' . strlen( $fb5 ) . ' SUF=' . ( false !== strpos( $fb5, 'SUF=""' ) ? '"" OK' : 'ERROR' ) . "\n";
echo 'main SUF=_synapse: ' . ( false !== strpos( $fb, 'SUF="_synapse"' ) ? 'OK' : 'ERROR' ) . "\n";

// --- Data Client transport rescue (v1.6.0) variants. Base opts above leave it
// off, so every output before this line is byte-identical to the v1.5.0 render.
$rescue_on = array_merge( $base, array( 'synapse_ct_data_rescue' => 'yes' ) );

list( $shim6, $fb6, $dr6 ) = render_combo( $rescue_on );
file_put_contents( $out . '/rescue-only.js', $dr6 );
file_put_contents( $out . '/combined-v16.js', $shim6 . $dr6 . $fb6 );
echo 'rescue-on: dr=' . strlen( $dr6 ) . ' (emission order shim+rescue+fb)' . "\n";

list( $shim7, $fb7, $dr7 ) = render_combo( $base );
echo 'rescue-off: dr=' . strlen( $dr7 ) . ( '' === $dr7 ? ' (empty OK)' : ' (ERROR: not empty!)' ) . "\n";

// Rescue works with the shim disabled too (independent toggles).
list( $shim8, $fb8, $dr8 ) = render_combo( array_merge( $rescue_on, array( 'synapse_ct_enhanced_adblocker' => '' ) ) );
file_put_contents( $out . '/rescue-noshim.js', $dr8 . $fb8 );
echo 'rescue-noshim: shim=' . strlen( $shim8 ) . ' dr=' . strlen( $dr8 ) . "\n";

// --- Edge-served Data Tag sender (v1.6.2). With it on, get_data_rescue_js()
// drops the inline sender+seed (rescue-only) and the container loader is gated
// behind the edge sender's load by get_edge_sender_boot_js(). Renders the exact
// head the plugin would emit in edge mode: shim + rescue-only + fb + sender-boot.
$edge_on = array_merge( $rescue_on, array( 'synapse_ct_edge_sender' => 'yes' ) );

$GLOBALS['OPTS'] = $edge_on;
$rh = new ReflectionClass( 'GTM_Server_Side_Helpers' );
foreach ( array( 'is_enable_enhanced_adblocker', 'is_enable_ga4_fallback', 'is_enable_data_rescue', 'is_enable_edge_sender', 'is_enable_data_layer_custom_event_name' ) as $prop ) {
	if ( $rh->hasProperty( $prop ) ) {
		$p = $rh->getProperty( $prop );
		$p->setAccessible( true );
		$p->setValue( null, null );
	}
}

$rc = new ReflectionClass( 'GTM_Server_Side_Tracking_Code' );
$o  = $rc->newInstanceWithoutConstructor();
$call = function( $name, $args = array() ) use ( $rc, $o ) {
	$m = $rc->getMethod( $name );
	$m->setAccessible( true );
	return $m->invokeArgs( $o, $args );
};

$edge_shim   = $call( 'get_enhanced_adblocker_shim_js' );
$edge_rescue = $call( 'get_data_rescue_js' );
$edge_fb     = $call( 'get_ga4_fallback_js' );
$edge_loader = $call( 'get_gtm_loader_js' );
$edge_boot   = $call( 'get_edge_sender_boot_js', array( $edge_loader ) );

file_put_contents( $out . '/edge-rescue.js', $edge_rescue );
file_put_contents( $out . '/edge-boot.js', $edge_boot );
file_put_contents( $out . '/combined-edge.js', $edge_shim . $edge_rescue . $edge_fb . $edge_boot );

$has_sender = false !== strpos( $edge_rescue, 'function dataTagSendData' );
$has_url    = false !== strpos( str_replace( '\\/', '/', $edge_boot ), 'lamore-bg.com/lmr/s.js' );

// The loaded-cache seed has to reach the browser, but WHERE it is emitted
// changed with the v1.7.0 head/tail split: up to v1.6.x it was inline in the
// head, since v1.7.0 it lives in the tail and therefore inside the built
// sender the boot loads. Checking only one of the two places reports a false
// ERROR on every build from the other era, so check both and say which.
$seed_key     = 'gtm_dataTagScriptLoadedCache';
$built_sender = @file_get_contents( GTM_SERVER_SIDE_PATH . 'assets/' . GTM_SERVER_SIDE_EDGE_SENDER_FILE );
$seed_where   = false !== strpos( $edge_boot, $seed_key ) ? 'head'
	: ( is_string( $built_sender ) && false !== strpos( $built_sender, $seed_key ) ? GTM_SERVER_SIDE_EDGE_SENDER_FILE : '' );

echo 'edge-on: rescue=' . strlen( $edge_rescue ) . ' (sender inline? ' . ( $has_sender ? 'YES-ERROR' : 'no OK' ) . ')'
	. ' boot=' . strlen( $edge_boot ) . ' (seed? ' . ( '' === $seed_where ? 'ERROR - in neither the head nor the sender' : 'OK in ' . $seed_where ) . ', sender-url? ' . ( $has_url ? 'OK' : 'ERROR' ) . ")\n";

// Loader-off invariant: with edge-sender enabled but data-rescue OFF, the boot
// must NOT gate (feature belongs to rescue) -> loader returned unchanged.
$GLOBALS['OPTS'] = array_merge( $base, array( 'synapse_ct_edge_sender' => 'yes' ) );
foreach ( array( 'is_enable_data_rescue', 'is_enable_edge_sender' ) as $prop ) {
	$p = $rh->getProperty( $prop ); $p->setAccessible( true ); $p->setValue( null, null );
}
$loader_norescue = $call( 'get_gtm_loader_js' );
$boot_norescue   = $call( 'get_edge_sender_boot_js', array( $loader_norescue ) );
echo 'edge-on+rescue-off: boot==loader? ' . ( $boot_norescue === $loader_norescue ? 'OK (ungated)' : 'ERROR (gated!)' ) . "\n";
