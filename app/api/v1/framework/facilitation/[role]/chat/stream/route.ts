/**
 * Facilitation surface chat — streaming (SSE). f-facilitation-agents t-2.
 *
 * POST /api/v1/framework/facilitation/:role/chat/stream
 *
 * Opens (or resumes) the surface-scoped conversation for a facilitation **role**: resolves the
 * role's **bound agent**, tags the conversation with `contextType: 'facilitation'` /
 * `contextId: <role>`, and streams through the core `streamChat` handler.
 *
 * A framework-owned route (under the `framework` API segment f-guidance t-5 already registered)
 * so the surface resolution stays on the framework side of the tier boundary and the core
 * `streamChat` handler is reused unchanged. Auth + baseline rate limit mirror the module surface
 * route; the agent is resolved from the role, not supplied. Unlike the module surface, **no
 * `scope` is threaded** — a facilitation agent's guidance capabilities are scope-agnostic
 * (decision 4), so the surface only decides which agent answers, not capability refusal.
 *
 * **Not a `scope`-threading shim** (v1.3 Phase 1 t-1.3 rechecked this against Sunrise #415,
 * which added `scope` to the core consumer schema). This route threads no `scope` at all, so
 * #415 never applied to it. It exists because the agent is **server-resolved** from the role
 * binding (and gated on `visibility === 'public'` plus the stage/region policy) and because it
 * tags the conversation `contextType: 'facilitation'` / `contextId: <role>` — a tuple the core
 * consumer route deliberately refuses as an admin-only concept, and the exact tuple resume
 * looks up.
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
  resolveFacilitationSurface,
  FACILITATION_SURFACE_CONTEXT_TYPE,
} from '@/lib/framework/facilitation/agents/surface';
// Lelañea divergence (.context/app/divergences.md Row 18): a leaf-fillable turn hook.
import { runFacilitationTurn } from '@/lib/framework/facilitation/agents/turn-hook';

const surfaceChatRequestSchema = z.object({
  message: z.string().min(1),
  // Optional client id for the turn, passed to the hook untouched. Row 18.
  turnId: z.string().trim().min(1).max(128).optional(),
});

export const POST = withAuth<{ role: string }>(
  async (request, session, { params }) => {
    const userLimit = consumerChatLimiter.check(session.user.id);
    if (!userLimit.success) return createRateLimitResponse(userLimit);

    const log = await getRouteLogger(request);
    const { role } = await params;
    const body = await validateRequestBody(request, surfaceChatRequestSchema);
    const requestId = await getRequestId();
    const visitorId = await getVisitorId();

    // Resolve the role's bound-agent surface. An unknown/unbound role, or a role whose agent is
    // inactive/non-public, yields null → an explicit 404 (no facilitation surface to open).
    const surface = await resolveFacilitationSurface(session.user.id, role);
    if (surface === null) {
      throw new NotFoundError(`Facilitation seat "${role}" has no active agent to chat with`);
    }

    // Honour the agent's per-agent RPM override (as the direct consumer route does), so the same
    // agent enforces one cap regardless of entry surface.
    const agentLimit = agentChatLimiter.check(
      `${surface.agentId}:${session.user.id}`,
      surface.rateLimitRpm ?? undefined
    );
    if (!agentLimit.success) return createRateLimitResponse(agentLimit);

    log.info('Facilitation surface chat stream started', {
      facilitationRole: role,
      agentSlug: surface.agentSlug,
      resumed: surface.conversationId !== undefined,
      userId: session.user.id,
    });

    const events = await runFacilitationTurn(
      {
        userId: session.user.id,
        role,
        agentId: surface.agentId,
        agentSlug: surface.agentSlug,
        conversationId: surface.conversationId,
        message: body.message,
        clientTurnId: body.turnId,
      },
      (extras) =>
        streamChat({
          message: body.message,
          agentSlug: surface.agentSlug,
          userId: session.user.id,
          conversationId: surface.conversationId,
          contextType: FACILITATION_SURFACE_CONTEXT_TYPE,
          contextId: role,
          requestId,
          visitorId,
          signal: request.signal,
          ...extras,
        })
    );

    return sseResponse(events, { signal: request.signal });
  },
  {
    // Ownership: self-scoped by construction — see RouteOwnership in lib/auth/guards.ts.
    ownership: {
      decidedBy: 'self',
      because:
        "The surface conversation it resumes and every row streamChat writes are keyed on the caller's own id; the role is a public URL segment, not a subject.",
    },
  }
);
