<?php
/**
 * Helper class.
 *
 * @since      2.0.0
 * @package    GTM_Server_Side
 * @subpackage GTM_Server_Side/includes
 */

defined( 'ABSPATH' ) || exit;

/**
 * Helper class.
 */
class GTM_Server_Side_Helpers {
	/**
	 * The asset directory the edge worker tries first on its own. A site that
	 * lives here needs to tell the worker nothing; see get_asset_base_hint().
	 *
	 * @var string
	 */
	const EDGE_SENDER_GUESSED_BASE = '/wp-content/plugins/synapse-conversion-tracking/assets/';

	/**
	 * Marker on the browser's fallback copy of the sender (2.0.1).
	 *
	 * The edge worker fetches the sender from the plugin folder at
	 * "assets/s.js?v=<hash>". Before 2.0.1 the page's fallback asked for that
	 * exact address, so an error the worker had stored there (the worker
	 * published before 2026-09-23 kept ANY answer for a year) was also what the
	 * fallback got, and both copies failed together. With this marker the two
	 * can never share a cache entry. dev-tools/render-boot.mjs reads it from here.
	 *
	 * @var string
	 */
	const EDGE_SENDER_FALLBACK_MARK = 'fb=1';

	/**
	 * Enable or disable data layer ecommerce.
	 *
	 * @var bool
	 */
	private static $is_enable_data_layer_ecommerce;

	/**
	 * Enable or disable data layer user data.
	 *
	 * @var bool
	 */
	private static $is_enable_data_layer_user_data;

	/**
	 * Enable or disable data layer custom event name.
	 *
	 * @var bool
	 */
	private static $is_enable_data_layer_custom_event_name;

	/**
	 * Enable or disable GTM exclude roles.
	 *
	 * @var bool
	 */
	private static $is_enable_gtm_exclude_roles;

	/**
	 * Enable or disable enhanced ad-blocker protection.
	 *
	 * @var bool
	 */
	private static $is_enable_enhanced_adblocker;

	/**
	 * Enable or disable the GA4 measurement recovery fallback.
	 *
	 * @var bool
	 */
	private static $is_enable_ga4_fallback;

	/**
	 * Enable or disable the Data Client transport rescue.
	 *
	 * @var bool
	 */
	private static $is_enable_data_rescue;

	/**
	 * Enable or disable serving the Data Tag sender from the edge.
	 *
	 * @var bool
	 */
	private static $is_enable_edge_sender;

	/**
	 * Get attr option.
	 *
	 * @param string $option The option ID.
	 * @param string $default Default value.
	 *
	 * @return mixed
	 */
	public static function get_option( $option, $default = false ) {
		return get_option( $option, $default );
	}

	/**
	 * Return option container placement
	 *
	 * @return string
	 */
	public static function get_option_container_placement() {
		return self::get_option( GTM_SERVER_SIDE_FIELD_PLACEMENT );
	}

	/**
	 * Return Raw GTM web container ID (Web Google Tag Manager ID).
	 *
	 * @return string
	 */
	public static function get_raw_gtm_container_id() {
		// Trimmed here rather than only on save: an option written outside the
		// settings screen never passes through a sanitize callback, and a
		// stray space ends up inside the loader's "?id=" query.
		return trim( (string) self::get_option( GTM_SERVER_SIDE_FIELD_WEB_CONTAINER_ID ) );
	}

	/**
	 * Return Raw GTM web container url (Server GTM container URL).
	 *
	 * @return string
	 */
	public static function get_raw_gtm_container_url() {
		return self::get_option( GTM_SERVER_SIDE_FIELD_WEB_CONTAINER_URL );
	}

	/**
	 * Return Raw web identifier (Synapse container identifier).
	 *
	 * @return string
	 */
	public static function get_raw_gtm_container_identifier() {
		// Same reasoning as the container id, and it matters more here: this
		// value becomes a file name the edge worker has to match exactly.
		return trim( (string) self::get_option( GTM_SERVER_SIDE_FIELD_WEB_IDENTIFIER ) );
	}

	/**
	 * Return data layer custom event name.
	 *
	 * @return string
	 */
	public static function get_data_layer_custom_event_name() {
		return self::get_option( GTM_SERVER_SIDE_FIELD_DATA_LAYER_CUSTOM_EVENT_NAME );
	}

