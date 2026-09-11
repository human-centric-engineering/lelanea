/**
 * A route logger for the waitlist admin surface, with the request URL left off.
 *
 * Shared by both reads:
 * - GET /api/v1/admin/app/waitlist
 * - GET /api/v1/admin/app/waitlist/export
 *
 * ## The finding this exists for
 *
 * Both routes are careful to log `searched: true` rather than the search term,
 * because the first thing anyone types into that box is somebody's email address
 * and a log is a copy of personal data outside the table the Art. 15 export and
 * the Art. 17 erasure know how to reach.
 *
 * The care was defeated one layer down. `getRouteLogger` binds
 * `getFullContext(request)` to every line the logger emits, and that context
 * carries `url: request.url` — **the complete URL, query string included**
 * (`lib/logging/context.ts`). The sanitiser redacts by KEY name against
 * `PII_FIELDS`, which lists `email` and does not list `url`, so the admin's own
 * `email` context field is replaced with `[PII REDACTED]` in production while
 * the sibling `url: '…/waitlist?q=someone%40example.com'` is written out beside
 * it — to stdout, and into the ring buffer `GET /api/v1/admin/logs` serves and
 * greps. The client table debounces, so one lookup emits the address once.
 *
 * Dropping `url` costs nothing operationally: `endpoint` is the same URL with
 * the query string stripped (`getEndpointPath`), and `method` is unchanged. What
 * is lost is a duplicate of the path plus the half nothing should keep.
 *
 * ## Why it is fixed here and not in the platform
 *
 * `lib/logging/context.ts` and `lib/api/context.ts` are Sunrise-owned and their
 * blobs are identical in all three tiers, so an edit there is a divergence row
 * we would carry and re-resolve on every sync. The gap is already open upstream
 * as [`sunrise#685`](https://github.com/human-centric-engineering/sunrise/issues/685)
 * — filed for a credential in a route PATH; the query-string half is the same
 * mechanism, and this module's case is recorded there.
 *
 * **This is narrow by design.** It fixes the two routes that knowingly take a
 * personal-data search term. Every other route in the app still logs its full
 * URL, which is the platform's behaviour to change, not ours to patch route by
 * route.
 *
 * In `_shared/` rather than in `lib/app/`, following
 * `app/api/v1/admin/orchestration/workflows/[id]/_shared/`: it reaches
 * `next/headers` through `@/lib/logging/context`, and framework glue belongs in
 * the route tree rather than in the portable `lib/app/**` surface.
 */

import type { Logger } from '@/lib/logging';
import { logger } from '@/lib/logging';
import { getEndpointPath, getFullContext } from '@/lib/logging/context';

export async function getWaitlistRouteLogger(request: Request): Promise<Logger> {
  // Destructured out rather than overwritten with `undefined`: `withContext`
  // spreads, so an explicit `url: undefined` would leave the key in the context
  // object and rely on `JSON.stringify` dropping it on the way out — true today
  // for the production formatter and not a property worth depending on.
  const { url: _url, ...context } = await getFullContext(request);

  return logger.withContext({ ...context, endpoint: getEndpointPath(request) });
}
