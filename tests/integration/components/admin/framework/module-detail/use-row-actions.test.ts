// @vitest-environment happy-dom

/**
 * Unit test — useRowActions (f-ops-views t-4c).
 *
 * The shared per-row action state for the binding tables: the confirm/busy/lock state machine
 * and `run()` (busy tracking, clear-confirm-on-success, failure reporting).
 *
 * @see components/admin/framework/module-detail/use-row-actions.ts
 */

import { describe, it, expect } from 'vitest';
import { renderHook, act } from '@testing-library/react';

import { useRowActions } from '@/components/admin/framework/module-detail/use-row-actions';
import { APIClientError } from '@/lib/api/client';

describe('useRowActions', () => {
  it('starts unlocked with no confirm / busy / error', () => {
    const { result } = renderHook(() => useRowActions());
    expect(result.current.locked).toBe(false);
    expect(result.current.confirmingId).toBeNull();
    expect(result.current.busyId).toBeNull();
    expect(result.current.failure).toBeNull();
  });

  it('locks while a confirm is open', () => {
    const { result } = renderHook(() => useRowActions());
    act(() => result.current.setConfirmingId('a'));
    expect(result.current.confirmingId).toBe('a');
    expect(result.current.locked).toBe(true);
  });

  it('run() clears the confirm on success', async () => {
    const { result } = renderHook(() => useRowActions());
    act(() => result.current.setConfirmingId('a'));
    await act(async () => {
      await result.current.run('a', async () => {}, 'fallback');
    });
    expect(result.current.confirmingId).toBeNull();
    expect(result.current.busyId).toBeNull();
    expect(result.current.failure).toBeNull();
  });

  it('run() leads the server message with its context and keeps the confirm', async () => {
    const { result } = renderHook(() => useRowActions());
    act(() => result.current.setConfirmingId('a'));
    await act(async () => {
      await result.current.run(
        'a',
        async () => {
          throw new APIClientError('nope', 'ERR', 400);
        },
        'Failed to unbind agent'
      );
    });
    expect(result.current.failure?.message).toBe('Failed to unbind agent: nope');
    expect(result.current.confirmingId).toBe('a');
    expect(result.current.busyId).toBeNull();
  });

  it('clears a stale error when a confirm opens (but not on cancel)', async () => {
    const { result } = renderHook(() => useRowActions());
    // A prior action failed, leaving an error.
    await act(async () => {
      await result.current.run(
        'a',
        async () => {
          throw new Error('boom');
        },
        'fallback'
      );
    });
    expect(result.current.failure?.message).toBe('fallback. Try again.');

    // Opening a confirm on another row clears the stale error.
    act(() => result.current.setConfirmingId('b'));
    expect(result.current.failure).toBeNull();

    // Re-set an error, then cancel — cancel leaves the error alone.
    await act(async () => {
      await result.current.run(
        'b',
        async () => {
          throw new Error('boom2');
        },
        'fallback2'
      );
    });
    expect(result.current.failure?.message).toBe('fallback2. Try again.');
    act(() => result.current.setConfirmingId(null));
    expect(result.current.failure?.message).toBe('fallback2. Try again.');
  });

  it('run() says only its context for a failure the server never worded', async () => {
    const { result } = renderHook(() => useRowActions());
    await act(async () => {
      await result.current.run(
        'a',
        async () => {
          throw new Error('x');
        },
        'fallback'
      );
    });
    expect(result.current.failure?.message).toBe('fallback. Try again.');
  });
});
