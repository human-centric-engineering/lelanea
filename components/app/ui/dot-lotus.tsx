'use client';

import { useEffect, useRef, type CSSProperties } from 'react';

import { cn } from '@/lib/utils';

import { HEART, K } from '@/components/app/ui/dot-lotus-geometry';
import {
  dotLoop,
  dotTokens,
  dotScene,
  readDotLook,
  sharedFlower,
  type DotLayout,
} from '@/components/app/ui/dot-lotus-paint';
import { lotusFrameSize, lotusFrames } from '@/components/app/ui/lotus-draw';
import { useReducedMotion } from '@/components/app/ui/use-reduced-motion';
import styles from '@/components/app/ui/dot-lotus.module.css';

export interface DotLotusProps {
  /** The widest the flower is drawn, in CSS pixels; narrower on a small screen. */
  size?: number;
  /**
   * Wait until half of it is in view to unfold, and unfold again each time the
   * reader comes back to it after it has left the screen entirely. For a flower
   * a long scroll from the top of the page, which would otherwise open unseen.
   */
  startInView?: boolean;
  /**
   * Name the image for assistive technology. Leave it out where the flower is
   * decoration beside the words it stands for, which is every use today.
   */
  label?: string;
  className?: string;
}

/** The open bloom alone, which is the box the dots are drawn in. */
const FRAME = lotusFrames().still.tight;
/** How far past the flower its light reaches, as the prototype pads its canvas. */
const PAD = 118 * K * 0.62;

/**
 * The lotus drawn in points of light (t-182, f-dot-lotus): dots trace each
 * petal and unfurl outer ring first, a seed-head heart gathers, and then the
 * flower beats — lub-dub, a ring of dots widening across the pond on each beat,
 * stars let go from the petal tips as the wave reaches them, and loose light
 * drifting off to the edges of the page. A click plays the unfolding again.
 *
 * ## The baked flower stays
 *
 * Under the canvas is the baked open bloom (`/lotus-bloom.svg`, the same image
 * `LotusMark` shows). It is the picture wherever the canvas never paints — no
 * 2D context, no JavaScript — and once the canvas does paint it is made
 * transparent, not removed, so a flower given a `label` keeps its image in the
 * accessibility tree. The canvas itself is `aria-hidden` always.
 *
 * ## It only runs while it can be seen
 *
 * The loop pauses while the flower is off-screen or the tab is hidden, and
 * resumes when it is back. A reader who asked for less motion is shown the open
 * flower, still: one frame, and nothing scheduled after it.
 *
 * @see components/app/ui/dot-lotus-geometry.ts — where the dots sit, and when
 * @see components/app/ui/dot-lotus-paint.ts — how they are painted
 */
