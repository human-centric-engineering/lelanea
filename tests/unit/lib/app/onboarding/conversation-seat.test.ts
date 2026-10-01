/**
 * Which seat the layout hands the conversation pane (f-onboarding t-105).
 *
 * @see lib/app/onboarding/conversation-seat.ts
 */

import { beforeEach, describe, expect, it, vi } from 'vitest';

const getDiscoveryState = vi.fn();
vi.mock('@/lib/app/onboarding/discovery-store', () => ({ getDiscoveryState }));

const { conversationSeatForUser } = await import('@/lib/app/onboarding/conversation-seat');
const { CONVERSATION_SEAT, ONBOARDING_SEAT } = await import('@/lib/app/conversation/seats');

function state(finished: boolean) {
  return { position: { next: finished ? null : 'q01', skipped: [], finished } };
}

beforeEach(() => vi.clearAllMocks());

describe('conversationSeatForUser', () => {
  it('is the onboarding seat while a question is still ahead of the person', async () => {
    getDiscoveryState.mockResolvedValue(state(false));

    await expect(conversationSeatForUser('user-1')).resolves.toBe(ONBOARDING_SEAT);
    expect(getDiscoveryState).toHaveBeenCalledWith('user-1');
  });

  it('is the facilitator seat once every question is answered or skipped', async () => {
    getDiscoveryState.mockResolvedValue(state(true));

    await expect(conversationSeatForUser('user-1')).resolves.toBe(CONVERSATION_SEAT);
  });

  it('falls back to the facilitator seat when the state could not be read', async () => {
    getDiscoveryState.mockResolvedValue(null);

    await expect(conversationSeatForUser('user-1')).resolves.toBe(CONVERSATION_SEAT);
  });

  it('names two different seats', () => {
    expect(ONBOARDING_SEAT).not.toBe(CONVERSATION_SEAT);
  });
});
