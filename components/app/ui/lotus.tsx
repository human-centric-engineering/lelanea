'use client';

import { useEffect, useId, useState } from 'react';

import { cn } from '@/lib/utils';

import {
  LOTUS_CORE,
  LOTUS_EASE,
  LOTUS_FRAMES,
  LOTUS_GLINT,
  LOTUS_OPEN_MS,
  LOTUS_ORIGIN,
  LOTUS_PETAL_STAGGER,
  LOTUS_RIPPLES,
  LOTUS_RIPPLE_CY,
  LOTUS_TIERS,
  LOTUS_VEIN_ANGLES,
  LOTUS_VEIN_D,
  lotusFrameSize,
} from '@/components/app/ui/lotus-geometry';
import { useReducedMotion } from '@/components/app/ui/use-reduced-motion';
import styles from '@/components/app/ui/lotus.module.css';

/** The origin every petal rotates about, as a CSS `transform-origin`. */
const PETAL_ORIGIN = `${LOTUS_ORIGIN.x}px ${LOTUS_ORIGIN.y}px`;

/**
 * How long after the petals start moving `onOpened` fires.
 *
 * Longer than `LOTUS_OPEN_MS` because the last petal does not START until its
 * tier's delay has elapsed: the outer tier waits 340ms and then staggers six
 * petals at 70ms each. 2400ms is the kit's figure and covers the whole cascade.
 */
const LOTUS_OPENED_MS = 2400;

export interface LotusProps {
  /** Rendered width of the bloom in pixels — see `LotusMark`'s note on `size`. */
  size?: number;
  /** Drive the bloom yourself. Passing this disables `autoOpen` entirely. */
  open?: boolean;
  /** Open on mount without being told to. Ignored when `open` is supplied. */
  autoOpen?: boolean;
  /** Breathe once open (§6.9). */
  idle?: boolean;
  /** Include the sage ripples and the halation behind them. */
  water?: boolean;
  /** Milliseconds to wait before opening. */
  delay?: number;
  /** Fired once the last petal has come to rest. */
  onOpened?: () => void;
  className?: string;
}

/**
 * The signature bloom: three tiers of petals that fan open, then breathe.
 *
 * §6.9 is explicit that this is "the app's opening gesture rather than a loading
 * state" — it opens once per session and is ambient afterwards. Nothing here
 * waits on it; a caller that needs to sequence something after it takes
 * `onOpened`.
 *
 * ## Why the petals are drawn already rotated, and animate their scale
 *
 * Each petal's resting `transform` is its own `rotate(angle)`, and the closed
 * state is a fraction of that angle at `scale(0.34)`. So the bud is the bloom
 * folded upright and small, and opening is one continuous transition of the same
 * property. The alternative — rotating each petal into place from a shared 0° —
 * makes the closed state a stack of identical petals and the opening a fan,
 * which reads as a spinner. §6.5 asks for a breath, not a performance.
 *
 * It also means **the resting state is the default**: if the transition never
 * runs, you get an open lotus rather than a bud. That matters more than it
 * looks, because it is the failure mode of every path below — no JavaScript, a
 * hydration gap, reduced motion — and in all of them the mark is correct and
 * simply did not move.
 *
 * ## Reduced motion
 *
 * A reader who has asked their system for less motion gets the bloom at rest
 * immediately: no opening, no transitions, no breath, and `onOpened` fires on
 * the same tick so a caller sequencing behind it is not stranded. The check is
 * `useReducedMotion()` rather than a media query because the per-petal delays
 * are computed and therefore inline — see that hook's header.
 *
 * @see .context/app/planning/lelanea-product-description.md §6.5, §6.9
 */
