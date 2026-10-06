/**
 * Where a turn's messages begin (`turnWindowStart`): a turn the agent opened —
 * the welcome (t-122) or a session recap (f-recap t-142) — reaches back by the
 * grace from its claim, because it has no row of the person's to start from.
 * A member's turn never does.
 *
 * @see lib/app/agent/turn-record.ts
 */

import { describe, expect, it, vi } from 'vitest';

vi.mock('@/lib/db/client', () => ({ prisma: { aiMessage: { findFirst: vi.fn() } } }));

import { NO_USER_ROW_GRACE_MS, turnWindowStart } from '@/lib/app/agent/turn-record';
import { OPENING_TURN_ID, recapTurnId } from '@/lib/app/conversation/opening-id';

const startedAt = new Date('2026-10-02T09:00:00.000Z');
const agentOpened = (turnId: string) => ({
  userId: 'user-1',
  turnId,
  startedAt,
  conversationId: 'c1',
  userMessageId: null,
});

describe('turnWindowStart', () => {
  it.each([
    ['the welcome', OPENING_TURN_ID],
    ['a session recap', recapTurnId('ses_2')],
  ])('reaches back by the grace for %s', async (_name, turnId) => {
    await expect(turnWindowStart(agentOpened(turnId))).resolves.toEqual(
      new Date(startedAt.getTime() - NO_USER_ROW_GRACE_MS)
    );
  });

  it('keeps the claim’s start for a member turn with no user message recorded', async () => {
    await expect(turnWindowStart(agentOpened('srv_member'))).resolves.toEqual(startedAt);
  });
});
