import type { Metadata } from 'next';

import { Eyebrow } from '@/components/app/ui/eyebrow';

export const metadata: Metadata = {
  // `absolute` opts out of the group template `%s - Lelañea`, which would
  // otherwise render this page's tab and search result as "Lelañea - Lelañea".
  // The other two stubs need no such escape: "The mission - Lelañea" reads
  // correctly.
  title: { absolute: 'Lelañea' },
  description: 'Her philosophy, the lineage she draws on, and the person behind the work.',
  alternates: { canonical: '/lelanea' },
  // REMOVE THIS WITH THE PLACEHOLDER COPY (t-6).
  //
  // All three stubs render the same sentence word for word, `robots.ts` allows
  // everything outside /api and /admin, and the sitemap submits them. Left
  // indexable, Google's first impression of the site is three near-duplicate
  // thin pages — and `lastModified` says "changed just now" on every
  // regeneration, so it keeps re-crawling them. `noindex` costs nothing while
  // there is nothing to read and comes off with the real copy.
  robots: { index: false },
};

/**
 * `/lelanea` — a deliberate placeholder (B31).
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
export default function LelaneaPage() {
  return (
    <div className="mx-auto max-w-[1180px] px-[clamp(20px,5vw,72px)] py-[clamp(56px,7vw,92px)]">
      <Eyebrow as="p">the heart behind lelañea</Eyebrow>
      <h1 className="brand-display mt-[18px] max-w-[20ch] text-[clamp(34px,3.9vw,48px)]">
        The intent and philosophy of Lelañea
      </h1>
      <p className="text-muted-foreground mt-6 max-w-[62ch] text-[17px] leading-[1.7]">
        This page is being written. Its words are hers, and they are set down rather than
        paraphrased, so it arrives when it is ready rather than as a summary of itself.
      </p>
    </div>
  );
}
