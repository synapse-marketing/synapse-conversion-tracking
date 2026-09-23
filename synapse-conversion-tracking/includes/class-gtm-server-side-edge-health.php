<?php
/**
 * Edge sender health check.
 *
 * @package    GTM_Server_Side
 * @subpackage GTM_Server_Side/includes
 * @since      2.0.1
 */

defined( 'ABSPATH' ) || exit;

/**
 * Checks that the edge worker really serves the Data Tag sender.
 *
 * Why this exists (2026-09-23): on a live site the edge copy failed for a day
 * before anyone noticed. The worker could not fetch the sender from the site
 * (the site refused the worker's own request), kept that refusal, and every
 * page fell back to the Data Tag's own injection, which ad blockers can stop. Tracking
 * kept working, so nothing looked wrong. This check makes that state visible:
 * once a day by WP-Cron, whenever Site Health is opened, and a notice on the
 * Dashboard, Plugins and the settings page while the edge copy is failing.
 *
 * It asks the same addresses a browser would, through the site's public name,
 * so the answer comes back through Cloudflare and the worker. An answer that
 * did not (no cf-ray header: a host that resolves its own domain locally and
 * reaches the origin, where the worker's path does not exist), or a Cloudflare
 * challenge, is reported as "could not check", never as a failure.
 */
class GTM_Server_Side_Edge_Health {
	use GTM_Server_Side_Singleton;

	/**
	 * WP-Cron hook of the daily check.
	 *
	 * @var string
	 */
	const CRON_HOOK = 'synapse_ct_edge_health';

	/**
	 * Option holding the last result (not autoloaded).
	 *
	 * @var string
	 */
	const OPTION = 'synapse_ct_edge_health';

	/**
	 * A string only the sender contains, the same one the worker looks for.
	 *
	 * @var string
	 */
	const PROOF = 'function dataTagSendData(';

	/**
	 * Init.
	 *
	 * @return void
	 */
	public function init() {
		add_action( self::CRON_HOOK, array( $this, 'run' ) );
		add_action( 'init', array( $this, 'schedule' ) );
		add_action( 'upgrader_process_complete', array( $this, 'after_upgrade' ), 10, 2 );
		add_filter( 'site_status_tests', array( $this, 'site_status_tests' ) );
		add_action( 'admin_notices', array( $this, 'admin_notice' ) );
	}

	/**
	 * Whether the page loads the sender from the edge at all. The same three
	 * conditions the tracking code uses before it emits the edge boot.
	 *
	 * @return bool
	 */
	public static function is_active() {
		return GTM_Server_Side_Helpers::is_enable_data_rescue()
			&& GTM_Server_Side_Helpers::is_enable_edge_sender()
			&& '' !== GTM_Server_Side_Helpers::get_edge_sender_url();
	}

	/**
	 * Keep the daily check scheduled while the edge sender is on, and gone
	 * while it is off. Only in admin and cron requests, never on a page view.
	 *
	 * @return void
	 */
	public function schedule() {
		if ( ! is_admin() && ! wp_doing_cron() ) {
			return;
		}

		$active = self::is_active();
		$next   = wp_next_scheduled( self::CRON_HOOK );

		if ( $active && ! $next ) {
			// The first run comes soon, so a fresh install or update is checked
			// within minutes rather than a day later.
			wp_schedule_event( time() + 2 * MINUTE_IN_SECONDS, 'daily', self::CRON_HOOK );
		} elseif ( ! $active && $next ) {
			wp_clear_scheduled_hook( self::CRON_HOOK );
			delete_option( self::OPTION );
		}
	}

	/**
	 * After this plugin is updated, check again within a couple of minutes.
	 * The new file hash means a new address the worker has never fetched.
	 *
	 * @param WP_Upgrader $upgrader Upgrader instance (unused).
	 * @param array       $extra    Details of the finished upgrade.
	 * @return void
	 */
	public function after_upgrade( $upgrader, $extra ) {
		if ( ! is_array( $extra ) || ! isset( $extra['type'] ) || 'plugin' !== $extra['type'] ) {
			return;
		}

		$plugins = array();
		if ( isset( $extra['plugins'] ) ) {
			$plugins = (array) $extra['plugins'];
		} elseif ( isset( $extra['plugin'] ) ) {
			$plugins = array( $extra['plugin'] );
		}

		foreach ( $plugins as $plugin ) {
			if ( false !== strpos( (string) $plugin, 'synapse-conversion-tracking.php' ) ) {
				wp_schedule_single_event( time() + 2 * MINUTE_IN_SECONDS, self::CRON_HOOK );
				return;
			}
		}
	}

	/**
	 * Run the check and keep the result.
	 *
	 * @return array
	 */
	public function run() {
		$result = self::check();
		update_option( self::OPTION, $result, false );

		return $result;
	}

