import { cn } from '@/lib/utils';
import styles from '@/components/app/site/atmosphere.module.css';

/**
 * Water rings spreading out from a point, drawn with the lotus's own ripple
 * colours (t-171).
 *
 * The lotus sits on water everywhere else on the site, and these are that water
 * carried onto the page: behind the quote band, as the ground her words sit
 * on, and at the foot of the journey path. Kept very faint — the strongest ring
 * is at a fraction of the ripple sage — because their job is atmosphere, not
 * illustration.
 *
 * Decorative only: `aria-hidden`, no title, pointer events off.
 */
export function Ripples({ className, rings = 5 }: { className?: string; rings?: number }) {
  return (
    <svg
      className={cn(styles.ripples, className)}
      viewBox="0 0 800 240"
      preserveAspectRatio="xMidYMid meet"
      aria-hidden="true"
      focusable="false"
    >
      {Array.from({ length: rings }, (_, index) => {
        const step = index + 1;
        return (
          <ellipse
            key={index}
            cx="400"
            cy="120"
            rx={70 * step}
            ry={21 * step}
            fill="none"
            // Near rings in the ripple sage, far ones in its lighter step, each
            // fainter than the one inside it, as a ring loses height spreading.
            stroke={index < 2 ? 'var(--color-lotus-ripple)' : 'var(--color-lotus-ripple-far)'}
            strokeOpacity={0.34 - index * 0.055}
            strokeWidth={1}
            vectorEffect="non-scaling-stroke"
          />
        );
      })}
    </svg>
  );
}
