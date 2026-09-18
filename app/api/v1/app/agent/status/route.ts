/**
 * Conversation — Status
 *
 * GET /api/v1/app/agent/status — whether a conversation turn can be expected to
 * be answered right now: `{ generation: 'available' | 'unavailable' | 'paused' }`.
 * What the conversation pane, and later a banner, ask before or between turns
 * (§08 t-55).
 *
 * - `paused` — an operator paused conversations on purpose; a turn sent now
 *   ends with the `paused` ending. Everything readable still works.
 * - `unavailable` — the most recent turn anyone finished, in the last few
 *   minutes, ended because the model could not answer or ran out of time. A
 *   hint: the next turn is still tried, and may well succeed.
 * - `available` — otherwise.
 *
 * Install-wide: it says nothing about anybody's turn, only whether the last one
 * worked. See `lib/app/agent/availability.ts`.
 *
 * Authentication: required — only members talk to her.
 *
 * Rate limiting: inherited from the `/api/v1/**` section cap.
 *
 * Caching: `no-store`. The answer changes the moment an operator flips the
 * switch, and a cached "available" during an incident is the one thing this
 * route must not say.
 */

import { withAuth } from '@/lib/auth/guards';
import { successResponse } from '@/lib/api/responses';
import { getRouteLogger } from '@/lib/api/context';
import { getGenerationStatus } from '@/lib/app/agent/availability';

export const GET = withAuth(
  async (request) => {
    const log = await getRouteLogger(request);
    const generation = await getGenerationStatus();

    log.debug('Generation status served', { generation });

    return successResponse({ generation }, undefined, {
      headers: { 'Cache-Control': 'no-store' },
    });
  },
  {
    // Ownership: none to decide — see RouteOwnership in lib/auth/guards.ts.
    ownership: {
      decidedBy: 'nothing',
      because:
        'Serves one install-wide word — whether conversations are paused or recently failing. It reads an operator flag and the status of the latest finished turn, never whose turn it was, so every member gets the same answer.',
    },
  }
);
