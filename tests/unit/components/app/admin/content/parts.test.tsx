// @vitest-environment happy-dom

/**
 * The pieces every content panel shares (f-content-seeds t-91): a labelled
 * field, the notice line, the readers note, the history dialog with restore,
 * and the export/import panel (including the plan it renders).
 *
 * `fetch` is mocked at the boundary — the same shape as
 * `tests/unit/components/app/admin/slot-definitions.test.tsx`, which these
 * pieces were deliberately modelled on.
 *
 * @see components/app/admin/content/parts.tsx
 */

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { render, screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';

import {
  FieldRow,
  HistoryButton,
  ImportExportPanel,
  NoticeLine,
  ReadersNote,
} from '@/components/app/admin/content/parts';
import {
  contentExportEndpoint,
  contentHistoryEndpoint,
  contentImportEndpoint,
  contentImportPreviewEndpoint,
  contentRestoreEndpoint,
} from '@/lib/app/content/admin/endpoint';
import type { ContentImportPlan } from '@/lib/app/content/admin/shared';

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

let fetchMock: ReturnType<typeof vi.fn>;

beforeEach(() => {
  fetchMock = vi.fn();
  vi.stubGlobal('fetch', fetchMock);
});

afterEach(() => {
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
});

// ─── FieldRow ───────────────────────────────────────────────────────────────

describe('FieldRow', () => {
  it('labels its child and offers the help text through the ⓘ popover', () => {
    render(
      <FieldRow id="title" label="Title" help="What the title is for.">
        <input id="title" />
      </FieldRow>
    );

    const input = screen.getByLabelText('Title');
    expect(input).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'More information' })).toBeInTheDocument();
  });
});

// ─── NoticeLine ─────────────────────────────────────────────────────────────

describe('NoticeLine', () => {
  it('renders nothing when there is no notice', () => {
    const { container } = render(<NoticeLine notice={null} />);
    expect(container).toBeEmptyDOMElement();
  });

  it('reads as an alert, in destructive styling, for an error', () => {
    render(<NoticeLine notice={{ tone: 'error', text: 'It broke.' }} />);
    const alert = screen.getByRole('alert');
    expect(alert).toHaveTextContent('It broke.');
    expect(alert.className).toContain('text-destructive');
  });

  it('reads as a status, in amber, for a warning', () => {
    render(<NoticeLine notice={{ tone: 'warn', text: 'Careful.' }} />);
    const status = screen.getByRole('status');
    expect(status).toHaveTextContent('Careful.');
    expect(status.className).toContain('amber');
  });

  it('reads as a status, in emerald, for an ok', () => {
    render(<NoticeLine notice={{ tone: 'ok', text: 'Saved.' }} />);
    const status = screen.getByRole('status');
    expect(status).toHaveTextContent('Saved.');
    expect(status.className).toContain('emerald');
  });
});

// ─── ReadersNote ────────────────────────────────────────────────────────────

describe('ReadersNote', () => {
  it('renders nothing when nothing reads the item', () => {
    const { container } = render(<ReadersNote readers={[]} lead="Cannot be deleted:" />);
    expect(container).toBeEmptyDOMElement();
  });

  it('names every reader, joined by semicolons, after the lead', () => {
    render(
      <ReadersNote
        readers={['the home page (/)', 'the welcome email']}
        lead="This document cannot be deleted, only edited, because these show it:"
      />
    );
    expect(
      screen.getByText(
        'This document cannot be deleted, only edited, because these show it: the home page (/); the welcome email.'
      )
    ).toBeInTheDocument();
  });
});

// ─── HistoryButton ──────────────────────────────────────────────────────────

