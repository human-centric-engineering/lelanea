'use client';

import { useEffect, useState } from 'react';

import { Lotus } from '@/components/app/ui/lotus';
import { LOTUS_OPENED_MS } from '@/components/app/ui/lotus-model';
import { SHELL_OVERLAY_ATTR } from '@/components/app/shell/use-shell-layout';
import { cn } from '@/lib/utils';

import styles from '@/components/app/shell/entry-bloom.module.css';

/** The fade this adds once the last petal has settled. */
const FADE_MS = 420;

/**
 * If JavaScript never arrives, CSS lifts the cover on its own this long after
 * the page loads: the opening, plus a beat. See `failsafe` below.
 */
const FAILSAFE_MS = LOTUS_OPENED_MS + 600;

/**
 * The entry bloom: the lotus unfolds over the shell on every full page load —
 * a first visit, a return, a browser refresh, a deep link — and then fades to
 * the page the reader loaded.
 *
 * ## Every load, and only loads (owner ruling, 3 Oct 2026 — t-132)
 *
 * It used to play once per tab session (`sessionStorage`), on §6.9's "it opens
 * once per session". The owner asked for it on every return and every refresh.
 * It is mounted in the `/app` layout, which survives client-side navigation, so
 * "every load" falls out of mounting: a refresh or a new visit mounts it, a
 * link inside the app does not, and the bloom never interrupts moving around.
 *
 * It overlays the route rather than redirecting, so what is under it when it
 * fades is exactly the URL that was loaded.
 *
 * ## It covers the page from the first paint
 *
 * The overlay is in the server HTML, so there is no flash of the shell before
 * it. (While the bloom was once per session it could not be: the server cannot
 * read `sessionStorage`, so it started hidden and an effect decided.)
 *
 * A server-rendered cover has a failure mode a client-only one did not: if the
 * scripts never run, nothing would ever take it away. So until this component
 * has mounted, a CSS animation fades it out by itself after `FAILSAFE_MS`; once
 * JavaScript is alive the class comes off and the bloom's own clock rules, so
 * a slow-hydrating phone still gets the whole opening.
 *
 * ## Skippable
 *
 * Seeing it on every refresh is the point, but someone reloading in a hurry
 * should not have to wait: a click, a tap or Escape lets it go at once.
 */
export function EntryBloom() {
  const [phase, setPhase] = useState<'showing' | 'leaving' | 'done'>('showing');
  const [hydrated, setHydrated] = useState(false);

  useEffect(() => setHydrated(true), []);

  useEffect(() => {
    if (phase !== 'leaving') return;
    const timer = setTimeout(() => setPhase('done'), FADE_MS);
    return () => clearTimeout(timer);
  }, [phase]);

  useEffect(() => {
    if (phase !== 'showing') return;
    const onKey = (event: KeyboardEvent) => {
      if (event.key === 'Escape') setPhase('leaving');
    };
    document.addEventListener('keydown', onKey);
    return () => document.removeEventListener('keydown', onKey);
  }, [phase]);

  if (phase === 'done') return null;

  return (
    <div
      // Purely decorative and briefly on top of everything: a screen reader
      // should hear the shell, not an unnamed overlay. Escape (above) is the
      // keyboard's way past it; the click below is the pointer's.
      aria-hidden="true"
      /*
        The same claim as `pointer-events-auto` below, made to the things that
        listen on `document` rather than to the ones that hit-test.
        `shell-nav.tsx`'s click-away fires wherever the press lands, and this
        overlay is neither a control nor inside the nav — so a click during the
        bloom collapsed the reader's menu as their very first interaction with
        the app. `pointer-events-auto` cannot help with that: it stops the
        press reaching what is UNDER the overlay, and a document listener is
        not under anything.
      */
      {...{ [SHELL_OVERLAY_ATTR]: '' }}
      // A press anywhere skips it. It is the press itself the reader meant, not
      // whatever lies under the cover, so it is consumed here (see above).
      onClick={() => setPhase('leaving')}
      className={cn(
        'bg-background fixed inset-0 z-[100] flex items-center justify-center',
        // Solid to the pointer while opaque, so a click cannot land on a nav
        // item the reader cannot see; released for the fade, so the shell is
        // live as it appears.
        phase === 'leaving' ? 'pointer-events-none' : 'pointer-events-auto',
        // The duration is an inline style, not a class: Tailwind extracts class
        // names statically, so `duration-[${FADE_MS}ms]` would compile to
        // nothing and the fade would snap.
        'transition-opacity ease-[var(--ease-brand)] motion-reduce:transition-none',
        phase === 'leaving' ? 'opacity-0' : 'opacity-100',
        !hydrated && styles.failsafe
      )}
      style={{ transitionDuration: `${FADE_MS}ms`, animationDelay: `${FAILSAFE_MS}ms` }}
      data-testid="entry-bloom"
      data-hydrated={hydrated ? 'true' : undefined}
    >
      <Lotus size={168} autoOpen idle water onOpened={() => setPhase('leaving')} />
    </div>
  );
}
