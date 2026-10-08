/**
 * The sitting I am in (f-forget-session t-158).
 *
 * - `GET /api/v1/app/sessions/current` — `{ session: { id, hasTurns } | null }`:
 *   the caller's current session, and whether they have said anything in it.
 *   What the conversation pane reads to offer "Delete this session", which
 *   then goes to `DELETE /api/v1/app/sessions/:id`. `null` when the session
 *   could not be arrived at; the pane then offers nothing.
 *
 * Reading it is an arrival, as the pane's transcript read is: it opens the
 * caller's session or resumes the one they are in. Inside a sitting that
 * writes nothing. A close it writes queues a synopsis draft, which `after()`
 * keeps alive past the response.
 *
 * Authentication: required. Rate limiting: inherited from the `/api/v1/**`
 * section cap. Caching: `no-store` — a turn may be landing as this is read.
 *
 * @see lib/app/sessions/current.ts
 */

import { after } from 'next/server';

import { getRouteLogger } from '@/lib/api/context';
import { successResponse } from '@/lib/api/responses';
import { withAuth, type WithAuthOptions } from '@/lib/auth/guards';
import { readCurrentSession } from '@/lib/app/sessions/current';

/** Ownership: self — the session is resolved and its turns read under the caller's own id. */
const OWNERSHIP: WithAuthOptions = {
  ownership: {
    decidedBy: 'self',
    because:
      "The current session is arrived at for the caller's own id, and its turns are counted under it. The request names no subject.",
  },
};

export const GET = withAuth(async (request, session) => {
  const log = await getRouteLogger(request);
  const current = await readCurrentSession(session.user.id, {
    keepAlive: (work) => after(work),
  });

  log.info('Own current session read', {
    userId: session.user.id,
    found: current !== null,
    hasTurns: current?.hasTurns ?? false,
  });

  return successResponse({ session: current }, undefined, {
    headers: { 'Cache-Control': 'no-store' },
  });
}, OWNERSHIP);
