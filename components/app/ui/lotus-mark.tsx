import { useId } from 'react';

import { cn } from '@/lib/utils';

import {
  LOTUS_CORE,
  LOTUS_FRAMES,
  LOTUS_ORIGIN,
  LOTUS_RIPPLES,
  LOTUS_RIPPLE_CY,
  LOTUS_TIERS,
  lotusFrameSize,
} from '@/components/app/ui/lotus-geometry';

export interface LotusMarkProps {
  /**
   * The rendered width of the BLOOM in pixels — not of the SVG frame.
   *
   * §6.6: "`size` is the rendered width of the bloom rather than of the SVG
   * frame, so the two are interchangeable at the same size." A 32px `LotusMark`
   * and a 32px `Lotus` show the same bloom; the water frame around it is simply
   * wider. See `LotusFrame.bloomFraction`.
   */
  size?: number;
  /** Include the sage ripples. §6.6 says drop them under about 40px. */
  water?: boolean;
  className?: string;
}

/**
 * The lotus as a still glyph — avatars, favicons, the 16px mark above a pull
 * quote, the inline mark beside her name (§6.7).
 *
 * This is `Lotus` with every petal already at rest and nothing that moves, and
 * it is a separate component rather than `<Lotus open idle={false} />` because
 * of what that would drag along: a client component, three `useState`s, a
 * `matchMedia` subscription and an effect, for a glyph. This one is a server
 * component and renders to markup.
 *
 * DECORATIVE BY DEFAULT. `aria-hidden` is unconditional here: every use §6.7
 * names sits beside the name it stands for, so announcing it would repeat that
 * name. Where the mark is the *only* content of a link — the prototype's nav
 * does exactly this — label the LINK, as `aria-label` on an `<a>` wrapping this,
 * rather than reaching for a `label` prop that would make one component do two
 * accessibility jobs.
 *
 * @see .context/app/planning/lelanea-product-description.md §6.6, §6.9
 */
export function LotusMark({ size = 32, water = true, className }: LotusMarkProps) {
  // Two marks on one page would otherwise share a gradient id, and the second
  // would paint with the first's. `useId` is stable across server and client.
  const gradientId = `lotus-mark-core-${useId().replace(/:/g, '')}`;
  const frame = water ? LOTUS_FRAMES.water : LOTUS_FRAMES.tight;
  const { width, height } = lotusFrameSize(size, frame);

  return (
    <svg
      width={Math.round(width)}
      height={Math.round(height)}
      viewBox={frame.box}
      className={cn(className)}
      aria-hidden="true"
      focusable="false"
    >
      <defs>
        <radialGradient id={gradientId} cx="50%" cy="42%" r="60%">
          <stop offset="0%" stopColor="var(--color-lotus-core-light)" />
          <stop offset="55%" stopColor="var(--color-lotus-core)" />
          <stop offset="100%" stopColor="var(--color-lotus-core-deep)" />
        </radialGradient>
      </defs>

      {water && (
        <g fill="none" strokeLinecap="round">
          {LOTUS_RIPPLES.map((ripple) => (
            <ellipse
              key={ripple.rx}
              cx={LOTUS_ORIGIN.x}
              cy={LOTUS_RIPPLE_CY}
              rx={ripple.rx}
              ry={ripple.ry}
              stroke={ripple.stroke}
              strokeOpacity={ripple.opacity}
              strokeWidth={ripple.width}
            />
          ))}
        </g>
      )}

      {LOTUS_TIERS.map((tier) => (
        <g
          key={tier.fill}
          fill={tier.fill}
          stroke={tier.stroke}
          strokeWidth={frame.stroke}
          strokeLinejoin="round"
        >
          {tier.angles.map((angle) => (
            <path
              key={angle}
              d={tier.d}
              transform={`rotate(${angle} ${LOTUS_ORIGIN.x} ${LOTUS_ORIGIN.y})`}
            />
          ))}
        </g>
      ))}

      <ellipse
        cx={LOTUS_CORE.cx}
        cy={LOTUS_CORE.cy}
        rx={LOTUS_CORE.rx}
        ry={LOTUS_CORE.ry}
        fill={`url(#${gradientId})`}
      />
    </svg>
  );
}
