// @vitest-environment happy-dom

/**
 * The account page — the first view under `/app` that guards for itself.
 *
 * ## Why this test exists at all
 *
 * `app/(lelanea)/app/layout.tsx` checks the session, and a layout is NOT
 * re-rendered when the router moves between sibling pages inside it. So while
 * every page under it was a static placeholder, one check on entry was the
 * whole story; this page ends that, because it renders a name, an address and a
 * join date. The property pinned here is that it asks for the session ITSELF
 * rather than inheriting a check that may have been made under a session since
 * revoked — raised by t-9's security review, below its reporting threshold then
 * and live from this task (`B28`).
 *
 * @see app/(lelanea)/app/account/page.tsx
 */

import { render, screen } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';

const getServerSession = vi.hoisted(() => vi.fn());
const clearInvalidSession = vi.hoisted(() =>
  vi.fn(() => {
    // The real one redirects, which throws. A mock that simply returns would
    // let the page fall through to `session.user` on a null session and fail
    // with a TypeError instead — passing for the wrong reason, or failing in a
    // way that hides what is being asserted.
    throw new Error('NEXT_REDIRECT');
  })
);

vi.mock('@/lib/auth/utils', () => ({ getServerSession }));
vi.mock('@/lib/auth/clear-session', () => ({ clearInvalidSession }));

import AccountLoading from '@/app/(lelanea)/app/account/loading';
import AccountPage from '@/app/(lelanea)/app/account/page';

const SESSION = {
  user: {
    name: 'Maya Reyes',
    email: 'maya@example.com',
    createdAt: new Date('2026-03-14T09:00:00Z'),
  },
};

beforeEach(() => {
  vi.clearAllMocks();
});

describe('without a session', () => {
  it('clears the cookie and sends the reader back, rather than rendering', async () => {
    getServerSession.mockResolvedValue(null);
    await expect(AccountPage()).rejects.toThrow('NEXT_REDIRECT');
    expect(clearInvalidSession).toHaveBeenCalledWith('/app/account');
  });
});

describe('with a session', () => {
  it('asks for the session itself rather than trusting the layout', async () => {
    // The whole point of the task's security note: the layout's check does not
    // re-run between siblings, so the page that reads personal data has to
    // fetch the session rather than assume one was validated on the way in.
    getServerSession.mockResolvedValue(SESSION);
    render(await AccountPage());
    expect(getServerSession).toHaveBeenCalledTimes(1);
  });

  it('shows the three facts it has', async () => {
    getServerSession.mockResolvedValue(SESSION);
    render(await AccountPage());
    expect(screen.getAllByText('Maya Reyes').length).toBeGreaterThan(0);
    expect(screen.getByText('maya@example.com')).toBeTruthy();
    expect(screen.getByText('March 2026')).toBeTruthy();
  });

  it('names the page after the account, the way the prototype does', async () => {
    getServerSession.mockResolvedValue(SESSION);
    render(await AccountPage());
    expect(screen.getByRole('heading', { level: 1 }).textContent).toBe('Maya Reyes');
  });

  it('formats the join date in a stated locale, not the runtime’s', async () => {
    // `toLocaleDateString()` with no locale reads the environment's — the
    // server's during SSR and the reader's after hydration — so the same date
    // renders two strings and React warns and re-renders. On the one view whose
    // whole job is being trustworthy about facts.
    getServerSession.mockResolvedValue(SESSION);
    render(await AccountPage());
    expect(screen.getByText('March 2026')).toBeTruthy();
  });

  it('falls back to the address when the account has no name', async () => {
    getServerSession.mockResolvedValue({
      user: { ...SESSION.user, name: '   ' },
    });
    render(await AccountPage());
    expect(screen.getByRole('heading', { level: 1 }).textContent).toBe('maya@example.com');
  });
});

describe('the loading state it is replaced from', () => {
  it('names its heading, rather than leaving an empty h1 on the page', async () => {
    // `View` always renders an `<h1>`, and the skeleton's title is an
    // `aria-hidden` bar — so without a label inside it, the page's only
    // top-level heading is unnamed. An axe `empty-heading` violation, and an
    // unnamed landing place for anyone navigating by heading.
    render(AccountLoading());
    expect(screen.getByRole('heading', { level: 1 }).textContent).toContain('Loading');
  });

  it('renders the same lede as the page, from the same constant', async () => {
    // The bars have to sit on the lines the content will occupy, and the lede
    // is what puts them there. Two hardcoded copies would drift the first time
    // one was edited, silently.
    const loading = render(AccountLoading());
    const ledeWhileLoading = screen.getByText(/What Lelañea knows about you here/);
    expect(ledeWhileLoading).toBeTruthy();
    loading.unmount();

    getServerSession.mockResolvedValue(SESSION);
    render(await AccountPage());
    expect(screen.getByText(ledeWhileLoading.textContent ?? '')).toBeTruthy();
  });
});
