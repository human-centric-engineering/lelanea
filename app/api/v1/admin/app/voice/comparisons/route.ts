/**
 * Voice comparisons — list and queue (Admin)
 *
 * GET  /api/v1/admin/app/voice/comparisons
 *   Every comparison this install has run, newest first, with each arm's run
 *   status, progress and mean brand-voice score.
 *
 * POST /api/v1/admin/app/voice/comparisons
 *   Queue one: two platform evaluation runs over the same golden set — her
 *   assembled prompt path, and a bare model — refusing if the two arms would not
 *   actually differ. Takes no body: what runs is the authored golden set and the
 *   two seeded agents, and a parameter here would be a way to run a comparison
 *   that is not the comparison.
 *
 * Authentication: admin. `withAdminAuth` answers 401 unauthenticated and 403 for
 * a signed-in non-admin, and admits an `admin`-scoped API key — so a comparison
 * can be queued from CI without a second auth path.
 *
 * ## Rate limiting: nothing to do here, and that is the design
 *
 * `proxy.ts` has already applied the `'admin'` section tier before this handler
 * runs — `RATE_LIMIT_POLICY` matches `/api/v1/admin/` as a prefix, so a new admin
 * route inherits the cap with no handler work. Handlers must never call a section
 * limiter themselves.
 *
 * A POST does spend real money — two runs of every case, plus a judge call each —
 * but the spend is the platform's to cap: `AiAgent.monthlyBudgetUsd` and the
 * orchestration settings' per-turn cap both apply to the turns the worker drains,
 * and a second cap here would be a number nobody could see from the costs page.
 *
 * @see lib/app/voice/comparison.ts · .context/app/voice.md
 */

import { withAdminAuth } from '@/lib/auth/guards';
import { successResponse } from '@/lib/api/responses';
import { getRouteLogger } from '@/lib/api/context';
import { listVoiceComparisons } from '@/lib/app/voice/comparison-admin';
import { queueVoiceComparison } from '@/lib/app/voice/comparison';

export const GET = withAdminAuth(async (request, _session) => {
  const log = await getRouteLogger(request);

  const comparisons = await listVoiceComparisons();

  log.info('Voice comparisons listed', { count: comparisons.length });
  return successResponse(comparisons);
});

export const POST = withAdminAuth(async (request, session) => {
  const log = await getRouteLogger(request);

  // Every refusal `queueVoiceComparison` can make is a `ValidationError` naming
  // the arm and the remedy, so it reaches the caller as a 400 with something
  // actionable in it rather than being caught and flattened here.
  const queued = await queueVoiceComparison(session.user.id);

  log.info('Voice comparison queued', {
    comparisonId: queued.comparisonId,
    goldenSetVersion: queued.goldenSetVersion,
    caseCount: queued.caseCount,
  });
  return successResponse(queued, undefined, { status: 201 });
});
