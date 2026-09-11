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
