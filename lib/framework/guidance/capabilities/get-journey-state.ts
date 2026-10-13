/**
 * `get_journey_state` (f-guidance t-2, spec §5.4) — the engine's state, structured for
 * narration: every node's status + availability verdict (with lock reasons), the legal
 * `validMoves`, and the first-arrival `firsts`. A read tool an orientation/state agent
 * calls to know *where the user is* before it speaks. Not silent — it informs the reply.
 *
 * Surfaces authored map vocabulary (node keys) + engine verdicts + node statuses only —
 * never a captured slot value — so it is not `processesPii` (see the t-2 read-cap note).
 */

import { BaseCapability } from '@/lib/orchestration/capabilities/base-capability';
import { checkUserCaller } from '@/lib/framework/shared/caller';
import type {
  CapabilityContext,
  CapabilityFunctionDefinition,
  CapabilityResult,
} from '@/lib/orchestration/capabilities/types';
import type { LockReason } from '@/lib/framework/facilitation/engine/availability';
import { NODE_STATE_STATUS } from '@/lib/framework/facilitation/journey/vocabulary';
import { loadGuidance } from '@/lib/framework/guidance/guidance';
import {
  journeyArgsSchema,
  journeyArgProperties,
  journeyRequest,
  type JourneyArgs,
} from '@/lib/framework/guidance/capabilities/shared';

interface JourneyNodeView {
  nodeKey: string;
  status: string;
  available: boolean;
  lockReasons: readonly LockReason[];
}
interface JourneyStateData {
  journeyStarted: boolean;
  nodes: readonly JourneyNodeView[];
  validMoves: readonly string[];
  firsts: readonly string[];
}

export class GetJourneyStateCapability extends BaseCapability<JourneyArgs, JourneyStateData> {
  readonly slug = 'get_journey_state';

  readonly functionDefinition: CapabilityFunctionDefinition = {
    name: 'get_journey_state',
    description:
      "Read where the user currently is in a facilitation map: each node's status and whether it is available now (with reasons it is locked), plus the legal next moves. Read this to orient before responding.",
    parameters: {
      type: 'object',
      properties: { ...journeyArgProperties },
      required: ['graphSlug'],
    },
  };

  protected readonly schema = journeyArgsSchema;

  async execute(
    args: JourneyArgs,
    context: CapabilityContext
  ): Promise<CapabilityResult<JourneyStateData>> {
    const caller = checkUserCaller(context, 'Guidance');
    if (!caller.ok) return this.error(caller.message, caller.code);

    const { viewer, key } = journeyRequest(args, caller.userId);
    const guidance = await loadGuidance(viewer, key);
    if (guidance === null) {
      return this.success({ journeyStarted: false, nodes: [], validMoves: [], firsts: [] });
    }

    const statusByKey = new Map(guidance.context.nodeStates.map((s) => [s.nodeKey, s.status]));
    const nodes: JourneyNodeView[] = [];
    for (const [nodeKey, verdict] of guidance.availability.perNode) {
      nodes.push({
        nodeKey,
        status: statusByKey.get(nodeKey) ?? NODE_STATE_STATUS.unvisited,
        available: verdict.available,
        lockReasons: verdict.lockReasons,
      });
    }

    return this.success({
      journeyStarted: true,
      nodes,
      validMoves: guidance.availability.validMoves,
      firsts: guidance.availability.firsts,
    });
  }
}
