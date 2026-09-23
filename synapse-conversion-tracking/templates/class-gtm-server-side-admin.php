<?php
/**
 * Provide a admin area view for the plugin
 *
 * This file is used to markup the admin-facing aspects of the plugin.
 *
 * @since      1.0.0
 *
 * @package    GTM_Server_Side
 * @subpackage GTM_Server_Side/admin/partials
 */

$tab = GTM_Server_Side_Admin_Settings::get_settings_tab(); // phpcs:ignore WordPress.WP.GlobalVariablesOverride.Prohibited
?>

<div id="gtm-server-side-admin-settings" class="wrap">
	<h2><?php esc_html_e( 'Synapse Conversion Tracking', 'gtm-server-side' ); ?></h2>

	<div class="nav-tab-wrapper wp-clearfix">
		<a href="<?php echo esc_url( remove_query_arg( 'tab' ) ); ?>" class="nav-tab<?php echo 'general' === $tab ? ' nav-tab-active' : ''; ?>">
			<?php esc_html_e( 'General', 'gtm-server-side' ); ?>
		</a>

		<?php if ( GTM_Server_Side_Helpers::is_plugin_wc_enabled() ) : ?>
			<a href="<?php echo esc_url( add_query_arg( array( 'tab' => 'data-layer' ) ) ); ?>" class="nav-tab<?php echo 'data-layer' === $tab ? ' nav-tab-active' : ''; ?>">
				<?php esc_html_e( 'Data Layer', 'gtm-server-side' ); ?>
			</a>
		<?php else : ?>
			<div class="nav-tab tab-disabled" title="<?php esc_html_e( 'Activate WooCommerce plugin', 'gtm-server-side' ); ?>">
				<?php esc_html_e( 'Data Layer', 'gtm-server-side' ); ?>
			</div>
		<?php endif; ?>

	</div>

	<form action="options.php" method="post" class="js-form-gtm-server-side">
		<input type="hidden" name="tab" value="<?php echo esc_attr( $tab ); ?>" ?>

		<?php settings_fields( GTM_SERVER_SIDE_ADMIN_GROUP ); ?>
		<?php do_settings_sections( GTM_SERVER_SIDE_ADMIN_SLUG ); ?>

		<?php submit_button( '', 'primary', 'submit', true, array( 'id' => 'gtm-server-side-btn-submit' ) ); ?>
	</form>
</div>