	/**
	 * Return the Google Click ID restorer backup parameter name.
	 *
	 * Empty when the feature is off. Matches the custom parameter configured in
	 * the Google Ads Final URL suffix (e.g. "backup").
	 *
	 * @return string
	 */
	public static function get_click_id_restorer_google_param() {
		return self::get_option( GTM_SERVER_SIDE_FIELD_CLICK_ID_RESTORER_GOOGLE );
	}

	/**
	 * Return gtm exclude list roles.
	 *
	 * @return array
	 */
	public static function get_gtm_exclude_list_roles() {
		static $cache = null;

		if ( null !== $cache ) {
			return $cache;
		}

		$cache = self::get_option( GTM_SERVER_SIDE_FIELD_GTM_EXCLUDE_LIST_ROLES, array() );
		if ( ! is_array( $cache ) ) {
			$cache = array();
		}

		return $cache;
	}

	/**
	 * Check has gtm container identifier or not.
	 *
	 * @return bool
	 */
	public static function has_gtm_container_identifier() {
		return ! empty( self::get_raw_gtm_container_identifier() );
	}

	/**
	 * Return filtering GTM web container ID (Web Google Tag Manager ID).
	 *
	 * @return string
	 */
	public static function get_gtm_container_id() {
		$container_id = self::get_raw_gtm_container_id();

		if ( ! self::has_gtm_container_identifier() ) {
			return $container_id;
		}

		$container_id = self::get_cache_field(
			GTM_SERVER_SIDE_FIELD_WEB_CONTAINER_ID,
			function() use ( $container_id ) {
				$query_ends = array(
					'cgm=nmB',
					'asq=2',
					'tl=dr',
					'type=' . mb_substr( md5( self::get_raw_gtm_container_identifier() ), 0, 8 ),
					'sort=asc',
					'sort=desc',
				);
				$random_end = array_rand( $query_ends );
				$query_end  = $query_ends[ $random_end ];

				$container_params = array(
					'id=' . $container_id,
				);

				$container_id = sprintf(
					'%s=%s&%s',
					self::generate_random_string( 1, 8 ),
					urlencode( base64_encode( join( '&', $container_params ) ) ), //phpcs:ignore
					$query_end
				);

				return $container_id;
			},
			md5( (string) $container_id . '|' . (string) self::get_raw_gtm_container_identifier() )
		);

		return $container_id;
	}

	/**
	 * Strip the things that silently break a container URL.
	 *
	 * Surrounding whitespace and trailing slashes, nothing else. The value is
	 * a URL the site owner typed and the worker routes on, so this must not
	 * rewrite it beyond the two mistakes that are always mistakes.
	 *
	 * @param  mixed $url Raw url.
	 * @return string
	 */
	public static function normalize_container_url( $url ) {
		$url = trim( (string) $url );

		if ( '' === $url ) {
			return '';
		}

		return rtrim( $url, '/' );
	}

	/**
	 * Return GTM web container url (Server GTM container URL).
	 *
	 * Normalised on the way out, not only on the way in. The admin field saves
	 * a clean value, but an option written by WP-CLI, a migration, an importer
	 * or any other code path is not sanitised by the Settings API - and a
	 * single trailing slash turns the container script into
	 * "https://host/path//name.js". Whether that 404s is up to the worker, so
	 * the failure is invisible in WordPress and total on the site.
	 *
	 * @return string
	 */
	public static function get_gtm_container_url() {
		$url = self::normalize_container_url( self::get_raw_gtm_container_url() );

		if ( empty( $url ) ) {
			return 'https://www.googletagmanager.com';
		}

		return $url;
	}

	/**
	 * Return GTM identifier (Synapse container identifier).
	 *
	 * @return string
	 */
	public static function get_gtm_container_identifier() {
		if ( ! self::has_gtm_container_identifier() ) {
			return 'gtm';
		}

		$identifier = self::get_cache_field(
			GTM_SERVER_SIDE_FIELD_WEB_IDENTIFIER,
			function() {
				$raw_identifier = self::get_raw_gtm_container_identifier();
				$random_string  = self::generate_gtm_container_identifier_prefix( 1, 5 );
				$identifier     = $random_string . $raw_identifier;

				return $identifier;
			},
			md5( (string) self::get_raw_gtm_container_identifier() )
		);

		return $identifier;
	}

	/**
	 * Enable or disable data layer ecommerce.
	 *
	 * @return bool
	 */
	public static function is_enable_data_layer_ecommerce() {
		if ( null === static::$is_enable_data_layer_ecommerce ) {
			static::$is_enable_data_layer_ecommerce = GTM_SERVER_SIDE_FIELD_VALUE_YES === self::get_option( GTM_SERVER_SIDE_FIELD_DATA_LAYER_ECOMMERCE );
		}

		return static::$is_enable_data_layer_ecommerce;
	}

