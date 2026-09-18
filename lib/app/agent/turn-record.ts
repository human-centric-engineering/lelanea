/**
 * The turn record — the one row that says which model and which prompt produced
 * a turn with her, what it cost, and whether a second request with the same id
 * may run it again (§08 t-54; product description §8.1, §8.2, §11).
 *
 * This file is the store. What a claim MEANS to a request — replay, refuse,
 * re-run — is `lib/app/agent/turns.ts`, which is the only caller.
 *
 * ## Claiming is the unique index, not a read-then-write
 *
 * `@@unique([userId, turnId])` is the lock. A claim tries the insert first; two
 * requests racing on one id cannot both insert, so exactly one of them runs the
 * model. The loser reads the row the winner wrote. Taking a failed or abandoned
 * id back is the same shape one step later: an `updateMany` whose `where` names
 * the status AND the attempt count it read, so of two requests re-running one
 * failed turn, one updates a row and the other updates none.
 *
 * ## An abandoned claim is taken back after STALE_CLAIM_MS
 *
 * A claim stays `running` only if the process died mid-turn — a client that
 * disconnects still ends the stream, and the stream's end settles the row. Left
 * alone, a crashed turn's id would be refused forever: a guard with a failure
 * mode and no remedy (`HB10`). So a `running` claim older than the longest a turn
 * can run is treated as failed and may be claimed again.
 *
 * @see lib/app/agent/turns.ts
 * @see .context/app/agent.md — "What a turn records"
 */

import type { AppTurn, AppTurnPricing } from '@prisma/client';

import { prisma } from '@/lib/db/client';
import { isRecord } from '@/lib/utils';
import { AGENT_SELECT, composeAgentPrompt } from '@/lib/app/voice/comparison';
import { readFingerprintVersion } from '@/lib/app/voice/fingerprint';

/**
 * How long a `running` claim is honoured before it counts as abandoned.
 *
 * Longer than any turn can run. Nothing enforces a turn deadline yet (§08 t-55
 * does), so the bound today is the platform's: a 120-second per-request library
 * timeout, over at most five tool-loop iterations. Ten minutes covers that with
 * room; t-55 can tighten it to the admin's turn deadline once that is enforced.
 */
export const STALE_CLAIM_MS = 10 * 60_000;

/** The error code of a turn that finished but whose reply could not be found. */
export const REPLY_NOT_LINKED = 'reply_not_linked';

/** What a turn is asked for — the parts a repeat must match. */
export interface TurnRequest {
  userId: string;
  turnId: string;
  clientSupplied: boolean;
  seat: string;
  agentSlug: string;
  /** {@link hashTurnRequest} of the seat and the message. */
  requestHash: string;
}

/** What a claim found. */
export type TurnClaim =
  /** This request owns the turn: call the model. */
  | { kind: 'claimed'; turn: AppTurn }
  /** The turn already has an outcome: return it, call nothing. */
  | { kind: 'completed'; turn: AppTurn }
  /** Another request is running this turn now. */
  | { kind: 'in_flight'; turn: AppTurn }
  /** The id was used for a different request. */
  | { kind: 'mismatch'; turn: AppTurn };

/**
 * A digest of what the turn asks — the seat and the words, never the words.
 *
 * NUL-separated so `("a", "bc")` and `("ab", "c")` cannot hash alike.
 */
export async function hashTurnRequest(seat: string, message: string): Promise<string> {
  // Web Crypto rather than `node:crypto`: lib/app/** stays realm-neutral.
  const bytes = new TextEncoder().encode(`${seat}\u0000${message}`);
  const digest = await crypto.subtle.digest('SHA-256', bytes);
  return Array.from(new Uint8Array(digest), (byte) => byte.toString(16).padStart(2, '0')).join('');
}

/**
 * Her fingerprint version as the agent is about to be told it, or null.
 *
 * Read from the COMPOSED prompt, as the voice comparison reads it, for the same
 * reason: the content file says which version is authored, and only the prompt
 * says which version this turn was given. Null for an agent that does not
 * inherit her core — and null, never a guess, when the agent cannot be read.
 */
export async function readAgentFingerprintVersion(agentSlug: string): Promise<string | null> {
  const agent = await prisma.aiAgent.findFirst({
    where: { slug: agentSlug, deletedAt: null },
    select: AGENT_SELECT,
  });
  return agent ? readFingerprintVersion(composeAgentPrompt(agent).systemPrompt) : null;
}

/** P2002: the `(userId, turnId)` index said no — somebody already holds this id. */
function isUniqueViolation(err: unknown): boolean {
  return isRecord(err) && err.code === 'P2002';
}

