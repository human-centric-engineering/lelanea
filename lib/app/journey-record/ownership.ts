/**
 * Who decides whose journey record a route touches: the caller, always
 * (f-journey-record t-145). Shared by the record's three routes so they cannot
 * drift apart.
 *
 * Deliberately **not** `'policy'`: `subjectScope` widens to `{}` for a platform
 * admin, and on these endpoints that would hand an operator the most personal
 * thing the app holds about whoever they were signed in beside. The record is
 * the person's (§12), and there is no admin door to it.
 */

import type { RouteOwnership } from '@/lib/auth/guards';

export const JOURNEY_RECORD_OWNERSHIP: RouteOwnership = {
  decidedBy: 'self',
  because:
    "Every read, write and removal is keyed on the caller's own id. A path names an entry, never a subject, and another person's entry id matches nothing.",
};
