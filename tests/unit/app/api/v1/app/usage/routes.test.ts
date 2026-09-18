/**
 * The member usage routes — the envelope around the meter (§08 t-56).
 *
 * Who may read what is `authorization.test.ts`; the reads themselves are
 * `tests/unit/lib/app/agent/metering.test.ts`. This is validation, windows,
 * caching and what reaches the log.
 *
 * @see app/api/v1/app/usage/**
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';
import { NextRequest } from 'next/server';

import { mockAuthenticatedUser } from '@/tests/helpers/auth';

const ME = 'cmjbv4i3x00003wsloputgwul';

const { meter, routeLog } = vi.hoisted(() => ({
  meter: {
    getMonthToDate: vi.fn(),
    getMemberBreakdown: vi.fn(),
    getTurnMeter: vi.fn(),
  },
  routeLog: { info: vi.fn(), warn: vi.fn(), error: vi.fn(), debug: vi.fn() },
}));

vi.mock('@/lib/auth/config', () => ({ auth: { api: { getSession: vi.fn() } } }));
vi.mock('next/headers', () => ({ headers: () => Promise.resolve(new Headers()) }));
vi.mock('@/lib/api/context', () => ({ getRouteLogger: () => Promise.resolve(routeLog) }));
vi.mock('@/lib/app/agent/metering', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@/lib/app/agent/metering')>();
  // The window arithmetic is real; only the reads are faked.
  return { ...meter, resolveWindow: actual.resolveWindow };
});

import { auth } from '@/lib/auth/config';
import { GET as getUsage } from '@/app/api/v1/app/usage/route';
import { GET as getBreakdown } from '@/app/api/v1/app/usage/breakdown/route';
import { GET as getTurn } from '@/app/api/v1/app/usage/turns/[turnId]/route';

function request(path: string): NextRequest {
  return new NextRequest(`https://lelanea.com${path}`);
}

beforeEach(() => {
  vi.clearAllMocks();
  vi.mocked(auth.api.getSession).mockResolvedValue(mockAuthenticatedUser('USER'));
  meter.getMonthToDate.mockResolvedValue({ userId: ME, costUsd: 1, costRows: 3, unpricedRows: 0 });
  meter.getMemberBreakdown.mockResolvedValue({ groups: [], truncated: false });
  meter.getTurnMeter.mockResolvedValue({ turnId: 't', seat: 'onboarding', costRows: 2 });
});

describe('GET /api/v1/app/usage', () => {
  it('answers month to date, uncached', async () => {
    const response = await getUsage(request('/api/v1/app/usage'));
    expect(response.status).toBe(200);
    expect(response.headers.get('Cache-Control')).toBe('no-store');
    expect(await response.json()).toMatchObject({
      success: true,
      data: { userId: ME, costUsd: 1 },
    });
  });
});

describe('GET /api/v1/app/usage/breakdown', () => {
  it('defaults the window to this month so far', async () => {
    const before = Date.now();
    await getBreakdown(request('/api/v1/app/usage/breakdown?by=model'));
    const [, query] = meter.getMemberBreakdown.mock.calls[0] as [
      string,
      { by: string; window: { from: Date; to: Date }; limit: number },
    ];
    expect(query.by).toBe('model');
    expect(query.limit).toBe(100);
    expect(query.window.from.getUTCDate()).toBe(1);
    expect(query.window.from.getUTCHours()).toBe(0);
    expect(query.window.to.getTime()).toBeGreaterThanOrEqual(before);
  });

  it('passes an explicit window through', async () => {
    await getBreakdown(
      request('/api/v1/app/usage/breakdown?by=day&from=2026-08-01&to=2026-09-01&limit=31')
    );
    expect(meter.getMemberBreakdown).toHaveBeenCalledWith(ME, {
      by: 'day',
      window: { from: new Date('2026-08-01'), to: new Date('2026-09-01') },
      limit: 31,
    });
  });

  it.each([
    ['no dimension', ''],
    ['a dimension only an admin has', '?by=user'],
    ['an unknown dimension', '?by=provider'],
    ['a backwards window', '?by=day&from=2026-09-01&to=2026-08-01'],
    ['a window over a year', '?by=day&from=2024-01-01&to=2026-01-01'],
    ['too many groups', '?by=day&limit=501'],
    ['a date that is not one', '?by=day&from=yesterday'],
  ])('refuses %s with 400 and reads nothing', async (_name, query) => {
    const response = await getBreakdown(request(`/api/v1/app/usage/breakdown${query}`));
    expect(response.status).toBe(400);
    expect(meter.getMemberBreakdown).not.toHaveBeenCalled();
  });

  it('is uncached', async () => {
    const response = await getBreakdown(request('/api/v1/app/usage/breakdown?by=seat'));
    expect(response.headers.get('Cache-Control')).toBe('no-store');
  });
});

describe('GET /api/v1/app/usage/turns/:turnId', () => {
  function turn(turnId: string) {
    return getTurn(request(`/api/v1/app/usage/turns/${encodeURIComponent(turnId)}`), {
      params: Promise.resolve({ turnId }),
    });
  }

  it('answers the turn, uncached', async () => {
    const response = await turn('t');
    expect(response.status).toBe(200);
    expect(response.headers.get('Cache-Control')).toBe('no-store');
    expect(meter.getTurnMeter).toHaveBeenCalledWith(ME, 't');
  });

  it('refuses a turn id longer than any turn could have with 400', async () => {
    const response = await turn('x'.repeat(129));
    expect(response.status).toBe(400);
    expect(meter.getTurnMeter).not.toHaveBeenCalled();
  });

  it('does not put the turn id in the log — a client may choose it', async () => {
    await turn('my-private-label');
    expect(routeLog.info).toHaveBeenCalled();
    expect(JSON.stringify(routeLog.info.mock.calls)).not.toContain('my-private-label');
  });
});
