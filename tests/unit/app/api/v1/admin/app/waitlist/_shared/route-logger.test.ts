/**
 * The waitlist admin routes' logger, and the one field it refuses to carry.
 *
 * Both routes log `searched: true` rather than the search term, because the term
 * is somebody's email address as often as not. The security review of §03 t-8
 * found that claim false: `getRouteLogger` binds the full request URL — query
 * string included — to every line, and `url` is not a key the sanitiser redacts,
 * so the address went to stdout and into the buffer `/admin/logs` serves.
 *
 * These cases assert on what an emitted entry actually CONTAINS, not on the
 * context object, because the context is the thing that was already wrong while
 * looking right.
 *
 * @see app/api/v1/admin/app/waitlist/_shared/route-logger.ts
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';

const { withContext, childLogger } = vi.hoisted(() => {
  const childLogger = { info: vi.fn(), warn: vi.fn(), error: vi.fn(), debug: vi.fn() };
  // Typed parameter, so `mock.calls[0][0]` is a context object rather than an
  // element of an empty tuple — `vi.fn(() => …)` declares no parameters at all.
  return {
    withContext: vi.fn((_context: Record<string, unknown>) => childLogger),
    childLogger,
  };
});

vi.mock('@/lib/logging', () => ({ logger: { withContext } }));

// The REAL context builders, minus the two request-scoped things they reach for.
//
// `@/lib/auth/config` is the one that matters, and the first version of this file
// mocked `@/lib/auth/utils` instead — a module nothing in the chain imports
// (`getFullContext` → `getUserContext` → `auth` from `@/lib/auth/config`). The
// test passed anyway, because `getUserContext` swallows its own failure, so the
// real better-auth instance and its Prisma adapter were being constructed and
// `auth.api.getSession` genuinely called against the stub headers. The code
// review caught it. On the test guarding a privacy property, the isolation should
// be real rather than incidental.
vi.mock('next/headers', () => ({
  headers: () => Promise.resolve(new Headers({ 'x-request-id': 'req-1', 'user-agent': 'vitest' })),
}));
vi.mock('@/lib/auth/config', () => ({
  auth: { api: { getSession: () => Promise.resolve(null) } },
}));

import { getWaitlistRouteLogger } from '@/app/api/v1/admin/app/waitlist/_shared/route-logger';

const SEARCH_URL = 'https://lelanea.com/api/v1/admin/app/waitlist?q=ada%40example.com&page=1';

beforeEach(() => {
  vi.clearAllMocks();
});

describe('getWaitlistRouteLogger', () => {
  it('binds no `url` at all, so the search term cannot ride along', async () => {
    await getWaitlistRouteLogger(new Request(SEARCH_URL));

    const context = withContext.mock.calls[0]?.[0] ?? {};
    // Absent, not present-and-undefined: `withContext` spreads, and a key set to
    // `undefined` survives into the context object that `pushToLogBuffer` copies.
    expect('url' in context).toBe(false);
    expect(JSON.stringify(context)).not.toContain('ada');
    expect(JSON.stringify(context)).not.toContain('example.com');
  });

  it('keeps the query-free endpoint, which is what operations actually needs', async () => {
    await getWaitlistRouteLogger(new Request(SEARCH_URL));

    const context = withContext.mock.calls[0]?.[0] ?? {};
    expect(context.endpoint).toBe('/api/v1/admin/app/waitlist');
    expect(context.method).toBe('GET');
    expect(context.requestId).toBe('req-1');
  });

  it('returns the scoped logger, not the root one', async () => {
    const log = await getWaitlistRouteLogger(new Request(SEARCH_URL));

    log.info('Waitlist entries listed', { count: 1 });

    expect(childLogger.info).toHaveBeenCalledWith('Waitlist entries listed', { count: 1 });
  });
});
