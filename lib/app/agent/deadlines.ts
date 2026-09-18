/**
 * A turn's two deadlines, and a turn that runs on when its reader goes away
 * (§08 t-55; product description §8.1).
 *
 * Before this a turn with her waited on whatever the provider library defaulted
 * to — 120 seconds a request — and nothing spoke up meanwhile. Now:
 *
 * - **First-words deadline passed, no words yet:** one `still_thinking` warning.
 *   The turn is not touched — a slow answer is still her answer.
 * - **Whole-turn deadline passed:** the model call is aborted, the turn is
 *   settled failed (so its id may run again), and the reader gets the
 *   `timed_out` ending at once — not whenever the aborted stream gets round to
 *   ending.
 *
 * Both are read per request (`getAgentDeadlines()`), never at module scope, so an
 * admin's change applies to the next turn.
 *
 * ## The reader is not the turn
 *
 * Owner ruling, 18 Sept 2026: a dropped connection does not stop her answer. So
 * the upstream is pumped by its own loop from the moment the turn starts, and
 * the reader takes frames from a buffer. A reader that leaves — the client
 * disconnected, `sseResponse` stopped iterating — detaches from the buffer and
 * nothing more is kept for it; the pump runs on to `done` (or the whole-turn
 * deadline) and the turn is recorded `completed`, so the retry is a replay.
 *
 * `finished` settles when the pump does. The caller hands it to the host's
 * `after()` so a serverless function is not frozen with the turn half-run.
 *
 * @see lib/app/agent/turns.ts — the only caller
 */

import type { ChatStream } from '@/lib/orchestration/chat/types';
import type { ChatEvent } from '@/types/orchestration';
import { endingFrame, stillThinkingFrame } from '@/lib/app/agent/endings';

export interface TurnDeadlines {
  firstWordsDeadlineMs: number;
  turnDeadlineMs: number;
}

export interface DeadlineRunOptions {
  /**
   * Start the upstream under this signal. Called once, synchronously.
   *
   * `disarm()` is for the moment the upstream reports its outcome — `done`, or
   * a failure — and BEFORE that outcome is settled: it stands the whole-turn
   * deadline down, so a deadline passing mid-settle cannot end a turn that has
   * already ended. It answers `false` when the deadline fired first; the
   * deadline then owns the turn, and the outcome must not be settled.
   */
  start: (signal: AbortSignal, disarm: () => boolean) => ChatStream;
  deadlines: TurnDeadlines;
  /**
   * Settle the turn as timed out. Awaited BEFORE the reader is told, so a retry
   * sent the moment `timed_out` arrives finds the turn failed, not running.
   */
  onTimeout: () => Promise<void>;
  /** Anything the pump itself could not handle — the upstream threw. */
  onPumpError: (err: unknown) => void;
}

export interface DeadlineRun {
  /** What the reader takes. Leaving it early does not stop the turn. */
  events: ChatStream;
  /** Settles when the upstream has been drained, or abandoned at the deadline. */
  finished: Promise<void>;
}

/**
 * A buffer one reader takes from. Once the reader leaves it keeps nothing, so a
 * turn nobody is listening to does not accumulate its frames in memory.
 */
function createChannel<T>() {
  const buffer: T[] = [];
  let closed = false;
  let detached = false;
  let wake: (() => void) | null = null;

  const signal = (): void => {
    const resume = wake;
    wake = null;
    resume?.();
  };

  return {
    push(value: T): void {
      if (closed || detached) return;
      buffer.push(value);
      signal();
    },
    close(): void {
      closed = true;
      signal();
    },
    get closed(): boolean {
      return closed;
    },
    async *read(): AsyncGenerator<T> {
      try {
        for (;;) {
          const next = buffer.shift();
          if (next !== undefined) {
            yield next;
            continue;
          }
          if (closed) return;
          await new Promise<void>((resolve) => {
            wake = resolve;
          });
        }
      } finally {
        detached = true;
        buffer.length = 0;
      }
    },
  };
}

/** Run a turn under its two deadlines, independent of whoever reads it. */
export function runWithDeadlines(options: DeadlineRunOptions): DeadlineRun {
  const { deadlines } = options;
  const controller = new AbortController();
  const channel = createChannel<ChatEvent>();
  let sawWords = false;
  let timedOut = false;
  let disarmed = false;

  const firstWordsTimer = setTimeout(() => {
    if (!sawWords && !channel.closed) channel.push(stillThinkingFrame());
  }, deadlines.firstWordsDeadlineMs);

  let resolveTimedOut: () => void = () => {};
  const timedOutSettled = new Promise<void>((resolve) => {
    resolveTimedOut = resolve;
  });

  const turnTimer = setTimeout(() => {
    if (disarmed) return;
    timedOut = true;
    clearTimeout(firstWordsTimer);
    controller.abort();
    void options
      .onTimeout()
      .catch(options.onPumpError)
      .finally(() => {
        channel.push(endingFrame('timed_out'));
        channel.close();
        resolveTimedOut();
      });
  }, deadlines.turnDeadlineMs);

  const disarm = (): boolean => {
    if (timedOut) return false;
    disarmed = true;
    clearTimeout(turnTimer);
    clearTimeout(firstWordsTimer);
    return true;
  };

  const pump = async (): Promise<void> => {
    try {
      for await (const event of options.start(controller.signal, disarm)) {
        // Past the deadline the reader has its ending; what the aborted
        // upstream says on its way out is drained, not forwarded.
        if (timedOut) continue;
        if (event.type === 'content' && !sawWords) {
          sawWords = true;
          clearTimeout(firstWordsTimer);
        }
        channel.push(event);
      }
    } catch (err) {
      options.onPumpError(err);
      if (!timedOut) channel.push(endingFrame('unavailable'));
    } finally {
      clearTimeout(firstWordsTimer);
      clearTimeout(turnTimer);
      if (!timedOut) channel.close();
    }
    // A pump that ended after the deadline fired waits for the timeout's own
    // settle, so `finished` means the turn record is final either way.
    if (timedOut) await timedOutSettled;
  };

  return { events: channel.read(), finished: pump() };
}
