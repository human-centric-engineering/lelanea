/**
 * Who can read whose meter (§08 t-56).
 *
 * A member reads only their own; an admin reads anyone's; nobody unauthenticated
 * reads anything. Every "nothing" below is asserted only after showing the
 * other person HAS rows — through the admin route, against the same fake —
 * because an absence proved on an empty store proves nothing (`fp6`).
 *
 * The meter is a small stateful fake keyed by person, so the answer depends on
 * which id reached it. What the SQL does with that id is proved in
 * `tests/unit/lib/app/agent/metering.test.ts` (the id is bound into every query)
 * and against real Postgres by `npm run smoke:app-metering`.
 *
 * @see app/api/v1/app/usage/**
 * @see app/api/v1/admin/app/metering/**
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';
import { NextRequest } from 'next/server';

import {
  mockAdminUser,
  mockAuthenticatedUser,
  mockUnauthenticatedUser,
} from '@/tests/helpers/auth';

/** The member the helpers sign in as. */
const ME = 'cmjbv4i3x00003wsloputgwul';
/** Somebody else, with spend and a turn of their own. */
const OTHER = 'cmu7other0000000000000000';
const THEIR_TURN = 'their-turn-1';

const store = vi.hoisted(() => ({
  spend: new Map<string, number>(),
  turns: new Map<string, { turnId: string; seat: string; costUsd: number }>(),
}));

const meter = vi.hoisted(() => ({
  getMonthToDate: vi.fn(async (userId: string) => ({
    userId,
    costUsd: store.spend.get(userId) ?? 0,
  })),
  getMemberBreakdown: vi.fn(async (userId: string) => ({
    totals: { costUsd: store.spend.get(userId) ?? 0 },
    groups: store.spend.has(userId)
      ? [{ key: 'onboarding', costUsd: store.spend.get(userId) }]
      : [],
    truncated: false,
  })),
  getAdminBreakdown: vi.fn(async (query: { userId?: string }) => {
    const ids = query.userId ? [query.userId] : [...store.spend.keys()];
    const groups = ids
      .filter((id) => store.spend.has(id))
      .map((id) => ({ key: id, costUsd: store.spend.get(id) }));
    return {
      totals: { costUsd: groups.reduce((total, group) => total + (group.costUsd ?? 0), 0) },
      groups,
      truncated: false,
    };
  }),
  getTurnMeter: vi.fn(async (userId: string, turnId: string) => {
    return store.turns.get(`${userId}:${turnId}`) ?? null;
  }),
  resolveWindow: vi.fn(() => ({ from: new Date(0), to: new Date() })),
}));

vi.mock('@/lib/auth/config', () => ({ auth: { api: { getSession: vi.fn() } } }));
vi.mock('next/headers', () => ({ headers: () => Promise.resolve(new Headers()) }));
vi.mock('@/lib/app/agent/metering', () => meter);
vi.mock('@/lib/db/client', () => ({
  prisma: {
    user: {
      findUnique: vi.fn(async ({ where }: { where: { id: string } }) =>
        [ME, OTHER].includes(where.id) ? { id: where.id } : null
      ),
    },
  },
}));

import { auth } from '@/lib/auth/config';
import { GET as getOwnUsage } from '@/app/api/v1/app/usage/route';
import { GET as getOwnBreakdown } from '@/app/api/v1/app/usage/breakdown/route';
import { GET as getOwnTurn } from '@/app/api/v1/app/usage/turns/[turnId]/route';
import { GET as getAnyBreakdown } from '@/app/api/v1/admin/app/metering/route';
import { GET as getAnyUsage } from '@/app/api/v1/admin/app/metering/users/[userId]/route';
import { GET as getAnyTurn } from '@/app/api/v1/admin/app/metering/users/[userId]/turns/[turnId]/route';

function request(path: string): NextRequest {
  return new NextRequest(`https://lelanea.com${path}`);
}

function params<T>(value: T) {
  return { params: Promise.resolve(value) };
}

async function data(response: Response): Promise<Record<string, unknown>> {
  const body = (await response.json()) as { data: Record<string, unknown> };
  return body.data;
}

function signInAs(session: unknown) {
  vi.mocked(auth.api.getSession).mockResolvedValue(session as never);
}

beforeEach(() => {
  vi.clearAllMocks();
  store.spend.clear();
  store.turns.clear();
  store.spend.set(OTHER, 4.2);
  store.turns.set(`${OTHER}:${THEIR_TURN}`, {
    turnId: THEIR_TURN,
    seat: 'facilitator',
    costUsd: 0.3,
  });
});

