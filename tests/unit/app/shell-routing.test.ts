/**
 * The shell's three seams, wired end to end with their REAL values.
 *
 * `tests/unit/lib/security/proxy.test.ts` mocks `appProtectedRoutes` to
 * `['/projects', '/reports/', '']`, which is right for what it tests — the
 * merge, the trailing-slash strip, the empty-string guard — but it means no test
 * in the tree has ever seen this fork's actual value reach the proxy. The same
 * gap applies to the landing route: `defaults.test.ts` pins what the seam
 * *says*, and nothing checks what the platform then *does* with it.
 *
 * That gap is the whole failure mode. Each of these seams is a constant a fork
 * sets and the platform reads somewhere else, so a wrong one produces no error
 * anywhere — just a signed-out visitor walking into `/app`, or a login landing
 * back on the `/dashboard` this product abandoned. `fp1`: the load-bearing test
 * goes on the wiring, not on the surface.
 *
 * So: no mock of any `lib/app/*` seam in this file, deliberately.
 *
 * ---------------------------------------------------------------------------
 * FORK NOTE — this file reads three `lib/app/*` seams for real, on purpose
 * ---------------------------------------------------------------------------
 * Reading them unmocked is the entire point: the question is what the PLATFORM
 * does with this fork's values, and a mock answers a different one. But it does
 * make this file yours to maintain, so if you have forked Lelañea and these are
 * failing, they are telling you your seams say something else — not that
 * anything is broken.
 *
 * What to pin, per seam:
 *
 *   - `protected-routes.ts` — the `/app` cases assume the shell lives at
 *     `/app`. Moved it? Change the paths here and the row in
 *     `tests/unit/lib/app/defaults.test.ts`; the two are deliberately
 *     redundant, one on the value and one on the wiring.
 *   - `auth-landing.ts` — `AUTH_LANDING_ROUTE` and `AUTH_LANDING_LABEL` are
 *     asserted as literals. Pin yours; do not delete the cases, or nothing
 *     checks that the platform still honours the seam at all.
 *   - `protected-nav.ts` — the assertion is that no nav entry points at a route
 *     your product does not serve. If you kept `/dashboard`, invert it; if you
 *     dropped some other route, name that one instead.
 *
 * The `/apply` case is different in kind — it characterises an upstream defect
 * rather than our configuration, and it is annotated in place.
 *
 * @see lib/app/protected-routes.ts · lib/app/auth-landing.ts · lib/app/protected-nav.ts
 */

