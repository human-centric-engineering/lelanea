/**
 * The knowledge-mirror cron route (f-content-seeds t-90): Vercel Cron's way in.
 *
 * What matters is who gets through. The scheduler sends `Authorization: Bearer
 * <CRON_SECRET>`; nothing else may start a reconcile, and with no secret
 * configured nothing may start one at all. The reconcile itself is mocked here;
 * its behaviour is `tests/unit/lib/app/content/knowledge-mirror.test.ts`.
 *
 * It runs once per active org (t-115). `forEachOrg` is stubbed to walk a
 * fixed list through the real `runAsOrg`, and each pass records the org it
 * ran in, so a test can see the reconcile really ran inside each org.
 *
 * @see app/api/v1/app/cron/knowledge-mirror/route.ts
 */

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const { reconcileKnowledgeMirror, orgIds, ranIn } = vi.hoisted(() => ({
  reconcileKnowledgeMirror: vi.fn(),
  orgIds: { current: ['install', 'org-b'] as string[] | null },
  ranIn: [] as string[],
}));
vi.mock('@/lib/app/content/knowledge-mirror', () => ({ reconcileKnowledgeMirror }));
vi.mock('@/lib/tenancy/context', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@/lib/tenancy/context')>();
  return {
    ...actual,
    forEachOrg: async (fn: (orgId: string) => Promise<void>) => {
      if (!orgIds.current) throw new Error('could not list orgs');
      for (const orgId of orgIds.current) {
        await actual.runAsOrg(orgId, () => fn(orgId));
      }
    },
  };
});

import type { NextRequest } from 'next/server';
import { GET } from '@/app/api/v1/app/cron/knowledge-mirror/route';
import { getTenantContext } from '@/lib/tenancy/context';

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
  orgIds.current = ['install', 'org-b'];
  ranIn.length = 0;
  reconcileKnowledgeMirror.mockImplementation(() => {
    ranIn.push(getTenantContext()?.orgId ?? 'none');
    return Promise.resolve(inStep);
  });
});

afterEach(() => {
  vi.unstubAllEnvs();
});

describe('GET /api/v1/app/cron/knowledge-mirror', () => {
  it('reconciles each active org inside that org, and returns each summary', async () => {
    const response = await GET(createRequest({ authorization: `Bearer ${SECRET}` }));

    expect(response.status).toBe(200);
    expect(ranIn).toEqual(['install', 'org-b']);
    const body = (await response.json()) as { success: boolean; data: unknown };
    expect(body).toEqual({
      success: true,
      data: {
        orgs: [
          { orgId: 'install', result: inStep },
          { orgId: 'org-b', result: inStep },
        ],
      },
    });
  });

  it('still reconciles the next org when one throws, and answers 500 naming it', async () => {
    reconcileKnowledgeMirror.mockImplementation(() => {
      const orgId = getTenantContext()?.orgId ?? 'none';
      ranIn.push(orgId);
      if (orgId === 'install') return Promise.reject(new Error('connection refused at 10.0.0.5'));
      return Promise.resolve(inStep);
    });

    const response = await GET(createRequest({ authorization: `Bearer ${SECRET}` }));

    expect(ranIn).toEqual(['install', 'org-b']);
    expect(response.status).toBe(500);
    const body = (await response.json()) as {
      error: { code: string; details: { failed: unknown[] } };
    };
    expect(body.error.code).toBe('MIRROR_INCOMPLETE');
    expect(body.error.details.failed).toEqual([{ orgId: 'install' }]);
    // The error text is logged, not returned.
    expect(JSON.stringify(body)).not.toContain('connection refused');
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
    orgIds.current = ['org-b'];
    reconcileKnowledgeMirror.mockResolvedValue({
      ...inStep,
      failed: [{ sourceKey: 'foundational:the_mission', error: 'Embedding provider unavailable' }],
    });

    const response = await GET(createRequest({ authorization: `Bearer ${SECRET}` }));

    expect(response.status).toBe(500);
    const body = (await response.json()) as {
      success: boolean;
      error: { code: string; details: { failed: unknown[] } };
    };
    expect(body.error.code).toBe('MIRROR_INCOMPLETE');
    expect(body.error.details.failed).toEqual([
      { orgId: 'org-b', sourceKey: 'foundational:the_mission' },
    ]);
    // The provider's error text is logged, not returned.
    expect(JSON.stringify(body)).not.toContain('Embedding provider');
  });

  it('answers 500 through the platform error handler when the orgs cannot be listed', async () => {
    orgIds.current = null;

    const response = await GET(createRequest({ authorization: `Bearer ${SECRET}` }));

    expect(response.status).toBe(500);
    expect(((await response.json()) as { success: boolean }).success).toBe(false);
    expect(reconcileKnowledgeMirror).not.toHaveBeenCalled();
  });
});
