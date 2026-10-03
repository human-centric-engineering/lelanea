'use client';

import { useEffect, useLayoutEffect, useRef, useState } from 'react';
import { preload } from 'react-dom';

import { cn } from '@/lib/utils';

import { lotusPainter, tokenReader } from '@/components/app/ui/lotus-canvas';
import { drawLotus, lotusFrameSize, lotusFrames } from '@/components/app/ui/lotus-draw';
import { LOTUS_OPENED_MS } from '@/components/app/ui/lotus-model';
import { useReducedMotion } from '@/components/app/ui/use-reduced-motion';
import styles from '@/components/app/ui/lotus.module.css';

export interface LotusProps {
  /** Rendered width of the bloom in pixels — see `LotusMark`'s note on `size`. */
  size?: number;
  /** Drive the bloom yourself. Passing this disables `autoOpen` entirely. */
  open?: boolean;
  /** Open on mount without being told to. Ignored when `open` is supplied. */
  autoOpen?: boolean;
  /** Breathe once open (§6.9). */
  idle?: boolean;
  /** Include the lily pads, the sage ripples and the halation behind them. */
  water?: boolean;
  /** Milliseconds to wait before opening. */
  delay?: number;
  /** Fired once the last petal has come to rest. */
  onOpened?: () => void;
  /**
   * Fill the container's width, keeping the frame's aspect, never wider than
   * `size` would make it. For a column that sets the width — the landing hero.
   */
  fluid?: boolean;
  className?: string;
}

/**
 * The signature bloom: a water lily that opens from a pointed bud, then breathes.
 *
 * The flower is the owner's choice from t-131 (decision on f-identity, 3 Oct
 * 2026) and is drawn from the 3D model in `lotus-model.ts`. It is "the app's
 * opening gesture rather than a loading state" (§6.9): nothing waits on it,
 * and a caller that needs to sequence something after it takes `onOpened`.
 *
 * ## A canvas while it moves, a baked image at rest
 *
 * At rest — the bud, or the open bloom — it is an image baked from the same
 * draw list by `npm run lotus:assets` (`public/lotus-anim-*.svg`). Inline, each
 * still is ~250KB of shaded SVG, and the entry bloom is now server-rendered on
 * every app load (t-132) and the landing hero animates too; as an image it is
 * one cached request. While the petals are MOVING a canvas is laid over it and
 * repainted every frame from the draw list — React-managed SVG measured ~28fps.
 * When the opening ends the canvas goes and the open image — the identical
 * picture, in the same frame — is what remains. It has been loading, hidden,
 * under the canvas the whole time.
 *
 * **The resting state is the default.** If the canvas never paints (no 2D
 * context, no JavaScript, reduced motion) the image is the bud or the open
 * bloom as the state says: correct, simply not moving.
 *
 * ## Reduced motion
 *
 * A reader who has asked for less motion gets the bloom at rest immediately: no
 * canvas, no breath, and `onOpened` fires on the same tick so a caller
 * sequencing behind it is not stranded. The one thing the preference does NOT
 * do is open a bloom a caller is holding closed — see `settled`.
 *
 * @see .context/app/brand-theme.md — the lotus
 */