describe('the other person has a meter — shown first, through the admin routes', () => {
  beforeEach(() => signInAs(mockAdminUser()));

  it('their spend', async () => {
    const response = await getAnyUsage(
      request(`/api/v1/admin/app/metering/users/${OTHER}`),
      params({ userId: OTHER })
    );
    expect(response.status).toBe(200);
    expect(await data(response)).toMatchObject({ userId: OTHER, costUsd: 4.2 });
  });

  it('their breakdown', async () => {
    const response = await getAnyBreakdown(
      request(`/api/v1/admin/app/metering?by=seat&userId=${OTHER}`)
    );
    expect(response.status).toBe(200);
    expect(meter.getAdminBreakdown).toHaveBeenCalledWith(
      expect.objectContaining({ userId: OTHER })
    );
    expect((await data(response)).groups).toEqual([{ key: OTHER, costUsd: 4.2 }]);
  });

  it('their turn', async () => {
    const response = await getAnyTurn(
      request(`/api/v1/admin/app/metering/users/${OTHER}/turns/${THEIR_TURN}`),
      params({ userId: OTHER, turnId: THEIR_TURN })
    );
    expect(response.status).toBe(200);
    expect(await data(response)).toMatchObject({ turnId: THEIR_TURN, costUsd: 0.3 });
  });

  it('everyone at once, without naming anybody', async () => {
    store.spend.set(ME, 1);
    const response = await getAnyBreakdown(request('/api/v1/admin/app/metering?by=user'));
    expect(response.status).toBe(200);
    expect((await data(response)).groups).toHaveLength(2);
  });
});

describe('a member reads only their own', () => {
  beforeEach(() => signInAs(mockAuthenticatedUser('USER')));

  it('their month to date is theirs — nothing of the other person’s', async () => {
    const response = await getOwnUsage(request('/api/v1/app/usage'));
    expect(response.status).toBe(200);
    expect(meter.getMonthToDate).toHaveBeenCalledWith(ME);
    expect(await data(response)).toMatchObject({ userId: ME, costUsd: 0 });
  });

  it('naming another person in the breakdown query changes nothing', async () => {
    const response = await getOwnBreakdown(
      request(`/api/v1/app/usage/breakdown?by=seat&userId=${OTHER}`)
    );
    expect(response.status).toBe(200);
    expect(meter.getMemberBreakdown).toHaveBeenCalledWith(ME, expect.anything());
    expect(meter.getMemberBreakdown).not.toHaveBeenCalledWith(OTHER, expect.anything());
    expect(await data(response)).toMatchObject({ totals: { costUsd: 0 }, groups: [] });
  });

  it("another person's turn id is not found — the same answer as a turn that never was", async () => {
    const theirs = await getOwnTurn(
      request(`/api/v1/app/usage/turns/${THEIR_TURN}`),
      params({ turnId: THEIR_TURN })
    );
    expect(meter.getTurnMeter).toHaveBeenCalledWith(ME, THEIR_TURN);
    expect(theirs.status).toBe(404);

    const never = await getOwnTurn(
      request('/api/v1/app/usage/turns/never-was'),
      params({ turnId: 'never-was' })
    );
    expect(never.status).toBe(404);
    expect(await theirs.json()).toEqual(await never.json());
  });

  it('their own turn is found', async () => {
    store.turns.set(`${ME}:mine-1`, { turnId: 'mine-1', seat: 'onboarding', costUsd: 0.01 });
    const response = await getOwnTurn(
      request('/api/v1/app/usage/turns/mine-1'),
      params({ turnId: 'mine-1' })
    );
    expect(response.status).toBe(200);
    expect(await data(response)).toMatchObject({ turnId: 'mine-1', seat: 'onboarding' });
  });

  it.each([
    ['breakdown', () => getAnyBreakdown(request(`/api/v1/admin/app/metering?by=user`))],
    [
      'month to date',
      () =>
        getAnyUsage(
          request(`/api/v1/admin/app/metering/users/${OTHER}`),
          params({ userId: OTHER })
        ),
    ],
    [
      'turn',
      () =>
        getAnyTurn(
          request(`/api/v1/admin/app/metering/users/${OTHER}/turns/${THEIR_TURN}`),
          params({ userId: OTHER, turnId: THEIR_TURN })
        ),
    ],
  ])('is refused the admin %s route, and nothing is read', async (_name, call) => {
    expect((await call()).status).toBe(403);
    expect(meter.getAdminBreakdown).not.toHaveBeenCalled();
    expect(meter.getMonthToDate).not.toHaveBeenCalled();
    expect(meter.getTurnMeter).not.toHaveBeenCalled();
  });
});

describe('unauthenticated is refused everywhere, and nothing is read', () => {
  beforeEach(() => signInAs(mockUnauthenticatedUser()));

  it.each([
    ['own usage', () => getOwnUsage(request('/api/v1/app/usage'))],
    ['own breakdown', () => getOwnBreakdown(request('/api/v1/app/usage/breakdown?by=day'))],
    ['own turn', () => getOwnTurn(request('/api/v1/app/usage/turns/x'), params({ turnId: 'x' }))],
    ['admin breakdown', () => getAnyBreakdown(request('/api/v1/admin/app/metering?by=user'))],
    [
      'admin month to date',
      () =>
        getAnyUsage(
          request(`/api/v1/admin/app/metering/users/${OTHER}`),
          params({ userId: OTHER })
        ),
    ],
    [
      'admin turn',
      () =>
        getAnyTurn(
          request(`/api/v1/admin/app/metering/users/${OTHER}/turns/${THEIR_TURN}`),
          params({ userId: OTHER, turnId: THEIR_TURN })
        ),
    ],
  ])('%s → 401', async (_name, call) => {
    expect((await call()).status).toBe(401);
    for (const fn of Object.values(meter)) {
      if (fn !== meter.resolveWindow) expect(fn).not.toHaveBeenCalled();
    }
  });
});
