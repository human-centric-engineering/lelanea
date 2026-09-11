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
import { describe, expect, it } from 'vitest';

import { AccountView } from '@/components/app/views/account-view';

const FACTS = { name: 'Maya Reyes', email: 'maya@example.com', joined: 'March 2026' };

function renderAccount(props: Partial<typeof FACTS> = {}) {
  return render(<AccountView {...FACTS} {...props} />);
}

describe('the three facts it actually knows', () => {
  it.each(Object.values(FACTS))('shows %s', (value) => {
    renderAccount();
    expect(screen.getByText(value)).toBeTruthy();
  });

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
    expect(screen.getByRole('link', { name: /Password and sign-in/ }).getAttribute('href')).toBe(
      '/settings'
    );
  });

  it('sends the data rights somewhere that works today', () => {
    // §06 `f-gateway` t-3 owns these. Until it lands, a row that leads to the
    // controls that DO work beats a row that leads nowhere.
    renderAccount();
    for (const name of [/Export a copy/, /Close your account/]) {
      expect(screen.getByRole('link', { name }).getAttribute('href')).toBe('/settings?tab=account');
    }
  });

  it('makes every row a link rather than a button that lies', () => {
    renderAccount();
    expect(screen.getAllByRole('link')).toHaveLength(4);
    expect(screen.queryAllByRole('button')).toHaveLength(0);
  });
});

describe('a user with no name', () => {
  it('falls back to the address rather than showing an empty field', () => {
    // A user can exist without a name — an OAuth provider that returned none,
    // an invite accepted before the profile was filled in. The page decides
    // that upstream; this pins that the view renders whatever it is given
    // rather than hiding a blank.
    renderAccount({ name: 'maya@example.com' });
    expect(screen.getAllByText('maya@example.com')).toHaveLength(2);
  });
});
