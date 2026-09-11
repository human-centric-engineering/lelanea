// @vitest-environment happy-dom

/**
 * The account view — the first surface under `/app` carrying real facts.
 *
 * The prototype's version of this page has "Eleven sessions so far" and three
 * counters, none of which has anything behind it. A count is the easiest kind
 * of invention to ship because it reads as data rather than as copy (D6), so
 * the test that matters most here is the one asserting there are none.
 *
 * @see components/app/views/account-view.tsx
 */

import { render, screen } from '@testing-library/react';
import * as React from 'react';
import { describe, expect, it, vi } from 'vitest';

/*
 * `next/link` renders a plain `<a>` in a test environment, so "is it a Link or
 * an anchor" is not observable from the DOM without this. Marking the mock is
 * what makes the export row's opt-out assertable at all — see the test that
 * uses it, and `RowLink`'s `external` prop for why it matters.
 */
vi.mock('next/link', () => ({
  default: ({ children, ...props }: React.ComponentPropsWithoutRef<'a'>) =>
    React.createElement('a', { ...props, 'data-next-link': 'true' }, children),
}));

import { AccountView } from '@/components/app/views/account-view';

const FACTS: {
  name: string | null;
  email: string;
  joined: string;
} = { name: 'Maya Reyes', email: 'maya@example.com', joined: 'March 2026' };

function renderAccount(props: Partial<typeof FACTS> = {}) {
  return render(<AccountView {...FACTS} {...props} />);
}

describe('the three facts it actually knows', () => {
  // Narrowed, because `name` is nullable now — the null case has its own
  // describe block below, and `getByText` cannot be asked to find nothing.
  it.each(Object.values(FACTS).filter((value): value is string => value !== null))(
    'shows %s',
    (value) => {
      renderAccount();
      expect(screen.getByText(value)).toBeTruthy();
    }
  );

  it('labels each of them, so a value is never an unexplained string', () => {
    renderAccount();
    for (const label of ['Name', 'Email', 'Joined']) {
      expect(screen.getByText(label)).toBeTruthy();
    }
  });

  it('invents no statistics', () => {
    // Every digit on this page has to come from a fact that was passed in. The
    // joined date is the only one, so removing it leaves a page with none.
    const { container } = renderAccount({ joined: 'this month' });
    expect(container.textContent ?? '').not.toMatch(/\d/);
  });
});

describe('where the controls actually live', () => {
  it('sends identity and password to the platform pages, not to a second form', () => {
    // A second place a password can be changed is always the one that misses a
    // security fix. These are links out, deliberately.
    renderAccount();
    expect(screen.getByRole('link', { name: /Your profile/ }).getAttribute('href')).toBe(
      '/profile'
    );
  });

  it('lands the password row on the tab that has a password field', () => {
    // `DEFAULT_SETTINGS_TAB` is `profile`, so a bare `/settings` opens a
    // name-and-avatar form with no password anywhere on it — a row whose label
    // and destination disagree, which no assertion about "is a link" can see.
    renderAccount();
    expect(screen.getByRole('link', { name: /Password and sign-in/ }).getAttribute('href')).toBe(
      '/settings?tab=security'
    );
  });

  it('points the export row at the only thing that exports', () => {
    // The settings account tab carries the delete form and account facts and
    // nothing else; `/data` describes the right without exercising it. The
    // route is the whole subject-access surface in the tree, so a row pointing
    // anywhere else is a broken promise on a GDPR Art. 15 control.
    renderAccount();
    expect(screen.getByRole('link', { name: /Export a copy/ }).getAttribute('href')).toBe(
      '/api/v1/users/me/export'
    );
  });

  it('reaches the export as a plain anchor, so nothing prefetches it', () => {
    // `<Link>` prefetches. Behind that href is an export that reads ~28 tables
    // and has its own rate-limit bucket, so a prefetch would run a full export
    // because the row scrolled into view — and could spend the reader's
    // allowance before they clicked anything. Asserted against the marked mock
    // above, with an in-app row alongside it: without the contrast this would
    // pass just as well if the mock stopped being applied at all.
    renderAccount();
    expect(
      screen.getByRole('link', { name: /Export a copy/ }).getAttribute('data-next-link')
    ).toBeNull();
    expect(screen.getByRole('link', { name: /Your profile/ }).getAttribute('data-next-link')).toBe(
      'true'
    );
  });

  it('opens the export in a new tab, so a refusal cannot replace the shell', () => {
    // The success path never navigates — `Content-Disposition: attachment`
    // cancels it. The rate-limit refusal and any thrown export error come back
    // as a bare JSON envelope with no disposition header, and same-tab that
    // commits: raw JSON over the whole app, back button the only way out.
    renderAccount();
    const row = screen.getByRole('link', { name: /Export a copy/ });
    expect(row.getAttribute('target')).toBe('_blank');
    expect(row.getAttribute('rel')).toContain('noopener');
  });

  it('leaves the in-app rows in the same tab', () => {
    // Without this the assertion above would pass just as well if `newTab` were
    // applied to every row, which would send the reader out of the shell to
    // change their own password.
    renderAccount();
    expect(screen.getByRole('link', { name: /Your profile/ }).getAttribute('target')).toBeNull();
  });

  it('sends erasure to the form that performs it', () => {
    renderAccount();
    expect(screen.getByRole('link', { name: /Close your account/ }).getAttribute('href')).toBe(
      '/settings?tab=account'
    );
  });

  it('makes every row a link rather than a button that lies', () => {
    renderAccount();
    expect(screen.getAllByRole('link')).toHaveLength(4);
    expect(screen.queryAllByRole('button')).toHaveLength(0);
  });
});

describe('a user with no name', () => {
  it('drops the Name row rather than answering it with an address', () => {
    // A user can exist without a name — an OAuth provider that returned none,
    // an invite accepted before the profile was filled in. Falling back to the
    // email would put `Name — maya@example.com` in a list whose whole claim is
    // that it shows only what the session holds. The PAGE still titles itself
    // with the address, which is a stand-in for a heading rather than an answer
    // to a labelled field.
    renderAccount({ name: null });
    expect(screen.queryByText('Name')).toBeNull();
    expect(screen.getAllByText('maya@example.com')).toHaveLength(1);
  });

  it('still shows the two facts it does have', () => {
    renderAccount({ name: null });
    expect(screen.getByText('Email')).toBeTruthy();
    expect(screen.getByText('Joined')).toBeTruthy();
  });
});
