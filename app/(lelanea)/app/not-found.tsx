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
