/**
 * The journey record's per-flow sub-cap: 10 model calls a minute per person,
 * across keeping an edited synopsis and asking for another draft (t-147).
 *
 * Both can call the synopsis seat, charged to the person, so they share one
 * bucket of their own. A turn's limiter would put drafting in the chat's
 * budget, so a run of redrafts could stop someone talking; a section limiter
 * is the proxy's to call, never a handler's.
 *
 * **Additive to the section cap**: `proxy.ts` has already applied the `'api'`
 * tier before the handler runs. The cap per draft
 * (`MAX_SYNOPSIS_REGENERATIONS`) and the person's monthly ceiling bound the
 * spend; this bounds the rate.
 *
 * @see .context/security/rate-limiting.md
 */

import { createRateLimiter } from '@/lib/security/rate-limit';
import { SECURITY_CONSTANTS } from '@/lib/security/constants';

/** Calls allowed per minute, per person. */
export const SYNOPSIS_CALLS_PER_MINUTE = 10;

export const synopsisCallLimiter = createRateLimiter({
  interval: SECURITY_CONSTANTS.RATE_LIMIT.DEFAULT_INTERVAL,
  maxRequests: SYNOPSIS_CALLS_PER_MINUTE,
  uniqueTokenPerInterval: SECURITY_CONSTANTS.RATE_LIMIT.MAX_UNIQUE_TOKENS,
});

/** The bucket key: the person, never the entry, so many drafts share one budget. */
export function synopsisCallKey(userId: string): string {
  return `journey-synopsis:${userId}`;
}
