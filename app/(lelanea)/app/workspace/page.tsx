import type { Metadata } from 'next';

import { PlaceholderCard } from '@/components/app/views/placeholder-view';
import { View } from '@/components/app/views/view';

export const metadata: Metadata = { title: 'Workspace' };

/**
 * The one destination that is a placeholder for a reason other than its own.
 *
 * The nav item means "back to the module you are in", and nothing opens a
 * module until §05 `f-skeleton`. So this page stands in for a module rather
 * than for a feature of its own, and it is the page that disappears when the
 * nav item starts resolving to the last module visited.
 *
 * It is a real route rather than the `[...slug]` catch-all it replaces: once
 * every other destination had a page of its own, the catch-all answered exactly
 * one path, and a catch-all that answers one known path is a route nobody can
 * find from the file tree.
 *
 * ## The catch-all beside it is a different route with a different job
 *
 * `[...slug]/page.tsx` is back, and it is not t-9's. That one RESOLVED each
 * destination and rendered a placeholder; this one renders nothing and exists
 * only to call `notFound()`, so the segment's `not-found.tsx` can be reached at
 * all. t-11 argued that was a non-goal — the behaviour matched what `main`
 * shipped, and §05 was where stale deep links would start appearing. The owner
 * ruled otherwise at close-out (t-21): falling out of the frame on a typo is a
 * shell defect, and the shell is what §04 is for.
 *
 * A real route beats a catch-all, so this page is unaffected by it.
 */
export default function WorkspacePage() {
  return (
    <View
      eyebrow="workspace"
      title="Where the work happens"
      lede="Whatever you open lands here, beside the conversation rather than instead of it."
    >
      <PlaceholderCard title="No module is open yet">
        Modules arrive with the framework itself. Until then the nav brings you here, and the
        conversation stays exactly where you left it.
      </PlaceholderCard>
    </View>
  );
}
