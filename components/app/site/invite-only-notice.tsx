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
 * (`.context/app/divergences.md`, row 15), because the platform's closed state
 * is "hide the sign-up link" and it has no seam for what to say instead. The
 * copy and the destination live here so that line stays a line.
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
