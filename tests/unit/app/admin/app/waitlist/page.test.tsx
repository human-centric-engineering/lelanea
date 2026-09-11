// @vitest-environment happy-dom

/**
 * The admin waitlist page.
 *
 * Its whole job is `getFirstPage()` — fetch, validate, or fall back — and then
 * handing one page to the table. So the branches ARE the page, and the one that
 * matters is the failure: the table's empty state says "Nobody has joined the
 * waitlist yet", which on a broken fetch would be a false statement about the
 * product on the surface whose only job is to answer that question. The page
 * carries `loadError` so the two are told apart.
 *
 * No auth test here: the admin guard is `app/admin/layout.tsx`, which has its
 * own, and the route behind this page has its own 401/403 cases.
 *
 * @see app/admin/app/waitlist/page.tsx
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen } from '@testing-library/react';

vi.mock('@/lib/api/server-fetch', () => ({
  serverFetch: vi.fn(),
  parseApiResponse: vi.fn(),
}));

// The table has its own test file; stubbing it keeps this about what the page
// resolved and handed on.
vi.mock('@/components/app/admin/waitlist-table', () => ({
  WaitlistTable: (props: { initialEntries: unknown; initialMeta: unknown }) => (
    <div
      data-testid="waitlist-table"
      data-entries={JSON.stringify(props.initialEntries)}
      data-meta={JSON.stringify(props.initialMeta)}
    />
  ),
}));

import WaitlistAdminPage from '@/app/admin/app/waitlist/page';
import { serverFetch, parseApiResponse } from '@/lib/api/server-fetch';
import { WAITLIST_ADMIN_ENDPOINT } from '@/lib/app/waitlist/endpoint';

const ENTRY = {
  removedAt: null,
  rejoinRequestedAt: null,
  rejoinRequests: 0,
  id: 'entry-1',
  email: 'ada@example.com',
  name: 'Ada',
  heardFrom: 'a friend',
  intent: 'to slow down',
  source: 'form',
  locale: 'en-US',
  consentedAt: '2026-09-01T10:00:00.000Z',
  userId: null,
  createdAt: '2026-09-01T10:00:00.000Z',
};

/** What the stubbed table received, read back out of the DOM. */
function propPassedToTable(attribute: 'data-entries' | 'data-meta'): unknown {
  const raw = screen.getByTestId('waitlist-table').getAttribute(attribute);
  return raw === null ? undefined : JSON.parse(raw);
}

beforeEach(() => {
  vi.clearAllMocks();
});

describe('WaitlistAdminPage', () => {
  it('asks the API for the first page, at the list’s own page size', async () => {
    vi.mocked(serverFetch).mockResolvedValue({ ok: true } as Response);
    vi.mocked(parseApiResponse).mockResolvedValue({
      success: true,
      data: [ENTRY],
      meta: { page: 1, limit: 25, total: 1, totalPages: 1 },
    } as never);

    render(await WaitlistAdminPage());

    // Through the route, not straight to Prisma — the API-first rule, and the
    // only thing that makes the page proof that the route works.
    expect(serverFetch).toHaveBeenCalledWith(`${WAITLIST_ADMIN_ENDPOINT}?page=1&limit=25`);
    expect(propPassedToTable('data-entries')).toEqual([ENTRY]);
    expect(propPassedToTable('data-meta')).toEqual({
      page: 1,
      limit: 25,
      total: 1,
      totalPages: 1,
    });
    expect(screen.queryByRole('alert')).toBeNull();
  });

  it('says the list did not load when the response is not ok', async () => {
    vi.mocked(serverFetch).mockResolvedValue({ ok: false } as Response);

    render(await WaitlistAdminPage());

    expect(screen.getByRole('alert').textContent).toMatch(/did not load/);
    expect(propPassedToTable('data-entries')).toEqual([]);
    expect(parseApiResponse).not.toHaveBeenCalled();
  });

  it('says so when the body reports failure', async () => {
    vi.mocked(serverFetch).mockResolvedValue({ ok: true } as Response);
    vi.mocked(parseApiResponse).mockResolvedValue({
      success: false,
      error: { code: 'INTERNAL_ERROR', message: 'fail' },
    } as never);

    render(await WaitlistAdminPage());

    expect(screen.getByRole('alert')).toBeTruthy();
  });

  it('does not throw when the fetch rejects', async () => {
    // A rejected promise, which is how `fetch` actually fails. Unhandled, this is
    // a 500 on an admin page because one data source is down.
    vi.mocked(serverFetch).mockRejectedValue(new Error('ECONNREFUSED'));

    render(await WaitlistAdminPage());

    expect(screen.getByRole('alert')).toBeTruthy();
    expect(propPassedToTable('data-meta')).toEqual({
      page: 1,
      limit: 25,
      total: 0,
      totalPages: 0,
    });
  });

  it('falls back to sane pagination when the envelope carries no usable meta', async () => {
    vi.mocked(serverFetch).mockResolvedValue({ ok: true } as Response);
    vi.mocked(parseApiResponse).mockResolvedValue({
      success: true,
      data: [ENTRY],
      meta: { page: 'one' },
    } as never);

    render(await WaitlistAdminPage());

    // `parsePaginationMeta` rejects the malformed meta rather than letting
    // `limit: undefined` reach the table's "Showing X to Y" arithmetic — which
    // renders as `NaN` and reads to an operator as a broken list.
    expect(propPassedToTable('data-meta')).toEqual({
      page: 1,
      limit: 25,
      total: 1,
      totalPages: 1,
    });
    expect(screen.queryByRole('alert')).toBeNull();
  });
});
