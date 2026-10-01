/**
 * Which seat the conversation pane speaks to, for one person, from server state
 * (f-onboarding t-105).
 *
 * The onboarding seat while the discovery questions are still ahead of them,
 * and the facilitator seat once every question in the current set is answered
 * or skipped. Read where the shell is rendered, so the first paint already
 * talks to the right seat; the questions surface moves the pane on in the
 * browser when the last one is behind them (`useOnboardingFinished`).
 *
 * A discovery state that could not be read gives the facilitator seat, the
 * pane's default, rather than holding someone in onboarding on a failed read.
 */

import { conversationSeatFor } from '@/lib/app/conversation/seats';
import { getDiscoveryState } from '@/lib/app/onboarding/discovery-store';

export async function conversationSeatForUser(userId: string): Promise<string> {
  const state = await getDiscoveryState(userId);
  return conversationSeatFor(state !== null && !state.position.finished);
}
