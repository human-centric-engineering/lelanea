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
 * ## What went with the catch-all, and what did not
 *
 * A mistyped path under `/app` still leaves the shell for the platform's
 * full-window 404. A segment-level `not-found.tsx` does NOT change that: it
 * renders only when `notFound()` is thrown INSIDE the segment, and only the
 * root `app/not-found.tsx` handles unmatched URLs (`next/dist/docs`,
 * file-conventions/not-found). With the catch-all gone nothing under `/app`
 * throws it, so a boundary here would be a file the router could never reach —
 * which is what a first pass at this task shipped, under a docblock claiming
 * the opposite.
 *
 * Making it reachable needs a catch-all whose only job is to call `notFound()`,
 * which is a different route from the one just deleted and a deliberate
 * non-goal here: the behaviour is the same as `main` ships today, and §05 is
 * where deep links start being produced that can go stale.
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
