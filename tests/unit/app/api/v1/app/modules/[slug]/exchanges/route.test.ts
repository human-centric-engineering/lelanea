/**
 * The module's-worth deletion route: who may call, whose id reaches the store,
 * what a refusal looks like on the wire, and what the response does not say
 * (f-forget-session t-155).
 *
 * What the deletion actually DOES is
 * `tests/unit/lib/app/memory/delete-module.test.ts`. Here the store is a small
 * stateful fake keyed by person and module, so a route that carried the wrong
 * id would delete the other person's turns in the same module rather than the
 * caller's.
 *
 * @see app/api/v1/app/modules/[slug]/exchanges/route.ts
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';
import { NextRequest } from 'next/server';

import { mockAuthenticatedUser, mockUnauthenticatedUser } from '@/tests/helpers/auth';

/** The member the helpers sign in as. */
const ME = 'cmjbv4i3x00003wsloputgwul';
const THEM = 'cmu7other0000000000000000';

const { stamped, store, routeLog } = vi.hoisted(() => {
  /** `${userId}:${moduleSlug}` → how many turns are stamped there. */
  const stamped = new Map<string, number>();
  return {
    stamped,
    store: {
      deleteModuleExchanges: vi.fn(
        async ({ userId, moduleSlug }: { userId: string; moduleSlug: string }) => {
          const key = `${userId}:${moduleSlug}`;
          if (!stamped.get(key)) {
            const { NotFoundError } = await import('@/lib/api/errors');
            throw new NotFoundError('There is nothing you said in this module to delete.');
          }
          stamped.delete(key);
          return { exchanges: 3, messages: 7, versions: 2, recaps: 1 };
        }
      ),
    },
    routeLog: { info: vi.fn(), warn: vi.fn(), error: vi.fn(), debug: vi.fn() },
  };
});

vi.mock('@/lib/auth/config', () => ({ auth: { api: { getSession: vi.fn() } } }));
vi.mock('next/headers', () => ({ headers: () => Promise.resolve(new Headers()) }));
vi.mock('@/lib/api/context', () => ({ getRouteLogger: () => Promise.resolve(routeLog) }));
vi.mock('@/lib/app/memory/delete-module', () => store);

import { auth } from '@/lib/auth/config';
import { ConflictError } from '@/lib/api/errors';
import { DELETE } from '@/app/api/v1/app/modules/[slug]/exchanges/route';

function remove(slug: string) {
  const request = new NextRequest(
    `https://lelanea.com/api/v1/app/modules/${encodeURIComponent(slug)}/exchanges`,
    { method: 'DELETE' }
  );
  return DELETE(request, { params: Promise.resolve({ slug }) });
}

beforeEach(() => {
  vi.clearAllMocks();
  stamped.clear();
  stamped.set(`${ME}:values`, 2);
  stamped.set(`${THEM}:values`, 1);
  vi.mocked(auth.api.getSession).mockResolvedValue(mockAuthenticatedUser('USER'));
});

describe('DELETE /api/v1/app/modules/:slug/exchanges', () => {
  it('deletes under the caller’s own id, and leaves theirs in the same module', async () => {
    const response = await remove('values');

    expect(response.status).toBe(200);
    expect(store.deleteModuleExchanges).toHaveBeenCalledWith({ userId: ME, moduleSlug: 'values' });
    expect(stamped.has(`${ME}:values`)).toBe(false);
    expect(stamped.get(`${THEM}:values`)).toBe(1);
  });

  it('says what went, and never how many notes', async () => {
    const response = await remove('values');

    const body = (await response.json()) as { data: Record<string, unknown> };
    expect(body).toEqual({ success: true, data: { exchanges: 3, messages: 7 } });
    // The count of versions could tell the person a hidden slot was filled (§12).
    expect(body.data).not.toHaveProperty('versions');
    const [, fields] = routeLog.info.mock.calls[0] as [string, Record<string, unknown>];
    expect(fields).toEqual({
      userId: ME,
      moduleSlug: 'values',
      exchanges: 3,
      messages: 7,
      versions: 2,
      recaps: 1,
    });
  });

  it('answers a module with nothing of the caller’s in it as not found, saying so', async () => {
    stamped.set(`${THEM}:courage`, 4);

    const response = await remove('courage');

    expect(response.status).toBe(404);
    const body = (await response.json()) as { error: { message: string } };
    expect(body.error.message).toMatch(/nothing you said in this module/);
    expect(stamped.get(`${THEM}:courage`)).toBe(4);
  });

  it('refuses a slug that is not a module’s shape, before reaching the store', async () => {
    for (const slug of ['Values', 'values/../x', 'a b', '-values', 'v'.repeat(81)]) {
      const response = await remove(slug);
      expect(response.status).toBe(400);
    }
    expect(store.deleteModuleExchanges).not.toHaveBeenCalled();
  });

  it('passes a still-answering refusal through as a 409 with its message', async () => {
    store.deleteModuleExchanges.mockRejectedValueOnce(
      new ConflictError('Lelañea is still answering that. Try again in a moment.', {
        reason: 'still_answering',
      })
    );

    const response = await remove('values');

    expect(response.status).toBe(409);
    const body = (await response.json()) as { error: { message: string } };
    expect(body.error.message).toMatch(/Try again/);
  });

  it('is closed to a caller with no session', async () => {
    vi.mocked(auth.api.getSession).mockResolvedValue(mockUnauthenticatedUser());

    const response = await remove('values');

    expect(response.status).toBe(401);
    expect(store.deleteModuleExchanges).not.toHaveBeenCalled();
  });
});
