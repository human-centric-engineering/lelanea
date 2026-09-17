/**
 * One voice comparison, case by case (Admin)
 *
 * GET /api/v1/admin/app/voice/comparisons/:id?against=<other comparison id>
 *
 * Every prompt in the golden set with each arm's answer beside it, and the
 * system prompt each arm was actually given. Pass `against` to put a second
 * comparison's arms in the same table — which is how two VERSIONS of her voice
 * are read side by side, each still carrying its own bare arm so a difference
 * can be told from a model having a bad day.
 *
 * The UI polls this while either run is still draining; the platform's worker
 * advances on the maintenance tick, so answers arrive a case at a time.
 *
 * Authentication: admin, as the list route beside it. Rate limiting is applied
 * by `proxy.ts` before this handler runs.
 *
 * @see lib/app/voice/comparison-admin.ts · .context/app/voice.md
 */

import { withAdminAuth } from '@/lib/auth/guards';
import { successResponse } from '@/lib/api/responses';
import { validatePathParam, validateQueryParams } from '@/lib/api/validation';
import { getRouteLogger } from '@/lib/api/context';
import { cuidSchema } from '@/lib/validations/common';
import { getVoiceComparison } from '@/lib/app/voice/comparison-admin';
import { voiceComparisonQuerySchema } from '@/lib/validations/app-voice-comparison';

export const GET = withAdminAuth<{ id: string }>(async (request, _session, { params }) => {
  const log = await getRouteLogger(request);
  const { id: raw } = await params;
  const id = validatePathParam(raw, cuidSchema, { label: 'comparison id' });
  const { against } = validateQueryParams(request.nextUrl.searchParams, voiceComparisonQuerySchema);

  // De-duplicated rather than rejected: `?against=` pointing at the comparison
  // already in the path is a harmless thing for a link to do, and answering it
  // with one set of columns is more useful than a 400.
  const ids =
    against && against !== id
      ? [id, validatePathParam(against, cuidSchema, { label: 'comparison id' })]
      : [id];
  const detail = await getVoiceComparison(ids);

  log.info('Voice comparison read', {
    comparisonIds: ids,
    columns: detail.columns.length,
    cases: detail.cases.length,
    mixedGoldenSets: detail.mixedGoldenSets,
  });
  return successResponse(detail);
});
