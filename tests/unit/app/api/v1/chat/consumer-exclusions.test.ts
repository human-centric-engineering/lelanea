/**
 * Consumer chat exclusions — the carried seam on Sunrise's consumer chat routes.
 *
 * f-safety t-61 (`.context/app/divergences.md` Row 21). A fork registers agent
 * slugs the consumer routes must not serve; Lelañea registers hers, because a
 * turn through `POST /api/v1/chat/stream` skips her turn hook — no crisis check,
 * no ceiling, no record.
 *
 * Two halves, and both matter:
 * - **Registered**: the stream route answers exactly as it does for an agent
 *   that does not exist (no existence leak), and the listing omits it.
 * - **At rest** (nothing registered): both routes behave exactly as before. This
 *   is the neutrality proof the seam's `B19` conditions require.
 *
 * Kept in a file of its own rather than in Sunrise's route tests, so those merge
 * through unchanged.
 *
 * @see app/api/v1/chat/stream/route.ts
 * @see app/api/v1/chat/agents/route.ts
 * @see lib/orchestration/chat/consumer-exclusions.ts
 */

import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import type { NextRequest } from 'next/server';
import { POST } from '@/app/api/v1/chat/stream/route';
import { GET } from '@/app/api/v1/chat/agents/route';
import {
  excludeFromConsumerChat,
  isExcludedFromConsumerChat,
  resetConsumerChatExclusions,
} from '@/lib/orchestration/chat/consumer-exclusions';

vi.mock('@/lib/db/client', () => ({
  prisma: {
    aiAgent: { findFirst: vi.fn(), findMany: vi.fn() },
    aiAgentInviteToken: { findFirst: vi.fn() },
    $executeRaw: vi.fn(),
  },
}));

vi.mock('@/lib/auth/config', () => ({
  auth: { api: { getSession: vi.fn() } },
}));

vi.mock('@/lib/security/rate-limit', () => ({
  consumerChatLimiter: { check: vi.fn() },
  agentChatLimiter: { check: vi.fn() },
  imageLimiter: { check: vi.fn() },
  createRateLimitResponse: vi.fn(),
}));

vi.mock('@/lib/orchestration/chat', () => ({ streamChat: vi.fn() }));

vi.mock('@/lib/api/sse', () => ({
  sseResponse: vi.fn(() => new Response('data: test\n\n', { status: 200 })),
}));

vi.mock('@/lib/logging/context', () => ({
  getRequestId: vi.fn(() => Promise.resolve('req-test-001')),
  getVisitorId: vi.fn(() => Promise.resolve('vid-test-001')),
}));

import { prisma } from '@/lib/db/client';
import { auth } from '@/lib/auth/config';
import { consumerChatLimiter, agentChatLimiter } from '@/lib/security/rate-limit';
import { streamChat } from '@/lib/orchestration/chat';
import { sseResponse } from '@/lib/api/sse';

const HIDDEN = 'fork-owned-guide';
const OTHER = 'helper-bot';

const ALLOWED = { success: true, limit: 20, remaining: 10, reset: 0 };

function agentRow(slug: string) {
  return { id: `agent-${slug}`, slug, visibility: 'public', rateLimitRpm: null };
}

function listing() {
  return [
    { id: 'agent-a', name: 'A Guide', slug: HIDDEN, description: null },
    { id: 'agent-b', name: 'Helper Bot', slug: OTHER, description: 'General assistant' },
  ];
}

function streamRequest(agentSlug: string): NextRequest {
  const url = new URL('http://localhost:3000/api/v1/chat/stream');
  return {
    json: async () => ({ message: 'Hello', agentSlug }),
    headers: new Headers(),
    url: url.toString(),
    nextUrl: { searchParams: url.searchParams },
    signal: new AbortController().signal,
  } as unknown as NextRequest;
}

function listRequest(): NextRequest {
  const url = new URL('http://localhost:3000/api/v1/chat/agents');
  return {
    json: async () => ({}),
    headers: new Headers(),
    url: url.toString(),
    nextUrl: { searchParams: url.searchParams },
  } as unknown as NextRequest;
}

async function body(response: Response): Promise<unknown> {
  return JSON.parse(await response.text()) as unknown;
}

