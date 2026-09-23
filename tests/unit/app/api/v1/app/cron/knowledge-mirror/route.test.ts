/**
 * The knowledge-mirror cron route (f-content-seeds t-90): Vercel Cron's way in.
 *
 * What matters is who gets through. The scheduler sends `Authorization: Bearer
 * <CRON_SECRET>`; nothing else may start a reconcile, and with no secret
 * configured nothing may start one at all. The reconcile itself is mocked here;
 * its behaviour is `tests/unit/lib/app/content/knowledge-mirror.test.ts`.
 *
 * @see app/api/v1/app/cron/knowledge-mirror/route.ts
 */

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const { reconcileKnowledgeMirror } = vi.hoisted(() => ({ reconcileKnowledgeMirror: vi.fn() }));
vi.mock('@/lib/app/content/knowledge-mirror', () => ({ reconcileKnowledgeMirror }));

import type { NextRequest } from 'next/server';
import { GET } from '@/app/api/v1/app/cron/knowledge-mirror/route';

const SECRET = 'a-cron-secret-long-enough-to-pass';

function createRequest(headers: Record<string, string> = {}): NextRequest {
  return {
    headers: new Headers(headers),
    url: 'http://localhost:3000/api/v1/app/cron/knowledge-mirror',
  } as unknown as NextRequest;
}

const inStep = {
  status: 'reconciled',
  created: [],
  reingested: [],
  removed: [],
  unchanged: ['foundational:the_mission'],
  failed: [],
};

beforeEach(() => {
  vi.clearAllMocks();
  vi.stubEnv('CRON_SECRET', SECRET);
  reconcileKnowledgeMirror.mockResolvedValue(inStep);
});

afterEach(() => {
  vi.unstubAllEnvs();
});

describe('GET /api/v1/app/cron/knowledge-mirror', () => {
  it('runs the reconcile for the scheduler and returns its summary', async () => {
    const response = await GET(createRequest({ authorization: `Bearer ${SECRET}` }));

    expect(response.status).toBe(200);
    expect(reconcileKnowledgeMirror).toHaveBeenCalledTimes(1);
    const body = (await response.json()) as { success: boolean; data: typeof inStep };
    expect(body).toEqual({ success: true, data: inStep });
  });

  it.each([
    ['no header', {}],
    ['a wrong secret', { authorization: 'Bearer not-the-secret-at-all-no' }],
    ['the secret without the scheme', { authorization: SECRET }],
  ])('refuses %s and runs nothing', async (_label, headers) => {
    const response = await GET(createRequest(headers));

    expect(response.status).toBe(401);
    expect(reconcileKnowledgeMirror).not.toHaveBeenCalled();
  });

  it.each([
    ['unset', undefined],
    ['too short to be a secret', 'short'],
  ])('refuses everything when CRON_SECRET is %s', async (_label, value) => {
    vi.stubEnv('CRON_SECRET', value);

    // Even a request presenting that exact value.
    const response = await GET(createRequest({ authorization: `Bearer ${value ?? ''}` }));

    expect(response.status).toBe(503);
    expect(reconcileKnowledgeMirror).not.toHaveBeenCalled();
  });

  it('answers 500 naming the documents that failed, so the cron log shows red', async () => {
    reconcileKnowledgeMirror.mockResolvedValue({
      ...inStep,
      failed: [{ sourceKey: 'foundational:the_mission', error: 'Embedding provider unavailable' }],
    });

    const response = await GET(createRequest({ authorization: `Bearer ${SECRET}` }));

    expect(response.status).toBe(500);
    const body = (await response.json()) as {
      success: boolean;
      error: { code: string; details: { failed: string[] } };
    };
    expect(body.error.code).toBe('MIRROR_INCOMPLETE');
    expect(body.error.details.failed).toEqual(['foundational:the_mission']);
    // The provider's error text is logged, not returned.
    expect(JSON.stringify(body)).not.toContain('Embedding provider');
  });

  it('answers 500 through the platform error handler when the reconcile throws', async () => {
    reconcileKnowledgeMirror.mockRejectedValue(new Error('connection refused'));

    const response = await GET(createRequest({ authorization: `Bearer ${SECRET}` }));

    expect(response.status).toBe(500);
    expect(((await response.json()) as { success: boolean }).success).toBe(false);
  });
});
