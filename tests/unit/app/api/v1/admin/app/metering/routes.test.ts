/**
 * The admin metering routes — the envelope around the meter (§08 t-56).
 *
 * Who may read what is `tests/unit/app/api/v1/app/usage/authorization.test.ts`.
 * This is validation, a person who does not exist, and what reaches the log.
 *
 * @see app/api/v1/admin/app/metering/**
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';
import { NextRequest } from 'next/server';

import { mockAdminUser } from '@/tests/helpers/auth';

const PERSON = 'cmu7person000000000000000';

const { meter, findUser, routeLog } = vi.hoisted(() => ({
  meter: { getAdminBreakdown: vi.fn(), getMonthToDate: vi.fn(), getTurnMeter: vi.fn() },
  findUser: vi.fn(),
  routeLog: { info: vi.fn(), warn: vi.fn(), error: vi.fn(), debug: vi.fn() },
}));

vi.mock('@/lib/auth/config', () => ({ auth: { api: { getSession: vi.fn() } } }));
vi.mock('next/headers', () => ({ headers: () => Promise.resolve(new Headers()) }));
vi.mock('@/lib/db/client', () => ({ prisma: { user: { findUnique: findUser } } }));
vi.mock('@/app/api/v1/admin/app/agent/_shared/route-logger', () => ({
  getAgentSettingsRouteLogger: () => Promise.resolve(routeLog),
}));
vi.mock('@/lib/app/agent/metering', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@/lib/app/agent/metering')>();
  return { ...meter, resolveWindow: actual.resolveWindow };
});

import { auth } from '@/lib/auth/config';
import { GET as getBreakdown } from '@/app/api/v1/admin/app/metering/route';
import { GET as getUsage } from '@/app/api/v1/admin/app/metering/users/[userId]/route';
import { GET as getTurn } from '@/app/api/v1/admin/app/metering/users/[userId]/turns/[turnId]/route';

function request(path: string): NextRequest {
  return new NextRequest(`https://lelanea.com${path}`);
}

beforeEach(() => {
  vi.clearAllMocks();
  vi.mocked(auth.api.getSession).mockResolvedValue(mockAdminUser());
  meter.getAdminBreakdown.mockResolvedValue({ groups: [], truncated: false });
  meter.getMonthToDate.mockResolvedValue({ userId: PERSON, costUsd: 2 });
  meter.getTurnMeter.mockResolvedValue({ turnId: 't', seat: 'onboarding' });
  findUser.mockResolvedValue({ id: PERSON });
});

describe('GET /api/v1/admin/app/metering', () => {
  it('reads everyone when no person is named', async () => {
    const response = await getBreakdown(request('/api/v1/admin/app/metering?by=user&limit=5'));
    expect(response.status).toBe(200);
    expect(response.headers.get('Cache-Control')).toBe('no-store');
    const [query] = meter.getAdminBreakdown.mock.calls[0] as [Record<string, unknown>];
    expect(query).toMatchObject({ by: 'user', limit: 5 });
    expect(query).not.toHaveProperty('userId');
  });

  it.each(['conversation', 'seat', 'model', 'day'])('groups by %s', async (by) => {
    expect((await getBreakdown(request(`/api/v1/admin/app/metering?by=${by}`))).status).toBe(200);
    expect(meter.getAdminBreakdown).toHaveBeenCalledWith(expect.objectContaining({ by }));
  });

  it.each([
    ['no dimension', ''],
    ['an unknown dimension', '?by=provider'],
    ['a person id that is not one', '?by=seat&userId=not%20an%20id'],
    ['a window over a year', '?by=day&from=2024-01-01&to=2026-01-01'],
  ])('refuses %s with 400', async (_name, query) => {
    expect((await getBreakdown(request(`/api/v1/admin/app/metering${query}`))).status).toBe(400);
    expect(meter.getAdminBreakdown).not.toHaveBeenCalled();
  });
});

describe('GET /api/v1/admin/app/metering/users/:userId', () => {
  const usage = (userId: string) =>
    getUsage(request(`/api/v1/admin/app/metering/users/${userId}`), {
      params: Promise.resolve({ userId }),
    });

  it("answers the person's month to date", async () => {
    const response = await usage(PERSON);
    expect(response.status).toBe(200);
    expect(meter.getMonthToDate).toHaveBeenCalledWith(PERSON);
  });

  it('is 404 for nobody, rather than a ceiling for nobody', async () => {
    findUser.mockResolvedValue(null);
    expect((await usage(PERSON)).status).toBe(404);
    expect(meter.getMonthToDate).not.toHaveBeenCalled();
  });

  it('refuses a malformed id with 400', async () => {
    expect((await usage('not an id')).status).toBe(400);
    expect(findUser).not.toHaveBeenCalled();
  });
});

describe('GET /api/v1/admin/app/metering/users/:userId/turns/:turnId', () => {
  const turn = (userId: string, turnId: string) =>
    getTurn(request(`/api/v1/admin/app/metering/users/${userId}/turns/${turnId}`), {
      params: Promise.resolve({ userId, turnId }),
    });

  it('reads the turn under that person', async () => {
    const response = await turn(PERSON, 'client-turn');
    expect(response.status).toBe(200);
    expect(meter.getTurnMeter).toHaveBeenCalledWith(PERSON, 'client-turn');
  });

  it('is 404 when that person has no such turn', async () => {
    meter.getTurnMeter.mockResolvedValue(null);
    expect((await turn(PERSON, 'client-turn')).status).toBe(404);
  });

  it('refuses a malformed turn id with 400', async () => {
    expect((await turn(PERSON, 'x'.repeat(129))).status).toBe(400);
    expect(meter.getTurnMeter).not.toHaveBeenCalled();
  });
});
