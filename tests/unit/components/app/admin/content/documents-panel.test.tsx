// @vitest-environment happy-dom

/**
 * Her foundational documents, edited (f-content-seeds t-91): the collection
 * meta, reading order, opening a document, the blocks editor, the
 * acknowledgement warning, and what each save says.
 *
 * `fetch` is mocked at the boundary, and `useRouter` is replaced with
 * `createMockRouter` (never hand-rolled — the repo scans for that), the same
 * shape `tests/unit/components/app/admin/slot-definitions.test.tsx` and the
 * agent-form component tests use.
 *
 * @see components/app/admin/content/documents-panel.tsx
 */

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { fireEvent, render, screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';

import { DocumentsPanel } from '@/components/app/admin/content/documents-panel';
import { contentItemEndpoint, contentOrderEndpoint } from '@/lib/app/content/admin/endpoint';
import type { SectionReader } from '@/lib/app/content/admin/readers';
import type { DocumentAdminRow, DocumentsAdminView } from '@/lib/app/content/admin/documents';

const mockRefresh = vi.fn();

vi.mock('next/navigation', async () => {
  const { createMockRouter } = await import('@/tests/types/mocks');
  return {
    useRouter: () => createMockRouter({ refresh: mockRefresh }),
  };
});

function ok(data: unknown, status = 200) {
  return new Response(JSON.stringify({ success: true, data }), {
    status,
    headers: { 'content-type': 'application/json' },
  });
}

function refused(status: number, message: string, details?: unknown) {
  return new Response(
    JSON.stringify({ success: false, error: { code: 'CONFLICT', message, details } }),
    { status, headers: { 'content-type': 'application/json' } }
  );
}

/** What the browser actually sent on call `index`. */
function sent(index = 0) {
  const call = fetchMock.mock.calls[index] as [string, RequestInit & { body?: string }];
  return {
    url: call[0],
    method: call[1]?.method,
    body: call[1]?.body === undefined ? undefined : (JSON.parse(call[1].body) as unknown),
  };
}

/** The `li` a block's fields live in, found by its unique type-select label. */
function blockRow(index: number): ReturnType<typeof within> {
  const combobox = screen.getByRole('combobox', { name: `Block ${index + 1} type` });
  const li = combobox.closest('li');
  if (!li) throw new Error(`block row ${index} not found`);
  return within(li);
}

const LOCKED: SectionReader = {
  document: 'doc-ack',
  section: 'welcome',
  readers: ['the welcome email'],
};

const DOC_ACK: DocumentAdminRow = {
  id: 'doc-ack',
  title: 'The Initiation',
  subtitle: 'A subtitle.',
  category: 'onboarding',
  surface: 'first_run_welcome',
  requiresAcknowledgement: true,
  placeholders: ['first_name'],
  renderStyle: 'cadence',
  renderNote: 'One paragraph per line.',
  version: '1.1',
  locale: 'en-US',
  revision: 3,
  sections: ['welcome', 'invitation'],
  blockCount: 2,
  blocks: [
    { type: 'paragraph', text: 'First line.', section: 'welcome' },
    { type: 'paragraph', text: 'Second line.', section: null },
  ],
  position: 0,
  readers: [],
  lockedSections: [LOCKED],
};

const DOC_PLAIN: DocumentAdminRow = {
  id: 'doc-plain',
  title: 'The Mission',
  subtitle: null,
  category: 'about',
  surface: 'mission_page',
  requiresAcknowledgement: false,
  placeholders: [],
  renderStyle: null,
  renderNote: null,
  version: '1',
  locale: 'en-US',
  revision: 1,
  sections: [],
  blockCount: 1,
  blocks: [{ type: 'paragraph', text: 'Only paragraph.', section: null }],
  position: 1,
  readers: [
    'the mission page (/mission)',
    'the public content API (/api/v1/app/content/documents)',
  ],
  lockedSections: [],
};

const COLLECTION = {
  id: 'collection-1',
  title: 'Foundational documents',
  version: '2.0',
  locale: 'en-US',
  updatedAt: '2026-09-01T00:00:00.000Z',
};

const VIEW: DocumentsAdminView = {
  seeded: true,
  collection: COLLECTION,
  documents: [DOC_ACK, DOC_PLAIN],
};

let fetchMock: ReturnType<typeof vi.fn>;

beforeEach(() => {
  fetchMock = vi.fn();
  vi.stubGlobal('fetch', fetchMock);
  mockRefresh.mockClear();
});

afterEach(() => {
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
});

async function openDoc(user: ReturnType<typeof userEvent.setup>, title: string) {
  const { unmount } = render(<DocumentsPanel initialView={VIEW} />);
  await user.click(screen.getByRole('button', { name: title }));
  return unmount;
}

/**
 * The open document's own editor, scoped by its title toggle. "Title" and
 * "Version" are ambiguous against `screen` once a document is open — the
 * collection meta section above carries fields with the same labels.
 */
function editor(title: string): ReturnType<typeof within> {
  const li = screen.getByRole('button', { name: title }).closest('li');
  if (!li) throw new Error(`editor for "${title}" not found`);
  return within(li);
}

describe('before the seed has run', () => {
  it('says so, and offers nothing to edit', () => {
    render(<DocumentsPanel initialView={{ seeded: false, collection: null, documents: [] }} />);

    expect(screen.getByText(/have not been seeded yet/)).toBeInTheDocument();
    expect(screen.getByText('npm run db:seed')).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'Save collection' })).toBeNull();
  });

  it('says so too when seeded is true but the collection row itself is missing', () => {
    render(<DocumentsPanel initialView={{ seeded: true, collection: null, documents: [] }} />);

    expect(screen.getByText(/have not been seeded yet/)).toBeInTheDocument();
  });
});

