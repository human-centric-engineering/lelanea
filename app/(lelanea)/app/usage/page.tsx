import type { Metadata } from 'next';

import { PlaceholderCard } from '@/components/app/views/placeholder-view';
import { View } from '@/components/app/views/view';

export const metadata: Metadata = { title: 'Usage and billing' };

export default function UsagePage() {
  return (
    <View
      eyebrow="usage and billing"
      title="What you have spent"
      lede="A running total against a budget you set, so nothing is spent on your behalf without you seeing it."
    >
      <PlaceholderCard title="Nothing has been charged, and there is no card on file">
        Lelañea is not calling a model for you yet, so there is nothing to meter. When there is, you
        will see what it costs before it is spent rather than after.
      </PlaceholderCard>
    </View>
  );
}
