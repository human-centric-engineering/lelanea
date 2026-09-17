/**
 * POST /api/v1/admin/app/voice/comparisons/:id/cancel
 *
 * The stop button's route. Two things are worth pinning and neither is the happy
 * path: it is admin-only for the same reason the queue route is — the runs it
 * stops are the ones billing the install, and who may stop a run is the same
 * question as who may start one — and an id that is not a CUID is refused before
 * anything reaches the database.
 *
 * @see app/api/v1/admin/app/voice/comparisons/[id]/cancel/route.ts
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';
import type { NextRequest } from 'next/server';

import {
  mockAdminUser,
  mockAuthenticatedUser,
  mockUnauthenticatedUser,
} from '@/tests/helpers/auth';

const { cancelVoiceComparison, routeLog } = vi.hoisted(() => ({
  cancelVoiceComparison: vi.fn(),
  routeLog: { info: vi.fn(), warn: vi.fn(), error: vi.fn(), debug: vi.fn() },
}));

vi.mock('@/lib/auth/config', () => ({ auth: { api: { getSession: vi.fn() } } }));
vi.mock('next/headers', () => ({ headers: () => Promise.resolve(new Headers()) }));
vi.mock('@/lib/app/voice/comparison', () => ({ cancelVoiceComparison }));
vi.mock('@/lib/api/context', () => ({ getRouteLogger: () => Promise.resolve(routeLog) }));

import { auth } from '@/lib/auth/config';
import { POST } from '@/app/api/v1/admin/app/voice/comparisons/[id]/cancel/route';

const COMPARISON_ID = 'cmu4paqmt0000oc5new0nizu5';

function request(): NextRequest {
  return new Request(
    `https://lelanea.com/api/v1/admin/app/voice/comparisons/${COMPARISON_ID}/cancel`,
    { method: 'POST' }
  ) as unknown as NextRequest;
}

function context(id: string) {
  return { params: Promise.resolve({ id }) };
}

beforeEach(() => {
  vi.clearAllMocks();
  cancelVoiceComparison.mockResolvedValue({
    comparisonId: COMPARISON_ID,
    cancelled: ['fingerprint', 'bare'],
    alreadyFinished: [],
  });
});

describe('POST', () => {
  it('stops the comparison for an admin, and says which arms it caught', async () => {
    vi.mocked(auth.api.getSession).mockResolvedValue(mockAdminUser());

    const response = await POST(request(), context(COMPARISON_ID));

    expect(response.status).toBe(200);
    expect(cancelVoiceComparison).toHaveBeenCalledWith(COMPARISON_ID, mockAdminUser().user.id);
    const body = (await response.json()) as { data: { cancelled: string[] } };
    // Which arms were actually caught is the answer to "did pressing that do
    // anything", and a bare 200 does not carry it.
    expect(body.data.cancelled).toEqual(['fingerprint', 'bare']);
  });

  it('refuses a signed-in non-admin', async () => {
    vi.mocked(auth.api.getSession).mockResolvedValue(mockAuthenticatedUser());

    const response = await POST(request(), context(COMPARISON_ID));

    expect(response.status).toBe(403);
    expect(cancelVoiceComparison).not.toHaveBeenCalled();
  });

  it('refuses an unauthenticated caller', async () => {
    vi.mocked(auth.api.getSession).mockResolvedValue(mockUnauthenticatedUser());

    const response = await POST(request(), context(COMPARISON_ID));

    expect(response.status).toBe(401);
    expect(cancelVoiceComparison).not.toHaveBeenCalled();
  });

  it('rejects an id that is not a CUID before touching the database', async () => {
    vi.mocked(auth.api.getSession).mockResolvedValue(mockAdminUser());

    const response = await POST(request(), context('../../runs/all'));

    expect(response.status).toBe(400);
    expect(cancelVoiceComparison).not.toHaveBeenCalled();
  });
});
