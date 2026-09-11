import type { Metadata } from 'next';

import { PlaceholderCard } from '@/components/app/views/placeholder-view';
import { View } from '@/components/app/views/view';

export const metadata: Metadata = { title: 'Share with Lelañea' };

export default function SharePage() {
  return (
    <View
      eyebrow="share with lelañea"
      title="Lelañea would love to hear about your experiences"
      lede="Tell us how you are finding it."
      note="What helped and what got in the way are equally useful."
    >
      <PlaceholderCard title="A place to say what is working, and what is not">
        There is nothing to send from here yet. Until there is, anything you want to tell us is
        welcome by the address on the site.
      </PlaceholderCard>
    </View>
  );
}
