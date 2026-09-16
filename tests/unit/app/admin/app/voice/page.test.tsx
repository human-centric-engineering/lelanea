// @vitest-environment happy-dom

/**
 * The admin voice-comparison page.
 *
 * Its whole job is `getComparisons()` — fetch, validate, or fall back — and then
 * handing the list to the board. So the branches ARE the page, and the one that
 * matters is the failure: the board's empty state says "Nothing has been run
 * through the golden set yet", which on a broken fetch is a false statement
 * about the product on the surface whose only job is to answer that question
 * (`HB9`). The page carries `loadError` so the two are told apart.
 *
 * No auth test here: the admin guard is `app/admin/layout.tsx`, which has its
 * own, and the routes behind this page have their own 401/403 cases.
 *
 * @see app/admin/app/voice/page.tsx
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen } from '@testing-library/react';

vi.mock('@/lib/api/server-fetch', () => ({
  serverFetch: vi.fn(),
  parseApiResponse: vi.fn(),
}));

// The board has its own test file; stubbing it keeps this about what the page
// resolved and handed on.
vi.mock('@/components/app/admin/voice-comparison', () => ({
  VoiceComparisonBoard: (props: { initialComparisons: unknown; initialLoadFailed: boolean }) => (
    <div
      data-testid="voice-board"
      data-comparisons={JSON.stringify(props.initialComparisons)}
      data-load-failed={String(props.initialLoadFailed)}
    />
  ),
}));

import VoiceComparisonPage from '@/app/admin/app/voice/page';
import { serverFetch, parseApiResponse } from '@/lib/api/server-fetch';
import { VOICE_COMPARISON_ENDPOINT } from '@/lib/app/voice/endpoint';

const COMPARISON = {
  id: 'cmu4paqmt0000oc5new0nizu5',
  goldenSetVersion: '1.0',
  datasetContentHash: 'hash',
  createdAt: '2026-09-16T10:00:00.000Z',
  arms: [],
};

function boardProp(attribute: 'data-comparisons' | 'data-load-failed'): unknown {
  const raw = screen.getByTestId('voice-board').getAttribute(attribute);
  return raw === null ? undefined : attribute === 'data-load-failed' ? raw : JSON.parse(raw);
}

beforeEach(() => {
  vi.clearAllMocks();
});

describe('VoiceComparisonPage', () => {
  it('asks the API for the comparisons and hands them to the board', async () => {
    vi.mocked(serverFetch).mockResolvedValue({ ok: true } as Response);
    vi.mocked(parseApiResponse).mockResolvedValue({ success: true, data: [COMPARISON] } as never);

    render(await VoiceComparisonPage());

    expect(serverFetch).toHaveBeenCalledWith(VOICE_COMPARISON_ENDPOINT);
    expect(boardProp('data-comparisons')).toEqual([COMPARISON]);
    expect(boardProp('data-load-failed')).toBe('false');
    expect(screen.queryByRole('alert')).toBeNull();
  });

  it('says the list did not load rather than letting the board claim nothing has run', async () => {
    // The two states look identical on screen otherwise, and one of them is a
    // false statement about whether her voice has ever been checked.
    vi.mocked(serverFetch).mockResolvedValue({ ok: false } as Response);

    render(await VoiceComparisonPage());

    expect(screen.getByRole('alert')).toHaveTextContent(/did not load/i);
    expect(boardProp('data-comparisons')).toEqual([]);
    expect(boardProp('data-load-failed')).toBe('true');
  });

  it('treats a non-ok envelope the same way as a non-ok response', async () => {
    vi.mocked(serverFetch).mockResolvedValue({ ok: true } as Response);
    vi.mocked(parseApiResponse).mockResolvedValue({
      success: false,
      error: { code: 'X', message: 'no' },
    } as never);

    render(await VoiceComparisonPage());

    expect(boardProp('data-load-failed')).toBe('true');
  });

  it('survives a fetch that throws rather than rendering an error page', async () => {
    // A thrown fetch on a server component is an unhandled 500 for the whole
    // route; catching it keeps the admin's other controls reachable.
    vi.mocked(serverFetch).mockRejectedValue(new Error('ECONNREFUSED'));

    render(await VoiceComparisonPage());

    expect(screen.getByRole('alert')).toBeInTheDocument();
    expect(boardProp('data-load-failed')).toBe('true');
  });
});
