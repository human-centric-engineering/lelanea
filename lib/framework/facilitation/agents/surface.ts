/**
 * Facilitation surface resolution (f-facilitation-agents t-2) — the read half that opens/resumes
 * a facilitation conversation for a **role**. The facilitation analog of f-guidance's
 * `resolveModuleSurface`, but keyed on a role (not a module) and — deliberately — carrying **no
 * scope map**.
 *
 * A facilitation seat's chat companion is its own `AiConversation` with the role's **bound
 * agent** (there is exactly one — `@@unique([role])` — so no `isPrimary` pick, unlike the module
 * surface). This resolves that surface for a `(user, role)`: the agent to talk to and the user's
 * existing surface conversation to resume (if any).
 *
 * Unlike `resolveModuleSurface`, it populates **no** `scope`: the guidance capabilities a
 * facilitation agent is granted are scope-agnostic (`get_journey_state` &c. read the caller's
 * user id + `args.graphSlug`, never `context.scope`), so "surface-scoping" here is purely *which agent
 * answers on which surface*, not capability refusal. (Forward caveat: this is safe only while
 * facilitation seats stay bound to scope-agnostic capabilities — a scope-gated capability reads
 * absent scope as allow-on-absent, so binding one to a seat would run it permissively here. Not a
 * concern for the guidance caps this feature targets.) Conversation resume delegates to core's
 * `findResumableConversation` on `(user, agent, contextType='facilitation', contextId=role)`,
 * mirroring the module surface — the seam landed in Sunrise 0.7.0 (#416), so neither surface
 * re-derives the `userId` scoping any more (v1.3 Phase 1 t-1.4).
 */

import { prisma } from '@/lib/db/client';
import { findResumableConversation } from '@/lib/orchestration/chat/resume-conversation';
import { getFacilitationBindingByRole } from '@/lib/framework/facilitation/agents/binding-queries';
import { isRoleAllowedAtStage } from '@/lib/framework/facilitation/policies/gating';

/** The `AiConversation.contextType` a facilitation surface's conversation is tagged with. */
export const FACILITATION_SURFACE_CONTEXT_TYPE = 'facilitation';

/** The resolved surface a chat route needs to open/continue a facilitation conversation. */
export interface FacilitationSurface {
  agentSlug: string;
  agentId: string;
  /** An existing surface conversation to resume, or `undefined` to open a new one. */
  conversationId: string | undefined;
  /** The agent's per-agent rate-limit override (RPM), or `null` — the route passes it to the
   *  limiter so the surface honours the same cap as the direct consumer route. */
  rateLimitRpm: number | null;
}

/**
 * Resolve the facilitation surface for a `(user, role)`, or `null` when the role has no usable,
 * end-user-facing bound agent. A role that is not a declared seat, or has no binding, or whose
 * bound agent is inactive/soft-deleted, all resolve to `null` (→ the route's 404) — no error is
 * thrown for an unknown role, mirroring how an unbound seat is simply absent.
 *
 * The bound agent must be **`public`**: the surface is end-user-facing, and an `internal` agent
 * (the DEFAULT visibility) carries a system prompt + capabilities not meant for end-users —
 * exposing it here would bypass the same visibility ACL the direct consumer chat route enforces.
 * (`invite_only` needs a token flow this route doesn't carry, so it is excluded too.)
 */
export async function resolveFacilitationSurface(
  userId: string,
  role: string
): Promise<FacilitationSurface | null> {
  // Relevance/maturity gating (f-policies t-2): a policy may restrict which roles a user can reach
  // given their journey stage/region. Disallowed → no surface (→ 404), same as an unbound seat.
  // Checked first: fail-open (no policies) is one cheap query, and a denied role must 404 exactly
  // like an unbound one (don't leak that the seat exists but is gated).
  if (!(await isRoleAllowedAtStage(userId, role))) return null;

  const binding = await getFacilitationBindingByRole(role);
  if (
    binding === null ||
    binding.agent === null ||
    !binding.agent.isActive ||
    binding.agent.deletedAt !== null
  ) {
    return null;
  }

  // The binding view carries no `visibility`/`rateLimitRpm`, so re-read them. Gate on visibility
  // BEFORE any conversation work: a non-public agent yields no surface (→ 404).
  const agent = await prisma.aiAgent.findUnique({
    where: { id: binding.agent.id },
    select: { visibility: true, rateLimitRpm: true },
  });
  if (agent === null || agent.visibility !== 'public') return null;

  // Resume the most-recent active surface conversation for this (user, agent, role), else leave
  // `conversationId` undefined so `streamChat` opens a new one (tagged with the contextType/
  // contextId the route passes).
  const existing = await findResumableConversation({
    userId,
    agentId: binding.agent.id,
    contextType: FACILITATION_SURFACE_CONTEXT_TYPE,
    contextId: role,
  });

  return {
    agentSlug: binding.agent.slug,
    agentId: binding.agent.id,
    conversationId: existing ?? undefined,
    rateLimitRpm: agent.rateLimitRpm,
  };
}
