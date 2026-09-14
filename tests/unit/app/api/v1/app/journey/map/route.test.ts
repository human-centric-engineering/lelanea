/**
 * GET /api/v1/app/journey/map — the four answers it gives: the map, 401, 304,
 * and the two honest failures (404 unpublished, 500 inconsistent).
 *
 * The projection is mocked; its own behaviour is `tests/unit/lib/app/journey/map.test.ts`.
 */

import { describe, it, expect, beforeEach, vi } from 'vitest';
import type { NextRequest } from 'next/server';

vi.mock('@/lib/auth/config', () => ({ auth: { api: { getSession: vi.fn() } } }));
const { getJourneyMap } = vi.hoisted(() => ({ getJourneyMap: vi.fn() }));
vi.mock('@/lib/app/journey/map', () => ({
  getJourneyMap,
  JOURNEY_MAP_INCONSISTENT: 'JOURNEY_MAP_INCONSISTENT',
}));

import { GET } from '@/app/api/v1/app/journey/map/route';
import { APIError } from '@/lib/api/errors';
import { auth } from '@/lib/auth/config';

const MAP = {
  slug: 'lelanea-journey',
  version: 1,
  tiers: [{ id: 'onboarding', label: 'Onboarding', intent: 'Welcome.', order: 0 }],
  modules: [
    {
      slug: 'onboarding',
      number: 0,
      displayNumber: '00',
      title: 'Onboarding',
      tier: 'onboarding',
      state: 'open',
    },
  ],
};

function createRequest(headers: Record<string, string> = {}): NextRequest {
  return {
    headers: new Headers(headers),
    url: 'http://localhost:3000/api/v1/app/journey/map',
  } as unknown as NextRequest;
}

function createSession() {
  const now = new Date();
  return {
    session: {
      id: 'session_test',
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
  getJourneyMap.mockResolvedValue(MAP);
});

describe('GET /api/v1/app/journey/map', () => {
  it('serves the projection in the standard envelope with an ETag', async () => {
    const response = await GET(createRequest());
    const body = (await response.json()) as { success: boolean; data: typeof MAP };

    expect(response.status).toBe(200);
    expect(body.success).toBe(true);
    expect(body.data).toEqual(MAP);
    expect(response.headers.get('ETag')).toMatch(/^(W\/)?"[\w-]+"$/);
  });

  it('is behind auth: 401 with no session', async () => {
    vi.mocked(auth.api.getSession).mockResolvedValue(null);
    const response = await GET(createRequest());
    expect(response.status).toBe(401);
    expect(getJourneyMap).not.toHaveBeenCalled();
  });

  it('answers 304 to a matching If-None-Match', async () => {
    const first = await GET(createRequest());
    const etag = first.headers.get('ETag')!;

    const second = await GET(createRequest({ 'if-none-match': etag }));
    expect(second.status).toBe(304);
  });

  it('404s when no version is published', async () => {
    getJourneyMap.mockResolvedValue(null);
    const response = await GET(createRequest());
    const body = (await response.json()) as { success: false; error: { code: string } };

    expect(response.status).toBe(404);
    expect(body.error.code).toBe('NOT_FOUND');
  });

  it('reports a map naming modules the code does not register, with the list', async () => {
    getJourneyMap.mockRejectedValue(
      new APIError('inconsistent', 'JOURNEY_MAP_INCONSISTENT', 500, {
        problems: ['module "ghost" is not registered'],
      })
    );
    const response = await GET(createRequest());
    const body = (await response.json()) as {
      success: false;
      error: { code: string; details?: { problems: string[] } };
    };

    expect(response.status).toBe(500);
    expect(body.error.code).toBe('JOURNEY_MAP_INCONSISTENT');
    expect(body.error.details?.problems).toEqual(['module "ghost" is not registered']);
  });
});
