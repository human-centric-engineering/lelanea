import type { Metadata } from 'next';

import { PlaceholderCard } from '@/components/app/views/placeholder-view';
import { View } from '@/components/app/views/view';

/**
 * The tab carries the nav item's own words, so browser history can tell seven
 * destinations apart. Every page under `/app` does the same; the layout's
 * `%s` template does the rest.
 */
export const metadata: Metadata = { title: 'Your journey' };

export default function JourneyPage() {
  return (
    <View
      eyebrow="your journey"
      title="Where you have been"
      lede="What was actually discussed, which modules were worked, and what came out of them."
    >
      <PlaceholderCard title="Your sessions, in the order they happened">
        Nothing is recorded here yet. When it is, this page will show what you actually did and
        nothing more — no summary of who you are, and nothing you did not say.
      </PlaceholderCard>
    </View>
  );
}
