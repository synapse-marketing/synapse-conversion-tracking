<?php
/**
 * Self-update through WordPress's own update system.
 *
 * @package    GTM_Server_Side
 * @subpackage GTM_Server_Side/includes
 * @since      2.0.0
 */

defined( 'ABSPATH' ) || exit;

/**
 * Self-update through WordPress's own update system.
 *
 * WordPress only updates plugins it can ask about. For plugins that are not
 * on wordpress.org it offers, since 5.8, the "Update URI" plugin header: core
 * takes the hostname from it and, on every update check it already performs,
 * runs the filter "update_plugins_{hostname}" for that plugin. Whatever the
 * filter returns with a newer version is listed under Plugins and Dashboard >
 * Updates and installed from its "package" URL through the ordinary one-click
 * or automatic update flow. No library, no second mechanism.
 *
 * This class answers that filter by fetching a small JSON manifest from the
 * Update URI itself, so the address lives exactly once, in the plugin header.
 * Nothing else is contacted and nothing is sent that core does not send
 * anyway. Every failure is silent by design: an unreachable manifest, bad
 * JSON, a package on another host or over plain HTTP, or anything else
 * unexpected simply means "no update available", never an error on the site.
 */
class GTM_Server_Side_Plugin_Update {
	use GTM_Server_Side_Singleton;

	const SLUG      = 'synapse-conversion-tracking';
	const TRANSIENT = 'synapse_ct_update_manifest';
	const TTL       = 6 * HOUR_IN_SECONDS;
	const RETRY     = HOUR_IN_SECONDS;

	/**
	 * Ed25519 public key of the release signing key, raw 32 bytes, base64.
	 *
	 * The private half lives on the release machine only. Every package is
	 * signed there over "sha256(zip)\n<version>" (dev-tools/sign-release.mjs)
	 * and nothing is installed here that does not verify against this key,
	 * whatever the manifest says and whoever serves it. Binding the version
	 * into the signed message means an old, genuinely signed zip cannot be
	 * re-labelled as a newer version by a hostile host.
	 */
	const PUBLIC_KEY = 'GRuGzVdywPtC1a4Ws/2YcPdJwNsjJzbWiuJbIHPVvGo=';

	/**
	 * Init.
	 *
	 * @return void
	 */
	public function init() {
		$host = wp_parse_url( self::update_uri(), PHP_URL_HOST );
		if ( ! is_string( $host ) || '' === $host ) {
			return;
		}

		add_filter( 'update_plugins_' . $host, array( $this, 'check' ), 10, 4 );
		add_filter( 'plugins_api', array( $this, 'details' ), 10, 3 );
		add_filter( 'upgrader_pre_download', array( $this, 'verify_download' ), 10, 4 );
		add_action( 'upgrader_process_complete', array( $this, 'forget' ), 10, 2 );
		add_action( 'load-update-core.php', array( $this, 'forget' ) );
	}

	/**
	 * Answer WordPress's update check for this plugin.
	 *
	 * @param  false|array $update      What core has so far, always false.
	 * @param  array       $plugin_data Header data of the installed plugin.
	 * @param  string      $plugin_file Plugin basename.
	 * @param  string[]    $locales     Site locales.
	 * @return false|array
	 */
	public function check( $update, $plugin_data, $plugin_file, $locales ) {
		if ( self::basename() !== $plugin_file ) {
			return $update;
		}

		$m = $this->manifest();
		if ( ! $m ) {
			return $update;
		}

		return array(
			'id'           => isset( $plugin_data['UpdateURI'] ) ? $plugin_data['UpdateURI'] : self::update_uri(),
			'slug'         => self::SLUG,
			'plugin'       => $plugin_file,
			'version'      => $m['version'],
			'new_version'  => $m['version'],
			'url'          => isset( $m['homepage'] ) ? esc_url_raw( $m['homepage'] ) : '',
			'package'      => $m['package'],
			'requires'     => isset( $m['requires'] ) ? (string) $m['requires'] : '',
			'tested'       => isset( $m['tested'] ) ? (string) $m['tested'] : '',
			'requires_php' => isset( $m['requires_php'] ) ? (string) $m['requires_php'] : '',
			'icons'        => array(),
			'banners'      => array(),
			'banners_rtl'  => array(),
		);
	}

