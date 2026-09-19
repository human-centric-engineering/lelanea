/**
 * Usage — one of my turns
 *
 * GET /api/v1/app/usage/turns/:turnId — what produced one of the signed-in
 * person's turns and what it cost (§08 t-56): model, provider, fingerprint
 * version and seat from the turn record; dollars and tokens from the cost log —
 * her reply and every side cost it caused (summary, tools, searches, the
 * embedding of her reply), each row listed.
 *
 * What f-conversation's per-turn drawer reads.
 *
 * 404 when the caller has no turn with that id — including when somebody else
 * does: turn ids are scoped to the person, so this cannot reveal another's.
 *
 * Authentication: required. Rate limiting: inherited from the `/api/v1/**`
 * section cap. Caching: `no-store` — a running turn's cost is still arriving.
 *
 * @see lib/app/agent/metering.ts
 */

import { withAuth, type WithAuthOptions } from '@/lib/auth/guards';
import { successResponse } from '@/lib/api/responses';
import { NotFoundError } from '@/lib/api/errors';
import { getRouteLogger } from '@/lib/api/context';
import { validatePathParam } from '@/lib/api/validation';
import { turnIdParamSchema } from '@/lib/validations/app-metering';
import { getTurnMeter } from '@/lib/app/agent/metering';

/** Ownership: self — the turn is looked up under the caller's own id. */
const OWNERSHIP: WithAuthOptions<{ turnId: string }> = {
  ownership: {
    decidedBy: 'self',
    because:
      "The turn is found by (caller's id, turn id) and its cost rows are filtered on the caller's id. The path names a turn, never a subject, and another person's turn id matches nothing.",
  },
};

export const GET = withAuth<{ turnId: string }>(async (request, session, { params }) => {
  const log = await getRouteLogger(request);
  const { turnId: raw } = await params;
  const turnId = validatePathParam(raw, turnIdParamSchema, { label: 'turn id' });

  const turn = await getTurnMeter(session.user.id, turnId);
  if (!turn) throw new NotFoundError('Turn not found');

  log.info('Own turn meter read', {
    userId: session.user.id,
    seat: turn.seat,
    costRows: turn.costRows,
  });

  return successResponse(turn, undefined, { headers: { 'Cache-Control': 'no-store' } });
}, OWNERSHIP);
