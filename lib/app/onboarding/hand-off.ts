/**
 * The hand-off: onboarding ends, and the person begins the journey in Values
 * (§3.9 "Begin the journey", f-onboarding t-106).
 *
 * Offered once the person has been through the discovery set, the Core Set or
 * the whole of it, with skipped questions allowed: they wait in Onboarding's
 * area. Beginning is two framework transitions through
 * `applyJourneyTransition`, each made only when it has not been already:
 *
 * 1. **Enter `values`**, unless the person has a state there. First, so a
 *    Values module that is not live (an operator set it back to `draft`)
 *    refuses before anything is written, and onboarding is not left completed
 *    with nothing current.
 * 2. **Complete `onboarding`**, while it is still active. The engine's
 *    conditional update makes a second `complete` a refusal with no write.
 *
 * ## Repeating it writes nothing
 *
 * An `enter` appends a `node.entered` event every time it is accepted, even on
 * a node already active, so this reads the node states first and skips each
 * step already done. Once both are done the answer is `already`, with no write.
 * A failure between the two steps is retried by pressing again: the step stays
 * offered until both are done (`handedOffFrom`).
 *
 * Two racing first presses can both see Values unentered and both enter. The
 * projection converges (an `enter` upserts to `active`) and the log gains a
 * second `node.entered`: the same accepted window as `ensureJourneyStarted`.
 *
 * ## The answers stay theirs to revise
 *
 * Completing the onboarding node closes it (`completionMode: 'once'`), but
 * nothing about the questions reads its status. Onboarding's area keeps the
 * whole set, answers are slot values that need no node, and a skip is still
 * recorded on the node, which `recordNodeProgress` accepts after completion
 * (the authored module says `produces.revisitable: true`).
 */

import { getJourney, getNodeStates } from '@/lib/framework/facilitation/journey/queries';
import { NODE_STATE_STATUS } from '@/lib/framework/facilitation/journey/vocabulary';
import { applyJourneyTransition } from '@/lib/framework/guidance/guidance';
import {
  JOURNEY_MAP_SLUG,
  ONBOARDING_NODE_KEY,
  VALUES_NODE_KEY,
} from '@/lib/app/journey/map-definition';
import { getDiscoveryState } from '@/lib/app/onboarding/discovery-store';
import { handedOffFrom } from '@/lib/app/onboarding/hand-off-state';
import { logger } from '@/lib/logging';

/**
 * What {@link beginJourney} did.
 *
 * - `begun` — this call wrote at least one of the two transitions.
 * - `already` — both were done before; nothing written.
 * - `not_finished` — a question in the current set is neither answered nor
 *   skipped; nothing written.
 * - `unavailable` — no journey to move on (it starts at the gate, never
 *   here), or the engine refused a transition (Values not live); nothing
 *   more written.
 * - `failed` — a read or a framework call threw; logged.
 */
export type BeginJourneyOutcome = 'begun' | 'already' | 'not_finished' | 'unavailable' | 'failed';

/**
 * Hand `userId` from onboarding into Values. Acts as the person themself.
 * Never throws.
 */
export async function beginJourney(userId: string): Promise<BeginJourneyOutcome> {
  const viewer = { userId };
  const key = { userId, graphSlug: JOURNEY_MAP_SLUG };

  try {
    const discovery = await getDiscoveryState(userId);
    if (discovery === null) return 'failed';
    if (!discovery.position.finished) return 'not_finished';

    // Never starts a journey. Starting one belongs to passing the gate, and
    // only the gate's callers check it: the shell layout's backstop starts
    // the journey of anyone past it before this step can render.
    const journey = await getJourney(viewer, key);
    if (!journey) return 'unavailable';
    const states = await getNodeStates(viewer, { journeyId: journey.id, subject: userId });
    if (handedOffFrom(states)) return 'already';

    let wrote = false;
    if (!states.some((s) => s.nodeKey === VALUES_NODE_KEY)) {
      const entered = await applyJourneyTransition(viewer, key, {
        nodeKey: VALUES_NODE_KEY,
        kind: 'enter',
      });
      if (entered === null || !entered.ok) {
        logger.warn('Journey not begun: Values could not be entered', {
          userId,
          rejection: entered === null ? 'journey_not_found' : entered.rejection.code,
        });
        return 'unavailable';
      }
      wrote = true;
    }

    const onboarding = states.find((s) => s.nodeKey === ONBOARDING_NODE_KEY);
    if (onboarding?.status === NODE_STATE_STATUS.active) {
      const completed = await applyJourneyTransition(viewer, key, {
        nodeKey: ONBOARDING_NODE_KEY,
        kind: 'complete',
      });
      // `not_active` is a racing press that completed it first: done either way.
      if (completed === null || (!completed.ok && completed.rejection.code !== 'not_active')) {
        logger.warn('Journey begun but onboarding could not be completed', {
          userId,
          rejection: completed === null ? 'journey_not_found' : completed.rejection.code,
        });
        return 'unavailable';
      }
      wrote = wrote || completed.ok;
    }

    if (!wrote) return 'already';
    logger.info('Journey begun', { userId, from: ONBOARDING_NODE_KEY, to: VALUES_NODE_KEY });
    return 'begun';
  } catch (error) {
    logger.error('Journey could not be begun', error, { userId });
    return 'failed';
  }
}