describe('the document list', () => {
  it('shows each document with its category, version, revision and the gate badge only where it applies', () => {
    render(<DocumentsPanel initialView={VIEW} />);

    const ackRow = screen.getByRole('button', { name: 'The Initiation' }).closest('li');
    expect(ackRow).not.toBeNull();
    if (!ackRow) throw new Error('unreachable');
    expect(within(ackRow).getByText('onboarding')).toBeInTheDocument();
    expect(within(ackRow).getByText('v1.1')).toBeInTheDocument();
    expect(within(ackRow).getByText('revision 3')).toBeInTheDocument();
    expect(within(ackRow).getByText('agreed to at the gate')).toBeInTheDocument();
    expect(within(ackRow).getByText('doc-ack')).toBeInTheDocument();

    const plainRow = screen.getByRole('button', { name: 'The Mission' }).closest('li');
    if (!plainRow) throw new Error('unreachable');
    expect(within(plainRow).queryByText('agreed to at the gate')).toBeNull();
  });
});

describe('the collection meta', () => {
  it('is prefilled from the loaded row, and saves the edited fields plus its own updatedAt lock', async () => {
    const user = userEvent.setup();
    render(<DocumentsPanel initialView={VIEW} />);

    expect(screen.getByLabelText('Title')).toHaveValue('Foundational documents');
    await user.clear(screen.getByLabelText('Title'));
    await user.type(screen.getByLabelText('Title'), 'Renamed collection');
    await user.clear(screen.getByLabelText('Version'));
    await user.type(screen.getByLabelText('Version'), '2.1');
    await user.clear(screen.getByLabelText('Locale'));
    await user.type(screen.getByLabelText('Locale'), 'en-GB');

    fetchMock.mockResolvedValueOnce(ok({ changed: ['title', 'version', 'locale'] }));
    await user.click(screen.getByRole('button', { name: 'Save collection' }));

    expect(sent().url).toBe(contentItemEndpoint('documents', 'collection', 'collection-1'));
    expect(sent().method).toBe('PUT');
    expect(sent().body).toEqual({
      title: 'Renamed collection',
      version: '2.1',
      locale: 'en-GB',
      updatedAt: '2026-09-01T00:00:00.000Z',
    });
    expect(await screen.findByText('Saved the collection.')).toBeInTheDocument();
    expect(mockRefresh).toHaveBeenCalledTimes(1);
  });

  it('says plainly when nothing had changed, rather than claiming a save', async () => {
    const user = userEvent.setup();
    render(<DocumentsPanel initialView={VIEW} />);

    fetchMock.mockResolvedValueOnce(ok({ changed: [] }));
    await user.click(screen.getByRole('button', { name: 'Save collection' }));

    expect(await screen.findByText('Nothing had changed.')).toBeInTheDocument();
  });

  it('shows the route’s stale-row refusal and does not refresh', async () => {
    const user = userEvent.setup();
    render(<DocumentsPanel initialView={VIEW} />);

    fetchMock.mockResolvedValueOnce(
      refused(409, 'The collection was changed by someone else since you opened it.')
    );
    await user.click(screen.getByRole('button', { name: 'Save collection' }));

    expect(await screen.findByRole('alert')).toHaveTextContent(/changed by someone else/);
    expect(mockRefresh).not.toHaveBeenCalled();
  });
});

