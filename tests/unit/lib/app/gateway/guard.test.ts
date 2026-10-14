/**
 * `withGatedAuth` — `withAuth`, then the shell layout's gate (t-159).
 *
 * `withAuth` is replaced by a stand-in that hands the handler a session and
 * answers a thrown `APIError` the way the real guard does (`handleAPIError`),
 * because what this file owns is the order — the gate before the handler — and
 * the shape of the refusal. Sign-in itself is `withAuth`'s, tested in Sunrise.
 * Which routes use it is `tests/unit/app/api/v1/app/gate-coverage.test.ts`.
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';
import type { NextRequest } from 'next/server';

const { gateRedirectFor, withAuthOptions } = vi.hoisted(() => ({
  gateRedirectFor: vi.fn(),
  withAuthOptions: vi.fn(),
}));

const SESSION = {
  user: { id: 'user-1', email: 'ada@example.com', emailVerified: true },
};

vi.mock('@/lib/app/gateway/gate', () => ({ gateRedirectFor }));
vi.mock('@/lib/auth/guards', async () => {
  const { handleAPIError } = await import('@/lib/api/errors');
  return {
    withAuth:
      (
        handler: (req: NextRequest, session: unknown, ctx: unknown) => Promise<Response>,
        options?: unknown
      ) =>
      async (req: NextRequest, ctx: unknown) => {
        withAuthOptions(options);
        try {
          return await handler(req, SESSION, ctx);
        } catch (error) {
          return handleAPIError(error);
        }
      },
  };
});

import { withGatedAuth } from '@/lib/app/gateway/guard';
import { GATE_REQUIRED } from '@/lib/app/gateway/gate-codes';

const request = new Request('http://localhost/api/v1/app/notes') as unknown as NextRequest;

beforeEach(() => {
  vi.clearAllMocks();
  gateRedirectFor.mockResolvedValue(null);
});

describe('withGatedAuth', () => {
  it('runs the handler for someone past the gate, with the session and the route context', async () => {
    const handler = vi.fn(async () => Response.json({ success: true, data: 'ok' }));
    const ctx = { params: Promise.resolve({ id: 'x' }) };

    const response = await withGatedAuth<{ id: string }>(handler)(request, ctx);

    expect(response.status).toBe(200);
    expect(gateRedirectFor).toHaveBeenCalledWith(SESSION.user);
    expect(handler).toHaveBeenCalledWith(request, SESSION, ctx);
  });

  it('refuses someone not past the gate with 403 GATE_REQUIRED and where to go, running nothing', async () => {
    gateRedirectFor.mockResolvedValue('/app/begin');
    const handler = vi.fn(async () => Response.json({ success: true }));

    const response = await withGatedAuth(handler)(request);
    const body: unknown = await response.json();

    expect(response.status).toBe(403);
    expect(body).toMatchObject({
      success: false,
      error: { code: GATE_REQUIRED, details: { location: '/app/begin' } },
    });
    expect(handler).not.toHaveBeenCalled();
  });

  it('points an unverified address at the verify page, as the layout would', async () => {
    gateRedirectFor.mockResolvedValue('/verify-email?email=ada%40example.com');

    const response = await withGatedAuth(vi.fn())(request);

    expect(await response.json()).toMatchObject({
      error: { details: { location: '/verify-email?email=ada%40example.com' } },
    });
  });

  it("passes the route's options to withAuth untouched", async () => {
    const options = { ownership: { decidedBy: 'self' as const, because: 'own rows only' } };
    await withGatedAuth(
      vi.fn(async () => new Response()),
      options
    )(request);
    expect(withAuthOptions).toHaveBeenCalledWith(options);
  });
});