export function Lotus({
  size = 140,
  open: openProp,
  autoOpen = true,
  idle = true,
  water = true,
  delay = 0,
  onOpened,
  fluid = false,
  className,
}: LotusProps) {
  const reducedMotion = useReducedMotion();
  const controlled = typeof openProp === 'boolean';
  const [selfOpen, setSelfOpen] = useState(false);
  const open = controlled ? openProp : selfOpen;

  /**
   * `onOpened` is held in a ref and kept OUT of the dependency arrays below.
   *
   * As a dependency it starved the callback in the ordinary call shape:
   * `onOpened={() => …}` is a new function every render, so the effect re-ran,
   * its cleanup cleared the pending timer, and the wait restarted from zero — a
   * parent re-rendering more often than `LOTUS_OPENED_MS` never got called.
   */
  const onOpenedRef = useRef(onOpened);
  useEffect(() => {
    onOpenedRef.current = onOpened;
  });

  useEffect(() => {
    if (controlled || !autoOpen) return;

    // Reduced motion: at rest now, and the caller told now. No timers — if the
    // preference flips true mid-opening this re-runs and the cleanup clears them.
    if (reducedMotion) {
      setSelfOpen(true);
      onOpenedRef.current?.();
      return;
    }

    let openedTimer: ReturnType<typeof setTimeout> | undefined;
    const openTimer = setTimeout(() => {
      setSelfOpen(true);
      openedTimer = setTimeout(() => onOpenedRef.current?.(), LOTUS_OPENED_MS);
    }, delay);

    return () => {
      clearTimeout(openTimer);
      clearTimeout(openedTimer);
    };
  }, [controlled, autoOpen, delay, reducedMotion]);

  /**
   * The controlled path's half of the same promise: `onOpened` on the rising
   * edge of `open`, once the petals have settled, and again after a close and
   * reopen. `openedFired` is set where it fires, not where it is scheduled.
   */
  const openedFired = useRef(false);
  useEffect(() => {
    if (!controlled) return;

    if (!openProp) {
      openedFired.current = false;
      return;
    }
    if (openedFired.current) return;

    if (reducedMotion) {
      openedFired.current = true;
      onOpenedRef.current?.();
      return;
    }

    const openedTimer = setTimeout(() => {
      openedFired.current = true;
      onOpenedRef.current?.();
    }, LOTUS_OPENED_MS);

    return () => clearTimeout(openedTimer);
  }, [controlled, openProp, reducedMotion]);

  /**
   * With motion reduced an uncontrolled bloom is painted at rest — where the
   * resting value is ours to choose. A controlled caller is obeyed: a reader
   * with the OS preference set gets `<Lotus open={false} />` closed, without
   * motion, not quietly opened.
   */
  const settled = controlled ? open : open || reducedMotion;

  /**
   * Playing: the stretch between `open` rising and the last petal settling,
   * when the canvas is up. Driven by the same clock as `onOpened`, so the
   * canvas comes down exactly when the caller is told.
   *
   * LAYOUT effects, here and for the canvas's first paint below, so the hand-
   * over happens before the browser paints. As passive effects the frame after
   * `open` rose showed the open SVG, the next a hidden SVG over an unpainted
   * canvas, and only then the bud — a flash of the finished bloom and a blank
   * before every opening (code review, t-134).
   */
  const [playing, setPlaying] = useState(false);
  const wasOpen = useRef(settled);
  useLayoutEffect(() => {
    const rising = settled && !wasOpen.current;
    wasOpen.current = settled;
    if (!settled || reducedMotion) {
      setPlaying(false);
      return;
    }
    if (!rising) return;
    setPlaying(true);
    const done = setTimeout(() => setPlaying(false), LOTUS_OPENED_MS);
    return () => clearTimeout(done);
  }, [settled, reducedMotion]);

  const frame = water ? lotusFrames().animated.water : lotusFrames().animated.tight;
  const { width, height } = lotusFrameSize(size, frame);

  const canvasRef = useRef<HTMLCanvasElement>(null);
  useLayoutEffect(() => {
    if (!playing) return;
    const canvas = canvasRef.current;
    const ctx = canvas?.getContext('2d');
    if (!canvas || !ctx) {
      // No 2D context (lost, or none to give): stop playing, so the open image
      // shows instead of a hidden image under an empty canvas for the opening.
      setPlaying(false);
      return;
    }

    const ratio = Math.min(window.devicePixelRatio || 1, 2);
    canvas.width = Math.round(width * ratio);
    canvas.height = Math.round(height * ratio);
    const paint = lotusPainter(tokenReader(canvas));

    let raf = 0;
    const t0 = performance.now();
    const tick = (now: number) => {
      const ms = Math.min(now - t0, LOTUS_OPENED_MS);
      paint(ctx, drawLotus(ms, { water }), frame, canvas.width);
      if (ms < LOTUS_OPENED_MS) raf = requestAnimationFrame(tick);
    };
    paint(ctx, drawLotus(0, { water }), frame, canvas.width);
    raf = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(raf);
  }, [playing, water, frame, width, height]);

  const openSrc = `/lotus-anim-open${water ? '-water' : ''}.svg`;
  const still = settled ? openSrc : `/lotus-anim-bud${water ? '-water' : ''}.svg`;
  // Request the open image from the first render — with the HTML, on the
  // server. Asked for only when the opening began, it had the opening's 2.2s
  // to arrive, and on a slow connection the canvas came down onto the BUD,
  // still showing until the swap finished loading (code review, t-134).
  preload(openSrc, { as: 'image' });

  return (
    <div
      className={cn(
        'relative inline-block',
        settled && idle && !reducedMotion && !playing && styles.breath
      )}
      style={
        fluid
          ? { width: '100%', maxWidth: width, aspectRatio: `${width} / ${height}` }
          : { width, height }
      }
      data-open={settled ? 'true' : 'false'}
      data-reduced-motion={reducedMotion ? 'true' : undefined}
      data-playing={playing ? 'true' : undefined}
    >
      {/* A plain <img>: a static SVG gains nothing from next/image, which
          refuses SVG without `dangerouslyAllowSVG`. Hidden, not removed, while
          the canvas plays — it is what remains, and it loads meanwhile. */}
      {/* eslint-disable-next-line @next/next/no-img-element */}
      <img
        src={still}
        width={width}
        height={height}
        alt=""
        aria-hidden="true"
        draggable={false}
        className={cn('relative block h-full w-full select-none', className)}
        style={{ visibility: playing ? 'hidden' : 'visible' }}
      />
      {playing && (
        <canvas
          ref={canvasRef}
          aria-hidden="true"
          className="pointer-events-none absolute inset-0"
          style={{ width: '100%', height: '100%' }}
        />
      )}
    </div>
  );
}

export { LOTUS_OPENED_MS };