	/**
	 * Fill the "View version details" window from the same manifest.
	 *
	 * @param  false|object|array $result Result so far.
	 * @param  string             $action API action.
	 * @param  object             $args   Arguments.
	 * @return false|object|array
	 */
	public function details( $result, $action, $args ) {
		if ( 'plugin_information' !== $action || ! isset( $args->slug ) || self::SLUG !== $args->slug ) {
			return $result;
		}

		$m = $this->manifest();
		if ( ! $m ) {
			return $result;
		}

		$sections = array();
		if ( isset( $m['sections'] ) && is_array( $m['sections'] ) ) {
			foreach ( $m['sections'] as $key => $html ) {
				$sections[ sanitize_key( $key ) ] = wp_kses_post( (string) $html );
			}
		}

		return (object) array(
			'name'          => 'Synapse Conversion Tracking',
			'slug'          => self::SLUG,
			'version'       => $m['version'],
			'author'        => 'Synapse',
			'homepage'      => isset( $m['homepage'] ) ? esc_url_raw( $m['homepage'] ) : '',
			'requires'      => isset( $m['requires'] ) ? (string) $m['requires'] : '',
			'tested'        => isset( $m['tested'] ) ? (string) $m['tested'] : '',
			'requires_php'  => isset( $m['requires_php'] ) ? (string) $m['requires_php'] : '',
			'last_updated'  => isset( $m['last_updated'] ) ? (string) $m['last_updated'] : '',
			'download_link' => $m['package'],
			'sections'      => $sections,
		);
	}

	/**
	 * Download our package ourselves and refuse it unless the signature holds.
	 *
	 * WordPress verifies nothing about packages that do not come from
	 * wordpress.org. This hook runs before the upgrader downloads; returning a
	 * file path makes it use that file, returning a WP_Error stops the update
	 * with that message. Only our own package URL is touched, every other
	 * plugin's update passes through untouched.
	 *
	 * Fails closed on purpose: no sodium, no signature, a signature that does
	 * not verify, or a hash that does not match all end with nothing
	 * installed. A silent fallback to "install it anyway" would make the
	 * signature decorative.
	 *
	 * @param  false|string|WP_Error $reply      What an earlier filter decided.
	 * @param  string                $package    Package URL.
	 * @param  WP_Upgrader           $upgrader   Upgrader instance.
	 * @param  array                 $hook_extra Extra arguments.
	 * @return false|string|WP_Error
	 */
	public function verify_download( $reply, $package, $upgrader, $hook_extra = array() ) {
		if ( false !== $reply ) {
			return $reply;
		}

		$m = $this->manifest();
		if ( ! $m || ! isset( $m['package'] ) || (string) $package !== (string) $m['package'] ) {
			return $reply;
		}

		if ( ! function_exists( 'sodium_crypto_sign_verify_detached' ) ) {
			return new WP_Error( 'synapse_ct_no_sodium', __( 'Synapse Conversion Tracking: this update is signed and PHP has no sodium extension to verify it with. Nothing was installed.', 'gtm-server-side' ) );
		}
		if ( empty( $m['signature'] ) || ! is_string( $m['signature'] ) ) {
			return new WP_Error( 'synapse_ct_unsigned', __( 'Synapse Conversion Tracking: the update manifest carries no signature. Nothing was installed.', 'gtm-server-side' ) );
		}

		if ( ! function_exists( 'download_url' ) ) {
			require_once ABSPATH . 'wp-admin/includes/file.php';
		}

		$tmp = download_url( $package, 60 );
		if ( is_wp_error( $tmp ) ) {
			return $tmp;
		}

		$hash = hash_file( 'sha256', $tmp );
		$sig  = base64_decode( $m['signature'], true );
		$key  = base64_decode( self::PUBLIC_KEY, true );
		$ok   = is_string( $hash )
			&& false !== $sig && 64 === strlen( $sig )
			&& false !== $key && 32 === strlen( $key )
			&& sodium_crypto_sign_verify_detached( $sig, $hash . "\n" . (string) $m['version'], $key );

		if ( ! $ok ) {
			@unlink( $tmp ); // phpcs:ignore WordPress.PHP.NoSilencedErrors.Discouraged
			return new WP_Error( 'synapse_ct_bad_signature', __( 'Synapse Conversion Tracking: the downloaded package did not match its signature. Nothing was installed.', 'gtm-server-side' ) );
		}

		return $tmp;
	}

