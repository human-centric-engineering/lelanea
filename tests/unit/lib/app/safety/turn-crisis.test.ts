/**
 * The crisis path through the real turn seam (f-safety t-58).
 *
 * `runRecordedTurn` with real detection, real authored resources and real
 * deadlines; the turn store, the pause switch, the context check and the
 * database are mocked. What is proved is ORDER — the crisis check stands ahead
 * of the pause, the claim and the model:
 *
 * - a hard hit is answered with the crisis frame alone, and `run()` — the
 *   `streamChat` call — is never made: not with the model call throwing, not
 *   with generation paused;
 * - a soft hit's crisis frame precedes her first content frame.
 *
 * Move the crisis check below the pause or the claim and the first two fail:
 * the paused case gets `paused`, and the throwing case calls `run()`.
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';

import type { ChatStream } from '@/lib/orchestration/chat/types';
import type { ChatEvent } from '@/types/orchestration';

const mocks = vi.hoisted(() => ({
  paused: vi.fn(),
  check: vi.fn(),
  createEvent: vi.fn(),
  claimTurn: vi.fn(),
}));

vi.mock('@/lib/logging', () => ({
  logger: { warn: vi.fn(), error: vi.fn(), info: vi.fn(), debug: vi.fn() },
}));
vi.mock('@/lib/app/agent/availability', () => ({ isGenerationPaused: mocks.paused }));
vi.mock('@/lib/app/agent/settings', () => ({
  getAgentDeadlines: vi.fn(async () => ({ firstWordsDeadlineMs: 8_000, turnDeadlineMs: 60_000 })),
}));
vi.mock('@/lib/app/safety/context-check', () => ({ checkCrisisContext: mocks.check }));
vi.mock('@/lib/db/client', () => ({
  prisma: { appSafetyEvent: { create: mocks.createEvent } },
}));
vi.mock('@/lib/app/agent/turn-record', () => ({
  claimTurn: mocks.claimTurn,
  classifyPricing: vi.fn(async () => 'priced'),
  findReplayableTurn: vi.fn(async () => null),
  hashTurnRequest: vi.fn(async () => 'hash'),
  readAgentFingerprintVersion: vi.fn(async () => '1.0'),
  readTurnReply: vi.fn(async () => null),
  recordTurnCompleted: vi.fn(async () => 'completed'),
  recordTurnFailed: vi.fn(async () => undefined),
  recordTurnStarted: vi.fn(async () => undefined),
  staleClaimMs: vi.fn(() => 120_000),
}));

import { runRecordedTurn } from '@/lib/app/agent/turns';
import type { FacilitationTurn } from '@/lib/framework/facilitation/agents/turn-hook';

const TURN_ROW = { id: 'row-1', turnId: 'turn-1', seat: 'onboarding', attempts: 1 };

function turn(message: string, acceptLanguage = 'en-GB,en;q=0.8'): FacilitationTurn {
  return {
    userId: 'user-1',
    role: 'onboarding',
    agentId: 'agent-1',
    agentSlug: 'lelanea-guide',
    conversationId: undefined,
    message,
    clientTurnId: 'turn-1',
    headers: new Headers({ 'accept-language': acceptLanguage }),
  };
}

async function* herReply(): ChatStream {
  yield await Promise.resolve<ChatEvent>({ type: 'start', conversationId: 'conv-1' });
  yield { type: 'content', delta: 'I hear you.' };
  yield {
    type: 'done',
    tokenUsage: { inputTokens: 10, outputTokens: 3, totalTokens: 13 },
    costUsd: 0.001,
    model: 'gpt-4o-mini-2024-07-18',
    provider: 'openai',
  };
}

async function frames(result: Awaited<ReturnType<typeof runRecordedTurn>>): Promise<ChatEvent[]> {
  if ('refused' in result) throw new Error(`refused: ${result.reason}`);
  const out: ChatEvent[] = [];
  for await (const event of result) out.push(event);
  return out;
}

beforeEach(() => {
  vi.clearAllMocks();
  mocks.paused.mockResolvedValue(false);
  mocks.check.mockResolvedValue('confirmed');
  mocks.createEvent.mockResolvedValue({});
  mocks.claimTurn.mockResolvedValue({ kind: 'claimed', turn: TURN_ROW });
});

describe('runRecordedTurn — someone in danger', () => {
  describe('hard tier', () => {
    it('answers with the resource and never calls the model, whose call would throw', async () => {
      const run = vi.fn(() => {
        throw new Error('the model is down');
      });

      const out = await frames(await runRecordedTurn(turn('I want to kill myself'), run));

      expect(run).not.toHaveBeenCalled();
      expect(out).toHaveLength(1);
      expect(out[0]).toMatchObject({
        type: 'error',
        code: 'crisis',
        resource: { tier: 'hard', region: 'GB' },
      });
      // Nothing claimed: a hard turn writes no model turn.
      expect(mocks.claimTurn).not.toHaveBeenCalled();
    });

    it('answers with the resource while generation is paused', async () => {
      mocks.paused.mockResolvedValue(true);
      const run = vi.fn(() => herReply());

      const out = await frames(await runRecordedTurn(turn('I want to end my life'), run));

      expect(run).not.toHaveBeenCalled();
      expect(out.map((e) => [e.type, 'code' in e ? e.code : null])).toEqual([['error', 'crisis']]);
    });

    it('records the event, and chooses the services from the request’s language', async () => {
      await frames(await runRecordedTurn(turn('I want to kill myself', 'en-AU'), vi.fn()));
      expect(mocks.createEvent).toHaveBeenCalledWith({
        data: expect.objectContaining({ actedTier: 'hard', locale: 'en-AU', resourceRegion: 'AU' }),
      });
    });

    it('falls back to the directory when the request names no language', async () => {
      const t = { ...turn('I want to kill myself'), headers: undefined };
      const [frame] = await frames(await runRecordedTurn(t, vi.fn()));
      expect(frame).toMatchObject({ code: 'crisis', resource: { region: null } });
    });
  });

  describe('soft tier', () => {
    it('shows the resource before her first words, then her turn as usual', async () => {
      const run = vi.fn(() => herReply());

      const out = await frames(await runRecordedTurn(turn("I can't go on like this"), run));

      expect(run).toHaveBeenCalledTimes(1);
      expect(out.map((e) => e.type)).toEqual(['warning', 'start', 'content', 'done']);
      expect(out[0]).toMatchObject({ code: 'crisis', resource: { tier: 'soft' } });
    });

    it('a hard hit the context check softened runs her turn after the resource', async () => {
      mocks.check.mockResolvedValue('softened');
      const run = vi.fn(() => herReply());

      const out = await frames(
        await runRecordedTurn(turn('I could kill myself for forgetting that'), run)
      );

      expect(run).toHaveBeenCalledTimes(1);
      expect(out[0]).toMatchObject({ type: 'warning', code: 'crisis' });
      expect(out.findIndex((e) => e.type === 'content')).toBeGreaterThan(0);
    });

    it('shows the resource first even when generation is paused, then the paused ending', async () => {
      mocks.paused.mockResolvedValue(true);
      const run = vi.fn(() => herReply());

      const out = await frames(await runRecordedTurn(turn("I can't go on like this"), run));

      expect(run).not.toHaveBeenCalled();
      expect(out.map((e) => [e.type, 'code' in e ? e.code : null])).toEqual([
        ['warning', 'crisis'],
        ['error', 'paused'],
      ]);
    });
  });

  it('adds nothing to a turn that raised nothing', async () => {
    const out = await frames(
      await runRecordedTurn(
        turn('Help me plan my week'),
        vi.fn(() => herReply())
      )
    );
    expect(out.map((e) => e.type)).toEqual(['start', 'content', 'done']);
    expect(mocks.createEvent).not.toHaveBeenCalled();
  });
});