	/**
	 * Enable or disable data layer user data.
	 *
	 * @return bool
	 */
	public static function is_enable_data_layer_user_data() {
		if ( null === static::$is_enable_data_layer_user_data ) {
			static::$is_enable_data_layer_user_data = GTM_SERVER_SIDE_FIELD_VALUE_YES === self::get_option( GTM_SERVER_SIDE_FIELD_DATA_LAYER_USER_DATA );
		}

		return static::$is_enable_data_layer_user_data;
	}

	/**
	 * Enable or disable data layer custom event name.
	 *
	 * @return bool
	 */
	public static function is_enable_data_layer_custom_event_name() {
		if ( null === static::$is_enable_data_layer_custom_event_name ) {
			static::$is_enable_data_layer_custom_event_name = GTM_SERVER_SIDE_FIELD_VALUE_YES === self::get_data_layer_custom_event_name();
		}

		return static::$is_enable_data_layer_custom_event_name;
	}

	/**
	 * Enable or disable GTM exclude roles.
	 *
	 * @return bool
	 */
	public static function is_enable_gtm_exclude_roles() {
		if ( null === static::$is_enable_gtm_exclude_roles ) {
			static::$is_enable_gtm_exclude_roles = GTM_SERVER_SIDE_FIELD_VALUE_YES === self::get_option( GTM_SERVER_SIDE_FIELD_GTM_EXCLUDE_ROLES );
		}

		return static::$is_enable_gtm_exclude_roles;
	}

	/**
	 * Enable or disable enhanced ad-blocker protection.
	 *
	 * Only meaningful when the custom loader is active (a container identifier
	 * is set); the client-side shim rewrites tracking hits so ad blockers can't
	 * pattern-match them, and the edge worker decodes them back.
	 *
	 * @return bool
	 */
	public static function is_enable_enhanced_adblocker() {
		if ( null === static::$is_enable_enhanced_adblocker ) {
			static::$is_enable_enhanced_adblocker = GTM_SERVER_SIDE_FIELD_VALUE_YES === self::get_option( GTM_SERVER_SIDE_FIELD_ENHANCED_ADBLOCKER );
		}

		return static::$is_enable_enhanced_adblocker;
	}

	/**
	 * Enable or disable the GA4 measurement recovery fallback.
	 *
	 * When on (and a GA4 Measurement ID is set), a small watchdog script ships
	 * with the loader: if the Google tag stays silent after the web container
	 * has loaded - which happens in browser privacy modes such as iOS Safari
	 * Private Browsing - the watchdog sends minimal first-party hits (the page
	 * view plus the plugin's data-layer events, ecommerce included) through
	 * the server container so the visit still reaches GA4.
	 *
	 * @return bool
	 */
	public static function is_enable_ga4_fallback() {
		if ( null === static::$is_enable_ga4_fallback ) {
			static::$is_enable_ga4_fallback = GTM_SERVER_SIDE_FIELD_VALUE_YES === self::get_option( GTM_SERVER_SIDE_FIELD_GA4_FALLBACK );
		}

		return static::$is_enable_ga4_fallback;
	}

	/**
	 * Return the sanitized GA4 Measurement ID the recovery fallback sends to.
	 *
	 * @return string Empty string when unset or not "G-..." shaped (feature off).
	 */
	public static function get_ga4_fallback_id() {
		$value = strtoupper( preg_replace( '/[^A-Za-z0-9-]/', '', (string) self::get_option( GTM_SERVER_SIDE_FIELD_GA4_FALLBACK_ID ) ) );

		return ( 0 === strpos( $value, 'G-' ) && strlen( $value ) > 2 ) ? $value : '';
	}

	/**
	 * Enable or disable the Data Client transport rescue.
	 *
	 * When on, a small script ships with the loader that resends Data Tag
	 * deliveries the browser provably blocked in transit (fetch rejection,
	 * beacon refusal, XHR network error) as the Data Client's own GET pixel
	 * form - the transport that passes the same privacy modes that block the
	 * POST bodies (notably Brave with Shields on).
	 *
	 * @return bool
	 */
	public static function is_enable_data_rescue() {
		if ( null === static::$is_enable_data_rescue ) {
			static::$is_enable_data_rescue = GTM_SERVER_SIDE_FIELD_VALUE_YES === self::get_option( GTM_SERVER_SIDE_FIELD_DATA_RESCUE );
		}

		return static::$is_enable_data_rescue;
	}

