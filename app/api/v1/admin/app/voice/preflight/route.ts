/**
 * Voice test preflight — what a run would use, and roughly what it would cost (Admin)
 *
 * GET /api/v1/admin/app/voice/preflight
 *
 * The model that would answer, the number of questions, and a planning-grade USD
 * range for the whole comparison — both arms and the judge. Read once by the
 * admin page so the button says what pressing it does.
 *
 * It answers 200 with nulls in it rather than erroring when the set is unseeded
 * or the estimate cannot be made: this is the surface's decoration, and a 500
 * here would take down the page that shows the comparisons.
 *
 * Authentication: admin. Rate limiting is applied by `proxy.ts` before this
 * handler runs, as for every route under `/api/v1/admin/`.
 *
 * @see lib/app/voice/preflight.ts · .context/app/voice.md
 */

import { withAdminAuth } from '@/lib/auth/guards';
import { successResponse } from '@/lib/api/responses';
import { getRouteLogger } from '@/lib/api/context';
import { getVoicePreflight } from '@/lib/app/voice/preflight';

export const GET = withAdminAuth(async (request, session) => {
  const log = await getRouteLogger(request);

  // Scoped to the caller: the estimator calibrates against past runs, and
  // `AiEvaluationRun.userId` is the ownership column those are read through.
  const preflight = await getVoicePreflight(session.user.id);

  log.info('Voice preflight read', {
    caseCount: preflight.caseCount,
    modelId: preflight.modelId,
    costKnown: preflight.cost !== null,
  });
  return successResponse(preflight);
});
