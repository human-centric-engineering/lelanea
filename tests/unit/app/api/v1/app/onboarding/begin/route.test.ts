/**
 * POST /api/v1/app/onboarding/begin — the hand-off into Values (t-106).
 *
 * The service is mocked: its transitions and idempotency are proved in
 * `tests/unit/lib/app/onboarding/hand-off.test.ts`. Here: who may call, that
 * the caller's own id is what is handed off, and how each outcome answers.
 */

import type { NextRequest } from 'next/server';
import { beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('@/lib/auth/config', () => ({ auth: { api: { getSession: vi.fn() } } }));

const handOff = vi.hoisted(() => ({ beginJourney: vi.fn() }));
vi.mock('@/lib/app/onboarding/hand-off', () => handOff);

import { POST } from '@/app/api/v1/app/onboarding/begin/route';
import { auth } from '@/lib/auth/config';
import { API_KEY_SESSION_ID_PREFIX } from '@/lib/auth/api-keys';

function createRequest(): NextRequest {
  return {
    method: 'POST',
    headers: new Headers(),
    url: 'http://localhost:3000/api/v1/app/onboarding/begin',
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

async function post() {
  const response = await POST(createRequest());
  return { status: response.status, body: (await response.json()) as Record<string, unknown> };
}

beforeEach(() => {
  vi.clearAllMocks();
  vi.mocked(auth.api.getSession).mockResolvedValue(createSession());
  handOff.beginJourney.mockResolvedValue('begun');
});

describe('POST /api/v1/app/onboarding/begin', () => {
  it('begins the caller’s own journey and names Values as where to go', async () => {
    const { status, body } = await post();

    expect(status).toBe(200);
    expect(handOff.beginJourney).toHaveBeenCalledWith('user_test');
    expect(body).toEqual({
      success: true,
      data: { outcome: 'begun', next: '/app/modules/values' },
    });
  });

  it('answers already, with the same destination, when it was begun before', async () => {
    handOff.beginJourney.mockResolvedValue('already');

    const { status, body } = await post();

    expect(status).toBe(200);
    expect(body.data).toEqual({ outcome: 'already', next: '/app/modules/values' });
  });

  it('is a 400 while discovery questions are still ahead', async () => {
    handOff.beginJourney.mockResolvedValue('not_finished');
    expect((await post()).status).toBe(400);
  });

  it('is a 409 when the engine refuses a transition', async () => {
    handOff.beginJourney.mockResolvedValue('unavailable');
    expect((await post()).status).toBe(409);
  });

  it('is a 500 when the hand-off failed', async () => {
    handOff.beginJourney.mockResolvedValue('failed');
    expect((await post()).status).toBe(500);
  });

  it('refuses an API key: beginning is the person’s own act', async () => {
    vi.mocked(auth.api.getSession).mockResolvedValue(
      createSession(`${API_KEY_SESSION_ID_PREFIX}key_1`)
    );

    expect((await post()).status).toBe(403);
    expect(handOff.beginJourney).not.toHaveBeenCalled();
  });

  it('refuses a caller with no session', async () => {
    vi.mocked(auth.api.getSession).mockResolvedValue(null);

    expect((await post()).status).toBe(401);
    expect(handOff.beginJourney).not.toHaveBeenCalled();
  });
});