	/**
	 * Enable or disable serving the Data Tag sender from the edge.
	 *
	 * @return bool
	 */
	public static function is_enable_edge_sender() {
		if ( null === static::$is_enable_edge_sender ) {
			static::$is_enable_edge_sender = GTM_SERVER_SIDE_FIELD_VALUE_YES === self::get_option( GTM_SERVER_SIDE_FIELD_EDGE_SENDER );
		}

		return static::$is_enable_edge_sender;
	}

	/**
	 * URL the edge worker serves the vendored Data Tag sender from.
	 *
	 * Derived from the configured container URL (which carries the /lmr path the
	 * worker routes on) plus the shared file name. Empty when the container URL
	 * has no path prefix to scope the file to - the same guard the shim and the
	 * rescue use - so the plugin never points at an unroutable bare origin.
	 *
	 * Carries a "?v=" content hash so the file can be cached immutably for a
	 * year and still update the instant the plugin does. The worker routes on
	 * the path only, so the query is invisible to routing and needs no worker
	 * change; it changes the cache key and nothing else.
	 *
	 * @return string
	 */
	public static function get_edge_sender_url() {
		$url = rtrim( (string) self::get_gtm_container_url(), '/' );
		if ( '' === $url ) {
			return '';
		}

		$prefix = wp_parse_url( $url, PHP_URL_PATH );
		$prefix = is_string( $prefix ) ? rtrim( $prefix, '/' ) : '';
		if ( '' === $prefix ) {
			return '';
		}

		$file  = 'assets/' . GTM_SERVER_SIDE_EDGE_SENDER_FILE;
		$query = self::get_asset_version_query( $file );

		return $url . '/' . GTM_SERVER_SIDE_EDGE_SENDER_FILE . $query . self::get_asset_base_hint( $query );
	}

	/**
	 * Tells the edge worker which directory this site's plugin assets are in,
	 * as a "&b=" parameter on the sender URL - but only when that directory is
	 * not the one the worker already guesses first.
	 *
	 * The worker cannot know the path: a site may have had the plugin folder
	 * renamed (WordPress appends "-1" on a manual re-upload), moved wp-content,
	 * or installed WordPress in a subdirectory. Without this it would fetch a
	 * path that does not exist, answer 503, and the page would fall back to the
	 * plugin folder - tracking keeps working, but the edge cache stops working
	 * for that site and every page pays failed origin requests for nothing.
	 *
	 * A standard install emits NOTHING, so the common case costs zero bytes in
	 * the page and behaves exactly as it did before this existed. The value is
	 * a site-relative path, so it can only ever point back at this same site.
	 *
	 * @param string $query The version query already on the URL, '' when none.
	 * @return string
	 */
	private static function get_asset_base_hint( $query ) {
		$base = wp_parse_url( GTM_SERVER_SIDE_URL . 'assets/', PHP_URL_PATH );
		if ( ! is_string( $base ) || '' === $base || self::EDGE_SENDER_GUESSED_BASE === $base ) {
			return '';
		}

		// Same shape the worker accepts; anything else it ignores, so emitting
		// it would only add bytes.
		if ( ! preg_match( '#^/(?:[A-Za-z0-9._~%-]+/)+$#', $base ) || false !== strpos( $base, '..' ) ) {
			return '';
		}

		return ( '' === $query ? '?' : '&' ) . 'b=' . rawurlencode( $base );
	}

	/**
	 * Origin URL of the same sender file, served straight from the plugin
	 * folder by the web server.
	 *
	 * Used only as the boot's fallback when the edge copy provably fails to
	 * load (worker error, route removed, CDN incident). It is first-party and
	 * on no filter list, so it is a genuine second chance rather than a
	 * decorative one - the file is byte-identical, only slower and uncached at
	 * the edge.
	 *
	 * Carries EDGE_SENDER_FALLBACK_MARK after the version, so it is never the
	 * address the worker itself fetches (see the constant).
	 *
	 * @return string
	 */
	public static function get_edge_sender_fallback_url() {
		$file = 'assets/' . GTM_SERVER_SIDE_EDGE_SENDER_FILE;
		if ( ! is_readable( GTM_SERVER_SIDE_PATH . $file ) ) {
			return '';
		}

		$query = self::get_asset_version_query( $file );

		return GTM_SERVER_SIDE_URL . $file . $query . ( '' === $query ? '?' : '&' ) . self::EDGE_SENDER_FALLBACK_MARK;
	}

