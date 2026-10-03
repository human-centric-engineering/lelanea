/**
 * The exchange deletion route: who may call, whose id reaches the store, what a
 * refusal looks like on the wire, and what the response does not say
 * (f-memory t-127).
 *
 * What the deletion actually DOES is
 * `tests/unit/lib/app/memory/delete-exchange.test.ts`, against a Prisma fake
 * with Daybreak's value engine running for real. Here the store is a small
 * stateful fake keyed by person, so a route that carried the wrong id would
 * delete the wrong person's exchange rather than the same one.
 *
 * @see app/api/v1/app/exchanges/route.ts
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';
import { NextRequest } from 'next/server';

import { mockAuthenticatedUser, mockUnauthenticatedUser } from '@/tests/helpers/auth';

/** The member the helpers sign in as. */
const ME = 'cmjbv4i3x00003wsloputgwul';
const THEM = 'cmu7other0000000000000000';
const MY_TURN = 'cmturnmine00000000000000a';
const THEIR_TURN = 'cmturntheirs000000000000a';

const { owners, store, routeLog } = vi.hoisted(() => {
  const owners = new Map<string, string>();
  return {
    owners,
    store: {
      deleteExchanges: vi.fn(
        async ({ userId, exchangeIds }: { userId: string; exchangeIds: string[] }) => {
          if (exchangeIds.some((id) => owners.get(id) !== userId)) {
            const { NotFoundError } = await import('@/lib/api/errors');
            throw new NotFoundError('That part of the conversation could not be found.');
          }
          for (const id of exchangeIds) owners.delete(id);
          return { exchanges: exchangeIds.length, messages: 4, versions: 2 };
        }
      ),
    },
    routeLog: { info: vi.fn(), warn: vi.fn(), error: vi.fn(), debug: vi.fn() },
  };
});

vi.mock('@/lib/auth/config', () => ({ auth: { api: { getSession: vi.fn() } } }));
vi.mock('next/headers', () => ({ headers: () => Promise.resolve(new Headers()) }));
vi.mock('@/lib/api/context', () => ({ getRouteLogger: () => Promise.resolve(routeLog) }));
vi.mock('@/lib/app/memory/delete-exchange', () => store);

import { auth } from '@/lib/auth/config';
import { ConflictError } from '@/lib/api/errors';
import { DELETE } from '@/app/api/v1/app/exchanges/route';

function remove(body: unknown): NextRequest {
  return new NextRequest('https://lelanea.com/api/v1/app/exchanges', {
    method: 'DELETE',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  });
}

beforeEach(() => {
  vi.clearAllMocks();
  owners.clear();
  owners.set(MY_TURN, ME);
  owners.set(THEIR_TURN, THEM);
  vi.mocked(auth.api.getSession).mockResolvedValue(mockAuthenticatedUser('USER'));
});

describe('DELETE /api/v1/app/exchanges', () => {
  it('deletes under the caller’s own id', async () => {
    const response = await DELETE(remove({ exchangeIds: [MY_TURN] }));

    expect(response.status).toBe(200);
    expect(store.deleteExchanges).toHaveBeenCalledWith({ userId: ME, exchangeIds: [MY_TURN] });
    expect(owners.has(MY_TURN)).toBe(false);
    expect(owners.get(THEIR_TURN)).toBe(THEM);
  });

  it('says how many exchanges and messages went, and never how many notes', async () => {
    const response = await DELETE(remove({ exchangeIds: [MY_TURN] }));

    const body = (await response.json()) as { data: Record<string, unknown> };
    expect(body).toEqual({ success: true, data: { exchanges: 1, messages: 4 } });
    // The count of versions could tell the person a hidden slot was filled (§12).
    expect(body.data).not.toHaveProperty('versions');
    // The operator still sees it.
    const [, fields] = routeLog.info.mock.calls[0] as [string, Record<string, unknown>];
    expect(fields).toEqual({ userId: ME, exchanges: 1, messages: 4, versions: 2 });
  });

  it('answers another person’s exchange as not found, and deletes nothing', async () => {
    const response = await DELETE(remove({ exchangeIds: [MY_TURN, THEIR_TURN] }));

    expect(response.status).toBe(404);
    expect(owners.get(MY_TURN)).toBe(ME);
    expect(owners.get(THEIR_TURN)).toBe(THEM);
  });

  it('refuses a body that names a subject, an empty list or ids that are not ids', async () => {
    for (const body of [
      { exchangeIds: [MY_TURN], userId: THEM },
      { exchangeIds: [] },
      { exchangeIds: ['not an id'] },
      { exchangeIds: Array.from({ length: 51 }, () => MY_TURN) },
    ]) {
      const response = await DELETE(remove(body));
      expect(response.status).toBe(400);
    }
    expect(store.deleteExchanges).not.toHaveBeenCalled();
  });

  it('passes a still-answering refusal through as a 409 with its message', async () => {
    store.deleteExchanges.mockRejectedValueOnce(
      new ConflictError('Lelañea is still answering that. Try again in a moment.', {
        reason: 'still_answering',
      })
    );

    const response = await DELETE(remove({ exchangeIds: [MY_TURN] }));

    expect(response.status).toBe(409);
    const body = (await response.json()) as { error: { message: string } };
    expect(body.error.message).toMatch(/Try again/);
  });

  it('is closed to a caller with no session', async () => {
    vi.mocked(auth.api.getSession).mockResolvedValue(mockUnauthenticatedUser());

    const response = await DELETE(remove({ exchangeIds: [MY_TURN] }));

    expect(response.status).toBe(401);
    expect(store.deleteExchanges).not.toHaveBeenCalled();
  });
});
