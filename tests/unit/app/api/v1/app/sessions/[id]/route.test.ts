/**
 * The session deletion route: who may call, whose id reaches the store, what a
 * refusal looks like on the wire, and what the response does not say
 * (f-forget-session t-153).
 *
 * What the deletion actually DOES is
 * `tests/unit/lib/app/memory/delete-session.test.ts`. Here the store is a small
 * stateful fake keyed by person, so a route that carried the wrong id would
 * delete the wrong person's session rather than the same one.
 *
 * @see app/api/v1/app/sessions/[id]/route.ts
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';
import { NextRequest } from 'next/server';

import { mockAuthenticatedUser, mockUnauthenticatedUser } from '@/tests/helpers/auth';

/** The member the helpers sign in as. */
const ME = 'cmjbv4i3x00003wsloputgwul';
const THEM = 'cmu7other0000000000000000';
const MY_SESSION = `ses_${'a'.repeat(32)}`;
const THEIR_SESSION = `ses_${'b'.repeat(32)}`;

const { owners, store, routeLog } = vi.hoisted(() => {
  const owners = new Map<string, string>();
  return {
    owners,
    store: {
      deleteSession: vi.fn(async ({ userId, sessionId }: { userId: string; sessionId: string }) => {
        if (owners.get(sessionId) !== userId) {
          const { NotFoundError } = await import('@/lib/api/errors');
          throw new NotFoundError('That session could not be found.');
        }
        owners.delete(sessionId);
        return { exchanges: 3, messages: 7, versions: 2, recaps: 1, account: 'removed' };
      }),
    },
    routeLog: { info: vi.fn(), warn: vi.fn(), error: vi.fn(), debug: vi.fn() },
  };
});

vi.mock('@/lib/auth/config', () => ({ auth: { api: { getSession: vi.fn() } } }));
vi.mock('next/headers', () => ({ headers: () => Promise.resolve(new Headers()) }));
vi.mock('@/lib/api/context', () => ({ getRouteLogger: () => Promise.resolve(routeLog) }));
vi.mock('@/lib/app/memory/delete-session', () => store);

import { auth } from '@/lib/auth/config';
import { ConflictError } from '@/lib/api/errors';
import { DELETE } from '@/app/api/v1/app/sessions/[id]/route';

function remove(id: string, body: unknown) {
  const request = new NextRequest(`https://lelanea.com/api/v1/app/sessions/${id}`, {
    method: 'DELETE',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  });
  return DELETE(request, { params: Promise.resolve({ id }) });
}

beforeEach(() => {
  vi.clearAllMocks();
  owners.clear();
  owners.set(MY_SESSION, ME);
  owners.set(THEIR_SESSION, THEM);
  vi.mocked(auth.api.getSession).mockResolvedValue(mockAuthenticatedUser('USER'));
});

describe('DELETE /api/v1/app/sessions/:id', () => {
  it('deletes under the caller’s own id, passing the account choice through', async () => {
    const response = await remove(MY_SESSION, { removeAccount: false });

    expect(response.status).toBe(200);
    expect(store.deleteSession).toHaveBeenCalledWith({
      userId: ME,
      sessionId: MY_SESSION,
      removeAccount: false,
    });
    expect(owners.has(MY_SESSION)).toBe(false);
    expect(owners.get(THEIR_SESSION)).toBe(THEM);
  });

  it('says what went and what became of the account, and never how many notes', async () => {
    const response = await remove(MY_SESSION, { removeAccount: true });

    const body = (await response.json()) as { data: Record<string, unknown> };
    expect(body).toEqual({
      success: true,
      data: { exchanges: 3, messages: 7, account: 'removed' },
    });
    // The count of versions could tell the person a hidden slot was filled (§12).
    expect(body.data).not.toHaveProperty('versions');
    const [, fields] = routeLog.info.mock.calls[0] as [string, Record<string, unknown>];
    expect(fields).toEqual({
      userId: ME,
      exchanges: 3,
      messages: 7,
      versions: 2,
      recaps: 1,
      account: 'removed',
    });
  });

  it('answers another person’s session as not found, and deletes nothing', async () => {
    const response = await remove(THEIR_SESSION, { removeAccount: true });

    expect(response.status).toBe(404);
    expect(owners.get(MY_SESSION)).toBe(ME);
    expect(owners.get(THEIR_SESSION)).toBe(THEM);
  });

  it('refuses an id that is not a session’s, and a body without the choice or naming a subject', async () => {
    for (const [id, body] of [
      ['not-a-session', { removeAccount: true }],
      [`ses_${'A'.repeat(32)}`, { removeAccount: true }],
      [MY_SESSION, {}],
      [MY_SESSION, { removeAccount: 'yes' }],
      [MY_SESSION, { removeAccount: true, userId: THEM }],
    ] as const) {
      const response = await remove(id, body);
      expect(response.status).toBe(400);
    }
    expect(store.deleteSession).not.toHaveBeenCalled();
  });

  it('passes a still-answering refusal through as a 409 with its message', async () => {
    store.deleteSession.mockRejectedValueOnce(
      new ConflictError('Lelañea is still answering that. Try again in a moment.', {
        reason: 'still_answering',
      })
    );

    const response = await remove(MY_SESSION, { removeAccount: true });

    expect(response.status).toBe(409);
    const body = (await response.json()) as { error: { message: string } };
    expect(body.error.message).toMatch(/Try again/);
  });

  it('is closed to a caller with no session', async () => {
    vi.mocked(auth.api.getSession).mockResolvedValue(mockUnauthenticatedUser());

    const response = await remove(MY_SESSION, { removeAccount: true });

    expect(response.status).toBe(401);
    expect(store.deleteSession).not.toHaveBeenCalled();
  });
});
