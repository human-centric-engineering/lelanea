// @vitest-environment happy-dom

/**
 * The login page under `SIGNUP_MODE=invite_only` — Lelañea's half.
 *
 * The platform's own test (`tests/unit/app/(auth)/login/page.test.tsx`) proves
 * the sign-up link is GONE under invite-only. This proves something is there
 * instead: a stranger who typed `/signup` is redirected here by the proxy and
 * must be told why there is no form, and where the front door is. A leaf test
 * rather than a case added to the platform's file, so the platform's test
 * merges through untouched.
 *
 * @see components/app/site/invite-only-notice.tsx
 * @see app/(auth)/login/page.tsx — divergence row 15
 */

import { render, screen } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import LoginPage from '@/app/(auth)/login/page';
import { isInviteOnly } from '@/lib/auth/signup-mode';
import { WAITLIST_ANCHOR } from '@/lib/site/config';

vi.mock('@/components/forms/login-form', () => ({
  LoginForm: () => <div data-testid="login-form" />,
}));

vi.mock('@/lib/auth/signup-mode', () => ({
  isInviteOnly: vi.fn(() => false),
}));

beforeEach(() => {
  vi.mocked(isInviteOnly).mockReturnValue(false);
});

describe('the login page while accounts are by invitation', () => {
  it('says so, and points at the waitlist', () => {
    vi.mocked(isInviteOnly).mockReturnValue(true);
    render(<LoginPage />);

    expect(screen.getByText(/accounts are by invitation for now/i)).toBeInTheDocument();
    const link = screen.getByRole('link', { name: 'Join the waitlist' });
    // The landing page's form, by its anchor — not a page that does not exist.
    expect(link).toHaveAttribute('href', `/#${WAITLIST_ANCHOR}`);
    // And the platform's half still holds: no way to a form that cannot succeed.
    expect(screen.queryByRole('link', { name: /sign up/i })).not.toBeInTheDocument();
  });

  it('keeps the way in for the invited — the form and password recovery', () => {
    vi.mocked(isInviteOnly).mockReturnValue(true);
    render(<LoginPage />);

    expect(screen.getByTestId('login-form')).toBeInTheDocument();
    expect(screen.getByRole('link', { name: /forgot your password/i })).toBeInTheDocument();
  });

  it('says nothing about invitations when signup is open', () => {
    // The notice is for a closed door. Open, it would contradict the sign-up
    // link one line above it.
    render(<LoginPage />);

    expect(screen.queryByText(/by invitation/i)).not.toBeInTheDocument();
    expect(screen.getByRole('link', { name: /sign up/i })).toBeInTheDocument();
  });
});
