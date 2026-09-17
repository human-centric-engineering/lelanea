/**
 * Module surface chat — streaming (SSE). f-guidance t-5 (spec X5).
 *
 * POST /api/v1/framework/modules/:slug/chat/stream
 *
 * Opens (or resumes) the surface-scoped conversation for a module: resolves the module's
 * **bound primary agent**, tags the conversation with `contextType: 'module'` /
 * `contextId: <slug>`, and — the point of X5 — threads `scope.moduleSlug` into the dispatch
 * so a module's capabilities actually refuse out-of-module calls (`isInModuleScope`).
 *
 * A framework-owned route (under the `framework` API segment) so the surface resolution stays
 * on the framework side of the tier boundary and the core `streamChat` handler is reused
 * unchanged. Auth + baseline rate limit mirror the consumer chat route; the agent is resolved
 * from the module, not supplied.
 *
 * **Why this route still exists** (decision 6's original reason — "the core consumer
 * route/schema can't carry `scope`" — expired with Sunrise #415, which added `scope` to
 * `consumerChatRequestSchema`; v1.3 Phase 1 t-1.3 rechecked it). Three reasons that have
 * nothing to do with `scope`:
 *
 * 1. **The agent is server-resolved** from the module's primary binding, and gated on
 *    `visibility === 'public'`. The consumer route takes an agent id/slug from the caller.
 * 2. **The context tuple.** This route tags the conversation `contextType: 'module'` /
 *    `contextId: <slug>` — which the core consumer route deliberately refuses ("no
 *    contextType/contextId/entityContext — admin-only concepts"). Delegating to it would
 *    leave every new surface conversation untagged, and **resume would break**, because
 *    resume is a lookup on exactly that tuple.
 * 3. **`module.entered`** is emitted here, on the surface's own entry point.
 *
 * And `scope` argues the same way round: here it is **server-derived**
 * (`encodeScope({ moduleSlug })` in `resolveModuleSurface`). Threading it through the core
 * consumer route would move a capability-refusal input onto a client-supplied field.
 */

import { z } from 'zod';
import { withAuth } from '@/lib/auth/guards';
import { sseResponse } from '@/lib/api/sse';
import { validateRequestBody } from '@/lib/api/validation';
import { getRouteLogger } from '@/lib/api/context';
import {
  consumerChatLimiter,
  agentChatLimiter,
  createRateLimitResponse,
} from '@/lib/security/rate-limit';
import { streamChat } from '@/lib/orchestration/chat';
import { getRequestId, getVisitorId } from '@/lib/logging/context';
import { NotFoundError } from '@/lib/api/errors';
import {
  resolveModuleSurface,
  MODULE_SURFACE_CONTEXT_TYPE,
} from '@/lib/framework/guidance/surface';
import { recordModuleEngagement, ENGAGEMENT_EVENT_TYPE } from '@/lib/framework/engagement';

const surfaceChatRequestSchema = z.object({
  message: z.string().min(1),
});

export const POST = withAuth<{ slug: string }>(
  async (request, session, { params }) => {
    const userLimit = consumerChatLimiter.check(session.user.id);
    if (!userLimit.success) return createRateLimitResponse(userLimit);

    const log = await getRouteLogger(request);
    const { slug } = await params;
    const body = await validateRequestBody(request, surfaceChatRequestSchema);
    const requestId = await getRequestId();
    const visitorId = await getVisitorId();

    // Resolve the module's primary-agent surface. NotFoundError (unknown module) propagates to
    // the standard 404; a bound-but-no-usable-agent module returns null → an explicit 404.
    const surface = await resolveModuleSurface(session.user.id, slug);
    if (surface === null) {
      throw new NotFoundError(`Module "${slug}" has no active agent to chat with`);
    }

    // Honour the agent's per-agent RPM override (as the direct consumer route does), so the
    // same agent enforces one cap regardless of entry surface.
    const agentLimit = agentChatLimiter.check(
      `${surface.agentId}:${session.user.id}`,
      surface.rateLimitRpm ?? undefined
    );
    if (!agentLimit.success) return createRateLimitResponse(agentLimit);

    log.info('Module surface chat stream started', {
      moduleSlug: slug,
      agentSlug: surface.agentSlug,
      resumed: surface.conversationId !== undefined,
      userId: session.user.id,
    });

    // A fresh surface conversation (nothing to resume) is a module *entry* — record it as
    // an engagement event and fire any `module.entered` workflow bindings. Fire-and-forget:
    // the seam is best-effort and non-throwing, so instrumentation never blocks or breaks
    // the chat stream. A resumed conversation is not a new entry, so it emits nothing.
    if (surface.conversationId === undefined) {
      void recordModuleEngagement({
        userId: session.user.id,
        moduleSlug: slug,
        type: ENGAGEMENT_EVENT_TYPE.moduleEntered,
      });
    }

    const events = streamChat({
      message: body.message,
      agentSlug: surface.agentSlug,
      userId: session.user.id,
      conversationId: surface.conversationId,
      contextType: MODULE_SURFACE_CONTEXT_TYPE,
      contextId: slug,
      scope: surface.scope, // { moduleSlug: slug } — the X5 write that enforces module scope
      requestId,
      visitorId,
      signal: request.signal,
    });

    return sseResponse(events, { signal: request.signal });
  },
  {
    // Ownership: self-scoped by construction — see RouteOwnership in lib/auth/guards.ts.
    ownership: {
      decidedBy: 'self',
      because:
        "The surface conversation it resumes, the module.entered event it records and every row streamChat writes are keyed on the caller's own id.",
    },
  }
);
