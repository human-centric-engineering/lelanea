// @vitest-environment happy-dom

/**
 * The lotus — §6.9's opening gesture, and what happens when someone has asked
 * their machine to stop things moving.
 *
 * Three properties are worth a test here and the rest is geometry:
 *
 *   1. **The resting state is the default.** Every path that skips the animation
 *      — reduced motion, no JavaScript, a hydration gap — has to leave a correct
 *      lotus on the page rather than a bud that never opens. That is a claim
 *      about what is painted when nothing runs, so it is asserted on the closed
 *      render as well as the open one.
 *
 *   2. **Reduced motion is honoured, and `onOpened` still fires.** A caller
 *      sequencing something behind the bloom would otherwise be stranded for the
 *      whole session by an accessibility preference — the quiet way a
 *      reduced-motion path breaks a product.
 *
 *   3. **`size` means the bloom, not the frame.** §6.6 promises `Lotus` and
 *      `LotusMark` are interchangeable at the same size, and the two frames
 *      differ by half again in width. Nothing but a test notices when that
 *      stops being true.
 *
 * The `matchMedia` fake is the one from `tests/unit/hooks/use-theme.test.tsx`,
 * for the same reason: the preference has to be something the test can CHANGE,
 * not just something it can set once.
 *
 * @see components/app/ui/lotus.tsx
 */

import { act, render } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { LOTUS_OPENED_MS, Lotus } from '@/components/app/ui/lotus';
import { LotusMark } from '@/components/app/ui/lotus-mark';
import { LOTUS_FRAMES, LOTUS_TIERS, LOTUS_VEIN_ANGLES } from '@/components/app/ui/lotus-geometry';

/** Petals across all three tiers: 6 + 6 + 5. */
const PETAL_COUNT = LOTUS_TIERS.reduce((total, tier) => total + tier.angles.length, 0);

type Listener = (event: MediaQueryListEvent) => void;

let listeners: Listener[] = [];
let prefersReduced = false;

function setPreference(reduced: boolean) {
  prefersReduced = reduced;
  for (const listener of listeners) {
    listener({ matches: reduced } as MediaQueryListEvent);
  }
}

beforeEach(() => {
  listeners = [];
  prefersReduced = false;
  window.matchMedia = ((query: string) => ({
    matches: query.includes('prefers-reduced-motion') ? prefersReduced : false,
    media: query,
    addEventListener: (_: string, listener: Listener) => listeners.push(listener),
    removeEventListener: (_: string, listener: Listener) => {
      listeners = listeners.filter((entry) => entry !== listener);
    },
    addListener: (listener: Listener) => listeners.push(listener),
    removeListener: (listener: Listener) => {
      listeners = listeners.filter((entry) => entry !== listener);
    },
    dispatchEvent: () => false,
  })) as unknown as typeof window.matchMedia;
});

afterEach(() => {
  vi.useRealTimers();
});

/** The wrapper carrying the open state and the breath, not the `<svg>`. */
function bloom(): HTMLElement {
  const element = document.querySelector('[data-open]');
  if (!(element instanceof HTMLElement)) throw new Error('no lotus rendered');
  return element;
}

/**
 * The tier petals only.
 *
 * The vein group is also a `g[fill]` with paths in it, and it is deliberately
 * excluded: veins do not move, so their transition lives on the group rather
 * than on each path. Counting them as petals would have made the transition
 * assertions below pass against an empty string.
 */
function petals(): SVGPathElement[] {
  return [...document.querySelectorAll<SVGPathElement>('svg g[fill]:not([fill="none"]) path')];
}

/** Petals and veins together — what the whole bloom draws as paths. */
function allPaths(): SVGPathElement[] {
  return [...document.querySelectorAll<SVGPathElement>('svg g[fill] path')];
}

/**
 * When every inline transition on the rendered bloom has finished, in ms.
 *
 * Read off the DOM rather than recomputed from the constants, because a test
 * that redoes the component's arithmetic agrees with it by construction and
 * would have shipped the same 490ms gap. Each declaration is
 * `<property> <duration>ms <easing> <delay>ms`, and the easing is a
 * `cubic-bezier(…)` with commas inside it — hence the split that ignores a
 * comma with an unclosed paren behind it.
 */
function lastMovementMs(): number {
  const ends: number[] = [];
  for (const node of document.querySelectorAll<HTMLElement>('[style*="transition"]')) {
    for (const declaration of node.style.transition.split(/,(?![^(]*\))/)) {
      const times = [...declaration.matchAll(/([\d.]+)ms/g)].map((match) => Number(match[1]));
      if (times.length > 0) ends.push(times[0] + (times[1] ?? 0));
    }
  }
  return Math.max(0, ...ends);
}

