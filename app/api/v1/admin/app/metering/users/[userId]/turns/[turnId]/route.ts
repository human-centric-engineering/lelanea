/**
 * Metering — one person's turn (Admin)
 *
 * GET /api/v1/admin/app/metering/users/:userId/turns/:turnId — the full record
 * of one turn: what produced it and every cost row it caused. The same shape a
 * member reads of their own at `/api/v1/app/usage/turns/:turnId` (§08 t-56).
 *
 * Addressed by person AND turn id because turn ids are unique per person, not
 * globally. 404 when that person has no such turn.
 *
 * Authentication: admin. Rate limiting: the `admin` section tier, already
 * applied by `proxy.ts`. Caching: `no-store`.
 *
 * @see lib/app/agent/metering.ts
 */

import { withAdminAuth } from '@/lib/auth/guards';
import { successResponse } from '@/lib/api/responses';
import { NotFoundError } from '@/lib/api/errors';
import { validatePathParam } from '@/lib/api/validation';
import { cuidSchema } from '@/lib/validations/common';
import { turnIdParamSchema } from '@/lib/validations/app-metering';
import { getTurnMeter } from '@/lib/app/agent/metering';
import { getAgentSettingsRouteLogger } from '@/app/api/v1/admin/app/agent/_shared/route-logger';

export const GET = withAdminAuth<{ userId: string; turnId: string }>(
  async (request, session, { params }) => {
    const log = await getAgentSettingsRouteLogger(request);
    const { userId: rawUser, turnId: rawTurn } = await params;
    const userId = validatePathParam(rawUser, cuidSchema, { label: 'user id' });
    const turnId = validatePathParam(rawTurn, turnIdParamSchema, { label: 'turn id' });

    const turn = await getTurnMeter(userId, turnId);
    if (!turn) throw new NotFoundError('Turn not found');

    log.info('Metering turn read', { adminId: session.user.id, userId, seat: turn.seat });

    return successResponse(turn, undefined, { headers: { 'Cache-Control': 'no-store' } });
  }
);