	/**
	 * Origin URL of the tail alone (everything in the sender file except the
	 * vendored core).
	 *
	 * The boot loads this only when it finds a sender that defines
	 * dataTagSendData but never set window.__synTail - i.e. an edge worker
	 * still serving the core-only build from before this version. That makes
	 * the plugin and the worker deployable in either order: an old worker
	 * costs one extra small request, not a silent loss of the seed, the
	 * rescue and the recovery watchdog.
	 *
	 * @return string
	 */
	public static function get_edge_sender_tail_url() {
		$file = 'assets/tail.js';
		if ( ! is_readable( GTM_SERVER_SIDE_PATH . $file ) ) {
			return '';
		}

		return GTM_SERVER_SIDE_URL . $file . self::get_asset_version_query( $file );
	}

	/**
	 * Build a "?v=<hash>" cache-busting query for a plugin asset.
	 *
	 * Content-hashed rather than version-stamped so a hand-patched asset also
	 * busts, and memoized per request because the same file is hashed for
	 * several URLs on one page load. Returns '' when the file is unreadable -
	 * the caller then emits a bare URL, which still works.
	 *
	 * A persistent memo (transient, one week) avoids re-hashing ~67 KB of
	 * assets on every page view. Cache-busting correctness beats the
	 * micro-optimisation, so the stored hash is only ever trusted when the
	 * file's CURRENT mtime AND size both equal the values recorded beside it:
	 * a replaced, upgraded or hand-patched file changes its mtime, misses the
	 * memo, and is re-hashed on the spot. A missing transient, a mismatched or
	 * malformed value, or an unavailable transient API all fall through to
	 * hashing the file directly - byte-identical to the pre-memo behaviour.
	 * A failed hash is never stored, so an error can not stick.
	 *
	 * @param string $rel Path relative to the plugin root, e.g. "assets/s.js".
	 * @return string
	 */
	/**
	 * Version string for an enqueued asset.
	 *
	 * WordPress appends this to the URL as "?ver=", and that is what busts a
	 * browser or CDN cache. Using the plugin version alone means a changed
	 * file behind an unchanged version number keeps serving the old bytes -
	 * which is precisely the situation while a release is being corrected,
	 * and precisely when the change matters. The content hash moves whenever
	 * the file does, so the version number is free to stay where it is.
	 *
	 * Falls back to the plugin version when the file cannot be read, which is
	 * the behaviour this replaces.
	 *
	 * @param  string $rel Path relative to the plugin root.
	 * @return string
	 */
	public static function get_asset_version( $rel ) {
		$query = self::get_asset_version_query( $rel );

		if ( '' === $query ) {
			return get_gtm_server_side_version();
		}

		return get_gtm_server_side_version() . '.' . substr( $query, 3 );
	}

	private static function get_asset_version_query( $rel ) {
		static $cache = array();

		if ( ! isset( $cache[ $rel ] ) ) {
			$cache[ $rel ] = self::build_asset_version_query( $rel );
		}

		return $cache[ $rel ];
	}

	/**
	 * Uncached worker for get_asset_version_query(). See there for the
	 * staleness guarantee.
	 *
	 * @param string $rel Path relative to the plugin root.
	 * @return string
	 */
	private static function build_asset_version_query( $rel ) {
		$path = GTM_SERVER_SIDE_PATH . $rel;
		if ( ! is_readable( $path ) ) {
			return '';
		}

		$mtime = filemtime( $path );
		$size  = filesize( $path );
		$known = false !== $mtime && false !== $size;
		$key   = 'synapse_ct_av_' . md5( $rel );

		if ( $known && function_exists( 'get_transient' ) ) {
			$saved = get_transient( $key );
			if ( is_array( $saved )
				&& isset( $saved['m'], $saved['s'], $saved['q'] )
				&& $saved['m'] === $mtime
				&& $saved['s'] === $size
				&& is_string( $saved['q'] )
				&& 1 === preg_match( '/^\?v=[0-9a-f]{8}$/', $saved['q'] ) ) {
				return $saved['q'];
			}
		}

		$hash = hash_file( 'sha256', $path );
		if ( ! is_string( $hash ) ) {
			return '';
		}

		$query = '?v=' . substr( $hash, 0, 8 );

		if ( $known && function_exists( 'set_transient' ) ) {
			set_transient( $key, array( 'm' => $mtime, 's' => $size, 'q' => $query ), WEEK_IN_SECONDS );
		}

		return $query;
	}