describe('HistoryButton', () => {
  const REVISIONS = [
    {
      revision: 2,
      snapshot: { title: 'Newer wording' },
      changedFields: ['title'],
      origin: 'admin',
      editorEmail: 'admin@example.com',
      changedAt: '2026-09-10T00:00:00.000Z',
    },
    {
      revision: 1,
      snapshot: { title: 'Original wording' },
      changedFields: ['title', 'blocks'],
      origin: 'seed',
      editorEmail: null,
      changedAt: '2026-09-01T00:00:00.000Z',
    },
  ];

  function renderIt(
    props: Partial<Extract<Parameters<typeof HistoryButton>[0], { collection: string }>> = {}
  ) {
    const onRestored = vi.fn();
    render(
      <HistoryButton
        collection="documents"
        entity="document"
        id="doc-1"
        label='"The Initiation"'
        revisionRead={2}
        onRestored={onRestored}
        {...props}
      />
    );
    return { onRestored };
  }

  it('fetches the history for this exact item on demand, not before', async () => {
    const user = userEvent.setup();
    renderIt();
    expect(fetchMock).not.toHaveBeenCalled();

    fetchMock.mockResolvedValueOnce(ok({ revisions: REVISIONS }));
    await user.click(screen.getByRole('button', { name: 'History' }));

    expect(sent().url).toBe(contentHistoryEndpoint('documents', 'document', 'doc-1'));
    expect(sent().method).toBe('GET');
    expect(await screen.findByText('Revision 2')).toBeInTheDocument();
  });

  it('shows "seed" for a seeded row and the editor email otherwise, newest first', async () => {
    const user = userEvent.setup();
    fetchMock.mockResolvedValueOnce(ok({ revisions: REVISIONS }));
    renderIt();

    await user.click(screen.getByRole('button', { name: 'History' }));

    const dialog = await screen.findByRole('dialog');
    const items = within(dialog).getAllByRole('listitem');
    expect(items).toHaveLength(2);
    expect(within(items[0]).getByText('admin@example.com')).toBeInTheDocument();
    expect(within(items[1]).getByText('seed')).toBeInTheDocument();
    expect(within(items[1]).getByText(/Changed: title, blocks/)).toBeInTheDocument();
  });

  it('falls back to "an admin whose account is gone" for an admin edit with no email', async () => {
    const user = userEvent.setup();
    fetchMock.mockResolvedValueOnce(
      ok({
        revisions: [{ ...REVISIONS[0], editorEmail: null }],
      })
    );
    renderIt();

    await user.click(screen.getByRole('button', { name: 'History' }));

    expect(await screen.findByText('an admin whose account is gone')).toBeInTheDocument();
  });

  it('offers no Restore for the currently-read revision, but does for the others', async () => {
    const user = userEvent.setup();
    fetchMock.mockResolvedValueOnce(ok({ revisions: REVISIONS }));
    renderIt({ revisionRead: 2 });

    await user.click(screen.getByRole('button', { name: 'History' }));
    const dialog = await screen.findByRole('dialog');
    const items = within(dialog).getAllByRole('listitem');

    expect(within(items[0]).queryByRole('button', { name: 'Restore' })).toBeNull();
    expect(within(items[1]).getByRole('button', { name: 'Restore' })).toBeInTheDocument();
  });

  it('shows and hides a revision’s snapshot on demand', async () => {
    const user = userEvent.setup();
    fetchMock.mockResolvedValueOnce(ok({ revisions: REVISIONS }));
    renderIt();
    await user.click(screen.getByRole('button', { name: 'History' }));
    const dialog = await screen.findByRole('dialog');
    const first = within(dialog).getAllByRole('listitem')[0];

    expect(within(first).queryByText(/"title": "Newer wording"/)).toBeNull();
    await user.click(within(first).getByRole('button', { name: 'Show this version' }));
    expect(within(first).getByText(/"title": "Newer wording"/)).toBeInTheDocument();

    await user.click(within(first).getByRole('button', { name: 'Hide this version' }));
    expect(within(first).queryByText(/"title": "Newer wording"/)).toBeNull();
  });

  it('closes the dialog and reports plainly when a restore changed nothing', async () => {
    const user = userEvent.setup();
    fetchMock.mockResolvedValueOnce(ok({ revisions: REVISIONS }));
    const { onRestored } = renderIt({ revisionRead: 2 });
    await user.click(screen.getByRole('button', { name: 'History' }));
    const dialog = await screen.findByRole('dialog');

    fetchMock.mockResolvedValueOnce(ok({ changed: [], mintedVersion: null }));
    await user.click(within(dialog).getByRole('button', { name: 'Restore' }));

    expect(sent(1).url).toBe(contentRestoreEndpoint('documents', 'document', 'doc-1'));
    expect(sent(1).method).toBe('POST');
    expect(sent(1).body).toEqual({ revision: 1, revisionRead: 2 });
    expect(onRestored).toHaveBeenCalledWith(
      'Revision 1 of "The Initiation" is what it already says. Nothing was saved.'
    );
    expect(screen.queryByRole('dialog')).toBeNull();
  });

  it('says a restore minted a new acknowledgement version, when it did', async () => {
    const user = userEvent.setup();
    fetchMock.mockResolvedValueOnce(ok({ revisions: REVISIONS }));
    const { onRestored } = renderIt({
      revisionRead: 2,
      restoreNote: 'Restoring different words asks everyone to agree again, at a new version.',
    });
    await user.click(screen.getByRole('button', { name: 'History' }));
    const dialog = await screen.findByRole('dialog');
    expect(dialog).toHaveTextContent(/asks everyone to agree again/);

    fetchMock.mockResolvedValueOnce(ok({ changed: ['title'], mintedVersion: '1.2' }));
    await user.click(within(dialog).getByRole('button', { name: 'Restore' }));

    expect(onRestored).toHaveBeenCalledWith(
      'Restored "The Initiation" to revision 1, as a new revision. It asks everyone to agree again, at version 1.2.'
    );
  });

  it('says a restore was saved as a new revision, with no acknowledgement note, when nothing minted', async () => {
    const user = userEvent.setup();
    fetchMock.mockResolvedValueOnce(ok({ revisions: REVISIONS }));
    const { onRestored } = renderIt({ revisionRead: 2 });
    await user.click(screen.getByRole('button', { name: 'History' }));
    const dialog = await screen.findByRole('dialog');

    fetchMock.mockResolvedValueOnce(ok({ changed: ['title'], mintedVersion: null }));
    await user.click(within(dialog).getByRole('button', { name: 'Restore' }));

    expect(onRestored).toHaveBeenCalledWith(
      'Restored "The Initiation" to revision 1, as a new revision.'
    );
  });

  it('reports a failed load without hanging the dialog on "Loading…" forever, silently', async () => {
    const user = userEvent.setup();
    fetchMock.mockResolvedValueOnce(refused(500, 'The history could not be read.'));
    renderIt();

    await user.click(screen.getByRole('button', { name: 'History' }));

    expect(await screen.findByRole('alert')).toHaveTextContent('The history could not be read.');
    expect(screen.getByText('Loading…')).toBeInTheDocument();
  });

  it('reports a failed restore and leaves the dialog open, changing nothing', async () => {
    const user = userEvent.setup();
    fetchMock.mockResolvedValueOnce(ok({ revisions: REVISIONS }));
    const { onRestored } = renderIt({ revisionRead: 2 });
    await user.click(screen.getByRole('button', { name: 'History' }));
    const dialog = await screen.findByRole('dialog');

    fetchMock.mockResolvedValueOnce(
      refused(409, '"The Initiation" was changed by someone else since you opened it.')
    );
    await user.click(within(dialog).getByRole('button', { name: 'Restore' }));

    expect(await screen.findByRole('alert')).toHaveTextContent(/changed by someone else/);
    expect(onRestored).not.toHaveBeenCalled();
    expect(screen.getByRole('dialog')).toBeInTheDocument();
  });
});

