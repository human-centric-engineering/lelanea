'use client';

import { useEffect, useRef, useState } from 'react';

import { Lotus } from '@/components/app/ui/lotus';
import { cn } from '@/lib/utils';

/**
 * Once per browser session, keyed per tab.
 *
 * `sessionStorage`, not `localStorage`: §6.9 calls the bloom "the app's opening
 * gesture", and an opening gesture belongs to a visit. `localStorage` would show
 * it once and never again on that device; a plain module flag would re-show it
 * on every full page load. `sessionStorage` is the one that means "this visit".
 */
const SEEN_KEY = 'lelanea.bloom.seen';

/** Long enough for the last petal to settle, plus the fade this adds on top. */
const FADE_MS = 420;

/**
 * The entry bloom: the lotus over the shell on the first view of a session.
 *
 * ## What this owns, and what it does not
 *
 * `Lotus` already does the whole animation — the petal fan, the breathing idle,
 * `onOpened` when the last petal settles, and the reduced-motion resting state.
 * None of that is re-implemented here and none of it should be.
 *
 * What this component owns is the once-per-session gate, which is genuinely new:
 * the prototype has no `sessionStorage` at all and blooms on every render of its
 * `#app` view. So this is an addition to the prototype rather than a port from
 * it, which is why it carries a test rather than a screenshot comparison.
 *
 * ## Why it starts hidden and reveals in an effect
 *
 * The server cannot read `sessionStorage`, so a server-rendered bloom would
 * flash for every returning visitor before the client could take it away. The
 * first client render therefore matches the server — nothing — and the effect
 * decides. A visitor who has already seen it this session renders nothing at
 * all, not a hidden element.
 */
export function EntryBloom() {
  const [phase, setPhase] = useState<'idle' | 'showing' | 'leaving' | 'done'>('idle');

  /**
   * One decision per mounted component, not per effect run.
   *
   * `reactStrictMode` is on, so in development React runs this effect, tears it
   * down, and runs it again on the same instance. Without this guard the first
   * run writes the flag and the second run reads it back and concludes the
   * bloom has already been seen — so the opening gesture never appeared in
   * development at all, which is the only place anyone would be checking it.
   * Fast Refresh remounts did the same thing in the same way.
   *
   * A ref rather than state: refs survive Strict Mode's simulated remount,
   * which is exactly the property needed, and writing one does not re-render.
   */
  const decided = useRef(false);

  useEffect(() => {
    if (decided.current) return;
    decided.current = true;

    let seen = false;
    try {
      seen = window.sessionStorage.getItem(SEEN_KEY) === '1';
    } catch {
      // Private mode, or storage disabled. Treat it as unseen: showing the
      // opening gesture twice is a far smaller cost than throwing on mount.
      seen = false;
    }

    if (seen) {
      setPhase('done');
      return;
    }

    try {
      window.sessionStorage.setItem(SEEN_KEY, '1');
    } catch {
      // Same reasoning: the write failing must not stop the bloom rendering.
    }
    setPhase('showing');
  }, []);

  useEffect(() => {
    if (phase !== 'leaving') return;
    const timer = setTimeout(() => setPhase('done'), FADE_MS);
    return () => clearTimeout(timer);
  }, [phase]);

  if (phase === 'idle' || phase === 'done') return null;

  return (
    <div
      // Purely decorative and briefly on top of everything: a screen reader
      // should hear the shell, not an unnamed overlay it cannot dismiss.
      aria-hidden="true"
      className={cn(
        'bg-background pointer-events-none fixed inset-0 z-[100] flex items-center justify-center',
        // The duration is an inline style, not a class: Tailwind extracts class
        // names statically, so `duration-[${FADE_MS}ms]` would compile to
        // nothing and the fade would snap. One source for the number either way.
        'transition-opacity ease-[var(--ease-brand)] motion-reduce:transition-none',
        phase === 'leaving' ? 'opacity-0' : 'opacity-100'
      )}
      style={{ transitionDuration: `${FADE_MS}ms` }}
      data-testid="entry-bloom"
    >
      <Lotus size={168} autoOpen idle water onOpened={() => setPhase('leaving')} />
    </div>
  );
}
