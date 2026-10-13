/**
 * `request_transition` (f-guidance t-3, spec §5.4) — the guidance layer's **write**
 * capability, split from the read family (t-2) by the write boundary (the f-slot-capture
 * `get_state`/`fill_slot` discipline). It asks the engine's **sole writer** `applyEvent` to
 * move the user's journey (`enter`/`complete` a node); the engine validates the move against
 * the live snapshot and either writes the event + projection in one transaction or returns a
 * structured `Rejection` (with the node's lock reasons) that never touches the DB.
 *
 * A refused move is a valid "not yet", not a tool failure — it returns `applied: false` +
 * the rejection so the agent narrates *why* ("that opens after you complete X"). The spec's
 * "may be user-confirmed first" is the agent's UX (it previews with `get_next_steps`, then
 * calls this) — not this capability's concern.
 *
 * Surfaces the new node status + authored lock reasons only — no captured slot value — so it
 * is not `processesPii` (like the read caps; unlike `fill_slot`, which writes slot values).
 */

import { z } from 'zod';
import { BaseCapability } from '@/lib/orchestration/capabilities/base-capability';
import { checkUserCaller } from '@/lib/framework/shared/caller';
import type {
  CapabilityContext,
  CapabilityFunctionDefinition,
  CapabilityResult,
} from '@/lib/orchestration/capabilities/types';
import type { Rejection } from '@/lib/framework/facilitation/engine/apply-event';
import { applyJourneyTransition } from '@/lib/framework/guidance/guidance';
import {
  journeyArgsSchema,
  journeyArgProperties,
  journeyRequest,
} from '@/lib/framework/guidance/capabilities/shared';

const requestTransitionSchema = journeyArgsSchema.extend({
  nodeKey: z.string().min(1),
  kind: z.enum(['enter', 'complete']),
});
type RequestTransitionArgs = z.infer<typeof requestTransitionSchema>;

interface TransitionData {
  /** False when there is no journey to act on — the map isn't published, or the user has
   *  not started this journey. Either way there is nothing to transition. */
  journeyStarted: boolean;
  /** Whether the engine accepted and wrote the move. */
  applied: boolean;
  /** The node the transition acted on. */
  nodeKey: string;
  /** The node's new status when applied; null on a refusal / not-started. */
  status: string | null;
  /** Present when the engine refused the move (with its reasons); null otherwise. */
  rejection: Rejection | null;
}

export class RequestTransitionCapability extends BaseCapability<
  RequestTransitionArgs,
  TransitionData
> {
  readonly slug = 'request_transition';

  readonly functionDefinition: CapabilityFunctionDefinition = {
    name: 'request_transition',
    description:
      "Ask the facilitation engine to move the user's journey: enter a node, or mark the current node complete. The engine validates the move and refuses (with reasons) if it is not allowed — never force a move; call get_next_steps first to see what is legal.",
    parameters: {
      type: 'object',
      properties: {
        ...journeyArgProperties,
        nodeKey: { type: 'string', description: 'The node to act on.', minLength: 1 },
        kind: {
          type: 'string',
          description: "'enter' to move into the node, 'complete' to finish the current node.",
          enum: ['enter', 'complete'],
        },
      },
      required: ['graphSlug', 'nodeKey', 'kind'],
    },
  };

  protected readonly schema = requestTransitionSchema;

  async execute(
    args: RequestTransitionArgs,
    context: CapabilityContext
  ): Promise<CapabilityResult<TransitionData>> {
    const caller = checkUserCaller(context, 'Guidance');
    if (!caller.ok) return this.error(caller.message, caller.code);

    const { viewer, key } = journeyRequest(args, caller.userId);
    const result = await applyJourneyTransition(viewer, key, {
      nodeKey: args.nodeKey,
      kind: args.kind,
    });

    if (result === null) {
      return this.success({
        journeyStarted: false,
        applied: false,
        nodeKey: args.nodeKey,
        status: null,
        rejection: null,
      });
    }
    if (result.ok) {
      return this.success({
        journeyStarted: true,
        applied: true,
        nodeKey: result.nodeState.nodeKey,
        status: result.nodeState.status,
        rejection: null,
      });
    }
    return this.success({
      journeyStarted: true,
      applied: false,
      nodeKey: args.nodeKey,
      status: null,
      rejection: result.rejection,
    });
  }
}
