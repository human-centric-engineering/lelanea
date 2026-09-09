/**
 * Authored Content — Discovery Questions
 *
 * GET /api/v1/app/content/discovery-questions — the thirty questions of the
 * onboarding module's discovery phase, with the preamble and the pacing
 * guidance that belong with them.
 *
 * Authentication: required. Unlike the foundational documents, these are the
 * questions a member is actually asked; the pacing note ("this is not a form to
 * rush") is guidance to someone already in the journey, not marketing copy.
 *
 * Rate limiting: inherited from the `/api/v1/**` section cap in
 * `lib/security/rate-limit-policy.ts`.
 *
 * Caching: keeps the platform default (`private, no-cache`) rather than the
 * public directive the unauthenticated content routes use — the payload is the
 * same for every member today, but it sits behind a session, and a shared cache
 * has no business holding it.
 */

import { withAuth } from '@/lib/auth/guards';
import { successResponse } from '@/lib/api/responses';
import { computeETag, checkConditional } from '@/lib/api/etag';
import { getRouteLogger } from '@/lib/api/context';
import { getDiscoveryQuestions } from '@/lib/app/content';

export const GET = withAuth(async (request) => {
  const log = await getRouteLogger(request);
  const questions = getDiscoveryQuestions();

  const etag = computeETag(questions);
  const notModified = checkConditional(request, etag);
  if (notModified) return notModified;

  log.info('Discovery questions served', {
    version: questions.collection.version,
    questionCount: questions.questions.length,
  });

  return successResponse(questions, undefined, { headers: { ETag: etag } });
});
