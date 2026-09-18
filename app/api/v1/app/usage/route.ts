/**
 * Usage — this month, against my ceiling
 *
 * GET /api/v1/app/usage — the signed-in person's spend and tokens this UTC
 * month, summed from the cost log, beside their effective monthly ceiling:
 * `{ userId, window, costUsd, inputTokens, outputTokens, costRows, unpricedRows,
 * ceiling: { ceilingUsd, source }, remainingUsd, fractionUsed }`.
 *
 * The headline f-budget's usage view reads (§08 t-56). It reports; it enforces
 * nothing. A non-zero `unpricedRows` means `costUsd` is a floor.
 *
 * Authentication: required. Rate limiting: inherited from the `/api/v1/**`
 * section cap. Caching: `no-store` — spend moves with every turn.
 *
 * @see lib/app/agent/metering.ts
 */

import { withAuth, type WithAuthOptions } from '@/lib/auth/guards';
import { successResponse } from '@/lib/api/responses';
import { getRouteLogger } from '@/lib/api/context';
import { getMonthToDate } from '@/lib/app/agent/metering';

/**
 * Ownership: self-scoped by construction — see `RouteOwnership` in
 * `lib/auth/guards.ts`. Not `'policy'`: `subjectScope` widens to `{}` for a
 * platform admin, which on a self endpoint would hand an admin everyone's
 * spend. An admin reads anyone's through `/api/v1/admin/app/metering`.
 */
const OWNERSHIP: WithAuthOptions = {
  ownership: {
    decidedBy: 'self',
    because:
      "Every cost row read is filtered on the caller's own id, and the ceiling is the caller's. Nothing in the request names another subject.",
  },
};

export const GET = withAuth(async (request, session) => {
  const log = await getRouteLogger(request);
  const usage = await getMonthToDate(session.user.id);

  log.info('Own usage read', {
    userId: session.user.id,
    costRows: usage.costRows,
    unpricedRows: usage.unpricedRows,
  });

  return successResponse(usage, undefined, { headers: { 'Cache-Control': 'no-store' } });
}, OWNERSHIP);
