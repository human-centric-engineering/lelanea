// @vitest-environment happy-dom

/**
 * The notes page — the second view under `/app` that guards for itself, and
 * the one with most to lose by not (f-slots t-73).
 *
 * `app/(lelanea)/app/layout.tsx` checks the session, and a layout is NOT
 * re-rendered when the router moves between sibling pages inside it. So that
 * check gates entry to the shell rather than each view, and this view renders
 * every reading Lelañea holds about a person — the most personal surface in the
 * app. The property pinned here is that it asks for the session ITSELF rather
 * than inheriting a check that may have been made under a session since
 * revoked (`.context/app/shell.md`, "A view that reads about the reader must
 * guard itself").
 *
 * The panel is stubbed. What it does with what it fetches is
 * `tests/unit/components/app/notes/notes-panel.test.tsx`; this file is about
 * the page around it, and rendering the real one here would pull a `fetch` and
 * the shell provider into a test about a session read.
 *
 * @see app/(lelanea)/app/notes/page.tsx
 */

import { render, screen } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';

const getServerSession = vi.hoisted(() => vi.fn());
const clearInvalidSession = vi.hoisted(() =>
  vi.fn(() => {
    // The real one redirects, which throws. A mock that simply returned would
    // let the page fall through and render as though the reader were signed
    // in — passing for the wrong reason on the one assertion that matters.
    throw new Error('NEXT_REDIRECT');
  })
);

vi.mock('@/lib/auth/utils', () => ({ getServerSession }));
vi.mock('@/lib/auth/clear-session', () => ({ clearInvalidSession }));
vi.mock('@/components/app/notes/notes-panel', async (importOriginal) => {
  // The copy constants are real — the page and its loading boundary both read
  // them, and a stub that invented strings would let the two drift apart while
  // this test went on passing.
  const actual = await importOriginal<typeof import('@/components/app/notes/notes-panel')>();
  return {
    NOTES_LEDE: actual.NOTES_LEDE,
    NOTES_NOTE: actual.NOTES_NOTE,
    NotesSkeleton: actual.NotesSkeleton,
    NotesPanel: () => <div data-testid="panel" />,
  };
});

import NotesLoading from '@/app/(lelanea)/app/notes/loading';
import NotesPage, { metadata } from '@/app/(lelanea)/app/notes/page';
import { NOTES_LEDE } from '@/components/app/notes/notes-panel';

const SESSION = { user: { name: 'Maya Reyes', email: 'maya@example.com' } };

beforeEach(() => {
  vi.clearAllMocks();
});

describe('without a session', () => {
  it('clears the cookie and sends the reader back, rather than rendering', async () => {
    getServerSession.mockResolvedValue(null);

    await expect(NotesPage()).rejects.toThrow('NEXT_REDIRECT');
    expect(clearInvalidSession).toHaveBeenCalledWith('/app/notes');
  });
});

describe('with a session', () => {
  beforeEach(() => {
    getServerSession.mockResolvedValue(SESSION);
  });

  it('renders the panel under a head that says what the page is', async () => {
    render(await NotesPage());

    expect(screen.getByRole('heading', { level: 1 }).textContent).toBe(
      'What Lelañea has written down about you'
    );
    expect(screen.getByTestId('panel')).toBeTruthy();
    expect(clearInvalidSession).not.toHaveBeenCalled();
  });

  it('says plainly that these are readings rather than the reader’s own words', async () => {
    render(await NotesPage());

    // The page's one honesty claim, and the reason a person can trust the rest
    // of it (§3.19). Asserted because copy is the whole mechanism here — there
    // is no other signal that a note is a conclusion rather than a quote.
    expect(screen.getByText(/not your words back/)).toBeTruthy();
    expect(screen.getByText(/She can be wrong/)).toBeTruthy();
  });

  it('holds the page in a centred column', async () => {
    render(await NotesPage());
    expect(screen.getByRole('main').className).toMatch(/mx-auto/);
  });

  it('names itself in the tab with the words the nav item uses', () => {
    expect(metadata.title).toBe('Lelañea’s notes');
  });
});

describe('the loading boundary', () => {
  it('draws the same head the page does, so nothing swaps when it resolves', () => {
    render(<NotesLoading />);

    expect(screen.getByRole('heading', { level: 1 }).textContent).toBe(
      'What Lelañea has written down about you'
    );
    // From the shared export rather than a copy — the drift this exists to stop.
    expect(screen.getByText(NOTES_LEDE)).toBeTruthy();
  });

  it('tells a screen reader it is loading rather than only drawing bars', () => {
    render(<NotesLoading />);
    expect(screen.getByRole('status').textContent).toMatch(/Reading Lelañea’s notes/);
  });
});
