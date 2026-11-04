// @vitest-environment happy-dom

/**
 * A timeout counted in seen time: it stands still while the tab is hidden and
 * carries on from where it was, so switching away and back never restarts it.
 *
 * @see components/app/ui/seen-timeout.ts
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { seenTimeout } from '@/components/app/ui/seen-timeout';

const hide = (hidden: boolean) => {
  Object.defineProperty(document, 'hidden', { configurable: true, value: hidden });
  document.dispatchEvent(new Event('visibilitychange'));
};

beforeEach(() => {
  vi.useFakeTimers();
});

afterEach(() => {
  Object.defineProperty(document, 'hidden', { configurable: true, value: false });
  vi.useRealTimers();
});

describe('seenTimeout', () => {
  it('fires once its time has passed with the tab seen', () => {
    const callback = vi.fn();
    seenTimeout(callback, 1000);
    vi.advanceTimersByTime(999);
    expect(callback).not.toHaveBeenCalled();
    vi.advanceTimersByTime(1);
    expect(callback).toHaveBeenCalledTimes(1);
  });

  it('adds up seen time across tab switches, rather than starting over', () => {
    const callback = vi.fn();
    seenTimeout(callback, 1000);
    vi.advanceTimersByTime(700);
    hide(true);
    vi.advanceTimersByTime(10_000);
    expect(callback).not.toHaveBeenCalled();
    hide(false);
    vi.advanceTimersByTime(299);
    expect(callback).not.toHaveBeenCalled();
    vi.advanceTimersByTime(1);
    expect(callback).toHaveBeenCalledTimes(1);
  });

  it('does not count from a tab that starts hidden until it is seen', () => {
    Object.defineProperty(document, 'hidden', { configurable: true, value: true });
    const callback = vi.fn();
    seenTimeout(callback, 1000);
    vi.advanceTimersByTime(5000);
    expect(callback).not.toHaveBeenCalled();
    hide(false);
    vi.advanceTimersByTime(1000);
    expect(callback).toHaveBeenCalledTimes(1);
  });

  it('fires only once, and stops listening once it has', () => {
    const callback = vi.fn();
    const remove = vi.spyOn(document, 'removeEventListener');
    seenTimeout(callback, 100);
    vi.advanceTimersByTime(100);
    hide(true);
    hide(false);
    vi.advanceTimersByTime(1000);
    expect(callback).toHaveBeenCalledTimes(1);
    expect(remove).toHaveBeenCalledWith('visibilitychange', expect.any(Function));
  });

  it('never fires once cancelled', () => {
    const callback = vi.fn();
    const cancel = seenTimeout(callback, 100);
    cancel();
    hide(true);
    hide(false);
    vi.advanceTimersByTime(1000);
    expect(callback).not.toHaveBeenCalled();
  });
});
