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
import { render, screen, within } from '@testing-library/react';
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

/** A block's row — its section divider and its words — by its accessible name. */
function blockRow(index: number): ReturnType<typeof within> {
  return within(screen.getByRole('listitem', { name: `Block ${index + 1}` }));
}

/** Opens a block's ⋮. Its contents render in a portal, so query them on `screen`. */
async function openOptions(user: ReturnType<typeof userEvent.setup>, number: number) {
  await user.click(screen.getByRole('button', { name: `Block ${number} options` }));
}

/** Splits block 1, "First line.", after "First": two blocks in `welcome`. */
async function splitFirstBlock(user: ReturnType<typeof userEvent.setup>) {
  await user.type(blockRow(0).getByLabelText('Block 1 text'), '{Enter}', {
    initialSelectionStart: 5,
    initialSelectionEnd: 5,
  });
}

/** A type button inside an open ⋮. */
function typeButton(number: number, label: 'Paragraph' | 'Heading' | 'List'): HTMLElement {
  return within(screen.getByRole('group', { name: `Block ${number} type` })).getByRole('button', {
    name: label,
  });
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
 * The open document's own editor: the dialog it opens in, named by its title.
 * "Title" and "Version" would be ambiguous against the whole container — the
 * collection meta section carries fields with the same labels.
 */
function editor(title: string): ReturnType<typeof within> {
  return within(screen.getByRole('dialog', { name: title }));
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
  it('opens the editor in a dialog with the loaded fields, and closes it', async () => {
    const user = userEvent.setup();
    render(<DocumentsPanel initialView={VIEW} />);

    expect(screen.queryByRole('dialog')).toBeNull();
    expect(screen.queryByLabelText('Subtitle')).toBeNull();

    await user.click(screen.getByRole('button', { name: 'The Initiation' }));
    const dialog = screen.getByRole('dialog', { name: 'The Initiation' });
    expect(within(dialog).getByLabelText('Subtitle')).toHaveValue('A subtitle.');
    expect(within(dialog).getByRole('button', { name: 'Save' })).toBeInTheDocument();

    await user.click(within(dialog).getByRole('button', { name: 'Close' }));
    expect(screen.queryByRole('dialog')).toBeNull();
  });

  it('keeps an unsaved draft when the dialog is closed and opened again', async () => {
    const user = userEvent.setup();
    render(<DocumentsPanel initialView={VIEW} />);

    await user.click(screen.getByRole('button', { name: 'The Initiation' }));
    await user.clear(editor('The Initiation').getByLabelText('Subtitle'));
    await user.type(editor('The Initiation').getByLabelText('Subtitle'), 'Half-written');
    await user.click(editor('The Initiation').getByRole('button', { name: 'Close' }));

    await user.click(screen.getByRole('button', { name: 'The Initiation' }));
    expect(editor('The Initiation').getByLabelText('Subtitle')).toHaveValue('Half-written');
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
  it('names every locked section and its readers, and badges the section that carries one', async () => {
    const user = userEvent.setup();
    await openDoc(user, 'The Initiation');

    expect(screen.getByText(/welcome \(the welcome email\)/)).toBeInTheDocument();
    // The badge sits on the section's divider, above the block that opens it.
    expect(blockRow(0).getByText('welcome')).toBeInTheDocument();
    expect(blockRow(0).getByText('in use')).toBeInTheDocument();
    expect(blockRow(1).getByText('no section')).toBeInTheDocument();
    expect(blockRow(1).queryByText('in use')).toBeNull();
  });

  it('says nothing about locked sections for a document with none, and draws no dividers', async () => {
    const user = userEvent.setup();
    await openDoc(user, 'The Mission');

    expect(screen.queryByText(/Sections a page or email selects by name/)).toBeNull();
    expect(blockRow(0).queryByText('in use')).toBeNull();
    expect(blockRow(0).queryByText('no section')).toBeNull();
  });
});

describe('the blocks editor: the ⋮ options', () => {
  it('adds a paragraph below the current block, inheriting its section, with the caret in it', async () => {
    const user = userEvent.setup();
    await openDoc(user, 'The Initiation');

    expect(
      screen.getByText('(2) — one paragraph per block keeps each line on its own.')
    ).toBeInTheDocument();
    await openOptions(user, 1);
    await user.click(screen.getByRole('button', { name: 'Add a block below' }));

    expect(
      screen.getByText('(3) — one paragraph per block keeps each line on its own.')
    ).toBeInTheDocument();
    const added = blockRow(1).getByLabelText('Block 2 text');
    expect(added).toHaveValue('');
    expect(added).toHaveFocus();
    // The original second block shifted down to become the third.
    expect(blockRow(2).getByLabelText('Block 3 text')).toHaveValue('Second line.');

    // Same section as block 1, so no section line opens above it.
    expect(blockRow(1).queryByText('no section')).toBeNull();
    expect(blockRow(1).queryByText('welcome')).toBeNull();
    expect(blockRow(2).getByText('no section')).toBeInTheDocument();
  });

  it('removes a block, but never the last one', async () => {
    const user = userEvent.setup();
    const unmountMission = await openDoc(user, 'The Mission');
    await openOptions(user, 1);
    expect(screen.getByRole('button', { name: 'Remove this block' })).toBeDisabled();
    unmountMission();

    await openDoc(user, 'The Initiation');
    await openOptions(user, 2);
    await user.click(screen.getByRole('button', { name: 'Remove this block' }));

    expect(
      screen.getByText('(1) — one paragraph per block keeps each line on its own.')
    ).toBeInTheDocument();
    expect(blockRow(0).getByLabelText('Block 1 text')).toHaveValue('First line.');
  });

  it('moves a block up or down within its section, disabled at each boundary, and focus follows it', async () => {
    const user = userEvent.setup();
    await openDoc(user, 'The Initiation');
    // Two blocks in `welcome`: "First" and " line.".
    await splitFirstBlock(user);

    await openOptions(user, 1);
    expect(screen.getByRole('button', { name: 'Move up' })).toBeDisabled();
    await user.click(screen.getByRole('button', { name: 'Move down' }));

    expect(blockRow(0).getByLabelText('Block 1 text')).toHaveValue(' line.');
    expect(blockRow(1).getByLabelText('Block 2 text')).toHaveValue('First');
    expect(blockRow(1).getByLabelText('Block 2 text')).toHaveFocus();

    await openOptions(user, 3);
    expect(screen.getByRole('button', { name: 'Move down' })).toBeDisabled();
  });

  it('moves a block across a section line into that section, in place, rather than over it', async () => {
    const user = userEvent.setup();
    await openDoc(user, 'The Initiation');
    await splitFirstBlock(user);

    // Block 2 (" line.", welcome) moves down across the line into no section.
    await openOptions(user, 2);
    await user.click(screen.getByRole('button', { name: 'Move down' }));

    expect(blockRow(1).getByLabelText('Block 2 text')).toHaveValue(' line.');
    expect(blockRow(1).getByText('no section')).toBeInTheDocument();

    // And back up again, into `welcome`.
    await openOptions(user, 2);
    await user.click(screen.getByRole('button', { name: 'Move up' }));
    expect(blockRow(1).queryByText('no section')).toBeNull();
    expect(blockRow(2).getByText('no section')).toBeInTheDocument();

    fetchMock.mockResolvedValueOnce(ok({ changed: ['blocks'], mintedVersion: '1.2' }));
    await user.click(screen.getByRole('button', { name: 'Save' }));
    const body = sent().body as { blocks: { section: string | null }[] };
    expect(body.blocks.map((block) => block.section)).toEqual(['welcome', 'welcome', null]);
  });

  it('retypes a block through paragraph → heading → list → paragraph, keeping the words', async () => {
    const user = userEvent.setup();
    await openDoc(user, 'The Initiation');
    await openOptions(user, 1);

    await user.click(typeButton(1, 'Heading'));
    expect(blockRow(0).getByLabelText('Block 1 text')).toHaveValue('First line.');
    expect(
      within(screen.getByRole('group', { name: 'Block 1 heading level' })).getByRole('button', {
        name: 'Level 2',
      })
    ).toHaveAttribute('aria-pressed', 'true');

    // heading -> list: the single line becomes a single item.
    await user.click(typeButton(1, 'List'));
    expect(blockRow(0).getByLabelText('Block 1 item 1')).toHaveValue('First line.');
    expect(screen.queryByRole('group', { name: 'Block 1 heading level' })).toBeNull();

    // list -> paragraph: items rejoin as the text.
    await user.click(typeButton(1, 'Paragraph'));
    expect(blockRow(0).getByLabelText('Block 1 text')).toHaveValue('First line.');
  });

  it('sets a heading level, and saves it', async () => {
    const user = userEvent.setup();
    await openDoc(user, 'The Initiation');
    await openOptions(user, 1);
    await user.click(typeButton(1, 'Heading'));
    await user.click(screen.getByRole('button', { name: 'Level 4' }));

    fetchMock.mockResolvedValueOnce(ok({ changed: ['blocks'], mintedVersion: '1.2' }));
    await user.click(screen.getByRole('button', { name: 'Save' }));

    const body = sent().body as { blocks: { type: string; level?: number }[] };
    expect(body.blocks[0]).toMatchObject({ type: 'heading', level: 4 });
  });
});

describe('the blocks editor: sections', () => {
  it('explains what sections are beside the blocks', async () => {
    const user = userEvent.setup();
    await openDoc(user, 'The Initiation');

    await user.click(screen.getByRole('button', { name: 'About sections' }));

    expect(await screen.findByText(/set when the content was first loaded/)).toBeInTheDocument();
  });

  it('explains a locked section instead of offering a rename', async () => {
    const user = userEvent.setup();
    await openDoc(user, 'The Initiation');

    expect(screen.queryByRole('button', { name: 'Rename section welcome' })).toBeNull();
    await user.click(screen.getByRole('button', { name: 'About section welcome' }));

    expect(await screen.findByText(/is shown by name on the welcome email/)).toBeInTheDocument();
    expect(screen.queryByLabelText('Section name')).toBeNull();
  });

  it('names a passage in no section from its line, as a key, and saves every block in it', async () => {
    const user = userEvent.setup();
    await openDoc(user, 'The Initiation');

    await user.click(screen.getByRole('button', { name: 'Name the passage at block 2' }));
    await user.type(screen.getByLabelText('Section name'), 'Closing words');
    expect(screen.getByText('closing_words')).toBeInTheDocument();
    await user.click(screen.getByRole('button', { name: 'Name it' }));

    expect(blockRow(1).getByText('closing_words')).toBeInTheDocument();

    fetchMock.mockResolvedValueOnce(ok({ changed: ['blocks'], mintedVersion: '1.2' }));
    await user.click(screen.getByRole('button', { name: 'Save' }));
    const body = sent().body as { blocks: { section: string | null }[] };
    expect(body.blocks.map((block) => block.section)).toEqual(['welcome', 'closing_words']);
  });

  it('refuses a name that is not a key, or that another passage already has', async () => {
    const user = userEvent.setup();
    await openDoc(user, 'The Initiation');
    // Runs: welcome · no section · tail.
    await user.type(blockRow(1).getByLabelText('Block 2 text'), '{Enter}Third.');
    await openOptions(user, 3);
    await user.click(screen.getByRole('button', { name: 'Start a new section here' }));
    await user.type(screen.getByLabelText('Section name'), 'tail');
    await user.click(screen.getByRole('button', { name: 'Start section' }));
    expect(blockRow(2).getByText('tail')).toBeInTheDocument();

    await user.click(screen.getByRole('button', { name: 'Rename section tail' }));
    const name = screen.getByLabelText('Section name');
    await user.clear(name);
    await user.type(name, '9lives');
    expect(screen.getByRole('alert')).toHaveTextContent(/starting with a letter/);
    expect(screen.getByRole('button', { name: 'Rename' })).toBeDisabled();

    await user.clear(name);
    await user.type(name, 'welcome');
    expect(screen.getByRole('alert')).toHaveTextContent(/already called "welcome"/);
    expect(screen.getByRole('button', { name: 'Rename' })).toBeDisabled();
  });

  it('lets a passage take the name of the section right beside it, joining the two', async () => {
    const user = userEvent.setup();
    await openDoc(user, 'The Initiation');

    await user.click(screen.getByRole('button', { name: 'Name the passage at block 2' }));
    await user.type(screen.getByLabelText('Section name'), 'welcome');
    expect(screen.queryByRole('alert')).toBeNull();
    await user.click(screen.getByRole('button', { name: 'Name it' }));

    expect(blockRow(1).queryByText('no section')).toBeNull();
  });

  it('starts a new section part-way through a run, taking the rest of the run with it', async () => {
    const user = userEvent.setup();
    await openDoc(user, 'The Initiation');
    await splitFirstBlock(user);
    await user.type(blockRow(1).getByLabelText('Block 2 text'), '{Enter}More.');

    await openOptions(user, 2);
    await user.click(screen.getByRole('button', { name: 'Start a new section here' }));
    await user.type(screen.getByLabelText('Section name'), 'middle{Enter}');

    fetchMock.mockResolvedValueOnce(ok({ changed: ['blocks'], mintedVersion: '1.2' }));
    await user.click(screen.getByRole('button', { name: 'Save' }));
    const body = sent().body as { blocks: { section: string | null }[] };
    expect(body.blocks.map((block) => block.section)).toEqual([
      'welcome',
      'middle',
      'middle',
      null,
    ]);
  });

  it('removes a free section’s name, returning its blocks to no section', async () => {
    const user = userEvent.setup();
    await openDoc(user, 'The Initiation');
    await user.click(screen.getByRole('button', { name: 'Name the passage at block 2' }));
    await user.type(screen.getByLabelText('Section name'), 'closing{Enter}');

    await user.click(screen.getByRole('button', { name: 'Rename section closing' }));
    await user.click(screen.getByRole('button', { name: 'Remove the name' }));

    expect(blockRow(1).getByText('no section')).toBeInTheDocument();
  });
});

describe('the blocks editor: typing in place', () => {
  it('edits a block’s own text directly', async () => {
    const user = userEvent.setup();
    await openDoc(user, 'The Initiation');

    const text = blockRow(1).getByLabelText('Block 2 text');
    await user.type(text, ' Appended.');

    expect(text).toHaveValue('Second line. Appended.');
  });

  it('splits a paragraph at the caret on Enter, into a new paragraph of the same section', async () => {
    const user = userEvent.setup();
    await openDoc(user, 'The Initiation');

    // "First line." — caret after "First".
    await user.type(blockRow(0).getByLabelText('Block 1 text'), '{Enter}', {
      initialSelectionStart: 5,
      initialSelectionEnd: 5,
    });

    expect(blockRow(0).getByLabelText('Block 1 text')).toHaveValue('First');
    const second = blockRow(1).getByLabelText('Block 2 text');
    expect(second).toHaveValue(' line.');
    expect(second).toHaveFocus();
    expect((second as HTMLTextAreaElement).selectionStart).toBe(0);

    fetchMock.mockResolvedValueOnce(ok({ changed: ['blocks'], mintedVersion: '1.2' }));
    await user.click(screen.getByRole('button', { name: 'Save' }));
    const body = sent().body as { blocks: { type: string; text: string; section: string }[] };
    expect(body.blocks.slice(0, 2)).toEqual([
      { type: 'paragraph', text: 'First', section: 'welcome' },
      { type: 'paragraph', text: ' line.', section: 'welcome' },
    ]);
  });

  it('breaks a line inside a paragraph on Shift+Enter, without a new block', async () => {
    const user = userEvent.setup();
    await openDoc(user, 'The Initiation');

    await user.type(blockRow(1).getByLabelText('Block 2 text'), '{Shift>}{Enter}{/Shift}More.');

    expect(blockRow(1).getByLabelText('Block 2 text')).toHaveValue('Second line.\nMore.');
    expect(
      screen.getByText('(2) — one paragraph per block keeps each line on its own.')
    ).toBeInTheDocument();
  });

  it('joins a paragraph to the one above on Backspace at its start, caret at the join', async () => {
    const user = userEvent.setup();
    await openDoc(user, 'The Initiation');
    await user.type(blockRow(0).getByLabelText('Block 1 text'), '{Enter}', {
      initialSelectionStart: 5,
      initialSelectionEnd: 5,
    });

    await user.type(blockRow(1).getByLabelText('Block 2 text'), '{Backspace}', {
      initialSelectionStart: 0,
      initialSelectionEnd: 0,
    });

    const joined = blockRow(0).getByLabelText('Block 1 text');
    expect(joined).toHaveValue('First line.');
    expect(joined).toHaveFocus();
    expect((joined as HTMLTextAreaElement).selectionStart).toBe(5);
    expect(
      screen.getByText('(2) — one paragraph per block keeps each line on its own.')
    ).toBeInTheDocument();
  });

  it('does not join across a section boundary', async () => {
    const user = userEvent.setup();
    await openDoc(user, 'The Initiation');

    // Block 1 is in `welcome`, block 2 in no section.
    await user.type(blockRow(1).getByLabelText('Block 2 text'), '{Backspace}', {
      initialSelectionStart: 0,
      initialSelectionEnd: 0,
    });

    expect(blockRow(0).getByLabelText('Block 1 text')).toHaveValue('First line.');
    expect(blockRow(1).getByLabelText('Block 2 text')).toHaveValue('Second line.');
  });

  it('removes an empty paragraph on Backspace, caret to the end of the one above', async () => {
    const user = userEvent.setup();
    await openDoc(user, 'The Initiation');
    await user.type(blockRow(0).getByLabelText('Block 1 text'), '{Enter}');
    expect(
      screen.getByText('(3) — one paragraph per block keeps each line on its own.')
    ).toBeInTheDocument();

    await user.keyboard('{Backspace}');

    expect(
      screen.getByText('(2) — one paragraph per block keeps each line on its own.')
    ).toBeInTheDocument();
    const above = blockRow(0).getByLabelText('Block 1 text');
    expect(above).toHaveFocus();
    expect((above as HTMLTextAreaElement).selectionStart).toBe('First line.'.length);
  });

  it('adds list items on Enter, and leaves the list for a paragraph on Enter in an empty last item', async () => {
    const user = userEvent.setup();
    await openDoc(user, 'The Initiation');
    await openOptions(user, 1);
    await user.click(typeButton(1, 'List'));

    await user.type(blockRow(0).getByLabelText('Block 1 item 1'), '{Enter}Two{Enter}{Enter}After.');

    expect(blockRow(0).getByLabelText('Block 1 item 1')).toHaveValue('First line.');
    expect(blockRow(0).getByLabelText('Block 1 item 2')).toHaveValue('Two');
    expect(blockRow(0).queryByLabelText('Block 1 item 3')).toBeNull();
    expect(blockRow(1).getByLabelText('Block 2 text')).toHaveValue('After.');

    fetchMock.mockResolvedValueOnce(ok({ changed: ['blocks'], mintedVersion: '1.2' }));
    await user.click(screen.getByRole('button', { name: 'Save' }));
    const body = sent().body as { blocks: unknown[] };
    expect(body.blocks.slice(0, 2)).toEqual([
      { type: 'list', style: 'unordered', items: ['First line.', 'Two'], section: 'welcome' },
      { type: 'paragraph', text: 'After.', section: 'welcome' },
    ]);
  });

  it('joins a list item to the one above on Backspace at its start', async () => {
    const user = userEvent.setup();
    await openDoc(user, 'The Initiation');
    await openOptions(user, 1);
    await user.click(typeButton(1, 'List'));
    await user.type(blockRow(0).getByLabelText('Block 1 item 1'), '{Enter}Two');

    await user.type(blockRow(0).getByLabelText('Block 1 item 2'), '{Backspace}', {
      initialSelectionStart: 0,
      initialSelectionEnd: 0,
    });

    expect(blockRow(0).getByLabelText('Block 1 item 1')).toHaveValue('First line.Two');
    expect(blockRow(0).queryByLabelText('Block 1 item 2')).toBeNull();
  });

  it('turns a list of one empty item back into a paragraph on Enter', async () => {
    const user = userEvent.setup();
    await openDoc(user, 'The Initiation');
    await openOptions(user, 1);
    await user.click(typeButton(1, 'List'));
    const item = blockRow(0).getByLabelText('Block 1 item 1');
    await user.clear(item);

    await user.type(item, '{Enter}');

    expect(blockRow(0).getByLabelText('Block 1 text')).toHaveValue('');
    expect(blockRow(0).getByLabelText('Block 1 text')).toHaveFocus();
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
