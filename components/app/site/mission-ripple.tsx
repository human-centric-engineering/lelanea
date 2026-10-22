import Image from 'next/image';

import { LIGHT_THROUGH_WATER } from '@/lib/site/config';
import { cn } from '@/lib/utils';
import styles from '@/components/app/site/mission-ripple.module.css';

/**
 * The mission's one idea, drawn (t-171).
 *
 * `the_mission` moves in a single direction: one awakened life, and from it an
 * influence on "families, communities, workplaces, institutions, and
 * cultures". This is that sentence as a picture — a life at the centre of the
 * water, and the circles it widens into, each named with her own word.
 *
 * Where the browser supports scroll-driven animation, the rings arrive one at
 * a time as the reader moves down the page, so the picture widens as the text
 * does. Elsewhere, and for anyone who asks for less motion, they are simply
 * all there.
 *
 * The words are single words from her sentence, not a paraphrase of it. The
 * figure carries its meaning in `aria-label`, and the visible labels are
 * hidden from assistive technology so it is not read twice.
 */
const CENTRE = 'one awakened life';
// Five, matching the five ring sizes in `mission-ripple.module.css`.
const RINGS = ['families', 'communities', 'workplaces', 'institutions', 'cultures'];

export function MissionRipple({ className }: { className?: string }) {
  return (
    <figure
      className={cn(styles.panel, className)}
      role="img"
      aria-label={`${CENTRE}, widening to ${RINGS.join(', ')}`}
    >
      <Image
        src={LIGHT_THROUGH_WATER}
        alt=""
        fill
        priority
        sizes="(max-width: 1100px) 100vw, 40vw"
        className={styles.water}
      />

      <div className={styles.ripple} aria-hidden="true">
        {RINGS.map((word) => (
          <div key={word} className={styles.ring}>
            <span className={styles.word}>{word}</span>
          </div>
        ))}
        <div className={styles.centre}>
          <span>{CENTRE}</span>
        </div>
      </div>
    </figure>
  );
}