describe('reordering documents', () => {
  it('sends the new order with each id’s loaded revision, and reports success', async () => {
    const user = userEvent.setup();
    render(<DocumentsPanel initialView={VIEW} />);

    expect(screen.getByRole('button', { name: 'Move The Initiation up' })).toBeDisabled();
    expect(screen.getByRole('button', { name: 'Move The Mission down' })).toBeDisabled();

    fetchMock.mockResolvedValueOnce(ok({ moved: 2 }));
    await user.click(screen.getByRole('button', { name: 'Move The Mission up' }));

    expect(sent().url).toBe(contentOrderEndpoint('documents'));
    expect(sent().method).toBe('PUT');
    expect(sent().body).toEqual({
      order: [
        { id: 'doc-plain', revision: 1 },
        { id: 'doc-ack', revision: 3 },
      ],
    });
    expect(await screen.findByText('Saved the new reading order.')).toBeInTheDocument();
    expect(mockRefresh).toHaveBeenCalledTimes(1);
  });

  it('moves a document down the list the same way', async () => {
    const user = userEvent.setup();
    render(<DocumentsPanel initialView={VIEW} />);

    fetchMock.mockResolvedValueOnce(ok({ moved: 2 }));
    await user.click(screen.getByRole('button', { name: 'Move The Initiation down' }));

    expect(sent().body).toEqual({
      order: [
        { id: 'doc-plain', revision: 1 },
        { id: 'doc-ack', revision: 3 },
      ],
    });
    expect(await screen.findByText('Saved the new reading order.')).toBeInTheDocument();
  });

  it('reports a reorder refusal without claiming success', async () => {
    const user = userEvent.setup();
    render(<DocumentsPanel initialView={VIEW} />);

    fetchMock.mockResolvedValueOnce(refused(409, 'The order changed underneath you.'));
    await user.click(screen.getByRole('button', { name: 'Move The Mission up' }));

    expect(await screen.findByRole('alert')).toHaveTextContent('The order changed underneath you.');
    expect(mockRefresh).not.toHaveBeenCalled();
  });
});

describe('opening and closing a document', () => {
  it('toggles the editor open and shows the loaded fields', async () => {
    const user = userEvent.setup();
    render(<DocumentsPanel initialView={VIEW} />);

    const toggle = screen.getByRole('button', { name: 'The Initiation' });
    expect(toggle).toHaveAttribute('aria-expanded', 'false');
    expect(screen.queryByLabelText('Subtitle')).toBeNull();

    await user.click(toggle);
    expect(toggle).toHaveAttribute('aria-expanded', 'true');
    expect(screen.getByLabelText('Subtitle')).toHaveValue('A subtitle.');

    await user.click(toggle);
    expect(toggle).toHaveAttribute('aria-expanded', 'false');
    expect(screen.queryByLabelText('Subtitle')).toBeNull();
  });
});

