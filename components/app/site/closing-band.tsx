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
 * The ground follows the page theme, as the bands above it do (t-178, the
 * prism): a soft pool of light behind the bloom, pale in light and a deepening
 * of the umber in dark. It was deep teal water, dark in both themes; in the
 * prism the light is the page's, and a dark slab at its foot would shut it out.
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
