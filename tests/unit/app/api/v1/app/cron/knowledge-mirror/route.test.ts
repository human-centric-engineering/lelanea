/**
 * The knowledge-mirror cron route (f-content-seeds t-90): Vercel Cron's way in.
 *
 * What matters is who gets through. The scheduler sends `Authorization: Bearer
 * <CRON_SECRET>`; nothing else may start a reconcile, and with no secret
 * configured nothing may start one at all. The reconcile itself is mocked here;
 * its behaviour is `tests/unit/lib/app/content/knowledge-mirror.test.ts`.
 *
 * At `multi` it runs once per active org (t-115), through the platform's own
 * `listActiveOrgIds` and `runAsOrg`: only the org table's read is stubbed, so
 * the ACTIVE filter and the per-org scope are real. At `single` it runs for
 * the install org alone. Each pass records the org it ran in, so a test can
 * see the reconcile really ran inside that org. The clock is pinned to a day
 * whose rotation offset is 0, so the starting org is known.
 *
 * @see app/api/v1/app/cron/knowledge-mirror/route.ts
 */

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const { reconcileKnowledgeMirror, orgFindMany, ranIn } = vi.hoisted(() => ({
  reconcileKnowledgeMirror: vi.fn(),
  orgFindMany: vi.fn(),
  ranIn: [] as string[],
}));
vi.mock('@/lib/app/content/knowledge-mirror', () => ({ reconcileKnowledgeMirror }));
vi.mock('@/lib/db/client', () => ({ prisma: { org: { findMany: orgFindMany } } }));
const mockEnv = vi.hoisted(() => ({ TENANCY_MODE: 'multi' }));
vi.mock('@/lib/env', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@/lib/env')>();
  return {
    ...actual,
    env: new Proxy(actual.env, {
      get: (target, key) =>
        key === 'TENANCY_MODE' ? mockEnv.TENANCY_MODE : Reflect.get(target, key),
    }),
  };
});

/** A day whose index is even, so two orgs rotate by 0 and start at the oldest. */
const DAY_ZERO = Date.UTC(1970, 0, 1, 4, 17);

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
  orgFindMany.mockResolvedValue([{ id: 'install' }, { id: 'org-b' }]);
  mockEnv.TENANCY_MODE = 'multi';
  vi.useFakeTimers({ toFake: ['Date'] });
  vi.setSystemTime(DAY_ZERO);
  ranIn.length = 0;
  reconcileKnowledgeMirror.mockImplementation(() => {
    ranIn.push(getTenantContext()?.orgId ?? 'none');
    return Promise.resolve(inStep);
  });
});

afterEach(() => {
  vi.unstubAllEnvs();
  vi.useRealTimers();
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

  it('starts at a different org each day, so no org is always last', async () => {
    vi.setSystemTime(DAY_ZERO + 86_400_000);

    await GET(createRequest({ authorization: `Bearer ${SECRET}` }));

    expect(ranIn).toEqual(['org-b', 'install']);
  });

  it('at single, reconciles the install org alone and reads no org list', async () => {
    mockEnv.TENANCY_MODE = 'single';

    const response = await GET(createRequest({ authorization: `Bearer ${SECRET}` }));

    expect(response.status).toBe(200);
    expect(ranIn).toEqual(['install']);
    expect(orgFindMany).not.toHaveBeenCalled();
  });

  it('reads only ACTIVE orgs, oldest first', async () => {
    await GET(createRequest({ authorization: `Bearer ${SECRET}` }));

    expect(orgFindMany).toHaveBeenCalledWith(
      expect.objectContaining({ where: { status: 'ACTIVE' }, orderBy: { createdAt: 'asc' } })
    );
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
      error: { code: string; details: Record<string, unknown> };
    };
    expect(body.error.code).toBe('MIRROR_INCOMPLETE');
    expect(body.error.details).toEqual({ failed: [], crashed: ['install'], notReached: [] });
    // The error text is logged, not returned.
    expect(JSON.stringify(body)).not.toContain('connection refused');
  });

  it('starts no org once its time is spent, and answers 500 naming those it left', async () => {
    reconcileKnowledgeMirror.mockImplementation(() => {
      ranIn.push(getTenantContext()?.orgId ?? 'none');
      // The first org takes the whole budget.
      vi.setSystemTime(Date.now() + 31_000);
      return Promise.resolve(inStep);
    });

    const response = await GET(createRequest({ authorization: `Bearer ${SECRET}` }));

    expect(ranIn).toEqual(['install']);
    expect(response.status).toBe(500);
    const body = (await response.json()) as { error: { details: Record<string, unknown> } };
    expect(body.error.details).toEqual({ failed: [], crashed: [], notReached: ['org-b'] });
  });

  it('answers 500 rather than green when there is no active org at all', async () => {
    orgFindMany.mockResolvedValue([]);

    const response = await GET(createRequest({ authorization: `Bearer ${SECRET}` }));

    expect(response.status).toBe(500);
    expect(reconcileKnowledgeMirror).not.toHaveBeenCalled();
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
    orgFindMany.mockResolvedValue([{ id: 'org-b' }]);
    reconcileKnowledgeMirror.mockResolvedValue({
      ...inStep,
      failed: [{ sourceKey: 'foundational:the_mission', error: 'Embedding provider unavailable' }],
    });

    const response = await GET(createRequest({ authorization: `Bearer ${SECRET}` }));

    expect(response.status).toBe(500);
    const body = (await response.json()) as {
      success: boolean;
      error: { code: string; details: Record<string, unknown> };
    };
    expect(body.error.code).toBe('MIRROR_INCOMPLETE');
    expect(body.error.details).toEqual({
      failed: [{ orgId: 'org-b', sourceKey: 'foundational:the_mission' }],
      crashed: [],
      notReached: [],
    });
    // The provider's error text is logged, not returned.
    expect(JSON.stringify(body)).not.toContain('Embedding provider');
  });

  it('answers 500 through the platform error handler when the orgs cannot be listed', async () => {
    orgFindMany.mockRejectedValue(new Error('could not list orgs'));

    const response = await GET(createRequest({ authorization: `Bearer ${SECRET}` }));

    expect(response.status).toBe(500);
    expect(((await response.json()) as { success: boolean }).success).toBe(false);
    expect(reconcileKnowledgeMirror).not.toHaveBeenCalled();
  });
});
