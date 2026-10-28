/**
 * Framework conversation supervisor — post-hoc review trigger (f-eval t-2, spec §5.5 F14).
 *
 * POST /api/v1/admin/framework/facilitation/evaluations/supervise — run the neutral supervisor over
 *      a whole framework conversation on-demand (`{ conversationId, modelOverride? }`); projects the
 *      conversation's turns onto the supervisor's input shape, audits, persists the verdict on the
 *      terminal-turn eval row, and returns the verdict + summary + report (201). Non-framework
 *      conversations → 400; unknown → 404; a conversation with no turns → 400.
 *
 * Admin-only; framework-tier path. Rate limiting is automatic via `proxy.ts`; the run is audited in
 * the service. Read the stored verdict back via GET /evaluations (the eval rows carry it). A monthly
 * spend cap refusing the judge answers 402 with the cap's code (`SpendCapRefusedError`).
 */

import { withAdminAuth } from '@/lib/auth/guards';
import { successResponse } from '@/lib/api/responses';
import { validateRequestBody } from '@/lib/api/validation';
import { getRouteLogger } from '@/lib/api/context';
import { getClientIP } from '@/lib/security/ip';
import { superviseConversation } from '@/lib/framework/facilitation/evaluation/supervise';
import { superviseConversationBodySchema } from '@/lib/framework/facilitation/evaluation/api-schemas';

export const POST = withAdminAuth(async (request, session) => {
  const clientIp = getClientIP(request);
  const log = await getRouteLogger(request);

  const body = await validateRequestBody(request, superviseConversationBodySchema);

  const result = await superviseConversation({
    conversationId: body.conversationId,
    actorUserId: session.user.id,
    clientIp,
    modelOverride: body.modelOverride,
  });

  log.info('Framework conversation supervised', {
    conversationId: result.conversationId,
    messageId: result.messageId,
    verdict: result.verdict,
    score: result.score,
    adminId: session.user.id,
  });
  return successResponse(result, undefined, { status: 201 });
});
