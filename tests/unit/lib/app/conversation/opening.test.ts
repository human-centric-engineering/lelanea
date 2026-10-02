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

const h = vi.hoisted(() => ({
  findFirst: vi.fn(),
  findUnique: vi.fn(),
  hasPassedGate: vi.fn(),
  getJourney: vi.fn(),
  getNodeStates: vi.fn(),
  resolveFacilitationSurface: vi.fn(),
  runFacilitationTurn: vi.fn(),
  streamChat: vi.fn(),
}));

vi.mock('@/lib/db/client', () => ({
  prisma: { appTurn: { findFirst: h.findFirst, findUnique: h.findUnique } },
}));
vi.mock('@/lib/logging', () => ({
  logger: { info: vi.fn(), warn: vi.fn(), error: vi.fn(), debug: vi.fn() },
}));
vi.mock('@/lib/app/gateway/gate', () => ({ hasPassedGate: h.hasPassedGate }));
vi.mock('@/lib/framework/facilitation/journey/queries', () => ({
  getJourney: h.getJourney,
  getNodeStates: h.getNodeStates,
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
  h.getJourney.mockResolvedValue({ id: 'journey-1' });
  h.getNodeStates.mockResolvedValue(HANDED_OFF);
  h.findFirst.mockResolvedValue(null);
  h.findUnique.mockResolvedValue(null);
  h.resolveFacilitationSurface.mockResolvedValue(SURFACE);
  h.runFacilitationTurn.mockResolvedValue('the-stream');
});

describe('mayOpen', () => {
  it('is true past the gate, handed off, with nothing else said on the facilitator seat', async () => {
    await expect(mayOpen(USER)).resolves.toBe(true);
    expect(h.hasPassedGate).toHaveBeenCalledWith(USER);
    expect(h.findFirst).toHaveBeenCalledWith({
      where: { userId: 'user-1', seat: 'facilitator', turnId: { not: OPENING_TURN_ID } },
      select: { id: true },
    });
  });

  it('is false before the gate, reading nothing else', async () => {
    h.hasPassedGate.mockResolvedValue(false);
    await expect(mayOpen(USER)).resolves.toBe(false);
    expect(h.getJourney).not.toHaveBeenCalled();
  });

  it('is false while onboarding is still active', async () => {
    h.getNodeStates.mockResolvedValue([{ nodeKey: 'onboarding', status: 'active' }]);
    await expect(mayOpen(USER)).resolves.toBe(false);
  });

  it('is false with no journey', async () => {
    h.getJourney.mockResolvedValue(null);
    await expect(mayOpen(USER)).resolves.toBe(false);
  });

  it('is false once the person has spoken on the facilitator seat', async () => {
    h.findFirst.mockResolvedValue({ id: 'turn-row' });
    await expect(mayOpen(USER)).resolves.toBe(false);
  });

  it('is false, not a throw, when a read fails', async () => {
    h.getNodeStates.mockRejectedValue(new Error('db down'));
    await expect(mayOpen(USER)).resolves.toBe(false);
  });
});

describe('openingDue', () => {
  it('is owed when there is no opening yet', async () => {
    await expect(openingDue(USER)).resolves.toBe(true);
    expect(h.findUnique).toHaveBeenCalledWith({
      where: { userId_turnId: { userId: 'user-1', turnId: OPENING_TURN_ID } },
      select: { status: true },
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

  it('is not owed where mayOpen says no, without reading the opening', async () => {
    h.hasPassedGate.mockResolvedValue(false);
    await expect(openingDue(USER)).resolves.toBe(false);
    expect(h.findUnique).not.toHaveBeenCalled();
  });
});

describe('prepareOpening', () => {
  it('resolves the facilitator surface when the opening may run', async () => {
    await expect(prepareOpening(USER)).resolves.toEqual({ ready: true, surface: SURFACE });
    expect(h.resolveFacilitationSurface).toHaveBeenCalledWith('user-1', 'facilitator');
  });

  it('refuses as not due, resolving nothing', async () => {
    h.findFirst.mockResolvedValue({ id: 'turn-row' });
    await expect(prepareOpening(USER)).resolves.toEqual({ ready: false, reason: OPENING_NOT_DUE });
    expect(h.resolveFacilitationSurface).not.toHaveBeenCalled();
  });

  it('refuses when no facilitator agent can speak', async () => {
    h.resolveFacilitationSurface.mockResolvedValue(null);
    await expect(prepareOpening(USER)).resolves.toEqual({ ready: false, reason: 'no_surface' });
  });
});

describe('runOpening', () => {
  it('runs a facilitator turn under the opening’s id, with the app’s words', async () => {
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

    // The run the hook is handed calls the platform with the same words, on
    // the facilitator surface, with whatever the hook adds.
    const run = h.runFacilitationTurn.mock.calls[0][1] as (extras: object) => unknown;
    run({ costLogMetadata: { turnId: OPENING_TURN_ID } });
    expect(h.streamChat).toHaveBeenCalledWith(
      expect.objectContaining({
        message: OPENING_MESSAGE,
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

describe('OPENING_MESSAGE', () => {
  it('passes the platform’s input guard', async () => {
    const { scanForInjection } = await vi.importActual<
      typeof import('@/lib/orchestration/chat/input-guard')
    >('@/lib/orchestration/chat/input-guard');
    expect(scanForInjection(OPENING_MESSAGE).flagged).toBe(false);
  });
});