export function DotLotus({ size = 440, startInView = false, label, className }: DotLotusProps) {
  const reduced = useReducedMotion();
  const hostRef = useRef<HTMLDivElement>(null);
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const replayRef = useRef<() => void>(() => undefined);

  useEffect(() => {
    const host = hostRef.current;
    const canvas = canvasRef.current;
    const ctx = canvas?.getContext('2d');
    // No 2D context: the baked flower stays the picture.
    if (!host || !canvas || !ctx) return;

    // The hook reads the preference in an effect of its own, so on the first
    // run it still says `false`; asked directly, a reader who wants less motion
    // never gets a frame of the animated scene before the still one.
    const still =
      reduced || window.matchMedia?.('(prefers-reduced-motion: reduce)').matches === true;
    let tokens = dotTokens(host);
    let look = readDotLook(host);
    const scene = dotScene(sharedFlower(), { reduced: still });
    let layout: DotLayout | null = null;

    const measure = () => {
      const box = host.getBoundingClientRect();
      if (!box.width) return;
      const scale = box.width / FRAME.box[2];
      const pad = PAD * scale;
      const pageWidth = document.documentElement.clientWidth || box.width;
      const height = box.height + pad * 2;
      const dpr = Math.min(window.devicePixelRatio || 1, 2);
      // From the page's left edge to its right, so the light can drift to both.
      canvas.style.left = `${-box.left}px`;
      canvas.style.top = `${-pad}px`;
      canvas.style.width = `${pageWidth}px`;
      canvas.style.height = `${height}px`;
      // Assigning a size reallocates and clears the backing store, so only
      // when it changed: a window resize reaches here twice.
      const pixelWidth = Math.round(pageWidth * dpr);
      const pixelHeight = Math.round(height * dpr);
      if (canvas.width !== pixelWidth) canvas.width = pixelWidth;
      if (canvas.height !== pixelHeight) canvas.height = pixelHeight;
      const ox = box.left - FRAME.box[0] * scale;
      const oy = pad - FRAME.box[1] * scale;
      // Light fades out before the nearer of the canvas's top and bottom
      // edges, measured from the heart, which sits below the canvas's middle.
      const heartY = oy + HEART[1] * scale;
      layout = {
        ox,
        oy,
        scale,
        spanL: ox / scale,
        spanR: (pageWidth - ox) / scale,
        spanV: Math.min(heartY, height - heartY) / scale,
        dpr,
      };
    };

    const loop = dotLoop(
      (t) => {
        if (layout) scene.paint(ctx, look, layout, t);
      },
      {
        reduced: still,
        host: {
          now: () => performance.now(),
          request: (callback) => window.requestAnimationFrame(callback),
          cancel: (handle) => window.cancelAnimationFrame(handle),
        },
      }
    );

    measure();
    host.dataset.lit = 'true';

    // Seen: on screen, in a visible tab, and — for a flower that waits to be
    // seen — started.
    let onScreen = typeof IntersectionObserver === 'undefined';
    let started = !startInView || onScreen;
    const update = () => {
      if (onScreen && started && !document.hidden) loop.play();
      else loop.pause();
    };
    const replay = () => {
      scene.reset();
      loop.replay();
    };
    replayRef.current = replay;

    const observer =
      typeof IntersectionObserver === 'undefined'
        ? null
        : new IntersectionObserver(
            (entries) => {
              const entry = entries[entries.length - 1];
              onScreen = entry.isIntersecting;
              if (startInView) {
                // Fold away once it has left entirely, so a return unfolds it
                // again (owner, t-171); open once half of it is in view.
                if (!entry.isIntersecting) started = false;
                else if (!started && entry.intersectionRatio >= 0.5) {
                  started = true;
                  replay();
                }
              }
              if (onScreen) measure();
              update();
            },
            { threshold: [0, 0.5] }
          );
    observer?.observe(host);

    const onVisibility = () => update();
    document.addEventListener('visibilitychange', onVisibility);

    /** Repaint a paused flower in place — never one still waiting to be seen. */
    const refresh = () => {
      if (!loop.running && started) loop.still();
    };
    const relayout = () => {
      measure();
      refresh();
    };
    const resize = typeof ResizeObserver === 'undefined' ? null : new ResizeObserver(relayout);
    resize?.observe(host);
    // The page too: a scrollbar arriving moves the flower without resizing it.
    resize?.observe(document.documentElement);
    window.addEventListener('resize', relayout);

    // The tokens move with the theme — and with the surface, which a client
    // navigation can set after this has first read them. Sprites are rebuilt
    // only when a token actually changed.
    const theme = new MutationObserver(() => {
      const next = dotTokens(host);
      if (next === tokens) return;
      tokens = next;
      look = readDotLook(host);
      refresh();
    });
    theme.observe(document.documentElement, {
      attributes: true,
      attributeFilter: ['class', 'data-theme', 'data-tint', 'data-surface'],
    });

    update();
    refresh();

    return () => {
      loop.pause();
      observer?.disconnect();
      resize?.disconnect();
      theme.disconnect();
      document.removeEventListener('visibilitychange', onVisibility);
      window.removeEventListener('resize', relayout);
      replayRef.current = () => undefined;
      delete host.dataset.lit;
    };
  }, [reduced, startInView]);

  const { width, height } = lotusFrameSize(size, FRAME);
  const hostStyle: CSSProperties & Record<'--dl-max', string> = { '--dl-max': `${size}px` };

  return (
    // A click plays the unfolding again: a flourish for the pointer, with
    // nothing a keyboard reader misses, so it is not offered as a control.
    // eslint-disable-next-line jsx-a11y/click-events-have-key-events, jsx-a11y/no-static-element-interactions
    <div
      ref={hostRef}
      className={cn(styles.host, className)}
      style={hostStyle}
      onClick={() => replayRef.current()}
    >
      {/* A plain <img>: a static SVG gains nothing from next/image. */}
      {/* eslint-disable-next-line @next/next/no-img-element */}
      <img
        src="/lotus-bloom.svg"
        width={Math.round(width)}
        height={Math.round(height)}
        alt={label ?? ''}
        aria-hidden={label ? undefined : true}
        draggable={false}
        className={styles.image}
      />
      <canvas ref={canvasRef} aria-hidden="true" className={styles.canvas} />
    </div>
  );
}
