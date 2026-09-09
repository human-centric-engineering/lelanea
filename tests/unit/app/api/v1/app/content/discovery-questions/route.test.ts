/**
 * Unit Tests: GET /api/v1/app/content/discovery-questions
 *
 * The one authored-content route behind auth. Covers the 200 payload, the 304,
 * the 401 an anonymous caller must get, and the private cache directive that
 * keeps a shared cache out of a session-gated payload.
 *
 * @see app/api/v1/app/content/discovery-questions/route.ts
 */

import { describe, it, expect, beforeEach, vi } from 'vitest';
import type { NextRequest } from 'next/server';

// Mock auth config (needed by the withAuth guard)
vi.mock('@/lib/auth/config', () => ({
  auth: { api: { getSession: vi.fn() } },
}));

import { GET } from '@/app/api/v1/app/content/discovery-questions/route';
import { auth } from '@/lib/auth/config';

interface QuestionsBody {
  success: true;
  data: {
    collection: { module: string; phase: number; version: string };
    preamble: { text: string };
    pacing: { rushDiscouraged: boolean };
    questions: { id: string; number: number; text: string }[];
  };
}

interface ErrorBody {
  success: false;
  error: { code: string; message: string };
}

function createRequest(headers: Record<string, string> = {}): NextRequest {
  return {
    headers: new Headers(headers),
    url: 'http://localhost:3000/api/v1/app/content/discovery-questions',
  } as unknown as NextRequest;
}

function createSession() {
  return {
    session: {
      id: 'session_test',
      userId: 'user_test',
      token: 'token',
      expiresAt: new Date(Date.now() + 86_400_000),
      createdAt: new Date(),
      updatedAt: new Date(),
    },
    user: {
      id: 'user_test',
      name: 'Test Member',
      email: 'member@example.com',
      emailVerified: true,
      image: null,
      role: 'USER' as const,
      createdAt: new Date(),
      updatedAt: new Date(),
    },
  };
}

describe('GET /api/v1/app/content/discovery-questions', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.mocked(auth.api.getSession).mockResolvedValue(createSession());
  });

  it('returns the thirty questions, numbered from one', async () => {
    const response = await GET(createRequest());
    const body = (await response.json()) as QuestionsBody;

    expect(response.status).toBe(200);
    expect(body.data.questions).toHaveLength(30);
    expect(body.data.questions[0].number).toBe(1);
  });

  it('keeps the preamble and the pacing guidance with the questions', async () => {
    const body = (await (await GET(createRequest())).json()) as QuestionsBody;

    expect(body.data.preamble.text).toBeTruthy();
    expect(body.data.pacing.rushDiscouraged).toBe(true);
  });

  it('answers 401 for an anonymous caller', async () => {
    vi.mocked(auth.api.getSession).mockResolvedValue(null);

    const response = await GET(createRequest());
    const body = (await response.json()) as ErrorBody;

    expect(response.status).toBe(401);
    expect(body.error.code).toBe('UNAUTHORIZED');
  });

  it('answers 304 when the client already has this version', async () => {
    const etag = (await GET(createRequest())).headers.get('ETag')!;

    const response = await GET(createRequest({ 'If-None-Match': etag }));

    expect(response.status).toBe(304);
    expect(await response.text()).toBe('');
  });

  it('stays private — a shared cache has no business holding it', async () => {
    const response = await GET(createRequest());

    expect(response.headers.get('Cache-Control')).toBe('private, no-cache');
  });

  it('withholds the editorial review notes', async () => {
    const body = (await (await GET(createRequest())).json()) as QuestionsBody & {
      data: Record<string, unknown>;
    };

    expect(body.data).not.toHaveProperty('reviewNotes');
  });
});
