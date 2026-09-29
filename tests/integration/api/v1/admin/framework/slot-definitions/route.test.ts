/**
 * Integration test — GET /api/v1/admin/framework/slot-definitions (f-slots t-3).
 *
 * The API-contract layer: proves the route is admin-guarded and returns the
 * `framework_slot_definition` rows (via `listSlotDefinitions`) in the standard
 * success envelope. The register → sync → row mechanics are proven separately by the
 * sync unit test and the end-to-end visibility test under
 * tests/integration/lib/framework/data-slots/ (t-1); this file mocks Prisma directly
 * to pin the HTTP contract.
 *
 * @see app/api/v1/admin/framework/slot-definitions/route.ts
 */

import { describe, it, expect, beforeEach, vi } from 'vitest';
import { NextRequest } from 'next/server';
import { GET } from '@/app/api/v1/admin/framework/slot-definitions/route';
import {
  mockAdminUser,
  mockAuthenticatedUser,
  mockUnauthenticatedUser,
} from '@/tests/helpers/auth';
import type { SlotDefinition } from '@prisma/client';

const dummyRequest = new NextRequest(
  'http://localhost:3000/api/v1/admin/framework/slot-definitions'
);

vi.mock('@/lib/auth/config', () => ({
  auth: { api: { getSession: vi.fn() } },
}));

vi.mock('next/headers', () => ({
  headers: vi.fn(() => Promise.resolve(new Headers())),
}));

vi.mock('@/lib/db/client', () => ({
  prisma: {
    slotDefinition: { findMany: vi.fn() },
  },
}));

import { auth } from '@/lib/auth/config';
import { prisma } from '@/lib/db/client';

async function parseResponse<T>(response: Response): Promise<T> {
  return JSON.parse(await response.text()) as T;
}

function mockSlotDefinition(overrides: Partial<SlotDefinition> = {}): SlotDefinition {
  return {
    id: 'slot_1',
    orgId: 'install',
    slug: 'demo-slot',
    group: 'demo',
    description: 'A demo slot',
    scope: 'global',
    visibility: 'open',
    mode: 'targeted',
    dataType: 'text',
    sensitivity: 'standard',
    priorityWeight: 0,
    isActive: true,
    createdAt: new Date('2026-07-04'),
    updatedAt: new Date('2026-07-04'),
    ...overrides,
  };
}

describe('GET /api/v1/admin/framework/slot-definitions', () => {
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
      expect(prisma.slotDefinition.findMany).not.toHaveBeenCalled();
    });

    it('returns 403 when authenticated but not admin', async () => {
      vi.mocked(auth.api.getSession).mockResolvedValue(mockAuthenticatedUser('USER'));

      const response = await GET(dummyRequest);

      expect(response.status).toBe(403);
      expect(await parseResponse(response)).toMatchObject({
        success: false,
        error: { code: 'FORBIDDEN' },
      });
      expect(prisma.slotDefinition.findMany).not.toHaveBeenCalled();
    });
  });

  describe('successful retrieval (admin)', () => {
    beforeEach(() => {
      vi.mocked(auth.api.getSession).mockResolvedValue(mockAdminUser());
    });

    it('passes the rows through the success envelope and requests slug ordering from the DB', async () => {
      const rows = [
        mockSlotDefinition({ id: 'slot_a', slug: 'alpha', group: 'a' }),
        // An inactive row (code removed, retained for audit) must survive the read.
        mockSlotDefinition({ id: 'slot_b', slug: 'beta', group: 'b', isActive: false }),
      ];
      vi.mocked(prisma.slotDefinition.findMany).mockResolvedValue(rows);

      const response = await GET(dummyRequest);

      expect(response.status).toBe(200);
      const body = await parseResponse<{ success: boolean; data: SlotDefinition[] }>(response);
      expect(body.success).toBe(true);
      // The route returns exactly the rows the query gave it, unshaped (raw rows).
      expect(body.data.map((s) => s.slug)).toEqual(['alpha', 'beta']);
      expect(body.data[1]?.isActive).toBe(false);
      // The ORDERING guarantee lives in the query, not the mock: assert
      // listSlotDefinitions asks the DB to sort by slug (the mock can't order).
      expect(prisma.slotDefinition.findMany).toHaveBeenCalledWith({ orderBy: { slug: 'asc' } });
    });

    it('returns an empty array when no slot definitions are registered (clean-fork state)', async () => {
      vi.mocked(prisma.slotDefinition.findMany).mockResolvedValue([]);

      const response = await GET(dummyRequest);

      expect(response.status).toBe(200);
      const body = await parseResponse<{ success: boolean; data: SlotDefinition[] }>(response);
      expect(body.success).toBe(true);
      expect(body.data).toEqual([]);
    });
  });
});
