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
 * exactly one of four endings:
 *
 * | Ending        | Means                                                | What the person can do                        |
 * | ------------- | ---------------------------------------------------- | --------------------------------------------- |
 * | `unavailable` | she could not answer — anything but the three below  | try again: the turn id makes a retry safe     |
 * | `timed_out`   | the whole-turn deadline passed                       | try again, the same way                       |
 * | `paused`      | an operator paused conversations on purpose          | wait; everything readable still works         |
 * | `not_sent`    | the message itself was refused — a retry fails again | say it another way; nothing else is affected  |
 *
 * **Unknown codes map to `unavailable`, never through.** A code the platform
 * adds tomorrow reaches the browser as the plain word, not as itself.
 *
 * **`not_sent` is the one ending a retry cannot cure** (owner ruling, §10, 19
 * Sept 2026). The platform refuses a message in three places, each with its own
 * code: the input guard in `block` mode (`input_blocked` — after the person's
 * row is written, so it is in the transcript), and the two conversation caps
 * (`conversation_cap_reached`, `conversation_length_cap_reached` — before it).
 * All three are about *this message*, not about her: "try again" under the same
 * id runs it into the same refusal, so the copy must not offer one (`HB10`).
 * `output_blocked` is deliberately not here — that is her reply refused, not
 * the message, and a re-run can answer differently.
 *
 * **One more code, `crisis`, is not an ending of this kind** (f-safety t-58).
 * It is never mapped from a platform frame: the crisis path builds it itself,
 * outside {@link toClientStream}, and it carries the resource a person in danger
 * is shown — as an `error` when the turn ends there, as a `warning` when her
 * turn follows. See `lib/app/safety/resource.ts` for the contract. A platform
 * frame that happened to say `crisis` would still map to `unavailable` here.
 *
 * **Nor is `ceiling_reached`** (f-safety t-59), though it ends a turn: it is
 * built by the turn seam, before anything is claimed, when the person has used
 * their month's budget (`lib/app/agent/ceiling.ts`). It carries the figures —
 * spent, limit, reset date — so it is its own frame, {@link ceilingReachedFrame},
 * and a platform frame saying `ceiling_reached` still maps to `unavailable`.
 *
 * **The copy here is neutral on purpose.** The words in her register, and the
 * banner, are f-conversation's; this is the contract they build against, with a
 * default that is true and says what to do (`HB10`).
 *
 * @see .context/app/agent.md — "When she can't answer"
 */

import type { ChatEvent } from '@/types/orchestration';

/** The four ways a turn ends without her answer. */
export type TurnEnding = 'unavailable' | 'timed_out' | 'paused' | 'not_sent';

export const ENDING_UNAVAILABLE = 'unavailable';
export const ENDING_TIMED_OUT = 'timed_out';
export const ENDING_PAUSED = 'paused';
export const ENDING_NOT_SENT = 'not_sent';

/** The code of the crisis frame — built by `lib/app/safety/resource.ts`, never mapped here. */
export const ENDING_CRISIS = 'crisis';

/** The code of the frame a turn ends on when the person has used their month's budget. */
export const ENDING_CEILING_REACHED = 'ceiling_reached';

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
  not_sent:
    "This message couldn't be sent, and sending it again as it is won't change that. It is kept here; if you'd like, put it another way. Everything else in the app still works.",
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

/**
 * Platform codes that refuse the message rather than fail to answer it. Listed
 * by name, from `streaming-handler.ts`: the input guard's block, and the two
 * conversation caps. A retry under the same id meets the same refusal.
 */
const NOT_SENT_CODES: ReadonlySet<string> = new Set([
  ENDING_NOT_SENT,
  'input_blocked',
  'conversation_cap_reached',
  'conversation_length_cap_reached',
]);

/** Which ending a platform (or seam) error code is. Anything unrecognised is `unavailable`. */
export function endingForCode(code: string): TurnEnding {
  if (code === ENDING_PAUSED) return 'paused';
  if (TIMED_OUT_CODES.has(code)) return 'timed_out';
  if (NOT_SENT_CODES.has(code)) return 'not_sent';
  return 'unavailable';
}

/** The frame a turn ends on. The only shape of `error` the browser ever sees from her seat. */
export function endingFrame(ending: TurnEnding): Extract<ChatEvent, { type: 'error' }> {
  return { type: 'error', code: ending, message: ENDING_MESSAGES[ending] };
}

/** The figures a `ceiling_reached` frame carries. `resetsAt` is an ISO instant, UTC. */
export interface CeilingReached {
  spentUsd: number;
  ceilingUsd: number;
  resetsAt: string;
}

export type CeilingReachedFrame = Extract<ChatEvent, { type: 'error' }> & {
  code: typeof ENDING_CEILING_REACHED;
  ceiling: CeilingReached;
};

const usd = new Intl.NumberFormat('en-US', { style: 'currency', currency: 'USD' });
const resetDay = new Intl.DateTimeFormat('en-GB', {
  day: 'numeric',
  month: 'long',
  timeZone: 'UTC',
});

/**
 * The reset as a person reads it — `1 October` — in UTC, because the month
 * resets at the first instant of the next UTC month wherever they are. One
 * formatter, shared with her words for the same ending (`ceilingEnding`), so the
 * neutral copy and hers cannot name different days.
 */
export function formatResetDay(at: Date): string {
  return resetDay.format(at);
}

/**
 * A limit that is nothing, as a person would read it: zero, or so small it
 * prints as `$0.00`.
 *
 * Such a limit is a setting, not a month's spend, and it will be the same after
 * the reset — so no copy for it may name a reset date as the day replies
 * return. Asked by the frame's neutral words and by hers alike (t-96).
 */
export function isNothingLimit(ceilingUsd: number): boolean {
  return ceilingUsd < 0.005;
}

/**
 * The frame a turn ends on when the person has used their month's budget.
 *
 * The default copy says why, and what they can do that exists: keep reading
 * and writing, or wait for the reset (`HB10`). It offers no "ask for more" —
 * there is no mechanism behind one (`B31`). On a limit of nothing it names no
 * reset: waiting for one would not bring replies back ({@link isNothingLimit}).
 */
export function ceilingReachedFrame(figures: {
  spentUsd: number;
  ceilingUsd: number;
  resetsAt: Date;
}): CeilingReachedFrame {
  const message = isNothingLimit(figures.ceilingUsd)
    ? 'Your conversation budget is set to nothing, so there are no replies for now. ' +
      'Everything you can read and write in the app still works.'
    : `You've used this month's conversation budget (${usd.format(figures.spentUsd)} of ` +
      `${usd.format(figures.ceilingUsd)}), so there are no more replies until it resets on ` +
      `${formatResetDay(figures.resetsAt)}. Everything you can read and write in the app still works.`;
  return {
    type: 'error',
    code: ENDING_CEILING_REACHED,
    message,
    ceiling: {
      spentUsd: figures.spentUsd,
      ceilingUsd: figures.ceilingUsd,
      resetsAt: figures.resetsAt.toISOString(),
    },
  };
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
