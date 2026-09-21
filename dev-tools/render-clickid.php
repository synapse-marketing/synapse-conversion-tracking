<?php
// Renders the REAL Click ID Restorer script by executing the shipped class
// against a minimal WordPress mock, so what gets tested is the plugin's own
// output and not a restatement of it.
//
// Usage:
//   php dev-tools/render-clickid.php ["<version folder>"] [google_param] [ms_param]
//
// Defaults to the current version folder with google_param = "backup" and the
// Microsoft restorer off, which is the shape lamore actually runs.
//
// The class is a singleton whose constructor runs init(), so one process
// renders exactly one parameter combination - call it again for another.

define( 'ABSPATH', __DIR__ );
// init() bails on this value; anything else means "a container is on the page".
define( 'GTM_SERVER_SIDE_FIELD_PLACEMENT_VALUE_DISABLE', 'disable' );

$folder = isset( $argv[1] ) && '' !== $argv[1] ? $argv[1] : 'synapse-conversion-tracking v1.7.4';
$google = isset( $argv[2] ) ? $argv[2] : 'backup';
$micro  = isset( $argv[3] ) ? $argv[3] : '';

$GLOBALS['__ms'] = $micro;

/**
 * Pass-through filter mock. Only the Microsoft parameter has no option behind
 * it in the plugin (it is filter-only), so that is the one hook that overrides.
 *
 * @param string $hook  Filter name.
 * @param mixed  $value Value the plugin passes in.
 * @return mixed
 */
function apply_filters( $hook, $value ) {
	if ( 'synapse_ct_click_id_restorer_microsoft_param' === $hook ) {
		return $GLOBALS['__ms'];
	}
	return $value;
}

function add_action() {}
function is_user_logged_in() { return false; }
function wp_get_current_user() { return (object) array( 'roles' => array() ); }

/**
 * Helpers mock - only the four methods the restorer reaches.
 */
class GTM_Server_Side_Helpers {
	public static function get_option_container_placement() { return 'code'; }
	public static function is_enable_gtm_exclude_roles() { return false; }
	public static function get_gtm_exclude_list_roles() { return array(); }
	public static function get_click_id_restorer_google_param() { return $GLOBALS['__google']; }
}

$GLOBALS['__google'] = $google;

$inc = __DIR__ . '/../' . $folder . '/synapse-conversion-tracking/includes/';
require $inc . 'class-gtm-server-side-singleton.php';
require $inc . 'class-gtm-server-side-click-id-restorer.php';

GTM_Server_Side_Click_Id_Restorer::instance()->wp_head();
