/**
 * The conversation — read back
 *
 * GET /api/v1/app/conversation?seat=facilitator — the signed-in person's
 * conversation on a seat (§10 t-64): what they said, what she said, and for
 * every reply the turn row that says what produced it. What the pane renders
 * on load, and what the disclosure drawer reads.
 *
 * `seat` defaults to the facilitator seat, the one the pane speaks to in
 * release 1; the onboarding seat is readable too, for the feature that owns it.
 * No conversation yet is an empty transcript with `conversationId: null`, not
 * a 404 — the pane renders either way.
 *
 * Authentication: required. Rate limiting: inherited from the `/api/v1/**`
 * section cap. Caching: `no-store` — a turn may be settling as this is read.
 *
 * @see lib/app/conversation/transcript.ts
 */

import { z } from 'zod';

import { withAuth, type WithAuthOptions } from '@/lib/auth/guards';
import { successResponse } from '@/lib/api/responses';
import { getRouteLogger } from '@/lib/api/context';
import { validateQueryParams } from '@/lib/api/validation';
import { CONVERSATION_SEAT, READABLE_SEATS } from '@/lib/app/conversation/seats';
import { readTranscript } from '@/lib/app/conversation/transcript';

const querySchema = z.object({
  seat: z
    .string()
    .trim()
    .refine((seat) => READABLE_SEATS.includes(seat), { message: 'Not a readable seat' })
    .optional(),
});

/** Ownership: self — the conversation is resolved under the caller's own id. */
const OWNERSHIP: WithAuthOptions = {
  ownership: {
    decidedBy: 'self',
    because:
      "The surface conversation is resolved for (caller's id, seat) the way the stream route resolves it, and its rows are read under the caller's id. The seat is a public vocabulary, never a subject.",
  },
};

export const GET = withAuth(async (request, session) => {
  const log = await getRouteLogger(request);
  const query = validateQueryParams(request.nextUrl.searchParams, querySchema);
  const seat = query.seat ?? CONVERSATION_SEAT;

  const transcript = await readTranscript(session, seat);

  log.info('Own conversation read', {
    userId: session.user.id,
    seat,
    entries: transcript.entries.length,
    resumed: transcript.conversationId !== null,
  });

  return successResponse(transcript, undefined, { headers: { 'Cache-Control': 'no-store' } });
}, OWNERSHIP);
