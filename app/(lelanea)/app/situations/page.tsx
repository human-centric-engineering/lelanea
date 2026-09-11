import type { Metadata } from 'next';

import { PlaceholderCard } from '@/components/app/views/placeholder-view';
import { View } from '@/components/app/views/view';

export const metadata: Metadata = { title: 'Life situations' };

export default function SituationsPage() {
  return (
    <View
      eyebrow="life situations"
      title="What you are living through"
      lede="Work through life’s situations as they arise."
      note="A situation is something going on in your life while you work through the modules — a decision that will not settle, a relationship under strain, a difficult week."
    >
      <PlaceholderCard title="Somewhere to keep one while it is happening">
        You cannot open a situation yet. When you can, it will be yours to add to as it develops,
        and it will give context to the conversation rather than replacing it.
      </PlaceholderCard>
    </View>
  );
}
