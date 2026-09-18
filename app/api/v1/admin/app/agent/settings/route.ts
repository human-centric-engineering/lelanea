/**
 * Agent settings — the deadlines and the default monthly ceiling (Admin)
 *
 * GET /api/v1/admin/app/agent/settings
 * PUT /api/v1/admin/app/agent/settings
 *
 * PUT body: `{ firstWordsDeadlineMs, turnDeadlineMs, defaultMonthlyCeilingUsd }`
 * — all three, every time. A full replacement is what lets "first words shorter
 * than the turn" be checked at the boundary rather than against whatever is
 * stored. Refuses 400 for a non-positive deadline, a first-words deadline not
 * shorter than the turn's, and a negative ceiling.
 *
 * Authentication: admin (`withAdminAuth`, which also admits an `admin`-scoped
 * API key). Rate limiting is the `admin` section tier `proxy.ts` already applied.
 *
 * ## Audited, and that is where "who changed it" lives
 *
 * The row holds nothing about anyone, which is what lets the Art. 15 export
 * exclude it with a reason that is true for every reader. Who changed the numbers
 * goes to the admin audit log with the before and after.
 *
 * Nothing here enforces anything — see `lib/app/agent/settings.ts`.
 */

import { withAdminAuth } from '@/lib/auth/guards';
import { successResponse } from '@/lib/api/responses';
import { validateRequestBody } from '@/lib/api/validation';
import { getClientIP } from '@/lib/security/ip';
import { logAdminAction } from '@/lib/orchestration/audit/admin-audit-logger';
import { agentSettingsUpdateSchema } from '@/lib/validations/app-agent-settings';
import { getAgentSettings, updateAgentSettings } from '@/lib/app/agent/settings';
import { getAgentSettingsRouteLogger } from '@/app/api/v1/admin/app/agent/_shared/route-logger';

export const GET = withAdminAuth(async (request, _session) => {
  const log = await getAgentSettingsRouteLogger(request);
  const settings = await getAgentSettings();
  log.info('Agent settings fetched', { stored: settings.updatedAt !== null });
  return successResponse({ settings });
});

export const PUT = withAdminAuth(async (request, session) => {
  const log = await getAgentSettingsRouteLogger(request);
  const body = await validateRequestBody(request, agentSettingsUpdateSchema);

  const before = await getAgentSettings();
  const settings = await updateAgentSettings(body);

  const changes: Record<string, { from: unknown; to: unknown }> = {};
  for (const key of Object.keys(body) as Array<keyof typeof body>) {
    if (before[key] !== settings[key]) changes[key] = { from: before[key], to: settings[key] };
  }

  log.info('Agent settings updated', {
    adminId: session.user.id,
    changed: Object.keys(changes),
  });

  logAdminAction({
    userId: session.user.id,
    action: 'app_agent_settings.update',
    entityType: 'settings',
    entityId: 'app_agent_settings',
    entityName: 'Agent deadlines and default ceiling',
    changes,
    clientIp: getClientIP(request),
  });

  return successResponse({ settings });
});