describe('saving a document', () => {
  it('normalises subtitle/render fields to null when empty, and placeholders to a trimmed list', async () => {
    const user = userEvent.setup();
    await openDoc(user, 'The Initiation');

    await user.clear(screen.getByLabelText('Subtitle'));
    await user.clear(screen.getByLabelText('Render style'));
    const placeholders = screen.getByLabelText('Merge fields');
    await user.clear(placeholders);
    await user.type(placeholders, ' first_name ,  last_name');
    await user.type(screen.getByLabelText('Surface'), '_v2');
    await user.type(screen.getByLabelText('Render note'), 'Keep the cadence.');

    fetchMock.mockResolvedValueOnce(
      ok({ changed: ['subtitle', 'placeholders'], mintedVersion: null })
    );
    await user.click(screen.getByRole('button', { name: 'Save' }));

    expect(sent().url).toBe(contentItemEndpoint('documents', 'document', 'doc-ack'));
    expect(sent().method).toBe('PUT');
    expect(sent().body).toMatchObject({
      revision: 3,
      subtitle: null,
      renderStyle: null,
      renderNote: 'One paragraph per line.Keep the cadence.',
      surface: 'first_run_welcome_v2',
      placeholders: ['first_name', 'last_name'],
      version: '1.1',
    });
  });

  it('sends the category chosen through the select, not the one the document loaded with', async () => {
    const user = userEvent.setup();
    await openDoc(user, 'The Initiation');

    await user.click(screen.getByRole('combobox', { name: 'Category' }));
    await user.click(await screen.findByRole('option', { name: 'Legal' }));

    fetchMock.mockResolvedValueOnce(ok({ changed: ['category'], mintedVersion: null }));
    await user.click(screen.getByRole('button', { name: 'Save' }));

    expect(sent().body).toMatchObject({ category: 'legal' });
  });

  it('says plainly when nothing had changed', async () => {
    const user = userEvent.setup();
    await openDoc(user, 'The Initiation');

    fetchMock.mockResolvedValueOnce(ok({ changed: [], mintedVersion: null }));
    await user.click(screen.getByRole('button', { name: 'Save' }));

    expect(
      await screen.findByText('Nothing in "The Initiation" had changed. Nothing was saved.')
    ).toBeInTheDocument();
  });

  it('names the minted version when the save changed acknowledged words', async () => {
    const user = userEvent.setup();
    await openDoc(user, 'The Initiation');
    await user.type(editor('The Initiation').getByLabelText('Title'), ' — revised');

    fetchMock.mockResolvedValueOnce(ok({ changed: ['title'], mintedVersion: '1.2' }));
    await user.click(screen.getByRole('button', { name: 'Save' }));

    expect(
      await screen.findByText(
        'Saved "The Initiation". It is now version 1.2, and every member will be asked to agree to it again.'
      )
    ).toBeInTheDocument();
    expect(mockRefresh).toHaveBeenCalledTimes(1);
  });

  it('says only "Saved" when nothing was minted', async () => {
    const user = userEvent.setup();
    await openDoc(user, 'The Mission');
    await user.type(editor('The Mission').getByLabelText('Title'), ' — revised');

    fetchMock.mockResolvedValueOnce(ok({ changed: ['title'], mintedVersion: null }));
    await user.click(screen.getByRole('button', { name: 'Save' }));

    expect(await screen.findByText('Saved "The Mission".')).toBeInTheDocument();
  });

  it('shows the route’s stale-revision refusal verbatim, and does not refresh', async () => {
    const user = userEvent.setup();
    await openDoc(user, 'The Initiation');

    fetchMock.mockResolvedValueOnce(
      refused(
        409,
        '"The Initiation" was changed by someone else since you opened it (revision 3, now 4). Reload and read it again before saving.'
      )
    );
    await user.click(screen.getByRole('button', { name: 'Save' }));

    expect(await screen.findByRole('alert')).toHaveTextContent(/revision 3, now 4/);
    expect(mockRefresh).not.toHaveBeenCalled();
  });
});

describe('discarding a draft', () => {
  it('reverts every field to the loaded document and sends nothing', async () => {
    const user = userEvent.setup();
    await openDoc(user, 'The Initiation');
    const title = editor('The Initiation').getByLabelText('Title');

    await user.clear(title);
    await user.type(title, 'A different title entirely');
    expect(title).toHaveValue('A different title entirely');

    await user.click(screen.getByRole('button', { name: 'Discard changes' }));

    expect(title).toHaveValue('The Initiation');
    expect(fetchMock).not.toHaveBeenCalled();
  });
});

describe('the acknowledgement warning', () => {
  it('appears once the words change, naming the version it will mint, and disappears if the version is set by hand', async () => {
    const user = userEvent.setup();
    await openDoc(user, 'The Initiation');

    expect(screen.queryByRole('status', { name: /Saving changes words/ })).toBeNull();
    expect(screen.queryByText(/Saving changes words people have agreed to/)).toBeNull();

    const initiation = editor('The Initiation');
    await user.type(initiation.getByLabelText('Title'), ' — revised');

    const warning = await screen.findByText(/Saving changes words people have agreed to/);
    expect(warning).toHaveTextContent('1.2');

    // Naming a version of their own takes the warning back down.
    const version = initiation.getByLabelText('Version');
    await user.clear(version);
    await user.type(version, '3.0');

    expect(screen.queryByText(/Saving changes words people have agreed to/)).toBeNull();
  });

  it('never appears for a document that requires no acknowledgement, however much changes', async () => {
    const user = userEvent.setup();
    await openDoc(user, 'The Mission');

    await user.type(editor('The Mission').getByLabelText('Title'), ' — revised');

    expect(screen.queryByText(/Saving changes words people have agreed to/)).toBeNull();
  });

  it('does not appear for an unchanged document, even one that requires acknowledgement', async () => {
    const user = userEvent.setup();
    await openDoc(user, 'The Initiation');

    expect(screen.queryByText(/Saving changes words people have agreed to/)).toBeNull();
  });
});

