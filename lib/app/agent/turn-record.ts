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
import { getModel } from '@/lib/orchestration/llm/model-registry';
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
      model: null,
      provider: null,
      inputTokens: null,
      outputTokens: null,
      costUsd: null,
      pricing: null,
    },
  });
  const turn = await prisma.appTurn.findUniqueOrThrow({ where: { id: existing.id } });
  return count === 1 ? { kind: 'claimed', turn } : { kind: 'in_flight', turn };
}

/** The ids the platform reports when the turn starts. */
export async function recordTurnStarted(
  id: string,
  started: { conversationId: string; userMessageId: string | null }
): Promise<void> {
  await prisma.appTurn.update({
    where: { id },
    data: { conversationId: started.conversationId, userMessageId: started.userMessageId },
  });
}

/**
 * Whether a turn's cost could be known — asked of the same registry that
 * priced the turn's cost row, so the answer is about that row.
 *
 * A model with a rate is `priced`. One without is `local` when its provider is
 * configured as local — really free — and otherwise `unpriced`: logged at $0
 * because nobody knew the price, which a meter must not read as free.
 */
export async function classifyPricing(
  model: string,
  provider: string | null
): Promise<AppTurnPricing> {
  const info = getModel(model);
  if (info && (info.inputCostPerMillion > 0 || info.outputCostPerMillion > 0)) return 'priced';

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
 * Settle a turn as completed.
 *
 * The assistant message is found rather than reported: the platform's `done`
 * event carries no message id. It is the newest assistant row in the turn's
 * conversation written since this claim started — and the predicate is only
 * ambiguous for one person running two turns in one conversation at once, which
 * the seat's single conversation and the per-user rate limit make a client bug
 * rather than a use.
 */
export async function recordTurnCompleted(
  turn: Pick<AppTurn, 'id' | 'startedAt' | 'conversationId'>,
  outcome: TurnOutcome
): Promise<void> {
  const assistant = turn.conversationId
    ? await prisma.aiMessage.findFirst({
        where: {
          conversationId: turn.conversationId,
          role: 'assistant',
          createdAt: { gte: turn.startedAt },
        },
        orderBy: { createdAt: 'desc' },
        select: { id: true },
      })
    : null;

  await prisma.appTurn.update({
    where: { id: turn.id },
    data: {
      status: 'completed',
      completedAt: new Date(),
      assistantMessageId: assistant?.id ?? null,
      model: outcome.model,
      provider: outcome.provider,
      inputTokens: outcome.inputTokens,
      outputTokens: outcome.outputTokens,
      // Null, never zero, when nobody knew the price. See `classifyPricing`.
      costUsd: outcome.pricing === 'unpriced' ? null : outcome.costUsd,
      pricing: outcome.pricing,
    },
  });
}

/** Settle a turn as failed, so the same id may run again. */
export async function recordTurnFailed(id: string, errorCode: string): Promise<void> {
  await prisma.appTurn.update({
    where: { id },
    data: { status: 'failed', completedAt: new Date(), errorCode },
  });
}

/** The reply a completed turn produced, for a replay. Null when it is gone. */
export async function readTurnReply(
  turn: Pick<AppTurn, 'assistantMessageId' | 'conversationId'>
): Promise<string | null> {
  if (!turn.assistantMessageId || !turn.conversationId) return null;
  const message = await prisma.aiMessage.findFirst({
    where: { id: turn.assistantMessageId, conversationId: turn.conversationId },
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