	/**
	 * The check itself.
	 *
	 * Status: "ok" (edge and fallback both serve the right file), "warn" (the
	 * edge works, the fallback copy does not), "fail" (the edge answered through
	 * Cloudflare with something that is not this site's sender), "unknown" (the
	 * check could not see through Cloudflare), "off" (edge sender not in use).
	 *
	 * @return array
	 */
	public static function check() {
		$now = time();

		if ( ! self::is_active() ) {
			return array(
				'status' => 'off',
				'time'   => $now,
			);
		}

		$url  = GTM_Server_Side_Helpers::get_edge_sender_url();
		$want = '';
		$qs   = wp_parse_url( $url, PHP_URL_QUERY );
		if ( is_string( $qs ) ) {
			parse_str( $qs, $args );
			if ( isset( $args['v'] ) && is_string( $args['v'] ) && preg_match( '/^[0-9a-f]{8}$/', $args['v'] ) ) {
				$want = $args['v'];
			}
		}

		$edge     = self::probe( $url, $want );
		$fallback = self::probe( GTM_Server_Side_Helpers::get_edge_sender_fallback_url(), $want );

		if ( 'ok' === $edge['state'] ) {
			$status = 'ok' === $fallback['state'] ? 'ok' : 'warn';
		} elseif ( 'unknown' === $edge['state'] ) {
			$status = 'unknown';
		} else {
			$status = 'fail';
		}

		return array(
			'status'   => $status,
			'time'     => $now,
			'url'      => $url,
			'edge'     => $edge,
			'fallback' => $fallback,
		);
	}

	/**
	 * One request, made the way a browser makes it.
	 *
	 * @param string $url  Address to ask.
	 * @param string $want Expected 8-hex sha256 prefix, '' when unversioned.
	 * @return array
	 */
	private static function probe( $url, $want ) {
		if ( '' === (string) $url ) {
			return array(
				'state'  => 'unknown',
				'detail' => 'no address to check',
			);
		}

		$response = wp_remote_get(
			$url,
			array(
				'timeout'     => 5,
				'redirection' => 3,
				'headers'     => array(
					'Accept'        => '*/*',
					'Cache-Control' => 'no-cache',
				),
				'user-agent'  => 'Mozilla/5.0 (compatible; SynapseConversionTracking/' . get_gtm_server_side_version() . ')',
			)
		);

		if ( is_wp_error( $response ) ) {
			return array(
				'state'  => 'unknown',
				'detail' => 'the request did not complete: ' . $response->get_error_message(),
			);
		}

		$code      = (int) wp_remote_retrieve_response_code( $response );
		$body      = (string) wp_remote_retrieve_body( $response );
		$ray       = self::response_header( $response, 'cf-ray' );
		$mitigated = self::response_header( $response, 'cf-mitigated' );

		if ( '' !== $mitigated ) {
			return array(
				'state'  => 'unknown',
				'code'   => $code,
				'detail' => 'Cloudflare answered with a challenge (' . $mitigated . '), so the file could not be seen',
			);
		}

		$is_sender = 200 === $code && false !== strpos( $body, self::PROOF );
		$matches   = $is_sender && ( '' === $want || substr( hash( 'sha256', $body ), 0, 8 ) === $want );

		if ( $matches ) {
			return array(
				'state' => 'ok',
				'code'  => $code,
			);
		}

		if ( '' === $ray ) {
			return array(
				'state'  => 'unknown',
				'code'   => $code,
				'detail' => 'the answer did not come through Cloudflare (HTTP ' . $code . ')',
			);
		}

		if ( $is_sender ) {
			$detail = 'the file is the sender, but not the version this site asks for';
		} elseif ( 200 === $code ) {
			$detail = 'HTTP 200, but the answer is not the sender';
		} else {
			$detail = 'HTTP ' . $code;
			$text   = self::snippet( $body );
			if ( '' !== $text ) {
				$detail .= ': ' . $text;
			}
		}

		return array(
			'state'  => 'fail',
			'code'   => $code,
			'detail' => $detail,
		);
	}

	/**
	 * A response header as one string.
	 *
	 * @param array  $response wp_remote_get() response.
	 * @param string $name     Header name.
	 * @return string
	 */
	private static function response_header( $response, $name ) {
		$value = wp_remote_retrieve_header( $response, $name );
		if ( is_array( $value ) ) {
			$value = reset( $value );
		}

		return is_string( $value ) ? trim( $value ) : '';
	}

	/**
	 * The start of an error body, as plain text.
	 *
	 * @param string $body Response body.
	 * @return string
	 */
	private static function snippet( $body ) {
		$text = trim( (string) preg_replace( '/\s+/', ' ', wp_strip_all_tags( $body ) ) );

		return strlen( $text ) > 120 ? substr( $text, 0, 117 ) . '...' : $text;
	}

	/**
	 * Register the Site Health test while the edge sender is in use.
	 *
	 * @param array $tests Site Health tests.
	 * @return array
	 */
	public function site_status_tests( $tests ) {
		if ( ! is_array( $tests ) || ! self::is_active() ) {
			return $tests;
		}

		$tests['direct']['synapse_ct_edge_sender'] = array(
			'label' => __( 'Synapse edge-served sender', 'gtm-server-side' ),
			'test'  => array( $this, 'site_health_test' ),
		);

		return $tests;
	}

