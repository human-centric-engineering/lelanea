// @vitest-environment happy-dom

/**
 * The training-material page.
 *
 * Its whole job is `getFirstPage()` — fetch, validate, or fall back — and then
 * handing one page to the surface under it. So the branches ARE the page, and
 * the one that matters is the failure: the table's empty state says "No training
 * material yet", which on a broken fetch is a false statement about her corpus
 * on the surface whose only job is to answer for it. The page carries
 * `loadError` so the two are told apart (`HB9`).
 *
 * The other thing worth pinning here is the handover. t-44 replaced the table
 * with `KnowledgeWorkspace` — the uploader plus the table — and every prop the
 * page resolves has to arrive intact, `initialLoadFailed` included. A page that
 * quietly dropped it would show the error banner and the confident empty state
 * at once, which is the defect the flag exists to prevent.
 *
 * No auth test here: the admin guard is `app/admin/layout.tsx`, which has its
 * own, and the route behind this page has its own 401/403 cases.
 *
 * @see app/admin/app/knowledge/page.tsx
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen } from '@testing-library/react';

vi.mock('@/lib/api/server-fetch', () => ({
  serverFetch: vi.fn(),
  parseApiResponse: vi.fn(),
}));

// The workspace and the table both have their own test files; stubbing keeps
// this about what the page resolved and handed on.
vi.mock('@/components/app/admin/knowledge-workspace', () => ({
  KnowledgeWorkspace: (props: {
    initialDocuments: unknown;
    initialMeta: unknown;
    initialLoadFailed?: boolean;
  }) => (
    <div
      data-testid="knowledge-workspace"
      data-documents={JSON.stringify(props.initialDocuments)}
      data-meta={JSON.stringify(props.initialMeta)}
      data-load-failed={String(props.initialLoadFailed ?? false)}
    />
  ),
}));

import KnowledgeDesignationPage from '@/app/admin/app/knowledge/page';
import { serverFetch, parseApiResponse } from '@/lib/api/server-fetch';
import { DESIGNATION_ADMIN_ENDPOINT } from '@/lib/app/voice/endpoint';
import { DESIGNATION_ADMIN_PAGE_SIZE } from '@/lib/validations/app-knowledge-designation';

const DOCUMENT = {
  id: 'doc-1',
  name: 'The long way round',
  fileName: 'long-way-round.md',
  status: 'ready',
  chunkCount: 12,
  createdAt: '2026-09-01T10:00:00.000Z',
  purpose: 'knowledge',
  sensitivity: 'public',
  licensing: null,
  quotable: true,
};

/** What the stubbed workspace received, read back out of the DOM. */
function propPassedDown(
  attribute: 'data-documents' | 'data-meta' | 'data-load-failed'
): unknown {
  const raw = screen.getByTestId('knowledge-workspace').getAttribute(attribute);
  if (raw === null) return undefined;
  return attribute === 'data-load-failed' ? raw : JSON.parse(raw);
}

beforeEach(() => {
  vi.clearAllMocks();
});

describe('KnowledgeDesignationPage', () => {
  it('asks the API for the first page, at the list’s own page size', async () => {
    vi.mocked(serverFetch).mockResolvedValue({ ok: true } as Response);
    vi.mocked(parseApiResponse).mockResolvedValue({
      success: true,
      data: [DOCUMENT],
      meta: { page: 1, limit: DESIGNATION_ADMIN_PAGE_SIZE, total: 1, totalPages: 1 },
    } as never);

    render(await KnowledgeDesignationPage());

    // Through the route, not straight to Prisma — the API-first rule, and the
    // only thing that makes the page proof that the route works.
    expect(serverFetch).toHaveBeenCalledWith(
      `${DESIGNATION_ADMIN_ENDPOINT}?page=1&limit=${DESIGNATION_ADMIN_PAGE_SIZE}`
    );
    expect(propPassedDown('data-documents')).toEqual([DOCUMENT]);
    expect(propPassedDown('data-load-failed')).toBe('false');
    expect(screen.queryByRole('alert')).toBeNull();
  });

  it('renders the workspace, so the uploader and the table arrive together', async () => {
    vi.mocked(serverFetch).mockResolvedValue({ ok: true } as Response);
    vi.mocked(parseApiResponse).mockResolvedValue({
      success: true,
      data: [],
      meta: { page: 1, limit: DESIGNATION_ADMIN_PAGE_SIZE, total: 0, totalPages: 0 },
    } as never);

    render(await KnowledgeDesignationPage());

    // Adding material and designating it are one act. A page that rendered the
    // table alone is the split t-44 exists to close, and it would still pass
    // every assertion above.
    expect(screen.getByTestId('knowledge-workspace')).toBeTruthy();
    expect(screen.queryByText(/AI Orchestration/i)).toBeNull();
  });

  it('says the list did not load when the response is not ok', async () => {
    vi.mocked(serverFetch).mockResolvedValue({ ok: false } as Response);

    render(await KnowledgeDesignationPage());

    expect(screen.getByRole('alert').textContent).toMatch(/did not load/);
    expect(propPassedDown('data-documents')).toEqual([]);
    expect(parseApiResponse).not.toHaveBeenCalled();
  });

  it('tells the surface below that the load failed, not just the reader', async () => {
    vi.mocked(serverFetch).mockResolvedValue({ ok: true } as Response);
    vi.mocked(parseApiResponse).mockResolvedValue({
      success: false,
      error: { code: 'INTERNAL_ERROR', message: 'fail' },
    } as never);

    render(await KnowledgeDesignationPage());

    // Both, and that is the point: the banner alone would leave the table
    // claiming the corpus is empty underneath it (`HB9`).
    expect(screen.getByRole('alert')).toBeTruthy();
    expect(propPassedDown('data-load-failed')).toBe('true');
  });

  it('does not throw when the fetch rejects', async () => {
    // A rejected promise, which is how `fetch` actually fails. Unhandled, this
    // is a 500 on an admin page because one data source is down.
    vi.mocked(serverFetch).mockRejectedValue(new Error('ECONNREFUSED'));

    render(await KnowledgeDesignationPage());

    expect(screen.getByRole('alert')).toBeTruthy();
    expect(propPassedDown('data-meta')).toEqual({
      page: 1,
      limit: DESIGNATION_ADMIN_PAGE_SIZE,
      total: 0,
      totalPages: 0,
    });
  });

  it('falls back to sane pagination when the envelope carries no usable meta', async () => {
    vi.mocked(serverFetch).mockResolvedValue({ ok: true } as Response);
    vi.mocked(parseApiResponse).mockResolvedValue({
      success: true,
      data: [DOCUMENT],
      meta: { page: 'one' },
    } as never);

    render(await KnowledgeDesignationPage());

    // `parsePaginationMeta` rejects the malformed meta rather than letting
    // `limit: undefined` reach the table's "Showing X to Y" arithmetic — which
    // renders as `NaN` and reads to an operator as a broken list.
    expect(propPassedDown('data-meta')).toEqual({
      page: 1,
      limit: DESIGNATION_ADMIN_PAGE_SIZE,
      total: 1,
      totalPages: 1,
    });
    expect(screen.queryByRole('alert')).toBeNull();
  });
});
