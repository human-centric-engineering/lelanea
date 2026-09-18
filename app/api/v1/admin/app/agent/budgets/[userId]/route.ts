/**
 * One person's monthly ceiling (Admin)
 *
 * PUT    /api/v1/admin/app/agent/budgets/:userId — set their own ceiling
 * DELETE /api/v1/admin/app/agent/budgets/:userId — put them back on the default
 *
 * PUT body: `{ monthlyCeilingUsd }` — zero allowed ("may spend nothing"),
 * negative refused. Both answer with the person's row as it now stands, 404 for
 * an id no account matches.
 *
 * **Clearing is a DELETE, not a PUT of zero.** No row means the default applies,
 * and zero is a real answer that must stay distinguishable from "no answer".
 * The DELETE is idempotent: clearing an override nobody set answers 200 with the
 * row, because the state asked for is the state the person is in; `cleared`
 * says whether this call removed anything.
 *
 * Authentication: admin. Rate limiting: the `admin` section tier from `proxy.ts`.
 * Audited — a ceiling decides what a person may use, which is the class of change
 * the admin audit log exists for. The log line carries the user id, never the
 * address.
 */

import { withAdminAuth } from '@/lib/auth/guards';
import { successResponse } from '@/lib/api/responses';
import { NotFoundError } from '@/lib/api/errors';
import { validatePathParam, validateRequestBody } from '@/lib/api/validation';
import { cuidSchema } from '@/lib/validations/common';
import { getClientIP } from '@/lib/security/ip';
import { logAdminAction } from '@/lib/orchestration/audit/admin-audit-logger';
import { userBudgetUpdateSchema } from '@/lib/validations/app-agent-settings';
import { clearUserBudget, setUserBudget } from '@/lib/app/agent/settings';
import { getAgentSettingsRouteLogger } from '@/app/api/v1/admin/app/agent/_shared/route-logger';

export const PUT = withAdminAuth<{ userId: string }>(async (request, session, { params }) => {
  const log = await getAgentSettingsRouteLogger(request);
  const { userId: raw } = await params;
  const userId = validatePathParam(raw, cuidSchema, { label: 'user id' });

  const { monthlyCeilingUsd } = await validateRequestBody(request, userBudgetUpdateSchema);

  const row = await setUserBudget(userId, monthlyCeilingUsd);
  if (!row) throw new NotFoundError('User not found');

  log.info('User budget set', { userId, monthlyCeilingUsd, adminId: session.user.id });

  logAdminAction({
    userId: session.user.id,
    action: 'app_user_budget.set',
    entityType: 'user',
    entityId: userId,
    metadata: { monthlyCeilingUsd },
    clientIp: getClientIP(request),
  });

  return successResponse({ budget: row });
});

export const DELETE = withAdminAuth<{ userId: string }>(async (request, session, { params }) => {
  const log = await getAgentSettingsRouteLogger(request);
  const { userId: raw } = await params;
  const userId = validatePathParam(raw, cuidSchema, { label: 'user id' });

  const result = await clearUserBudget(userId);
  if (!result) throw new NotFoundError('User not found');

  log.info('User budget cleared', { userId, cleared: result.cleared, adminId: session.user.id });

  if (result.cleared) {
    logAdminAction({
      userId: session.user.id,
      action: 'app_user_budget.clear',
      entityType: 'user',
      entityId: userId,
      clientIp: getClientIP(request),
    });
  }

  return successResponse({ budget: result.row, cleared: result.cleared });
});
