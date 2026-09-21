/**
 * Lelañea's notes — what she holds about me, and my correction to one
 * (f-slots t-73).
 *
 * - `GET /api/v1/app/notes` — every current reading about the signed-in person,
 *   grouped as the taxonomy groups it, each with its confidence, how it was
 *   known, when, the conversation it came from and the version before it.
 *   Hidden slots are absent (§12); slugs she invented are kept apart; a retired
 *   slot's notes are present and labelled.
 * - `POST /api/v1/app/notes` — `{ slotSlug, value }`: a new version at
 *   `sourceType: user_confirmed`, never an overwrite. Refused for a slug with no
 *   note of the caller's own, for a hidden one (the same 404, deliberately), for
 *   a retired one and for one whose words are kept out of the record.
 *
 * One enriched read: the panel fetches this and nothing else, and re-fetches it
 * whole after a turn writes or after a correction. There is no per-note route,
 * because there is no per-note question.
 *
 * Authentication: required. Rate limiting: inherited from the `/api/v1/**`
 * section cap in `proxy.ts` — no per-flow sub-cap, since both are small reads
 * and a single-row insert on the caller's own rows. Caching: `no-store` — a
 * note can land mid-turn, and the whole point of the panel is that it shows
 * that.
 *
 * Errors are thrown, not returned: `withAuth` routes an `APIError` through
 * `handleAPIError`, which is what turns the store's `ConflictError` into the
 * 409 whose message the panel prints verbatim.
 *
 * @see lib/app/slots/notes.ts
 * @see .context/app/slots.md — "Her notes"
 */

import type { NextRequest } from 'next/server';

import { getRouteLogger } from '@/lib/api/context';
import { successResponse } from '@/lib/api/responses';
import { validateRequestBody } from '@/lib/api/validation';
import { withAuth, type WithAuthOptions } from '@/lib/auth/guards';
import { correctNote, getNotes } from '@/lib/app/slots/notes';
import { slotCorrectionSchema } from '@/lib/app/slots/validation';

/**
 * Ownership: self-scoped by construction — see `RouteOwnership` in
 * `lib/auth/guards.ts`. Every read and the write are keyed on
 * `session.user.id`, and nothing in either request names a subject.
 *
 * Deliberately **not** `'policy'`: `subjectScope` widens to `{}` for a platform
 * admin, and on this endpoint that would hand an operator the intimate record
 * of whoever they were signed in beside. There is no admin door to a member's
 * notes here, and §3.19 is why — an operator reads a slot value through the
 * admin values browser, which masks by default and audits a reveal.
 */
const OWNERSHIP: WithAuthOptions = {
  ownership: {
    decidedBy: 'self',
    because:
      "Both handlers are keyed on the caller's own id — the read filters slot values on it and the correction appends under it. Nothing in either request names another subject.",
  },
};

export const GET = withAuth(async (request: NextRequest, session) => {
  const log = await getRouteLogger(request);
  const view = await getNotes(session.user.id);

  // No slug and no value: a minted slug is model-authored free text that can
  // encode what the person said, and durable app logs are not erasure-covered.
  // The same reasoning `capture.ts` gives for its own log line.
  log.info('Own notes read', {
    userId: session.user.id,
    notes: view.total,
    groups: view.groups.length,
    improvised: view.improvised.length,
  });

  return successResponse(view, undefined, { headers: { 'Cache-Control': 'no-store' } });
}, OWNERSHIP);

export const POST = withAuth(async (request: NextRequest, session) => {
  const log = await getRouteLogger(request);
  const body = await validateRequestBody(request, slotCorrectionSchema);
  const corrected = await correctNote({
    userId: session.user.id,
    slotSlug: body.slotSlug,
    value: body.value,
  });

  // No slug here either, for the reason above: a correction may name a slug she
  // invented, and that slug is model-authored free text drawn from what the
  // person said. The version is what an operator needs to see a correction
  // happening; the value never reaches a log at all.
  log.info('Note corrected by the person it is about', {
    userId: session.user.id,
    version: corrected.version,
  });

  return successResponse(corrected, undefined, { status: 201 });
}, OWNERSHIP);
