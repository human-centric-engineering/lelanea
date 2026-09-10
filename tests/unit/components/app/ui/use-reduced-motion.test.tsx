// @vitest-environment happy-dom

/**
 * `useReducedMotion` — the three environments it has to survive.
 *
 * The lotus's own suite drives this hook through the component, which is where
 * the behaviour that matters lives. What it cannot reach is the defensiveness:
 * the modern subscription, Safari < 14's `addListener`, and no `matchMedia` at
 * all. Those branches exist because `hooks/use-theme.tsx` needed them for the
 * same API, and a branch nothing exercises is a branch nobody knows is wrong.
 *
 * The unsubscribe cases are worth more than they look. This hook is used by a
 * component that mounts on every page, so a listener left behind on unmount
 * accumulates across a session and calls `setState` on something React has
 * already thrown away.
 *
 * @see components/app/ui/use-reduced-motion.ts
 */

import { act, render, screen } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';

import { useReducedMotion } from '@/components/app/ui/use-reduced-motion';

function Probe() {
  return <span data-testid="probe">{useReducedMotion() ? 'reduced' : 'full'}</span>;
}

function value(): string {
  return screen.getByTestId('probe').textContent ?? '';
}

const original = window.matchMedia;

afterEach(() => {
  window.matchMedia = original;
});

describe('useReducedMotion', () => {
  it('follows a modern MediaQueryList, and stops when unmounted', () => {
    const listeners = new Set<(event: MediaQueryListEvent) => void>();
    let matches = false;
    window.matchMedia = ((query: string) => ({
      matches,
      media: query,
      addEventListener: (_: string, listener: (event: MediaQueryListEvent) => void) =>
        listeners.add(listener),
      removeEventListener: (_: string, listener: (event: MediaQueryListEvent) => void) =>
        listeners.delete(listener),
    })) as unknown as typeof window.matchMedia;

    const { unmount } = render(<Probe />);
    expect(value()).toBe('full');
    expect(listeners.size).toBe(1);

    matches = true;
    act(() => {
      for (const listener of listeners) listener({ matches: true } as MediaQueryListEvent);
    });
    expect(value()).toBe('reduced');

    unmount();
    expect(listeners.size).toBe(0);
  });

  it('falls back to addListener where that is the only subscription', () => {
    // Safari < 14 returns a `MediaQueryList` with `addListener` and no
    // `addEventListener`. Deprecated everywhere else, and still the only way to
    // hear about a change there — without this branch, a reader on that browser
    // gets the value at mount and never an update.
    const listeners = new Set<(event: MediaQueryListEvent) => void>();
    const removeListener = vi.fn((listener: (event: MediaQueryListEvent) => void) =>
      listeners.delete(listener)
    );
    window.matchMedia = ((query: string) => ({
      matches: true,
      media: query,
      addListener: (listener: (event: MediaQueryListEvent) => void) => listeners.add(listener),
      removeListener,
    })) as unknown as typeof window.matchMedia;

    const { unmount } = render(<Probe />);
    expect(value()).toBe('reduced');
    expect(listeners.size).toBe(1);

    act(() => {
      for (const listener of listeners) listener({ matches: false } as MediaQueryListEvent);
    });
    expect(value()).toBe('full');

    unmount();
    expect(removeListener).toHaveBeenCalledTimes(1);
    expect(listeners.size).toBe(0);
  });

  it('reports full motion where matchMedia does not exist', () => {
    // A throw here would fail the render outright rather than degrade, and the
    // honest default is the behaviour everybody had before the preference was
    // readable.
    // @ts-expect-error — removing the global is the case.
    delete window.matchMedia;

    expect(() => render(<Probe />)).not.toThrow();
    expect(value()).toBe('full');
  });

  it('starts at full motion before the effect has run', () => {
    // Server and first client render must agree, and the only honest shared
    // answer is "not known yet". It is why `Lotus` does not schedule its opening
    // until after the first effect — otherwise a reduced-motion reader would see
    // the first frame of an animation they turned off.
    window.matchMedia = ((query: string) => ({
      matches: true,
      media: query,
      addEventListener: () => {},
      removeEventListener: () => {},
    })) as unknown as typeof window.matchMedia;

    let seen: string | undefined;
    function Capture() {
      const reduced = useReducedMotion();
      seen ??= reduced ? 'reduced' : 'full';
      return null;
    }
    render(<Capture />);

    expect(seen).toBe('full');
  });
});
