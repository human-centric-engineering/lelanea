/**
 * GET /api/v1/admin/app/agent/budgets (§08 t-53)
 *
 * The single enriched list a person's limit is set from. The guard, the query
 * reaching the service validated, and the search term staying out of the log —
 * the first thing anyone types into a people search is an email address.
 *
 * @see app/api/v1/admin/app/agent/budgets/route.ts
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';
import { NextRequest } from 'next/server';

import { mockAdminUser, mockAuthenticatedUser } from '@/tests/helpers/auth';

const { listUserBudgets, routeLog } = vi.hoisted(() => ({
  listUserBudgets: vi.fn(),
  routeLog: { info: vi.fn(), warn: vi.fn(), error: vi.fn(), debug: vi.fn() },
}));

vi.mock('@/lib/auth/config', () => ({ auth: { api: { getSession: vi.fn() } } }));
vi.mock('next/headers', () => ({ headers: () => Promise.resolve(new Headers()) }));
vi.mock('@/lib/app/agent/settings', () => ({ listUserBudgets }));
vi.mock('@/app/api/v1/admin/app/agent/_shared/route-logger', () => ({
  getAgentSettingsRouteLogger: () => Promise.resolve(routeLog),
}));

import { auth } from '@/lib/auth/config';
import { GET } from '@/app/api/v1/admin/app/agent/budgets/route';

const ROW = {
  userId: 'cmtu71ttv0000ch5n72hhqhtu',
  name: 'Ada',
  email: 'ada@example.com',
  role: 'USER',
  overrideUsd: null,
  effectiveCeilingUsd: 5,
};

function get(query: string) {
  return GET(new NextRequest(`https://lelanea.com/api/v1/admin/app/agent/budgets${query}`));
}

beforeEach(() => {
  vi.clearAllMocks();
  vi.mocked(auth.api.getSession).mockResolvedValue(mockAdminUser());
  listUserBudgets.mockResolvedValue({ users: [ROW], total: 1 });
});

it('answers 403 to a non-admin and reads nothing', async () => {
  vi.mocked(auth.api.getSession).mockResolvedValue(mockAuthenticatedUser('USER'));
  expect((await get('')).status).toBe(403);
  expect(listUserBudgets).not.toHaveBeenCalled();
});

describe('the list', () => {
  it('returns the enriched rows in the paginated envelope', async () => {
    const response = await get('?page=1&limit=25');
    expect(response.status).toBe(200);
    const body = (await response.json()) as { data: unknown[]; meta: Record<string, number> };
    expect(body.data).toEqual([ROW]);
    expect(body.meta).toMatchObject({ page: 1, limit: 25, total: 1, totalPages: 1 });
  });

  it('passes the validated query through', async () => {
    await get('?q=ada%40example.com&overriddenOnly=true&page=2');
    expect(listUserBudgets).toHaveBeenCalledWith({
      q: 'ada@example.com',
      overriddenOnly: true,
      page: 2,
      limit: 25,
    });
  });

  it('never logs the search term', async () => {
    await get('?q=ada%40example.com');
    const logged = JSON.stringify(routeLog.info.mock.calls);
    expect(routeLog.info).toHaveBeenCalled();
    expect(logged).not.toContain('ada@example.com');
    expect(logged).not.toContain('ada%40example.com');
  });

  it('refuses a malformed query with 400', async () => {
    expect((await get('?limit=500')).status).toBe(400);
  });
});