import { NextRequest } from 'next/server';
import { beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('@/lib/logging/context', () => ({ generateRequestId: vi.fn(() => 'test-request-id') }));
vi.mock('@/lib/security/headers', () => ({ setSecurityHeaders: vi.fn() }));
vi.mock('@/lib/security/rate-limit-middleware', () => ({
  applyRateLimit: vi.fn(async () => null),
}));
vi.mock('@/lib/auth/signup-mode', () => ({ isInviteOnly: vi.fn(() => false) }));

import { AUTH_LANDING_LABEL, AUTH_LANDING_ROUTE } from '@/lib/auth-landing/route';
import { isNavItem, SHELL_NAV } from '@/components/app/shell/nav-items';
import { protectedNavItems } from '@/lib/app/protected-nav';
import { proxy } from '@/proxy';

const SESSION_COOKIE = 'better-auth.session_token';

function request(pathname: string, cookies: Record<string, string> = {}): NextRequest {
  const url = `http://localhost:3000${pathname}`;
  return {
    nextUrl: new URL(url),
    url,
    method: 'GET',
    headers: new Map(),
    cookies: {
      get: (name: string) => (cookies[name] ? { name, value: cookies[name] } : undefined),
    },
  } as unknown as NextRequest;
}

/** The `Location` of a redirect response, or null when it was not one. */
async function redirectTarget(pathname: string, cookies?: Record<string, string>) {
  const response = await proxy(request(pathname, cookies));
  const location = response?.headers.get('location');
  return location ? new URL(location) : null;
}

beforeEach(() => {
  vi.clearAllMocks();
});

describe('the shell is behind the edge gate', () => {
  it.each(['/app', '/app/journey', '/app/situations/3', '/app/anything/at/all'])(
    'redirects a signed-out visitor on %s to login',
    async (pathname) => {
      const target = await redirectTarget(pathname);
      expect(target?.pathname).toBe('/login');
    }
  );

  it('preserves where the visitor was going, so login can return them', async () => {
    const target = await redirectTarget('/app/journey');
    expect(target?.searchParams.get('callbackUrl')).toBe('/app/journey');
  });

  it('lets a signed-in visitor through', async () => {
    const response = await proxy(request('/app', { [SESSION_COOKIE]: 'a-session' }));
    expect(response?.headers.get('location')).toBeNull();
  });

  it('CHARACTERISES a platform defect: a public sibling is locked behind login', async () => {
    // `/apply` is not `/app`, but `proxy.ts` matches with a bare
    // `pathname.startsWith(route)` and no path boundary, so it is protected —
    // as are `/application` and `/appointments`, and, with no fork
    // configuration at all, `/profiles`, `/settings-guide` and `/dashboards`.
    //
    // NOT OURS TO FIX. `proxy.ts` is Sunrise's security middleware and the blob
    // is identical across all three tiers (`9d0d578e`), so the fix has to land
    // upstream or every fork keeps it. Filed as
    // https://github.com/human-centric-engineering/sunrise/issues/758.
    //
    // It is fail-CLOSED — the error only ever over-protects, so nothing is
    // exposed — which is why this is recorded rather than patched here, and why
    // the shell can ship on top of it.
    //
    // Asserted in its CURRENT form on purpose: when Sunrise fixes it this test
    // starts failing, which is the signal to flip the assertion and drop this
    // comment. A test written for the behaviour we want would have gone green
    // on the day of the fix and told us nothing.
    const target = await redirectTarget('/apply');
    expect(target?.pathname).toBe('/login');
  });
});

describe('every door into the app lands at the shell', () => {
  it('resolves the landing route to the shell, not the platform default', () => {
    // The value the platform actually computed — login, OAuth, signup,
    // invite-accept, verify-email and the admin "back to app" all read this one
    // constant, so asserting it here covers all of them at their single source.
    expect(AUTH_LANDING_ROUTE).toBe('/app');
    expect(AUTH_LANDING_ROUTE).not.toBe('/dashboard');
  });

  it('names the destination in the product’s own words', () => {
    // A route without its label is how users end up at `/app` behind a button
    // still reading "Dashboard".
    expect(AUTH_LANDING_LABEL).toBe('Lelañea');
  });

  it('does not reuse a label the shell nav already means differently', () => {
    // "Your journey" is a nav item pointing at `/app/journey`. Using it here too
    // made one phrase mean two destinations, on pages that sit a click apart.
    const navLabels = new Set(SHELL_NAV.filter(isNavItem).map((item) => item.label));
    expect(navLabels).toContain('Your journey');
    expect(navLabels.has(AUTH_LANDING_LABEL)).toBe(false);

    // The platform header names `/app` too, and it had the same collision —
    // found only by sweeping for the phrase after fixing the landing label.
    // Both places that name `/app` must agree with each other and differ from
    // every shell-nav item.
    const headerLabel = protectedNavItems?.find((item) => item.href === '/app')?.label;
    expect(headerLabel).toBe(AUTH_LANDING_LABEL);
    expect(navLabels.has(headerLabel ?? '')).toBe(false);
  });

  it.each(['/login', '/signup', '/reset-password'])(
    'sends a signed-in visitor on %s to the shell',
    async (pathname) => {
      const target = await redirectTarget(pathname, { [SESSION_COOKIE]: 'a-session' });
      expect(target?.pathname).toBe('/app');
    }
  );
});

describe('the platform header does not lead out of the product', () => {
  it('offers no route the product has abandoned', async () => {
    // `/profile` and `/settings` keep the platform frame and the account view
    // links to both, so this header is reachable from inside the shell. Left at
    // the platform default its first item is `/dashboard`.
    const targets = (protectedNavItems ?? []).map((item) => item.href);
    expect(targets).toContain('/app');
    expect(targets).not.toContain('/dashboard');
  });

  it('points at pages a signed-in user can actually reach', async () => {
    for (const item of protectedNavItems ?? []) {
      if (item.adminOnly) continue;
      const response = await proxy(request(item.href, { [SESSION_COOKIE]: 'a-session' }));
      expect(response?.headers.get('location'), `${item.href} bounced`).toBeNull();
    }
  });
});
