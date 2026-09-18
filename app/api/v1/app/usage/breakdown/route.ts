/**
 * Usage — my spend, grouped
 *
 * GET /api/v1/app/usage/breakdown — the signed-in person's own cost rows,
 * grouped by one dimension over a window (§08 t-56).
 *
 * Query parameters:
 *   - by     required — `conversation` | `seat` | `model` | `day` (UTC)
 *   - from   optional ISO date — default: the first instant of this UTC month
 *   - to     optional ISO date, exclusive — default: now
 *   - limit  default 100, max 500 — groups returned; totals always cover all
 *
 * Returns `{ by, window, totals, groups: [{ key, costUsd, inputTokens,
 * outputTokens, costRows, unpricedRows }], truncated }`. A null `key` is a row
 * with no value for the dimension (unseated, no conversation).
 *
 * Authentication: required. Rate limiting: inherited from the `/api/v1/**`
 * section cap. Caching: `no-store`.
 *
 * @see lib/app/agent/metering.ts
 */

import { withAuth, type WithAuthOptions } from '@/lib/auth/guards';
import { successResponse } from '@/lib/api/responses';
import { getRouteLogger } from '@/lib/api/context';
import { validateQueryParams } from '@/lib/api/validation';
import { memberBreakdownQuerySchema } from '@/lib/validations/app-metering';
import { getMemberBreakdown, resolveWindow } from '@/lib/app/agent/metering';

/** Ownership: self — see `app/api/v1/app/usage/route.ts`. */
const OWNERSHIP: WithAuthOptions = {
  ownership: {
    decidedBy: 'self',
    because:
      "Every cost row read is filtered on the caller's own id. The query names a dimension and a window, never a subject.",
  },
};

export const GET = withAuth(async (request, session) => {
  const log = await getRouteLogger(request);
  const query = validateQueryParams(request.nextUrl.searchParams, memberBreakdownQuerySchema);

  const result = await getMemberBreakdown(session.user.id, {
    by: query.by,
    window: resolveWindow(query),
    limit: query.limit,
  });

  log.info('Own usage breakdown read', {
    userId: session.user.id,
    by: query.by,
    groups: result.groups.length,
    truncated: result.truncated,
  });

  return successResponse(result, undefined, { headers: { 'Cache-Control': 'no-store' } });
}, OWNERSHIP);
