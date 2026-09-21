<?php
/**
 * Activate plugin.
 *
 * @package    GTM_Server_Side
 * @subpackage GTM_Server_Side/includes
 * @since      2.0.0
 */

defined( 'ABSPATH' ) || exit;

/**
 * Activate plugin.
 */
class GTM_Server_Side_Plugin_Activate {
	use GTM_Server_Side_Singleton;

	/**
	 * Init.
	 *
	 * @return void
	 */
	public function init() {
		$this->install();
	}

	/**
	 * First install.
	 *
	 * The plugin activates in a fully clean state: every field empty, every
	 * feature off. The only default written is the snippet placement, set to
	 * "Disable" so nothing is injected into the site until it is configured
	 * on purpose.
	 *
	 * @return void
	 */
	private function install() {
		if ( empty( get_option( GTM_SERVER_SIDE_FIELD_PLACEMENT ) ) ) {
			update_option( GTM_SERVER_SIDE_FIELD_PLACEMENT, GTM_SERVER_SIDE_FIELD_PLACEMENT_VALUE_DISABLE );
		}
	}
}
