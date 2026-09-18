/**
 * A turn with her, made idempotent and recorded (§08 t-54; product description
 * §8.1, §8.2, §11).
 *
 * Before this, a turn sent twice was two turns: the platform wrote a second user
 * message, called the model again and billed again, because nothing on the chat
 * path carried a turn id. And no streaming turn recorded which prompt produced
 * it. This is what Daybreak's facilitation route hands a turn to, through the
 * hook registered from `lib/app/leaf-bootstrap.ts`
 * (`lib/framework/facilitation/agents/turn-hook.ts`).
 *
 * ## What a second request with the same id gets
 *
 * | The id's turn is…              | The request…                                        |
 * | ------------------------------ | --------------------------------------------------- |
 * | new                            | runs — the model is called                          |
 * | completed                      | gets the recorded reply; no model call, no cost row |
 * | still running                  | is refused (409) — never raced                      |
 * | failed, or abandoned           | runs again under the same id                        |
 * | used for a different message   | is refused (409)                                    |
 *
 * The id is scoped to the person: the same id from two people is two turns, and
 * nobody can learn anything about another person's turn by sending its id.
 *
 * **A turn with no client id behaves as it did before turn ids existed.** It is
 * given a minted id, so it is still recorded and its cost rows still tagged —
 * but a minted id is never sent again, so it can never replay or be refused.
 *
 * ## What rides on the turn
 *
 * - **Every cost row the turn causes** carries `{ turnId, seat }`, through the
 *   platform's `costLogMetadata` pass-through. Not every row: the embedding of
 *   her reply is written by a path that takes no metadata — see
 *   `.context/app/agent.md`, "What a turn records".
 * - **The person's message** carries `{ turnId, seat, fingerprintVersion }` under
 *   `metadata.app`, through `messageMetadata`. The platform puts that on the
 *   user row only; the assistant row has the model and provider. The turn row
 *   joins the two.
 *
 * ## A turn costed at nothing is said so
 *
 * Sunrise prices a turn from an in-memory registry. A model outside it is logged
 * at $0 with a warning nobody reads — which, on a meter, is a free turn. The
 * turn record says `unpriced` instead, stores no cost, and the log says so at
 * `warn` — judged from the turn's own `done`, not from a registry. See
 * `classifyPricing()`.
 *
 * ## When she can't answer (§08 t-55)
 *
 * - **Paused** by the operator: refused before the claim and before any model
 *   call, with the `paused` ending (`availability.ts`).
 * - **Deadlines**, read per request: a `still_thinking` warning at the
 *   first-words deadline; the `timed_out` ending, and a turn settled failed and
 *   retryable, at the whole-turn deadline (`deadlines.ts`).
 * - **Every frame** reaches the browser through `toClientStream()`: a failure is
 *   one of `unavailable` · `timed_out` · `paused`, never the platform's code or
 *   text (`endings.ts`).
 * - **A client that disconnects does not end the turn.** The model call runs
 *   under this seam's own signal — fired only by the whole-turn deadline — not
 *   the request's, and the stream is pumped independently of its reader and
 *   handed to the host's `keepAlive`. The turn completes, is recorded, and the
 *   retry is a replay: one model call, one cost row, one message.
 *
 * @see lib/app/agent/turn-record.ts — the store, and why a claim cannot race
 * @see lib/framework/facilitation/agents/turn-hook.ts — the seam Daybreak's route calls
 */

import type { AppTurn } from '@prisma/client';

import { logger } from '@/lib/logging';
import type { ChatStream } from '@/lib/orchestration/chat/types';
import type { ChatEvent } from '@/types/orchestration';
import { getAgentDeadlines } from '@/lib/app/agent/settings';
import { isGenerationPaused } from '@/lib/app/agent/availability';
import { runWithDeadlines } from '@/lib/app/agent/deadlines';
import { ENDING_TIMED_OUT, endingFrame, toClientStream } from '@/lib/app/agent/endings';
import {
  claimTurn,
  classifyPricing,
  hashTurnRequest,
  readAgentFingerprintVersion,
  readTurnReply,
  recordTurnCompleted,
  recordTurnFailed,
  recordTurnStarted,
  staleClaimMs,
  type TurnOutcome,
} from '@/lib/app/agent/turn-record';
import type {
  FacilitationTurn,
  FacilitationTurnRefusal,
  FacilitationTurnRun,
} from '@/lib/framework/facilitation/agents/turn-hook';

/** Error codes a refused turn carries, for a client to branch on. */
export const TURN_IN_FLIGHT = 'TURN_IN_FLIGHT';
export const TURN_ID_REUSED = 'TURN_ID_REUSED';

/** The code a replayed turn ends on when its reply no longer exists. */
export const TURN_REPLY_UNAVAILABLE = 'turn_reply_unavailable';

/** The code a turn is failed with when its stream ended without an outcome. */
export const TURN_INCOMPLETE = 'incomplete';

