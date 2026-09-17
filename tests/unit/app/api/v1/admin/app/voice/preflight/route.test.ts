/**
 * GET /api/v1/admin/app/voice/preflight
 *
 * What the button is about to spend, before it is pressed. Admin-only for the
 * same reason as the rest of the feature — a per-agent cost signal is not a
 * thing an ordinary user should be able to read off an install.
 *
 * The property worth pinning beyond the guard is that a preflight full of nulls
 * is a 200. It is the honest answer for an install whose set is not seeded, and
 * answering 500 would take down the comparisons page for the sake of a line
 * above the button.
 *
 * @see app/api/v1/admin/app/voice/preflight/route.ts
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';
import type { NextRequest } from 'next/server';

import {
  mockAdminUser,
  mockAuthenticatedUser,
  mockUnauthenticatedUser,
} from '@/tests/helpers/auth';

const { getVoicePreflight, routeLog } = vi.hoisted(() => ({
  getVoicePreflight: vi.fn(),
  routeLog: { info: vi.fn(), warn: vi.fn(), error: vi.fn(), debug: vi.fn() },
}));

vi.mock('@/lib/auth/config', () => ({ auth: { api: { getSession: vi.fn() } } }));
vi.mock('next/headers', () => ({ headers: () => Promise.resolve(new Headers()) }));
vi.mock('@/lib/app/voice/preflight', () => ({ getVoicePreflight }));
vi.mock('@/lib/api/context', () => ({ getRouteLogger: () => Promise.resolve(routeLog) }));

import { auth } from '@/lib/auth/config';
import { GET } from '@/app/api/v1/admin/app/voice/preflight/route';

const PREFLIGHT = {
  caseCount: 5,
  arms: [{ arm: 'fingerprint', agentSlug: 'lelanea-guide', boundModel: null }],
  modelId: 'claude-sonnet-5',
  cost: {
    midUsd: 0.04,
    lowUsd: 0.02,
    highUsd: 0.08,
    basedOn: 'heuristic' as const,
    pricingKnown: true,
    notes: 'FIXTURE NOTE',
  },
};

function request(): NextRequest {
  return new Request(
    'https://lelanea.com/api/v1/admin/app/voice/preflight'
  ) as unknown as NextRequest;
}

beforeEach(() => {
  vi.clearAllMocks();
  getVoicePreflight.mockResolvedValue(PREFLIGHT);
});

describe('GET', () => {
  it('answers an admin with the model and the estimate', async () => {
    vi.mocked(auth.api.getSession).mockResolvedValue(mockAdminUser());

    const response = await GET(request());

    expect(response.status).toBe(200);
    const body = (await response.json()) as { data: typeof PREFLIGHT };
    expect(body.data.modelId).toBe('claude-sonnet-5');
    expect(body.data.cost?.midUsd).toBe(0.04);
    expect(getVoicePreflight).toHaveBeenCalledWith(mockAdminUser().user.id);
  });

  it('answers 200 when nothing could be estimated, rather than failing the page', async () => {
    vi.mocked(auth.api.getSession).mockResolvedValue(mockAdminUser());
    getVoicePreflight.mockResolvedValue({ caseCount: null, arms: [], modelId: null, cost: null });

    const response = await GET(request());

    expect(response.status).toBe(200);
    const body = (await response.json()) as { data: { cost: unknown } };
    expect(body.data.cost).toBeNull();
  });

  it('refuses a signed-in non-admin', async () => {
    vi.mocked(auth.api.getSession).mockResolvedValue(mockAuthenticatedUser());

    expect((await GET(request())).status).toBe(403);
    expect(getVoicePreflight).not.toHaveBeenCalled();
  });

  it('refuses an unauthenticated caller', async () => {
    vi.mocked(auth.api.getSession).mockResolvedValue(mockUnauthenticatedUser());

    expect((await GET(request())).status).toBe(401);
    expect(getVoicePreflight).not.toHaveBeenCalled();
  });
});
