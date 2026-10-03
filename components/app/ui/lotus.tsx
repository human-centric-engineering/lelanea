'use client';

import { useEffect, useId, useRef, useState } from 'react';

import { cn } from '@/lib/utils';

import { lotusPainter, tokenReader } from '@/components/app/ui/lotus-canvas';
import { drawLotus, lotusFrameSize, lotusFrames, stillLotus } from '@/components/app/ui/lotus-draw';
import { LOTUS_OPENED_MS } from '@/components/app/ui/lotus-model';
import { lotusSvgElements } from '@/components/app/ui/lotus-svg';
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
 * ## Two painters, one flower
 *
 * At rest — closed or open — the bloom is SVG, painted from `stillLotus`, so it
 * renders on the server, hydrates, and is in the DOM to be asserted on. While
 * the petals are MOVING it is a canvas laid over the SVG, repainted every frame
 * from the same draw list: rebuilding ~240 shaded SVG gradients through React
 * per frame measured ~28fps. When the opening ends the canvas goes and the open
 * SVG — the identical picture — is what remains.
 *
 * **The resting state is the default.** If the canvas never paints (no 2D
 * context, a hydration gap, reduced motion) the SVG underneath is the open
 * bloom as soon as the bloom is open: correct, simply not moving.
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
   */
  const [playing, setPlaying] = useState(false);
  const wasOpen = useRef(settled);
  useEffect(() => {
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
  useEffect(() => {
    if (!playing) return;
    const canvas = canvasRef.current;
    const ctx = canvas?.getContext('2d');
    if (!canvas || !ctx) return; // the open SVG below stands in

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

  const idPrefix = `lotus-${useId().replace(/:/g, '')}`;
  const shapes = stillLotus(settled ? 'open' : 'bud', water);

  return (
    <div
      className={cn(
        'relative inline-block',
        settled && idle && !reducedMotion && !playing && styles.breath
      )}
      style={{ width, height }}
      data-open={settled ? 'true' : 'false'}
      data-reduced-motion={reducedMotion ? 'true' : undefined}
      data-playing={playing ? 'true' : undefined}
    >
      <svg
        width={width}
        height={height}
        viewBox={frame.box.join(' ')}
        className={cn('relative overflow-visible', className)}
        // Hidden, not removed, while the canvas plays: it is what remains.
        style={{ visibility: playing ? 'hidden' : 'visible' }}
        aria-hidden="true"
        focusable="false"
      >
        {lotusSvgElements(shapes, idPrefix)}
      </svg>
      {playing && (
        <canvas
          ref={canvasRef}
          aria-hidden="true"
          className="pointer-events-none absolute inset-0"
          style={{ width, height }}
        />
      )}
    </div>
  );
}

export { LOTUS_OPENED_MS };
