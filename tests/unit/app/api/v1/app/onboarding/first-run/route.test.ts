/**
 * GET + POST /api/v1/app/onboarding/first-run — what the caller has been shown
 * (t-103).
 *
 * The store is mocked: its reads and writes are proved in
 * `tests/unit/lib/app/onboarding/first-run-store.test.ts`. Here: who may call,
 * what is accepted, and that every write is keyed on the caller.
 */

import type { NextRequest } from 'next/server';
import { beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('@/lib/auth/config', () => ({ auth: { api: { getSession: vi.fn() } } }));

const store = vi.hoisted(() => ({
  getFirstRunProgress: vi.fn(),
  recordFirstRunBeat: vi.fn(),
}));
vi.mock('@/lib/app/onboarding/first-run-store', () => store);

import { GET, POST } from '@/app/api/v1/app/onboarding/first-run/route';
import { auth } from '@/lib/auth/config';
import { API_KEY_SESSION_ID_PREFIX } from '@/lib/auth/api-keys';

function createRequest(body?: unknown, method = 'GET'): NextRequest {
  return {
    method,
    headers: new Headers({ 'content-type': 'application/json' }),
    url: 'http://localhost:3000/api/v1/app/onboarding/first-run',
    json: () => (body === undefined ? Promise.reject(new Error('no body')) : Promise.resolve(body)),
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
  store.getFirstRunProgress.mockResolvedValue({
    initiationShown: true,
    readsOffered: ['the_heart_behind_lelanea'],
  });
  store.recordFirstRunBeat.mockResolvedValue('recorded');
});

describe('GET', () => {
  it('answers the caller’s progress and what is still to come', async () => {
    const response = await GET(createRequest());
    expect(response.status).toBe(200);
    const body = (await response.json()) as { data: unknown };
    expect(body.data).toEqual({
      initiationShown: true,
      readsOffered: ['the_heart_behind_lelanea'],
      pending: ['read:the_mission', 'read:about_the_creator', 'read:the_lineage_of_lelanea'],
    });
    expect(store.getFirstRunProgress).toHaveBeenCalledWith('user_test');
  });

  it('is a 500, not an empty answer, when the ledger could not be read', async () => {
    store.getFirstRunProgress.mockResolvedValue(null);
    const response = await GET(createRequest());
    expect(response.status).toBe(500);
  });

  it('refuses a signed-out caller', async () => {
    vi.mocked(auth.api.getSession).mockResolvedValue(null);
    const response = await GET(createRequest());
    expect(response.status).toBe(401);
  });
});

describe('POST', () => {
  it('records the beat for the caller', async () => {
    const response = await POST(createRequest({ beat: 'read:the_mission' }, 'POST'));
    expect(response.status).toBe(200);
    expect(store.recordFirstRunBeat).toHaveBeenCalledWith('user_test', 'read:the_mission');
    const body = (await response.json()) as { data: unknown };
    expect(body.data).toEqual({ beat: 'read:the_mission', recorded: true, already: false });
  });

  it('says so when the beat was already recorded', async () => {
    store.recordFirstRunBeat.mockResolvedValue('already');
    const response = await POST(createRequest({ beat: 'initiation' }, 'POST'));
    const body = (await response.json()) as { data: unknown };
    expect(body.data).toEqual({ beat: 'initiation', recorded: true, already: true });
  });

  it('answers recorded: false, not an error, when there was no node to record on', async () => {
    store.recordFirstRunBeat.mockResolvedValue('failed');
    const response = await POST(createRequest({ beat: 'initiation' }, 'POST'));
    expect(response.status).toBe(200);
    const body = (await response.json()) as { data: { recorded: boolean } };
    expect(body.data.recorded).toBe(false);
  });

  it.each([{ beat: 'read:disclaimer' }, { beat: 'welcome' }, {}, { beat: 3 }])(
    'refuses %j without writing',
    async (payload) => {
      const response = await POST(createRequest(payload, 'POST'));
      expect(response.status).toBe(400);
      expect(store.recordFirstRunBeat).not.toHaveBeenCalled();
    }
  );

  it('refuses an API key: a beat says a person has seen her words', async () => {
    vi.mocked(auth.api.getSession).mockResolvedValue(
      createSession(`${API_KEY_SESSION_ID_PREFIX}abc`)
    );
    const response = await POST(createRequest({ beat: 'initiation' }, 'POST'));
    expect(response.status).toBe(403);
    expect(store.recordFirstRunBeat).not.toHaveBeenCalled();
  });

  it('refuses a signed-out caller', async () => {
    vi.mocked(auth.api.getSession).mockResolvedValue(null);
    const response = await POST(createRequest({ beat: 'initiation' }, 'POST'));
    expect(response.status).toBe(401);
    expect(store.recordFirstRunBeat).not.toHaveBeenCalled();
  });
});