export function Lotus({
  size = 140,
  open: openProp,
  autoOpen = true,
  idle = true,
  water = true,
  delay = 0,
  onOpened,
  className,
}: LotusProps) {
  const reducedMotion = useReducedMotion();
  const controlled = typeof openProp === 'boolean';
  const [selfOpen, setSelfOpen] = useState(false);
  const open = controlled ? openProp : selfOpen;

  useEffect(() => {
    if (controlled || !autoOpen) return;

    // Reduced motion: at rest now, and the caller told now. No timers at all —
    // `reducedMotion` is a dependency, so if it flips true while an opening is
    // pending this effect re-runs and the cleanup below clears that timer.
    if (reducedMotion) {
      setSelfOpen(true);
      onOpened?.();
      return;
    }

    let openedTimer: ReturnType<typeof setTimeout> | undefined;
    const openTimer = setTimeout(() => {
      setSelfOpen(true);
      if (onOpened) openedTimer = setTimeout(onOpened, LOTUS_OPENED_MS);
    }, delay);

    return () => {
      clearTimeout(openTimer);
      clearTimeout(openedTimer);
    };
  }, [controlled, autoOpen, delay, onOpened, reducedMotion]);

  const frame = water ? LOTUS_FRAMES.water : LOTUS_FRAMES.tight;
  const { width, height } = lotusFrameSize(size, frame);
  const gradientId = `lotus-core-${useId().replace(/:/g, '')}`;

  /** With motion reduced every element is painted at its resting value. */
  const settled = open || reducedMotion;
  const ease = (property: string, ms: number, delayMs = 0) =>
    reducedMotion ? 'none' : `${property} ${ms}ms ${LOTUS_EASE} ${delayMs}ms`;

  return (
    <div
      className={cn('relative inline-block', settled && idle && !reducedMotion && styles.breath)}
      style={{ width, height }}
      data-open={settled ? 'true' : 'false'}
      data-reduced-motion={reducedMotion ? 'true' : undefined}
    >
      {/* §6.8: a soft radial halation behind the bloom, and the only gradient on
          the page that is not the core. Sized from the frame so it scales with
          the mark rather than being a fixed 600px at every size. */}
      {water && (
        <div
          aria-hidden="true"
          className="pointer-events-none absolute"
          style={{
            inset: -width * 0.16,
            background:
              'radial-gradient(ellipse at 50% 62%, var(--color-lotus-halation) 0%, transparent 62%)',
            opacity: settled ? 1 : 0,
            transition: ease('opacity', 1600),
          }}
        />
      )}

      <svg
        width={width}
        height={height}
        viewBox={frame.box}
        className={cn('relative overflow-visible', className)}
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
          <g
            fill="none"
            strokeLinecap="round"
            style={{
              transformOrigin: `${LOTUS_ORIGIN.x}px ${LOTUS_RIPPLE_CY}px`,
              transform: settled ? 'scale(1)' : 'scale(0.55)',
              opacity: settled ? 1 : 0,
              transition: reducedMotion
                ? 'none'
                : `${ease('transform', 2600, 300)}, ${ease('opacity', 2000, 300)}`,
            }}
          >
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
            {tier.angles.map((angle, index) => (
              <path
                key={angle}
                d={tier.d}
                style={{
                  transformOrigin: PETAL_ORIGIN,
                  // Closed is the SAME rotation, mostly undone, and small — so
                  // the bud is this petal folded rather than a different shape.
                  transform: settled
                    ? `rotate(${angle}deg) scale(1)`
                    : `rotate(${angle * 0.18}deg) scale(0.34)`,
                  opacity: settled ? 1 : 0,
                  transition: reducedMotion
                    ? 'none'
                    : [
                        ease('transform', LOTUS_OPEN_MS, tier.base + index * LOTUS_PETAL_STAGGER),
                        ease('opacity', 1500, tier.base + index * LOTUS_PETAL_STAGGER),
                      ].join(', '),
                }}
              />
            ))}
          </g>
        ))}

        {/* The inner tier's pale centre veins (§6.9). Never move — they fade in
            once the petals carrying them have arrived. */}
        <g
          stroke="var(--color-lotus-vein)"
          strokeWidth="1.2"
          fill="none"
          style={{
            opacity: settled ? 0.5 : 0,
            transition: ease('opacity', 1400, 900),
          }}
        >
          {LOTUS_VEIN_ANGLES.map((angle) => (
            <path
              key={angle}
              d={LOTUS_VEIN_D}
              style={{ transformOrigin: PETAL_ORIGIN, transform: `rotate(${angle}deg)` }}
            />
          ))}
        </g>

        <ellipse
          cx={LOTUS_CORE.cx}
          cy={LOTUS_CORE.cy}
          rx={LOTUS_CORE.rx}
          ry={LOTUS_CORE.ry}
          fill={`url(#${gradientId})`}
          style={{
            transformOrigin: `${LOTUS_CORE.cx}px ${LOTUS_CORE.cy}px`,
            transform: settled ? 'scale(1)' : 'scale(0.3)',
            opacity: settled ? 1 : 0,
            // §6.4 allows exactly one coloured shadow, and this is it.
            filter: settled ? 'drop-shadow(var(--shadow-bloom))' : 'none',
            transition: reducedMotion
              ? 'none'
              : [
                  ease('transform', 1500, 240),
                  ease('opacity', 1200, 240),
                  ease('filter', 1500, 240),
                ].join(', '),
          }}
        />
        <ellipse
          cx={LOTUS_GLINT.cx}
          cy={LOTUS_GLINT.cy}
          rx={LOTUS_GLINT.rx}
          ry={LOTUS_GLINT.ry}
          fill="var(--color-lotus-glint)"
          style={{
            opacity: settled ? 0.85 : 0,
            transition: ease('opacity', 1200, 600),
          }}
        />
      </svg>
    </div>
  );
}

export { LOTUS_OPENED_MS };
