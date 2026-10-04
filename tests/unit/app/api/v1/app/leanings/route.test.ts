/**
 * The member leanings routes: who may call, whose id reaches the store, what a
 * refusal looks like on the wire (f-leanings t-135).
 *
 * What the read and the write DO is `tests/unit/lib/app/voice/leanings-store.test.ts`.
 * The store here is a small fake keyed by person, so the answer depends on
 * which id reached it: a route that read an id out of the request would return
 * someone else's dials rather than the same ones.
 *
 * @see app/api/v1/app/leanings/route.ts
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';
import { NextRequest } from 'next/server';

import { mockAuthenticatedUser, mockUnauthenticatedUser } from '@/tests/helpers/auth';

/** The member the helpers sign in as. */
const ME = 'cmjbv4i3x00003wsloputgwul';

const { stops, store, routeLog } = vi.hoisted(() => {
  const stops = new Map<string, number>();
  return {
    stops,
    store: {
      getLeanings: vi.fn(async (userId: string) => ({
        configured: true,
        dials: [
          { key: 'length', stored: stops.get(userId) ?? 0, position: stops.get(userId) ?? 0 },
        ],
      })),
      setLeaning: vi.fn(
        async ({ userId, key, stop }: { userId: string; key: string; stop: number }) => {
          if (key === 'pace') {
            const { ConflictError } = await import('@/lib/api/errors');
            throw new ConflictError('Lelañea keeps this one where it is.', {
              reason: 'leaning_locked',
            });
          }
          stops.set(userId, stop);
          return { outcome: 'written', dial: { key, stored: stop, position: stop }, version: 1 };
        }
      ),
    },
    routeLog: {
      info: vi.fn(),
      warn: vi.fn(),
      error: vi.fn(),
      debug: vi.fn(),
      withContext: vi.fn(function (this: unknown) {
        return this;
      }),
    },
  };
});

vi.mock('@/lib/auth/config', () => ({ auth: { api: { getSession: vi.fn() } } }));
vi.mock('next/headers', () => ({ headers: () => Promise.resolve(new Headers()) }));
vi.mock('@/lib/api/context', () => ({ getRouteLogger: () => Promise.resolve(routeLog) }));
vi.mock('@/lib/app/voice/leanings-store', () => store);

import { auth } from '@/lib/auth/config';
import { GET, PATCH } from '@/app/api/v1/app/leanings/route';

const URL = 'https://lelanea.com/api/v1/app/leanings';

function patchRequest(body: unknown): NextRequest {
  return new NextRequest(URL, {
    method: 'PATCH',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify(body),
  });
}

beforeEach(() => {
  vi.clearAllMocks();
  stops.clear();
  vi.mocked(auth.api.getSession).mockResolvedValue(mockAuthenticatedUser('USER'));
});

describe('GET /api/v1/app/leanings', () => {
  it('refuses a caller who is not signed in', async () => {
    vi.mocked(auth.api.getSession).mockResolvedValue(mockUnauthenticatedUser());

    const response = await GET(new NextRequest(URL));

    expect(response.status).toBe(401);
    expect(store.getLeanings).not.toHaveBeenCalled();
  });

  it('reads the caller’s own dials, uncached', async () => {
    stops.set(ME, 2);
    stops.set('someone-else', -2);

    const response = await GET(new NextRequest(URL));
    const body = (await response.json()) as { data: { dials: { stored: number }[] } };

    expect(response.status).toBe(200);
    expect(store.getLeanings).toHaveBeenCalledWith(ME);
    expect(body.data.dials[0].stored).toBe(2);
    expect(response.headers.get('Cache-Control')).toBe('no-store');
  });
});

describe('PATCH /api/v1/app/leanings', () => {
  it('refuses a caller who is not signed in', async () => {
    vi.mocked(auth.api.getSession).mockResolvedValue(mockUnauthenticatedUser());

    const response = await PATCH(patchRequest({ key: 'length', stop: 1 }));

    expect(response.status).toBe(401);
    expect(store.setLeaning).not.toHaveBeenCalled();
  });

  it('sets the caller’s own dial, from settings', async () => {
    const response = await PATCH(patchRequest({ key: 'length', stop: 1 }));

    expect(response.status).toBe(200);
    expect(store.setLeaning).toHaveBeenCalledWith({
      userId: ME,
      key: 'length',
      stop: 1,
      via: 'settings',
    });
    expect(stops.get(ME)).toBe(1);
  });

  it.each([
    ['an unknown dial', { key: 'tone', stop: 1 }],
    ['a stop off the dial', { key: 'length', stop: 3 }],
    ['a subject named in the body', { key: 'length', stop: 1, userId: 'someone-else' }],
  ])('refuses %s before the store sees it', async (_label, body) => {
    const response = await PATCH(patchRequest(body));

    expect(response.status).toBe(400);
    expect(store.setLeaning).not.toHaveBeenCalled();
  });

  it('answers a locked dial with the store’s 409, word for word', async () => {
    const response = await PATCH(patchRequest({ key: 'pace', stop: 1 }));
    const body = (await response.json()) as { error: { message: string } };

    expect(response.status).toBe(409);
    expect(body.error.message).toBe('Lelañea keeps this one where it is.');
  });
});