/**
 * Claim a turn id for this request.
 *
 * `fingerprintVersion` is written on every claim, re-runs included, because a
 * re-run may be told a different version than the attempt that failed.
 */
export async function claimTurn(
  request: TurnRequest,
  fingerprintVersion: string | null,
  now: Date = new Date()
): Promise<TurnClaim> {
  const { requestHash } = request;

  try {
    const turn = await prisma.appTurn.create({
      data: {
        userId: request.userId,
        turnId: request.turnId,
        clientSupplied: request.clientSupplied,
        requestHash,
        seat: request.seat,
        agentSlug: request.agentSlug,
        fingerprintVersion,
        startedAt: now,
      },
    });
    return { kind: 'claimed', turn };
  } catch (err) {
    if (!isUniqueViolation(err)) throw err;
  }

  const existing = await prisma.appTurn.findUnique({
    where: { userId_turnId: { userId: request.userId, turnId: request.turnId } },
  });
  // Unreachable unless the row was deleted between the insert and this read —
  // an erasure of this very person mid-request. Refusing is the safe answer.
  if (!existing) {
    throw new Error('Turn claim lost its row between insert and read');
  }

  if (existing.requestHash !== requestHash) return { kind: 'mismatch', turn: existing };
  if (existing.status === 'completed') return { kind: 'completed', turn: existing };

  const abandoned =
    existing.status === 'running' && now.getTime() - existing.startedAt.getTime() > STALE_CLAIM_MS;
  if (existing.status === 'running' && !abandoned) return { kind: 'in_flight', turn: existing };

  // Failed, or abandoned: take it back. The predicate names what was read, so
  // exactly one of two concurrent re-runs wins.
  const { count } = await prisma.appTurn.updateMany({
    where: { id: existing.id, status: existing.status, attempts: existing.attempts },
    data: {
      status: 'running',
      attempts: existing.attempts + 1,
      startedAt: now,
      completedAt: null,
      fingerprintVersion,
      errorCode: null,
      conversationId: null,
      userMessageId: null,
      assistantMessageId: null,
      modelId: null,
      providerSlug: null,
      inputTokens: null,
      outputTokens: null,
      costUsd: null,
      pricing: null,
    },
  });
  const turn = await prisma.appTurn.findUniqueOrThrow({ where: { id: existing.id } });
  return count === 1 ? { kind: 'claimed', turn } : { kind: 'in_flight', turn };
}

/**
 * Which attempt a settle write belongs to.
 *
 * Every write after the claim names the attempt that made it, so an attempt
 * that outlived `STALE_CLAIM_MS` and was taken over writes NOTHING when it
 * finally ends — rather than overwriting the attempt that replaced it with its
 * own model, tokens and cost, or marking a live re-run `failed` so a third
 * request runs the model again. Found by /code-review.
 */
type TurnAttempt = Pick<AppTurn, 'id' | 'attempts'>;

function attemptWhere(turn: TurnAttempt): { id: string; attempts: number; status: 'running' } {
  return { id: turn.id, attempts: turn.attempts, status: 'running' };
}

/** The ids the platform reports when the turn starts. */
export async function recordTurnStarted(
  turn: TurnAttempt,
  started: { conversationId: string; userMessageId: string | null }
): Promise<void> {
  await prisma.appTurn.updateMany({
    where: attemptWhere(turn),
    data: { conversationId: started.conversationId, userMessageId: started.userMessageId },
  });
}

/**
 * Whether a turn's cost could be known — read from what the turn was actually
 * costed at, never from a price registry.
 *
 * A turn that used tokens and came back at $0 was priced by a registry with no
 * rate for its model — logged at $0 because nobody knew the price, which a
 * meter must not read as free: `unpriced`. Unless its provider is configured as
 * local, where $0 is the truth: `local`. Anything that cost something, or used
 * nothing, is `priced`.
 *
 * **Not asked of the registry, deliberately.** This runs inside the turn hook,
 * which is registered from the boot graph; the registry keeps its prices in a
 * module-scoped variable, so asking it here would consult the boot graph's copy
 * — not the copy that priced the turn — and could call a $0 turn priced. The
 * `done` event is the answer the turn's own copy gave. Found by /code-review.
 */
export async function classifyPricing(outcome: {
  costUsd: number;
  inputTokens: number;
  outputTokens: number;
  provider: string | null;
}): Promise<AppTurnPricing> {
  const { costUsd, inputTokens, outputTokens, provider } = outcome;
  if (costUsd > 0 || inputTokens + outputTokens === 0) return 'priced';

  if (provider) {
    const config = await prisma.aiProviderConfig.findUnique({
      where: { slug: provider },
      select: { isLocal: true },
    });
    if (config?.isLocal) return 'local';
  }
  return 'unpriced';
}

