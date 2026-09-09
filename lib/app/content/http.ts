/**
 * HTTP constants for the authored-content routes.
 *
 * Separate from `lib/app/content/index.ts` so the route handlers can import a
 * cache directive without pulling the parsed content graph in with it.
 */

/**
 * `Cache-Control` for the unauthenticated content endpoints.
 *
 * Overrides the platform default (`private, no-cache` — see
 * `DEFAULT_CACHE_CONTROL` in `lib/api/responses.ts`, and #487 for why that
 * default is private). These three payloads are identical for every caller and
 * change only on deploy, which is exactly the case that default carves out.
 *
 * `max-age=0, must-revalidate` rather than a real TTL: the ETag makes
 * revalidation cheap (304, empty body), and a TTL would mean a corrected legal
 * document sitting stale in a CDN for its duration. Freshness over transfer —
 * these are the Terms of Use.
 */
export const PUBLIC_CONTENT_CACHE_CONTROL = 'public, max-age=0, must-revalidate';