/** A minted id: never sent by a client, so it can never replay. */
export function mintTurnId(): string {
  return `srv_${crypto.randomUUID()}`;
}

/**
 * The completed turn, told again — no model call, no cost row.
 *
 * The frames a live turn ends with — `start`, the whole reply, its citations,
 * `done` — so a duplicate of a turn that already finished gets the same answer.
 *
 * A connection lost mid-turn is covered too: the turn runs on without its
 * reader and completes, so the retry lands here (§08 t-55).
 */
async function* replay(turn: AppTurn): ChatStream {
  const reply = await readTurnReply(turn);
  if (reply === null || turn.conversationId === null) {
    yield {
      type: 'error',
      code: TURN_REPLY_UNAVAILABLE,
      message: 'That reply is no longer available.',
    };
    return;
  }

  yield {
    type: 'start',
    conversationId: turn.conversationId,
    ...(turn.userMessageId ? { messageId: turn.userMessageId } : {}),
  };
  yield { type: 'content', delta: reply.text };
  if (reply.citations.length > 0) yield { type: 'citations', citations: reply.citations };
  const inputTokens = turn.inputTokens ?? 0;
  const outputTokens = turn.outputTokens ?? 0;
  yield {
    type: 'done',
    tokenUsage: { inputTokens, outputTokens, totalTokens: inputTokens + outputTokens },
    costUsd: turn.costUsd ?? 0,
    ...(turn.providerSlug ? { provider: turn.providerSlug } : {}),
    ...(turn.modelId ? { model: turn.modelId } : {}),
  };
}

/**
 * Pass the live stream through, settling the turn from what it says.
 *
 * The turn is settled BEFORE `done` is passed on, so a retry that lands the
 * moment the client sees `done` finds a completed turn, not a running one.
 *
 * Once the whole-turn deadline has fired the deadline owns the settle — it wrote
 * `timed_out` — so nothing here writes over it: not a `done` that arrived a
 * moment too late, and not the `aborted` error the cancelled call ends on.
 *
 * A failure to write the record is logged and never fails the turn: the person
 * is owed their answer whether or not the meter heard about it. What that costs
 * is stated where it lands — a turn left `running` is taken back as abandoned
 * after `staleClaimMs()`.
 */
async function* recorded(turn: AppTurn, events: ChatStream, isTimedOut: () => boolean): ChatStream {
  let settled = false;
  let errorCode: string | null = null;

  try {
    for await (const event of events) {
      if (event.type === 'start') {
        await recordTurnStarted(turn, {
          conversationId: event.conversationId,
          userMessageId: event.messageId ?? null,
        }).catch((err: unknown) => logRecordFailure('start', turn, err));
        turn = {
          ...turn,
          conversationId: event.conversationId,
          userMessageId: event.messageId ?? null,
        };
      } else if (event.type === 'done') {
        if (!isTimedOut()) await settleCompleted(turn, event);
        settled = true;
      } else if (event.type === 'error' || event.type === 'budget_exceeded_per_turn') {
        errorCode = event.code;
      }
      yield event;
    }
  } finally {
    if (!settled && !isTimedOut()) {
      await settleWrite(() => recordTurnFailed(turn, errorCode ?? TURN_INCOMPLETE)).catch(
        (err: unknown) => logRecordFailure('failed', turn, err)
      );
    }
  }
}

async function settleCompleted(
  turn: AppTurn,
  done: Extract<ChatEvent, { type: 'done' }>
): Promise<void> {
  try {
    const pricing = done.model
      ? await classifyPricing({
          costUsd: done.costUsd,
          inputTokens: done.tokenUsage.inputTokens,
          outputTokens: done.tokenUsage.outputTokens,
          provider: done.provider ?? null,
        })
      : null;
    if (pricing === 'unpriced') {
      logger.warn('Agent turn was costed at nothing: its model has no rate', {
        turnId: turn.turnId,
        seat: turn.seat,
        model: done.model,
        provider: done.provider,
        // The cost row the platform wrote for this turn says $0. It is not free.
        reportedCostUsd: done.costUsd,
      });
    }
    const outcome: TurnOutcome = {
      model: done.model ?? null,
      provider: done.provider ?? null,
      inputTokens: done.tokenUsage.inputTokens,
      outputTokens: done.tokenUsage.outputTokens,
      costUsd: done.costUsd,
      pricing,
    };
    const settled = await settleWrite(() => recordTurnCompleted(turn, outcome));
    if (settled === 'failed') {
      logger.warn('Agent turn finished but its reply could not be linked; left re-runnable', {
        turnId: turn.turnId,
        seat: turn.seat,
      });
    } else if (settled === null) {
      logger.warn('Agent turn outlived its claim; a later attempt owns the record', {
        turnId: turn.turnId,
        attempts: turn.attempts,
      });
    }
  } catch (err) {
    logRecordFailure('completed', turn, err);
  }
}

