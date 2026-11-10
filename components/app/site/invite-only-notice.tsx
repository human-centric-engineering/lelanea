import Link from 'next/link';

import { WAITLIST_ANCHOR } from '@/lib/site/config';

/**
 * What the login page says to a stranger while accounts are by invitation.
 *
 * Under `SIGNUP_MODE=invite_only` the platform closes every door that creates
 * an account and redirects `/signup` here — and then says nothing. Someone who
 * typed `/signup`, or followed an old link to it, lands on "Welcome back" with
 * no account, no form, and no idea why. This is the sentence that was missing,
 * and the one place it can go: it points at the waitlist, which is the front
 * door we mean people to use.
 *
 * Mounted from Sunrise's `app/(auth)/login/page.tsx` — a one-line divergence
 * (`.context/app/divergences.md`, row 15). Since Sunrise 0.17.0 the page has
 * its own notice, but it speaks only for Sunrise's waitlist (`waitlistConfig`),
 * which we do not fill, so it renders nothing here. If we ever fill that
 * config, delete this line from the page rather than show both. The copy and
 * the destination live here so that line stays a line.
 *
 * Rendered only when `isInviteOnly()` is true; the page decides that, not this.
 */
export function InviteOnlyNotice() {
  return (
    <p className="text-muted-foreground text-center text-sm">
      Accounts are by invitation for now.{' '}
      <Link href={`/#${WAITLIST_ANCHOR}`} className="text-primary font-medium hover:underline">
        Join the waitlist
      </Link>{' '}
      to hear when we open.
    </p>
  );
}