// ─── ImportExportPanel ──────────────────────────────────────────────────────

describe('ImportExportPanel', () => {
  const EMPTY_PLAN: ContentImportPlan = {
    collection: 'documents',
    sections: [],
    refusals: [],
    writesNothing: true,
  };

  /** A plan that actually changes something — the shape that leaves Apply enabled. */
  const CHANGE_PLAN: ContentImportPlan = {
    collection: 'documents',
    refusals: [],
    writesNothing: false,
    sections: [
      {
        entity: 'document',
        label: 'Documents',
        creates: [{ key: 'new_doc', changedFields: [] }],
        updates: [],
        removals: [],
        removalKind: 'delete',
        unchanged: [],
        skippedRetired: [],
      },
    ],
  };

  function renderPanel(removal?: { note?: string }) {
    const onApplied = vi.fn();
    render(
      <ImportExportPanel
        collection="documents"
        fileName="lelanea_foundational_documents.json"
        what="the documents"
        removal={removal}
        onApplied={onApplied}
      />
    );
    return { onApplied };
  }

  // t-100: an import keeps what a file leaves out; removing is asked for.
  describe('removing what the file leaves out', () => {
    async function choose(user: ReturnType<typeof userEvent.setup>) {
      await user.upload(
        screen.getByLabelText('Choose a file to import'),
        new File(['{"documents":[]}'], 'documents.json', { type: 'application/json' })
      );
    }

    it('is off by default, and ticking it drops the preview and sends it with both calls', async () => {
      const user = userEvent.setup();
      renderPanel({ note: 'A removed document is deleted with its history.' });
      const box = screen.getByRole('checkbox', { name: 'Also remove what the file leaves out' });
      expect(box).not.toBeChecked();
      expect(screen.getByText('A removed document is deleted with its history.')).toBeVisible();
      await choose(user);

      fetchMock.mockResolvedValueOnce(ok({ plan: CHANGE_PLAN }));
      await user.click(screen.getByRole('button', { name: 'Preview import' }));
      expect(sent().body).toEqual({ file: { documents: [] }, removeAbsent: false });
      expect(await screen.findByText('Documents')).toBeInTheDocument();

      // The plan on screen was made without removal, so it cannot be applied now.
      await user.click(box);
      expect(screen.queryByText('Documents')).toBeNull();
      expect(screen.getByRole('button', { name: 'Apply import' })).toBeDisabled();

      fetchMock.mockResolvedValueOnce(ok({ plan: CHANGE_PLAN }));
      await user.click(screen.getByRole('button', { name: 'Preview import' }));
      expect(sent(1).body).toEqual({ file: { documents: [] }, removeAbsent: true });
      expect(await screen.findByText('Documents')).toBeInTheDocument();

      fetchMock.mockResolvedValueOnce(ok({ plan: CHANGE_PLAN }));
      await user.click(screen.getByRole('button', { name: 'Apply import' }));
      expect(sent(2).url).toBe(contentImportEndpoint('documents'));
      expect(sent(2).body).toEqual({ file: { documents: [] }, removeAbsent: true });
    });

    it('has no box where nothing can be removed, and never asks for a removal', async () => {
      const user = userEvent.setup();
      renderPanel();
      expect(screen.queryByRole('checkbox')).toBeNull();
      await choose(user);

      fetchMock.mockResolvedValueOnce(ok({ plan: CHANGE_PLAN }));
      await user.click(screen.getByRole('button', { name: 'Preview import' }));
      expect(sent().body).toEqual({ file: { documents: [] }, removeAbsent: false });
    });

    it('lists what the file leaves out as kept', async () => {
      const user = userEvent.setup();
      renderPanel({});
      await choose(user);
      fetchMock.mockResolvedValueOnce(
        ok({
          plan: {
            ...CHANGE_PLAN,
            sections: [{ ...CHANGE_PLAN.sections[0], kept: ['the_mission'] }],
          },
        })
      );
      await user.click(screen.getByRole('button', { name: 'Preview import' }));

      expect(await screen.findByText(/Kept, though the file leaves them out/)).toHaveTextContent(
        'the_mission'
      );
    });
  });

  it('fetches the export and hands it to the browser under the server-given name', async () => {
    const user = userEvent.setup();
    renderPanel();
    fetchMock.mockResolvedValueOnce(
      new Response('{"documents":[]}', {
        status: 200,
        headers: {
          'content-disposition': 'attachment; filename="lelanea_foundational_documents.json"',
        },
      })
    );
    const clicked: { href: string; download: string }[] = [];
    const realClick = HTMLAnchorElement.prototype.click;
    HTMLAnchorElement.prototype.click = function (this: HTMLAnchorElement) {
      clicked.push({ href: this.href, download: this.download });
    };
    try {
      await user.click(screen.getByRole('button', { name: 'Export the documents' }));
    } finally {
      HTMLAnchorElement.prototype.click = realClick;
    }

    expect(sent().url).toBe(contentExportEndpoint('documents'));
    expect(clicked).toHaveLength(1);
    expect(clicked[0].download).toBe('lelanea_foundational_documents.json');
    expect(screen.queryByRole('alert')).toBeNull();
  });

  it('shows an export refusal on the page rather than downloading the error body', async () => {
    const user = userEvent.setup();
    renderPanel();
    fetchMock.mockResolvedValueOnce(
      refused(409, 'The stored documents cannot be written as a file: bad shape.')
    );

    await user.click(screen.getByRole('button', { name: 'Export the documents' }));

    expect(await screen.findByRole('alert')).toHaveTextContent(/bad shape/);
  });

  it('cannot apply until a preview has been read', async () => {
    const user = userEvent.setup();
    renderPanel();
    const input = screen.getByLabelText('Choose a file to import');
    const file = new File(['{"documents":[]}'], 'documents.json', { type: 'application/json' });

    expect(screen.getByRole('button', { name: 'Apply import' })).toBeDisabled();
    expect(screen.getByRole('button', { name: 'Preview import' })).toBeDisabled();

    await user.upload(input, file);
    expect(screen.getByRole('button', { name: 'Preview import' })).toBeEnabled();

    fetchMock.mockResolvedValueOnce(ok({ plan: CHANGE_PLAN }));
    await user.click(screen.getByRole('button', { name: 'Preview import' }));

    expect(sent().url).toBe(contentImportPreviewEndpoint('documents'));
    expect(sent().method).toBe('POST');
    expect(sent().body).toEqual({ file: { documents: [] }, removeAbsent: false });
    expect(await screen.findByText('Documents')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Apply import' })).toBeEnabled();
  });

  it('leaves Apply disabled for a plan that changes nothing, even after a successful preview', async () => {
    // `writesNothing` gates Apply too, not just `refusals` — applying an import
    // that would write nothing is disabled rather than a wasted round trip.
    const user = userEvent.setup();
    renderPanel();
    const input = screen.getByLabelText('Choose a file to import');
    await user.upload(
      input,
      new File(['{"documents":[]}'], 'documents.json', { type: 'application/json' })
    );

    fetchMock.mockResolvedValueOnce(ok({ plan: EMPTY_PLAN }));
    await user.click(screen.getByRole('button', { name: 'Preview import' }));

    expect(await screen.findByText(/matches what is stored/)).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Apply import' })).toBeDisabled();
  });

  it('refuses text that is not JSON without troubling the server', async () => {
    const user = userEvent.setup();
    renderPanel();
    const input = screen.getByLabelText('Choose a file to import');
    const file = new File(['not json'], 'bad.json', { type: 'application/json' });
    await user.upload(input, file);

    await user.click(screen.getByRole('button', { name: 'Preview import' }));

    expect(await screen.findByRole('alert')).toHaveTextContent(/not valid JSON/);
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it('shows every planned change, grouped by entity, with the right removal word', async () => {
    const user = userEvent.setup();
    renderPanel();
    const input = screen.getByLabelText('Choose a file to import');
    await user.upload(
      input,
      new File(['{"documents":[]}'], 'documents.json', { type: 'application/json' })
    );

    const plan: ContentImportPlan = {
      collection: 'documents',
      refusals: [],
      writesNothing: false,
      sections: [
        {
          entity: 'document',
          label: 'Documents',
          creates: [{ key: 'new_doc', changedFields: [] }],
          updates: [{ key: 'the_initiation', changedFields: ['title', 'blocks'] }],
          removals: [{ key: 'old_doc', changedFields: [] }],
          removalKind: 'delete',
          unchanged: ['unchanged_one', 'unchanged_two'],
          skippedRetired: [],
        },
      ],
    };
    fetchMock.mockResolvedValueOnce(ok({ plan }));
    await user.click(screen.getByRole('button', { name: 'Preview import' }));

    expect(await screen.findByText('Documents')).toBeInTheDocument();
    expect(screen.getByText('new_doc').closest('li')).toHaveTextContent('Add new_doc');
    expect(screen.getByText('the_initiation').closest('li')).toHaveTextContent(
      'Change the_initiation: title, blocks'
    );
    expect(screen.getByText('old_doc').closest('li')).toHaveTextContent('Delete old_doc');
    expect(screen.getByText('2 unchanged')).toBeInTheDocument();
  });

  it('says "Retire" instead of "Delete" when the section is retire-kind, and lists what would be left retired', async () => {
    const user = userEvent.setup();
    renderPanel();
    const input = screen.getByLabelText('Choose a file to import');
    await user.upload(
      input,
      new File(['{"resources":[]}'], 'resources.json', { type: 'application/json' })
    );

    const plan: ContentImportPlan = {
      collection: 'documents',
      refusals: [],
      writesNothing: false,
      sections: [
        {
          entity: 'resource',
          label: 'Resources',
          creates: [],
          updates: [],
          removals: [{ key: 'old_resource', changedFields: [] }],
          removalKind: 'retire',
          unchanged: [],
          skippedRetired: ['already_retired'],
        },
      ],
    };
    fetchMock.mockResolvedValueOnce(ok({ plan }));
    await user.click(screen.getByRole('button', { name: 'Preview import' }));

    expect(screen.getByText('old_resource').closest('li')).toHaveTextContent('Retire old_resource');
    expect(screen.getByText(/Left retired \(a file cannot bring one back\):/)).toBeInTheDocument();
    expect(screen.getByText('already_retired')).toBeInTheDocument();
  });

  it('refuses to say the file can be applied when the plan carries refusals', async () => {
    const user = userEvent.setup();
    renderPanel();
    const input = screen.getByLabelText('Choose a file to import');
    await user.upload(
      input,
      new File(['{"documents":[]}'], 'documents.json', { type: 'application/json' })
    );

    const plan: ContentImportPlan = {
      collection: 'documents',
      writesNothing: false,
      refusals: ['the_initiation is read by the home page and cannot be removed'],
      sections: [],
    };
    fetchMock.mockResolvedValueOnce(ok({ plan }));
    await user.click(screen.getByRole('button', { name: 'Preview import' }));

    const alert = await screen.findByRole('alert');
    expect(alert).toHaveTextContent('This file cannot be applied:');
    expect(alert).toHaveTextContent(/cannot be removed/);
    expect(screen.getByRole('button', { name: 'Apply import' })).toBeDisabled();
  });

  it('takes the plan back down when the file changes, so Apply cannot run against stale text', async () => {
    const user = userEvent.setup();
    renderPanel();
    const input = screen.getByLabelText('Choose a file to import');
    await user.upload(
      input,
      new File(['{"documents":[]}'], 'documents.json', { type: 'application/json' })
    );
    fetchMock.mockResolvedValueOnce(ok({ plan: EMPTY_PLAN }));
    await user.click(screen.getByRole('button', { name: 'Preview import' }));
    await screen.findByText(/matches what is stored/);

    await user.upload(
      input,
      new File(['{"documents":[1]}'], 'documents2.json', { type: 'application/json' })
    );

    expect(screen.queryByText(/matches what is stored/)).toBeNull();
    expect(screen.getByRole('button', { name: 'Apply import' })).toBeDisabled();
  });

  it('applies, clears the file, and reports what was actually imported', async () => {
    const user = userEvent.setup();
    const { onApplied } = renderPanel();
    const input = screen.getByLabelText('Choose a file to import');
    await user.upload(
      input,
      new File(['{"documents":[]}'], 'documents.json', { type: 'application/json' })
    );
    fetchMock.mockResolvedValueOnce(ok({ plan: CHANGE_PLAN }));
    await user.click(screen.getByRole('button', { name: 'Preview import' }));
    await screen.findByText('Documents');

    fetchMock.mockResolvedValueOnce(ok({ plan: CHANGE_PLAN }));
    await user.click(screen.getByRole('button', { name: 'Apply import' }));

    expect(sent(1).url).toBe(contentImportEndpoint('documents'));
    expect(sent(1).method).toBe('POST');
    expect(onApplied).toHaveBeenCalledWith(
      "Imported the documents. Every change is in each item's history, as your edit."
    );
    // The panel resets: no plan shown, and Apply disabled again.
    expect(screen.queryByText('Documents')).toBeNull();
    expect(screen.getByRole('button', { name: 'Apply import' })).toBeDisabled();
  });

  it('says nothing was written when the apply itself found no changes left to make', async () => {
    // A race: the preview showed a real change (which is what leaves Apply
    // clickable at all — `writesNothing` disables the button, so an apply
    // whose OWN plan is empty is only reachable when someone else already
    // applied the same file in between).
    const user = userEvent.setup();
    const { onApplied } = renderPanel();
    const input = screen.getByLabelText('Choose a file to import');
    await user.upload(
      input,
      new File(['{"documents":[]}'], 'documents.json', { type: 'application/json' })
    );
    fetchMock.mockResolvedValueOnce(ok({ plan: CHANGE_PLAN }));
    await user.click(screen.getByRole('button', { name: 'Preview import' }));
    await screen.findByText('Documents');

    fetchMock.mockResolvedValueOnce(ok({ plan: EMPTY_PLAN }));
    await user.click(screen.getByRole('button', { name: 'Apply import' }));

    expect(onApplied).toHaveBeenCalledWith('The file matched what is stored. Nothing was written.');
  });

  it('reports a failed apply and keeps the previewed plan on screen', async () => {
    const user = userEvent.setup();
    const { onApplied } = renderPanel();
    const input = screen.getByLabelText('Choose a file to import');
    await user.upload(
      input,
      new File(['{"documents":[]}'], 'documents.json', { type: 'application/json' })
    );
    fetchMock.mockResolvedValueOnce(ok({ plan: CHANGE_PLAN }));
    await user.click(screen.getByRole('button', { name: 'Preview import' }));
    await screen.findByText('Documents');

    fetchMock.mockResolvedValueOnce(refused(500, 'The documents could not be imported.'));
    await user.click(screen.getByRole('button', { name: 'Apply import' }));

    expect(await screen.findByRole('alert')).toHaveTextContent(
      'The documents could not be imported.'
    );
    expect(onApplied).not.toHaveBeenCalled();
    // Not reset — the admin can retry without choosing the file again.
    expect(screen.getByText('Documents')).toBeInTheDocument();
  });

  it('takes the plan back down on a failed preview, same as a changed file', async () => {
    const user = userEvent.setup();
    renderPanel();
    const input = screen.getByLabelText('Choose a file to import');
    await user.upload(
      input,
      new File(['{"documents":[]}'], 'documents.json', { type: 'application/json' })
    );
    fetchMock.mockResolvedValueOnce(ok({ plan: EMPTY_PLAN }));
    await user.click(screen.getByRole('button', { name: 'Preview import' }));
    await screen.findByText(/matches what is stored/);

    fetchMock.mockResolvedValueOnce(refused(400, 'That file could not be reconciled.'));
    await user.click(screen.getByRole('button', { name: 'Preview import' }));

    expect(await screen.findByRole('alert')).toHaveTextContent(
      'That file could not be reconciled.'
    );
    expect(screen.queryByText(/matches what is stored/)).toBeNull();
    expect(screen.getByRole('button', { name: 'Apply import' })).toBeDisabled();
  });

  it('clears the file when none is chosen, disabling preview again', async () => {
    const user = userEvent.setup();
    renderPanel();
    const input = screen.getByLabelText('Choose a file to import');
    await user.upload(
      input,
      new File(['{"documents":[]}'], 'documents.json', { type: 'application/json' })
    );
    expect(screen.getByRole('button', { name: 'Preview import' })).toBeEnabled();

    await user.upload(input, []);

    expect(screen.getByRole('button', { name: 'Preview import' })).toBeDisabled();
  });
});
