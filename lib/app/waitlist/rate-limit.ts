/**
 * The waitlist's per-flow sub-cap: 5 joins per hour per IP.
 *
 * ## Why a limiter of our own, and not `contactLimiter`
 *
 * `contactLimiter` in `lib/security/rate-limit.ts` is exactly the cap this flow
 * wants, and borrowing it would have been one import. It would also have put
 * the contact form and the waitlist in the SAME bucket: someone who sent a
 * message through the contact page would then have four joins left, and a bot
 * exhausting one surface would close the other. Two unauthenticated public
 * write paths deserve independent budgets.
 *
 * `lib/security/rate-limit.ts` is Sunrise-owned, so a fifth exported limiter
 * does not go in it — `createRateLimiter` is the seam it exposes for exactly
 * this, and a limiter created here is a new file rather than a divergence row.
 *
 * ## This is ADDITIVE to the section cap, not a replacement for it
 *
 * `proxy.ts` has already applied the `'api'` tier (100/min) before the handler
 * runs, keyed on the session user and falling back to `ip:<addr>` for an
 * anonymous caller — which every waitlist join is. That is the coarse ceiling;
 * this is the tight per-flow cap under it, the same two-layer shape the contact
 * form uses. Route handlers must never call a SECTION limiter directly.
 *
 * @see .context/security/rate-limiting.md
 */

import { createRateLimiter } from '@/lib/security/rate-limit';
import { SECURITY_CONSTANTS } from '@/lib/security/constants';

/** One hour, matching the contact form's window. */
const WAITLIST_INTERVAL = 60 * 60 * 1000;

/** Joins allowed per window, per IP. */
export const WAITLIST_MAX_PER_INTERVAL = 5;

export const waitlistLimiter = createRateLimiter({
  interval: WAITLIST_INTERVAL,
  maxRequests: WAITLIST_MAX_PER_INTERVAL,
  uniqueTokenPerInterval: SECURITY_CONSTANTS.RATE_LIMIT.MAX_UNIQUE_TOKENS,
});
