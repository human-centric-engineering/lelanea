'use client';

import { useEffect, useRef } from 'react';

import { cn } from '@/lib/utils';

import { MARK_VIEW } from '@/components/app/ui/dot-lotus-geometry';
import {
  MARK,
  dotLoop,
  dotScene,
  dotTokens,
  readDotLook,
  sharedMark,
  type DotLayout,
} from '@/components/app/ui/dot-lotus-paint';
import { useReducedMotion } from '@/components/app/ui/use-reduced-motion';

export interface LotusMarkProps {
  /** The rendered width of the flower, in pixels. */
  size?: number;
  /**
   * Lay the flower's light over it. Off where the mark repeats down a page —
   * the agent's mark beside every reply — so a conversation is not a column of
   * hearts beating out of step.
   */
  light?: boolean;
  className?: string;
}

/** How far past the flower its light reaches, as the prototype pads its canvas. */
const PAD = MARK.reach * 0.62;

/**
 * The lotus as a small mark — beside the wordmark in the site bar, the footer
 * and the shell nav, in the page guides, and the agent's mark beside a reply.
 *
 * ## Solid petals, with the light laid over them (t-183)
 *
 * The prism prototype's mini lotus. At 30px a dotted outline reads as speckle,
 * so the petals are the flat flower's own (`/dot-lotus-mark.svg`, the home
 * flower cropped close and without its water), and the canvas over them draws
 * only the energy: the heart's glow, its beat, glints that flare at the petal
 * edges, and a few dots streaming out. Pointing at the link it sits in plays
 * the unfolding again.
 *
 * It runs only while it can be seen, and a reader who asked for less motion
 * gets one still frame and nothing scheduled after it. Where no canvas paints,
 * the flat flower is the whole picture.
 *
 * DECORATIVE. Empty `alt` and `aria-hidden`: every use sits beside the name it
 * stands for. Where the mark is the only content of a link, label the LINK, as
 * the header and the shell nav do.
 *
 * @see components/app/ui/dot-lotus.tsx — the full flower
 * @see .context/app/brand-theme.md — the lotus drawn in light
 */
export function LotusMark({ size = 30, light = true, className }: LotusMarkProps) {
  const reduced = useReducedMotion();
  const hostRef = useRef<HTMLSpanElement>(null);
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const height = (size * MARK_VIEW.height) / MARK_VIEW.width;

  useEffect(() => {
    const host = hostRef.current;
    const canvas = canvasRef.current;
    const ctx = light ? canvas?.getContext('2d') : null;
    if (!host || !canvas || !ctx) return;

    // Asked directly as well: the hook's first answer is always `false`.
    const still =
      reduced || window.matchMedia?.('(prefers-reduced-motion: reduce)').matches === true;
    let tokens = dotTokens(host);
    let look = readDotLook(host);
    const scene = dotScene(sharedMark(), { reduced: still, mark: true });

    // The mark's box is its own size, so the canvas is the flower and its
    // light's reach around it, in place.
    const scale = size / MARK_VIEW.width;
    const pad = PAD * scale;
    const width = size + pad * 2;
    const tall = height + pad * 2;
    const dpr = Math.min(window.devicePixelRatio || 1, 2);
    canvas.style.left = canvas.style.top = `${-pad}px`;
    canvas.style.width = `${width}px`;
    canvas.style.height = `${tall}px`;
    canvas.width = Math.round(width * dpr);
    canvas.height = Math.round(tall * dpr);
    const ox = pad - MARK_VIEW.x * scale;
    const oy = pad - MARK_VIEW.y * scale;
    const layout: DotLayout = {
      ox,
      oy,
      scale,
      spanL: ox / scale,
      spanR: (width - ox) / scale,
      spanV: tall / 2 / scale,
      dpr,
    };

    const loop = dotLoop((t) => scene.paint(ctx, look, layout, t), {
      reduced: still,
      host: {
        now: () => performance.now(),
        request: (callback) => window.requestAnimationFrame(callback),
        cancel: (handle) => window.cancelAnimationFrame(handle),
      },
    });

    let onScreen = typeof IntersectionObserver === 'undefined';
    const update = () => {
      if (onScreen && !document.hidden) loop.play();
      else loop.pause();
    };
    const seen =
      typeof IntersectionObserver === 'undefined'
        ? null
        : new IntersectionObserver(
            (entries) => {
              onScreen = entries[entries.length - 1].isIntersecting;
              update();
            },
            { rootMargin: `${Math.round(pad)}px` }
          );
    seen?.observe(host);
    const onVisibility = () => update();
    document.addEventListener('visibilitychange', onVisibility);

    // Pointing at the link it sits in plays the unfolding again, as the
    // prototype's marks do.
    const trigger = host.closest('a') ?? host;
    const replay = () => {
      if (still) return;
      scene.reset();
      loop.replay();
    };
    trigger.addEventListener('pointerenter', replay);

    const theme = new MutationObserver(() => {
      const next = dotTokens(host);
      if (next === tokens) return;
      tokens = next;
      look = readDotLook(host);
      if (!loop.running) loop.still();
    });
    theme.observe(document.documentElement, {
      attributes: true,
      attributeFilter: ['class', 'data-theme', 'data-tint', 'data-surface'],
    });

    update();

    return () => {
      loop.pause();
      seen?.disconnect();
      theme.disconnect();
      document.removeEventListener('visibilitychange', onVisibility);
      trigger.removeEventListener('pointerenter', replay);
    };
  }, [reduced, light, size, height]);

  return (
    <span
      ref={hostRef}
      className={cn('relative inline-block flex-none', className)}
      style={{ width: size, height }}
    >
      {/* A plain <img>, not next/image: a static SVG gains nothing from the
          optimiser, which refuses SVG unless `dangerouslyAllowSVG` is set. */}
      {/* eslint-disable-next-line @next/next/no-img-element */}
      <img
        src="/dot-lotus-mark.svg"
        width={size}
        height={Math.round(height)}
        alt=""
        aria-hidden="true"
        draggable={false}
        className="block h-full w-full select-none"
      />
      {light ? (
        <canvas ref={canvasRef} aria-hidden="true" className="pointer-events-none absolute" />
      ) : null}
    </span>
  );
}
