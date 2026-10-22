import Image from 'next/image';

import { LotusMark } from '@/components/app/ui/lotus-mark';
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
 * The words are single words from her sentence, not a paraphrase of it, and
 * `mission-ripple.test.tsx` fails if one stops appearing in her text. The
 * figure carries its meaning in `aria-label`, and the visible labels are
 * hidden from assistive technology so it is not read twice.
 */
export const RIPPLE_CENTRE = 'one awakened life';
// Five, matching the five ring sizes in `mission-ripple.module.css`.
export const RIPPLE_RINGS = ['families', 'communities', 'workplaces', 'institutions', 'cultures'];

export function MissionRipple({
  className,
  captions = [],
}: {
  className?: string;
  /**
   * Up to three of her sentences, shown one after another above the rings as
   * they grow — the page picks them out of the mission, so they are hers and
   * never retyped here. Hidden where the panel is a wide band, with no room.
   */
  captions?: ReadonlyArray<string>;
}) {
  return (
    <figure
      className={cn(styles.panel, className)}
      role="img"
      aria-label={`${RIPPLE_CENTRE}, widening to ${RIPPLE_RINGS.join(', ')}`}
    >
      {/* The stage holds the drawing in view: on a desktop the water runs
          the full height of the page beside the text, and the rings stay with
          the reader as they scroll. */}
      <div className={styles.stage}>
        {/* The water is drawn at the stage's size — a screen high — rather
            than stretched down the whole page, where it would turn blocky. */}
        <Image
          src={LIGHT_THROUGH_WATER}
          alt=""
          fill
          priority
          sizes="(max-width: 1100px) 100vw, 45vw"
          className={styles.water}
        />
        {captions.length === 0 ? null : (
          <div className={styles.captions} aria-hidden="true">
            {captions.slice(0, 3).map((caption) => (
              <p key={caption} className={styles.caption}>
                {caption}
              </p>
            ))}
          </div>
        )}

        {/* The bloom the rings come from, resting at the foot of the panel. */}
        <div className={styles.foot} aria-hidden="true">
          <LotusMark size={58} water={false} />
          <span className="brand-eyebrow">the mission</span>
        </div>

        <div className={styles.ripple} aria-hidden="true">
          {RIPPLE_RINGS.map((word) => (
            <div key={word} className={styles.ring}>
              <span className={styles.word}>{word}</span>
            </div>
          ))}
          <div className={styles.centre}>
            <span>{RIPPLE_CENTRE}</span>
          </div>
        </div>
      </div>
    </figure>
  );
}
