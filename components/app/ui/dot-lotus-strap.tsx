import { useId, type CSSProperties } from 'react';

import { cn } from '@/lib/utils';

import styles from '@/components/app/ui/dot-lotus-strap.module.css';

export interface DotLotusStrapProps {
  /** The words, exactly as the caption they stand in for reads. */
  text: string;
  /**
   * Bumped to write it again: each value is a fresh line, so a click that
   * replays the flower replays the words with it.
   */
  run: number;
  /** Show the letters settled, with nothing moving: reduced motion. */
  still: boolean;
}

/**
 * The strapline written on the water (t-184, the prism prototype's
 * `.dl-strap`): an arc of wide-spaced italic along the front of the pond, each
 * letter condensing out of the flower's light once it has opened, flaring
 * bright and settling to cream.
 *
 * Drawn in the flower's own units, so it sits where the prototype puts it at
 * any size: the view box shares the flower's top edge and scale, and runs wider
 * either side for the arc's ends.
 *
 * DECORATION. It is `aria-hidden`; the words are read from the caption it
 * repeats, which stays in the page, visually hidden, so they are heard once.
 * Its letters run only while the flower's clock does (the host's
 * `data-playing`), so a page slow to hydrate, a flower off screen or a hidden
 * tab does not write them over a flower not yet open.
 */
export function DotLotusStrap({ text, run, still }: DotLotusStrapProps) {
  // Ids that cannot clash with a second strap, and that `url(#…)` can carry.
  const id = useId().replace(/[^\w-]/g, '');
  const arc = `${id}-arc`;
  const glow = `${id}-glow`;

  return (
    <svg
      className={cn(styles.strap, still && styles.still)}
      viewBox="-200 -106 400 200"
      aria-hidden="true"
      focusable="false"
      data-testid="dot-lotus-strap"
    >
      <defs>
        <filter id={glow} x="-20%" y="-60%" width="140%" height="220%">
          <feGaussianBlur stdDeviation="1.4" result="b" />
          <feMerge>
            <feMergeNode in="b" />
            <feMergeNode in="SourceGraphic" />
          </feMerge>
        </filter>
        <path id={arc} d="M -124 6 A 124 30 0 0 0 124 6" />
      </defs>
      <text key={run} filter={`url(#${glow})`}>
        <textPath href={`#${arc}`} startOffset="50%" textAnchor="middle">
          {Array.from(text).map((letter, i) => {
            // Its place in the line, which staggers its arrival.
            const place: CSSProperties & Record<'--i', number> = { '--i': i };
            return (
              <tspan key={i} style={place}>
                {/* A plain space collapses inside a run of tspans. */}
                {letter === ' ' ? '\u00a0' : letter}
              </tspan>
            );
          })}
        </textPath>
      </text>
    </svg>
  );
}