/**
 * A write that settles a turn, tried twice.
 *
 * A settle that is lost leaves the turn `running`, and every retry of its id is
 * refused until `staleClaimMs()` — the turn deadline and a minute — although the
 * person may already have their answer. One more attempt covers the transient failure (a dropped
 * pool connection, a failover) that is the realistic cause. Safe to repeat: the
 * write is guarded by its attempt and status, so a second try after a first that
 * did land matches nothing. Owner ruling at t-54's PR.
 */
async function settleWrite<T>(write: () => Promise<T>): Promise<T> {
  try {
    return await write();
  } catch {
    return write();
  }
}

function logRecordFailure(stage: string, turn: AppTurn, err: unknown): void {
  logger.error('Agent turn record write failed', {
    stage,
    turnId: turn.turnId,
    seat: turn.seat,
    error: err instanceof Error ? err.message : String(err),
  });
}

/** A stream of one frame: how a turn is answered without a stream of its own. */
async function* only(event: ChatEvent): ChatStream {
  yield await Promise.resolve(event);
}

/**
 * Take one facilitation turn: claim its id, then replay, refuse or run it.
 *
 * A refusal is RETURNED, before any stream exists, and the framework answers it
 * as 409 rather than opening an event stream to say no. Returned rather than
 * thrown because this runs from the boot graph, and an error class built here
 * is not the one the route's error handler checks (see the seam's docblock).
 *
 * A pause is not a refusal of THIS turn id, so it is not a 409: it is the same
 * `paused` ending any other turn would end on, sent before anything is claimed
 * or called — so when generation resumes the same id simply runs.
 */
export async function runRecordedTurn(
  turn: FacilitationTurn,
  run: FacilitationTurnRun
): Promise<ChatStream | FacilitationTurnRefusal> {
  if (await isGenerationPaused()) {
    logger.info('Agent turn refused: generation is paused', { seat: turn.role });
    return only(endingFrame('paused'));
  }

  const deadlines = await getAgentDeadlines();
  const turnId = turn.clientTurnId ?? mintTurnId();
  const requestHash = await hashTurnRequest(turn.role, turn.message);
  const fingerprintVersion = await readAgentFingerprintVersion(turn.agentSlug);
  const claim = await claimTurn(
    {
      userId: turn.userId,
      turnId,
      clientSupplied: turn.clientTurnId !== undefined,
      seat: turn.role,
      agentSlug: turn.agentSlug,
      requestHash,
    },
    fingerprintVersion,
    staleClaimMs(deadlines.turnDeadlineMs)
  );

  switch (claim.kind) {
    case 'mismatch':
      return {
        refused: true,
        message: 'This turn id was already used for a different message.',
        reason: TURN_ID_REUSED,
      };
    case 'in_flight':
      return {
        refused: true,
        message: 'This turn is still being answered. Try again in a moment.',
        reason: TURN_IN_FLIGHT,
      };
    case 'completed':
      logger.info('Agent turn replayed', { turnId, seat: turn.role });
      return toClientStream(replay(claim.turn));
    case 'claimed': {
      let timedOut = false;
      const { events, finished } = runWithDeadlines({
        deadlines,
        // The signal is this seam's, fired only by the whole-turn deadline. It
        // replaces the request's, so a client going away aborts nothing.
        start: (signal) =>
          recorded(
            claim.turn,
            run({
              costLogMetadata: { turnId, seat: turn.role },
              messageMetadata: { turnId, seat: turn.role, fingerprintVersion },
              signal,
            }),
            () => timedOut
          ),
        onTimeout: async () => {
          timedOut = true;
          logger.warn('Agent turn passed its deadline and was ended', {
            turnId,
            seat: turn.role,
            turnDeadlineMs: deadlines.turnDeadlineMs,
          });
          await settleWrite(() => recordTurnFailed(claim.turn, ENDING_TIMED_OUT)).catch(
            (err: unknown) => logRecordFailure('timed_out', claim.turn, err)
          );
        },
        onPumpError: (err) => {
          logger.error('Agent turn stream failed', {
            turnId,
            seat: turn.role,
            error: err instanceof Error ? err.message : String(err),
          });
        },
      });
      keepAlive(turn, finished);
      return toClientStream(events);
    }
  }
}

/**
 * Hand the turn's run to the host, so it outlives the response. A host that
 * refuses — `after()` outside a request scope throws — costs only the guarantee
 * on a serverless deploy; a long-lived server finishes the turn regardless.
 */
function keepAlive(turn: FacilitationTurn, finished: Promise<void>): void {
  try {
    turn.keepAlive?.(finished);
  } catch (err) {
    logger.warn('Agent turn could not be kept alive past its response', {
      seat: turn.role,
      error: err instanceof Error ? err.message : String(err),
    });
  }
}
