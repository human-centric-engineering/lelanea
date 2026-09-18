/**
 * GET /api/v1/app/agent/status — one install-wide word, behind auth, never
 * cached (§08 t-55).
 *
 * The read itself is `tests/unit/lib/app/agent/availability.test.ts`; this is the
 * envelope around it.
 */

import { describe, it, expect, beforeEach, vi } from 'vitest';
import type { NextRequest } from 'next/server';

vi.mock('@/lib/auth/config', () => ({ auth: { api: { getSession: vi.fn() } } }));
const { getGenerationStatus } = vi.hoisted(() => ({ getGenerationStatus: vi.fn() }));
vi.mock('@/lib/app/agent/availability', () => ({ getGenerationStatus }));

import { GET } from '@/app/api/v1/app/agent/status/route';
import { auth } from '@/lib/auth/config';

function createRequest(): NextRequest {
  return {
    headers: new Headers(),
    url: 'http://localhost:3000/api/v1/app/agent/status',
  } as unknown as NextRequest;
}

function memberSession() {
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
  vi.mocked(auth.api.getSession).mockResolvedValue(memberSession());
});

describe('GET /api/v1/app/agent/status', () => {
  it.each(['available', 'unavailable', 'paused'] as const)(
    'answers a member %s, uncached',
    async (generation) => {
      getGenerationStatus.mockResolvedValue(generation);

      const response = await GET(createRequest());

      expect(response.status).toBe(200);
      await expect(response.json()).resolves.toEqual({ success: true, data: { generation } });
      expect(response.headers.get('Cache-Control')).toBe('no-store');
    }
  );

  it('refuses a caller with no session, without reading anything', async () => {
    vi.mocked(auth.api.getSession).mockResolvedValue(null);

    const response = await GET(createRequest());

    expect(response.status).toBe(401);
    expect(getGenerationStatus).not.toHaveBeenCalled();
  });
});
