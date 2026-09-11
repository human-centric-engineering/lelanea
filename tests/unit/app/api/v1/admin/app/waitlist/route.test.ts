/**
 * GET /api/v1/admin/app/waitlist — the read surface that makes the write visible.
 *
 * The done-when cases: 401 unauthenticated, 403 for a signed-in non-admin,
 * pagination, and the search reaching the query. Plus the one nobody would
 * notice by looking at the page — that neither a row nor the search TERM reaches
 * the application log. The public POST keeps the joiner's address out of its log
 * for a reason (`app/api/v1/app/waitlist/route.ts`), and an admin typing that
 * same address into a search box would otherwise put it there by the back door.
 *
 * @see app/api/v1/admin/app/waitlist/route.ts
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';
import type { NextRequest } from 'next/server';

import {
  mockAdminUser,
  mockAuthenticatedUser,
  mockUnauthenticatedUser,
} from '@/tests/helpers/auth';

const { listWaitlistEntries, routeLog } = vi.hoisted(() => ({
  listWaitlistEntries: vi.fn(),
  routeLog: { info: vi.fn(), warn: vi.fn(), error: vi.fn(), debug: vi.fn() },
}));

vi.mock('@/lib/auth/config', () => ({ auth: { api: { getSession: vi.fn() } } }));
vi.mock('next/headers', () => ({ headers: () => Promise.resolve(new Headers()) }));
vi.mock('@/lib/app/waitlist/admin', () => ({ listWaitlistEntries }));
// `tests/setup.ts` mocks `getRouteLogger` globally; this narrows it so the
// no-PII-in-logs case can read what was actually logged.
vi.mock('@/lib/api/context', () => ({ getRouteLogger: () => Promise.resolve(routeLog) }));

import { auth } from '@/lib/auth/config';
import { GET } from '@/app/api/v1/admin/app/waitlist/route';

function request(params: Record<string, string> = {}): NextRequest {
  const url = new URL('http://localhost:3000/api/v1/admin/app/waitlist');
  for (const [key, value] of Object.entries(params)) url.searchParams.set(key, value);
  return { headers: new Headers(), nextUrl: { searchParams: url.searchParams } } as NextRequest;
}

const ENTRY = {
  id: 'entry-1',
  email: 'ada@example.com',
  name: 'Ada',
  heardFrom: 'a friend',
  intent: 'to slow down',
  source: 'form',
  locale: 'en-US',
  consentedAt: '2026-09-01T10:00:00.000Z',
  userId: null,
  createdAt: '2026-09-01T10:00:00.000Z',
};

interface ListBody {
  success: boolean;
  data: (typeof ENTRY)[];
  meta: { page: number; limit: number; total: number; totalPages: number };
}

beforeEach(() => {
  vi.clearAllMocks();
  listWaitlistEntries.mockResolvedValue({ entries: [ENTRY], total: 1 });
  vi.mocked(auth.api.getSession).mockResolvedValue(mockAdminUser());
});

describe('GET /api/v1/admin/app/waitlist', () => {
  it('answers 401 when nobody is signed in, and reads nothing', async () => {
    vi.mocked(auth.api.getSession).mockResolvedValue(mockUnauthenticatedUser());

    const response = await GET(request());

    expect(response.status).toBe(401);
    expect(listWaitlistEntries).not.toHaveBeenCalled();
  });

  it('answers 403 for a signed-in non-admin, and reads nothing', async () => {
    vi.mocked(auth.api.getSession).mockResolvedValue(mockAuthenticatedUser('USER'));

    const response = await GET(request());

    // The table holds personal data about people with no account. A logged-in
    // ordinary user is exactly who must not be able to page through it.
    expect(response.status).toBe(403);
    expect(listWaitlistEntries).not.toHaveBeenCalled();
  });

  it('returns the platform’s paginated envelope', async () => {
    listWaitlistEntries.mockResolvedValue({ entries: [ENTRY], total: 60 });

    const response = await GET(request({ page: '2', limit: '25' }));

    expect(response.status).toBe(200);
    const body = (await response.json()) as ListBody;
    expect(body.success).toBe(true);
    expect(body.data[0]?.email).toBe('ada@example.com');
    expect(body.meta).toEqual({ page: 2, limit: 25, total: 60, totalPages: 3 });
  });

  it('defaults to the first page of 25 when nothing is asked for', async () => {
    await GET(request());

    expect(listWaitlistEntries).toHaveBeenCalledWith({ page: 1, limit: 25, q: undefined });
  });

  it('passes the search term through to the query', async () => {
    await GET(request({ q: 'sleep' }));

    expect(listWaitlistEntries).toHaveBeenCalledWith(
      expect.objectContaining({ q: 'sleep', page: 1 })
    );
  });

  it('rejects a page number that is not one', async () => {
    const response = await GET(request({ page: '0' }));

    expect(response.status).toBe(400);
    expect(listWaitlistEntries).not.toHaveBeenCalled();
  });

  it('caps the page size so one request cannot pull the whole table', async () => {
    const response = await GET(request({ limit: '5000' }));

    // The export is the sanctioned way to take the list away, and it has a
    // per-flow rate limit. A list route that honoured `limit=5000` would be the
    // same bulk read with none of that.
    expect(response.status).toBe(400);
    expect(listWaitlistEntries).not.toHaveBeenCalled();
  });

  it('logs what happened without logging WHO', async () => {
    await GET(request({ q: 'ada@example.com' }));

    const logged = JSON.stringify(routeLog.info.mock.calls);
    // The search term is personal data as often as not — the first thing anyone
    // types into this box is somebody's address. `searched` carries the
    // operational fact instead.
    expect(logged).not.toContain('ada@example.com');
    expect(routeLog.info).toHaveBeenCalledWith(
      'Waitlist entries listed',
      expect.objectContaining({ count: 1, total: 1, page: 1, searched: true })
    );
  });
});
