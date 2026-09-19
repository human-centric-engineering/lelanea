// @vitest-environment happy-dom

/**
 * /admin/app/safety — what the page fetches and hands to the panel (f-safety t-63).
 *
 * Through the API, and a failed load is an alert rather than a panel that would
 * present the tables as unseeded.
 *
 * @see app/admin/app/safety/page.tsx
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen } from '@testing-library/react';

vi.mock('@/lib/api/server-fetch', () => ({
  serverFetch: vi.fn(),
  parseApiResponse: vi.fn(),
}));

vi.mock('@/components/app/admin/crisis-resources', () => ({
  CrisisResourcesPanel: (props: Record<string, unknown>) => (
    <div data-testid="panel" data-props={JSON.stringify(props)} />
  ),
}));

import CrisisResourcesPage from '@/app/admin/app/safety/page';
import { serverFetch, parseApiResponse } from '@/lib/api/server-fetch';
import { CRISIS_RESOURCES_ENDPOINT } from '@/lib/app/safety/endpoint';

const VIEW = { seeded: true, copy: null, regions: [] };

beforeEach(() => vi.clearAllMocks());

describe('CrisisResourcesPage', () => {
  it('reads the view through the API and hands it to the panel', async () => {
    vi.mocked(serverFetch).mockResolvedValue(new Response('{}', { status: 200 }));
    vi.mocked(parseApiResponse).mockResolvedValue({ success: true, data: VIEW } as never);

    render(await CrisisResourcesPage());

    expect(serverFetch).toHaveBeenCalledWith(CRISIS_RESOURCES_ENDPOINT);
    const props = JSON.parse(screen.getByTestId('panel').getAttribute('data-props') ?? '{}') as {
      initialView: unknown;
    };
    expect(props.initialView).toEqual(VIEW);
  });

  it.each([
    [
      'a non-2xx answer',
      () => vi.mocked(serverFetch).mockResolvedValue(new Response('', { status: 500 })),
    ],
    ['a thrown fetch', () => vi.mocked(serverFetch).mockRejectedValue(new Error('down'))],
  ])('shows an alert, not the panel, on %s', async (_label, arrange) => {
    arrange();
    render(await CrisisResourcesPage());
    expect(screen.getByRole('alert')).toHaveTextContent(/did not load/);
    expect(screen.queryByTestId('panel')).toBeNull();
  });
});
