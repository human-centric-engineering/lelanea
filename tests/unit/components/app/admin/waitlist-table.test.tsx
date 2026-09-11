// @vitest-environment happy-dom

/**
 * The admin waitlist table.
 *
 * What is worth asserting here is not that a table renders rows. It is the three
 * things that are wrong in a plausible first version: that the export link takes
 * the filter the rows on screen were fetched with (rather than no filter, or the
 * half-typed one still in the box), that a failed fetch says so instead of
 * leaving the previous page on screen looking like the new matches, and that an
 * answer nobody gave renders as absence rather than as an empty cell.
 *
 * @see components/app/admin/waitlist-table.tsx
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';
import { act, render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';

import { WaitlistTable } from '@/components/app/admin/waitlist-table';
import type { WaitlistAdminEntry } from '@/lib/app/waitlist/admin';
import {
  WAITLIST_ADMIN_ENDPOINT,
  WAITLIST_ADMIN_EXPORT_ENDPOINT,
} from '@/lib/app/waitlist/endpoint';

function entry(overrides: Partial<WaitlistAdminEntry> = {}): WaitlistAdminEntry {
  return {
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
    removedAt: null,
    rejoinRequestedAt: null,
    rejoinRequests: 0,
    ...overrides,
  };
}

const META = { page: 1, limit: 25, total: 1, totalPages: 1 };

/** A successful list response, as `parseApiResponse` expects to find it. */
function listResponse(entries: WaitlistAdminEntry[], meta = META) {
  return {
    ok: true,
    json: () => Promise.resolve({ success: true, data: entries, meta }),
  } as unknown as Response;
}

const { patch } = vi.hoisted(() => ({ patch: vi.fn() }));
vi.mock('@/lib/api/client', () => ({
  apiClient: { patch },
  APIClientError: class APIClientError extends Error {},
}));

const fetchMock = vi.fn();

beforeEach(() => {
  vi.clearAllMocks();
  fetchMock.mockResolvedValue(listResponse([entry()]));
  patch.mockResolvedValue({});
  vi.stubGlobal('fetch', fetchMock);
});

