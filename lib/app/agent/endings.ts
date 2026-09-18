/**
 * How a turn with her ends, when it ends without her answer — one small, plain
 * vocabulary the client can rely on (§08 t-55; product description §8.1).
 *
 * The platform ends a failed turn with an `error` frame whose `code` is one of
 * several dozen (`http_429`, `missing_api_key`, `agent_not_found`, …) and whose
 * `message` was written for an operator — "Go to Admin → Providers", and on the
 * `ChatError` path the raw error text, slug included. None of that is for a
 * person in the middle of a conversation. So every frame the turn seam hands the
 * browser passes through {@link toClientEvent}, and a failure reaches it as
 * exactly one of three endings:
 *
 * | Ending        | Means                                          | What the person can do                                 |
 * | ------------- | ---------------------------------------------- | ------------------------------------------------------ |
 * | `unavailable` | she could not answer — anything but the two below | try again: the turn id makes a retry safe          |
 * | `timed_out`   | the whole-turn deadline passed                 | try again, the same way                                |
 * | `paused`      | an operator paused conversations on purpose    | wait; everything readable still works                  |
 *
 * **Unknown codes map to `unavailable`, never through.** A code the platform
 * adds tomorrow reaches the browser as the plain word, not as itself.
 *
 * **The copy here is neutral on purpose.** The words in her register, and the
 * banner, are f-conversation's; this is the contract they build against, with a
 * default that is true and says what to do (`HB10`).
 *
 * @see .context/app/agent.md — "When she can't answer"
 */

import type { ChatEvent } from '@/types/orchestration';

/** The three ways a turn ends without her answer. */
export type TurnEnding = 'unavailable' | 'timed_out' | 'paused';

export const ENDING_UNAVAILABLE = 'unavailable';
export const ENDING_TIMED_OUT = 'timed_out';
export const ENDING_PAUSED = 'paused';

/** The platform's monthly-budget warning, which carries the agent's spend. */
const BUDGET_WARNING = 'budget_warning';

/** The `warning` code sent once when no words have come by the first-words deadline. */
export const STILL_THINKING = 'still_thinking';

/**
 * Neutral default copy. Each one names what the person can do, and that thing
 * exists: a retry is safe because the turn id replays or re-runs it; a pause
 * leaves every read route answering.
 */
export const ENDING_MESSAGES: Readonly<Record<TurnEnding, string>> = {
  unavailable:
    "The conversation can't answer right now. Your message is kept — try sending it again in a moment. Everything else in the app still works.",
  timed_out: 'This took too long, so it was stopped. Your message is kept — try sending it again.',
  paused:
    'Conversations are paused for now, on purpose. Everything you can read in the app still works.',
};

const STILL_THINKING_MESSAGE = 'Still thinking — this is taking a little longer than usual.';

/**
 * Platform codes that mean the provider ran out of time, rather than refused or
 * failed. `aborted` is here because the only thing that aborts her model call is
 * the whole-turn deadline: the turn seam passes its own signal, not the
 * request's, so a client going away aborts nothing (see `turns.ts`).
 */
const TIMED_OUT_CODES: ReadonlySet<string> = new Set([
  ENDING_TIMED_OUT,
  'aborted',
  'timeout',
  'http_504',
]);

/** Which ending a platform (or seam) error code is. Anything unrecognised is `unavailable`. */
export function endingForCode(code: string): TurnEnding {
  if (code === ENDING_PAUSED) return 'paused';
  if (TIMED_OUT_CODES.has(code)) return 'timed_out';
  return 'unavailable';
}

/** The frame a turn ends on. The only shape of `error` the browser ever sees from her seat. */
export function endingFrame(ending: TurnEnding): Extract<ChatEvent, { type: 'error' }> {
  return { type: 'error', code: ending, message: ENDING_MESSAGES[ending] };
}

/** Sent once, when no words have come by the first-words deadline. The turn carries on. */
export function stillThinkingFrame(): Extract<ChatEvent, { type: 'warning' }> {
  return { type: 'warning', code: STILL_THINKING, message: STILL_THINKING_MESSAGE };
}

/**
 * The frame the browser gets for one the platform emitted.
 *
 * The two terminal failure shapes — `error`, and the per-turn cost cap's own
 * `budget_exceeded_per_turn` (which carries spend figures) — become an ending
 * frame, their code and text dropped. The agent's monthly `budget_warning`
 * ("used 85% of its $X budget") is dropped outright: it is an operator's
 * number, not a person's. Everything else passes as it is. `null` means send
 * nothing.
 */
export function toClientEvent(event: ChatEvent): ChatEvent | null {
  if (event.type === 'error') return endingFrame(endingForCode(event.code));
  if (event.type === 'budget_exceeded_per_turn') return endingFrame('unavailable');
  if (event.type === 'warning' && event.code === BUDGET_WARNING) return null;
  return event;
}

/** A stream with every frame passed through {@link toClientEvent}. */
export async function* toClientStream(events: AsyncIterable<ChatEvent>): AsyncGenerator<ChatEvent> {
  for await (const event of events) {
    const client = toClientEvent(event);
    if (client) yield client;
  }
}
