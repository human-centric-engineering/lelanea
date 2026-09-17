// @vitest-environment happy-dom

/**
 * The designation table.
 *
 * Not "a table renders rows". The four things wrong in a plausible first version:
 *
 *  - the `Agent may quote` cell computed in JSX from the purpose, which is a
 *    second implementation of the rule and would drift from the one the agent
 *    actually obeys;
 *  - a purpose change sending the whole row back, so editing a purpose silently
 *    rewrites the licensing note that happened to be on screen;
 *  - an undesignated document rendering as a blank cell, indistinguishable from
 *    one that reaches everything — the exact confusion this surface exists to
 *    remove;
 *  - the empty state claiming "no documents yet" after a failed load (`HB9`).
 *
 * @see components/app/admin/designation-table.tsx
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';

import { DesignationTable } from '@/components/app/admin/designation-table';
import type { DesignatedDocument } from '@/lib/app/voice/designation-admin';
import { DESIGNATION_ADMIN_ENDPOINT } from '@/lib/app/voice/endpoint';
import { LICENSING_MAX } from '@/lib/validations/app-knowledge-designation';
import type { PaginationMeta } from '@/types/api';

function doc(overrides: Partial<DesignatedDocument> = {}): DesignatedDocument {
  return {
    id: 'doc-1',
    name: 'The long way round',
    fileName: 'long-way-round.md',
    status: 'ready',
    chunkCount: 12,
    createdAt: new Date('2026-09-01T10:00:00.000Z'),
    purpose: 'knowledge',
    sensitivity: 'public',
    licensing: null,
    quotable: true,
    ...overrides,
  };
}

const META: PaginationMeta = { page: 1, limit: 25, total: 1, totalPages: 1 };

const fetchMock = vi.fn();

beforeEach(() => {
  vi.clearAllMocks();
  vi.stubGlobal('fetch', fetchMock);
});

function rowFor(name: string): HTMLElement {
  return screen.getByText(name).closest('tr') as HTMLElement;
}

describe('what the row says', () => {
  it('shows the server’s `quotable` answer, not one derived in the cell', () => {
    // A `voice` document that the server says is not quotable, and — the case
    // that matters — a `knowledge` document the server ALSO says is not quotable,
    // because it is client material. A cell that reasoned from the purpose would
    // get the second one wrong, and would say "Yes" about a document the agent
    // cannot reach.
    render(
      <DesignationTable
        initialDocuments={[
          doc({ id: 'a', name: 'A method note', purpose: 'knowledge', quotable: true }),
          doc({ id: 'b', name: 'A Substack post', purpose: 'voice', quotable: false }),
          doc({
            id: 'c',
            name: 'A client session',
            purpose: 'knowledge',
            sensitivity: 'client',
            quotable: false,
          }),
        ]}
        initialMeta={{ ...META, total: 3 }}
      />
    );

    expect(within(rowFor('A method note')).getByText('Yes')).toBeTruthy();
    expect(within(rowFor('A Substack post')).getByText('No')).toBeTruthy();
    expect(within(rowFor('A client session')).getByText('No')).toBeTruthy();
  });

  it('renders an undesignated document as "Not designated", not as a blank cell', () => {
    render(
      <DesignationTable
        initialDocuments={[doc({ purpose: null, sensitivity: null, quotable: false })]}
        initialMeta={META}
      />
    );

    // Two selects, both saying it. An empty cell would read as "nothing to say
    // about this", which is the opposite of the truth: it reaches nothing.
    expect(screen.getAllByText('Not designated').length).toBeGreaterThanOrEqual(2);
  });

  it('offers to add a licensing note when there is none', () => {
    render(<DesignationTable initialDocuments={[doc()]} initialMeta={META} />);

    expect(screen.getByText('Add a note')).toBeTruthy();
  });
});

describe('saving a designation', () => {
  it('sends only the field that changed', async () => {
    const user = userEvent.setup();
    fetchMock.mockResolvedValue({
      ok: true,
      status: 200,
      json: async () => ({
        success: true,
        data: {
          designation: {
            purpose: 'voice',
            sensitivity: 'public',
            licensing: 'Hers.',
            quotable: false,
          },
        },
      }),
    });

    render(
      <DesignationTable initialDocuments={[doc({ licensing: 'Hers.' })]} initialMeta={META} />
    );

    await user.click(screen.getByLabelText('Purpose of The long way round'));
    await user.click(await screen.findByRole('option', { name: 'Voice' }));

    await waitFor(() => expect(fetchMock).toHaveBeenCalled());
    // `body` is typed `BodyInit | null` — a union wide enough that ESLint refuses
    // to stringify it. The component sends `JSON.stringify(...)`, so narrow to the
    // string it actually is rather than coercing a union that includes streams.
    const [url, init] = fetchMock.mock.calls[0] as [string, RequestInit & { body: string }];
    expect(url).toBe(`${DESIGNATION_ADMIN_ENDPOINT}/doc-1`);
    expect(init.method).toBe('PATCH');
    // Purpose alone. A body carrying `licensing` too would rewrite the note from
    // whatever the row happened to be holding — and `null` for a field means
    // CLEAR it, so sending the whole row is how an edit silently erases an answer.
    expect(JSON.parse(init.body)).toEqual({ purpose: 'voice' });
  });

  it('takes `quotable` from the response rather than guessing it', async () => {
    const user = userEvent.setup();
    fetchMock.mockResolvedValue({
      ok: true,
      status: 200,
      json: async () => ({
        success: true,
        data: {
          designation: {
            purpose: 'voice',
            sensitivity: 'public',
            licensing: null,
            quotable: false,
          },
        },
      }),
    });

    render(<DesignationTable initialDocuments={[doc()]} initialMeta={META} />);
    expect(within(rowFor('The long way round')).getByText('Yes')).toBeTruthy();

    await user.click(screen.getByLabelText('Purpose of The long way round'));
    await user.click(await screen.findByRole('option', { name: 'Voice' }));

    await waitFor(() => expect(within(rowFor('The long way round')).getByText('No')).toBeTruthy());
  });

  it('says so when the save fails, instead of showing the change as though it landed', async () => {
    const user = userEvent.setup();
    fetchMock.mockResolvedValue({
      ok: false,
      status: 422,
      json: async () => ({
        success: false,
        error: { code: 'VALIDATION_ERROR', message: 'The designation vocabulary is not seeded.' },
      }),
    });

    render(<DesignationTable initialDocuments={[doc()]} initialMeta={META} />);

    await user.click(screen.getByLabelText('Purpose of The long way round'));
    await user.click(await screen.findByRole('option', { name: 'Voice' }));

    const alert = await screen.findByRole('alert');
    expect(alert.textContent).toContain('not seeded');
    // And the row still shows what the server last confirmed.
    expect(within(rowFor('The long way round')).getByText('Yes')).toBeTruthy();
  });
});

describe('the empty state', () => {
  it('does not claim the corpus is empty when the load failed (HB9)', () => {
    render(<DesignationTable initialDocuments={[]} initialMeta={META} initialLoadFailed />);

    expect(screen.getByText(/could not be loaded/i)).toBeTruthy();
    expect(screen.queryByText(/No training material yet/i)).toBeNull();
  });

  it('points at the uploader above, not at the orchestration admin (t-44)', () => {
    // The stale sentence sent her to AI Orchestration → Knowledge, which is the
    // split t-44 exists to close. Asserted in both directions: the new sentence
    // present, and the route named nowhere on the surface — an absence claim
    // that would pass for free if the empty state had not rendered at all, hence
    // the first assertion.
    render(<DesignationTable initialDocuments={[]} initialMeta={{ ...META, total: 0 }} />);

    expect(screen.getByText(/No training material yet\. Add a document above/i)).toBeTruthy();
    expect(screen.queryByText(/AI Orchestration/i)).toBeNull();
  });

  it('says nothing is waiting on an answer when the undesignated filter is empty', async () => {
    const user = userEvent.setup();
    fetchMock.mockResolvedValue({
      ok: true,
      status: 200,
      json: async () => ({
        success: true,
        data: [],
        meta: { page: 1, limit: 25, total: 0, totalPages: 0 },
      }),
    });

    render(<DesignationTable initialDocuments={[doc()]} initialMeta={META} />);

    await user.click(screen.getByLabelText('Undesignated documents'));

    // A different sentence from the general empty state, because "no documents"
    // and "none left undesignated" are opposite pieces of news.
    expect(await screen.findByText(/Nothing is undesignated/i)).toBeTruthy();
    const [url] = fetchMock.mock.calls[0] as [string];
    expect(url).toContain('undesignatedOnly=true');
  });
});

describe('the filters and the requests they send', () => {
  it('cancels a pending search keystroke when the undesignated switch is flipped', async () => {
    // The seq guard alone does not cover this: the pending debounce is the LATER
    // request. Type, flip the switch inside the 300 ms window, and the toggle's
    // fetch goes out first while the debounce fires afterwards carrying the
    // `undesignatedOnly` value captured BEFORE the flip — so the stale one wins,
    // the table shows every document, and the switch still reads "on".
    const user = userEvent.setup({ delay: null });
    fetchMock.mockResolvedValue({
      ok: true,
      status: 200,
      json: async () => ({
        success: true,
        data: [],
        meta: { page: 1, limit: 25, total: 0, totalPages: 0 },
      }),
    });

    render(<DesignationTable initialDocuments={[doc()]} initialMeta={META} />);

    await user.type(screen.getByLabelText('Search'), 'method');
    await user.click(screen.getByLabelText('Undesignated documents'));

    // Real timers, and a real wait past the 300 ms window — the file's other
    // interaction tests run on real timers, and swapping halfway through leaks
    // fake ones into every case after it.
    await new Promise((resolve) => setTimeout(resolve, 600));

    // If the toggle did not clear the pending debounce, a SECOND request goes out
    // here carrying the pre-flip filter, and the seq guard lets it win.
    expect(fetchMock).toHaveBeenCalledTimes(1);
    const [url] = fetchMock.mock.calls[0] as [string];
    expect(url).toContain('undesignatedOnly=true');
  });

  it('does not send a search of pure whitespace', async () => {
    // `q` is `.trim().min(1)` server-side, so a space bar's worth of "search" is
    // a 400 and an error banner over a table that was fine.
    const user = userEvent.setup({ delay: null });
    fetchMock.mockResolvedValue({
      ok: true,
      status: 200,
      json: async () => ({ success: true, data: [], meta: { ...META, total: 0, totalPages: 0 } }),
    });

    render(<DesignationTable initialDocuments={[doc()]} initialMeta={META} />);

    await user.type(screen.getByLabelText('Search'), '   ');
    await new Promise((resolve) => setTimeout(resolve, 600));

    expect(fetchMock).toHaveBeenCalledTimes(1);
    const [url] = fetchMock.mock.calls[0] as [string];
    expect(url).not.toContain('q=');
  });
});

describe('the licensing note', () => {
  it('keeps the typed note on screen when the save fails', async () => {
    // The text an admin loses this way is the one they just typed out of a
    // permission email. Closing the editor before the write lands made any
    // failure — including the 400 the length cap returns — unrecoverable.
    const user = userEvent.setup();
    fetchMock.mockResolvedValue({
      ok: false,
      status: 500,
      json: async () => ({
        success: false,
        error: { code: 'INTERNAL_ERROR', message: 'Something broke.' },
      }),
    });

    render(<DesignationTable initialDocuments={[doc()]} initialMeta={META} />);

    await user.click(screen.getByRole('button', { name: /add a note/i }));
    const textarea = screen.getByLabelText('Licensing note for The long way round');
    await user.type(textarea, 'Hers, CC BY.');
    await user.click(screen.getByRole('button', { name: 'Save' }));

    expect(await screen.findByRole('alert')).toBeTruthy();
    // Still editing, and the words are still there.
    const after = screen.getByLabelText('Licensing note for The long way round');
    expect((after as HTMLTextAreaElement).value).toBe('Hers, CC BY.');
  });

  it('closes the editor once the save lands', async () => {
    const user = userEvent.setup();
    fetchMock.mockResolvedValue({
      ok: true,
      status: 200,
      json: async () => ({
        success: true,
        data: {
          designation: {
            purpose: 'knowledge',
            sensitivity: 'public',
            licensing: 'Hers, CC BY.',
            quotable: true,
          },
        },
      }),
    });

    render(<DesignationTable initialDocuments={[doc()]} initialMeta={META} />);

    await user.click(screen.getByRole('button', { name: /add a note/i }));
    await user.type(screen.getByLabelText('Licensing note for The long way round'), 'Hers, CC BY.');
    await user.click(screen.getByRole('button', { name: 'Save' }));

    await waitFor(() =>
      expect(screen.queryByLabelText('Licensing note for The long way round')).toBeNull()
    );
    expect(within(rowFor('The long way round')).getByText('Hers, CC BY.')).toBeTruthy();
  });

  it('stops the admin typing past the length the server will accept', async () => {
    // The cap enforced where it can be obeyed rather than only where it is
    // checked. Read from the schema, not written out here: the two drifting apart
    // is the defect, so a test restating the number would pass through it.
    const user = userEvent.setup();
    render(<DesignationTable initialDocuments={[doc()]} initialMeta={META} />);

    await user.click(screen.getByRole('button', { name: /add a note/i }));

    const textarea = screen.getByLabelText('Licensing note for The long way round');
    expect(textarea.getAttribute('maxlength')).toBe(String(LICENSING_MAX));
  });
});

describe('two saves at once', () => {
  it('re-enables each row on its own save, not on whichever finishes first', async () => {
    // One `savingId` slot misreported this: change a purpose on row A, change one
    // on row B before A resolves, and A's `finally` cleared the slot — so B's row
    // un-dimmed and its selects re-enabled while B's PATCH was still in flight.
    const user = userEvent.setup();

    let releaseA: (() => void) | undefined;
    const designation = {
      purpose: 'voice',
      sensitivity: 'public',
      licensing: null,
      quotable: false,
    };
    const response = {
      ok: true,
      status: 200,
      json: async () => ({ success: true, data: { designation } }),
    };

    fetchMock
      // Row A's save hangs until we let it go.
      .mockImplementationOnce(
        async () => new Promise((resolve) => (releaseA = () => resolve(response)))
      )
      .mockResolvedValue(response);

    render(
      <DesignationTable
        initialDocuments={[
          doc({ id: 'a', name: 'A method note' }),
          doc({ id: 'b', name: 'A talk' }),
        ]}
        initialMeta={{ ...META, total: 2 }}
      />
    );

    await user.click(screen.getByLabelText('Purpose of A method note'));
    await user.click(await screen.findByRole('option', { name: 'Voice' }));

    await user.click(screen.getByLabelText('Purpose of A talk'));
    await user.click(await screen.findByRole('option', { name: 'Voice' }));

    // B has landed; A has not. B is free, A is still locked.
    await waitFor(() =>
      expect(screen.getByLabelText('Purpose of A talk').hasAttribute('disabled')).toBe(false)
    );
    expect(screen.getByLabelText('Purpose of A method note').hasAttribute('disabled')).toBe(true);

    releaseA?.();
    await waitFor(() =>
      expect(screen.getByLabelText('Purpose of A method note').hasAttribute('disabled')).toBe(false)
    );
  });
});

describe('reloadToken — going and looking again when something lands', () => {
  function emptyPage(total: number) {
    return {
      ok: true,
      status: 200,
      json: async () => ({
        success: true,
        data: [],
        meta: { page: 1, limit: 25, total, totalPages: total === 0 ? 0 : 1 },
      }),
    };
  }

  it('does not fetch on mount — only when the token actually moves', () => {
    render(<DesignationTable initialDocuments={[doc()]} initialMeta={META} reloadToken={7} />);

    // The server page already fetched page one. A mount-time request would
    // duplicate it and would make the table flicker on every navigation.
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it('re-requests page one when the token is bumped', async () => {
    fetchMock.mockResolvedValue(emptyPage(1));

    const { rerender } = render(
      <DesignationTable initialDocuments={[doc()]} initialMeta={META} reloadToken={0} />
    );
    rerender(<DesignationTable initialDocuments={[doc()]} initialMeta={META} reloadToken={1} />);

    await waitFor(() => expect(fetchMock).toHaveBeenCalledTimes(1));
    const [url] = fetchMock.mock.calls[0] as [string];
    expect(url).toContain('page=1');
  });

  it('keeps the filter she is looking through when it refreshes', async () => {
    const user = userEvent.setup();
    fetchMock.mockResolvedValue(emptyPage(0));

    const { rerender } = render(
      <DesignationTable initialDocuments={[doc()]} initialMeta={META} reloadToken={0} />
    );

    await user.click(screen.getByLabelText('Undesignated documents'));
    await waitFor(() => expect(fetchMock).toHaveBeenCalledTimes(1));

    rerender(<DesignationTable initialDocuments={[doc()]} initialMeta={META} reloadToken={1} />);

    // The refresh must not silently widen the list back to everything: the whole
    // reason she has that switch on is that she is working through the backlog
    // of undesignated documents, and a document she just added belongs in it.
    await waitFor(() => expect(fetchMock).toHaveBeenCalledTimes(2));
    const [url] = fetchMock.mock.calls[1] as [string];
    expect(url).toContain('undesignatedOnly=true');
  });
});
