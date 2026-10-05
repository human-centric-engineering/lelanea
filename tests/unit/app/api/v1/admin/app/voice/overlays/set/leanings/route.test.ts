/**
 * PUT /api/v1/admin/app/voice/overlays/set/leanings (f-leanings t-138)
 *
 * The guard, the body, and the audit. What a save does to the stored set and
 * to every reader of it is `tests/unit/lib/app/voice/leaning-bounds-admin.test.ts`,
 * against the real service; here the service is a mock, so these cases pin
 * what reaches it and what never does.
 *
 * @see app/api/v1/admin/app/voice/overlays/set/leanings/route.ts
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';
import type { NextRequest } from 'next/server';

import {
  mockAdminUser,
  mockAuthenticatedUser,
  mockUnauthenticatedUser,
} from '@/tests/helpers/auth';
import { readVoiceOverlaysFile } from '@/lib/app/content/seed-input/voice-overlay-seed';
import type { LeaningBounds } from '@/lib/app/voice/leanings';

const { updateLeaningBounds, logAdminAction, routeLog } = vi.hoisted(() => ({
  updateLeaningBounds: vi.fn(),
  logAdminAction: vi.fn(),
  routeLog: { info: vi.fn(), warn: vi.fn(), error: vi.fn(), debug: vi.fn() },
}));

vi.mock('@/lib/auth/config', () => ({ auth: { api: { getSession: vi.fn() } } }));
vi.mock('next/headers', () => ({ headers: () => Promise.resolve(new Headers()) }));
vi.mock('@/lib/app/voice/overlays-admin', () => ({ updateLeaningBounds }));
vi.mock('@/lib/orchestration/audit/admin-audit-logger', () => ({ logAdminAction }));
vi.mock('@/lib/api/context', () => ({ getRouteLogger: () => Promise.resolve(routeLog) }));

import { auth } from '@/lib/auth/config';
import { PUT } from '@/app/api/v1/admin/app/voice/overlays/set/leanings/route';

const drafted = (): LeaningBounds => readVoiceOverlaysFile().leanings!;

function request(body: unknown): NextRequest {
  return new Request('https://lelanea.com/api/v1/admin/app/voice/overlays/set/leanings', {
    method: 'PUT',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify(body),
  }) as unknown as NextRequest;
}

/** The drafted bounds with one dial's bounds replaced by `dial` (unvalidated, as a client could send). */
function withDial(dial: unknown) {
  const bounds = drafted();
  return { ...bounds, dials: { ...bounds.dials, pace: dial } };
}

beforeEach(() => {
  vi.clearAllMocks();
  vi.mocked(auth.api.getSession).mockResolvedValue(mockAdminUser());
  updateLeaningBounds.mockResolvedValue({
    changed: ['leanings'],
    changes: { leanings: { from: 'before', to: 'after' } },
    revision: 4,
    status: 'draft',
  });
});

describe('PUT', () => {
  it('saves an admin’s bounds at the revision read, and audits the change', async () => {
    const leanings = withDial({ min: -1, max: 0, suggest: false });

    const response = await PUT(request({ leanings, revision: 3 }));

    expect(response.status).toBe(200);
    expect(updateLeaningBounds).toHaveBeenCalledWith(leanings, 3, mockAdminUser().user.id);
    const body = (await response.json()) as { data: { revision: number; status: string } };
    expect(body.data).toMatchObject({ revision: 4, status: 'draft' });
    expect(logAdminAction).toHaveBeenCalledWith(
      expect.objectContaining({
        action: 'app_voice_overlay_set.leanings_update',
        changes: { leanings: { from: 'before', to: 'after' } },
      })
    );
  });

  it('records no audit entry when nothing changed', async () => {
    updateLeaningBounds.mockResolvedValue({
      changed: [],
      changes: {},
      revision: 3,
      status: 'draft',
    });

    const response = await PUT(request({ leanings: drafted(), revision: 3 }));

    expect(response.status).toBe(200);
    expect(logAdminAction).not.toHaveBeenCalled();
  });

  it.each([
    ['a floor above rest', { min: 1, max: 2, suggest: true }],
    ['a ceiling below rest', { min: -2, max: -1, suggest: true }],
  ])('refuses a bound that would hold a dial away from rest: %s', async (_name, dial) => {
    const response = await PUT(request({ leanings: withDial(dial), revision: 3 }));

    expect(response.status).toBe(400);
    expect(updateLeaningBounds).not.toHaveBeenCalled();
  });

  it('refuses bounds that leave a dial out, rather than dropping it', async () => {
    const { pace: _dropped, ...dials } = drafted().dials;

    const response = await PUT(request({ leanings: { ...drafted(), dials }, revision: 3 }));

    expect(response.status).toBe(400);
    expect(updateLeaningBounds).not.toHaveBeenCalled();
  });

  it('refuses a body with no revision', async () => {
    expect((await PUT(request({ leanings: drafted() }))).status).toBe(400);
    expect(updateLeaningBounds).not.toHaveBeenCalled();
  });

  it('refuses a signed-in non-admin', async () => {
    vi.mocked(auth.api.getSession).mockResolvedValue(mockAuthenticatedUser());

    expect((await PUT(request({ leanings: drafted(), revision: 3 }))).status).toBe(403);
    expect(updateLeaningBounds).not.toHaveBeenCalled();
  });

  it('refuses an unauthenticated caller', async () => {
    vi.mocked(auth.api.getSession).mockResolvedValue(mockUnauthenticatedUser());

    expect((await PUT(request({ leanings: drafted(), revision: 3 }))).status).toBe(401);
    expect(updateLeaningBounds).not.toHaveBeenCalled();
  });
});