describe('locked sections', () => {
  it('names every locked section and its readers, and badges the block that carries one', async () => {
    const user = userEvent.setup();
    await openDoc(user, 'The Initiation');

    expect(screen.getByText(/welcome \(the welcome email\)/)).toBeInTheDocument();
    expect(blockRow(0).getByText('in use')).toBeInTheDocument();
    expect(blockRow(1).queryByText('in use')).toBeNull();
  });

  it('says nothing about locked sections for a document with none', async () => {
    const user = userEvent.setup();
    await openDoc(user, 'The Mission');

    expect(screen.queryByText(/Sections a page or email selects by name/)).toBeNull();
    expect(blockRow(0).queryByText('in use')).toBeNull();
  });
});

describe('the blocks editor', () => {
  it('adds a paragraph below the current block, inheriting its section', async () => {
    const user = userEvent.setup();
    await openDoc(user, 'The Initiation');

    expect(
      screen.getByText('(2) — one paragraph per block keeps each line on its own.')
    ).toBeInTheDocument();
    await user.click(blockRow(0).getByRole('button', { name: 'Add a block below' }));

    expect(
      screen.getByText('(3) — one paragraph per block keeps each line on its own.')
    ).toBeInTheDocument();
    expect(blockRow(1).getByRole('combobox', { name: 'Block 2 type' })).toHaveTextContent(
      'Paragraph'
    );
    expect(blockRow(1).getByLabelText('Block 2 section key')).toHaveValue('welcome');
    // The original second block shifted down to become the third.
    expect(blockRow(2).getByLabelText('Block 3 text')).toHaveValue('Second line.');
  });

  it('removes a block, but never the last one', async () => {
    const user = userEvent.setup();
    const unmountMission = await openDoc(user, 'The Mission');
    expect(blockRow(0).getByRole('button', { name: 'Remove this block' })).toBeDisabled();
    unmountMission();

    await openDoc(user, 'The Initiation');
    await user.click(blockRow(1).getByRole('button', { name: 'Remove this block' }));

    expect(
      screen.getByText('(1) — one paragraph per block keeps each line on its own.')
    ).toBeInTheDocument();
    expect(blockRow(0).getByLabelText('Block 1 text')).toHaveValue('First line.');
  });

  it('moves a block up or down, disabled at each boundary', async () => {
    const user = userEvent.setup();
    await openDoc(user, 'The Initiation');

    expect(blockRow(0).getByRole('button', { name: 'Move up' })).toBeDisabled();
    expect(blockRow(1).getByRole('button', { name: 'Move down' })).toBeDisabled();

    await user.click(blockRow(0).getByRole('button', { name: 'Move down' }));

    expect(blockRow(0).getByLabelText('Block 1 text')).toHaveValue('Second line.');
    expect(blockRow(1).getByLabelText('Block 2 text')).toHaveValue('First line.');

    // And back again, with "Move up" on the block that is now first.
    await user.click(blockRow(1).getByRole('button', { name: 'Move up' }));

    expect(blockRow(0).getByLabelText('Block 1 text')).toHaveValue('First line.');
    expect(blockRow(1).getByLabelText('Block 2 text')).toHaveValue('Second line.');
  });

  it('edits a block’s own text directly', async () => {
    const user = userEvent.setup();
    await openDoc(user, 'The Initiation');

    const text = blockRow(1).getByLabelText('Block 2 text');
    await user.type(text, ' Appended.');

    expect(text).toHaveValue('Second line. Appended.');
  });

  it('retypes a block through paragraph → heading → list → paragraph, keeping the words', async () => {
    const user = userEvent.setup();
    await openDoc(user, 'The Initiation');

    // paragraph -> heading
    await user.click(blockRow(0).getByRole('combobox', { name: 'Block 1 type' }));
    await user.click(await screen.findByRole('option', { name: 'Heading' }));
    expect(blockRow(0).getByLabelText('Block 1 text')).toHaveValue('First line.');
    expect(blockRow(0).getByLabelText('Block 1 heading level')).toHaveValue(2);

    // heading -> list: the single line becomes a single item.
    await user.click(blockRow(0).getByRole('combobox', { name: 'Block 1 type' }));
    await user.click(await screen.findByRole('option', { name: 'List' }));
    expect(blockRow(0).getByLabelText('Block 1 items, one per line')).toHaveValue('First line.');
    expect(blockRow(0).queryByLabelText('Block 1 heading level')).toBeNull();

    // list -> paragraph: items rejoin as the text.
    await user.click(blockRow(0).getByRole('combobox', { name: 'Block 1 type' }));
    await user.click(await screen.findByRole('option', { name: 'Paragraph' }));
    expect(blockRow(0).getByLabelText('Block 1 text')).toHaveValue('First line.');
  });

  it('splits a multi-line list into items, and back into one joined paragraph', async () => {
    const user = userEvent.setup();
    await openDoc(user, 'The Initiation');

    await user.click(blockRow(0).getByRole('combobox', { name: 'Block 1 type' }));
    await user.click(await screen.findByRole('option', { name: 'List' }));
    const items = blockRow(0).getByLabelText('Block 1 items, one per line');
    await user.clear(items);
    await user.type(items, 'One{enter}Two{enter}Three');

    await user.click(blockRow(0).getByRole('combobox', { name: 'Block 1 type' }));
    await user.click(await screen.findByRole('option', { name: 'Paragraph' }));

    expect(blockRow(0).getByLabelText('Block 1 text')).toHaveValue('One\nTwo\nThree');
  });

  it('edits a section key, and saves the block with it', async () => {
    const user = userEvent.setup();
    await openDoc(user, 'The Initiation');

    const section = blockRow(1).getByLabelText('Block 2 section key');
    await user.type(section, 'closing');

    fetchMock.mockResolvedValueOnce(ok({ changed: ['blocks'], mintedVersion: '1.2' }));
    await user.click(screen.getByRole('button', { name: 'Save' }));

    const body = sent().body as { blocks: { section: string | null }[] };
    expect(body.blocks[1]).toMatchObject({ section: 'closing' });
  });

  it('sets a heading level from the number field', async () => {
    const user = userEvent.setup();
    await openDoc(user, 'The Initiation');
    await user.click(blockRow(0).getByRole('combobox', { name: 'Block 1 type' }));
    await user.click(await screen.findByRole('option', { name: 'Heading' }));

    // `fireEvent`, not `user.clear` + `user.type`: the field falls back to 1 on
    // an empty value (`Number('') || 1`), so two separate keystroke-driven
    // events would land on "14", not "4" — this sets it in one change, as a
    // single paste or a spinner click would.
    const level = blockRow(0).getByLabelText('Block 1 heading level');
    fireEvent.change(level, { target: { value: '4' } });

    fetchMock.mockResolvedValueOnce(ok({ changed: ['blocks'], mintedVersion: '1.2' }));
    await user.click(screen.getByRole('button', { name: 'Save' }));

    const body = sent().body as { blocks: { level?: number }[] };
    expect(body.blocks[0].level).toBe(4);
  });
});

