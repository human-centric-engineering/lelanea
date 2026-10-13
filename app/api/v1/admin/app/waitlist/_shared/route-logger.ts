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
 * The care was defeated one layer down. `getRouteLogger` bound
 * `getFullContext(request)` to every line the logger emitted, and that context
 * carried `url: request.url` — **the complete URL, query string included**
 * (`lib/logging/context.ts`). The sanitiser redacts by KEY name against
 * `PII_FIELDS`, which lists `email` and does not list `url`, so the admin's own
 * `email` context field was replaced with `[PII REDACTED]` in production while
 * the sibling `url: '…/waitlist?q=someone%40example.com'` was written out beside
 * it — to stdout, and into the ring buffer `GET /api/v1/admin/logs` serves and
 * greps. The client table debounces, so one lookup emitted the address once.
 *
 * Dropping `url` cost nothing operationally: `endpoint` is the same URL with
 * the query string stripped (`getEndpointPath`), and `method` is unchanged. What
 * is lost is a duplicate of the path plus the half nothing should keep.
 *
 * ## Fixed in the platform since Sunrise 0.14.0
 *
 * [`sunrise#685`](https://github.com/human-centric-engineering/sunrise/issues/685)
 * shipped with Daybreak 0.7.0: the request context no longer carries `url`, and
 * `getRouteLogger` binds the query-free `endpoint` only. This wrapper used to
 * destructure `url` out itself; it now delegates. It stays, rather than eleven
 * call sites moving to core, because its test pins the privacy property for this
 * surface — a search term never reaches a log line — against the platform
 * regressing it.
 *
 * In `_shared/` rather than in `lib/app/`, following
 * `app/api/v1/admin/orchestration/workflows/[id]/_shared/`: it reaches
 * `next/headers` through `@/lib/logging/context`, and framework glue belongs in
 * the route tree rather than in the portable `lib/app/**` surface.
 */

import type { Logger } from '@/lib/logging';
import { getRouteLogger } from '@/lib/api/context';

export async function getWaitlistRouteLogger(request: Request): Promise<Logger> {
  return getRouteLogger(request);
}
