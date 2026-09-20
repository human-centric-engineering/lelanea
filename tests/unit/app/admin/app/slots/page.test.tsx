// @vitest-environment happy-dom

/**
 * /admin/app/slots — what the page fetches and hands to the panel (f-slots t-71).
 *
 * Through the API, and a failed load is an alert rather than a panel. The
 * distinction matters more here than usual: the panel's own empty state says
 * "run the seed", so rendering it for a failed fetch would send an operator to
 * re-run a seed that has already run — and on a seeded database that seed
 * prints `unchanged, skipping` and repairs nothing.
 *
 * @see app/admin/app/slots/page.tsx
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen } from '@testing-library/react';

vi.mock('@/lib/api/server-fetch', () => ({
  serverFetch: vi.fn(),
  parseApiResponse: vi.fn(),
}));

vi.mock('@/components/app/admin/slot-definitions', () => ({
  SlotDefinitionsPanel: (props: Record<string, unknown>) => (
    <div data-testid="panel" data-props={JSON.stringify(props)} />
  ),
}));

import SlotDefinitionsPage from '@/app/admin/app/slots/page';
import { serverFetch, parseApiResponse } from '@/lib/api/server-fetch';
import { SLOT_DEFINITIONS_ENDPOINT } from '@/lib/app/slots/endpoint';

const VIEW = {
  seeded: true,
  groups: ['life_areas'],
  definitions: [{ slug: 'life_work', group: 'life_areas', version: 1 }],
};

beforeEach(() => vi.clearAllMocks());

describe('SlotDefinitionsPage', () => {
  it('reads the taxonomy through the API and hands it to the panel', async () => {
    vi.mocked(serverFetch).mockResolvedValue(new Response('{}', { status: 200 }));
    vi.mocked(parseApiResponse).mockResolvedValue({ success: true, data: VIEW } as never);

    render(await SlotDefinitionsPage());

    expect(serverFetch).toHaveBeenCalledWith(SLOT_DEFINITIONS_ENDPOINT);
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
    [
      'a success envelope the parser refuses',
      () => {
        vi.mocked(serverFetch).mockResolvedValue(new Response('{}', { status: 200 }));
        vi.mocked(parseApiResponse).mockResolvedValue({
          success: false,
          error: { code: 'INTERNAL_ERROR', message: 'nope' },
        } as never);
      },
    ],
  ])('shows an alert, not the panel, on %s', async (_label, arrange) => {
    arrange();
    render(await SlotDefinitionsPage());
    expect(screen.getByRole('alert')).toHaveTextContent(/did not load/);
    expect(screen.queryByTestId('panel')).toBeNull();
  });

  it('names the endpoint in the alert, so there is something to check', async () => {
    vi.mocked(serverFetch).mockRejectedValue(new Error('down'));
    render(await SlotDefinitionsPage());
    expect(screen.getByRole('alert')).toHaveTextContent(SLOT_DEFINITIONS_ENDPOINT);
  });
});
