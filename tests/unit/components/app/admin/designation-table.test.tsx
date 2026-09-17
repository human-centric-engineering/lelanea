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
 * And the one a plausible SECOND version still got wrong: the cell saying
 * **Yes** about a document the rule permits and the search tool cannot reach —
 * a PDF in `pending_review` with zero chunks. `quotable` and `retrieval` are
 * two axes, the cell renders both, and it renders each from the server's
 * verdict rather than from `status` and `chunkCount` in JSX.
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
    retrieval: 'retrievable',
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

describe('what the `Agent may quote` cell claims', () => {
  // The bug: **Yes** about a document with nothing retrievable in it. The rule
  // permits it and there is nothing there to permit, which is the one thing this
  // column exists not to say.
  //
  // Every case below renders a ready, quotable document alongside, so the
  // absence of "Yes" on the others is asserted against a population that
  // demonstrably produces one (`fp6`).
  const STATES = [
    { retrieval: 'pending' as const, status: 'pending_review', label: 'Not yet' },
    { retrieval: 'pending' as const, status: 'processing', label: 'Not yet' },
    { retrieval: 'failed' as const, status: 'failed', label: 'Nothing to quote' },
    { retrieval: 'empty' as const, status: 'ready', label: 'Nothing to quote' },
  ];

  for (const { retrieval, status, label } of STATES) {
    it(`does not say the agent may quote a ${status} document with nothing in it`, () => {
      render(
        <DesignationTable
          initialDocuments={[
            doc({ id: 'reachable', name: 'A chunked method note' }),
            doc({
              id: 'unreachable',
              name: 'Nothing in it yet',
              status,
              chunkCount: 0,
              purpose: 'knowledge',
              // The rule DOES permit it. That is the point — the claim the cell
              // must not make is the one the permission alone would support.
              quotable: true,
              retrieval,
            }),
          ]}
          initialMeta={{ ...META, total: 2 }}
        />
      );

      const permitted = within(rowFor('A chunked method note'));
      const nothingThere = within(rowFor('Nothing in it yet'));

      // The positive claim is genuinely on screen...
      expect(permitted.getByText('Yes')).toBeTruthy();
      // ...and is NOT made about the document with nothing behind it.
      expect(nothingThere.queryByText('Yes')).toBeNull();
      expect(nothingThere.getByText(label)).toBeTruthy();
    });
  }

  it('keeps the two axes apart rather than calling it a flat "No"', () => {
    // A denied document and a permitted-but-empty one must not read the same.
    // Collapsing them would hide which half is missing — and "No" about a
    // document the rule permits is its own wrong answer, since chunking it
    // changes nothing about the designation.
    render(
      <DesignationTable
        initialDocuments={[
          doc({ id: 'denied', name: 'A Substack post', purpose: 'voice', quotable: false }),
          doc({
            id: 'waiting',
            name: 'A PDF awaiting review',
            status: 'pending_review',
            chunkCount: 0,
            quotable: true,
            retrieval: 'pending',
          }),
        ]}
        initialMeta={{ ...META, total: 2 }}
      />
    );

    expect(within(rowFor('A Substack post')).getByText('No')).toBeTruthy();
    expect(within(rowFor('A PDF awaiting review')).queryByText('No')).toBeNull();
    expect(within(rowFor('A PDF awaiting review')).getByText('Not yet')).toBeTruthy();
  });

  it('names what to do about a document that will never have anything in it', () => {
    // `HB10`: a cell that says "nothing to quote" and stops is a diagnosis. A
    // failed parse has a remedy she can act on from the uploader directly above
    // — the platform's dedupe deliberately does not return failed documents, so
    // re-uploading really does retry.
    render(
      <DesignationTable
        initialDocuments={[
          doc({ id: 'reachable', name: 'A chunked method note' }),
          doc({
            id: 'broken',
            name: 'A talk recording',
            status: 'failed',
            chunkCount: 0,
            quotable: true,
            retrieval: 'failed',
          }),
        ]}
        initialMeta={{ ...META, total: 2 }}
      />
    );

    expect(within(rowFor('A talk recording')).getByText(/Upload it again/)).toBeTruthy();
    expect(within(rowFor('A chunked method note')).queryByText(/Upload it again/)).toBeNull();
  });

  it('does not tell her to re-upload an `empty` document, where that does nothing', () => {
    // `uploadDocument` dedupes on `{ fileHash, status: 'ready' }` and an `empty`
    // document IS `ready`, so the same file comes back as the existing row with
    // nothing re-processed — the upload reports success and the cell still says
    // "Nothing to quote". A remedy that quietly does nothing is the `HB10` case,
    // so `empty` names the act that works and `failed` keeps the one that does.
    render(
      <DesignationTable
        initialDocuments={[
          doc({
            id: 'blank',
            name: 'An empty export',
            status: 'ready',
            chunkCount: 0,
            quotable: true,
            retrieval: 'empty',
          }),
          doc({
            id: 'broken',
            name: 'A talk recording',
            status: 'failed',
            chunkCount: 0,
            quotable: true,
            retrieval: 'failed',
          }),
        ]}
        initialMeta={{ ...META, total: 2 }}
      />
    );

    expect(within(rowFor('An empty export')).queryByText(/Upload it again/)).toBeNull();
    expect(
      within(rowFor('An empty export')).getByText(/Delete it and upload a readable copy/)
    ).toBeTruthy();
    // The one where a re-upload genuinely is a retry still says so.
    expect(within(rowFor('A talk recording')).getByText(/Upload it again/)).toBeTruthy();
  });

  it('still says Yes when a failed rechunk left the old chunks searchable', () => {
    // The inverted bug. `rechunkDocument`'s catch writes `failed` and leaves the
    // chunks in place, and the agent goes on quoting them — so "Nothing to
    // quote. Upload it again" here would be false AND would send her to create
    // a second document while the original stayed searchable.
    render(
      <DesignationTable
        initialDocuments={[
          doc({
            id: 'stale',
            name: 'A rechunk that fell over',
            status: 'failed',
            chunkCount: 9,
            quotable: true,
            retrieval: 'retrievable',
          }),
        ]}
        initialMeta={META}
      />
    );

    expect(within(rowFor('A rechunk that fell over')).getByText('Yes')).toBeTruthy();
    expect(within(rowFor('A rechunk that fell over')).queryByText(/Upload it again/)).toBeNull();
  });

  it('takes `retrieval` from the server too, rather than reading status in the cell', () => {
    // The same property the `quotable` case above pins, on the second axis. A
    // cell that reasoned from `status` and `chunkCount` would call this row
    // retrievable — they say ready with twelve chunks — and would disagree with
    // `retrievalState()` the moment either side changed its mind about what
    // "ready" means.
    render(
      <DesignationTable
        initialDocuments={[
          doc({ id: 'reachable', name: 'A chunked method note' }),
          doc({
            id: 'server-says-no',
            name: 'Looks ready, is not',
            status: 'ready',
            chunkCount: 12,
            quotable: true,
            retrieval: 'pending',
          }),
        ]}
        initialMeta={{ ...META, total: 2 }}
      />
    );

    expect(within(rowFor('A chunked method note')).getByText('Yes')).toBeTruthy();
    expect(within(rowFor('Looks ready, is not')).queryByText('Yes')).toBeNull();
    expect(within(rowFor('Looks ready, is not')).getByText('Not yet')).toBeTruthy();
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

describe('the reload signal — going and looking again when something lands', () => {
  function page(total: number, documents: ReturnType<typeof doc>[] = []) {
    return {
      ok: true,
      status: 200,
      json: async () => ({
        success: true,
        data: documents,
        meta: { page: 1, limit: 25, total, totalPages: total === 0 ? 0 : 1 },
      }),
    };
  }

  const ADDED = { token: 1, added: true };
  const NOT_ADDED = { token: 1, added: false };

  it('does not fetch on mount — only when the token actually moves', () => {
    render(
      <DesignationTable
        initialDocuments={[doc()]}
        initialMeta={META}
        reloadSignal={{ token: 7, added: true }}
      />
    );

    // The server page already fetched page one. A mount-time request would
    // duplicate it and make the table flicker on every navigation.
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it('re-requests page one when the token is bumped', async () => {
    fetchMock.mockResolvedValue(page(1, [doc()]));

    const { rerender } = render(
      <DesignationTable
        initialDocuments={[doc()]}
        initialMeta={META}
        reloadSignal={{ token: 0, added: false }}
      />
    );
    rerender(
      <DesignationTable initialDocuments={[doc()]} initialMeta={META} reloadSignal={ADDED} />
    );

    await waitFor(() => expect(fetchMock).toHaveBeenCalledTimes(1));
    const [url] = fetchMock.mock.calls[0] as [string];
    expect(url).toContain('page=1');
  });

  it('keeps the filter she is looking through when it refreshes', async () => {
    const user = userEvent.setup();
    fetchMock.mockResolvedValue(page(0));

    const { rerender } = render(
      <DesignationTable
        initialDocuments={[doc()]}
        initialMeta={META}
        reloadSignal={{ token: 0, added: false }}
      />
    );

    await user.click(screen.getByLabelText('Undesignated documents'));
    await waitFor(() => expect(fetchMock).toHaveBeenCalledTimes(1));

    rerender(
      <DesignationTable initialDocuments={[doc()]} initialMeta={META} reloadSignal={ADDED} />
    );

    // The refresh must not silently widen the list back to everything: the whole
    // reason the switch is on is that she is working through the undesignated
    // backlog, and a document she just added belongs in it.
    await waitFor(() => expect(fetchMock).toHaveBeenCalledTimes(2));
    const [url] = fetchMock.mock.calls[1] as [string];
    expect(url).toContain('undesignatedOnly=true');
  });

  it('says so when the upload landed outside the filter she is looking through', async () => {
    const user = userEvent.setup();
    // One row in view before and one after: the corpus grew, but not the part of
    // it she can see. Nothing else on screen would tell her — the upload zone
    // clears its staged files and says nothing at all.
    fetchMock.mockResolvedValue(page(1, [doc()]));

    const { rerender } = render(
      <DesignationTable
        initialDocuments={[doc()]}
        initialMeta={{ ...META, total: 1 }}
        reloadSignal={{ token: 0, added: false }}
      />
    );

    await user.click(screen.getByLabelText('Undesignated documents'));
    await waitFor(() => expect(fetchMock).toHaveBeenCalledTimes(1));
    // Establish the notice is not already on screen, so what follows is about
    // the upload rather than the component's initial state.
    expect(screen.queryByRole('status')).toBeNull();

    rerender(
      <DesignationTable
        initialDocuments={[doc()]}
        initialMeta={{ ...META, total: 1 }}
        reloadSignal={ADDED}
      />
    );

    const notice = await screen.findByRole('status');
    expect(notice.textContent).toMatch(/Nothing new in the list below/);
    expect(notice.textContent).toMatch(/Undesignated filter/);
    // And NOT the search, which she never typed. The first version hard-coded
    // "Clear the search" into the sentence, so the designed-for case — filter
    // on, no search — told her to clear something that was not set.
    expect(notice.textContent).not.toMatch(/search/);
  });

  it('names the search when the search is what is hiding it', async () => {
    const user = userEvent.setup({ delay: null });
    fetchMock.mockResolvedValue(page(1, [doc()]));

    const { rerender } = render(
      <DesignationTable
        initialDocuments={[doc()]}
        initialMeta={{ ...META, total: 1 }}
        reloadSignal={{ token: 0, added: false }}
      />
    );

    await user.type(screen.getByLabelText('Search'), 'ledger');
    await waitFor(() => expect(fetchMock).toHaveBeenCalled());

    rerender(
      <DesignationTable
        initialDocuments={[doc()]}
        initialMeta={{ ...META, total: 1 }}
        reloadSignal={ADDED}
      />
    );

    const notice = await screen.findByRole('status');
    expect(notice.textContent).toMatch(/clear the search/i);
    expect(notice.textContent).not.toMatch(/Undesignated filter/);
  });

  it('stays quiet when the upload did land in view', async () => {
    // The common path: the undesignated filter on, an untagged upload. A check
    // that reasoned from "is a filter active?" rather than from the row count
    // would cry wolf here, on the most ordinary thing she does.
    const user = userEvent.setup();
    fetchMock.mockResolvedValueOnce(page(1, [doc()]));
    fetchMock.mockResolvedValue(
      page(2, [doc(), doc({ id: 'doc-2', name: 'Just added', purpose: null, quotable: false })])
    );

    const { rerender } = render(
      <DesignationTable
        initialDocuments={[doc()]}
        initialMeta={{ ...META, total: 1 }}
        reloadSignal={{ token: 0, added: false }}
      />
    );

    await user.click(screen.getByLabelText('Undesignated documents'));
    await waitFor(() => expect(fetchMock).toHaveBeenCalledTimes(1));

    rerender(
      <DesignationTable
        initialDocuments={[doc()]}
        initialMeta={{ ...META, total: 1 }}
        reloadSignal={ADDED}
      />
    );

    expect(await screen.findByText('Just added')).toBeTruthy();
    expect(screen.queryByRole('status')).toBeNull();
  });

  it('says nothing when the refresh did not follow an ADD — a discard deletes a row', async () => {
    // Discarding a PDF from the preview modal DELETES the document and still
    // refreshes the table. Inferring "added" from the refresh made the page
    // announce "Added" about a document that had just been destroyed, and the
    // row count cannot tell the two apart: neither grew.
    //
    // The filter is turned on FIRST, deliberately. Without it this case is
    // already silenced by the narrowed-view condition, so `added: false` would
    // not be the thing carrying the assertion and flipping it back would leave
    // the test green — decoration rather than a guard (`fp6`).
    const user = userEvent.setup();
    fetchMock.mockResolvedValue(page(1, [doc()]));

    const { rerender } = render(
      <DesignationTable
        initialDocuments={[doc()]}
        initialMeta={{ ...META, total: 1 }}
        reloadSignal={{ token: 0, added: false }}
      />
    );

    await user.click(screen.getByLabelText('Undesignated documents'));
    await waitFor(() => expect(fetchMock).toHaveBeenCalledTimes(1));

    rerender(
      <DesignationTable
        initialDocuments={[doc()]}
        initialMeta={{ ...META, total: 1 }}
        reloadSignal={NOT_ADDED}
      />
    );

    await waitFor(() => expect(fetchMock).toHaveBeenCalledTimes(2));
    expect(screen.queryByRole('status')).toBeNull();
  });

  it('says nothing when nothing is narrowing the view', async () => {
    // No search, no filter, and the count did not move — so nothing was added,
    // and there is no remedy to offer. This is the bulk upload where every file
    // errored: Sunrise's zone calls `onUploadComplete()` regardless and passes
    // no result, so the zone's own error is the honest report, not ours.
    fetchMock.mockResolvedValue(page(1, [doc()]));

    const { rerender } = render(
      <DesignationTable
        initialDocuments={[doc()]}
        initialMeta={{ ...META, total: 1 }}
        reloadSignal={{ token: 0, added: false }}
      />
    );

    rerender(
      <DesignationTable
        initialDocuments={[doc()]}
        initialMeta={{ ...META, total: 1 }}
        reloadSignal={ADDED}
      />
    );

    await waitFor(() => expect(fetchMock).toHaveBeenCalledTimes(1));
    expect(screen.queryByRole('status')).toBeNull();
  });

  it('is not thrown off by a designation she made in the meantime', async () => {
    // The workflow the page is FOR: filter on, work the backlog, upload more.
    // `save()` patches the row in place and never refetches, so the server's
    // undesignated count falls while a remembered count does not — and every
    // later upload then compares against a number that is too high. Here the
    // upload's page comes back carrying a document that was not there before,
    // so the honest answer is silence however the counts happen to line up.
    const user = userEvent.setup();
    const backlog = [
      doc({ id: 'a', name: 'First', purpose: null, quotable: false }),
      doc({ id: 'b', name: 'Second', purpose: null, quotable: false }),
    ];

    fetchMock.mockResolvedValueOnce(page(2, backlog));
    // The PATCH for the designation she makes.
    fetchMock.mockResolvedValueOnce({
      ok: true,
      status: 200,
      json: async () => ({
        success: true,
        data: {
          designation: {
            purpose: 'knowledge',
            sensitivity: 'public',
            licensing: null,
            quotable: true,
          },
        },
      }),
    });
    // The upload's reload: one row has left the filter, a new one has arrived,
    // so the TOTAL is unchanged at 2 — exactly the collision a count cannot see.
    fetchMock.mockResolvedValue(
      page(2, [
        doc({ id: 'c', name: 'Just added', purpose: null, quotable: false }),
        doc({ id: 'b', name: 'Second', purpose: null, quotable: false }),
      ])
    );

    const { rerender } = render(
      <DesignationTable
        initialDocuments={backlog}
        initialMeta={{ ...META, total: 2 }}
        reloadSignal={{ token: 0, added: false }}
      />
    );

    await user.click(screen.getByLabelText('Undesignated documents'));
    await waitFor(() => expect(fetchMock).toHaveBeenCalledTimes(1));

    await user.click(within(rowFor('First')).getByRole('combobox', { name: /purpose/i }));
    await user.click(await screen.findByRole('option', { name: /Knowledge/ }));
    await waitFor(() => expect(fetchMock).toHaveBeenCalledTimes(2));

    rerender(
      <DesignationTable
        initialDocuments={backlog}
        initialMeta={{ ...META, total: 2 }}
        reloadSignal={ADDED}
      />
    );

    expect(await screen.findByText('Just added')).toBeTruthy();
    expect(screen.queryByRole('status')).toBeNull();
  });

  it('drops the notice as soon as she changes what she is looking through', async () => {
    const user = userEvent.setup();
    fetchMock.mockResolvedValue(page(1, [doc()]));

    const { rerender } = render(
      <DesignationTable
        initialDocuments={[doc()]}
        initialMeta={{ ...META, total: 1 }}
        reloadSignal={{ token: 0, added: false }}
      />
    );

    await user.click(screen.getByLabelText('Undesignated documents'));
    await waitFor(() => expect(fetchMock).toHaveBeenCalledTimes(1));

    rerender(
      <DesignationTable
        initialDocuments={[doc()]}
        initialMeta={{ ...META, total: 1 }}
        reloadSignal={ADDED}
      />
    );
    await screen.findByRole('status');

    // Acting on the advice must retire it. A notice that outlived the filter it
    // describes would be telling her to clear something already cleared.
    await user.click(screen.getByLabelText('Undesignated documents'));

    await waitFor(() => expect(screen.queryByRole('status')).toBeNull());
  });
});
