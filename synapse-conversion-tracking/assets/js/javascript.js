/**
 * Front-end js file.
 *
 * Wrapped in a guarded IIFE: the whole file is a no-op when jQuery is absent
 * (optimizers that defer or deregister jQuery would otherwise make the very
 * first statement throw, leaving pluginGtmServerSide undefined for everything
 * else on the page). Written in ES5 on purpose - optional chaining and default
 * parameters cost nothing here and some concatenating minifiers still fail to
 * parse them, on hosting this plugin does not control.
 *
 * @package GTM_Server_Side
 */

( function () {
	'use strict';

	if ( typeof jQuery === 'undefined' ) {
		return;
	}

	/**
	 * Resolve the localized config lazily.
	 *
	 * wp_localize_script emits varGtmServerSide in a separate inline block. A
	 * bundler that concatenates files while leaving inline blocks in place can
	 * put this script before its own data, so every read goes through here and
	 * a missing config degrades to "push the event undecorated" instead of
	 * throwing ReferenceError from inside a click handler.
	 *
	 * @returns object
	 */
	function cfg() {
		return ( typeof varGtmServerSide !== 'undefined' && varGtmServerSide ) ? varGtmServerSide : {};
	}

	/**
	 * Return the dataLayer, creating it if nothing has yet.
	 *
	 * The loader normally creates it, but it does not run when the container
	 * placement is Disable or the current user is in an excluded role - and the
	 * event scripts still push. Referencing a bare global would throw.
	 *
	 * @returns array
	 */
	function dl() {
		window.dataLayer = window.dataLayer || [];
		return window.dataLayer;
	}

	/**
	 * Report an anomaly through the tail's signal channel when it is present.
	 *
	 * Never throws and never blocks; absent tail means no signal.
	 *
	 * @param string kind Signal kind.
	 * @param string note Short note.
	 * @return void
	 */
	var signalled = {};

	function signal( kind, note ) {
		var handled = false;

		try {
			if ( 'function' === typeof window.__synSig ) {
				window.__synSig( kind, note );
				handled = true;
			}
		} catch ( e ) {
			/* diagnostics must never break tracking */
		}

		if ( handled ) {
			return;
		}

		// No tail on this page, which is every site not running the
		// edge-served sender. Send the same pixel directly, once per kind, so
		// a failure is visible in inline mode too. A bare Image GET on
		// purpose: the ad-blocker shim wraps fetch, XHR and sendBeacon, so
		// this one arrives at the worker verbatim.
		try {
			var path = cfg().signal_path;

			if ( 'string' !== typeof path || signalled[ kind ] || ! window.Image || ! window.location ) {
				return;
			}

			signalled[ kind ] = 1;

			var px = new window.Image( 1, 1 );
			px.src = window.location.origin + path + '/_sg?k=' + encodeURIComponent( kind ) +
				'&n=' + encodeURIComponent( String( note ).slice( 0, 40 ) ) + '&_syng=1';
		} catch ( e ) {
			/* never let observability break delivery */
		}
	}

	/**
	 * Events that are waiting for cart state, and the way out for them when the
	 * page does not stay long enough.
	 *
	 * With "Decorate dataLayer event name" on, add_to_cart and remove_from_cart
	 * are held back until an admin-ajax call answers. A cart form that submits
	 * and navigates takes the ajaxComplete listener and the 1500 ms timer with
	 * it, so the event was never pushed at all - the enrichment was optional,
	 * the event was not. Anything still pending is flushed on the way out,
	 * without the cart state it never received.
	 */
	var pendingFlushes = [];
	var flushHooked    = false;

	function flushPending() {
		var queue = pendingFlushes.splice( 0 );
		for ( var i = 0; i < queue.length; i++ ) {
			try {
				queue[ i ]();
			} catch ( e ) {
				/* a page on its way out must not throw */
			}
		}
	}

	function addPending( fn ) {
		pendingFlushes.push( fn );

		if ( flushHooked || ! window.addEventListener ) {
			return;
		}
		flushHooked = true;

		// pagehide covers navigation and the back/forward cache. A mobile tab
		// can be discarded after being hidden without ever firing it, so the
		// hidden transition is watched too. Both are idempotent: whichever
		// arrives first empties the queue.
		window.addEventListener( 'pagehide', flushPending );

		if ( document.addEventListener ) {
			document.addEventListener(
				'visibilitychange',
				function () {
					if ( 'hidden' === document.visibilityState ) {
						flushPending();
					}
				}
			);
		}
	}

	function removePending( fn ) {
		var at = pendingFlushes.indexOf( fn );
		if ( -1 !== at ) {
			pendingFlushes.splice( at, 1 );
		}
	}

	/**
	 * Normalize a quantity.
	 *
	 * Returns 0 for anything that is not a positive whole number, so callers can
	 * skip the row. "0" is truthy in JavaScript, which is why this parses before
	 * testing rather than relying on falsiness.
	 *
	 * @param mixed value Raw value.
	 * @returns int
	 */
	function toQty( value ) {
		var n = parseInt( value, 10 );
		return ( ! isNaN( n ) && n > 0 ) ? n : 0;
	}

	var pluginGtmServerSide = {
		pushSimpleProduct: function ( $elForm ) {
			var item = this.convertInputsToObject(
				$elForm.find( '[name^=gtm_]' )
			);
			item     = this.getGtmItemData( item );

			var $elQty = $elForm.find( '[name=quantity]' );
			if ( $elQty.length ) {
				item.quantity = $elQty.val();
			}

			this.pushAddToCart( item );
		},

		pushVariationProduct: function ( $elForm ) {
			var item = this.convertInputsToObject(
				$elForm.find( '[name^=gtm_]' )
			);
			item     = this.getGtmItemData( item );

			var $elQty = $elForm.find( '[name=quantity]' );
			if ( $elQty.length ) {
				item.quantity = $elQty.val();
			}

			var variations = [];
			$elForm.find( '[name^=attribute_] option:selected' ).each(
				function () {
					variations.push( jQuery( this ).text() );
				}
			);

			if ( variations.length ) {
				item.item_variant = variations.join( ',' );
			}

			this.pushAddToCart( item );
		},

		/**
		 * Collect the ordered children of a grouped product.
		 *
		 * WooCommerce renders every child with quantity="0", so rows are kept
		 * only when a positive quantity was actually typed - otherwise a single
		 * click would report every child in the group as added.
		 *
		 * @param object $elForm Grouped add-to-cart form.
		 * @return void
		 */
		pushGroupProduct: function ( $elForm ) {
			var items = [];
			$elForm.find( '[name^=quantity\\[]' ).each(
				function () {
					var qty = toQty( jQuery( this ).val() );
					if ( ! qty ) {
						return;
					}

					var $elTd = jQuery( this ).closest( 'td' );
					if ( ! $elTd.length ) {
						$elTd = jQuery( this ).closest( 'tr, li, .wc-grouped-product-add-to-cart-checkbox' );
					}
					if ( ! $elTd.length ) {
						return;
					}

					var item = {
						quantity: qty,
					};
					$elTd.find( '[name^=gtm_]' ).each(
						function () {
							item[ jQuery( this ).data( 'name' ) ] = jQuery( this ).val();
						}
					);
					items.push( item );
				}
			);
			this.pushAddToCart( items );
		},

		/**
		 * Remove from cart.
		 *
		 * Routed through the shared push so it gets ecommerce.value, a formatted
		 * price, index, the user_data block and the custom-event-name routing,
		 * exactly like every other ecommerce event.
		 *
		 * @param object item Item.
		 * @return void
		 */
		removeFromCart: function ( item ) {
			item          = Object.assign( {}, item );
			item.quantity = toQty( item.quantity ) || 1;

			this._pushToDataLayer( item, 'remove_from_cart', 'cart' );
		},

		/**
		 * Change product quantity in cart.
		 *
		 * Reports an increase as add_to_cart and a decrease as remove_from_cart,
		 * with the delta as the quantity. Both sides are parsed as numbers first:
		 * defaultValue is a string, so a loose comparison against a number would
		 * let an empty field masquerade as 0.
		 *
		 * The delta is measured against what was last reported for this field,
		 * not against the value the page was rendered with. On a cart that
		 * updates without a reload a second edit would otherwise be reported as
		 * the whole distance from the original and the counts would drift: 10 to
		 * 12 to 15 sent +2 and then +5 for a real change of +5.
		 *
		 * An unreadable value is left alone rather than folded back onto the
		 * original. A cleared field is someone mid-edit, not an intent to change
		 * anything, and it must not be measured against a moved baseline.
		 *
		 * @return void
		 */
		changeCartQty: function () {
			var $this = this;

			document.querySelectorAll( '.product-quantity input.qty' ).forEach(
				function ( el ) {
					var originalValue = parseInt( el.defaultValue, 10 );
					var currentValue  = parseInt( el.value, 10 );

					if ( isNaN( originalValue ) || isNaN( currentValue ) ) {
						return;
					}

					var baseline = undefined === el.synapseReportedQty
						? originalValue
						: el.synapseReportedQty;

					if ( baseline === currentValue ) {
						return;
					}

					var elCartItem = el.closest( '.cart_item' );
					var elDataset  = elCartItem && elCartItem.querySelector( '.remove' );
					if ( ! elDataset ) {
						return;
					}

					var item = $this.getGtmItemData( elDataset.dataset );

					el.synapseReportedQty = currentValue;

					if ( currentValue > baseline ) {
						item.quantity = currentValue - baseline;
						$this.pushAddToCart( item );
					} else {
						item.quantity = baseline - currentValue;
						$this.removeFromCart( item );
					}
				}
			);
		},

		/**
		 * Return gtm custom data.
		 *
		 * @param object items List items.
		 * @returns object
		 */
		getGtmItemData: function ( items ) {
			return this._getItemData( items, 'gtm_' );
		},

		/**
		 * Return gtm custom data.
		 *
		 * @param object items List items.
		 * @returns object
		 */
		getCustomItemData: function ( items ) {
			return this._getItemData( items, 'custom_gtm_' );
		},

		/**
		 * Return item data.
		 *
		 * Identity fields are forced to strings: element.dataset yields strings
		 * while jQuery .data() coerces anything numeric to a Number, so the same
		 * product would otherwise be reported as 123 on one path and "123" on
		 * another, and the PHP-emitted events always use strings.
		 *
		 * @param object items List items.
		 * @param string prefix Key prefix.
		 * @returns object
		 */
		_getItemData: function ( items, prefix ) {
			var idKeys = { item_id: 1, item_sku: 1, collection_id: 1 };
			var result = {};
			for ( var key in items ) {
				if ( 0 !== key.indexOf( prefix ) ) {
					continue;
				}

				var itemKey       = key.replace( prefix, '' );
				result[ itemKey ] = items[ key ];

				if ( idKeys[ itemKey ] && null !== result[ itemKey ] && undefined !== result[ itemKey ] ) {
					result[ itemKey ] = String( result[ itemKey ] );
				}
			}
			return result;
		},

		/**
		 * Convert input elements to object.
		 *
		 * @param object $els Elements.
		 * @returns object
		 */
		convertInputsToObject: function ( $els ) {
			var data = {};
			if ( ! $els.length ) {
				return data;
			}

			$els.each(
				function () {
					data[ jQuery( this ).attr( 'name' ) ] = jQuery( this ).val();
				}
			);
			return data;
		},

		/**
		 * Filter item price.
		 *
		 * @param object item List items.
		 * @returns object
		 */
		filterItemPrice: function ( item ) {
			if ( typeof item.price == 'string' ) {
				item.price = parseFloat( item.price );
				if ( isNaN( item.price ) ) {
					item.price = 0;
				}
			} else if ( typeof item.price != 'number' ) {
				item.price = 0;
			}
			item.price = item.price.toFixed( 2 );

			return item;
		},

		/**
		 * Push add_to_cart to dataLayer.
		 *
		 * @param mixed item Single item or list of items.
		 * @return void
		 */
		pushAddToCart: function ( item ) {
			this._pushToDataLayer( item, 'add_to_cart', 'product' );
		},

		/**
		 * Push select_item to dataLayer.
		 *
		 * @param object item Item.
		 * @param object custom Custom data.
		 * @return void
		 */
		pushSelectItem: function ( item, custom ) {
			custom = custom || {};

			if ( ! custom.pagetype ) {
				return;
			}

			// Only carry keys that actually have a value, so ecommerce never
			// gets undefined placeholders copied into it.
			var extra = {};
			if ( custom.collection_id ) {
				extra.collection_id = custom.collection_id;
			}
			if ( custom.item_list_name ) {
				extra.item_list_name = custom.item_list_name;
			}

			this._pushToDataLayer( item, 'select_item', custom.pagetype, extra );
		},

		/**
		 * Push to dataLayer.
		 *
		 * @param object|array originalItem Single item or list of items.
		 * @param string event Event name.
		 * @param string pagetype Page type name.
		 * @param object customEcommerce Ecommerce data.
		 * @return void
		 */
		_pushToDataLayer: function ( originalItem, event, pagetype, customEcommerce ) {
			customEcommerce = customEcommerce || {};

			if ( ! originalItem ) {
				return;
			}

			// Branch on the shape BEFORE copying: Object.assign({}, someArray)
			// returns a plain object with numeric keys, which is not iterable.
			var originalItems = Array.isArray( originalItem ) ? originalItem : [ originalItem ];

			var items = [];
			var value = 0;
			var index = 1;
			for ( var i = 0; i < originalItems.length; i++ ) {
				var item_loop = Object.assign( {}, originalItems[ i ] );

				// An explicit zero means "not ordered" and is dropped; a missing
				// quantity keeps the historical default of 1.
				if ( undefined === item_loop.quantity || '' === item_loop.quantity || null === item_loop.quantity ) {
					item_loop.quantity = 1;
				} else {
					item_loop.quantity = toQty( item_loop.quantity );
					if ( ! item_loop.quantity ) {
						continue;
					}
				}

				item_loop.index = index++;
				item_loop       = this.filterItemPrice( item_loop );
				value           = parseFloat( value + ( item_loop.price * item_loop.quantity ) );
				items.push( item_loop );
			}

			if ( ! items.length ) {
				return;
			}

			var eventDataEcommerce = {
				'currency': cfg().currency || '',
				'value': value.toFixed( 2 ),
				'items': items,
			};

			var eventData = {
				'event':          this.getDataLayerEventName( event ),
				'ecomm_pagetype': pagetype,
				'ecommerce': Object.assign( {}, eventDataEcommerce, customEcommerce ),
			};

			var userData = cfg().user_data;
			if ( userData ) {
				eventData.user_data = {};
				for ( var key in userData ) {
					if ( Object.prototype.hasOwnProperty.call( userData, key ) ) {
						eventData.user_data[ key ] = userData[ key ];
					}
				}
			}

			// Only the two cart-mutating events wait for cart_state; everything
			// else pushes straight through, as it always has.
			var wantsCartState = ( 'add_to_cart' === event || 'remove_from_cart' === event );

			if ( wantsCartState && 'yes' === cfg().is_custom_event_name ) {
				this._pushWithStateCartData( eventData );

				return;
			}

			this._push( eventData );
		},

		/**
		 * Push one ecommerce event, clearing the previous ecommerce object first.
		 *
		 * @param object eventData Event data.
		 * @return void
		 */
		_push: function ( eventData ) {
			var layer = dl();
			layer.push( { ecommerce: null } );
			layer.push( eventData );
		},

		/**
		 * Return the data layer event name.
		 *
		 * @param string event_name Event name.
		 * @return string
		 */
		getDataLayerEventName: function ( event_name ) {
			var config = cfg();
			if ( 'yes' === config.is_custom_event_name ) {
				return event_name + ( config.DATA_LAYER_CUSTOM_EVENT_NAME || '' );
			}
			return event_name;
		},

		/**
		 * Fetch the cart state and push the event.
		 *
		 * The event is pushed exactly once, whatever happens to the request: a
		 * 403 from a stale nonce, a 500, a network failure or a parse error all
		 * end in the same push without cart_state, because losing add_to_cart
		 * outright is far worse than losing one enrichment field.
		 *
		 * @param object eventData eventData object.
		 * @return void
		 */
		_sendStateCartDataAjax: function ( eventData ) {
			var self   = this;
			var pushed = false;

			var finish = function ( cartState ) {
				if ( pushed ) {
					return;
				}
				pushed = true;

				removePending( onLeave );

				if ( cartState ) {
					eventData['cart_state'] = cartState;
				}

				self._push( eventData );
			};

			// A request that is still in flight when the page goes away would
			// take the event with it, so the plain push stays armed until the
			// request has actually answered one way or the other.
			var onLeave = function () {
				if ( pushed ) {
					return;
				}

				signal( 'cart_state', 'unload' );
				finish( null );
			};

			addPending( onLeave );

			var config = cfg();

			if ( ! config.ajax ) {
				finish( null );
				return;
			}

			jQuery.ajax(
				{
					url: config.ajax,
					type: 'POST',
					dataType: 'json',
					timeout: 5000,
					data: {
						action: 'gtm_server_side_state_cart_data',
						security: config.security,
					},
				}
			).done(
				function ( response ) {
					if ( ! response || ! response.success ) {
						signal( 'cart_state', 'error' );
						finish( null );
						return;
					}

					finish( response.data );
				}
			).fail(
				function ( jqXHR, textStatus ) {
					signal( 'cart_state', textStatus || 'fail' );
					finish( null );
				}
			);
		},

		/**
		 * Push dataLayer with state cart data.
		 *
		 * @param object eventData Event data object.
		 * @return void
		 */
		_pushWithStateCartData: function ( eventData ) {
			var self  = this;
			var fired = false;

			// Leaving before the cart state was even asked for: push the event
			// as it stands rather than losing it with the page.
			var onLeave = function () {
				if ( fired ) {
					return;
				}
				fired = true;

				jQuery( document ).off( 'ajaxComplete', handler );
				signal( 'cart_state', 'unload' );
				self._push( eventData );
			};

			var handOver = function () {
				if ( fired ) {
					return;
				}
				fired = true;

				jQuery( document ).off( 'ajaxComplete', handler );
				removePending( onLeave );

				self._sendStateCartDataAjax( eventData );
			};

			var handler = function ( event, xhr, settings ) {
				if ( fired ) {
					return;
				}

				if ( ! settings || ! settings.url ) {
					return;
				}

				var url = settings.url;

				if (
					url.indexOf( 'wc-ajax=add_to_cart' ) !== -1 ||
					url.indexOf( 'wc-ajax=remove_from_cart' ) !== -1
				) {
					handOver();
				}
			};

			jQuery( document ).on( 'ajaxComplete', handler );
			addPending( onLeave );

			setTimeout( handOver, 1500 );
		}
	};

	// Kept on window: only this file uses it today, but site owners have been
	// able to call it since 2.0 and removing it would break their snippets.
	window.pluginGtmServerSide = pluginGtmServerSide;

	jQuery( document ).ready(
		function () {
			jQuery( document ).on(
				'click',
				'body.woocommerce-cart [name=update_cart]',
				function () {
					pluginGtmServerSide.changeCartQty();
				}
			);

			jQuery( document ).on(
				'keypress',
				'body.woocommerce-cart .woocommerce-cart-form input[type=number]',
				function ( e ) {
					// Enter submits the cart form, so this is the last moment
					// the final value can be read before the page navigates.
					//
					// Every other key is not a cart action. keypress runs
					// BEFORE the browser inserts the character, so replacing
					// 10 with 12 passes through "1" and used to be reported as
					// nine items removed that nobody removed. Only a confirmed
					// update may produce an event.
					if ( 13 !== e.which && 13 !== e.keyCode && 'Enter' !== e.key ) {
						return;
					}

					pluginGtmServerSide.changeCartQty();
				}
			);

			/**
			 * Archive and block-grid add to cart.
			 *
			 * One handler, not two: the block-grid selector used to be a strict
			 * subset of the archive one, so both matched the same click and only
			 * the placement of the data attributes kept them from double-pushing.
			 * The data source is resolved with a fallback instead - the button's
			 * own dataset first, then the nearest ancestor carrying an item id.
			 */
			jQuery( document ).on(
				'click',
				'.add_to_cart_button:not(.product_type_variable, .product_type_grouped, .single_add_to_cart_button)',
				function ( e ) {
					// currentTarget, not target: a click on an icon or a span
					// inside the button reports that child as the target and its
					// dataset carries nothing.
					var el = e.currentTarget;
					var data;

					if ( el && el.dataset && el.dataset.gtm_item_id ) {
						data = el.dataset;
					} else {
						var $ancestor = jQuery( el ).closest( '[data-gtm_item_id]' );
						if ( ! $ancestor.length ) {
							$ancestor = jQuery( el ).closest( '.wc-block-grid__product, .wc-block-product' );
						}
						if ( ! $ancestor.length || ! $ancestor.data( 'gtm_item_id' ) ) {
							return;
						}
						data = $ancestor.data();
					}

					var gtmData    = pluginGtmServerSide.getGtmItemData( data );
					var customData = pluginGtmServerSide.getCustomItemData( data );

					pluginGtmServerSide.pushAddToCart( gtmData );
					pluginGtmServerSide.pushSelectItem( gtmData, customData );
				}
			);

			jQuery( document ).on(
				'click',
				'.single_add_to_cart_button:not(.disabled)',
				function ( e ) {
					var $elForm = jQuery( this ).closest( 'form.cart' );
					if ( ! $elForm.length ) {
						return true;
					}

					if ( $elForm.find( '[name=variation_id]' ).length > 0 ) {
						pluginGtmServerSide.pushVariationProduct( $elForm );
						return;
					}

					if ( $elForm.hasClass( 'grouped_form' ) ) {
						pluginGtmServerSide.pushGroupProduct( $elForm );
						return;
					}

					pluginGtmServerSide.pushSimpleProduct( $elForm );
				}
			);

			/**
			 * Delete from minicart
			 */
			jQuery( document ).on(
				'removed_from_cart',
				function ( e, fragments, cart_hash, $thisbutton ) {
					// Themes and third-party carts trigger this event with fewer
					// arguments; reading .length off undefined would throw and
					// take out every other handler bound to the same event.
					if ( ! $thisbutton || ! $thisbutton.length ) {
						return;
					}

					if ( ! $thisbutton.data( 'gtm_item_id' ) ) {
						return;
					}

					pluginGtmServerSide.removeFromCart(
						pluginGtmServerSide.getGtmItemData( $thisbutton.data() )
					);
				}
			);

			/**
			 * Delete from page: /cart
			 */
			jQuery( document ).on(
				'click',
				'.woocommerce-cart-form .product-remove > a',
				function ( e ) {
					var $el = jQuery( e.currentTarget );

					if ( ! $el.data( 'gtm_item_id' ) ) {
						return;
					}

					pluginGtmServerSide.removeFromCart(
						pluginGtmServerSide.getGtmItemData( $el.data() )
					);
				}
			);
		}
	);
} )();
