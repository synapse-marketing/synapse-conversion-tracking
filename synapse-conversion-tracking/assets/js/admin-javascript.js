/**
 * Admin js file.
 *
 * @package GTM_Server_Side
 */

jQuery( document ).ready(
	function () {
		// Validate.
		const formGtmServerSide = jQuery( '.js-form-gtm-server-side' ).validate(
			{
				rules: {
					synapse_ct_web_container_id: {
						webContainerId: true
					},
					synapse_ct_web_container_url: {
						webContainerUrl: true
					},
					synapse_ct_gtm_exclude_roles: {
						gtmExcludeRoles: true
					}
				},
				errorPlacement: function(error, element) {
					if ( element.attr( 'name' ) === 'synapse_ct_gtm_exclude_roles' ) {
						jQuery( '.js-gtm-server-side-gtm-exclude-roles-message' ).empty().append( error );
					} else {
						error.insertAfter( element );
					}
				}
			}
		);

		// Add validate rules.
		jQuery.validator.addMethod(
			'webContainerId',
			function( value, element ) {
				if ( ! value ) {
					return true;
				}
				return value && /^GTM-.+$/.test( value );
			},
			'Container id must be in GTM-XXXXXX format'
		);
		jQuery.validator.addMethod(
			'webContainerUrl',
			function( value, element ) {
				if ( ! value ) {
					return true;
				}
				return /^https:\/\/[\w\-\.]+(\/[\w\-\.]+)*$/.test( value );
			},
			'URL must be entered with https:// and without slashes at the end'
		);
		jQuery.validator.addMethod(
			'gtmExcludeRoles',
			function( value, element ) {
				if ( value !== 'yes' ) {
					return true;
				}

				return jQuery( '.js-synapse_ct_gtm_exclude_list_roles:checked' ).length > 0;
			},
			'Select at least one role'
		);

		// Tab "General".
		pluginGtmServerSide.changeContainerId();
		pluginGtmServerSide.validateContainerIdByPlacementPlugin(); // tmp.
		jQuery( '.js-synapse_ct_placement' ).on(
			'click',
			function() {
				pluginGtmServerSide.changeFieldPlacement(); // tmp.
				pluginGtmServerSide.changeContainerId();
			}
		);

		pluginGtmServerSide.changeExcludeGtmUserRoles();
		jQuery( '.js-synapse_ct_gtm_exclude_roles' ).on(
			'click',
			pluginGtmServerSide.changeExcludeGtmUserRoles
		);
		// ----------

		// Tab "Data Layer".
		pluginGtmServerSide.initTabDataLayer();
		jQuery( '#synapse_ct_data_layer_ecommerce' ).click(
			function() {
				pluginGtmServerSide.initTabDataLayer();
			}
		);

	}
);

const pluginGtmServerSide = {
	initTabDataLayer: function() {
		const $elUserData = jQuery( '#synapse_ct_data_layer_user_data' );
		if ( false === jQuery( '#synapse_ct_data_layer_ecommerce' ).is( ':checked' ) ) {
			$elUserData
				.prop( 'checked', false )
				.prop( 'disabled', true );
		} else {
			$elUserData.prop( 'disabled', false );
		}
	},

	changeContainerId: function() {
		const val   = jQuery( '.js-synapse_ct_placement:checked' ).val();
		const $elCI = jQuery( '#synapse_ct_web_container_id' );

		if ( [ 'code', 'plugin' ].includes( val ) ) {
			$elCI.rules(
				'add',
				{
					required: true,
				}
			);
		} else {
			$elCI.rules( 'remove', 'required' );
		}
	},

	changeExcludeGtmUserRoles: function() {
		const excludeRolesValue = jQuery( '.js-synapse_ct_gtm_exclude_roles:checked' ).val();
		const $block            = jQuery( '.js-gtm-server-side-gtm-exclude-roles-block' );

		if ( 'yes' === excludeRolesValue ) {
			$block.show();
		} else {
			$block.hide();
		}
	},

	changeFieldPlacement: function() {
		const $placementPlugin = jQuery( 'input[type=hidden]#synapse_ct_placement-plugin' );
		if ( ! $placementPlugin.length ) {
			return;
		}

		const name = 'synapse_ct_placement';
		$placementPlugin.attr( 'name', name + '-tmp' );

		jQuery( '.js-synapse_ct_placement' ).each(
			function() {
				jQuery( this ).attr( 'name', name );
			}
		);
	},

	validateContainerIdByPlacementPlugin: function() {
		const $placementPlugin = jQuery( 'input[type=hidden]#synapse_ct_placement-plugin' );
		if ( ! $placementPlugin.length ) {
			return;
		}

		if ( 'plugin' === $placementPlugin.val() ) {
			jQuery( '#synapse_ct_web_container_id' ).rules(
				'add',
				{
					required: true,
				}
			);
		}
	},
};
