/**
 * Monthly ceilings — every person, with what they may spend (Admin)
 *
 * GET /api/v1/admin/app/agent/budgets
 *
 * Query parameters:
 *   - q               optional free-text search over name and email
 *   - overriddenOnly  default false — only people with their own ceiling
 *   - page            default 1
 *   - limit           default 25, max 100
 *
 * Returns the paginated envelope, each row `{ userId, name, email, role,
 * overrideUsd, effectiveCeilingUsd }`. A row on the default carries a null
 * override and the default as its effective ceiling, so the table renders a
 * verdict rather than working one out.
 *
 * The single enriched list a per-person override is set from — the page never
 * fetches a row at a time.
 *
 * Authentication: admin. Rate limiting: the `admin` section tier, already
 * applied by `proxy.ts`.
 *
 * The search term never reaches the log, and neither does the URL carrying it —
 * see `_shared/route-logger.ts`.
 */

import { withAdminAuth } from '@/lib/auth/guards';
import { paginatedResponse } from '@/lib/api/responses';
import { validateQueryParams } from '@/lib/api/validation';
import { userBudgetQuerySchema } from '@/lib/validations/app-agent-settings';
import { listUserBudgets } from '@/lib/app/agent/settings';
import { getAgentSettingsRouteLogger } from '@/app/api/v1/admin/app/agent/_shared/route-logger';

export const GET = withAdminAuth(async (request, _session) => {
  const log = await getAgentSettingsRouteLogger(request);
  const query = validateQueryParams(request.nextUrl.searchParams, userBudgetQuerySchema);

  const { users, total } = await listUserBudgets(query);

  log.info('User budgets listed', {
    count: users.length,
    total,
    page: query.page,
    searched: query.q !== undefined,
    overriddenOnly: query.overriddenOnly,
  });

  return paginatedResponse(users, { page: query.page, limit: query.limit, total });
});
