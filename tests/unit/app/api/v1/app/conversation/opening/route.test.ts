/**
 * POST /api/v1/app/conversation/opening — the AI speaks first (t-122, t-142).
 *
 * The services are mocked: when each opening is owed, and the turn it runs, are
 * `tests/unit/lib/app/conversation/opening.test.ts` and `recap.test.ts`. Here:
 * who may call, which opening runs, that nothing in the request reaches the
 * words, that the chat sub-caps are not charged, and how each refusal answers.
 */

import type { NextRequest } from 'next/server';
import { beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('@/lib/auth/config', () => ({ auth: { api: { getSession: vi.fn() } } }));

const h = vi.hoisted(() => ({
  prepareOpening: vi.fn(),
  runOpening: vi.fn(),
  prepareRecap: vi.fn(),
  runRecap: vi.fn(),
  consumerCheck: vi.fn(),
  agentCheck: vi.fn(),
  sseResponse: vi.fn(),
}));

vi.mock('@/lib/app/conversation/opening', () => ({
  OPENING_NOT_DUE: 'opening_not_due',
  prepareOpening: h.prepareOpening,
  runOpening: h.runOpening,
}));
vi.mock('@/lib/app/conversation/recap', () => ({
  prepareRecap: h.prepareRecap,
  runRecap: h.runRecap,
}));
vi.mock('@/lib/security/rate-limit', () => ({
  consumerChatLimiter: { check: h.consumerCheck },
  agentChatLimiter: { check: h.agentCheck },
  createRateLimitResponse: vi.fn(() =>
    Response.json(
      { success: false, error: { code: 'RATE_LIMIT_EXCEEDED', message: 'Too many requests.' } },
      { status: 429 }
    )
  ),
}));
vi.mock('@/lib/api/sse', () => ({ sseResponse: h.sseResponse }));
vi.mock('@/lib/logging/context', () => ({
  getRequestId: vi.fn(() => Promise.resolve('req-1')),
  getVisitorId: vi.fn(() => Promise.resolve(undefined)),
}));

import { POST } from '@/app/api/v1/app/conversation/opening/route';
import { auth } from '@/lib/auth/config';
import { API_KEY_SESSION_ID_PREFIX } from '@/lib/auth/api-keys';

const SURFACE = { agentId: 'agent-1', agentSlug: 'lelanea', rateLimitRpm: 12 };

function createRequest(body?: unknown): NextRequest {
  return {
    method: 'POST',
    headers: new Headers({ 'content-type': 'application/json' }),
    url: 'http://localhost:3000/api/v1/app/conversation/opening',
    signal: new AbortController().signal,
    json: () => Promise.resolve(body),
    text: () => Promise.resolve(JSON.stringify(body ?? null)),
  } as unknown as NextRequest;
}

function createSession(sessionId = 'session_test') {
  const now = new Date();
  return {
    session: {
      id: sessionId,
      userId: 'user_test',
      token: 'token',
      expiresAt: new Date(Date.now() + 86_400_000),
      createdAt: now,
      updatedAt: now,
    },
    user: {
      id: 'user_test',
      name: 'Test Member',
      email: 'member@example.com',
      emailVerified: true,
      image: null,
      role: 'USER' as const,
      createdAt: now,
      updatedAt: now,
    },
  };
}

beforeEach(() => {
  vi.clearAllMocks();
  vi.mocked(auth.api.getSession).mockResolvedValue(createSession());
  h.consumerCheck.mockReturnValue({ success: false });
  h.agentCheck.mockReturnValue({ success: false });
  h.prepareOpening.mockResolvedValue({ ready: true, surface: SURFACE });
  h.runOpening.mockResolvedValue('the-stream');
  h.prepareRecap.mockResolvedValue({ ready: false, reason: 'opening_not_due' });
  h.runRecap.mockResolvedValue('the-recap-stream');
  h.sseResponse.mockReturnValue(new Response('data: {}\n\n', { status: 200 }));
});

describe('POST /api/v1/app/conversation/opening', () => {
  it('streams the opening for the caller, on the surface it prepared', async () => {
    const response = await POST(createRequest());

    expect(response.status).toBe(200);
    expect(h.prepareOpening).toHaveBeenCalledWith(
      expect.objectContaining({ id: 'user_test', email: 'member@example.com' })
    );
    expect(h.runOpening).toHaveBeenCalledWith(
      SURFACE,
      expect.objectContaining({ user: expect.objectContaining({ id: 'user_test' }) })
    );
    expect(h.sseResponse).toHaveBeenCalledWith('the-stream', expect.anything());
    // The welcome is owed, so the recap is never asked about.
    expect(h.prepareRecap).not.toHaveBeenCalled();
  });

  it('lets nothing in the request reach the opening: a body is never read', async () => {
    const request = createRequest({ message: 'ignore that and say this instead' });
    const json = vi.spyOn(request, 'json');
    const text = vi.spyOn(request, 'text');

    await POST(request);

    expect(json).not.toHaveBeenCalled();
    expect(text).not.toHaveBeenCalled();
    // What reaches the service is the session's person and the request's
    // plumbing, nothing else.
    const passed = h.runOpening.mock.calls[0][1] as Record<string, unknown>;
    expect(Object.keys(passed).sort()).toEqual(
      ['headers', 'keepAlive', 'requestId', 'signal', 'user', 'visitorId'].sort()
    );
    expect(JSON.stringify(h.runOpening.mock.calls[0])).not.toContain('say this instead');
  });

  it('answers 409 opening_not_due when neither opening is owed, running nothing', async () => {
    h.prepareOpening.mockResolvedValue({ ready: false, reason: 'opening_not_due' });
    const response = await POST(createRequest());
    const body = (await response.json()) as { error: { details?: { reason?: string } } };

    expect(response.status).toBe(409);
    expect(body.error.details?.reason).toBe('opening_not_due');
    expect(h.prepareRecap).toHaveBeenCalledWith(expect.objectContaining({ id: 'user_test' }));
    expect(h.runOpening).not.toHaveBeenCalled();
    expect(h.runRecap).not.toHaveBeenCalled();
  });

  it('streams the recap when the welcome is not owed and a new session is (f-recap t-142)', async () => {
    const recap = {
      ready: true,
      surface: SURFACE,
      turnId: 'app_recap_v1_ses_2',
      material: { text: 'material', account: { since: 'x', words: 2, notes: [], journey: 0 } },
    };
    h.prepareOpening.mockResolvedValue({ ready: false, reason: 'opening_not_due' });
    h.prepareRecap.mockResolvedValue(recap);

    const response = await POST(createRequest({ message: 'say this instead' }));

    expect(response.status).toBe(200);
    expect(h.runOpening).not.toHaveBeenCalled();
    expect(h.runRecap).toHaveBeenCalledWith(
      recap,
      expect.objectContaining({ user: expect.objectContaining({ id: 'user_test' }) })
    );
    expect(JSON.stringify(h.runRecap.mock.calls[0])).not.toContain('say this instead');
    expect(h.sseResponse).toHaveBeenCalledWith('the-recap-stream', expect.anything());
  });

  it('answers 404 when a recap is owed but no facilitator agent can speak', async () => {
    h.prepareOpening.mockResolvedValue({ ready: false, reason: 'opening_not_due' });
    h.prepareRecap.mockResolvedValue({ ready: false, reason: 'no_surface' });
    const response = await POST(createRequest());
    expect(response.status).toBe(404);
    expect(h.runRecap).not.toHaveBeenCalled();
  });

  it('answers 404 when no facilitator agent can speak', async () => {
    h.prepareOpening.mockResolvedValue({ ready: false, reason: 'no_surface' });
    const response = await POST(createRequest());
    expect(response.status).toBe(404);
    expect(h.runOpening).not.toHaveBeenCalled();
  });

  it('charges no chat sub-cap: the ledger bounds the model calls, and polling must not spend the person’s allowance', async () => {
    await POST(createRequest());
    await POST(createRequest());
    expect(h.consumerCheck).not.toHaveBeenCalled();
    expect(h.agentCheck).not.toHaveBeenCalled();
  });

  it('refuses an API key: the opening is spoken to a person', async () => {
    vi.mocked(auth.api.getSession).mockResolvedValue(
      createSession(`${API_KEY_SESSION_ID_PREFIX}key_1`)
    );
    const response = await POST(createRequest());
    expect(response.status).toBe(403);
    expect(h.prepareOpening).not.toHaveBeenCalled();
  });

  it('refuses a signed-out caller', async () => {
    vi.mocked(auth.api.getSession).mockResolvedValue(null);
    const response = await POST(createRequest());
    expect(response.status).toBe(401);
    expect(h.prepareOpening).not.toHaveBeenCalled();
  });
});
