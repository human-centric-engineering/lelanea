/**
 * The AI's opening after onboarding (f-onboarding t-122): when it is owed, and
 * that the turn it runs carries the app's words under the opening's id.
 *
 * The gate, the journey reads, the surface and the turn hook are mocked; their
 * own behaviour is tested where they live. The real chain — the hook, the
 * model, the ledger's once-only — is `npm run smoke:app-onboarding`, step 10.
 *
 * @see lib/app/conversation/opening.ts
 */

import { beforeEach, describe, expect, it, vi } from 'vitest';

import { isMarkedAgentOpened } from '@/lib/app/agent/turn-intake';

const h = vi.hoisted(() => ({
  messageFindFirst: vi.fn(),
  turnFindFirst: vi.fn(),
  findUnique: vi.fn(),
  safetyFindFirst: vi.fn(),
  hasPassedGate: vi.fn(),
  readJourneyNodeStates: vi.fn(),
  resolveFacilitationSurface: vi.fn(),
  runFacilitationTurn: vi.fn(),
  streamChat: vi.fn(),
}));

vi.mock('@/lib/db/client', () => ({
  prisma: {
    appTurn: { findFirst: h.turnFindFirst, findUnique: h.findUnique },
    aiMessage: { findFirst: h.messageFindFirst },
    appSafetyEvent: { findFirst: h.safetyFindFirst },
  },
}));
vi.mock('@/lib/logging', () => ({
  logger: { info: vi.fn(), warn: vi.fn(), error: vi.fn(), debug: vi.fn() },
}));
vi.mock('@/lib/app/gateway/gate', () => ({ hasPassedGate: h.hasPassedGate }));
vi.mock('@/lib/app/onboarding/first-run-store', () => ({
  readJourneyNodeStates: h.readJourneyNodeStates,
}));
vi.mock('@/lib/framework/facilitation/agents/surface', () => ({
  FACILITATION_SURFACE_CONTEXT_TYPE: 'facilitation',
  resolveFacilitationSurface: h.resolveFacilitationSurface,
}));
vi.mock('@/lib/framework/facilitation/agents/turn-hook', () => ({
  runFacilitationTurn: h.runFacilitationTurn,
}));
vi.mock('@/lib/orchestration/chat', () => ({ streamChat: h.streamChat }));

import {
  OPENING_MESSAGE,
  OPENING_NOT_DUE,
  OPENING_TURN_ID,
  MAX_OPENING_ATTEMPTS,
  mayOpen,
  openingDue,
  prepareOpening,
  runOpening,
} from '@/lib/app/conversation/opening';

const USER = { id: 'user-1', email: 'ada@example.com', emailVerified: true };
const SURFACE = {
  agentId: 'agent-1',
  agentSlug: 'lelanea',
  conversationId: undefined,
  rateLimitRpm: null,
};
const HANDED_OFF = [
  { nodeKey: 'onboarding', status: 'completed' },
  { nodeKey: 'values', status: 'active' },
];

beforeEach(() => {
  vi.clearAllMocks();
  h.hasPassedGate.mockResolvedValue(true);
  h.readJourneyNodeStates.mockResolvedValue(HANDED_OFF);
  h.messageFindFirst.mockResolvedValue(null);
  h.turnFindFirst.mockResolvedValue(null);
  h.safetyFindFirst.mockResolvedValue(null);
  h.findUnique.mockResolvedValue(null);
  h.resolveFacilitationSurface.mockResolvedValue(SURFACE);
  h.runFacilitationTurn.mockResolvedValue('the-stream');
});

describe('mayOpen', () => {
  it('is true past the gate, handed off, with nothing else said on the facilitator seat', async () => {
    await expect(mayOpen(USER)).resolves.toBe(true);
    expect(h.hasPassedGate).toHaveBeenCalledWith(USER);
    expect(h.messageFindFirst).toHaveBeenCalledWith({
      where: {
        role: 'user',
        conversation: { userId: 'user-1', contextType: 'facilitation', contextId: 'facilitator' },
      },
      select: { id: true },
    });
  });

  it('is false before the gate', async () => {
    h.hasPassedGate.mockResolvedValue(false);
    await expect(mayOpen(USER)).resolves.toBe(false);
  });

  it('is false while onboarding is still active', async () => {
    h.readJourneyNodeStates.mockResolvedValue([{ nodeKey: 'onboarding', status: 'active' }]);
    await expect(mayOpen(USER)).resolves.toBe(false);
    expect(h.readJourneyNodeStates).toHaveBeenCalledWith('user-1');
  });

  it('is false with no journey', async () => {
    h.readJourneyNodeStates.mockResolvedValue([]);
    await expect(mayOpen(USER)).resolves.toBe(false);
  });

  it('is false once the person has a message in a facilitator conversation, ledgered or not', async () => {
    h.messageFindFirst.mockResolvedValue({ id: 'message-row' });
    await expect(mayOpen(USER)).resolves.toBe(false);
  });

  it('is false once the person was answered with the crisis resource there, which records no turn', async () => {
    h.safetyFindFirst.mockResolvedValue({ id: 'safety-row' });
    await expect(mayOpen(USER)).resolves.toBe(false);
    expect(h.safetyFindFirst).toHaveBeenCalledWith({
      where: { userId: 'user-1', seat: 'facilitator' },
      select: { id: true },
    });
  });

  it('is false once any other turn is recorded there, an earlier version’s opening included', async () => {
    h.turnFindFirst.mockResolvedValue({ id: 'old-opening' });
    await expect(mayOpen(USER)).resolves.toBe(false);
    expect(h.turnFindFirst).toHaveBeenCalledWith({
      where: { userId: 'user-1', seat: 'facilitator', turnId: { not: OPENING_TURN_ID } },
      select: { id: true },
    });
  });

  it('gives up on an opening that has failed every attempt it gets', async () => {
    h.findUnique.mockResolvedValue({ status: 'failed', attempts: MAX_OPENING_ATTEMPTS });
    await expect(mayOpen(USER)).resolves.toBe(false);
    h.findUnique.mockResolvedValue({ status: 'failed', attempts: MAX_OPENING_ATTEMPTS - 1 });
    await expect(mayOpen(USER)).resolves.toBe(true);
  });

  it('is false, not a throw, when a read fails', async () => {
    h.readJourneyNodeStates.mockRejectedValue(new Error('db down'));
    await expect(mayOpen(USER)).resolves.toBe(false);
  });
});

