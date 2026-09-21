<?php
/**
 * Click ID Restorer.
 *
 * Safari (ITP) and Brave strip advertising click IDs (gclid / msclkid) from the
 * landing URL. Mitigation: the ad platform's Final URL suffix carries a custom
 * "backup" parameter (e.g. backup={gclid}) that browsers do NOT strip, because
 * they only target known ad parameters. This class restores the native click ID
 * from that backup parameter, in the browser, BEFORE the GTM loader / gtag /
 * Conversion Linker read the URL.
 *
 * Printed on wp_head at priority 1 so it runs ahead of the loader (added at the
 * default priority 10 in GTM_Server_Side_Tracking_Code). It only normalizes the
 * local URL via history.replaceState and stores nothing, so it is intentionally
 * NOT consent-gated.
 *
 * The backup parameter name must match the ad platform's Final URL suffix. It is
 * configured in the admin (General tab -> "Google Click ID restorer") and stays
 * empty (feature off) until set. A filter can still override it in code:
 *
 *   add_filter( 'synapse_ct_click_id_restorer_google_param', fn() => 'myparam' );
 *   add_filter( 'synapse_ct_click_id_restorer_microsoft_param', fn() => 'mymsclkid' );
 *
 * A restore that actually happened stamps self::MARKER on the URL, so the
 * request log can tell the two landings apart. Without it they are
 * indistinguishable in the wrong direction: the backup parameter survives only
 * while it is UNUSED, and a real restore deletes it, so its presence marks a
 * landing that was never stripped and its absence marks either a rescue or an
 * ordinary visit. The marker is the inverse - emitted only on the branch that
 * did the work.
 *
 * Two properties of the marker are load-bearing, not cosmetic:
 *
 *  - It is fixed and owned by the plugin, not the configured backup name. Each
 *    site picks its own name ("backup", "saved", ...), so a name-based counter
 *    would need per-site configuration on the server; a fixed marker is counted
 *    by one rule for every site at once.
 *  - It carries no "=" in the token itself. The marker reaches the server only
 *    inside the tracking hit's page-location parameter, percent-encoded, where
 *    "=" is written "%3D" - a marker like "_synr=2" would be searched for
 *    literally and never match. Parameter NAMES survive that encoding intact.
 *
 * @package    GTM_Server_Side
 * @subpackage GTM_Server_Side/includes
 * @since      1.0.0
 */

defined( 'ABSPATH' ) || exit;

/**
 * Click ID Restorer.
 */
class GTM_Server_Side_Click_Id_Restorer {
	use GTM_Server_Side_Singleton;

	/**
	 * Query parameter stamped on the URL when a click ID was really restored.
	 *
	 * Kept deliberately short, brandless and free of "=" (see the file header).
	 * It joins "synapse_recovered" (GA4 measurement recovery) and "_synr=1"
	 * (Data Client transport rescue) as the third rescue marker, and is a
	 * distinct token from both so the three stay separable in the logs.
	 *
	 * @var string
	 */
	const MARKER = '_syncid';

	/**
	 * Init.
	 *
	 * @return void
	 */
	public function init() {
		// Only relevant when a container is actually placed on the page.
		if ( GTM_SERVER_SIDE_FIELD_PLACEMENT_VALUE_DISABLE === GTM_Server_Side_Helpers::get_option_container_placement() ) {
			return;
		}

		// Priority 1: print before the GTM loader (wp_head priority 10) so the
		// restored click ID is present when gtag and the Conversion Linker run.
		add_action( 'wp_head', array( $this, 'wp_head' ), 1 );
	}

	/**
	 * Print the restore script.
	 *
	 * @return void
	 */
	public function wp_head() {
		// Mirror the loader's exclude-roles behaviour: if the loader will not be
		// printed for this user, there is nothing to restore for.
		if ( is_user_logged_in() && GTM_Server_Side_Helpers::is_enable_gtm_exclude_roles() ) {
			$current_user  = wp_get_current_user();
			$exclude_roles = GTM_Server_Side_Helpers::get_gtm_exclude_list_roles();

			if ( array_intersect( $exclude_roles, $current_user->roles ) ) {
				return;
			}
		}

		$param_map = $this->get_param_map();
		if ( empty( $param_map ) ) {
			return;
		}

		$pairs = array();
		foreach ( $param_map as $backup => $native ) {
			$pairs[] = sprintf( '"%s":"%s"', $backup, $native );
		}
		$map_literal = '{' . implode( ',', $pairs ) . '}';

		// The map is built from sanitised [A-Za-z0-9_-] tokens (see get_param_map),
		// so it is safe to embed directly in the script; the rest is static JS.
		// The marker is set inside the "did we restore anything" branch, before
		// the query string is rebuilt from q, so it rides the same single
		// replaceState - a restore still costs exactly one history write.
		// phpcs:ignore WordPress.Security.EscapeOutput.OutputNotEscaped
		echo "\n<script>(function(){try{var m=" . $map_literal . ',u=new URL(window.location.href),q=u.searchParams,c=false;for(var s in m){var d=m[s];if(q.get(s)&&!q.get(d)){q.set(d,q.get(s));q.delete(s);c=true;}}if(c){q.set("' . self::MARKER . '","1");history.replaceState(history.state,"",u.pathname+(q.toString()?"?"+q.toString():"")+u.hash);}}catch(e){}})();</script>' . "\n";
	}

	/**
	 * Backup -> native click ID parameter map.
	 *
	 * Keys are the custom "backup" parameter names configured in the ad
	 * platform's Final URL suffix; values are the native click IDs to restore.
	 * Names are sanitised to a safe token charset so they can be embedded in the
	 * inline script. An empty parameter name disables that entry.
	 *
	 * @return array
	 */
	private function get_param_map() {
		$google    = $this->sanitize_param( apply_filters( 'synapse_ct_click_id_restorer_google_param', GTM_Server_Side_Helpers::get_click_id_restorer_google_param() ) );
		$microsoft = $this->sanitize_param( apply_filters( 'synapse_ct_click_id_restorer_microsoft_param', '' ) );

		$map = array();
		if ( '' !== $google ) {
			$map[ $google ] = 'gclid';
		}
		if ( '' !== $microsoft && $microsoft !== $google ) {
			$map[ $microsoft ] = 'msclkid';
		}

		return $map;
	}

	/**
	 * Reduce a query-parameter name to a safe token.
	 *
	 * @param  mixed $value Raw parameter name.
	 * @return string
	 */
	private function sanitize_param( $value ) {
		return preg_replace( '/[^A-Za-z0-9_-]/', '', (string) $value );
	}
}
