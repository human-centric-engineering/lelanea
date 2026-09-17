// @vitest-environment happy-dom

/**
 * One page, two acts — and the uploader on it is the PLATFORM's.
 *
 * The four things this has to prove, none of which is "a component renders":
 *
 *  - the zone on the leaf page IS
 *    `components/admin/orchestration/knowledge/document-upload-zone`, not a copy
 *    of it that would stop tracking upstream the day it was written. A module
 *    mock on the PLATFORM path is what settles that: a leaf rendering its own
 *    copy would never be intercepted, and the stub would never appear;
 *  - what comes with it carries nothing orchestration-specific — no scope
 *    selector, no built-in Agentic Design Patterns panel — asserted against the
 *    REAL component, after establishing it rendered, so the absences are not the
 *    absence of everything (`fp6`);
 *  - a completed upload makes the table go and look again. Without it the row
 *    she just added is the one missing, which reads as the upload having failed;
 *  - a PDF reaches the confirm modal. `onPdfPreview` is an OPTIONAL prop, which
 *    reads as "omit it and PDFs just upload"; omitting it strands every PDF in
 *    `pending_review` while `onUploadComplete` still fires and the table still
 *    gains a row — a state with no remedy on the page that created it (`HB10`).
 *
 * @see components/app/admin/knowledge-workspace.tsx
 */

import type * as React from 'react';
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';

import { KnowledgeWorkspace } from '@/components/app/admin/knowledge-workspace';
import type { DesignatedDocument } from '@/lib/app/voice/designation-admin';
import type { PaginationMeta } from '@/types/api';

/**
 * The stub the platform's upload zone is replaced by, when a test sets one.
 *
 * `null` means the real component renders, which is what the absence assertions
 * need. Swapping the implementation per test rather than per file keeps both
 * halves — "it is the platform's" and "and it brings nothing extra" — asserted
 * against the same import, which is the thing under test.
 */
type ZoneProps = React.ComponentProps<
  typeof import('@/components/admin/orchestration/knowledge/document-upload-zone').DocumentUploadZone
>;

const zone = vi.hoisted(() => ({
  impl: null as null | ((props: Record<string, unknown>) => unknown),
}));

vi.mock(
  '@/components/admin/orchestration/knowledge/document-upload-zone',
  async (importOriginal) => {
    const actual =
      await importOriginal<
        typeof import('@/components/admin/orchestration/knowledge/document-upload-zone')
      >();
    const Actual = actual.DocumentUploadZone;
    return {
      ...actual,
      DocumentUploadZone: (props: ZoneProps) =>
        zone.impl ? zone.impl(props as unknown as Record<string, unknown>) : <Actual {...props} />,
    };
  }
);

const META: PaginationMeta = { page: 1, limit: 25, total: 0, totalPages: 0 };

const fetchMock = vi.fn();

beforeEach(() => {
  vi.clearAllMocks();
  zone.impl = null;
  vi.stubGlobal('fetch', fetchMock);
  fetchMock.mockResolvedValue({
    ok: true,
    status: 200,
    json: async () => ({
      success: true,
      data: [],
      meta: { page: 1, limit: 25, total: 0, totalPages: 0 },
    }),
  });
});

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

describe('the uploader is Sunrise’s, imported', () => {
  it('renders the platform module’s own export, so a copy could not satisfy this', () => {
    zone.impl = () => <button type="button">platform upload zone</button>;

    render(<KnowledgeWorkspace initialDocuments={[]} initialMeta={META} />);

    expect(screen.getByRole('button', { name: 'platform upload zone' })).toBeTruthy();
  });

  it('brings nothing orchestration-specific with it', () => {
    render(<KnowledgeWorkspace initialDocuments={[]} initialMeta={META} />);

    // Establish the real zone is on screen FIRST — every assertion below is an
    // absence, and absences pass for free on a surface that rendered nothing.
    expect(screen.getByText('Drop files here or click to browse')).toBeTruthy();

    // The scope segmented control lives in `knowledge-view.tsx`, a sibling.
    // Choosing a scope is a choice this app has already made: every ingestion
    // path writes `scope: 'app'` and the table filters on exactly that.
    expect(screen.queryByText('Scope')).toBeNull();
    expect(screen.queryByRole('button', { name: 'System' })).toBeNull();

    // The built-in reference panel lives in `manage-tab.tsx`, another sibling.
    // Loading Sunrise's Agentic Design Patterns corpus is an operator act with no
    // bearing on her voice — and a `system`-scoped document is searchable by
    // every agent whatever she says about it, which is why the table refuses to
    // list one at all.
    expect(screen.queryByText(/Agentic Design Patterns/i)).toBeNull();
  });
});

describe('the two acts are joined up', () => {
  it('re-requests the list when an upload completes', async () => {
    zone.impl = (props) => (
      <button type="button" onClick={props.onUploadComplete as () => void}>
        finish upload
      </button>
    );

    const user = userEvent.setup();
    render(<KnowledgeWorkspace initialDocuments={[doc()]} initialMeta={{ ...META, total: 1 }} />);

    // Nothing on mount: the server page already fetched page one.
    expect(fetchMock).not.toHaveBeenCalled();

    await user.click(screen.getByRole('button', { name: 'finish upload' }));

    await waitFor(() => expect(fetchMock).toHaveBeenCalledTimes(1));
    const [url] = fetchMock.mock.calls[0] as [string];
    expect(url).toContain('/designations');
  });

  it('opens the confirm modal for a PDF rather than stranding it in pending_review', async () => {
    zone.impl = (props) => (
      <button
        type="button"
        onClick={() =>
          (props.onPdfPreview as undefined | ((data: unknown) => void))?.({
            document: {
              id: 'pdf-1',
              name: 'A talk transcript',
              fileName: 'talk.pdf',
              status: 'pending_review',
            },
            preview: {
              extractedText: 'The text as the parser read it.',
              title: null,
              author: null,
              sectionCount: 3,
              warnings: [],
              pages: null,
              requiresConfirmation: true,
            },
          })
        }
      >
        upload a pdf
      </button>
    );

    const user = userEvent.setup();
    render(<KnowledgeWorkspace initialDocuments={[]} initialMeta={META} />);

    await user.click(screen.getByRole('button', { name: 'upload a pdf' }));

    expect(await screen.findByRole('dialog')).toBeTruthy();
    expect(screen.getByDisplayValue('The text as the parser read it.')).toBeTruthy();
  });
});
