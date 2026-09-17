/**
 * Stop a voice test that is still running (Admin)
 *
 * POST /api/v1/admin/app/voice/comparisons/:id/cancel
 *
 * Flips both arms' evaluation runs to `cancelled`. The platform's worker
 * re-reads run status between cases and exits without writing more, so this
 * stops the spend rather than only relabelling it.
 *
 * Answers 200 for a comparison that has already finished, with the arms it found
 * terminal listed in the body — see `cancelVoiceComparison` for why that is not
 * a 409 here: the button lives on a polling surface, and pressing it on the tick
 * the last case lands is a race, not a mistake.
 *
 * Authentication: admin, as the routes beside it. Rate limiting is applied by
 * `proxy.ts` before this handler runs.
 *
 * @see lib/app/voice/comparison.ts — `cancelVoiceComparison`
 */

import { withAdminAuth } from '@/lib/auth/guards';
import { successResponse } from '@/lib/api/responses';
import { validatePathParam } from '@/lib/api/validation';
import { getRouteLogger } from '@/lib/api/context';
import { cuidSchema } from '@/lib/validations/common';
import { cancelVoiceComparison } from '@/lib/app/voice/comparison';

export const POST = withAdminAuth<{ id: string }>(async (request, session, { params }) => {
  const log = await getRouteLogger(request);
  const { id: raw } = await params;
  const id = validatePathParam(raw, cuidSchema, { label: 'comparison id' });

  const result = await cancelVoiceComparison(id, session.user.id);

  log.info('Voice comparison stop requested', {
    comparisonId: id,
    cancelled: result.cancelled.length,
  });
  return successResponse(result);
});
