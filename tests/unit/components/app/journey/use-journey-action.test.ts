// @vitest-environment happy-dom

/**
 * One change to the record, and what follows it (f-journey-record t-148):
 * a re-read on success, the route's words on a refusal, a re-read too when
 * the refusal says the page is behind, and a plain line on anything else.
 *
 * @see components/app/journey/use-journey-action.ts
 */

import { act, renderHook } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import { createMockRouter } from '@/tests/types/mocks';

const router = createMockRouter();
vi.mock('next/navigation', () => ({ useRouter: () => router }));
vi.mock('@/lib/logging', () => ({ logger: { warn: vi.fn() } }));

import { useJourneyAction } from '@/components/app/journey/use-journey-action';
import { JourneyRefused } from '@/lib/app/journey-record/client';
import { logger } from '@/lib/logging';

beforeEach(() => vi.clearAllMocks());

describe('useJourneyAction', () => {
  it('re-reads the page after a call that went through, and says so', async () => {
    const { result } = renderHook(() => useJourneyAction());
    let went = false;
    await act(async () => {
      went = await result.current.run(() => Promise.resolve());
    });
    expect(went).toBe(true);
    expect(router.refresh).toHaveBeenCalledOnce();
    expect(result.current.error).toBeNull();
    expect(result.current.busy).toBe(false);
  });

  it('shows a refusal in its own words and does not re-read', async () => {
    const { result } = renderHook(() => useJourneyAction());
    let went = true;
    await act(async () => {
      went = await result.current.run(() =>
        Promise.reject(new JourneyRefused(409, 'busy', 'Still being saved.'))
      );
    });
    expect(went).toBe(false);
    expect(result.current.error).toBe('Still being saved.');
    expect(router.refresh).not.toHaveBeenCalled();
  });

  it('re-reads when the refusal says the page is behind', async () => {
    const { result } = renderHook(() => useJourneyAction());
    await act(async () => {
      await result.current.run(() =>
        Promise.reject(new JourneyRefused(409, 'changed_meanwhile', 'Changed since.'))
      );
    });
    expect(result.current.error).toBe('Changed since.');
    expect(router.refresh).toHaveBeenCalledOnce();
  });

  it('logs anything else and shows a plain line, never the raw error', async () => {
    const { result } = renderHook(() => useJourneyAction());
    await act(async () => {
      await result.current.run(() => Promise.reject(new TypeError('Failed to fetch')));
    });
    expect(result.current.error).toBe(
      'That did not go through. Check your connection and try again.'
    );
    expect(logger.warn).toHaveBeenCalledWith('Journey record change failed', {
      error: 'Failed to fetch',
    });
    expect(router.refresh).not.toHaveBeenCalled();
  });

  it('is busy while a call is out', async () => {
    const { result } = renderHook(() => useJourneyAction());
    let finish: () => void = () => {};
    let pending: Promise<boolean> = Promise.resolve(false);
    act(() => {
      pending = result.current.run(() => new Promise<void>((resolve) => (finish = resolve)));
    });
    expect(result.current.busy).toBe(true);
    await act(async () => {
      finish();
      await pending;
    });
    expect(result.current.busy).toBe(false);
  });
});
