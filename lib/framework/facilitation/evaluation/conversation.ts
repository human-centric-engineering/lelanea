/**
 * Shared framework-conversation gate for the eval adapters (f-eval). Both the metric scorer
 * (`./score-conversation`, t-1) and the post-hoc supervisor (`./supervise`, t-2) may only run over a
 * framework surface (`facilitation`/`module`) conversation; this loads the conversation and enforces
 * that gate once, so the two adapters can't drift on which surfaces are eligible.
 *
 * **Owner layer (Sunrise §115).** This read is unconfined: it reads a conversation whoever owns
 * it, which a caller the policy narrows is refused (`OwnerReadRefusedError`). Safe at every caller
 * today: the sweep runs it inside `runAcrossOwners`, and the admin triggers
 * (`/admin/framework/facilitation/evaluations[/supervise]`) are platform-only — a platform admin
 * is not narrowed. Opening one of those routes with `tier: 'org'` is a reviewed diff
 * (`ORG_TIER_ADMIN_ROUTES`); it would need the same `runAcrossOwners` around the call.
 */

import { prisma } from '@/lib/db/client';
import { NotFoundError, ValidationError } from '@/lib/api/errors';
import { FACILITATION_SURFACE_CONTEXT_TYPE } from '@/lib/framework/facilitation/agents/surface';
import { MODULE_SURFACE_CONTEXT_TYPE } from '@/lib/framework/guidance/surface';

/** The two framework surfaces whose conversations may be evaluated. */
export const FRAMEWORK_CONTEXT_TYPES: readonly string[] = [
  FACILITATION_SURFACE_CONTEXT_TYPE,
  MODULE_SURFACE_CONTEXT_TYPE,
];

/** A framework conversation, narrowed to the fields the eval adapters need. */
export interface FrameworkConversation {
  id: string;
  /** Always a framework surface once returned — the gate guarantees non-null + in-set. */
  contextType: string;
  contextId: string | null;
}

/**
 * Load a conversation and assert it is a framework (`facilitation`/`module`) surface. Throws
 * `NotFoundError` (unknown conversation) or `ValidationError` (not a framework surface).
 */
export async function loadFrameworkConversation(
  conversationId: string
): Promise<FrameworkConversation> {
  const conversation = await prisma.aiConversation.findUnique({
    where: { id: conversationId },
    select: { id: true, contextType: true, contextId: true },
  });
  if (!conversation) throw new NotFoundError(`Conversation "${conversationId}" not found`);
  if (
    conversation.contextType === null ||
    !FRAMEWORK_CONTEXT_TYPES.includes(conversation.contextType)
  ) {
    throw new ValidationError(
      'Only framework (facilitation/module) conversations can be evaluated',
      {
        contextType: [`"${conversation.contextType ?? 'none'}" is not a framework surface`],
      }
    );
  }
  return {
    id: conversation.id,
    contextType: conversation.contextType,
    contextId: conversation.contextId,
  };
}
