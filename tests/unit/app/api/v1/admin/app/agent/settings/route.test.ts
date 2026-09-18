/**
 * GET / PUT /api/v1/admin/app/agent/settings (§08 t-53)
 *
 * The guard, the three refusals the task names, and the audit entry — who
 * changed the numbers lives there and nowhere else, which is what lets the row
 * be excluded from the Art. 15 export as holding nothing about anyone.
 *
 * @see app/api/v1/admin/app/agent/settings/route.ts
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';
import type { NextRequest } from 'next/server';

import {
  mockAdminUser,
  mockAuthenticatedUser,
  mockUnauthenticatedUser,
} from '@/tests/helpers/auth';

const { getAgentSettings, updateAgentSettings, logAdminAction, routeLog } = vi.hoisted(() => ({
  getAgentSettings: vi.fn(),
  updateAgentSettings: vi.fn(),
  logAdminAction: vi.fn(),
  routeLog: { info: vi.fn(), warn: vi.fn(), error: vi.fn(), debug: vi.fn() },
}));

vi.mock('@/lib/auth/config', () => ({ auth: { api: { getSession: vi.fn() } } }));
vi.mock('next/headers', () => ({ headers: () => Promise.resolve(new Headers()) }));
vi.mock('@/lib/app/agent/settings', () => ({ getAgentSettings, updateAgentSettings }));
vi.mock('@/lib/orchestration/audit/admin-audit-logger', () => ({ logAdminAction }));
vi.mock('@/app/api/v1/admin/app/agent/_shared/route-logger', () => ({
  getAgentSettingsRouteLogger: () => Promise.resolve(routeLog),
}));

import { auth } from '@/lib/auth/config';
import { GET, PUT } from '@/app/api/v1/admin/app/agent/settings/route';

const URL = 'https://lelanea.com/api/v1/admin/app/agent/settings';
const STORED = {
  firstWordsDeadlineMs: 8000,
  turnDeadlineMs: 60000,
  defaultMonthlyCeilingUsd: 5,
  updatedAt: new Date('2026-09-18T12:00:00Z'),
};

function put(body: unknown) {
  return PUT(
    new Request(URL, {
      method: 'PUT',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify(body),
    }) as unknown as NextRequest
  );
}

beforeEach(() => {
  vi.clearAllMocks();
  vi.mocked(auth.api.getSession).mockResolvedValue(mockAdminUser());
  getAgentSettings.mockResolvedValue(STORED);
  updateAgentSettings.mockImplementation(async (update: object) => ({
    ...STORED,
    ...update,
    updatedAt: new Date('2026-09-18T13:00:00Z'),
  }));
});

describe('the guard', () => {
  it('answers 401 to nobody and 403 to a non-admin, and writes nothing', async () => {
    vi.mocked(auth.api.getSession).mockResolvedValue(mockUnauthenticatedUser());
    expect((await put({ ...STORED })).status).toBe(401);

    vi.mocked(auth.api.getSession).mockResolvedValue(mockAuthenticatedUser('USER'));
    expect((await put({ ...STORED })).status).toBe(403);
    expect((await GET(new Request(URL) as unknown as NextRequest)).status).toBe(403);

    expect(updateAgentSettings).not.toHaveBeenCalled();
  });
});

describe('GET', () => {
  it('reads the stored settings back', async () => {
    const response = await GET(new Request(URL) as unknown as NextRequest);
    expect(response.status).toBe(200);
    const body = (await response.json()) as { data: { settings: Record<string, unknown> } };
    expect(body.data.settings).toMatchObject({
      firstWordsDeadlineMs: 8000,
      turnDeadlineMs: 60000,
      defaultMonthlyCeilingUsd: 5,
    });
  });
});

describe('PUT', () => {
  it.each([
    [
      'a non-positive deadline',
      { firstWordsDeadlineMs: 0, turnDeadlineMs: 60000, defaultMonthlyCeilingUsd: 5 },
    ],
    [
      'first words not shorter than the turn',
      { firstWordsDeadlineMs: 60000, turnDeadlineMs: 60000, defaultMonthlyCeilingUsd: 5 },
    ],
    [
      'a negative ceiling',
      { firstWordsDeadlineMs: 8000, turnDeadlineMs: 60000, defaultMonthlyCeilingUsd: -1 },
    ],
  ])('refuses %s with 400 and writes nothing', async (_label, body) => {
    const response = await put(body);
    expect(response.status).toBe(400);
    expect(updateAgentSettings).not.toHaveBeenCalled();
    expect(logAdminAction).not.toHaveBeenCalled();
  });

  it('stores all three and audits exactly what changed', async () => {
    const response = await put({
      firstWordsDeadlineMs: 6000,
      turnDeadlineMs: 60000,
      defaultMonthlyCeilingUsd: 3,
    });

    expect(response.status).toBe(200);
    expect(updateAgentSettings).toHaveBeenCalledWith({
      firstWordsDeadlineMs: 6000,
      turnDeadlineMs: 60000,
      defaultMonthlyCeilingUsd: 3,
    });
    expect(logAdminAction).toHaveBeenCalledWith(
      expect.objectContaining({
        action: 'app_agent_settings.update',
        entityType: 'settings',
        changes: {
          firstWordsDeadlineMs: { from: 8000, to: 6000 },
          defaultMonthlyCeilingUsd: { from: 5, to: 3 },
        },
      })
    );
  });
});
