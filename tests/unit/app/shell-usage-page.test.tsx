// @vitest-environment happy-dom

/**
 * The usage page — the third view under `/app` that guards for itself
 * (f-budget t-94).
 *
 * `app/(lelanea)/app/layout.tsx` checks the session, and a layout is NOT
 * re-rendered when the router moves between sibling pages inside it. So that
 * check gates entry to the shell rather than each view, and this one reads one
 * person's spend against one person's limit. The property pinned here is that
 * it asks for the session ITSELF rather than inheriting a check made under a
 * session since revoked (`.context/app/shell.md`, "A view that reads about the
 * reader must guard itself").
 *
 * The panel is stubbed — what it does with what it fetches is
 * `tests/unit/components/app/usage/`. This file is about the page around it,
 * and about the two sentences it no longer says.
 *
 * @see app/(lelanea)/app/usage/page.tsx
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
vi.mock('@/components/app/usage/usage-panel', async (importOriginal) => {
  // The copy constants are real — the page and its loading boundary both read
  // them, and a stub that invented strings would let the two drift apart while
  // this test went on passing.
  const actual = await importOriginal<typeof import('@/components/app/usage/usage-panel')>();
  return {
    USAGE_LEDE: actual.USAGE_LEDE,
    USAGE_NOTE: actual.USAGE_NOTE,
    UsageSkeleton: actual.UsageSkeleton,
    UsagePanel: () => <div data-testid="panel" />,
  };
});

import UsageLoading from '@/app/(lelanea)/app/usage/loading';
import UsagePage, { metadata } from '@/app/(lelanea)/app/usage/page';

const SESSION = { user: { name: 'Maya Reyes', email: 'maya@example.com' } };

beforeEach(() => {
  vi.clearAllMocks();
});

describe('without a session', () => {
  it('clears the cookie and sends the reader back, rather than rendering', async () => {
    getServerSession.mockResolvedValue(null);

    await expect(UsagePage()).rejects.toThrow('NEXT_REDIRECT');
    expect(clearInvalidSession).toHaveBeenCalledWith('/app/usage');
  });
});

describe('with a session', () => {
  beforeEach(() => {
    getServerSession.mockResolvedValue(SESSION);
  });

  it('renders the panel under a head that says what the page is', async () => {
    render(await UsagePage());

    expect(screen.getByRole('heading', { level: 1 }).textContent).toBe('What this month cost');
    expect(screen.getByTestId('panel')).toBeTruthy();
    expect(clearInvalidSession).not.toHaveBeenCalled();
  });

  it('says plainly that nothing is charged, and whose limit it is', async () => {
    render(await UsagePage());

    // The page's honesty claim. Nothing else on the surface distinguishes "a
    // limit that protects you from a bill" from "a limit we set to afford
    // this", and they are very different promises.
    expect(screen.getByText(/Nothing is charged to you/)).toBeTruthy();
    expect(screen.getByText(/The limit is ours/)).toBeTruthy();
  });

  it('no longer claims no model is being called, or a budget the reader sets', async () => {
    render(await UsagePage());

    // The two sentences the placeholder carried, both false by the time it was
    // replaced: she has been answering since §10, and a budget a person sets
    // belongs to the commercial phase and is not being built.
    const page = screen.getByRole('main').textContent ?? '';
    expect(page).not.toMatch(/not calling a model/);
    expect(page).not.toMatch(/budget you set/);
    expect(page).not.toMatch(/not built yet/);
  });

  it('shows the same head while the session is still being read', async () => {
    // The route's boundary and the page draw one head from one pair of
    // constants, so nothing moves under the reader when the page arrives.
    render(<UsageLoading />);

    expect(screen.getByRole('heading', { level: 1 }).textContent).toBe('What this month cost');
    expect(screen.getByText(/Nothing is charged to you/)).toBeTruthy();
    expect(screen.getByRole('status')).toHaveTextContent('Reading what this month cost.');
  });

  it('carries the tab title the account menu promises', async () => {
    // `shell-view-pages.test.tsx` pins it against `ACCOUNT_MENU_LINKS`; named
    // here too so this file reads as the whole of the page's contract.
    expect(metadata.title).toBe('Usage and billing');
  });
});
