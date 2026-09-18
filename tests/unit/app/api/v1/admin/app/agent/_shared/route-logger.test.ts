/**
 * The agent-settings route logger leaves the request URL off (§08 t-53).
 *
 * The budget list takes `?q=`, which is usually an email address; the platform's
 * route logger binds the full URL, query string included. Same property, and the
 * same real-context-builder setup, as the waitlist's own logger test.
 *
 * @see app/api/v1/admin/app/agent/_shared/route-logger.ts
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';

const { withContext, childLogger } = vi.hoisted(() => {
  const childLogger = { info: vi.fn(), warn: vi.fn(), error: vi.fn(), debug: vi.fn() };
  return {
    withContext: vi.fn((_context: Record<string, unknown>) => childLogger),
    childLogger,
  };
});

vi.mock('@/lib/logging', () => ({ logger: { withContext } }));
vi.mock('next/headers', () => ({
  headers: () => Promise.resolve(new Headers({ 'x-request-id': 'req-1', 'user-agent': 'vitest' })),
}));
vi.mock('@/lib/auth/config', () => ({
  auth: { api: { getSession: () => Promise.resolve(null) } },
}));

import { getAgentSettingsRouteLogger } from '@/app/api/v1/admin/app/agent/_shared/route-logger';

const SEARCH_URL = 'https://lelanea.com/api/v1/admin/app/agent/budgets?q=ada%40example.com&page=1';

beforeEach(() => {
  vi.clearAllMocks();
});

describe('getAgentSettingsRouteLogger', () => {
  it('binds no `url`, so the search term cannot ride along', async () => {
    await getAgentSettingsRouteLogger(new Request(SEARCH_URL));

    const context = withContext.mock.calls[0]?.[0] ?? {};
    expect('url' in context).toBe(false);
    expect(JSON.stringify(context)).not.toContain('ada');
    expect(JSON.stringify(context)).not.toContain('example.com');
  });

  it('keeps the query-free endpoint and the request id', async () => {
    await getAgentSettingsRouteLogger(new Request(SEARCH_URL));

    const context = withContext.mock.calls[0]?.[0] ?? {};
    expect(context.endpoint).toBe('/api/v1/admin/app/agent/budgets');
    expect(context.requestId).toBe('req-1');
  });

  it('returns the scoped logger', async () => {
    const log = await getAgentSettingsRouteLogger(new Request(SEARCH_URL));
    log.info('User budgets listed', { count: 1 });
    expect(childLogger.info).toHaveBeenCalledWith('User budgets listed', { count: 1 });
  });
});
