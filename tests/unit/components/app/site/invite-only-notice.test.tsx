// @vitest-environment happy-dom

/**
 * The sentence the closed door says. `login-invite-only.test.tsx` proves the
 * login page mounts it under invite-only and not otherwise; this pins what it
 * says and where it sends people, independent of where it is mounted.
 *
 * @see components/app/site/invite-only-notice.tsx
 */

import { render, screen } from '@testing-library/react';
import { describe, expect, it } from 'vitest';

import { InviteOnlyNotice } from '@/components/app/site/invite-only-notice';
import { WAITLIST_ANCHOR } from '@/lib/site/config';

describe('InviteOnlyNotice', () => {
  it('says accounts are by invitation, and links to the waitlist form by its anchor', () => {
    render(<InviteOnlyNotice />);
    expect(screen.getByText(/accounts are by invitation for now/i)).toBeInTheDocument();
    expect(screen.getByRole('link', { name: 'Join the waitlist' })).toHaveAttribute(
      'href',
      `/#${WAITLIST_ANCHOR}`
    );
  });

  it('promises no date', () => {
    // We do not know when we open. "to hear when we open" is honest; a month
    // would be invented.
    const { container } = render(<InviteOnlyNotice />);
    expect(container.textContent).not.toMatch(/\d/);
  });
});
