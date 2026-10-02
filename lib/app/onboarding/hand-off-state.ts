/**
 * Whether a person has begun the journey, from their node states (§3.9,
 * f-onboarding t-106). Pure; the transitions are in `hand-off.ts`.
 */

import { NODE_STATE_STATUS } from '@/lib/framework/facilitation/journey/vocabulary';
import { ONBOARDING_NODE_KEY, VALUES_NODE_KEY } from '@/lib/app/journey/map-definition';

/** The minimum of a node state the hand-off reads. */
export interface HandOffNodeState {
  nodeKey: string;
  status: string;
}

/**
 * Begun means Values has been entered and onboarding is no longer active.
 * Both, so a hand-off that failed between its two steps is still offered and
 * pressing again finishes it. "No longer active" rather than "completed", so a
 * journey that reached Values without ever entering onboarding is not offered
 * a step that has nothing left to do.
 */
export function handedOffFrom(states: readonly HandOffNodeState[]): boolean {
  const onboarding = states.find((s) => s.nodeKey === ONBOARDING_NODE_KEY);
  const values = states.find((s) => s.nodeKey === VALUES_NODE_KEY);
  return values !== undefined && onboarding?.status !== NODE_STATE_STATUS.active;
}
