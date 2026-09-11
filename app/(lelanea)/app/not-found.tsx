import Link from 'next/link';

import { View } from '@/components/app/views/view';
import { cn } from '@/lib/utils';

/**
 * A bad path under `/app` still 404s — it just does it inside the shell.
 *
 * The `[...slug]` catch-all this replaces resolved only the paths the nav
 * actually offered, and deliberately let everything else fall through, so that
 * a typo or a stale link did not become a page that looked deliberate. That
 * property is kept: this is a real 404 with a real status, not a page.
 *
 * What changes is where it renders. Without a `not-found.tsx` at this segment
 * the platform's own root one takes over the whole window, so a mistyped URL
 * replaced the four-column frame and left the back button as the only way home
 * — the same defect the catch-all was written to close, arriving through the
 * other door. A segment-level boundary renders inside this layout instead, with
 * every destination still one click away in the nav.
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
