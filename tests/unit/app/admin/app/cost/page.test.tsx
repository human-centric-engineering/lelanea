// @vitest-environment happy-dom

/**
 * /admin/app/cost — what the page fetches and hands to the view (f-budget t-97).
 *
 * The property the task names: **no per-row fetch**. Five list reads, one per
 * dimension, however many people and conversations those lists hold — the API
 * enriches each list in the same request. And a read that fails is handed down
 * as null, not as an empty list the view would present as "nothing spent".
 *
 * @see app/admin/app/cost/page.tsx
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen } from '@testing-library/react';

vi.mock('@/lib/api/server-fetch', () => ({
  serverFetch: vi.fn(),
  parseApiResponse: vi.fn(),
}));

vi.mock('@/components/app/admin/cost-view', () => ({
  CostOverview: (props: Record<string, unknown>) => (
    <div data-testid="overview" data-props={JSON.stringify(props)} />
  ),
}));

import CostAdminPage from '@/app/admin/app/cost/page';
import { serverFetch, parseApiResponse } from '@/lib/api/server-fetch';

function overviewProps(): Record<string, unknown> {
  return JSON.parse(screen.getByTestId('overview').getAttribute('data-props') ?? '{}') as Record<
    string,
    unknown
  >;
}

/** A breakdown per dimension, with many groups — so a per-row fetch would show. */
function answer(failing: string[] = []) {
  vi.mocked(serverFetch).mockImplementation(async (url: string) => {
    const by = new URL(url, 'https://x').searchParams.get('by') ?? '';
    return { ok: !failing.includes(by), url } as Response;
  });
  vi.mocked(parseApiResponse).mockImplementation((async (response: Response) => {
    const by = new URL(response.url, 'https://x').searchParams.get('by');
    return {
      success: true,
      data: {
        by,
        groups: Array.from({ length: 25 }, (_, i) => ({ key: `${by}-${i}`, costUsd: i })),
        truncated: false,
      },
    };
  }) as never);
}

beforeEach(() => {
  vi.clearAllMocks();
});

describe('CostAdminPage', () => {
  it('reads five lists — one per dimension — and nothing per row', async () => {
    answer();
    render(await CostAdminPage());

    const urls = vi.mocked(serverFetch).mock.calls.map(([url]) => url);
    expect(urls).toHaveLength(5);
    expect(urls.map((url) => new URL(url, 'https://x').searchParams.get('by')).sort()).toEqual([
      'conversation',
      'day',
      'model',
      'seat',
      'user',
    ]);
    // Every read is the list route — no person's, conversation's or turn's.
    for (const url of urls)
      expect(new URL(url, 'https://x').pathname).toBe('/api/v1/admin/app/metering');
  });

  it('hands each list down by name', async () => {
    answer();
    render(await CostAdminPage());
    const props = overviewProps();
    expect((props.byUser as { by: string }).by).toBe('user');
    expect((props.byConversation as { by: string }).by).toBe('conversation');
    expect((props.byDay as { by: string }).by).toBe('day');
  });

  it('hands a failed read down as null, not as an empty list', async () => {
    answer(['conversation']);
    render(await CostAdminPage());
    const props = overviewProps();
    expect(props.byConversation).toBeNull();
    expect(props.byUser).not.toBeNull();
  });

  it('survives a read that throws', async () => {
    vi.mocked(serverFetch).mockRejectedValue(new Error('down'));
    render(await CostAdminPage());
    const props = overviewProps();
    expect(Object.values(props).every((value) => value === null)).toBe(true);
  });

  it('hands an envelope that is not a success down as null', async () => {
    vi.mocked(serverFetch).mockResolvedValue({ ok: true, url: '/x?by=user' } as Response);
    vi.mocked(parseApiResponse).mockResolvedValue({ success: false } as never);
    render(await CostAdminPage());
    expect(Object.values(overviewProps()).every((value) => value === null)).toBe(true);
  });
});
