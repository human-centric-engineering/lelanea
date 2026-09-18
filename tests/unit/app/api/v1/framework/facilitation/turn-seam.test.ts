/**
 * The turn seam in Daybreak's facilitation route — at rest, and wired (§08 t-54).
 *
 * Lelañea carries a seam in a file Daybreak owns (`.context/app/divergences.md`,
 * Row 18). `B19` asks three things of it, demonstrated rather than asserted:
 * generic, ledgered, and **behaviour-neutral at rest**. The last is this file's
 * first half: with the hook at its shipped pass-through, the route calls
 * `streamChat` with exactly the arguments it always did — asserted as the WHOLE
 * object, so an extra key fails — and a `turnId` in the body changes nothing.
 *
 * "At rest" is the real framework registry with nothing in it — not a mock
 * standing in for the default, which could drift from it.
 *
 * The second half is the wiring, which is the load-bearing test for the task:
 * a shipped seam with no caller is an integration nobody owns (`fp1`). A hook
 * registered through the real registry proves the route hands it the turn,
 * merges what it returns into `streamChat`, and turns a refusal into a status
 * code before any stream is opened. That `initLeafApp()` registers Lelañea's —
 * `runRecordedTurn`, by identity — is pinned in
 * `tests/unit/lib/app/defaults.test.ts`.
 *
 * What only a real database can prove — the route reaching the hook in a
 * running app, one model call for two requests — is `scripts/app/smoke-turn.ts`.
 */

import { describe, it, expect, beforeEach, vi } from 'vitest';
import type { NextRequest } from 'next/server';

vi.mock('@/lib/auth/config', () => ({ auth: { api: { getSession: vi.fn() } } }));
vi.mock('@/lib/security/rate-limit', () => ({
  consumerChatLimiter: { check: vi.fn(() => ({ success: true })) },
  agentChatLimiter: { check: vi.fn(() => ({ success: true })) },
  createRateLimitResponse: vi.fn(() => new Response(null, { status: 429 })),
}));
vi.mock('@/lib/orchestration/chat', () => ({ streamChat: vi.fn(() => ({ stream: true })) }));
vi.mock('@/lib/api/sse', () => ({
  sseResponse: vi.fn(() => new Response('data: ok\n\n', { status: 200 })),
}));
vi.mock('@/lib/logging/context', () => ({
  getRequestId: vi.fn(() => Promise.resolve('req-1')),
  getVisitorId: vi.fn(() => Promise.resolve('vid-1')),
}));
vi.mock('@/lib/framework/facilitation/agents/surface', () => ({
  resolveFacilitationSurface: vi.fn(),
  FACILITATION_SURFACE_CONTEXT_TYPE: 'facilitation',
}));
import { POST } from '@/app/api/v1/framework/facilitation/[role]/chat/stream/route';
import { auth } from '@/lib/auth/config';
import { streamChat } from '@/lib/orchestration/chat';
import { sseResponse } from '@/lib/api/sse';
import { resolveFacilitationSurface } from '@/lib/framework/facilitation/agents/surface';
import {
  __resetFacilitationTurnHookForTests,
  registerFacilitationTurnHook,
  type FacilitationTurnHook,
} from '@/lib/framework/facilitation/agents/turn-hook';

const req = (body: unknown): NextRequest =>
  ({
    json: async () => body,
    headers: new Headers(),
    url: 'http://localhost/api/v1/framework/facilitation/onboarding/chat/stream',
    signal: new AbortController().signal,
  }) as unknown as NextRequest;

const ctx = (role = 'onboarding') => ({ params: Promise.resolve({ role }) });

/** Exactly what the route passed `streamChat` before the seam existed. */
const PRE_SEAM_ARGS = {
  message: 'hi',
  agentSlug: 'lelanea-guide',
  userId: 'user-1',
  conversationId: 'conv-9',
  contextType: 'facilitation',
  contextId: 'onboarding',
  requestId: 'req-1',
  visitorId: 'vid-1',
  signal: expect.any(AbortSignal),
};

beforeEach(() => {
  vi.clearAllMocks();
  // Nothing registered: the framework's own default, with no mock standing in.
  __resetFacilitationTurnHookForTests();
  vi.mocked(auth.api.getSession).mockResolvedValue({
    user: { id: 'user-1' },
    session: { id: 's1' },
  } as never);
  vi.mocked(resolveFacilitationSurface).mockResolvedValue({
    agentSlug: 'lelanea-guide',
    agentId: 'agent-1',
    conversationId: 'conv-9',
    rateLimitRpm: null,
  });
});

