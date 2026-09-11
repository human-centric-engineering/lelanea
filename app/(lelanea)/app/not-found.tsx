import Link from 'next/link';

import { View } from '@/components/app/views/view';
import { cn } from '@/lib/utils';

/**
 * A bad path under `/app` still 404s — it just does it inside the shell.
 *
 * ## It takes two files, and a first attempt shipped only this one
 *
 * A nested `not-found.tsx` renders ONLY when `notFound()` is thrown inside its
 * own segment's subtree. Unmatched URLs are handled by the root boundary and
 * nothing else. So this file on its own is unreachable — which is exactly what
 * t-11 shipped, under a docblock claiming it closed the defect it did not
 * close, until `/code-review` caught it and it was deleted.
 *
 * What makes it reachable is `[...slug]/page.tsx` beside it, whose only job is
 * to throw. Read that file for why it is synchronous; the short version is that
 * the HTTP status depends on it.
 *
 * ## It is a 404, not a page that looks like one
 *
 * t-9's catch-all was careful to resolve only the paths the nav actually
 * offered and let everything else fall through, so a typo or a stale link never
 * became a destination that looked deliberate. That property is kept here and
 * is the reason the throwing route renders nothing of its own: the status is a
 * real 404, the `noindex` Next injects is real, and all this file changes is
 * WHERE it is drawn — inside the frame, with every destination still one click
 * away in the nav, instead of over the top of it.
 *
 * ## It surfaces a React 19 warning that belongs to Sunrise
 *
 * In DEV ONLY, and only on this page, the console carries "Encountered a script
 * tag while rendering React component", pointing at `app/layout.tsx`'s no-flash
 * theme script. Rendering this boundary makes React client-render the root
 * layout, and React 19 warns whenever it encounters a `<script>` there.
 *
 * Both halves of that were tested rather than reasoned, after two confident and
 * wrong explanations: the ROOT 404 (`/nonsense`) is clean, which is what
 * isolates this boundary as the trigger; and a production build of this very
 * path is clean too, which is what makes it dev-only. The warning string exists
 * only in React's `.development.js` bundles — zero occurrences in every
 * production one — so it cannot ship.
 *
 * The TRIGGER is here; the CAUSE is not. An inline script in the root layout is
 * the standard way to set the theme before first paint, and React 19 warns
 * about all of them — `next-themes`, shadcn and HeroUI carry the same report.
 * It is a false positive for this use: the script is in the served HTML and
 * runs on SSR, which is its whole job, and the warning does not ship to
 * production. `app/layout.tsx` is byte-identical in Sunrise and Daybreak (only
 * the script's BODY diverges here, per divergence rows 1 and 2), so the remedy
 * — `useServerInsertedHTML`, or accepting it — is Sunrise's call, not a leaf's.
 *
 * Filed as `sunrise#769` rather than worked around here. Removing this boundary to
 * silence a dev-only warning would give back the defect the whole task exists
 * to close.
 *
 * ## Two things it is worse at than a full-page 404, both accepted
 *
 * **The tab says only "Lelañea".** Next resolves no `metadata` export from a
 * `not-found` file — the docs' metadata section covers `global-not-found.js`
 * alone — so this inherits the layout's `default` title while every real
 * destination exports its own. t-9 recorded tab-indistinguishability as a
 * defect worth fixing, and this is a narrower version of it: there is one 404
 * page rather than seven identical destinations, so nothing is confusable with
 * anything else. Recorded rather than fixed, because the fix is
 * `global-not-found.js` — experimental, and it bypasses the layout, which is
 * the one thing this file exists to keep.
 *
 * **The nav can contradict the heading.** On `/app/journey/typo` the nav still
 * marks "Your journey" with `aria-current="page"`, because it prefix-matches —
 * correctly, since a real child route of a section IS in that section, and §05
 * needs that for modules opening under `/app/workspace`. Here the child does
 * not exist, so a screen-reader user is told the current page is "Your journey"
 * while the heading says there is nothing at that address. The nav cannot know
 * the route 404'd; the only fix is exact matching, which would break §05. Left,
 * and written down, because the alternative is a silent regression there.
 */
export default function ShellNotFound() {
  return (
    <View
      eyebrow="not found"
      title="There is nothing at that address"
      lede="The link may be old, or the address mistyped."
    >
      <p className="text-muted-foreground text-sm leading-relaxed">
        Everything Lelañea offers is in the nav on the left.{' '}
        <Link
          href="/app"
          className={cn(
            'text-[var(--color-heading)] underline underline-offset-4',
            'focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-solid',
            'focus-visible:outline-[var(--color-ring)]'
          )}
        >
          Return to the conversation
        </Link>
        .
      </p>
    </View>
  );
}
