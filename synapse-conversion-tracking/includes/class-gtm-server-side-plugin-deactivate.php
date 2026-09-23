<?php
/**
 * _Deactivate plugin.
 *
 * @package    GTM_Server_Side
 * @subpackage GTM_Server_Side/includes
 * @since      2.0.0
 */

defined( 'ABSPATH' ) || exit;

/**
 * _Deactivate plugin.
 */
class GTM_Server_Side_Plugin_Deactivate {
	use GTM_Server_Side_Singleton;

	/**
	 * Init.
	 *
	 * @return void
	 */
	public function init() {
		// 2.0.1: the edge sender health check (GTM_Server_Side_Edge_Health).
		wp_clear_scheduled_hook( 'synapse_ct_edge_health' );
	}
}
