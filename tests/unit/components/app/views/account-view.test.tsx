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
 * `next/link` renders a plain `<a>` in a test environment. The mock is marked
 * so a row can be told apart from a bare anchor if one ever returns — the
 * export row was one until §06 t-17 made it a control.
 */
vi.mock('next/link', () => ({
  default: ({ children, ...props }: React.ComponentPropsWithoutRef<'a'>) =>
    React.createElement('a', { ...props, 'data-next-link': 'true' }, children),
}));

vi.mock('@/lib/api/client', () => ({
  apiClient: { get: vi.fn() },
  APIClientError: class extends Error {},
}));
vi.mock('@/lib/logging', () => ({
  logger: { info: vi.fn(), warn: vi.fn(), error: vi.fn(), debug: vi.fn() },
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

  it('makes the export a control, not a link — the one row that produces rather than leads', () => {
    // §06 t-17. t-11 linked this row straight at `GET /api/v1/users/me/export`
    // in a new tab, and a refusal came back as raw JSON in that tab. The export
    // is now `ExportDataRow`: a button, so a refusal is a sentence in the row.
    // Its own behaviour is `tests/unit/components/app/account/export-data-row.test.tsx`.
    renderAccount();
    const row = screen.getByRole('button', { name: /Export a copy/ });
    expect(row.getAttribute('type')).toBe('button');
    expect(screen.queryByRole('link', { name: /Export a copy/ })).toBeNull();
  });

  it('never prefetches an export: no link on the page points at the route', () => {
    // `<Link>` prefetches, and prefetching an Art. 15 export ran it because a
    // row scrolled into view. With the row a button that cannot happen, but a
    // future link to the route would bring it back — so the property is pinned
    // on the whole page, not on one element.
    renderAccount();
    const hrefs = screen.getAllByRole('link').map((link) => link.getAttribute('href'));
    expect(hrefs).not.toContain('/api/v1/users/me/export');
    expect(hrefs.length).toBeGreaterThan(0);
  });

  it('keeps every row in the same tab', () => {
    renderAccount();
    for (const link of screen.getAllByRole('link')) {
      expect(link.getAttribute('target')).toBeNull();
    }
  });

  it('sends erasure to the form that performs it', () => {
    renderAccount();
    expect(screen.getByRole('link', { name: /Close your account/ }).getAttribute('href')).toBe(
      '/settings?tab=account'
    );
  });

  it('leads to the record of what was agreed at the gate', () => {
    // §06 t-16: the only way into `/app/begin` from inside the shell. In the
    // same tab — it is an app page, not a download.
    renderAccount();
    const row = screen.getByRole('link', { name: /What you agreed to/ });
    expect(row.getAttribute('href')).toBe('/app/begin');
    expect(row.getAttribute('target')).toBeNull();
    // Above erasure: closing the account is the last thing on the page.
    const rows = screen.getAllByRole('link').map((link) => link.getAttribute('href'));
    expect(rows.indexOf('/app/begin')).toBeLessThan(rows.indexOf('/settings?tab=account'));
  });

  it('makes every row that leads somewhere a link, and the one that does something a button', () => {
    renderAccount();
    expect(screen.getAllByRole('link')).toHaveLength(4);
    const buttons = screen.getAllByRole('button');
    expect(buttons).toHaveLength(1);
    expect(buttons[0]?.textContent).toContain('Export a copy');
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