describe('the document history button', () => {
  it('is wired to this document’s own history endpoint', async () => {
    const user = userEvent.setup();
    await openDoc(user, 'The Initiation');

    fetchMock.mockResolvedValueOnce(ok({ revisions: [] }));
    await user.click(screen.getByRole('button', { name: 'History' }));

    expect(sent().url).toBe('/api/v1/admin/app/content/documents/document/doc-ack/history');
  });
});

describe('who reads a document', () => {
  it('names the readers for a document something else renders', async () => {
    const user = userEvent.setup();
    await openDoc(user, 'The Mission');

    expect(screen.getByText(/the mission page \(\/mission\)/)).toBeInTheDocument();
  });

  it('says nothing when nothing reads it yet', async () => {
    const user = userEvent.setup();
    await openDoc(user, 'The Initiation');

    expect(
      screen.queryByText(/This document cannot be deleted, only edited, because these show it:/)
    ).toBeNull();
  });
});

describe('a network failure while saving', () => {
  it('is reported honestly, distinct from a route refusal', async () => {
    const user = userEvent.setup();
    await openDoc(user, 'The Initiation');

    fetchMock.mockRejectedValueOnce(new TypeError('fetch failed'));
    await user.click(screen.getByRole('button', { name: 'Save' }));

    expect(await screen.findByRole('alert')).toHaveTextContent(
      'The request did not reach the server. Nothing was changed.'
    );
  });
});
