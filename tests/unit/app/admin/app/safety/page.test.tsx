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

// The file round-trip (t-92) has its own tests; stubbed so this stays about the page.
vi.mock('@/components/app/admin/crisis-file-panel', () => ({
  CrisisFilePanel: () => <div data-testid="file-panel" />,
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
    expect(screen.getByTestId('file-panel')).toBeInTheDocument();
  });

  it('offers no file import before the tables are seeded', async () => {
    vi.mocked(serverFetch).mockResolvedValue(new Response('{}', { status: 200 }));
    vi.mocked(parseApiResponse).mockResolvedValue({
      success: true,
      data: { ...VIEW, seeded: false },
    } as never);

    render(await CrisisResourcesPage());

    expect(screen.getByTestId('panel')).toBeInTheDocument();
    expect(screen.queryByTestId('file-panel')).toBeNull();
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