describe('Lotus', () => {
  describe('the geometry §6.9 specifies', () => {
    it('draws three tiers of petals, veins and ripples', () => {
      render(<Lotus autoOpen={false} />);

      expect(petals()).toHaveLength(PETAL_COUNT);
      expect(allPaths()).toHaveLength(PETAL_COUNT + LOTUS_VEIN_ANGLES.length);
      expect(document.querySelectorAll('ellipse')).toHaveLength(
        // three ripples, the core, and the glint
        5
      );
    });

    it('drops the water frame and its ripples on request', () => {
      render(<Lotus autoOpen={false} water={false} />);

      // Only the core and the glint remain.
      expect(document.querySelectorAll('ellipse')).toHaveLength(2);
      expect(document.querySelector('svg')).toHaveAttribute('viewBox', LOTUS_FRAMES.tight.box);
    });

    it('gives each bloom its own gradient id', () => {
      // Two marks sharing an id means the second paints with the first's
      // gradient, which is a real bug and an easy one to introduce by hoisting
      // the `<defs>` to module scope.
      render(
        <>
          <Lotus autoOpen={false} />
          <Lotus autoOpen={false} />
        </>
      );
      const ids = [...document.querySelectorAll('radialGradient')].map((node) => node.id);

      expect(ids).toHaveLength(2);
      expect(new Set(ids).size).toBe(2);
    });

    it('is decorative — it never announces itself', () => {
      // §6.9 calls it an opening gesture. It carries no information a reader
      // would otherwise miss, and every place §6.7 puts it sits beside the name
      // it stands for.
      render(<Lotus autoOpen={false} />);
      expect(document.querySelector('svg')).toHaveAttribute('aria-hidden', 'true');
    });

    it('renders the bloom at `size`, whatever frame is around it', () => {
      // §6.6's interchangeability promise. The water frame is wider than the
      // tight one by half again, so comparing the two FRAMES would be the wrong
      // assertion — what has to match is the bloom inside them.
      const size = 120;
      render(<Lotus autoOpen={false} size={size} />);
      const watery = bloom();
      const frameWidth = Number.parseFloat(watery.style.width);

      expect(frameWidth * LOTUS_FRAMES.water.bloomFraction).toBeCloseTo(size, 5);
    });

    it('matches LotusMark at the same size', () => {
      render(
        <>
          <Lotus autoOpen={false} size={64} />
          <LotusMark size={64} />
        </>
      );
      const [animated, still] = [...document.querySelectorAll('svg')];

      // Both use the water frame by default, so the rendered widths agree —
      // which is what "interchangeable" has to mean at a call site.
      expect(Math.round(Number.parseFloat(animated.getAttribute('width') ?? '0'))).toBe(
        Number(still.getAttribute('width'))
      );
    });
  });

  describe('opening', () => {
    it('starts closed and settles after its delay', () => {
      vi.useFakeTimers();
      render(<Lotus delay={500} />);

      expect(bloom()).toHaveAttribute('data-open', 'false');

      act(() => void vi.advanceTimersByTime(500));
      expect(bloom()).toHaveAttribute('data-open', 'true');
    });

    it('tells the caller once the last petal has arrived', () => {
      vi.useFakeTimers();
      const onOpened = vi.fn();
      render(<Lotus onOpened={onOpened} />);

      act(() => void vi.advanceTimersByTime(0));
      expect(onOpened).not.toHaveBeenCalled();

      act(() => void vi.advanceTimersByTime(LOTUS_OPENED_MS - 1));
      expect(onOpened).not.toHaveBeenCalled();

      act(() => void vi.advanceTimersByTime(1));
      expect(onOpened).toHaveBeenCalledTimes(1);
    });

    it('waits for the bloom to STOP, not for the design kit figure', () => {
      // The bug this replaces: `LOTUS_OPENED_MS` was the kit's 2400ms, taken at
      // its word. The last outer petal does not start until 340 + 5×70 = 690ms
      // and then runs 2200ms, so it settles at 2890ms, and the ripples at 2900 —
      // ~490ms after the caller had been told the gesture was over. A screen
      // transition sequenced behind it cut the bloom off mid-flight, which is
      // visible to a person and to nothing else.
      //
      // Asserted against every transition actually rendered, so an element added
      // later with a longer tail fails here rather than shortening the gesture.
      render(<Lotus open />);

      const lastMovement = lastMovementMs();
      expect(lastMovement).toBeGreaterThan(2400);
      expect(LOTUS_OPENED_MS).toBeGreaterThanOrEqual(lastMovement);
    });

    it('fires an inline callback however often the parent re-renders', () => {
      // `onOpened={() => …}` is a new function on every render and is the
      // ordinary call shape. It used to be an effect dependency, so each render
      // cleared the pending timer and rescheduled from zero: one extra render
      // doubled the wait, and a parent that re-renders faster than the gesture —
      // a ticking clock, a form, a resize handler — starved the callback for the
      // whole session. Nothing threw, and the bloom looked perfect throughout.
      //
      // The renders are committed BETWEEN advances rather than inside one, which
      // is the whole point: a single `act()` around the full advance flushes
      // effects once at the end, so the interleaving that causes this never
      // happens and the case passes against the defect it is meant to catch.
      vi.useFakeTimers();
      const opened = vi.fn();
      const { rerender } = render(<Lotus onOpened={() => opened()} />);

      for (let elapsed = 0; elapsed < LOTUS_OPENED_MS + 1_000; elapsed += 100) {
        act(() => void vi.advanceTimersByTime(100));
        rerender(<Lotus onOpened={() => opened()} />);
      }

      expect(opened).toHaveBeenCalledTimes(1);
    });

    it('tells a caller who drives it, which is the shape the prop doc recommends', () => {
      // `<Lotus open={ready} onOpened={next} />` never called back at all: the
      // auto-open effect returned on its first line for a controlled bloom, and
      // it was the only place `onOpened` was reached from. A caller gating a
      // screen on it waited for the session, and the prop's own doc promised
      // otherwise.
      vi.useFakeTimers();
      const onOpened = vi.fn();
      const { rerender } = render(<Lotus open={false} onOpened={onOpened} />);

      act(() => void vi.advanceTimersByTime(10_000));
      expect(onOpened).not.toHaveBeenCalled();

      rerender(<Lotus open onOpened={onOpened} />);
      act(() => void vi.advanceTimersByTime(LOTUS_OPENED_MS - 1));
      expect(onOpened).not.toHaveBeenCalled();

      act(() => void vi.advanceTimersByTime(1));
      expect(onOpened).toHaveBeenCalledTimes(1);

      // Once per opening, not once per render while open.
      rerender(<Lotus open onOpened={onOpened} />);
      act(() => void vi.advanceTimersByTime(10_000));
      expect(onOpened).toHaveBeenCalledTimes(1);
    });

    it('tells a caller again if the bloom is closed and reopened', () => {
      vi.useFakeTimers();
      const onOpened = vi.fn();
      const { rerender } = render(<Lotus open onOpened={onOpened} />);
      act(() => void vi.advanceTimersByTime(LOTUS_OPENED_MS));
      expect(onOpened).toHaveBeenCalledTimes(1);

      rerender(<Lotus open={false} onOpened={onOpened} />);
      rerender(<Lotus open onOpened={onOpened} />);
      act(() => void vi.advanceTimersByTime(LOTUS_OPENED_MS));

      expect(onOpened).toHaveBeenCalledTimes(2);
    });

    it('does not open on its own when told not to', () => {
      vi.useFakeTimers();
      render(<Lotus autoOpen={false} />);

      act(() => void vi.advanceTimersByTime(10_000));
      expect(bloom()).toHaveAttribute('data-open', 'false');
    });

    it('lets a caller drive it, ignoring autoOpen entirely', () => {
      vi.useFakeTimers();
      const { rerender } = render(<Lotus open={false} />);

      act(() => void vi.advanceTimersByTime(10_000));
      expect(bloom()).toHaveAttribute('data-open', 'false');

      rerender(<Lotus open />);
      expect(bloom()).toHaveAttribute('data-open', 'true');
    });

    it('breathes once open, and only when asked to', () => {
      const { rerender } = render(<Lotus open idle />);
      const breathing = bloom().className;

      rerender(<Lotus open idle={false} />);
      expect(bloom().className).not.toBe(breathing);
      expect(bloom().className.split(/\s+/)).toEqual(['relative', 'inline-block']);
    });

    it('leaves an unopened petal folded rather than absent', () => {
      // The closed state is the SAME rotation, mostly undone, at a third of the
      // size — so if a transition never runs the mark is a lotus and not a
      // stack. Asserted on the transform because that is what carries it.
      render(<Lotus autoOpen={false} />);
      const [first] = petals();

      expect(first.style.transform).toMatch(/rotate\([-\d.]+deg\) scale\(0\.34\)/);
      expect(first.style.opacity).toBe('0');
    });
  });

  describe('reduced motion', () => {
    it('shows the bloom at rest immediately, with nothing transitioning', () => {
      prefersReduced = true;
      render(<Lotus />);

      expect(bloom()).toHaveAttribute('data-open', 'true');
      expect(bloom()).toHaveAttribute('data-reduced-motion', 'true');
      for (const petal of petals()) {
        expect(petal.style.transition).toBe('none');
        expect(petal.style.transform).toMatch(/scale\(1\)/);
      }
    });

    it('does not breathe, even with idle on', () => {
      // The breath is the animation that never ends, so it is the one that
      // matters most here. The CSS module's own media query is the belt; this
      // asserts the braces, which is the half a test can see.
      prefersReduced = true;
      render(<Lotus idle />);

      expect(bloom().className.split(/\s+/)).toEqual(['relative', 'inline-block']);
    });

    it('still tells the caller, on the same tick', () => {
      // Without this a caller gating a screen behind `onOpened` would wait
      // forever for an animation that was never going to run.
      prefersReduced = true;
      const onOpened = vi.fn();
      render(<Lotus onOpened={onOpened} delay={5_000} />);

      expect(onOpened).toHaveBeenCalledTimes(1);
    });

    it('does not open a bloom the caller is holding closed', () => {
      // `settled` was `open || reducedMotion` for every path, so a reader with
      // the OS preference set saw a fully open lotus — and `data-open="true"` —
      // from a `<Lotus open={false} />`. Skipping an animation is the promise a
      // motion preference makes; choosing the state it was going to arrive at is
      // not, and the caller had a reason.
      prefersReduced = true;
      render(<Lotus open={false} />);

      expect(bloom()).toHaveAttribute('data-open', 'false');
      expect(bloom()).toHaveAttribute('data-reduced-motion', 'true');
      for (const petal of petals()) {
        expect(petal.style.transition).toBe('none');
      }
    });

    it('tells a controlled caller on the same tick, too', () => {
      prefersReduced = true;
      const onOpened = vi.fn();
      render(<Lotus open onOpened={onOpened} />);

      expect(onOpened).toHaveBeenCalledTimes(1);
    });

    it('settles a bloom that was already opening when the preference changed', () => {
      vi.useFakeTimers();
      render(<Lotus delay={5_000} />);
      expect(bloom()).toHaveAttribute('data-open', 'false');

      act(() => setPreference(true));

      expect(bloom()).toHaveAttribute('data-open', 'true');
      // And the pending timer was cleared rather than left to fire into a
      // component that has already settled.
      act(() => void vi.advanceTimersByTime(10_000));
      expect(bloom()).toHaveAttribute('data-open', 'true');
    });

    it('animates for everyone else', () => {
      // The negative control. Every case above would pass for free if the hook
      // returned `true` unconditionally.
      render(<Lotus open />);

      expect(bloom()).not.toHaveAttribute('data-reduced-motion');
      expect(petals()[0].style.transition).toContain('cubic-bezier');
    });

    it('survives an environment with no matchMedia at all', () => {
      // @ts-expect-error — deleting a DOM global is the point of the case.
      delete window.matchMedia;
      expect(() => render(<Lotus open />)).not.toThrow();
      expect(bloom()).toHaveAttribute('data-open', 'true');
    });
  });
});

