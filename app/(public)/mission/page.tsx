import type { Metadata } from 'next';

import { Eyebrow } from '@/components/app/ui/eyebrow';

export const metadata: Metadata = {
  title: 'The mission',
  description: 'Why this exists, who it is for, and what it is trying to change.',
  alternates: { canonical: '/mission' },
};

/**
 * `/mission` — a deliberate placeholder (B31).
 *
 * The authored copy for this page is t-6's, and t-6 replaces this file whole.
 * It exists at t-5 because the site frame this task ships links to it from both
 * the header and the footer, and the design keeps those links: a route that
 * 404s is a worse answer than a page that says the words are coming.
 *
 * B31's three honest options are omit the affordance, ship a deliberate stub
 * that says what it is, or build the mechanism. The nav links are the design and
 * the copy is another task, so this is the stub — the same call the waitlist
 * card makes on the home page.
 */
export default function MissionPage() {
  return (
    <div className="mx-auto max-w-[1180px] px-[clamp(20px,5vw,72px)] py-[clamp(56px,7vw,92px)]">
      <Eyebrow as="p">the mission</Eyebrow>
      <h1 className="brand-display mt-[18px] max-w-[20ch] text-[clamp(34px,3.9vw,48px)]">
        The journey inward should never be reserved for the privileged.
      </h1>
      <p className="text-muted-foreground mt-6 max-w-[62ch] text-[17px] leading-[1.7]">
        This page is being written. Its words are hers, and they are set down rather than
        paraphrased, so it arrives when it is ready rather than as a summary of itself.
      </p>
    </div>
  );
}
