/**
 * The current session route: who may call, whose id it reads under, and what
 * the pane receives (f-forget-session t-158).
 *
 * Which turns count is `tests/unit/lib/app/sessions/current.test.ts`.
 *
 * @see app/api/v1/app/sessions/current/route.ts
 */

import { beforeEach, describe, expect, it, vi } from 'vitest';
import { NextRequest } from 'next/server';

import { mockAuthenticatedUser, mockUnauthenticatedUser } from '@/tests/helpers/auth';

/** The member the helpers sign in as. */
const ME = 'cmjbv4i3x00003wsloputgwul';
const MY_SESSION = `ses_${'a'.repeat(32)}`;

const { readCurrentSession, routeLog, after } = vi.hoisted(() => ({
  readCurrentSession: vi.fn(),
  routeLog: { info: vi.fn(), warn: vi.fn(), error: vi.fn(), debug: vi.fn() },
  after: vi.fn(),
}));

vi.mock('@/lib/auth/config', () => ({ auth: { api: { getSession: vi.fn() } } }));
vi.mock('next/headers', () => ({ headers: () => Promise.resolve(new Headers()) }));
vi.mock('next/server', async (importOriginal) => ({
  ...(await importOriginal<typeof import('next/server')>()),
  after,
}));
vi.mock('@/lib/api/context', () => ({ getRouteLogger: () => Promise.resolve(routeLog) }));
vi.mock('@/lib/app/sessions/current', () => ({ readCurrentSession }));

import { auth } from '@/lib/auth/config';
import { GET } from '@/app/api/v1/app/sessions/current/route';

function read() {
  return GET(new NextRequest('https://lelanea.com/api/v1/app/sessions/current'));
}

beforeEach(() => {
  vi.clearAllMocks();
  vi.mocked(auth.api.getSession).mockResolvedValue(mockAuthenticatedUser('USER'));
  readCurrentSession.mockResolvedValue({ id: MY_SESSION, hasTurns: true });
});

describe('GET /api/v1/app/sessions/current', () => {
  it('reads under the caller’s own id and answers the session, uncached', async () => {
    const response = await read();

    expect(response.status).toBe(200);
    expect(response.headers.get('Cache-Control')).toBe('no-store');
    expect(readCurrentSession).toHaveBeenCalledWith(ME, { keepAlive: expect.any(Function) });
    await expect(response.json()).resolves.toEqual({
      success: true,
      data: { session: { id: MY_SESSION, hasTurns: true } },
    });
  });

  it('hands work the arrival starts to after(), so a close’s draft outlives the response', async () => {
    await read();
    const work = Promise.resolve();
    const { keepAlive } = readCurrentSession.mock.calls[0][1] as {
      keepAlive: (work: Promise<unknown>) => void;
    };
    keepAlive(work);

    expect(after).toHaveBeenCalledWith(work);
  });

  it('answers null when there is no session to offer', async () => {
    readCurrentSession.mockResolvedValue(null);
    const response = await read();

    expect(response.status).toBe(200);
    await expect(response.json()).resolves.toEqual({ success: true, data: { session: null } });
  });

  it('refuses a caller who is not signed in, and reads nothing', async () => {
    vi.mocked(auth.api.getSession).mockResolvedValue(mockUnauthenticatedUser());
    const response = await read();

    expect(response.status).toBe(401);
    expect(readCurrentSession).not.toHaveBeenCalled();
  });
});