	/**
	 * Drop the cached manifest, so the next check is a real one.
	 *
	 * Runs after any plugin update (the argument shape core passes) and when
	 * the operator opens Dashboard > Updates (no arguments).
	 *
	 * @return void
	 */
	public function forget() {
		delete_transient( self::TRANSIENT );
	}

	/**
	 * The manifest, fetched at most once per TTL.
	 *
	 * A failed fetch is remembered for a shorter while so an outage of the
	 * update host does not turn into a request on every page load.
	 *
	 * @return array|null
	 */
	private function manifest() {
		$cached = get_transient( self::TRANSIENT );
		if ( is_array( $cached ) ) {
			return $cached ? $cached : null;
		}

		$uri = self::update_uri();
		$m   = null;

		if ( '' !== $uri ) {
			$res = wp_remote_get(
				$uri,
				array(
					'timeout' => 8,
					'headers' => array( 'Accept' => 'application/json' ),
				)
			);

			if ( ! is_wp_error( $res ) && 200 === (int) wp_remote_retrieve_response_code( $res ) ) {
				$json = json_decode( wp_remote_retrieve_body( $res ), true );
				if ( self::valid( $json, $uri ) ) {
					$m = $json;
				}
			}
		}

		set_transient( self::TRANSIENT, $m ? $m : array(), $m ? self::TTL : self::RETRY );

		return $m;
	}

	/**
	 * Only a manifest that names a version and a package on our own host, over
	 * HTTPS, is believed. Anything else is treated as "no update".
	 *
	 * @param  mixed  $m   Decoded manifest.
	 * @param  string $uri The Update URI it came from.
	 * @return bool
	 */
	private static function valid( $m, $uri ) {
		if ( ! is_array( $m ) || empty( $m['version'] ) || empty( $m['package'] ) ) {
			return false;
		}
		if ( ! preg_match( '/^\d+\.\d+\.\d+/', (string) $m['version'] ) ) {
			return false;
		}
		if ( isset( $m['slug'] ) && self::SLUG !== $m['slug'] ) {
			return false;
		}

		$pkg = wp_parse_url( (string) $m['package'] );
		$src = wp_parse_url( $uri );
		if ( ! is_array( $pkg ) || ! is_array( $src ) ) {
			return false;
		}
		if ( ! isset( $pkg['scheme'], $pkg['host'], $src['host'] ) || 'https' !== strtolower( $pkg['scheme'] ) ) {
			return false;
		}

		return strtolower( $pkg['host'] ) === strtolower( $src['host'] );
	}

	/**
	 * The Update URI, read from the plugin header so it lives in one place.
	 *
	 * @return string
	 */
	private static function update_uri() {
		static $uri;

		if ( null === $uri ) {
			$data = get_file_data( GTM_SERVER_SIDE_PATH . 'synapse-conversion-tracking.php', array( 'uri' => 'Update URI' ), false );
			$uri  = isset( $data['uri'] ) ? esc_url_raw( trim( $data['uri'] ) ) : '';
			if ( 0 !== strpos( $uri, 'https://' ) ) {
				$uri = '';
			}
		}

		return $uri;
	}

	/**
	 * Plugin basename, e.g. "synapse-conversion-tracking/synapse-conversion-tracking.php".
	 *
	 * @return string
	 */
	private static function basename() {
		return plugin_basename( GTM_SERVER_SIDE_PATH . 'synapse-conversion-tracking.php' );
	}
}
