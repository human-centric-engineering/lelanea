/**
 * Integration test — GET /api/v1/admin/framework/modules (f-module-core t-3).
 *
 * The API-contract layer: proves the route is admin-guarded and returns the
 * `framework_module` rows (via `listModules`) in the standard success envelope.
 * The register → sync → row mechanics are proven separately by the sync unit test
 * (t-1) and the end-to-end visibility test
 * (tests/integration/lib/framework/modules/registration-visibility.test.ts); this
 * file mocks Prisma directly to pin the HTTP contract.
 *
 * @see app/api/v1/admin/framework/modules/route.ts
 */

import { describe, it, expect, beforeEach, vi } from 'vitest';
import { NextRequest } from 'next/server';
import { GET } from '@/app/api/v1/admin/framework/modules/route';
import {
  mockAdminUser,
  mockAuthenticatedUser,
  mockUnauthenticatedUser,
} from '@/tests/helpers/auth';
import type { Module } from '@prisma/client';

const dummyRequest = new NextRequest('http://localhost:3000/api/v1/admin/framework/modules');

vi.mock('@/lib/auth/config', () => ({
  auth: { api: { getSession: vi.fn() } },
}));

vi.mock('next/headers', () => ({
  headers: vi.fn(() => Promise.resolve(new Headers())),
}));

vi.mock('@/lib/db/client', () => ({
  prisma: {
    module: { findMany: vi.fn() },
  },
}));

import { auth } from '@/lib/auth/config';
import { prisma } from '@/lib/db/client';

async function parseResponse<T>(response: Response): Promise<T> {
  return JSON.parse(await response.text()) as T;
}

function mockModule(overrides: Partial<Module> = {}): Module {
  return {
    id: 'mod_1',
    orgId: 'install',
    slug: 'demo',
    name: 'Demo',
    status: 'draft',
    featureFlagName: null,
    availableFrom: null,
    availableUntil: null,
    audience: 'all',
    config: {},
    isRegistered: true,
    createdAt: new Date('2026-07-03'),
    updatedAt: new Date('2026-07-03'),
    ...overrides,
  };
}

describe('GET /api/v1/admin/framework/modules', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  describe('authentication & authorization', () => {
    it('returns 401 when unauthenticated', async () => {
      vi.mocked(auth.api.getSession).mockResolvedValue(mockUnauthenticatedUser());

      const response = await GET(dummyRequest);

      expect(response.status).toBe(401);
      expect(await parseResponse(response)).toMatchObject({
        success: false,
        error: { code: 'UNAUTHORIZED' },
      });
      // The DB is never touched for an unauthorized caller.
      expect(prisma.module.findMany).not.toHaveBeenCalled();
    });

    it('returns 403 when authenticated but not admin', async () => {
      vi.mocked(auth.api.getSession).mockResolvedValue(mockAuthenticatedUser('USER'));

      const response = await GET(dummyRequest);

      expect(response.status).toBe(403);
      expect(await parseResponse(response)).toMatchObject({
        success: false,
        error: { code: 'FORBIDDEN' },
      });
      expect(prisma.module.findMany).not.toHaveBeenCalled();
    });
  });

  describe('successful retrieval (admin)', () => {
    beforeEach(() => {
      vi.mocked(auth.api.getSession).mockResolvedValue(mockAdminUser());
    });

    it('passes the rows through the success envelope and requests slug ordering from the DB', async () => {
      const rows = [
        mockModule({ id: 'mod_a', slug: 'alpha', name: 'Alpha' }),
        mockModule({ id: 'mod_b', slug: 'beta', name: 'Beta', isRegistered: false }),
      ];
      vi.mocked(prisma.module.findMany).mockResolvedValue(rows);

      const response = await GET(dummyRequest);

      expect(response.status).toBe(200);
      const body = await parseResponse<{ success: boolean; data: Module[] }>(response);
      expect(body.success).toBe(true);
      // The route returns exactly the rows the query gave it, unshaped (raw Module rows).
      expect(body.data.map((m) => m.slug)).toEqual(['alpha', 'beta']);
      expect(body.data[1]?.isRegistered).toBe(false);
      // The ORDERING guarantee lives in the query, not the mock: assert listModules
      // asks the DB to sort by slug (the mock can't order; Prisma does at runtime).
      expect(prisma.module.findMany).toHaveBeenCalledWith({ orderBy: { slug: 'asc' } });
    });

    it('returns an empty array when no modules are registered (clean-fork state)', async () => {
      vi.mocked(prisma.module.findMany).mockResolvedValue([]);

      const response = await GET(dummyRequest);

      expect(response.status).toBe(200);
      const body = await parseResponse<{ success: boolean; data: Module[] }>(response);
      expect(body.success).toBe(true);
      expect(body.data).toEqual([]);
    });
  });
});
