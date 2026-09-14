/**
 * The gate in front of the shell — where a person is sent before they may enter.
 *
 * Two checks, in this order, and the order is the point: an unverified address
 * is sent to verify before being asked to agree to anything, because an
 * acknowledgement recorded against an account nobody has proved they own is
 * not worth much. Then the ledger (`acknowledgements.ts`): every kind at its
 * current version, or the gate page.
 *
 * ## Why the redirect is a layout concern and not an edge one
 *
 * `lib/app/protected-routes.ts` lists `/app`, and `proxy.ts` matches by prefix,
 * so `/app/begin` is already behind sign-in at the edge. The edge cannot read
 * the ledger — it has no database — so the gate itself runs in the shell
 * layout, server-side, on entry. A layout is not re-rendered between sibling
 * pages, and that is fine: there is no way into the shell that does not pass
 * through it first, and nothing inside the shell un-acknowledges anything.
 *
 * ## Why `/app/begin` lives OUTSIDE the shell's route group
 *
 * The shell layout redirects to `/app/begin`. If the gate page sat under that
 * layout the layout would run first and redirect to itself, forever. So the
 * page is `app/(gate)/app/begin/` — the same URL, a sibling route group, no
 * shell chrome — and this module is what both trees share.
 *
 * ## Verification is required only when the platform requires it
 *
 * `REQUIRE_EMAIL_VERIFICATION ?? NODE_ENV === 'production'` is the platform's
 * own rule (`lib/auth/config.ts`, three places). When it is off nobody is ever
 * sent a verification email, so a gate that demanded one would lock every
 * local account out of the shell with nothing to click. The same expression is
 * evaluated here rather than imported because the platform does not export it;
 * `tests/unit/lib/app/gateway/gate.test.ts` pins that they agree.
 *
 * @see lib/app/gateway/acknowledgements.ts · app/(lelanea)/app/layout.tsx · app/(gate)/app/begin/page.tsx
 */

import { env } from '@/lib/env';
import { getGateStatus } from '@/lib/app/gateway/acknowledgements';

/** The gate page. */
export const BEGIN_ROUTE = '/app/begin';

/** Sunrise's verify page. It reads `?email=` to offer a resend. */
export const VERIFY_EMAIL_ROUTE = '/verify-email';

/** What the gate needs to know about the person — the session's user, narrowed. */
export interface GateSubject {
  id: string;
  email: string;
  emailVerified: boolean;
}

/**
 * Whether the platform is requiring email verification right now — the same
 * rule `lib/auth/config.ts` applies to sign-in, read per call rather than at
 * module scope so a test can set the environment first.
 */
export function isEmailVerificationRequired(): boolean {
  return env.REQUIRE_EMAIL_VERIFICATION ?? env.NODE_ENV === 'production';
}

/**
 * Where to send someone whose address is not yet verified, or `null` when
 * verification is not being asked for (off, or already done).
 */
export function verificationRedirectFor(user: GateSubject): string | null {
  if (user.emailVerified || !isEmailVerificationRequired()) return null;
  return `${VERIFY_EMAIL_ROUTE}?${new URLSearchParams({ email: user.email })}`;
}

/**
 * Where the shell layout sends this person, or `null` when they may enter.
 *
 * Verification first, then the ledger. The ledger is only read when the
 * address is settled, so a redirect to verify costs no query.
 */
export async function gateRedirectFor(user: GateSubject): Promise<string | null> {
  const verify = verificationRedirectFor(user);
  if (verify) return verify;

  const status = await getGateStatus(user.id);
  return status.complete ? null : BEGIN_ROUTE;
}
