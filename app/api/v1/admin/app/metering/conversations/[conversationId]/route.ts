/**
 * Metering — one conversation's turns (Admin)
 *
 * GET /api/v1/admin/app/metering/conversations/:conversationId — the turns of
 * one conversation that started in a window, each with its whole cost,
 * costliest first (f-budget t-97).
 *
 * Query parameters:
 *   - from    optional ISO date — default: the first instant of this UTC month
 *   - to      optional ISO date, exclusive — default: now
 *   - limit   default 200, max 500 — turns returned; the cheapest are cut
 *
 * The drill-down between a costly conversation on the admin cost view and one
 * turn's full record. Each turn carries its person's id, because the turn route
 * (`…/users/:userId/turns/:turnId`) is addressed by both. An unknown
 * conversation, or one with no turns in the window, is an empty list rather
 * than a 404: the window, not the id, decides what there is to show.
 *
 * Authentication: admin. Rate limiting: the `admin` section tier, already
 * applied by `proxy.ts`. Caching: `no-store`.
 *
 * @see lib/app/agent/metering.ts — `getConversationTurns`
 */

import { withAdminAuth } from '@/lib/auth/guards';
import { successResponse } from '@/lib/api/responses';
import { validatePathParam, validateQueryParams } from '@/lib/api/validation';
import { cuidSchema } from '@/lib/validations/common';
import { conversationTurnsQuerySchema } from '@/lib/validations/app-metering';
import { getConversationTurns, resolveWindow } from '@/lib/app/agent/metering';
import { getAgentSettingsRouteLogger } from '@/app/api/v1/admin/app/agent/_shared/route-logger';

export const GET = withAdminAuth<{ conversationId: string }>(
  async (request, session, { params }) => {
    const log = await getAgentSettingsRouteLogger(request);
    const { conversationId: raw } = await params;
    const conversationId = validatePathParam(raw, cuidSchema, { label: 'conversation id' });
    const query = validateQueryParams(request.nextUrl.searchParams, conversationTurnsQuerySchema);

    const result = await getConversationTurns({
      conversationId,
      window: resolveWindow(query),
      limit: query.limit,
    });

    log.info('Metering conversation turns read', {
      adminId: session.user.id,
      conversationId,
      turns: result.turns.length,
      truncated: result.truncated,
    });

    return successResponse(result, undefined, { headers: { 'Cache-Control': 'no-store' } });
  }
);