/** What the platform reported on the turn's `done` event. */
export interface TurnOutcome {
  model: string | null;
  provider: string | null;
  inputTokens: number;
  outputTokens: number;
  costUsd: number;
  pricing: AppTurnPricing | null;
}

/**
 * Settle a turn as completed — or as failed, when its reply cannot be found.
 *
 * The assistant message is found rather than reported: the platform's `done`
 * event carries no message id. It is the newest assistant row in the turn's
 * conversation written at or after the person's own message for this turn.
 * Bounded by that message's `createdAt`, not by this claim's `startedAt`: both
 * message rows are stamped by the same writer, and `startedAt` is this server's
 * clock — a skew between the two would miss the reply (found by /code-review).
 * The predicate is only ambiguous for one person running two turns in one
 * conversation at once, which the seat's single conversation and the per-user
 * rate limit make a client bug rather than a use.
 *
 * **No reply found settles the turn `failed` (`reply_not_linked`)**, never
 * `completed` with nothing to replay: a completed turn with no reply would
 * answer every retry of that id with an error, forever. Failed, the id can run
 * again — at the price of a second model call, which is the lesser wrong.
 *
 * Returns the status it wrote, or null when the attempt had been superseded.
 */
export async function recordTurnCompleted(
  turn: TurnAttempt & Pick<AppTurn, 'userId' | 'startedAt' | 'conversationId' | 'userMessageId'>,
  outcome: TurnOutcome
): Promise<'completed' | 'failed' | null> {
  const owned = { conversation: { userId: turn.userId } } as const;
  const since =
    (turn.userMessageId && turn.conversationId
      ? (
          await prisma.aiMessage.findFirst({
            where: { id: turn.userMessageId, conversationId: turn.conversationId, ...owned },
            select: { createdAt: true },
          })
        )?.createdAt
      : undefined) ?? turn.startedAt;

  const assistant = turn.conversationId
    ? await prisma.aiMessage.findFirst({
        where: {
          conversationId: turn.conversationId,
          // The member's own thread and nobody else's — see the leaf's
          // ownerless-surface exception in lib/app/leaf-ci.ts.
          ...owned,
          role: 'assistant',
          createdAt: { gte: since },
        },
        orderBy: { createdAt: 'desc' },
        select: { id: true },
      })
    : null;

  if (!assistant) {
    const { count } = await prisma.appTurn.updateMany({
      where: attemptWhere(turn),
      data: { status: 'failed', completedAt: new Date(), errorCode: REPLY_NOT_LINKED },
    });
    return count === 1 ? 'failed' : null;
  }

  const { count } = await prisma.appTurn.updateMany({
    where: attemptWhere(turn),
    data: {
      status: 'completed',
      completedAt: new Date(),
      assistantMessageId: assistant.id,
      modelId: outcome.model,
      providerSlug: outcome.provider,
      inputTokens: outcome.inputTokens,
      outputTokens: outcome.outputTokens,
      // Null, never zero, when nobody knew the price. See `classifyPricing`.
      costUsd: outcome.pricing === 'unpriced' ? null : outcome.costUsd,
      pricing: outcome.pricing,
    },
  });
  return count === 1 ? 'completed' : null;
}

/** Settle a turn as failed, so the same id may run again. */
export async function recordTurnFailed(turn: TurnAttempt, errorCode: string): Promise<void> {
  await prisma.appTurn.updateMany({
    where: attemptWhere(turn),
    data: { status: 'failed', completedAt: new Date(), errorCode },
  });
}

/** The reply a completed turn produced, for a replay. Null when it is gone. */
export async function readTurnReply(
  turn: Pick<AppTurn, 'userId' | 'assistantMessageId' | 'conversationId'>
): Promise<string | null> {
  if (!turn.assistantMessageId || !turn.conversationId) return null;
  const message = await prisma.aiMessage.findFirst({
    where: {
      id: turn.assistantMessageId,
      conversationId: turn.conversationId,
      conversation: { userId: turn.userId },
    },
    select: { content: true },
  });
  return message?.content ?? null;
}

/** Every turn a person took — their Art. 15 section. */
export function findTurnsForSubject(subject: { userId: string }): Promise<AppTurn[]> {
  return prisma.appTurn.findMany({
    where: { userId: subject.userId },
    orderBy: { startedAt: 'asc' },
  });
}