describe('LotusMark', () => {
  it('is the bloom at rest, with nothing that moves', () => {
    render(<LotusMark />);

    expect(document.querySelectorAll('svg g[fill] path')).toHaveLength(PETAL_COUNT);
    // No veins, no glint, no halation — the still glyph is the mark, not the
    // gesture. And no inline transition anywhere.
    expect(document.querySelector('[data-open]')).toBeNull();
    for (const node of document.querySelectorAll<SVGElement>('svg *')) {
      expect(node.getAttribute('style') ?? '').not.toContain('transition');
    }
  });

  it('crops tight to the bloom on request, as §6.6 asks under 40px', () => {
    render(<LotusMark size={24} water={false} />);
    const svg = document.querySelector('svg');

    expect(svg).toHaveAttribute('viewBox', LOTUS_FRAMES.tight.box);
    expect(document.querySelectorAll('ellipse')).toHaveLength(1);
    // The tight frame is barely wider than the bloom, so a 24px mark is 25px.
    expect(Number(svg?.getAttribute('width'))).toBe(
      Math.round(24 / LOTUS_FRAMES.tight.bloomFraction)
    );
  });

  it('is hidden from assistive technology', () => {
    render(<LotusMark />);
    expect(document.querySelector('svg')).toHaveAttribute('aria-hidden', 'true');
  });

  it('gives each mark its own gradient id', () => {
    render(
      <>
        <LotusMark />
        <LotusMark />
      </>
    );
    const ids = [...document.querySelectorAll('radialGradient')].map((node) => node.id);
    expect(new Set(ids).size).toBe(2);
  });
});
