// @vitest-environment happy-dom

/**
 * A path under `/app` that matches nothing 404s INSIDE the shell.
 *
 * ## Two files, and neither works alone
 *
 * `not-found.tsx` renders only when `notFound()` is thrown inside its own
 * segment; unmatched URLs reach the ROOT boundary and nothing else. t-11
 * shipped the boundary without anything to throw and it was unreachable — a
 * file under a docblock claiming it closed the defect it did not close. So the
 * pairing is the property, and it is asserted as a pairing.
 *
 * ## The streaming guards live next door
 *
 * The two cases asserting that nothing above `/app` suspends have moved to
 * `tests/unit/app/shell-not-found-streaming.test.ts`, which imports nothing and
 * is declared in `ALWAYS_RUN_TESTS`. They had to: this file imports the
 * boundary and the throwing route, so the module graph reaches it when either
 * changes — but NOT when someone adds a `loading.tsx` or a `<Suspense>`, which
 * is the only change those two exist to catch. `/code-review` found that while
 * reviewing t-22.
 *
 * ## The status code is structural, not behavioural
 *
 * Next returns `200` for a STREAMED response and `404` only for one that has
 * not begun streaming, because by then the headers are gone (`next/dist/docs`,
 * file-conventions/loading, "Status Codes"). Streaming starts when a Suspense
 * fallback renders — a `loading.tsx` in the path, or a component suspending —
 * so the docs say to call `notFound()` "before those boundaries and before any
 * `await` that may suspend".
 *
 * Neither condition is observable from a render in this environment: `vitest`
 * has no HTTP response to inspect, and `notFound()` throwing is the same event
 * whether the status ends up 404 or 200. What CAN be checked is the two
 * structural facts the status depends on — the route is synchronous, and there
 * is no `loading.tsx` above it — and those are precisely what a later change
 * breaks silently. Someone adding a shell-wide loading state would turn every
 * 404 here into a 200 with nothing failing anywhere.
 *
 * @see app/(lelanea)/app/[...slug]/page.tsx
 */

import { render, screen } from '@testing-library/react';
import { readFileSync } from 'node:fs';
import path from 'node:path';
import { describe, expect, it, vi } from 'vitest';

const notFound = vi.hoisted(() =>
  vi.fn(() => {
    throw new Error('NEXT_NOT_FOUND');
  })
);
vi.mock('next/navigation', () => ({ notFound, usePathname: () => '/app/nonsense' }));

import ShellNotFound from '@/app/(lelanea)/app/not-found';
import ShellUnknownPath from '@/app/(lelanea)/app/[...slug]/page';

const SHELL_DIR = path.join(process.cwd(), 'app', '(lelanea)', 'app');

/**
 * Read the catch-all's source with COMMENTS STRIPPED, the way
 * `tokens-only.test.ts` does.
 *
 * Its docblock explains why it must not read `SHELL_NAV` and must not `await`,
 * so without this every rule below matches its own explanation and the file
 * fails for documenting itself. Both assertions did exactly that on the first
 * run.
 */
/**
 * Read the catch-all's source with COMMENTS STRIPPED, the way
 * `tokens-only.test.ts` does.
 *
 * Its docblock explains why it must not read `SHELL_NAV` and must not `await`,
 * so without this every rule below matches its own explanation and the file
 * fails for documenting itself. Both assertions did exactly that on the first
 * run.
 */
function catchAllSource(): string {
  const raw = readFileSync(path.join(SHELL_DIR, '[...slug]', 'page.tsx'), 'utf8');
  return raw.replace(/\/\*[\s\S]*?\*\//g, '').replace(/^\s*\/\/.*$/gm, '');
}

describe('the route that makes the boundary reachable', () => {
  it('throws rather than rendering anything of its own', () => {
    expect(() => ShellUnknownPath()).toThrow('NEXT_NOT_FOUND');
    expect(notFound).toHaveBeenCalled();
  });

  it('does not read the nav, so it cannot grow back into t-9’s catch-all', () => {
    // NAMED FOR WHAT IT CHECKS. This is a source-shape guard, not a routing
    // one: it cannot observe precedence, and an earlier version of it was
    // called "resolves no destination" — a claim a string match has no way to
    // make. What proves the route resolves nothing is the throw above; this
    // only stops the file drifting back toward t-9's shape, where it read
    // `SHELL_NAV` and rendered a placeholder per destination.
    const source = catchAllSource();
    expect(source).not.toContain('SHELL_NAV');
    expect(source).not.toContain('destinationFor');
  });
});

describe('what the reader is shown', () => {
  it('says plainly that there is nothing there', () => {
    render(<ShellNotFound />);
    expect(screen.getByRole('heading', { level: 1 }).textContent).toBe(
      'There is nothing at that address'
    );
  });

  it('offers the way back, rather than leaving the back button as the only exit', () => {
    // The whole point of rendering inside the frame: the nav is still there.
    // This link is the belt to that braces — and the thing a reader who arrived
    // from a stale external link, with no history to go back to, actually needs.
    render(<ShellNotFound />);
    expect(
      screen.getByRole('link', { name: /Return to the conversation/ }).getAttribute('href')
    ).toBe('/app');
  });

  it('is a view like any other, so it reads as a place and not as an error', () => {
    render(<ShellNotFound />);
    expect(screen.getByRole('main')).toBeTruthy();
    expect(screen.getByText('not found')).toBeTruthy();
  });
});
