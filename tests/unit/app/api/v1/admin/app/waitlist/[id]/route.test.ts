/**
 * PATCH /api/v1/admin/app/waitlist/:id — taking someone off the list, and back.
 *
 * The done-when cases: 401, 403, both directions, a bad id, a bad body, a 404.
 * Plus the two nobody would notice by looking at the screen — that the route
 * takes the STATE TO REACH rather than toggling what it finds, and that the log
 * line carries the entry id and not the address.
 *
 * @see app/api/v1/admin/app/waitlist/[id]/route.ts
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';
import type { NextRequest } from 'next/server';

import {
  mockAdminUser,
  mockAuthenticatedUser,
  mockUnauthenticatedUser,
} from '@/tests/helpers/auth';

const { setWaitlistEntryRemoved, routeLog } = vi.hoisted(() => ({
  setWaitlistEntryRemoved: vi.fn(),
  routeLog: { info: vi.fn(), warn: vi.fn(), error: vi.fn(), debug: vi.fn() },
}));

vi.mock('@/lib/auth/config', () => ({ auth: { api: { getSession: vi.fn() } } }));
vi.mock('next/headers', () => ({ headers: () => Promise.resolve(new Headers()) }));
vi.mock('@/lib/app/waitlist/admin', () => ({ setWaitlistEntryRemoved }));
vi.mock('@/app/api/v1/admin/app/waitlist/_shared/route-logger', () => ({
  getWaitlistRouteLogger: () => Promise.resolve(routeLog),
}));

import { auth } from '@/lib/auth/config';
import { PATCH } from '@/app/api/v1/admin/app/waitlist/[id]/route';

/** A real cuid shape — `cuidSchema` rejects anything else. */
const ENTRY_ID = 'cmtso8tdu000p0bgmhn1v7lao';

const ENTRY = {
  id: ENTRY_ID,
  email: 'ada@example.com',
  name: 'Ada',
  heardFrom: null,
  intent: null,
  source: 'form',
  locale: 'en-US',
  consentedAt: '2026-09-01T10:00:00.000Z',
  userId: null,
  createdAt: '2026-09-01T10:00:00.000Z',
  removedAt: '2026-09-11T12:00:00.000Z',
  rejoinRequestedAt: null,
  rejoinRequests: 0,
};

function request(body: unknown, id = ENTRY_ID) {
  const req = new Request(`https://lelanea.com/api/v1/admin/app/waitlist/${id}`, {
    method: 'PATCH',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify(body),
  }) as unknown as NextRequest;
  return [req, { params: Promise.resolve({ id }) }] as const;
}

beforeEach(() => {
  vi.clearAllMocks();
  setWaitlistEntryRemoved.mockResolvedValue(ENTRY);
  vi.mocked(auth.api.getSession).mockResolvedValue(mockAdminUser());
});

describe('PATCH /api/v1/admin/app/waitlist/:id', () => {
  it('answers 401 when nobody is signed in, and writes nothing', async () => {
    vi.mocked(auth.api.getSession).mockResolvedValue(mockUnauthenticatedUser());

    const response = await PATCH(...request({ removed: true }));

    expect(response.status).toBe(401);
    expect(setWaitlistEntryRemoved).not.toHaveBeenCalled();
  });

  it('answers 403 for a signed-in non-admin, and writes nothing', async () => {
    vi.mocked(auth.api.getSession).mockResolvedValue(mockAuthenticatedUser('USER'));

    const response = await PATCH(...request({ removed: true }));

    // An ordinary user must not be able to take people off a list they cannot read.
    expect(response.status).toBe(403);
    expect(setWaitlistEntryRemoved).not.toHaveBeenCalled();
  });

  it('takes an entry off the list', async () => {
    const response = await PATCH(...request({ removed: true }));

    expect(response.status).toBe(200);
    expect(setWaitlistEntryRemoved).toHaveBeenCalledWith(ENTRY_ID, true);
    const body = (await response.json()) as { success: boolean; data: { removedAt: string } };
    expect(body.success).toBe(true);
    // The updated entry comes back, so the client can render the new state without
    // guessing what the server did.
    expect(body.data.removedAt).toBe('2026-09-11T12:00:00.000Z');
  });

  it('puts one back', async () => {
    setWaitlistEntryRemoved.mockResolvedValue({ ...ENTRY, removedAt: null });

    const response = await PATCH(...request({ removed: false }));

    expect(response.status).toBe(200);
    expect(setWaitlistEntryRemoved).toHaveBeenCalledWith(ENTRY_ID, false);
  });

  it('passes the body through as the state to reach, never as a flip', async () => {
    // Asserting that two identical requests produce two identical calls would be a
    // tautology — the test supplies both bodies. What is worth pinning is that the
    // route never consults the CURRENT state to decide what to send: it has no read
    // before the write, so it cannot flip. The code review of §03 t-24 named the
    // tautology; the real idempotence lives in `setWaitlistEntryRemoved`, where
    // `admin.test.ts` now pins the conditional WHERE that enforces it.
    await PATCH(...request({ removed: true }));

    expect(setWaitlistEntryRemoved).toHaveBeenCalledTimes(1);
    expect(setWaitlistEntryRemoved).toHaveBeenCalledWith(ENTRY_ID, true);
    // Nothing was read first — a toggle would have needed to.
    expect(setWaitlistEntryRemoved.mock.calls[0]).toHaveLength(2);
  });

  it('answers 404 for an id nothing matches, rather than a cheerful 200', async () => {
    setWaitlistEntryRemoved.mockResolvedValue(null);

    const response = await PATCH(...request({ removed: true }));

    // An admin who clicked Remove on a row that had already gone needs to know the
    // click did nothing.
    expect(response.status).toBe(404);
  });

  it('rejects an id that is not a cuid, before touching the table', async () => {
    const response = await PATCH(...request({ removed: true }, 'not-a-cuid'));

    expect(response.status).toBe(400);
    expect(setWaitlistEntryRemoved).not.toHaveBeenCalled();
  });

  it('rejects a body that does not say which way', async () => {
    const response = await PATCH(...request({}));

    expect(response.status).toBe(400);
    expect(setWaitlistEntryRemoved).not.toHaveBeenCalled();
  });

  it('rejects a removed flag that is not a boolean', async () => {
    // `'true'` the string is what a hand-rolled caller sends. Coercing it would
    // make `'false'` truthy, which is the bug `queryBooleanSchema` exists for on
    // the query side — so the body schema refuses rather than guesses.
    const response = await PATCH(...request({ removed: 'true' }));

    expect(response.status).toBe(400);
    expect(setWaitlistEntryRemoved).not.toHaveBeenCalled();
  });

  it('logs which way it went, and nobody’s address', async () => {
    await PATCH(...request({ removed: true }));

    const logged = JSON.stringify(routeLog.info.mock.calls);
    expect(logged).not.toContain('ada@example.com');
    expect(routeLog.info).toHaveBeenCalledWith(
      'Waitlist entry removed',
      expect.objectContaining({ entryId: ENTRY_ID, removed: true })
    );
  });

  it('logs a restore differently, so the two are distinguishable in the log', async () => {
    setWaitlistEntryRemoved.mockResolvedValue({ ...ENTRY, removedAt: null });

    await PATCH(...request({ removed: false }));

    expect(routeLog.info).toHaveBeenCalledWith(
      'Waitlist entry restored',
      expect.objectContaining({ removed: false })
    );
  });
});
