'use client';

import { useEffect, useRef, useState } from 'react';

import { Lotus } from '@/components/app/ui/lotus';

/**
 * The lotus that closes the home page (t-171): a bud until the reader arrives,
 * then it opens — and again each time they return to it.
 *
 * The hero's bloom opens on load, at the top of the page; this one would open
 * unseen a long scroll away, so it waits to be seen. `Lotus` handles reduced
 * motion itself: the bloom simply appears open, at rest.
 */
export function PondBloom({ size = 320 }: { size?: number }) {
  const ref = useRef<HTMLDivElement>(null);
  const [open, setOpen] = useState(false);

  useEffect(() => {
    const element = ref.current;
    if (!element) return;
    // No observer (very old browsers, some test environments): open at once
    // rather than leaving a bud that never flowers.
    if (typeof IntersectionObserver === 'undefined') {
      setOpen(true);
      return;
    }
    // Opens when half of it is in view; folds back to a bud once it has left
    // the screen entirely, so returning to it opens it again (owner, t-171).
    // The fold happens out of sight — `Lotus` shows the bud at once on close,
    // and plays the full opening on every rise.
    const observer = new IntersectionObserver(
      (entries) => {
        for (const entry of entries) {
          if (entry.intersectionRatio >= 0.5) setOpen(true);
          else if (!entry.isIntersecting) setOpen(false);
        }
      },
      { threshold: [0, 0.5] }
    );
    observer.observe(element);
    return () => observer.disconnect();
  }, []);

  return (
    <div ref={ref}>
      <Lotus size={size} open={open} water fluid />
    </div>
  );
}
