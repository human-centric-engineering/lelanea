'use client';

import { useEffect, useRef, useState } from 'react';

/**
 * The prototype's pacing: a word every 26ms, a space every 8ms (`stream()` in
 * `lelanea.html`). Slow enough to read as typed, fast enough not to lag a
 * real stream by more than a sentence or two.
 */
export const WORD_MS = 26;
export const SPACE_MS = 8;

/**
 * Reveal `target` a word at a time, and keep up as it grows (§10 t-64).
 *
 * §3.3: the reply "streams, arriving as if typed rather than in a block.
 * Pacing matters more here than in most products, because a full reply
 * arriving at once reads as a lecture." A real stream arrives in chunks of
 * uneven size at uneven intervals, so the pacing is put back here: whatever
 * has arrived is revealed at the prototype's rate, and a chunk that lands
 * mid-word waits for the rest of the word before it shows.
 *
 * ## `settled`
 *
 * While the stream is open, a trailing run of letters may be half a word —
 * the next chunk finishes it. It is held back until either whitespace follows
 * it or the turn is settled (`done`), when the tail is a whole word by
 * definition. Without this a word split across two chunks flickers in two
 * pieces.
 *
 * ## Reduced motion
 *
 * `animate: false` shows `target` as it is on every render: a reader who has
 * asked for less motion gets the stream as the server paces it, which is
 * still gradual, and never the word-by-word reveal on top.
 *
 * ## Continuity across the live → settled transition
 *
 * The reveal runs to the end of the text at its own pace even after `settled`
 * — it never snaps. The component that calls this keeps its identity across
 * that transition (same React key), so `shown` carries over.
 */
export function useTypedText(target: string, settled: boolean, animate: boolean): string {
  const [shown, setShown] = useState(animate ? '' : target);
  const shownRef = useRef(shown);
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);
  // When the next word is due. A chunk arriving re-runs the effect, and
  // scheduling the next tick from THIS keeps the pace steady rather than
  // revealing a word the instant each chunk lands.
  const dueAt = useRef(0);

  useEffect(() => {
    if (!animate) {
      shownRef.current = target;
      setShown(target);
      return;
    }

    // The target was replaced rather than extended (a `content_reset`): start
    // over from whatever prefix still holds.
    if (!target.startsWith(shownRef.current)) {
      shownRef.current = '';
      setShown('');
    }

    const tick = () => {
      timer.current = null;
      const from = shownRef.current.length;
      if (from >= target.length) return;

      const isSpace = /\s/.test(target[from]);
      let to = from;
      if (isSpace) {
        while (to < target.length && /\s/.test(target[to])) to += 1;
      } else {
        while (to < target.length && !/\s/.test(target[to])) to += 1;
        // A word running to the end of an open stream may be half a word.
        if (to === target.length && !settled) return;
      }

      shownRef.current = target.slice(0, to);
      setShown(shownRef.current);
      const delay = isSpace ? SPACE_MS : WORD_MS;
      dueAt.current = Date.now() + delay;
      if (to < target.length) timer.current = setTimeout(tick, delay);
    };

    timer.current = setTimeout(tick, Math.max(0, dueAt.current - Date.now()));
    return () => {
      if (timer.current !== null) {
        clearTimeout(timer.current);
        timer.current = null;
      }
    };
  }, [target, settled, animate]);

  return animate ? shown : target;
}