	/**
	 * Site Health: a fresh check every time the page is opened.
	 *
	 * @return array
	 */
	public function site_health_test() {
		$r = $this->run();

		$result = array(
			'label'       => '',
			'status'      => 'good',
			'badge'       => array(
				'label' => __( 'Synapse Conversion Tracking', 'gtm-server-side' ),
				'color' => 'blue',
			),
			'description' => '',
			'actions'     => '',
			'test'        => 'synapse_ct_edge_sender',
		);

		$url       = isset( $r['url'] ) ? (string) $r['url'] : '';
		$edge      = isset( $r['edge']['detail'] ) ? (string) $r['edge']['detail'] : '';
		$fallback  = isset( $r['fallback']['detail'] ) ? (string) $r['fallback']['detail'] : '';
		$fallback  = '' !== $fallback ? $fallback : ( isset( $r['fallback']['code'] ) ? 'HTTP ' . (int) $r['fallback']['code'] : '' );
		$where     = '<p><code>' . esc_html( $url ) . '</code></p>';
		$still_ok  = __( 'Tracking still runs, but through the fallback copy in the plugin folder, and ad blockers can stop that one.', 'gtm-server-side' );
		$advice    = __( 'Check that the worker route covers this address, and that the site lets the worker fetch the .js files in the plugin\'s assets folder: a firewall, a security plugin or an origin lock that refuses the worker has exactly this effect.', 'gtm-server-side' );

		switch ( isset( $r['status'] ) ? $r['status'] : '' ) {
			case 'ok':
				$result['label']       = __( 'The edge worker serves the tracking sender', 'gtm-server-side' );
				$result['description'] = '<p>' . esc_html__( 'The address below answers with the sender this site expects, and so does the fallback copy.', 'gtm-server-side' ) . '</p>' . $where;
				break;

			case 'warn':
				$result['status']      = 'recommended';
				$result['label']       = __( 'The edge sender works, its fallback copy does not', 'gtm-server-side' );
				$result['description'] = '<p>' . esc_html__( 'Nothing is lost while the edge copy works. If it ever fails, the page has no second copy to fall back to.', 'gtm-server-side' ) . '</p><p>' . esc_html( $fallback ) . '</p>';
				break;

			case 'unknown':
				$result['status']      = 'recommended';
				$result['label']       = __( 'The edge sender could not be checked', 'gtm-server-side' );
				$result['description'] = '<p>' . esc_html( $edge ) . '</p>' . $where . '<p>' . esc_html__( 'Open the address in a browser: it should show JavaScript, not an error page.', 'gtm-server-side' ) . '</p>';
				break;

			default:
				$result['status']      = 'critical';
				$result['label']       = __( 'The edge worker does not serve the tracking sender', 'gtm-server-side' );
				$result['description'] = '<p>' . esc_html( $edge ) . '</p>' . $where . '<p>' . esc_html( $still_ok ) . '</p><p>' . esc_html( $advice ) . '</p>';
				break;
		}

		return $result;
	}

	/**
	 * Notice while the last check failed: Dashboard, Plugins, settings page.
	 *
	 * @return void
	 */
	public function admin_notice() {
		if ( ! current_user_can( 'manage_options' ) || ! function_exists( 'get_current_screen' ) ) {
			return;
		}

		$screen = get_current_screen();
		$id     = $screen ? $screen->id : '';
		if ( ! in_array( $id, array( 'dashboard', 'plugins', 'settings_page_' . GTM_SERVER_SIDE_ADMIN_SLUG ), true ) ) {
			return;
		}

		$r = get_option( self::OPTION );
		if ( ! is_array( $r ) || ! isset( $r['status'] ) || 'fail' !== $r['status'] || ! self::is_active() ) {
			return;
		}

		$detail = isset( $r['edge']['detail'] ) ? (string) $r['edge']['detail'] : '';
		$when   = isset( $r['time'] ) ? human_time_diff( (int) $r['time'] ) : '';

		printf(
			'<div class="notice notice-error"><p><strong>%1$s</strong> %2$s</p><p><code>%3$s</code></p><p>%4$s <a href="%5$s">%6$s</a></p></div>',
			esc_html__( 'Synapse Conversion Tracking:', 'gtm-server-side' ),
			esc_html(
				sprintf(
					/* translators: %s: what the edge address answered */
					__( 'the edge worker does not serve the tracking sender (%s). Tracking still runs, but through the fallback copy, and ad blockers can stop that one.', 'gtm-server-side' ),
					$detail
				)
			),
			esc_html( isset( $r['url'] ) ? (string) $r['url'] : '' ),
			esc_html(
				sprintf(
					/* translators: %s: how long ago, e.g. "3 hours" */
					__( 'Last checked %s ago.', 'gtm-server-side' ),
					$when
				)
			),
			esc_url( admin_url( 'site-health.php' ) ),
			esc_html__( 'Check again in Site Health', 'gtm-server-side' )
		);
	}
}
