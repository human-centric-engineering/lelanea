import Image from 'next/image';
import Link from 'next/link';

import { Button } from '@/components/app/ui/button';
import { LotusMark } from '@/components/app/ui/lotus-mark';
import { LIGHT_THROUGH_WATER, WAITLIST_ANCHOR } from '@/lib/site/config';
import styles from '@/components/app/site/atmosphere.module.css';

/**
 * The home page's last word (t-171): the lotus on the site's water, and the
 * way in.
 *
 * The page used to end on her channels, with the only waitlist form a long
 * scroll back up. This closes it the way the header does — the same action,
 * to the same form — without a sentence of persuasion: the page above has
 * said what this is, in her words, and the band only offers the door.
 */
export function ClosingBand() {
  return (
    <section className={styles.closing} aria-labelledby="closing-heading">
      <Image src={LIGHT_THROUGH_WATER} alt="" fill sizes="(max-width: 1180px) 100vw, 1180px" />
      <div className={styles.closingInner}>
        {/* Decorative: the heading beside it says what this is. */}
        <LotusMark size={76} water />
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
