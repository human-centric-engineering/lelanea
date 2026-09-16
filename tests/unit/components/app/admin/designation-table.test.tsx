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