	/**
	 * Check container placement is code or not.
	 *
	 * @return bool
	 */
	public static function is_enable_placement_code() {
		return GTM_SERVER_SIDE_FIELD_PLACEMENT_VALUE_CODE === self::get_option_container_placement();
	}

	/**
	 * Check container placement is GTM Consent or not.
	 *
	 * @return bool
	 */
	public static function is_enable_placement_gtm_consent() {
		return GTM_SERVER_SIDE_FIELD_PLACEMENT_VALUE_GTM_CONSENT === self::get_option_container_placement();
	}

	/**
	 * Set session.
	 *
	 * @param  mixed $name Name.
	 * @param  mixed $value Value.
	 * @return void
	 */
	public static function set_session( $name, $value ) {
		self::set_cookie(
			array(
				'name'     => $name,
				'value'    => $value,
				'secure'   => false,
				'samesite' => '',
			)
		);
	}

	/**
	 * Return session.
	 *
	 * @param  mixed $name Name.
	 * @param  mixed $default Default.
	 * @return mixed
	 */
	public static function get_session( $name, $default = null ) {
		if ( ! isset( $_COOKIE[ $name ] ) ) {
			return $default;
		}

		return filter_input( INPUT_COOKIE, $name, FILTER_DEFAULT );
	}

	/**
	 * Check exists session or not.
	 *
	 * @param  string $name Name.
	 * @param  mixed  $value Value.
	 * @return bool
	 */
	public static function exists_session( $name, $value ) {
		if ( ! isset( $_COOKIE[ $name ] ) ) {
			return false;
		}

		return $_COOKIE[ $name ] === $value;
	}

	/**
	 * Delete session.
	 *
	 * @param  string $name Name.
	 * @return void
	 */
	public static function delete_session( $name ) {
		if ( isset( $_COOKIE[ $name ] ) ) {
			self::delete_cookie( $name );
		}
	}

	/**
	 * Set cookie.
	 *
	 * @param  array $args Parameters.
	 * @return void
	 */
	public static function set_cookie( $args ) {
		$args = wp_parse_args(
			$args,
			self::get_default_cookie_options()
		);

		if ( version_compare( PHP_VERSION, '7.3.0', '>=' ) ) {
			$name  = $args['name'];
			$value = $args['value'];

			unset( $args['name'] );
			unset( $args['value'] );

			setcookie(
				$name,
				$value,
				$args,
			);
		} else {
			setcookie(
				$args['name'],
				$args['value'],
				$args['expires'],
				$args['path'],
				$args['domain'],
				$args['secure'],
				$args['httponly']
			);
		}
	}

	/**
	 * Delete cookie.
	 *
	 * @param  string $name Name.
	 * @return void
	 */
	public static function delete_cookie( $name ) {
		self::set_cookie(
			array(
				'name'    => $name,
				'value'   => '',
				'expires' => -1,
			)
		);
		unset( $_COOKIE[ $name ] );
	}

	/**
	 * Return default cookie options.
	 *
	 * @return array
	 */
	private static function get_default_cookie_options() {
		return array(
			'name'     => '',
			'value'    => '',
			'expires'  => 0,
			'path'     => '/',
			'domain'   => '.' . wp_parse_url( home_url(), PHP_URL_HOST ),
			'secure'   => true,
			'httponly' => false,
			'samesite' => 'lax',
		);
	}

	/**
	 * Delete cookie using javascript.
	 *
	 * @param  string $name Name.
	 * @return void
	 */
	public static function javascript_delete_cookie( $name ) {
		$options = self::get_default_cookie_options();
		?>
			<script>
				document.cookie = '<?php echo esc_attr( $name ); ?>=; max-age=-1; path=<?php echo esc_attr( $options['path'] ); ?>; domain=<?php echo esc_attr( $options['domain'] ); ?>;';
			</script>
		<?php
	}

	/**
	 * Sanitize bool.
	 *
	 * @param  string $value Bool.
	 * @return string
	 */
	public static function sanitize_bool( $value ) {
		return 'yes' === $value ? 'yes' : '';
	}

	/**
	 * Check if GTM plugin is enabled.
	 *
	 * @return bool
	 */
	public static function is_plugin_gtm4wp_enabled() {
		self::include_functions_plugin();

		return is_plugin_active( 'duracelltomi-google-tag-manager/duracelltomi-google-tag-manager-for-wordpress.php' );
	}

