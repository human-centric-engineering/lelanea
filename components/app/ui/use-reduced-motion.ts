'use client';

import { useEffect, useState } from 'react';

const REDUCED_MOTION_QUERY = '(prefers-reduced-motion: reduce)';

/**
 * Whether this reader has asked their system for less motion.
 *
 * §6.9 makes the lotus's opening "the app's opening gesture rather than a
 * loading state" — 2200ms of staggered movement, then a breath that never
 * stops. That is exactly the class of animation the setting exists for, and a
 * `@media (prefers-reduced-motion: reduce)` block cannot reach it: the petals
 * are transitioned from inline styles, because each one's delay is computed from
 * its index. So the preference has to be a value the component can read.
 *
 * ## It starts `false`, and that is deliberate
 *
 * `matchMedia` is a browser API, so the server render and the first client
 * render must agree on something, and the honest something is "not known yet".
 * The subscription below then corrects it in an effect, before paint.
 *
 * That ordering matters for the lotus specifically and is why it takes the
 * preference as a prop-like input rather than reading it mid-animation: the
 * component uses this to decide whether to START opening, and a value arriving
 * one frame late would let a reduced-motion reader see the first frame of an
 * animation they turned off. `Lotus` handles that by not scheduling its opening
 * until after the first effect has run — see its own comment.
 *
 * ## The defensiveness is copied from `hooks/use-theme.tsx` on purpose
 *
 * `matchMedia` may be absent (jsdom-style environments, very old Safari), and
 * the `MediaQueryList` it returns may have `addListener` but not
 * `addEventListener` (Safari < 14). Both are handled the same way that hook
 * handles them, so a reader on either does not get a thrown render — they get
 * the default, which is the animated one, which is what they had before.
 */
export function useReducedMotion(): boolean {
  const [reduced, setReduced] = useState(false);

  useEffect(() => {
    const query = window.matchMedia?.(REDUCED_MOTION_QUERY);
    if (!query) return;

    setReduced(query.matches);

    const onChange = (event: MediaQueryListEvent) => setReduced(event.matches);

    if (typeof query.addEventListener === 'function') {
      query.addEventListener('change', onChange);
      return () => query.removeEventListener('change', onChange);
    }
    // Safari < 14. Deprecated, still the only subscription it has.
    query.addListener(onChange);
    return () => query.removeListener(onChange);
  }, []);

  return reduced;
}