beforeEach(() => {
  vi.clearAllMocks();
  resetConsumerChatExclusions();
  vi.mocked(auth.api.getSession).mockResolvedValue({
    session: { id: 's1', userId: 'user-1' },
    user: { id: 'user-1', email: 'u@example.com', role: 'USER' },
  } as never);
  vi.mocked(consumerChatLimiter.check).mockReturnValue(ALLOWED);
  vi.mocked(agentChatLimiter.check).mockReturnValue(ALLOWED);
  vi.mocked(streamChat).mockReturnValue(
    (async function* () {
      yield { type: 'content' as const, delta: 'Hi' };
    })()
  );
  vi.mocked(prisma.aiAgent.findMany).mockResolvedValue(listing() as never);
});

afterEach(() => {
  resetConsumerChatExclusions();
});

describe('POST /api/v1/chat/stream — consumer chat exclusions', () => {
  it('at rest, streams the agent exactly as before', async () => {
    vi.mocked(prisma.aiAgent.findFirst).mockResolvedValue(agentRow(HIDDEN) as never);

    const response = await POST(streamRequest(HIDDEN));

    expect(response.status).toBe(200);
    expect(sseResponse).toHaveBeenCalledOnce();
    expect(streamChat).toHaveBeenCalledWith(
      expect.objectContaining({ agentSlug: HIDDEN, userId: 'user-1' })
    );
  });

  it('answers a registered slug exactly as an agent that does not exist', async () => {
    // The unknown-agent answer, for the same slug, as the baseline.
    vi.mocked(prisma.aiAgent.findFirst).mockResolvedValue(null);
    const unknown = await POST(streamRequest(HIDDEN));
    const unknownBody = await body(unknown);
    expect(unknown.status).toBe(404);

    // The agent exists and is public, but the fork has kept it off this route.
    excludeFromConsumerChat(HIDDEN);
    vi.mocked(prisma.aiAgent.findFirst).mockResolvedValue(agentRow(HIDDEN) as never);
    const refused = await POST(streamRequest(HIDDEN));

    expect(refused.status).toBe(unknown.status);
    expect(await body(refused)).toEqual(unknownBody);
    expect(unknownBody).toMatchObject({ success: false, error: { code: 'NOT_FOUND' } });
    // Refused before any turn work: no per-agent bucket spent, no model call.
    expect(agentChatLimiter.check).not.toHaveBeenCalled(); // test-review:accept no_arg_called — error-path guard: must not be reached;
    expect(streamChat).not.toHaveBeenCalled(); // test-review:accept no_arg_called — error-path guard: must not be called;
  });

  it('still serves every agent that was not registered', async () => {
    excludeFromConsumerChat(HIDDEN);
    vi.mocked(prisma.aiAgent.findFirst).mockResolvedValue(agentRow(OTHER) as never);

    const response = await POST(streamRequest(OTHER));

    expect(response.status).toBe(200);
    expect(streamChat).toHaveBeenCalledWith(expect.objectContaining({ agentSlug: OTHER }));
  });
});

describe('GET /api/v1/chat/agents — consumer chat exclusions', () => {
  it('at rest, lists every agent the query returns, unchanged', async () => {
    const response = await GET(listRequest());

    expect(response.status).toBe(200);
    expect(await body(response)).toEqual({ success: true, data: { agents: listing() } });
  });

  it('omits a registered slug and keeps the rest in order', async () => {
    excludeFromConsumerChat(HIDDEN);

    const response = await GET(listRequest());

    expect(response.status).toBe(200);
    expect(await body(response)).toEqual({ success: true, data: { agents: [listing()[1]] } });
  });
});

describe('the registry', () => {
  it('is shared through globalThis, so a registration made in another module graph is seen', async () => {
    excludeFromConsumerChat(HIDDEN);
    vi.resetModules();
    const fresh = await import('@/lib/orchestration/chat/consumer-exclusions');

    expect(fresh.isExcludedFromConsumerChat(HIDDEN)).toBe(true);
    expect(fresh.isExcludedFromConsumerChat(OTHER)).toBe(false);
  });

  it('matches the slug exactly and registers idempotently', () => {
    excludeFromConsumerChat(HIDDEN);
    excludeFromConsumerChat(HIDDEN);

    expect(isExcludedFromConsumerChat(HIDDEN)).toBe(true);
    expect(isExcludedFromConsumerChat(HIDDEN.toUpperCase())).toBe(false);
    resetConsumerChatExclusions();
    expect(isExcludedFromConsumerChat(HIDDEN)).toBe(false);
  });
});