	/**
	 * Check if WooCommerce plugin is enabled.
	 *
	 * @return bool
	 */
	public static function is_plugin_wc_enabled() {
		self::include_functions_plugin();

		return is_plugin_active( 'woocommerce/woocommerce.php' );
	}

	/**
	 * Include functions plugin
	 *
	 * @return void
	 */
	private static function include_functions_plugin() {
		if ( ! function_exists( 'get_plugins' ) ) {
			require_once ABSPATH . 'wp-admin/includes/plugin.php';
		}
	}

	/**
	 * Return maybe in json format or not
	 *
	 * @param  mixed $data Data.
	 * @return mixed
	 */
	public static function array_to_json( $data ) {
		return wp_json_encode( $data, JSON_PRETTY_PRINT | JSON_UNESCAPED_UNICODE | JSON_PRESERVE_ZERO_FRACTION );
	}

	/**
	 * Return data layer event name.
	 *
	 * @param  string $event_name Event name.
	 * @return string
	 */
	public static function get_data_layer_event_name( $event_name ) {
		if ( self::is_enable_data_layer_custom_event_name() ) {
			return $event_name . GTM_SERVER_SIDE_DATA_LAYER_CUSTOM_EVENT_NAME;
		}
		return $event_name;
	}

	/**
	 * Return request cookies.
	 *
	 * @return array
	 */
	public static function get_request_cookies() {
		$request_cookies = array(
			'_fbp'                       => filter_input( INPUT_COOKIE, '_fbp', FILTER_DEFAULT ),
			'_fbc'                       => filter_input( INPUT_COOKIE, '_fbc', FILTER_DEFAULT ),
			'FPGCLAW'                    => filter_input( INPUT_COOKIE, 'FPGCLAW', FILTER_DEFAULT ),
			'_gcl_aw'                    => filter_input( INPUT_COOKIE, '_gcl_aw', FILTER_DEFAULT ),
			'ttclid'                     => filter_input( INPUT_COOKIE, 'ttclid', FILTER_DEFAULT ),
			'_dcid'                      => filter_input( INPUT_COOKIE, '_dcid', FILTER_DEFAULT ),
			'FPID'                       => filter_input( INPUT_COOKIE, 'FPID', FILTER_DEFAULT ),
			'FPLC'                       => filter_input( INPUT_COOKIE, 'FPLC', FILTER_DEFAULT ),
			'_ttp'                       => filter_input( INPUT_COOKIE, '_ttp', FILTER_DEFAULT ),
			'FPGCLGB'                    => filter_input( INPUT_COOKIE, 'FPGCLGB', FILTER_DEFAULT ),
			'li_fat_id'                  => filter_input( INPUT_COOKIE, 'li_fat_id', FILTER_DEFAULT ),
			'taboola_cid'                => filter_input( INPUT_COOKIE, 'taboola_cid', FILTER_DEFAULT ),
			'outbrain_cid'               => filter_input( INPUT_COOKIE, 'outbrain_cid', FILTER_DEFAULT ),
			'impact_cid'                 => filter_input( INPUT_COOKIE, 'impact_cid', FILTER_DEFAULT ),
			'_epik'                      => filter_input( INPUT_COOKIE, '_epik', FILTER_DEFAULT ),
			'_scid'                      => filter_input( INPUT_COOKIE, '_scid', FILTER_DEFAULT ),
			'_scclid'                    => filter_input( INPUT_COOKIE, '_scclid', FILTER_DEFAULT ),
			'_uetmsclkid'                => filter_input( INPUT_COOKIE, '_uetmsclkid', FILTER_DEFAULT ),
			'_ga'                        => filter_input( INPUT_COOKIE, '_ga', FILTER_DEFAULT ),
			'euconsent-v2'               => filter_input( INPUT_COOKIE, 'euconsent-v2', FILTER_DEFAULT ),
			'addtl_consent'              => filter_input( INPUT_COOKIE, 'addtl_consent', FILTER_DEFAULT ),
			'usprivacy'                  => filter_input( INPUT_COOKIE, 'usprivacy', FILTER_DEFAULT ),
			'OptanonConsent'             => filter_input( INPUT_COOKIE, 'OptanonConsent', FILTER_DEFAULT ),
			'CookieConsent'              => filter_input( INPUT_COOKIE, 'CookieConsent', FILTER_DEFAULT ),
			'didomi_token'               => filter_input( INPUT_COOKIE, 'didomi_token', FILTER_DEFAULT ),
			'didomi_dcs'                 => filter_input( INPUT_COOKIE, 'didomi_dcs', FILTER_DEFAULT ),
			'axeptio_cookies'            => filter_input( INPUT_COOKIE, 'axeptio_cookies', FILTER_DEFAULT ),
			'axeptio_authorized_vendors' => filter_input( INPUT_COOKIE, 'axeptio_authorized_vendors', FILTER_DEFAULT ),
			'cookieyes-consent'          => filter_input( INPUT_COOKIE, 'cookieyes-consent', FILTER_DEFAULT ),
			'complianz_consent_status'   => filter_input( INPUT_COOKIE, 'complianz_consent_status', FILTER_DEFAULT ),
			'borlabs-cookie'             => filter_input( INPUT_COOKIE, 'borlabs-cookie', FILTER_DEFAULT ),
			'uc_settings'                => filter_input( INPUT_COOKIE, 'uc_settings', FILTER_DEFAULT ),
		);

		if ( ! empty( $_COOKIE ) ) {
			$filtered_cookies = array_filter(
				$_COOKIE,
				function( $key ) {
					if ( preg_match( '/^_ga_.+/', $key ) ) {
						return true;
					}

					if ( 0 === strpos( $key, '_iub_cs-' ) ) {
						return true;
					}

					if ( 0 === strpos( $key, 'cmplz_' ) ) {
						return true;
					}

					return false;
				},
				ARRAY_FILTER_USE_KEY
			);

			$request_cookies = array_merge( $request_cookies, $filtered_cookies );
		}

		$request_cookies = array_filter( $request_cookies );

		return $request_cookies;
	}

