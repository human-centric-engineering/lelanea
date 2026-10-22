import Link from 'next/link';

import { PondBloom } from '@/components/app/site/pond-bloom';
import { Button } from '@/components/app/ui/button';
import { WAITLIST_ANCHOR } from '@/lib/site/config';
import styles from '@/components/app/site/atmosphere.module.css';

/**
 * The home page's last word (t-171): the lotus on a pond at dusk, opening as
 * the reader arrives, and the way in.
 *
 * The page used to end on her channels, with the only waitlist form a long
 * scroll back up. This closes it the way the header does — the same action,
 * to the same form — without a sentence of persuasion: the page above has
 * said what this is, in her words, and the band only offers the door.
 *
 * The ground is the lotus's own deep water — its pad and edge teals — rather
 * than the light-through-water picture `/mission` carries: the one place on
 * the site that goes dark, so the bloom is the brightest thing in it.
 */
export function ClosingBand() {
  return (
    <section className={styles.closing} aria-labelledby="closing-heading">
      {/* Rings spreading slowly from beneath the bloom. Decorative. */}
      <div className={styles.pondRings} aria-hidden="true">
        <span />
        <span />
        <span />
      </div>

      <div className={styles.closingInner}>
        {/* Decorative: the heading beneath it says what this is. */}
        <div className={styles.closingBloom} aria-hidden="true">
          <PondBloom />
        </div>
        <h2 id="closing-heading" className={`brand-eyebrow ${styles.closingEyebrow}`}>
          when you are ready
        </h2>
        <Button asChild>
          <Link href={`/#${WAITLIST_ANCHOR}`}>Join the waitlist</Link>
        </Button>
      </div>
    </section>
  );
}
