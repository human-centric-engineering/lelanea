/**
 * Waitlist — the CSV export (Admin)
 *
 * GET /api/v1/admin/app/waitlist/export
 *
 * Authentication: admin, as for the list beside it.
 *
 * Query parameters:
 *   - q               optional; the same search the list applies
 *   - includeRemoved  default false; the same filter the list applies
 *
 * Both mirror the list so the file matches what the admin is looking at rather
 * than something else — including the removed entries when, and only when, they
 * are on screen.
 *
 * Answers a `text/csv` attachment. Capped at `WAITLIST_EXPORT_MAX_ROWS`, newest
 * first, with the cap named in the filename when it bites.
 *
 * ## Its own route rather than `?format=csv` on the list
 *
 * Both shapes exist in the platform (`approvals/history` takes the query
 * parameter, `conversations/export` takes the separate route). The deciding
 * difference is that taking away a file of other people's email addresses and
 * stated intentions is a different ACT from paging a table, not a different
 * rendering of it: separating them gives the bulk read its own rate limit, its
 * own log line, and its own line in the security review, and leaves the list
 * route with exactly one response shape.
 *
 * ## Two rate limits, and why this one is worth having
 *
 * `proxy.ts` applied the `'admin'` section tier (prefix-matched on
 * `/api/v1/admin/`) before this handler ran. `exportLimiter` adds the per-flow
 * sub-cap — 10 a minute, keyed on the admin's own id — which is the layer that
 * matters for a bulk read: the section cap would permit a hundred full-table
 * downloads a minute, and each one is a complete copy of the list leaving the
 * building.
 *
 * **The key is namespaced to this flow, which the platform's three other export
 * routes do not do.** They all pass the literal `export:user:${id}`, so they share
 * one 10/min budget between them; a first version of this route copied that
 * string and inherited the sharing while this docblock claimed a per-flow cap.
 * The code review caught the mismatch. Sharing is the wrong half to keep: ten
 * waitlist exports would then 429 the same admin's own Art. 15 subject-access
 * export at `/api/v1/users/me/export`, and a burst of conversation exports would
 * block this one for reasons nobody could see from either screen. It is the same
 * argument `lib/app/waitlist/rate-limit.ts` makes for not borrowing
 * `contactLimiter`: two unrelated flows deserve independent budgets. The cost is
 * one string that does not match the platform's convention, said here so it is a
 * choice rather than a slip.
 *
 * ## What is deliberately absent
 *
 * No row and no address reaches the log — the count does. An export of personal
 * data whose audit trail was itself a copy of that personal data would be worse
 * than no audit trail. That holds only because the logger drops the request URL,
 * which carries `?q=` — see `_shared/route-logger.ts`. And the response carries `no-store`: the platform's JSON
 * helper defaults to `private, no-cache`, but this returns a raw `Response` and
 * so would carry no directive at all, which RFC 9111 §4.2.2 lets a shared cache
 * store and expire on its own guess.
 *
 * @see lib/app/waitlist/admin.ts
 */

import { withAdminAuth } from '@/lib/auth/guards';
import { getWaitlistRouteLogger } from '@/app/api/v1/admin/app/waitlist/_shared/route-logger';
import { exportLimiter, createRateLimitResponse } from '@/lib/security/rate-limit';
import { waitlistAdminFilterSchema } from '@/lib/validations/app-waitlist';
import {
  collectWaitlistEntriesForExport,
  waitlistEntriesToCsv,
  waitlistExportFilename,
  WAITLIST_EXPORT_MAX_ROWS,
} from '@/lib/app/waitlist/admin';
import { validateQueryParams } from '@/lib/api/validation';

export const GET = withAdminAuth(async (request, session) => {
  const rateLimit = exportLimiter.check(`export:waitlist:user:${session.user.id}`);
  if (!rateLimit.success) return createRateLimitResponse(rateLimit);

  const log = await getWaitlistRouteLogger(request);

  const filter = validateQueryParams(request.nextUrl.searchParams, waitlistAdminFilterSchema);

  const { entries, total } = await collectWaitlistEntriesForExport(filter);

  const truncated = total > WAITLIST_EXPORT_MAX_ROWS;
  const filename = waitlistExportFilename(new Date(), truncated);

  log.info('Waitlist exported', {
    count: entries.length,
    total,
    truncated,
    searched: filter.q !== undefined,
    includeRemoved: filter.includeRemoved,
  });

  return new Response(waitlistEntriesToCsv(entries), {
    headers: {
      'Content-Type': 'text/csv; charset=utf-8',
      'Content-Disposition': `attachment; filename="${filename}"`,
      // Personal data, one copy per request — nothing between here and the
      // browser should keep it.
      'Cache-Control': 'private, no-store',
    },
  });
});
