/**
 * My voice leanings (f-leanings t-135).
 *
 * - `GET /api/v1/app/leanings` — my eleven dials: where each rests, what
 *   applies under today's bounds, how far each may move, and whether it is
 *   locked. `configured: false` when the bounds can't be read, and then every
 *   dial is locked at rest.
 * - `PATCH /api/v1/app/leanings` — `{ key, stop }`: set one dial. Clamped to
 *   the bounds, refused for a locked dial, and a new version every time,
 *   never an overwrite. The same stop again writes nothing.
 *
 * Authentication: required. Rate limiting: inherited from the `/api/v1/**`
 * section cap in `proxy.ts`; these are a small read and a single-row insert on
 * the caller's own rows. Caching: `no-store`, since the dials change from a
 * conversation too (t-137).
 *
 * @see lib/app/voice/leanings-store.ts
 * @see .context/app/voice.md — "The person's leanings"
 */

import type { NextRequest } from 'next/server';

import { getRouteLogger } from '@/lib/api/context';
import { successResponse } from '@/lib/api/responses';
import { validateRequestBody } from '@/lib/api/validation';
import { withAuth, type WithAuthOptions } from '@/lib/auth/guards';
import { getLeanings, setLeaning } from '@/lib/app/voice/leanings-store';
import { leaningChangeSchema } from '@/lib/app/voice/leanings';

/**
 * Ownership: self-scoped by construction — see `RouteOwnership` in
 * `lib/auth/guards.ts`. Both handlers are keyed on `session.user.id`, and
 * nothing in either request names a subject. Not `'policy'`, for the notes
 * route's reason: an operator has no door to a member's settings here.
 */
const OWNERSHIP: WithAuthOptions = {
  ownership: {
    decidedBy: 'self',
    because:
      "Both handlers are keyed on the caller's own id: the read filters slot values on it and the write appends under it. Nothing in either request names another subject.",
  },
};

export const GET = withAuth(async (_request: NextRequest, session) => {
  const view = await getLeanings(session.user.id);
  return successResponse(view, undefined, { headers: { 'Cache-Control': 'no-store' } });
}, OWNERSHIP);

export const PATCH = withAuth(async (request: NextRequest, session) => {
  const log = await getRouteLogger(request);
  const body = await validateRequestBody(request, leaningChangeSchema);
  const result = await setLeaning({
    userId: session.user.id,
    key: body.key,
    stop: body.stop,
    via: 'settings',
  });

  // Which dial and where it landed is a setting, not something the person
  // said, so it is safe to log and is what an operator needs to see them used.
  log.info('Leaning set by the person', {
    userId: session.user.id,
    key: body.key,
    asked: body.stop,
    stored: result.dial.stored,
    outcome: result.outcome,
  });

  return successResponse(result);
}, OWNERSHIP);