describe('WaitlistTable', () => {
  it('renders what someone said, not just that they joined', () => {
    render(<WaitlistTable initialEntries={[entry()]} initialMeta={META} />);

    expect(screen.getByText('ada@example.com')).toBeTruthy();
    // `intent` is the column the surface exists for. A table of addresses would
    // satisfy "an admin can see who joined" and miss the point of t-7's write.
    expect(screen.getByText('to slow down')).toBeTruthy();
    expect(screen.getByText('Showing 1 to 1 of 1 entry')).toBeTruthy();
  });

  it('shows an unanswered optional field as absence, not as blankness', () => {
    render(
      <WaitlistTable
        initialEntries={[entry({ name: null, heardFrom: null, intent: null })]}
        initialMeta={META}
      />
    );

    // Three em dashes, one per skipped answer, plus the unlinked account column.
    expect(screen.getAllByText('—').length).toBe(4);
  });

  it('collapses a long answer and gives the whole of it back on request', async () => {
    const user = userEvent.setup();
    const long = `${'a'.repeat(260)}END`;
    render(<WaitlistTable initialEntries={[entry({ intent: long })]} initialMeta={META} />);

    expect(screen.queryByText(long)).toBeNull();
    await user.click(screen.getByRole('button', { name: 'Show all' }));

    // Truncating with no way back would hide the answer the row exists for.
    expect(screen.getByText(long)).toBeTruthy();
  });

  it('searches after a pause, not on every keystroke', async () => {
    const user = userEvent.setup();
    render(<WaitlistTable initialEntries={[entry()]} initialMeta={META} />);

    await user.type(screen.getByLabelText('Search the waitlist'), 'sleep');

    await waitFor(() => expect(fetchMock).toHaveBeenCalled());
    const url = String(fetchMock.mock.calls[0]?.[0]);
    // The FIRST request already carries the whole term, which is what says the
    // debounce held: a version that fired per keystroke would have asked for
    // `q=s` first. Asserted this way rather than by counting calls, because a
    // call count depends on how fast the machine typed.
    expect(url).toContain('q=sleep');
    // And it starts back at page 1 — a search that kept the page number would
    // report "no matches" for a term that has them.
    expect(url).toContain(`${WAITLIST_ADMIN_ENDPOINT}?page=1`);
  });

  it('points the export at the filter the rows on screen were fetched with', async () => {
    const user = userEvent.setup();
    render(<WaitlistTable initialEntries={[entry()]} initialMeta={META} />);

    const exportLink = () => screen.getByRole('link', { name: /Export CSV/ });
    expect(exportLink().getAttribute('href')).toBe(WAITLIST_ADMIN_EXPORT_ENDPOINT);

    await user.type(screen.getByLabelText('Search the waitlist'), 'a friend');
    await waitFor(() => expect(fetchMock).toHaveBeenCalled());

    // The APPLIED term, not the one in the box: a file that quietly contained
    // everyone while the screen showed three people is the failure here, and it
    // would look like a working export.
    // `a+friend`, not `a%20friend`: the href is built with `URLSearchParams`, which
    // encodes a space as `+`. Both decode to the same term server-side (Next's own
    // `searchParams` uses URLSearchParams too), and building it with the same API
    // the fetch uses is what keeps the two in step.
    await waitFor(() =>
      expect(exportLink().getAttribute('href')).toBe(`${WAITLIST_ADMIN_EXPORT_ENDPOINT}?q=a+friend`)
    );
  });

  it('asks for the next page, carrying the search with it', async () => {
    const user = userEvent.setup();
    render(
      <WaitlistTable
        initialEntries={[entry()]}
        initialMeta={{ page: 1, limit: 25, total: 60, totalPages: 3 }}
      />
    );

    await user.click(screen.getByRole('button', { name: /Next/ }));

    await waitFor(() => expect(fetchMock).toHaveBeenCalled());
    expect(String(fetchMock.mock.calls[0]?.[0])).toContain('page=2');
  });

  it('goes back a page, carrying the search with it', async () => {
    const user = userEvent.setup();
    render(
      <WaitlistTable
        initialEntries={[entry()]}
        initialMeta={{ page: 2, limit: 25, total: 60, totalPages: 3 }}
      />
    );

    await user.click(screen.getByRole('button', { name: /Previous/ }));

    await waitFor(() => expect(fetchMock).toHaveBeenCalled());
    expect(String(fetchMock.mock.calls[0]?.[0])).toContain('page=1');
  });

  it('does not offer a previous page from the first one', () => {
    render(<WaitlistTable initialEntries={[entry()]} initialMeta={META} />);

    expect(screen.getByRole('button', { name: /Previous/ }).hasAttribute('disabled')).toBe(true);
  });

  it('ignores a stale response that arrives after a newer one', async () => {
    const user = userEvent.setup();
    // Two searches in flight, the FIRST one slower — which is the ordinary case,
    // not the unlucky one: the ILIKE runs over `intent` with no index behind it.
    let releaseFirst: (() => void) | undefined;
    fetchMock.mockImplementationOnce(
      () =>
        new Promise<Response>((resolve) => {
          releaseFirst = () =>
            resolve(listResponse([entry({ id: 'stale', email: 'stale@x.test' })]));
        })
    );
    fetchMock.mockImplementationOnce(() =>
      Promise.resolve(listResponse([entry({ id: 'fresh', email: 'fresh@x.test' })]))
    );

    render(<WaitlistTable initialEntries={[entry()]} initialMeta={META} />);

    await user.type(screen.getByLabelText('Search the waitlist'), 'ada');
    await waitFor(() => expect(fetchMock).toHaveBeenCalledTimes(1));
    await user.type(screen.getByLabelText('Search the waitlist'), 'm');
    await waitFor(() => expect(fetchMock).toHaveBeenCalledTimes(2));
    await waitFor(() => expect(screen.getByText('fresh@x.test')).toBeTruthy());

    // Now let the first one land. Without the sequence guard it overwrites the
    // rows, the meta AND `appliedSearch` — so the table shows the matches for
    // `ada` while the box reads `adam`, and the export link quietly points at the
    // wrong filter.
    // `!` rather than `?.`: the waitFor above already proved fetch #1 fired, so an
    // optional call here would silently no-op if that ever stopped being true —
    // and a test that releases nothing passes for free.
    await act(async () => {
      releaseFirst!();
    });

    // This is the assertion that detects the defect. The `act` above is what
    // makes that deliberate rather than incidental: it drains the microtasks the
    // stale response needs (resolve → await fetch → json() → setState), so a
    // missing guard has actually had its chance to overwrite the table by the
    // time these run.
    expect(screen.queryByText('stale@x.test')).toBeNull();
    expect(screen.getByText('fresh@x.test')).toBeTruthy();
    // And the export link still points at what is on screen, which is the
    // consequence a reader of this surface would actually notice.
    expect(screen.getByRole('link', { name: /Export CSV/ }).getAttribute('href')).toContain(
      'q=adam'
    );
  });

  it('does not claim nobody has joined when the list failed to load', () => {
    render(
      <WaitlistTable
        initialEntries={[]}
        initialMeta={{ ...META, total: 0, totalPages: 0 }}
        initialLoadFailed
      />
    );

    // The one false statement this surface can make (`HB9`), and a banner above
    // the table does not stop the table making it.
    expect(screen.queryByText('Nobody has joined the waitlist yet.')).toBeNull();
    expect(screen.getByText(/did not load, so this is not an answer/)).toBeTruthy();
  });

  it('stops disclaiming once a fetch succeeds, without needing a reload', async () => {
    const user = userEvent.setup();
    // The fetch must come back EMPTY for this to assert anything. Round 2 of the
    // code review caught the first version returning a row: with rows on screen
    // the empty-state cell never renders at all, so the disclaimer was absent
    // whether or not `setLoadFailed(false)` existed — the test passed with the
    // fix deleted. An empty successful result is the only state where the two
    // messages compete.
    fetchMock.mockResolvedValue(listResponse([], { ...META, total: 0, totalPages: 0 }));
    render(
      <WaitlistTable
        initialEntries={[]}
        initialMeta={{ ...META, total: 0, totalPages: 0 }}
        initialLoadFailed
      />
    );

    expect(screen.getByText(/did not load, so this is not an answer/)).toBeTruthy();

    await user.type(screen.getByLabelText('Search the waitlist'), 'ada');

    // The search worked and genuinely matched nobody, which is an answer — so the
    // table has to stop saying it has none. Leaving the disclaimer up would tell
    // an admin the list is broken for as long as their searches keep missing.
    await waitFor(() => expect(screen.getByText('Nobody on the list matches that.')).toBeTruthy());
    expect(screen.queryByText(/did not load, so this is not an answer/)).toBeNull();
  });

  describe('taking someone off the list', () => {
    it('asks before it does anything, and names the person', async () => {
      const user = userEvent.setup();
      render(<WaitlistTable initialEntries={[entry()]} initialMeta={META} />);

      await user.click(screen.getByRole('button', { name: /Remove/ }));

      // Named, not "this entry". A confirmation with nothing specific in it is the
      // one everybody clicks through.
      expect(
        screen.getByRole('heading', { name: /Take ada@example.com off the waitlist\?/ })
      ).toBeTruthy();
      // And nothing has happened yet.
      expect(patch).not.toHaveBeenCalled();
    });

    it('says, in the dialog, that this is not a deletion', async () => {
      const user = userEvent.setup();
      render(<WaitlistTable initialEntries={[entry()]} initialMeta={META} />);

      await user.click(screen.getByRole('button', { name: /Remove/ }));

      // The honest risk is not a misclick — it is an admin believing they have
      // answered a "delete my data" request. They have not: the row keeps the
      // address and the answers.
      expect(screen.getByText(/does not delete their data/i)).toBeTruthy();
    });

    it('removes nobody when the dialog is cancelled', async () => {
      const user = userEvent.setup();
      render(<WaitlistTable initialEntries={[entry()]} initialMeta={META} />);

      await user.click(screen.getByRole('button', { name: /Remove/ }));
      await user.click(screen.getByRole('button', { name: 'Keep them on the list' }));

      // The whole point of the gate. If this ever passes while the PATCH fires,
      // the dialog is decoration.
      expect(patch).not.toHaveBeenCalled();
    });

    it('sends the removal once confirmed, and re-reads the page', async () => {
      const user = userEvent.setup();
      render(<WaitlistTable initialEntries={[entry()]} initialMeta={META} />);

      await user.click(screen.getByRole('button', { name: /Remove/ }));
      await user.click(screen.getByRole('button', { name: 'Remove from waitlist' }));

      await waitFor(() =>
        expect(patch).toHaveBeenCalledWith('/api/v1/admin/app/waitlist/entry-1', {
          body: { removed: true },
        })
      );
      // Re-read rather than patched in place: the row usually vanishes (the default
      // filter excludes it) so the totals move, and a locally-edited row would show
      // a count that disagrees with the list.
      await waitFor(() => expect(fetchMock).toHaveBeenCalled());
    });

    it('says so when the removal fails, instead of looking like it worked', async () => {
      const user = userEvent.setup();
      patch.mockRejectedValue(new Error('network'));
      render(<WaitlistTable initialEntries={[entry()]} initialMeta={META} />);

      await user.click(screen.getByRole('button', { name: /Remove/ }));
      await user.click(screen.getByRole('button', { name: 'Remove from waitlist' }));

      const alert = await waitFor(() => screen.getByRole('alert'));
      expect(within(alert).getByText(/was not removed/)).toBeTruthy();
    });
  });

  describe('a removed entry', () => {
    const removed = entry({ removedAt: '2026-09-05T09:00:00.000Z' });

    it('is marked as removed rather than looking like anyone else', () => {
      render(<WaitlistTable initialEntries={[removed]} initialMeta={META} />);

      expect(screen.getByText('Removed')).toBeTruthy();
      // Restore in place of Remove — offering both would invite removing a row that
      // is already removed.
      expect(screen.getByRole('button', { name: /Restore/ })).toBeTruthy();
      expect(screen.queryByRole('button', { name: /Remove/ })).toBeNull();
    });

    it('shows how many times they asked to come back', () => {
      render(
        <WaitlistTable
          initialEntries={[entry({ removedAt: '2026-09-05T09:00:00.000Z', rejoinRequests: 2 })]}
          initialMeta={META}
        />
      );

      // D9's whole justification: the re-join is recorded instead of acted on, so
      // if she cannot see it the record is kept for nobody.
      expect(screen.getByText(/Asked to re-join ×2/)).toBeTruthy();
    });

    it('restores without a dialog, because the undo needs no ceremony', async () => {
      const user = userEvent.setup();
      render(<WaitlistTable initialEntries={[removed]} initialMeta={META} />);

      await user.click(screen.getByRole('button', { name: /Restore/ }));

      await waitFor(() =>
        expect(patch).toHaveBeenCalledWith('/api/v1/admin/app/waitlist/entry-1', {
          body: { removed: false },
        })
      );
    });
  });

  describe('the removed filter', () => {
    it('asks the API for removed entries when the toggle goes on', async () => {
      const user = userEvent.setup();
      render(<WaitlistTable initialEntries={[entry()]} initialMeta={META} />);

      await user.click(screen.getByLabelText('Show removed'));

      await waitFor(() => expect(fetchMock).toHaveBeenCalled());
      const url = String(fetchMock.mock.calls[0]?.[0]);
      expect(url).toContain('includeRemoved=true');
      // Back to page 1: the population just changed size, so the page that was on
      // screen may not exist any more.
      expect(url).toContain('page=1');
    });

    it('carries the filter into the export, so the file is the screen', async () => {
      const user = userEvent.setup();
      render(<WaitlistTable initialEntries={[entry()]} initialMeta={META} />);

      await user.click(screen.getByLabelText('Show removed'));

      await waitFor(() =>
        expect(screen.getByRole('link', { name: /Export CSV/ }).getAttribute('href')).toContain(
          'includeRemoved=true'
        )
      );
    });

    it('keeps the filter when paging', async () => {
      const user = userEvent.setup();
      const paged = { page: 1, limit: 25, total: 60, totalPages: 3 };
      // The toggle's own fetch replaces `meta`, so the response has to keep the
      // list multi-page or Next is disabled by the time we click it — which would
      // make this pass for the wrong reason.
      fetchMock.mockResolvedValue(listResponse([entry()], paged));
      render(<WaitlistTable initialEntries={[entry()]} initialMeta={paged} />);

      await user.click(screen.getByLabelText('Show removed'));
      await waitFor(() => expect(fetchMock).toHaveBeenCalledTimes(1));
      await user.click(screen.getByRole('button', { name: /Next/ }));

      await waitFor(() => expect(fetchMock).toHaveBeenCalledTimes(2));
      // Losing it here would silently drop the removed rows the admin is looking at
      // the moment they turned a page.
      expect(String(fetchMock.mock.calls[1]?.[0])).toContain('includeRemoved=true');
    });
  });

  it('says a fetch failed rather than leaving the old rows looking like the answer', async () => {
    const user = userEvent.setup();
    fetchMock.mockRejectedValue(new Error('network'));
    render(<WaitlistTable initialEntries={[entry()]} initialMeta={META} />);

    await user.type(screen.getByLabelText('Search the waitlist'), 'sleep');

    const alert = await waitFor(() => screen.getByRole('alert'));
    expect(within(alert).getByText(/did not load/)).toBeTruthy();
  });

  it('tells an empty list from an empty search result', async () => {
    const user = userEvent.setup();
    const { rerender } = render(
      <WaitlistTable initialEntries={[]} initialMeta={{ ...META, total: 0, totalPages: 0 }} />
    );

    expect(screen.getByText('Nobody has joined the waitlist yet.')).toBeTruthy();

    fetchMock.mockResolvedValue(listResponse([], { ...META, total: 0, totalPages: 0 }));
    rerender(
      <WaitlistTable initialEntries={[]} initialMeta={{ ...META, total: 0, totalPages: 0 }} />
    );
    await user.type(screen.getByLabelText('Search the waitlist'), 'sleep');

    // "Nobody has joined yet" on a filtered empty result is a false statement
    // about the product, on the surface whose whole job is to say whether anyone
    // has joined.
    await waitFor(() => expect(screen.getByText('Nobody on the list matches that.')).toBeTruthy());
  });
});
