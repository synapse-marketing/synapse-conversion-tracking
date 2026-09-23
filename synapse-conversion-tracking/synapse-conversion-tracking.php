<?php
/**
 * Main plugin file.
 *
 * @since             2.0.0
 * @package           GTM_Server_Side
 *
 * @wordpress-plugin
 * Plugin Name:       Synapse Conversion Tracking
 * Description:       Server-side tagging for a self-hosted Google Tag Manager server container: embeds the web GTM snippet with a custom first-party loader, optional enhanced ad-blocker protection, GA4 measurement recovery and Data Client transport rescue for hostile browser privacy modes, configures WooCommerce data layer events, and restores lost ad click IDs.
 * Version:           2.0.3
 * Requires at least: 5.8
 * Requires PHP:      7.2
 * Update URI:        https://raw.githubusercontent.com/synapse-marketing/synapse-conversion-tracking/main/updates/manifest.json
 * Author:            Synapse
 * License:           GPL-2.0+
 * License URI:       http://www.gnu.org/licenses/gpl-2.0.txt
 * Text Domain:       gtm-server-side
 */

defined( 'ABSPATH' ) || exit;

/**
 * Bootstrap.
 */
require plugin_dir_path( __FILE__ ) . 'bootstrap.php';

register_activation_hook( __FILE__, array( GTM_Server_Side_Plugin_Activate::class, 'instance' ) );
register_deactivation_hook( __FILE__, array( GTM_Server_Side_Plugin_Deactivate::class, 'instance' ) );

add_action( 'init', array( GTM_Server_Side_Plugin_Upgrade::class, 'instance' ) );
// On the always-hook, not the admin one: WordPress checks for updates from
// WP-Cron as well, where is_admin() is false.
add_action( 'synapse_ct', array( GTM_Server_Side_Plugin_Update::class, 'instance' ) );
add_action( 'synapse_ct', array( GTM_Server_Side_I18n::class, 'instance' ) );
add_action( 'synapse_ct', array( GTM_Server_Side_WC_Order::class, 'instance' ) );
add_action( 'synapse_ct', array( GTM_Server_Side_Frontend_Ajax::class, 'instance' ) );
// Edge sender health: a WP-Cron check (so on the always-hook, like the updater)
// plus a Site Health test and an admin notice when the edge copy is failing.
add_action( 'synapse_ct', array( GTM_Server_Side_Edge_Health::class, 'instance' ) );
add_action( 'synapse_ct_admin', array( GTM_Server_Side_Admin_Settings::class, 'instance' ) );
add_action( 'synapse_ct_admin', array( GTM_Server_Side_Admin_Assets::class, 'instance' ) );
add_action( 'synapse_ct_frontend', array( GTM_Server_Side_Frontend_Assets::class, 'instance' ) );
add_action( 'synapse_ct_frontend', array( GTM_Server_Side_Click_Id_Restorer::class, 'instance' ) );
add_action( 'synapse_ct_frontend', array( GTM_Server_Side_Tracking_Code::class, 'instance' ) );
add_action( 'synapse_ct_frontend', array( GTM_Server_Side_Tracking_Gtm4wp::class, 'instance' ) );
add_action( 'synapse_ct_frontend', array( GTM_Server_Side_Event_Home::class, 'instance' ) );
add_action( 'synapse_ct_frontend', array( GTM_Server_Side_Event_Register::class, 'instance' ) );
add_action( 'synapse_ct_frontend', array( GTM_Server_Side_Event_ViewItem::class, 'instance' ) );
add_action( 'synapse_ct_frontend', array( GTM_Server_Side_Event_ViewItemList::class, 'instance' ) );
add_action( 'synapse_ct_frontend', array( GTM_Server_Side_Event_ViewCart::class, 'instance' ) );
add_action( 'synapse_ct_frontend', array( GTM_Server_Side_Event_BeginCheckout::class, 'instance' ) );
add_action( 'synapse_ct_frontend', array( GTM_Server_Side_Event_Purchase::class, 'instance' ) );
add_action( 'synapse_ct_frontend', array( GTM_Server_Side_Event_AddToCart::class, 'instance' ) );
