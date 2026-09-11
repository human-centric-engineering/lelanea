/**
 * Nothing between the root and a page under `/app` may suspend.
 *
 * ## Why this is a file of its own
 *
 * These two cases were written in t-21 and lived in
 * `tests/unit/app/shell-not-found.test.tsx`, which imports the 404 boundary and
 * the route that throws — so the module graph reaches that file whenever either
 * of those changes. It does NOT reach it for the change these two cases exist
 * to catch: adding `app/(lelanea)/app/loading.tsx`, or wrapping `{children}` in
 * a `<Suspense>` in a layout, touches neither imported module. A scoped run
 * would skip the guard on precisely the branch that breaks it.
 *
 * So they move here, to a file with no imports at all, declared in
 * `ALWAYS_RUN_TESTS`. It could not simply be declared in place: `.test.tsx` is
 * rejected outright by `validateAlwaysRun` and the rejection aborts the runner
 * (`sunrise#763`), and the render cases it would have taken with it genuinely
 * need JSX. `/code-review` found the gap while reviewing t-22.
 *
 * ## What is at stake
 *
 * Next returns `200` for a streamed response and `404` only for one that has
 * not begun streaming, because by then the headers are gone (`next/dist/docs`,
 * file-conventions/loading, "Status Codes"). Streaming starts when a Suspense
 * fallback renders. Break either condition below and every mistyped URL under
 * `/app` becomes a soft 404 — with nothing failing anywhere else.
 *
 * @see app/(lelanea)/app/[...slug]/page.tsx
 * @see .context/app/shell.md — "Five things that break silently"
 */
import { existsSync, readFileSync } from 'node:fs';
import path from 'node:path';

import { describe, expect, it } from 'vitest';

const SHELL_DIR = path.join(process.cwd(), 'app', '(lelanea)', 'app');

/**
 * Every directory whose `layout` or `loading` sits between the root and the
 * catch-all — the segment's own folder included, since `loading` wraps the
 * `page` beside it.
 */
const LAYOUT_CHAIN_DIRS = [
  path.join(process.cwd(), 'app'),
  path.join(process.cwd(), 'app', '(lelanea)'),
  SHELL_DIR,
  path.join(SHELL_DIR, '[...slug]'),
];

/**
 * Does any `<Suspense>` in this source contain `{children}`?
 *
 * Brace-counted rather than matched to the next `</Suspense>`, so a nested
 * boundary cannot end the outer one early and hide a `{children}` beyond it.
 */
function suspenseWrappingChildren(source: string): boolean {
  const open = /<Suspense[\s>]/g;
  let match: RegExpExecArray | null;
  while ((match = open.exec(source)) !== null) {
    let depth = 0;
    for (let i = match.index; i < source.length; i += 1) {
      if (source.startsWith('</Suspense', i)) {
        depth -= 1;
        if (depth === 0) {
          if (source.slice(match.index, i).includes('{children}')) return true;
          break;
        }
      } else if (source.startsWith('<Suspense', i)) {
        depth += 1;
      }
    }
  }
  return false;
}

describe('the conditions the 404 status depends on', () => {
  it('has no loading file at any level of the chain, in any spelling', () => {
    // The segment's OWN folder is included, because `loading` wraps the `page`
    // beside it — the first version of this guard checked the three levels
    // above and missed the one place a `loading` file would most obviously be
    // put. All four extensions Next accepts, for the same reason: a `.js` one
    // would have sailed past a `.tsx`-only check.
    for (const dir of LAYOUT_CHAIN_DIRS) {
      for (const ext of ['tsx', 'ts', 'jsx', 'js']) {
        const candidate = path.join(dir, `loading.${ext}`);
        expect(existsSync(candidate), `${candidate} would stream the response`).toBe(false);
      }
    }
  });

  it('has no Suspense boundary wrapping children in any layout above it', () => {
    // Next's own `loading.js` documentation recommends wrapping a layout's
    // runtime data access in its own `<Suspense>` for instant navigation — and
    // `app/(lelanea)/app/layout.tsx` awaits `getServerSession()`, so it is a
    // natural candidate.
    //
    // A bare `<Suspense>` is NOT the finding: the root layout has one today,
    // wrapping `UserIdentifier` and `PageTracker` as siblings of `{children}`,
    // which streams nothing in this path.
    for (const layout of LAYOUT_CHAIN_DIRS.map((dir) => path.join(dir, 'layout.tsx'))) {
      if (!existsSync(layout)) continue;
      const source = readFileSync(layout, 'utf8');
      expect(suspenseWrappingChildren(source), `${layout} streams before the page throws`).toBe(
        false
      );
    }
  });

  it('is looking at a chain that exists', () => {
    // Two of the four directories are route groups whose names contain
    // brackets and parentheses. A rename would leave every case above passing
    // against nothing — "could not look" wearing the shape of "found nothing".
    expect(existsSync(SHELL_DIR)).toBe(true);
    expect(existsSync(path.join(SHELL_DIR, 'layout.tsx'))).toBe(true);
    expect(existsSync(path.join(SHELL_DIR, '[...slug]', 'page.tsx'))).toBe(true);
  });
});
