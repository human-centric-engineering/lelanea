// @vitest-environment happy-dom

/**
 * /admin/app/cost/turns/:userId/:turnId — the bottom of the drill-down, and the
 * first reader the admin turn route has had (f-budget t-97). Addressed by
 * person and turn, as the route is; a turn that person never took is a 404,
 * not an empty record.
 *
 * @see app/admin/app/cost/turns/[userId]/[turnId]/page.tsx
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen } from '@testing-library/react';

vi.mock('@/lib/api/server-fetch', () => ({
  serverFetch: vi.fn(),
  parseApiResponse: vi.fn(),
}));

const notFound = vi.hoisted(() =>
  vi.fn(() => {
    throw new Error('NEXT_NOT_FOUND');
  })
);
vi.mock('next/navigation', () => ({ notFound }));

vi.mock('@/components/app/admin/cost-view', () => ({
  TurnCostView: (props: { reading: { turnId: string } }) => (
    <div data-testid="turn" data-turn={props.reading.turnId} />
  ),
}));

import CostTurnPage from '@/app/admin/app/cost/turns/[userId]/[turnId]/page';
import { serverFetch, parseApiResponse } from '@/lib/api/server-fetch';

const PERSON = 'cmu7person000000000000000';
const page = (turnId = 'turn 1') =>
  CostTurnPage({ params: Promise.resolve({ userId: PERSON, turnId }) });

beforeEach(() => {
  vi.clearAllMocks();
});

describe('CostTurnPage', () => {
  it('reads the turn under its person, with the id encoded, and hands it down', async () => {
    vi.mocked(serverFetch).mockResolvedValue({ ok: true, status: 200 } as Response);
    vi.mocked(parseApiResponse).mockResolvedValue({
      success: true,
      data: { turnId: 'turn 1' },
    } as never);

    render(await page());

    // A turn id is client-chosen, so it is encoded into the path.
    expect(serverFetch).toHaveBeenCalledWith(
      `/api/v1/admin/app/metering/users/${PERSON}/turns/turn%201`
    );
    expect(screen.getByTestId('turn').getAttribute('data-turn')).toBe('turn 1');
  });

  it('is a 404 when that person has no such turn', async () => {
    vi.mocked(serverFetch).mockResolvedValue({ ok: false, status: 404 } as Response);
    await expect(page()).rejects.toThrow('NEXT_NOT_FOUND');
    expect(notFound).toHaveBeenCalledTimes(1);
  });

  it.each([
    [
      'a refused read',
      () => vi.mocked(serverFetch).mockResolvedValue({ ok: false, status: 500 } as Response),
    ],
    [
      'an envelope that is not a success',
      () => {
        vi.mocked(serverFetch).mockResolvedValue({ ok: true, status: 200 } as Response);
        vi.mocked(parseApiResponse).mockResolvedValue({ success: false } as never);
      },
    ],
    ['a read that throws', () => vi.mocked(serverFetch).mockRejectedValue(new Error('down'))],
  ])('says it did not load on %s', async (_name, arrange) => {
    arrange();
    render(await page());
    expect(screen.getByRole('alert').textContent).toContain('did not load');
    expect(notFound).not.toHaveBeenCalled();
  });
});
