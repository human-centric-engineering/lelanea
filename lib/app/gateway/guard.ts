/**
 * `withGatedAuth` — `withAuth`, plus the gate the shell layout applies (t-159).
 *
 * The shell layout sends anyone who has not passed the gate — an unverified
 * address where verification is required, or an acknowledgement missing at its
 * current version — to the gate instead of the shell. That is a page-entry
 * check. A signed-in person who never agreed to the terms could still call the
 * app's data routes directly and use what the shell would have kept them out
 * of. Every app route that serves the shell is wrapped in this instead of
 * `withAuth`, so the API asks the same question the layout does.
 *
 * ## What the refusal is
 *
 * `403`, code {@link GATE_REQUIRED}, and `details.location` — exactly where the
 * layout would have redirected them. Nothing in the handler runs. The shell's
 * `GateWatch` (`components/app/shell/gate-watch.tsx`) turns it into a
 * navigation to the gate, so someone re-gated mid-session (a new version of the
 * terms) is taken there rather than left with panes that fail (`HB10`).
 *
 * ## What it deliberately does not cover
 *
 * Routes a person must reach without having passed: the gate's own
 * acknowledgement route, the public content and waitlist routes, the cron
 * route, and **taking your data out or deleting it**. Exporting or erasing what
 * the app holds about you is not conditional on accepting a new version of the
 * terms. `tests/unit/app/api/v1/app/gate-coverage.test.ts` lists every route
 * and method under `app/api/v1/app/` as gated or exempt-with-a-reason, so a new
 * route cannot skip this silently.
 *
 * API-key sessions are gated like any other: the key acts as its owner, and the
 * owner is the one who has or has not agreed.
 *
 * The turn route is Daybreak's and is not wrapped here; the turn hook asks the
 * same question (`runRecordedTurn` in `lib/app/agent/turns.ts`).
 *
 * @see lib/app/gateway/gate.ts — the question both this and the layout ask
 * @see lib/app/gateway/gate-codes.ts — the code, importable by the browser
 */

import type { NextRequest } from 'next/server';
import { APIError } from '@/lib/api/errors';
import {
  withAuth,
  type AuthenticatedSession,
  type RouteContext,
  type WithAuthOptions,
} from '@/lib/auth/guards';
import { gateRedirectFor } from '@/lib/app/gateway/gate';
import { GATE_REQUIRED } from '@/lib/app/gateway/gate-codes';

/** The refusal for someone not past the gate, pointing where the layout would. */
export function gateRequiredError(location: string): APIError {
  return new APIError('Agree to the terms before using the app.', GATE_REQUIRED, 403, { location });
}

async function assertPassedGate(session: AuthenticatedSession): Promise<void> {
  const location = await gateRedirectFor(session.user);
  if (location !== null) throw gateRequiredError(location);
}

export function withGatedAuth(
  handler: (request: NextRequest, session: AuthenticatedSession) => Response | Promise<Response>,
  options?: WithAuthOptions
): (request: NextRequest) => Promise<Response>;

export function withGatedAuth<TParams>(
  handler: (
    request: NextRequest,
    session: AuthenticatedSession,
    context: RouteContext<TParams>
  ) => Response | Promise<Response>,
  options?: WithAuthOptions<TParams>
): (request: NextRequest, context: RouteContext<TParams>) => Promise<Response>;

export function withGatedAuth(
  handler: (
    request: NextRequest,
    session: AuthenticatedSession,
    context: RouteContext<Record<string, string>>
  ) => Response | Promise<Response>,
  options?: WithAuthOptions<Record<string, string>>
): (request: NextRequest, context: RouteContext<Record<string, string>>) => Promise<Response> {
  return withAuth<Record<string, string>>(async (request, session, context) => {
    await assertPassedGate(session);
    return handler(request, session, context);
  }, options);
}
