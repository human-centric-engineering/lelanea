/**
 * Framework conversation evaluations — list + score (f-eval t-1, spec §5.5 F14).
 *
 * GET  /api/v1/admin/framework/facilitation/evaluations?conversationId=… — the per-turn eval rows
 *      for a framework conversation (most-recently-scored first).
 * POST /api/v1/admin/framework/facilitation/evaluations — score a framework conversation on-demand
 *      (`{ conversationId }`); runs the named-metric scorer over each turn, persists, and returns the
 *      summary + rows (201). Non-framework conversations → 400; unknown → 404.
 *
 * Admin-only; framework-tier path. Rate limiting is automatic via `proxy.ts`; the scoring run is
 * audited in the service. The eval review UI is `f-ops-views` (15). A monthly spend cap's refusal
 * answers 402 with the cap's code (`SpendCapRefusedError`, Sunrise 0.15.0).
 *
 * **Platform-only, and must stay so without a review.** An org admin's eval sweep scores every
 * member's framework conversations (`runAcrossOwners`), and the rows GET returns carry the judges'
 * verdicts and notes on them. Opening this route with `tier: 'org'` would let an org admin read
 * those for other members' conversations — decide that on purpose, not as a roster line.
 */

import { withAdminAuth } from '@/lib/auth/guards';
import { successResponse } from '@/lib/api/responses';
import { validateRequestBody } from '@/lib/api/validation';
import { getRouteLogger } from '@/lib/api/context';
import { getClientIP } from '@/lib/security/ip';
import { scoreConversation } from '@/lib/framework/facilitation/evaluation/score-conversation';
import { listConversationEvals } from '@/lib/framework/facilitation/evaluation/queries';
import {
  scoreConversationBodySchema,
  parseConversationIdParam,
} from '@/lib/framework/facilitation/evaluation/api-schemas';

export const GET = withAdminAuth(async (request) => {
  const log = await getRouteLogger(request);
  const conversationId = parseConversationIdParam(
    new URL(request.url).searchParams.get('conversationId')
  );

  const evaluations = await listConversationEvals(conversationId);

  log.info('Framework conversation evaluations listed', {
    conversationId,
    count: evaluations.length,
  });
  return successResponse(evaluations);
});

export const POST = withAdminAuth(async (request, session) => {
  const clientIp = getClientIP(request);
  const log = await getRouteLogger(request);

  const body = await validateRequestBody(request, scoreConversationBodySchema);

  const result = await scoreConversation({
    conversationId: body.conversationId,
    actorUserId: session.user.id,
    clientIp,
  });

  log.info('Framework conversation scored', {
    conversationId: result.conversationId,
    scoredTurns: result.scoredTurns,
    skippedTurns: result.skippedTurns,
    adminId: session.user.id,
  });
  return successResponse(result, undefined, { status: 201 });
});
