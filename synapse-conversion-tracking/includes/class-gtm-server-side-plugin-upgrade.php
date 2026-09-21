<?php
/**
 * Upgrade plugin.
 *
 * @package    GTM_Server_Side
 * @subpackage GTM_Server_Side/includes
 * @since      2.0.0
 */

defined( 'ABSPATH' ) || exit;

/**
 * Upgrade plugin.
 */
class GTM_Server_Side_Plugin_Upgrade {
	use GTM_Server_Side_Singleton;

	/**
	 * Init.
	 *
	 * Stamps the current plugin version. Future migrations between Synapse
	 * versions belong here; there are deliberately NO migrations from any
	 * other plugin - Synapse always starts from its own clean options.
	 *
	 * @return void
	 */
	public function init() {
		if ( get_option( GTM_SERVER_SIDE_FIELD_VERSION ) !== get_gtm_server_side_version() ) {
			update_option( GTM_SERVER_SIDE_FIELD_VERSION, get_gtm_server_side_version(), false );
		}
	}
}
