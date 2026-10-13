/**
 * `suggest_focus` (f-guidance t-2, spec §5.4) — the facilitator voice: linger here vs move
 * on, with a reason. A thin read tool over the ranked moves; the agent narrates the call.
 *
 * Reasons reference authored node keys only (no captured slot value) — not `processesPii`.
 */

import { BaseCapability } from '@/lib/orchestration/capabilities/base-capability';
import { checkUserCaller } from '@/lib/framework/shared/caller';
import type {
  CapabilityContext,
  CapabilityFunctionDefinition,
  CapabilityResult,
} from '@/lib/orchestration/capabilities/types';
import type { FocusRecommendation } from '@/lib/framework/guidance/ranking';
import { loadFocusSuggestion } from '@/lib/framework/guidance/guidance';
import {
  journeyArgsSchema,
  journeyArgProperties,
  journeyRequest,
  type JourneyArgs,
} from '@/lib/framework/guidance/capabilities/shared';

interface FocusData {
  journeyStarted: boolean;
  recommendation: FocusRecommendation;
  reason: string;
  /** The node key a "move" would surface, when any is eligible. */
  topMove: string | null;
}

export class SuggestFocusCapability extends BaseCapability<JourneyArgs, FocusData> {
  readonly slug = 'suggest_focus';

  readonly functionDefinition: CapabilityFunctionDefinition = {
    name: 'suggest_focus',
    description:
      'Recommend whether to linger on the current focus or move on to a next step, with a reason. Use it to pace the conversation.',
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
  ): Promise<CapabilityResult<FocusData>> {
    const caller = checkUserCaller(context, 'Guidance');
    if (!caller.ok) return this.error(caller.message, caller.code);

    const { viewer, key } = journeyRequest(args, caller.userId);
    const suggestion = await loadFocusSuggestion(viewer, key);
    if (suggestion === null) {
      return this.success({
        journeyStarted: false,
        recommendation: 'linger',
        reason: 'The journey has not started yet.',
        topMove: null,
      });
    }

    return this.success({
      journeyStarted: true,
      recommendation: suggestion.recommendation,
      reason: suggestion.reason,
      topMove: suggestion.topMove?.nodeKey ?? null,
    });
  }
}
