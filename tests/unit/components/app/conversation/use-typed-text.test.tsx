// @vitest-environment happy-dom

/**
 * The reveal: a word at a time at the prototype's pace, keeping up with a
 * stream, holding a half-word back, and never snapping (§10 t-64).
 *
 * @see components/app/conversation/use-typed-text.ts
 */

import { act, renderHook } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { SPACE_MS, useTypedText, WORD_MS } from '@/components/app/conversation/use-typed-text';

beforeEach(() => {
  vi.useFakeTimers();
});
afterEach(() => {
  vi.useRealTimers();
});

describe('useTypedText', () => {
  it('reveals a settled text one word at a time, at the prototype’s pace', () => {
    const { result } = renderHook(() => useTypedText('one two three', true, true));

    expect(result.current).toBe('');
    act(() => {
      vi.advanceTimersByTime(0);
    });
    expect(result.current).toBe('one');
    act(() => {
      vi.advanceTimersByTime(WORD_MS);
    });
    expect(result.current).toBe('one ');
    act(() => {
      vi.advanceTimersByTime(SPACE_MS);
    });
    expect(result.current).toBe('one two');
    act(() => {
      vi.advanceTimersByTime(WORD_MS + SPACE_MS);
    });
    expect(result.current).toBe('one two three');
  });

  it('holds a trailing half-word back while the stream is open, and shows it once settled', () => {
    const { result, rerender } = renderHook(
      ({ text, settled }: { text: string; settled: boolean }) => useTypedText(text, settled, true),
      { initialProps: { text: 'Wel', settled: false } }
    );

    act(() => {
      vi.advanceTimersByTime(WORD_MS);
    });
    // `Wel` may be half of `Welcome`: nothing shown yet.
    expect(result.current).toBe('');

    rerender({ text: 'Welcome ', settled: false });
    act(() => {
      vi.advanceTimersByTime(0);
    });
    expect(result.current).toBe('Welcome');
    act(() => {
      vi.advanceTimersByTime(WORD_MS);
    });
    expect(result.current).toBe('Welcome ');

    rerender({ text: 'Welcome back', settled: true });
    act(() => {
      vi.advanceTimersByTime(WORD_MS + SPACE_MS + WORD_MS);
    });
    expect(result.current).toBe('Welcome back');
  });

  it('keeps its pace when chunks land faster than words', () => {
    // Three chunks in one millisecond must not reveal three words in one
    // millisecond — the point of the pacing is that they cannot.
    const { result, rerender } = renderHook(
      ({ text }: { text: string }) => useTypedText(text, true, true),
      { initialProps: { text: 'a ' } }
    );
    act(() => {
      vi.advanceTimersByTime(0);
    });
    expect(result.current).toBe('a');
    rerender({ text: 'a b ' });
    rerender({ text: 'a b c ' });
    act(() => {
      vi.advanceTimersByTime(1);
    });
    expect(result.current).toBe('a');
    act(() => {
      vi.advanceTimersByTime(WORD_MS + SPACE_MS + WORD_MS + SPACE_MS);
    });
    expect(result.current).toBe('a b c');
  });

  it('starts over when the text is replaced rather than extended', () => {
    const { result, rerender } = renderHook(
      ({ text }: { text: string }) => useTypedText(text, true, true),
      { initialProps: { text: 'first draft' } }
    );
    act(() => {
      vi.advanceTimersByTime(WORD_MS * 2 + SPACE_MS);
    });
    expect(result.current).toBe('first draft');

    rerender({ text: 'second thoughts' });
    // Back to the first word, not the old text with the new appended.
    act(() => {
      vi.advanceTimersByTime(0);
    });
    expect(result.current).toBe('second');
    act(() => {
      vi.advanceTimersByTime(WORD_MS + SPACE_MS);
    });
    expect(result.current).toBe('second thoughts');
  });

  it('shows the text as it is under reduced motion', () => {
    const { result, rerender } = renderHook(
      ({ text }: { text: string }) => useTypedText(text, false, false),
      { initialProps: { text: 'all at' } }
    );
    expect(result.current).toBe('all at');
    rerender({ text: 'all at once' });
    expect(result.current).toBe('all at once');
  });
});
