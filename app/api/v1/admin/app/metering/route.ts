/**
 * Metering — anyone's spend, grouped (Admin)
 *
 * GET /api/v1/admin/app/metering — the cost log over a window, grouped by one
 * dimension, for everyone or for one person (§08 t-56).
 *
 * Query parameters:
 *   - by      required — `user` | `conversation` | `seat` | `model` | `day` (UTC)
 *   - userId  optional — one person's rows only; omitted, every row
 *   - from    optional ISO date — default: the first instant of this UTC month
 *   - to      optional ISO date, exclusive — default: now
 *   - limit   default 100, max 500 — groups returned; totals always cover all
 *
 * Returns `{ by, window, totals: { …, platformCostUsd }, groups, truncated }`.
 * Grouped by `user`, each group carries `user: { name, email }`, and the group
 * whose `key` is null is **platform cost** — rows no person incurred
 * (ingestion, scheduled work, an erased account). It is reported, never dropped
 * and never attributed.
 *
 * The single enriched list the admin cost view reads — no per-row fetch.
 *
 * Authentication: admin. Rate limiting: the `admin` section tier, already
 * applied by `proxy.ts`. Caching: `no-store`.
 *
 * @see lib/app/agent/metering.ts
 */

import { withAdminAuth } from '@/lib/auth/guards';
import { successResponse } from '@/lib/api/responses';
import { validateQueryParams } from '@/lib/api/validation';
import { adminBreakdownQuerySchema } from '@/lib/validations/app-metering';
import { getAdminBreakdown, resolveWindow } from '@/lib/app/agent/metering';
import { getAgentSettingsRouteLogger } from '@/app/api/v1/admin/app/agent/_shared/route-logger';

export const GET = withAdminAuth(async (request, session) => {
  const log = await getAgentSettingsRouteLogger(request);
  const query = validateQueryParams(request.nextUrl.searchParams, adminBreakdownQuerySchema);

  const result = await getAdminBreakdown({
    by: query.by,
    window: resolveWindow(query),
    limit: query.limit,
    ...(query.userId ? { userId: query.userId } : {}),
  });

  log.info('Metering breakdown read', {
    adminId: session.user.id,
    by: query.by,
    userId: query.userId ?? null,
    groups: result.groups.length,
    truncated: result.truncated,
  });

  return successResponse(result, undefined, { headers: { 'Cache-Control': 'no-store' } });
});
