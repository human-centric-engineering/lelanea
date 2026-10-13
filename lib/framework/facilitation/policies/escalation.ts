/**
 * Facilitation escalation contributor (f-emergence t-1, spec §5.5 F15 — picked up from f-policies'
 * deferred t-4). The framework half of the generic post-detection guard-event core seam: when an
 * inline guard fires on a facilitation role's surface, an `escalation` policy scoped to that role
 * turns the detection into a **defined, auditable pathway** — notify a human reviewer (via the
 * shipped escalation-notifier) and always log to the audit trail. This is the difference between a
 * silent guard block and a configured incident response (F15).
 *
 * Registered into the core `registerGuardEventContributor` seam at `initFramework`, and invoked
 * fire-and-forget (a guard-event handler never delays or breaks a turn). Only facilitation-surface
 * turns are considered; everything else returns immediately. v1 response = notify + log;
 * conversation-rerouting (a workflow via `drainEngine`) + user-facing resources are a follow-up.
 */

import { isEmbedUserId, userIdForUserRef } from '@/lib/embed/auth';
import type { GuardEvent, GuardEventContext } from '@/lib/orchestration/chat/guard-events';
import type { GuardMode } from '@/lib/orchestration/chat/guard-floor';
import { FACILITATION_SURFACE_CONTEXT_TYPE } from '@/lib/framework/facilitation/agents/surface';
import { listEnabledFacilitationPolicies } from '@/lib/framework/facilitation/policies/policy-queries';
import {
  escalationPayloadSchema,
  type EscalationPayload,
} from '@/lib/framework/facilitation/policies/kinds';
import { notifyEscalation } from '@/lib/orchestration/capabilities/built-in/escalation-notifier';
import { logAdminAction } from '@/lib/orchestration/audit/admin-audit-logger';
import { logger } from '@/lib/logging';

/** The registration key for the core guard-event seam (idempotent per key). */
export const FACILITATION_ESCALATION_KEY = 'facilitation-escalation';

/**
 * Observed-outcome severity on the escalation scale. The core guard-event reports the effective
 * `GuardMode` the guard acted in (`none` … `block`); an escalation policy signals on a coarser
 * binary — `flagged` (any detection) vs `blocked` (a hard `block`). `none` is a guard the operator
 * disabled — it emits an event but must never escalate (severity 0, below even `flagged`). An armed
 * guard that flagged without blocking (`log_only` / `warn_and_continue`) is a `flagged` detection;
 * only a hard `block` is `blocked`.
 */
const OUTCOME_SEVERITY: Record<GuardMode, number> = {
  none: 0,
  log_only: 1,
  warn_and_continue: 1,
  block: 2,
};

/** Severity of a policy's MINIMUM-to-fire `signal.outcome` (`flagged` = any detection). */
const POLICY_MINIMUM_SEVERITY: Record<EscalationPayload['signal']['outcome'], number> = {
  flagged: 1,
  blocked: 2,
};

/** Whether an observed outcome meets a policy's MINIMUM-severity `signal.outcome`. */
function outcomeMeetsMinimum(
  policyMinimum: EscalationPayload['signal']['outcome'],
  observed: GuardEvent['outcome']
): boolean {
  return OUTCOME_SEVERITY[observed] >= POLICY_MINIMUM_SEVERITY[policyMinimum];
}

/**
 * Handle a guard firing on a facilitation surface: for each enabled `escalation` policy scoped to
 * the turn's role whose `signal` matches this guard at (or above) its minimum severity, dispatch the
 * escalation (notify + log). No-op for non-facilitation turns or when no policy matches.
 */
export async function handleFacilitationGuardEvent(
  ctx: GuardEventContext,
  event: GuardEvent
): Promise<void> {
  if (ctx.contextType !== FACILITATION_SURFACE_CONTEXT_TYPE || !ctx.contextId) return;

  const policies = await listEnabledFacilitationPolicies('escalation');
  if (policies.length === 0) return;

  for (const policy of policies) {
    const parsed = escalationPayloadSchema.safeParse(policy.payload);
    if (!parsed.success) {
      logger.warn('Skipping malformed escalation policy', { policyId: policy.id });
      continue;
    }
    const { scope, signal, priority } = parsed.data;
    if (scope.type !== 'facilitation_role' || scope.id !== ctx.contextId) continue;
    if (signal.guard !== event.guard) continue;
    if (!outcomeMeetsMinimum(signal.outcome, event.outcome)) continue;

    await dispatchEscalation(ctx, event, priority);
  }
}

async function dispatchEscalation(
  ctx: GuardEventContext,
  event: GuardEvent,
  priority: EscalationPayload['priority']
): Promise<void> {
  const reason = `Facilitation guard '${event.guard}' ${event.outcome} on role '${ctx.contextId}'`;

  // An embed widget visitor's `ctx.userId` is an `embed_<hash>` id, not a `User` (Sunrise #705,
  // t-765). Detected from the id itself — the one signal `userIdForUserRef` also reads — so the two
  // can never disagree. A reader of `userId` gets `null`.
  const isVisitor = isEmbedUserId(ctx.userId);

  // Notify a human reviewer — email/webhook per the global escalationConfig, which applies its own
  // priority threshold. Never throws. No caller identifier goes in `metadata`: it reaches an
  // external webhook, and core's notifier sends none for a signed-in user or a visitor either.
  await notifyEscalation({
    agentId: ctx.agentId,
    userId: userIdForUserRef(ctx.userId),
    conversationId: ctx.conversationId,
    reason,
    priority,
    metadata: {
      source: 'facilitation_escalation',
      guard: event.guard,
      outcome: event.outcome,
      role: ctx.contextId ?? null,
    },
  });

  // Always log. The actor is the system (a guard fired), not an admin, so `userId` is null; the
  // affected user is recorded in metadata — a visitor as `embedVisitorId`, which is the same id this
  // row held under `affectedUserId` before 0.14.0, under a key that does not claim it is a `User`.
  logAdminAction({
    userId: null,
    action: 'facilitation_escalation.triggered',
    entityType: 'facilitation_escalation',
    entityId: ctx.conversationId,
    entityName: ctx.contextId,
    metadata: {
      guard: event.guard,
      outcome: event.outcome,
      role: ctx.contextId,
      priority,
      affectedUserId: userIdForUserRef(ctx.userId),
      ...(isVisitor ? { embedVisitorId: ctx.userId } : {}),
    },
    clientIp: null,
  });
}