describe('openingDue', () => {
  it('is owed when there is no opening yet', async () => {
    await expect(openingDue(USER)).resolves.toBe(true);
    expect(h.findUnique).toHaveBeenCalledWith({
      where: { userId_turnId: { userId: 'user-1', turnId: OPENING_TURN_ID } },
      select: { status: true, attempts: true },
    });
  });

  it.each(['running', 'failed'])('is owed while the opening is %s', async (status) => {
    h.findUnique.mockResolvedValue({ status });
    await expect(openingDue(USER)).resolves.toBe(true);
  });

  it('is not owed once the opening completed: it runs once per person', async () => {
    h.findUnique.mockResolvedValue({ status: 'completed' });
    await expect(openingDue(USER)).resolves.toBe(false);
  });

  it('is not owed with no agent to speak it: the route would refuse', async () => {
    h.resolveFacilitationSurface.mockResolvedValue(null);
    await expect(openingDue(USER)).resolves.toBe(false);
  });

  it('is not owed where mayOpen says no', async () => {
    h.hasPassedGate.mockResolvedValue(false);
    await expect(openingDue(USER)).resolves.toBe(false);
  });

  it('is not owed, not a throw, when the opening cannot be read', async () => {
    h.findUnique.mockRejectedValue(new Error('db down'));
    await expect(openingDue(USER)).resolves.toBe(false);
  });
});

describe('prepareOpening', () => {
  it('resolves the facilitator surface when the opening may run', async () => {
    await expect(prepareOpening(USER)).resolves.toEqual({ ready: true, surface: SURFACE });
    expect(h.resolveFacilitationSurface).toHaveBeenCalledWith('user-1', 'facilitator');
  });

  it('refuses as not due, resolving nothing', async () => {
    h.messageFindFirst.mockResolvedValue({ id: 'message-row' });
    await expect(prepareOpening(USER)).resolves.toEqual({ ready: false, reason: OPENING_NOT_DUE });
    expect(h.resolveFacilitationSurface).not.toHaveBeenCalled();
  });

  it('refuses when no facilitator agent can speak', async () => {
    h.resolveFacilitationSurface.mockResolvedValue(null);
    await expect(prepareOpening(USER)).resolves.toEqual({ ready: false, reason: 'no_surface' });
  });
});

describe('runOpening', () => {
  it('runs a turn the agent opens, under the opening’s id, with the app’s words', async () => {
    const signal = new AbortController().signal;
    const keepAlive = vi.fn();
    const events = await runOpening(SURFACE, {
      user: USER,
      requestId: 'req-1',
      signal,
      keepAlive,
    });

    expect(events).toBe('the-stream');
    expect(h.runFacilitationTurn).toHaveBeenCalledWith(
      expect.objectContaining({
        userId: 'user-1',
        role: 'facilitator',
        agentSlug: 'lelanea',
        message: OPENING_MESSAGE,
        clientTurnId: OPENING_TURN_ID,
        signal,
        keepAlive,
      }),
      expect.any(Function)
    );
    // Marked as the AI's, or the hook refuses its reserved id as a member's (t-160).
    expect(isMarkedAgentOpened(h.runFacilitationTurn.mock.calls[0][0])).toBe(true);

    // The run the hook is handed calls the platform with the same words, on
    // the facilitator surface, with whatever the hook adds.
    const run = h.runFacilitationTurn.mock.calls[0][1] as (extras: object) => unknown;
    run({ costLogMetadata: { turnId: OPENING_TURN_ID } });
    // `openingTurn`, never `message`: nothing is stored as the person's words.
    const request = h.streamChat.mock.calls[0][0] as Record<string, unknown>;
    expect(request).not.toHaveProperty('message');
    expect(h.streamChat).toHaveBeenCalledWith(
      expect.objectContaining({
        openingTurn: { content: OPENING_MESSAGE },
        agentSlug: 'lelanea',
        userId: 'user-1',
        contextType: 'facilitation',
        contextId: 'facilitator',
        requestId: 'req-1',
        costLogMetadata: { turnId: OPENING_TURN_ID },
      })
    );
  });
});
