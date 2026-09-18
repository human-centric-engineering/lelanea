/**
 * PUT / DELETE /api/v1/admin/app/agent/budgets/:userId (§08 t-53)
 *
 * Set a person's own limit; clear it back to the default. Clearing is a DELETE,
 * never a zero, and is idempotent. Both are audited; neither logs the address.
 *
 * @see app/api/v1/admin/app/agent/budgets/[userId]/route.ts
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';
import type { NextRequest } from 'next/server';

import { mockAdminUser, mockAuthenticatedUser } from '@/tests/helpers/auth';

const { setUserBudget, clearUserBudget, logAdminAction, routeLog } = vi.hoisted(() => ({
  setUserBudget: vi.fn(),
  clearUserBudget: vi.fn(),
  logAdminAction: vi.fn(),
  routeLog: { info: vi.fn(), warn: vi.fn(), error: vi.fn(), debug: vi.fn() },
}));

vi.mock('@/lib/auth/config', () => ({ auth: { api: { getSession: vi.fn() } } }));
vi.mock('next/headers', () => ({ headers: () => Promise.resolve(new Headers()) }));
vi.mock('@/lib/app/agent/settings', () => ({ setUserBudget, clearUserBudget }));
vi.mock('@/lib/orchestration/audit/admin-audit-logger', () => ({ logAdminAction }));
vi.mock('@/app/api/v1/admin/app/agent/_shared/route-logger', () => ({
  getAgentSettingsRouteLogger: () => Promise.resolve(routeLog),
}));

import { auth } from '@/lib/auth/config';
import { DELETE, PUT } from '@/app/api/v1/admin/app/agent/budgets/[userId]/route';

const USER_ID = 'cmtu71ttv0000ch5n72hhqhtu';
const ROW = {
  userId: USER_ID,
  name: 'Ada',
  email: 'ada@example.com',
  role: 'USER',
  overrideUsd: 12.5,
  effectiveCeilingUsd: 12.5,
};

function request(method: 'PUT' | 'DELETE', body?: unknown, id = USER_ID) {
  const req = new Request(`https://lelanea.com/api/v1/admin/app/agent/budgets/${id}`, {
    method,
    headers: body === undefined ? undefined : { 'content-type': 'application/json' },
    body: body === undefined ? undefined : JSON.stringify(body),
  }) as unknown as NextRequest;
  return [req, { params: Promise.resolve({ userId: id }) }] as const;
}

beforeEach(() => {
  vi.clearAllMocks();
  vi.mocked(auth.api.getSession).mockResolvedValue(mockAdminUser());
  setUserBudget.mockResolvedValue(ROW);
  clearUserBudget.mockResolvedValue({
    row: { ...ROW, overrideUsd: null, effectiveCeilingUsd: 5 },
    cleared: true,
  });
});

it('answers 403 to a non-admin and writes nothing', async () => {
  vi.mocked(auth.api.getSession).mockResolvedValue(mockAuthenticatedUser('USER'));
  expect((await PUT(...request('PUT', { monthlyCeilingUsd: 3 }))).status).toBe(403);
  expect((await DELETE(...request('DELETE'))).status).toBe(403);
  expect(setUserBudget).not.toHaveBeenCalled();
  expect(clearUserBudget).not.toHaveBeenCalled();
});

describe('PUT', () => {
  it('sets the limit, answers with the row, and audits it', async () => {
    const response = await PUT(...request('PUT', { monthlyCeilingUsd: 12.5 }));
    expect(response.status).toBe(200);
    expect(setUserBudget).toHaveBeenCalledWith(USER_ID, 12.5);
    const body = (await response.json()) as { data: { budget: unknown } };
    expect(body.data.budget).toEqual(ROW);
    expect(logAdminAction).toHaveBeenCalledWith(
      expect.objectContaining({
        action: 'app_user_budget.set',
        entityId: USER_ID,
        metadata: { monthlyCeilingUsd: 12.5 },
      })
    );
    expect(JSON.stringify(routeLog.info.mock.calls)).not.toContain('ada@example.com');
  });

  it('accepts zero — a real answer', async () => {
    expect((await PUT(...request('PUT', { monthlyCeilingUsd: 0 }))).status).toBe(200);
    expect(setUserBudget).toHaveBeenCalledWith(USER_ID, 0);
  });

  it('refuses a negative limit with 400 and writes nothing', async () => {
    expect((await PUT(...request('PUT', { monthlyCeilingUsd: -1 }))).status).toBe(400);
    expect(setUserBudget).not.toHaveBeenCalled();
  });

  it('refuses a malformed id with 400', async () => {
    expect((await PUT(...request('PUT', { monthlyCeilingUsd: 1 }, 'not-an-id'))).status).toBe(400);
  });

  it('answers 404 for an account that does not exist', async () => {
    setUserBudget.mockResolvedValue(null);
    expect((await PUT(...request('PUT', { monthlyCeilingUsd: 3 }))).status).toBe(404);
    expect(logAdminAction).not.toHaveBeenCalled();
  });
});

describe('DELETE', () => {
  it('clears the limit back to the default and audits it', async () => {
    const response = await DELETE(...request('DELETE'));
    expect(response.status).toBe(200);
    const body = (await response.json()) as {
      data: { budget: { overrideUsd: null }; cleared: boolean };
    };
    expect(body.data.cleared).toBe(true);
    expect(body.data.budget.overrideUsd).toBeNull();
    expect(logAdminAction).toHaveBeenCalledWith(
      expect.objectContaining({ action: 'app_user_budget.clear', entityId: USER_ID })
    );
  });

  it('is idempotent: nothing to clear is 200, and is not audited as a change', async () => {
    clearUserBudget.mockResolvedValue({
      row: { ...ROW, overrideUsd: null, effectiveCeilingUsd: 5 },
      cleared: false,
    });
    const response = await DELETE(...request('DELETE'));
    expect(response.status).toBe(200);
    expect(logAdminAction).not.toHaveBeenCalled();
  });

  it('answers 404 for an account that does not exist', async () => {
    clearUserBudget.mockResolvedValue(null);
    expect((await DELETE(...request('DELETE'))).status).toBe(404);
  });
});