	/**
	 * Return generated prefix for GTM container identifier.
	 *
	 * @param  int $min_length Min length.
	 * @param  int $max_length Max length.
	 * @return string
	 */
	public static function generate_gtm_container_identifier_prefix( $min_length, $max_length ) {
		$max_attempts = 1000;

		do {
			$random_string = self::generate_random_string( $min_length, $max_length );
			$valid         = ! preg_match( '/(kp|gt)$/i', $random_string );

			if ( $valid || --$max_attempts <= 0 ) {
				break;
			}
		} while ( true );

		return $random_string;
	}

	/**
	 * Return generated random string.
	 *
	 * @param  int $min_length Min length.
	 * @param  int $max_length Max length.
	 * @return string
	 */
	public static function generate_random_string( $min_length, $max_length ) {
		$characters = '0123456789abcdefghijklmnopqrstuvwxyzABCDEFGHIJKLMNOPQRSTUVWXYZ';
		$length     = wp_rand( $min_length, $max_length );

		$random_string = '';
		for ( $i = 0; $i < $length; $i++ ) {
			$random_string .= $characters[ wp_rand( 0, strlen( $characters ) - 1 ) ];
		}

		return $random_string;
	}

	/**
	 * Return field from cache.
	 *
	 * The cached value is stored together with a fingerprint of the settings it
	 * was generated from, and is only reused while that fingerprint still
	 * matches. Invalidation used to depend entirely on update_option_ hooks
	 * that are registered inside the admin class, so anything that changed a
	 * setting without going through wp-admin - WP-CLI, a migration, an
	 * importer, delete_option followed by add_option - left the site serving
	 * the previous disguised file name for up to a year, with no way to tell
	 * from the settings screen.
	 *
	 * A value written by an older version is a bare string and does not match
	 * the stored shape, so it is regenerated once and then behaves.
	 *
	 * @param  string   $key         Cache key.
	 * @param  callable $callback    Callback.
	 * @param  string   $fingerprint Inputs the generated value depends on.
	 * @return string
	 */
	public static function get_cache_field( $key, $callback, $fingerprint = '' ) {
		$key   = $key . '__generated';
		$cache = get_transient( $key );

		if ( is_array( $cache ) && isset( $cache['f'], $cache['v'] ) && $cache['f'] === $fingerprint ) {
			return $cache['v'];
		}

		$value = call_user_func( $callback );
		set_transient( $key, array( 'f' => $fingerprint, 'v' => $value ), YEAR_IN_SECONDS );

		return $value;
	}

	/**
	 * Delete field from cahce.
	 *
	 * @param  string $key Cache key.
	 * @return void
	 */
	public static function delete_cache_field( $key ) {
		delete_transient( $key . '__generated' );
	}
}
