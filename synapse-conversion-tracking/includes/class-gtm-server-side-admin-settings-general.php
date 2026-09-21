<?php
/**
 * Admin settings, tab: General.
 *
 * @package    GTM_Server_Side
 * @subpackage GTM_Server_Side/includes
 * @since      2.0.0
 */

defined( 'ABSPATH' ) || exit;

/**
 * Admin settings, tab: General.
 */
class GTM_Server_Side_Admin_Settings_General {
	/**
	 * Tab.
	 *
	 * @return void
	 */
	public static function tab() {

		$placement = GTM_Server_Side_Helpers::get_option( GTM_SERVER_SIDE_FIELD_PLACEMENT );
		add_settings_section(
			GTM_SERVER_SIDE_ADMIN_GROUP_GENERAL,
			__( 'General', 'gtm-server-side' ),
			function() use ( $placement ) {
				if ( GTM_SERVER_SIDE_FIELD_PLACEMENT_VALUE_PLUGIN === $placement ) {
					echo '<input
						type="hidden"
						id="' . esc_attr( GTM_SERVER_SIDE_FIELD_PLACEMENT . '-' . GTM_SERVER_SIDE_FIELD_PLACEMENT_VALUE_PLUGIN ) . '"
						name="' . esc_attr( GTM_SERVER_SIDE_FIELD_PLACEMENT ) . '"
						value="' . esc_attr( GTM_SERVER_SIDE_FIELD_PLACEMENT_VALUE_PLUGIN ) . '">';
				}
			},
			GTM_SERVER_SIDE_ADMIN_SLUG
		);

		register_setting(
			GTM_SERVER_SIDE_ADMIN_GROUP,
			GTM_SERVER_SIDE_FIELD_PLACEMENT,
			array(
				'sanitize_callback' => function( $value ) {
					$allows = array(
						GTM_SERVER_SIDE_FIELD_PLACEMENT_VALUE_CODE,
						GTM_SERVER_SIDE_FIELD_PLACEMENT_VALUE_PLUGIN,
						GTM_SERVER_SIDE_FIELD_PLACEMENT_VALUE_DISABLE,
						GTM_SERVER_SIDE_FIELD_PLACEMENT_VALUE_GTM_CONSENT,
					);
					return in_array( $value, $allows, true ) ? $value : GTM_SERVER_SIDE_FIELD_PLACEMENT_VALUE_CODE;
				},
			)
		);

		$field_placement    = GTM_SERVER_SIDE_FIELD_PLACEMENT . '-tmp';
		$allowed_placements = array(
			GTM_SERVER_SIDE_FIELD_PLACEMENT_VALUE_CODE,
			GTM_SERVER_SIDE_FIELD_PLACEMENT_VALUE_DISABLE,
			GTM_SERVER_SIDE_FIELD_PLACEMENT_VALUE_GTM_CONSENT,
		);
		if ( in_array( $placement, $allowed_placements, true ) ) {
			$field_placement = GTM_SERVER_SIDE_FIELD_PLACEMENT;
		}

		add_settings_field(
			GTM_SERVER_SIDE_FIELD_PLACEMENT . '-' . GTM_SERVER_SIDE_FIELD_PLACEMENT_VALUE_CODE,
			__( 'Add web GTM script onto every page of your website', 'gtm-server-side' ),
			function() use ( $placement, $field_placement ) {
				echo '<input
					type="radio"
					id="' . esc_attr( GTM_SERVER_SIDE_FIELD_PLACEMENT . '-' . GTM_SERVER_SIDE_FIELD_PLACEMENT_VALUE_CODE ) . '"
					class="js-' . esc_attr( GTM_SERVER_SIDE_FIELD_PLACEMENT ) . '"
					name="' . esc_attr( $field_placement ) . '"
					' . checked( $placement, GTM_SERVER_SIDE_FIELD_PLACEMENT_VALUE_CODE, false ) . '
					value="' . esc_attr( GTM_SERVER_SIDE_FIELD_PLACEMENT_VALUE_CODE ) . '">';
				esc_html_e( 'Select this option if you want to embed the web GTM snippet code onto every page of your website.', 'gtm-server-side' );
			},
			GTM_SERVER_SIDE_ADMIN_SLUG,
			GTM_SERVER_SIDE_ADMIN_GROUP_GENERAL
		);

		add_settings_field(
			GTM_SERVER_SIDE_FIELD_PLACEMENT . '-' . GTM_SERVER_SIDE_FIELD_PLACEMENT_VALUE_GTM_CONSENT,
			__( 'Load GTM with consent', 'gtm-server-side' ),
			function() use ( $placement, $field_placement ) {
				echo '<input
					type="radio"
					id="' . esc_attr( GTM_SERVER_SIDE_FIELD_PLACEMENT . '-' . GTM_SERVER_SIDE_FIELD_PLACEMENT_VALUE_GTM_CONSENT ) . '"
					class="js-' . esc_attr( GTM_SERVER_SIDE_FIELD_PLACEMENT ) . '"
					name="' . esc_attr( $field_placement ) . '"
					' . checked( $placement, GTM_SERVER_SIDE_FIELD_PLACEMENT_VALUE_GTM_CONSENT, false ) . '
					value="' . esc_attr( GTM_SERVER_SIDE_FIELD_PLACEMENT_VALUE_GTM_CONSENT ) . '">';
					esc_html_e( 'Select this option if you want GTM not to execute until the visitor consent management platform (CMP) grants ad_storage or analytics_storage consent.', 'gtm-server-side' );
			},
			GTM_SERVER_SIDE_ADMIN_SLUG,
			GTM_SERVER_SIDE_ADMIN_GROUP_GENERAL
		);

		register_setting(
			GTM_SERVER_SIDE_ADMIN_GROUP,
			GTM_SERVER_SIDE_FIELD_GTM_EXCLUDE_ROLES,
			array(
				'sanitize_callback' => 'GTM_Server_Side_Helpers::sanitize_bool',
			)
		);
		register_setting(
			GTM_SERVER_SIDE_ADMIN_GROUP,
			GTM_SERVER_SIDE_FIELD_GTM_EXCLUDE_LIST_ROLES,
			array(
				'sanitize_callback' => function( $value ) {
					if ( ! is_array( $value ) ) {
						return array();
					}
					return array_map( 'sanitize_key', $value );
				},
			)
		);
		add_settings_field(
			GTM_SERVER_SIDE_FIELD_GTM_EXCLUDE_ROLES,
			__( 'Exclude GTM for user roles', 'gtm-server-side' ),
			function() {
				echo '<div class="gtm-server-side-gtm-exclude-roles">';
				echo '<input
					type="checkbox"
					id="' . esc_attr( GTM_SERVER_SIDE_FIELD_GTM_EXCLUDE_ROLES ) . '"
					class="js-' . esc_attr( GTM_SERVER_SIDE_FIELD_GTM_EXCLUDE_ROLES ) . '"
					name="' . esc_attr( GTM_SERVER_SIDE_FIELD_GTM_EXCLUDE_ROLES ) . '"
					' . checked( GTM_Server_Side_Helpers::get_option( GTM_SERVER_SIDE_FIELD_GTM_EXCLUDE_ROLES ), GTM_SERVER_SIDE_FIELD_VALUE_YES, false ) . '
					value="yes">';
					esc_html_e( 'Select this option to prevent GTM from loading for specific logged-in user roles.', 'gtm-server-side' );

				if ( function_exists( 'wp_roles' ) ) {
					$roles         = wp_roles()->roles;
					$exclude_roles = GTM_Server_Side_Helpers::get_gtm_exclude_list_roles();

					echo '<div class="js-gtm-server-side-gtm-exclude-roles-block">';
					foreach ( $roles as $role_key => $role ) {
						echo '<br><label><input
							type="checkbox"
							class="js-' . esc_attr( GTM_SERVER_SIDE_FIELD_GTM_EXCLUDE_LIST_ROLES ) . '"
							name="' . esc_attr( GTM_SERVER_SIDE_FIELD_GTM_EXCLUDE_LIST_ROLES ) . '[]"
							' . checked( in_array( $role_key, $exclude_roles, true ), true, false ) . '
							value="' . esc_attr( $role_key ) . '"
						> ' . esc_html( $role['name'] ) . '</label>';
					}
					echo '</div>';
				}
				echo '<span class="js-gtm-server-side-gtm-exclude-roles-message"></span>';
				echo '</div>';
			},
			GTM_SERVER_SIDE_ADMIN_SLUG,
			GTM_SERVER_SIDE_ADMIN_GROUP_GENERAL
		);

		add_settings_field(
			GTM_SERVER_SIDE_FIELD_PLACEMENT . '-' . GTM_SERVER_SIDE_FIELD_PLACEMENT_VALUE_DISABLE,
			__( 'Disable', 'gtm-server-side' ),
			function() use ( $placement, $field_placement ) {
				echo '<input
					type="radio"
					id="' . esc_attr( GTM_SERVER_SIDE_FIELD_PLACEMENT . '-' . GTM_SERVER_SIDE_FIELD_PLACEMENT_VALUE_DISABLE ) . '"
					class="js-' . esc_attr( GTM_SERVER_SIDE_FIELD_PLACEMENT ) . '"
					name="' . esc_attr( $field_placement ) . '"
					' . checked( $placement, GTM_SERVER_SIDE_FIELD_PLACEMENT_VALUE_DISABLE, false ) . '
					value="' . esc_attr( GTM_SERVER_SIDE_FIELD_PLACEMENT_VALUE_DISABLE ) . '">';
					esc_html_e( 'Use this option if you do not want to insert web GTM snippet code onto your website.', 'gtm-server-side' );
			},
			GTM_SERVER_SIDE_ADMIN_SLUG,
			GTM_SERVER_SIDE_ADMIN_GROUP_GENERAL
		);

		register_setting(
			GTM_SERVER_SIDE_ADMIN_GROUP,
			GTM_SERVER_SIDE_FIELD_WEB_CONTAINER_ID,
			array(
				'sanitize_callback' => function( $value ) {
					return trim( (string) $value );
				},
			)
		);
		add_settings_field(
			GTM_SERVER_SIDE_FIELD_WEB_CONTAINER_ID,
			__( 'Web Google Tag Manager ID', 'gtm-server-side' ),
			function() {
				echo '<input
					type="text"
					id="' . esc_attr( GTM_SERVER_SIDE_FIELD_WEB_CONTAINER_ID ) . '"
					name="' . esc_attr( GTM_SERVER_SIDE_FIELD_WEB_CONTAINER_ID ) . '"
					pattern="GTM-.*"
					value="' . esc_attr( GTM_Server_Side_Helpers::get_option( GTM_SERVER_SIDE_FIELD_WEB_CONTAINER_ID ) ) . '">';
				echo '<br>';
				esc_html_e( 'Enter the WEB Google Tag Manager ID, should be formatted as "GTM-XXXXXX".', 'gtm-server-side' ); //phpcs:ignore WordPress.Security.EscapeOutput.UnsafePrintingFunction
			},
			GTM_SERVER_SIDE_ADMIN_SLUG,
			GTM_SERVER_SIDE_ADMIN_GROUP_GENERAL
		);

		// A trailing slash here produces "https://host/path//name.js" for the
		// container script, which the worker may or may not route. The field is
		// cleaned on save and again on read, because an option can also be
		// written by WP-CLI or a migration that never reaches this callback.
		register_setting(
			GTM_SERVER_SIDE_ADMIN_GROUP,
			GTM_SERVER_SIDE_FIELD_WEB_CONTAINER_URL,
			array(
				'sanitize_callback' => function( $value ) {
					$value = GTM_Server_Side_Helpers::normalize_container_url( $value );

					// esc_url_raw only where there is already a scheme. Given
					// "sgtm.example.com" it would store "http://sgtm.example.com",
					// silently turning a typo into a working-looking plaintext
					// URL. A value that is not a URL is left exactly as typed so
					// the field's own validation is what the operator sees.
					if ( 0 !== strpos( $value, 'https://' ) && 0 !== strpos( $value, 'http://' ) ) {
						return $value;
					}

					return esc_url_raw( $value );
				},
			)
		);
		add_settings_field(
			GTM_SERVER_SIDE_FIELD_WEB_CONTAINER_URL,
			__( 'Server GTM container URL', 'gtm-server-side' ),
			function() {
				echo '<input
					type="text"
					pattern="https://.*"
					id="' . esc_attr( GTM_SERVER_SIDE_FIELD_WEB_CONTAINER_URL ) . '"
					name="' . esc_attr( GTM_SERVER_SIDE_FIELD_WEB_CONTAINER_URL ) . '"
					value="' . esc_attr( GTM_Server_Side_Helpers::get_option( GTM_SERVER_SIDE_FIELD_WEB_CONTAINER_URL ) ) . '">';
				echo '<br>';
				esc_html_e( 'The https:// URL the web container is loaded from, without a trailing slash.', 'gtm-server-side' );
			},
			GTM_SERVER_SIDE_ADMIN_SLUG,
			GTM_SERVER_SIDE_ADMIN_GROUP_GENERAL
		);

		register_setting(
			GTM_SERVER_SIDE_ADMIN_GROUP,
			GTM_SERVER_SIDE_FIELD_WEB_IDENTIFIER,
			array(
				'sanitize_callback' => function( $value ) {
					return trim( (string) $value );
				},
			)
		);
		add_settings_field(
			GTM_SERVER_SIDE_FIELD_WEB_IDENTIFIER,
			__( 'Synapse container identifier', 'gtm-server-side' ),
			function() {
				echo '<input
					type="text"
					id="' . esc_attr( GTM_SERVER_SIDE_FIELD_WEB_IDENTIFIER ) . '"
					class="js-' . esc_attr( GTM_SERVER_SIDE_FIELD_WEB_IDENTIFIER ) . '"
					name="' . esc_attr( GTM_SERVER_SIDE_FIELD_WEB_IDENTIFIER ) . '"
					value="' . esc_attr( GTM_Server_Side_Helpers::get_option( GTM_SERVER_SIDE_FIELD_WEB_IDENTIFIER ) ) . '">';
				echo '<br>';
				esc_html_e( 'Activates the first-party custom loader: the GTM script is served under this disguised file name instead of gtm.js. The edge worker in front of your server GTM container must be configured to recognize the same identifier.', 'gtm-server-side' );
			},
			GTM_SERVER_SIDE_ADMIN_SLUG,
			GTM_SERVER_SIDE_ADMIN_GROUP_GENERAL
		);

		register_setting(
			GTM_SERVER_SIDE_ADMIN_GROUP,
			GTM_SERVER_SIDE_FIELD_ENHANCED_ADBLOCKER,
			array(
				'sanitize_callback' => 'GTM_Server_Side_Helpers::sanitize_bool',
			)
		);
		add_settings_field(
			GTM_SERVER_SIDE_FIELD_ENHANCED_ADBLOCKER,
			__( 'Enhanced ad blocker protection', 'gtm-server-side' ),
			function() {
				echo '<input
					type="checkbox"
					id="' . esc_attr( GTM_SERVER_SIDE_FIELD_ENHANCED_ADBLOCKER ) . '"
					name="' . esc_attr( GTM_SERVER_SIDE_FIELD_ENHANCED_ADBLOCKER ) . '"
					' . checked( GTM_Server_Side_Helpers::get_option( GTM_SERVER_SIDE_FIELD_ENHANCED_ADBLOCKER ), GTM_SERVER_SIDE_FIELD_VALUE_YES, false ) . '
					value="yes">';
				esc_html_e( 'Adds encoding for all requests sent to sGTM, providing stronger protection against ad blockers.', 'gtm-server-side' );
			},
			GTM_SERVER_SIDE_ADMIN_SLUG,
			GTM_SERVER_SIDE_ADMIN_GROUP_GENERAL
		);

		register_setting(
			GTM_SERVER_SIDE_ADMIN_GROUP,
			GTM_SERVER_SIDE_FIELD_GA4_FALLBACK,
			array(
				'sanitize_callback' => 'GTM_Server_Side_Helpers::sanitize_bool',
			)
		);
		add_settings_field(
			GTM_SERVER_SIDE_FIELD_GA4_FALLBACK,
			__( 'GA4 measurement recovery', 'gtm-server-side' ),
			function() {
				echo '<input
					type="checkbox"
					id="' . esc_attr( GTM_SERVER_SIDE_FIELD_GA4_FALLBACK ) . '"
					name="' . esc_attr( GTM_SERVER_SIDE_FIELD_GA4_FALLBACK ) . '"
					' . checked( GTM_Server_Side_Helpers::get_option( GTM_SERVER_SIDE_FIELD_GA4_FALLBACK ), GTM_SERVER_SIDE_FIELD_VALUE_YES, false ) . '
					value="yes">';
				esc_html_e( 'Restores GA4 events blocked by browser privacy protections by sending them through your server container. Recovered hits carry the "synapse_recovered" event parameter. Requires the custom loader and the GA4 Measurement ID below.', 'gtm-server-side' );
			},
			GTM_SERVER_SIDE_ADMIN_SLUG,
			GTM_SERVER_SIDE_ADMIN_GROUP_GENERAL
		);

		register_setting(
			GTM_SERVER_SIDE_ADMIN_GROUP,
			GTM_SERVER_SIDE_FIELD_GA4_FALLBACK_ID,
			array(
				'sanitize_callback' => function( $value ) {
					return strtoupper( preg_replace( '/[^A-Za-z0-9-]/', '', (string) $value ) );
				},
			)
		);
		add_settings_field(
			GTM_SERVER_SIDE_FIELD_GA4_FALLBACK_ID,
			__( 'GA4 Measurement ID', 'gtm-server-side' ),
			function() {
				echo '<input
					type="text"
					pattern="G-.*"
					id="' . esc_attr( GTM_SERVER_SIDE_FIELD_GA4_FALLBACK_ID ) . '"
					name="' . esc_attr( GTM_SERVER_SIDE_FIELD_GA4_FALLBACK_ID ) . '"
					value="' . esc_attr( GTM_Server_Side_Helpers::get_option( GTM_SERVER_SIDE_FIELD_GA4_FALLBACK_ID ) ) . '">';
				echo '<br>';
				esc_html_e( 'Enter the GA4 Measurement ID, should be formatted as "G-XXXXXXX".', 'gtm-server-side' );
			},
			GTM_SERVER_SIDE_ADMIN_SLUG,
			GTM_SERVER_SIDE_ADMIN_GROUP_GENERAL
		);

		register_setting(
			GTM_SERVER_SIDE_ADMIN_GROUP,
			GTM_SERVER_SIDE_FIELD_DATA_RESCUE,
			array(
				'sanitize_callback' => 'GTM_Server_Side_Helpers::sanitize_bool',
			)
		);
		add_settings_field(
			GTM_SERVER_SIDE_FIELD_DATA_RESCUE,
			__( 'Data transport rescue', 'gtm-server-side' ),
			function() {
				echo '<input
					type="checkbox"
					id="' . esc_attr( GTM_SERVER_SIDE_FIELD_DATA_RESCUE ) . '"
					name="' . esc_attr( GTM_SERVER_SIDE_FIELD_DATA_RESCUE ) . '"
					' . checked( GTM_Server_Side_Helpers::get_option( GTM_SERVER_SIDE_FIELD_DATA_RESCUE ), GTM_SERVER_SIDE_FIELD_VALUE_YES, false ) . '
					value="yes">';
				esc_html_e( 'Resends Data Client events that the browser blocked in transit. Requires the custom loader.', 'gtm-server-side' );
			},
			GTM_SERVER_SIDE_ADMIN_SLUG,
			GTM_SERVER_SIDE_ADMIN_GROUP_GENERAL
		);

		register_setting(
			GTM_SERVER_SIDE_ADMIN_GROUP,
			GTM_SERVER_SIDE_FIELD_EDGE_SENDER,
			array(
				'sanitize_callback' => 'GTM_Server_Side_Helpers::sanitize_bool',
			)
		);
		add_settings_field(
			GTM_SERVER_SIDE_FIELD_EDGE_SENDER,
			__( 'Edge-served Data Tag sender', 'gtm-server-side' ),
			function() {
				echo '<input
					type="checkbox"
					id="' . esc_attr( GTM_SERVER_SIDE_FIELD_EDGE_SENDER ) . '"
					name="' . esc_attr( GTM_SERVER_SIDE_FIELD_EDGE_SENDER ) . '"
					' . checked( GTM_Server_Side_Helpers::get_option( GTM_SERVER_SIDE_FIELD_EDGE_SENDER ), GTM_SERVER_SIDE_FIELD_VALUE_YES, false ) . '
					value="yes">';
				esc_html_e( 'Serves the Data Tag sender as a cached edge file instead of inlining it on every page. Requires Data transport rescue and the matching worker route.', 'gtm-server-side' );
			},
			GTM_SERVER_SIDE_ADMIN_SLUG,
			GTM_SERVER_SIDE_ADMIN_GROUP_GENERAL
		);

		register_setting(
			GTM_SERVER_SIDE_ADMIN_GROUP,
			GTM_SERVER_SIDE_FIELD_CLICK_ID_RESTORER_GOOGLE,
			array(
				'sanitize_callback' => function( $value ) {
					return preg_replace( '/[^A-Za-z0-9_-]/', '', (string) $value );
				},
			)
		);
		add_settings_field(
			GTM_SERVER_SIDE_FIELD_CLICK_ID_RESTORER_GOOGLE,
			__( 'Google Click ID restorer', 'gtm-server-side' ),
			function() {
				echo '<input
					type="text"
					id="' . esc_attr( GTM_SERVER_SIDE_FIELD_CLICK_ID_RESTORER_GOOGLE ) . '"
					name="' . esc_attr( GTM_SERVER_SIDE_FIELD_CLICK_ID_RESTORER_GOOGLE ) . '"
					value="' . esc_attr( GTM_Server_Side_Helpers::get_option( GTM_SERVER_SIDE_FIELD_CLICK_ID_RESTORER_GOOGLE ) ) . '">';
				echo '<br>';
				esc_html_e( 'Click ID Restorer brings back lost ad click IDs. It automatically replaces custom click ID parameters with gclid in your sGTM requests, so your tracking stays accurate. Leave empty to turn it off.', 'gtm-server-side' );
			},
			GTM_SERVER_SIDE_ADMIN_SLUG,
			GTM_SERVER_SIDE_ADMIN_GROUP_GENERAL
		);
	}
}