describe('at rest — nothing registered', () => {
  it('calls streamChat with exactly the arguments it always did', async () => {
    const res = await POST(req({ message: 'hi' }), ctx());

    expect(res.status).toBe(200);
    expect(streamChat).toHaveBeenCalledTimes(1);
    // The whole object: an added key — costLogMetadata, messageMetadata, a
    // turnId leaking through — fails here.
    expect(vi.mocked(streamChat).mock.calls[0][0]).toEqual(PRE_SEAM_ARGS);
    // And the stream it returned is what reaches the response, untouched.
    expect(vi.mocked(sseResponse).mock.calls[0][0]).toEqual({ stream: true });
  });

  it('accepts a turnId and ignores it', async () => {
    const res = await POST(req({ message: 'hi', turnId: 'turn-abc' }), ctx());

    expect(res.status).toBe(200);
    expect(vi.mocked(streamChat).mock.calls[0][0]).toEqual(PRE_SEAM_ARGS);
  });

  it.each([
    ['empty', ''],
    ['whitespace only', '   '],
    ['longer than 128 characters', 'x'.repeat(129)],
    ['not a string', 42],
  ])('refuses a turnId that is %s with 400, before anything runs', async (_label, turnId) => {
    const res = await POST(req({ message: 'hi', turnId }), ctx());

    expect(res.status).toBe(400);
    expect(resolveFacilitationSurface).not.toHaveBeenCalled();
    expect(streamChat).not.toHaveBeenCalled();
  });
});

describe('wired — the route reaches a registered hook', () => {
  const runRecordedTurn = vi.fn<FacilitationTurnHook>();

  beforeEach(() => {
    registerFacilitationTurnHook(runRecordedTurn);
  });

  it('hands the fill the turn it resolved, and runs streamChat with what the fill adds', async () => {
    runRecordedTurn.mockImplementation(async (_turn, run) =>
      run({
        costLogMetadata: { turnId: 'turn-abc', seat: 'onboarding' },
        messageMetadata: { turnId: 'turn-abc', seat: 'onboarding', fingerprintVersion: '1.0' },
      })
    );

    const res = await POST(req({ message: 'hi', turnId: 'turn-abc' }), ctx());

    expect(res.status).toBe(200);
    expect(runRecordedTurn).toHaveBeenCalledWith(
      {
        userId: 'user-1',
        role: 'onboarding',
        agentId: 'agent-1',
        agentSlug: 'lelanea-guide',
        conversationId: 'conv-9',
        message: 'hi',
        clientTurnId: 'turn-abc',
      },
      expect.any(Function)
    );
    expect(vi.mocked(streamChat).mock.calls[0][0]).toEqual({
      ...PRE_SEAM_ARGS,
      costLogMetadata: { turnId: 'turn-abc', seat: 'onboarding' },
      messageMetadata: { turnId: 'turn-abc', seat: 'onboarding', fingerprintVersion: '1.0' },
    });
  });

  it('passes an absent turnId as undefined — the fill mints one', async () => {
    runRecordedTurn.mockImplementation(async (_turn, run) => run({}));

    await POST(req({ message: 'hi' }), ctx());

    expect(runRecordedTurn.mock.calls[0][0].clientTurnId).toBeUndefined();
  });

  it('answers a replay without calling streamChat', async () => {
    runRecordedTurn.mockImplementation(async () =>
      (async function* () {
        yield { type: 'content' as const, delta: 'recorded reply' };
      })()
    );

    const res = await POST(req({ message: 'hi', turnId: 'turn-abc' }), ctx());

    expect(res.status).toBe(200);
    expect(streamChat).not.toHaveBeenCalled();
    expect(sseResponse).toHaveBeenCalledTimes(1);
  });

  it('turns a refusal into 409 before any stream is opened', async () => {
    // Returned, not thrown: the framework builds the ConflictError in the
    // route's graph. A thrown one from a hook registered at boot is a different
    // class and became a 500 on the running server (found by smoke:app-turn).
    runRecordedTurn.mockResolvedValue({
      refused: true,
      message: 'This turn is still being answered.',
      reason: 'TURN_IN_FLIGHT',
    });

    const res = await POST(req({ message: 'hi', turnId: 'turn-abc' }), ctx());

    expect(res.status).toBe(409);
    const body = (await res.json()) as { error: { code: string; details?: { reason?: string } } };
    expect(body.error.code).toBe('CONFLICT');
    expect(body.error.details?.reason).toBe('TURN_IN_FLIGHT');
    expect(streamChat).not.toHaveBeenCalled();
    expect(sseResponse).not.toHaveBeenCalled();
  });

  it('never reaches the fill for a role with no surface', async () => {
    vi.mocked(resolveFacilitationSurface).mockResolvedValue(null);

    const res = await POST(req({ message: 'hi', turnId: 'turn-abc' }), ctx('made-up'));

    expect(res.status).toBe(404);
    expect(runRecordedTurn).not.toHaveBeenCalled();
  });
});
