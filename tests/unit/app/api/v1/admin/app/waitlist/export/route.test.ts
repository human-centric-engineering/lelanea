/**
 * GET /api/v1/admin/app/waitlist/export — taking the list away as a file.
 *
 * A bulk read of other people's email addresses and stated intentions, so the
 * cases are about the things that make that safe rather than about CSV
 * formatting (which `tests/unit/lib/app/waitlist/admin.test.ts` pins on the
 * serialiser): who is refused, what the per-flow limiter stops, what the
 * response tells a cache, and whether a short file says it is short.
 *
 * @see app/api/v1/admin/app/waitlist/export/route.ts
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';
import type { NextRequest } from 'next/server';

import {
  mockAdminUser,
  mockAuthenticatedUser,
  mockUnauthenticatedUser,
} from '@/tests/helpers/auth';

const { collectWaitlistEntriesForExport, check, routeLog } = vi.hoisted(() => ({
  collectWaitlistEntriesForExport: vi.fn(),
  check: vi.fn(),
  routeLog: { info: vi.fn(), warn: vi.fn(), error: vi.fn(), debug: vi.fn() },
}));

vi.mock('@/lib/auth/config', () => ({ auth: { api: { getSession: vi.fn() } } }));
vi.mock('next/headers', () => ({ headers: () => Promise.resolve(new Headers()) }));
// The route takes its logger from `_shared/route-logger.ts` rather than from
// `getRouteLogger`, because that one binds the full request URL — query string
// included — to every line. Mocked here so the no-PII-in-logs case can read what
// was actually logged; the dropping of `url` is asserted on the real helper in
// tests/unit/app/api/v1/admin/app/waitlist/_shared/route-logger.test.ts.
vi.mock('@/app/api/v1/admin/app/waitlist/_shared/route-logger', () => ({
  getWaitlistRouteLogger: () => Promise.resolve(routeLog),
}));

// The serialiser and the cap are the real ones — the CSV a caller receives is
// what this route is for, so stubbing the thing that builds it would leave the
// route proved only against itself.
vi.mock('@/lib/app/waitlist/admin', async () => {
  const actual = await vi.importActual<typeof import('@/lib/app/waitlist/admin')>(
    '@/lib/app/waitlist/admin'
  );
  return { ...actual, collectWaitlistEntriesForExport };
});

vi.mock('@/lib/security/rate-limit', async () => {
  const actual = await vi.importActual<typeof import('@/lib/security/rate-limit')>(
    '@/lib/security/rate-limit'
  );
  return { ...actual, exportLimiter: { check } };
});

import { auth } from '@/lib/auth/config';
import { WAITLIST_EXPORT_MAX_ROWS } from '@/lib/app/waitlist/admin';
import { GET } from '@/app/api/v1/admin/app/waitlist/export/route';

function request(params: Record<string, string> = {}): NextRequest {
  const url = new URL('http://localhost:3000/api/v1/admin/app/waitlist/export');
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

const ALLOWED = { success: true, limit: 10, remaining: 9, reset: 1_800_000_000 };

beforeEach(() => {
  vi.clearAllMocks();
  check.mockReturnValue(ALLOWED);
  collectWaitlistEntriesForExport.mockResolvedValue({ entries: [ENTRY], total: 1 });
  vi.mocked(auth.api.getSession).mockResolvedValue(mockAdminUser());
});

describe('GET /api/v1/admin/app/waitlist/export', () => {
  it('answers 401 when nobody is signed in, and reads nothing', async () => {
    vi.mocked(auth.api.getSession).mockResolvedValue(mockUnauthenticatedUser());

    const response = await GET(request());

    expect(response.status).toBe(401);
    expect(collectWaitlistEntriesForExport).not.toHaveBeenCalled();
  });

  it('answers 403 for a signed-in non-admin, and reads nothing', async () => {
    vi.mocked(auth.api.getSession).mockResolvedValue(mockAuthenticatedUser('USER'));

    const response = await GET(request());

    expect(response.status).toBe(403);
    expect(collectWaitlistEntriesForExport).not.toHaveBeenCalled();
  });

  it('serves a CSV attachment named for the day', async () => {
    const response = await GET(request());

    expect(response.status).toBe(200);
    expect(response.headers.get('content-type')).toBe('text/csv; charset=utf-8');
    expect(response.headers.get('content-disposition')).toMatch(
      /^attachment; filename="lelanea-waitlist-\d{4}-\d{2}-\d{2}\.csv"$/
    );

    const body = await response.text();
    expect(body).toContain('id,email,name,heard_from,intent,source,locale');
    expect(body).toContain('ada@example.com');
  });

  it('puts the UTF-8 BOM on the wire, where Excel will look for it', async () => {
    const response = await GET(request());

    // Asserted on the BYTES, not on `response.text()`: `TextDecoder` defaults to
    // `ignoreBOM: false`, so reading the body as text silently removes the one
    // thing this case is about. An earlier version of this test asserted on the
    // string and failed against a response that was perfectly correct.
    const bytes = new Uint8Array(await response.arrayBuffer());
    expect([...bytes.slice(0, 3)]).toEqual([0xef, 0xbb, 0xbf]);
  });

  it('tells every cache between here and the browser to keep nothing', async () => {
    const response = await GET(request());

    // A raw `Response` skips `successResponse`'s `private, no-cache` default, so
    // without this the file of strangers' addresses carries no directive at all
    // — which RFC 9111 §4.2.2 lets a shared cache store and expire on a guess.
    expect(response.headers.get('cache-control')).toBe('private, no-store');
  });

  it('applies the per-flow sub-cap, keyed on the admin rather than on everyone', async () => {
    await GET(request());

    expect(check).toHaveBeenCalledWith(`export:user:${mockAdminUser().user.id}`);
  });

  it('answers 429 past the sub-cap, without touching the table', async () => {
    check.mockReturnValue({ success: false, limit: 10, remaining: 0, reset: 1_800_000_000 });

    const response = await GET(request());

    // The section tier the proxy already applied would allow a hundred full-table
    // downloads a minute. This is the layer that matters for a bulk read.
    expect(response.status).toBe(429);
    expect(collectWaitlistEntriesForExport).not.toHaveBeenCalled();
  });

  it('exports what the admin is looking at, filter and all', async () => {
    await GET(request({ q: 'sleep' }));

    expect(collectWaitlistEntriesForExport).toHaveBeenCalledWith({ q: 'sleep' });
  });

  it('says in the filename when the file is only the first N', async () => {
    collectWaitlistEntriesForExport.mockResolvedValue({
      entries: [ENTRY],
      total: WAITLIST_EXPORT_MAX_ROWS + 1,
    });

    const response = await GET(request());

    // The cap creates a state the system did not have — a silently short file —
    // so the remedy ships with it (`HB10`). The name is the only signal a plain
    // browser download carries.
    expect(response.headers.get('content-disposition')).toContain(
      `-first-${WAITLIST_EXPORT_MAX_ROWS}.csv`
    );
  });

  it('logs the size of what left, and nobody’s address', async () => {
    await GET(request({ q: 'ada@example.com' }));

    const logged = JSON.stringify(routeLog.info.mock.calls);
    expect(logged).not.toContain('ada@example.com');
    expect(routeLog.info).toHaveBeenCalledWith(
      'Waitlist exported',
      expect.objectContaining({ count: 1, total: 1, truncated: false, searched: true })
    );
  });
});
