/**
 * Draft a session's synopsis when it closes (f-journey-record t-146; product
 * description §3.16).
 *
 * When a session ended, nothing wrote down what it was about: the person had
 * no account to correct, and the recap had nothing better than raw messages.
 * This writes the draft. It is not in the record until the person keeps it
 * (t-147), and no agent reads it.
 *
 * ## When
 *
 * **When `arriveSession` closes a session.** Sessions close lazily, so the
 * arrival that opens the next one is the only moment a close is known. Only
 * that arrival writes the close (the started row's primary key settles a
 * race; `sessions/store.ts`), so only it queues a draft.
 *
 * **Off the request path.** {@link queueSynopsisDraft} returns at once, so an
 * arrival never waits on a model. It hands back the work, which the arrival
 * gives to the host's `keepAlive` (Next's `after()`), so a serverless function
 * is not frozen with the call half-run once the response has gone. A failure
 * is logged and lost: the session gets no draft, which is what every session
 * before this task has.
 *
 * **Only a session of substance**: {@link MIN_SYNOPSIS_EXCHANGES} exchanges or
 * more (`material.ts`), counted on the exchanges whose words can still be read.
 * A look-in gets none, and so does a session whose conversation was deleted
 * since, rather than a model call over what is left of it.
 *
 * **Once.** Only the arrival that writes a session's close queues its draft
 * (`sessions/store.ts`), so two arrivals never both ask. A session that already
 * has a synopsis is skipped, and the unique index on `sessionId` refuses a
 * second row from anywhere else. A draft the person removed is not redrafted,
 * because the session never closes again.
 *
 * ## Who writes it
 *
 * The agent bound to the `synopsis` seat (`agent.ts`, seeded by `026`), its
 * prompt composed from its profile as a turn's is, called one-shot through
 * `runStructuredCompletion` on its own provider and model: Daybreak's slot
 * extractor's shape (`lib/framework/data-slots/capabilities/extract.ts`). An
 * empty seat drafts nothing, and an operator can rebind it in the admin.
 *
 * ## What it costs, and who pays
 *
 * **Charged to the person, as a turn is.** It is their conversation being
 * summarised, so the cost row carries their id, tagged
 * `{ seat: 'synopsis', kind: 'journey_synopsis' }`, and their meter counts it.
 *
 * **Refused, never overdrawn.** Asked first, the way a turn asks: a person at
 * or over their monthly ceiling gets no draft, and a ceiling of zero refuses
 * every one (`mayStartGeneratedTurn` compares strictly). Generation paused
 * refuses it too. As a turn's, the check fails open on a read error, and a
 * draft that starts under the ceiling may cross it by its own cost.
 *
 * **A reply refused after its retry is not charged.** The runner throws
 * without usage when nothing parsed, so its tokens are billed by the provider
 * and never reach the meter: under-charged, never overdrawn. A truncated one
 * carries its usage and is charged.
 *
 * @see .context/app/journey-record.md — "Drafting a synopsis"
 */

import { prisma } from '@/lib/db/client';
import { logger } from '@/lib/logging';
import { logCost } from '@/lib/orchestration/llm/cost-tracker';
import { getProvider } from '@/lib/orchestration/llm/provider-manager';
import { resolveAgentProviderAndModel } from '@/lib/orchestration/llm/agent-resolver';
import { runStructuredCompletion } from '@/lib/orchestration/llm/structured-completion';
import { ProviderError } from '@/lib/orchestration/llm/provider';
import { getFacilitationBindingByRole } from '@/lib/framework/facilitation/agents/binding-queries';
import { CostOperation } from '@/types/orchestration';
import { isGenerationPaused } from '@/lib/app/agent/availability';
import { mayStartGeneratedTurn } from '@/lib/app/agent/ceiling';
import { SYNOPSIS_SEAT } from '@/lib/app/agent/pins';
import { AGENT_SELECT, composeAgentPrompt } from '@/lib/app/voice/comparison';
import { hasSynopsis, writeSynopsisDraft } from '@/lib/app/journey-record/record';
import {
  exchangesOf,
  MIN_SYNOPSIS_EXCHANGES,
  readSessionTurns,
  readSynopsisMaterial,
  type ClosedSession,
} from '@/lib/app/journey-record/synopsis/material';
import {
  parseSynopsisReply,
  SYNOPSIS_RESPONSE_SCHEMA,
  SYNOPSIS_RETRY_MESSAGE,
  synopsisMessages,
  type SynopsisReply,
} from '@/lib/app/journey-record/synopsis/prompt';

/** The cost row's tag, so the meter can say what this was. */
export const SYNOPSIS_COST_KIND = 'journey_synopsis';

/** Span phase for the call: a synopsis, not evaluation work. */
const SYNOPSIS_PHASE = 'journey-synopsis';

/** An account, not a scalar: room for a few paragraphs and the outcomes. */
const SYNOPSIS_MAX_TOKENS = 2_000;
/** Off the request path, so it can afford a slow provider. Per attempt. */
const SYNOPSIS_TIMEOUT_MS = 60_000;

/** What became of one request to draft. */
export type SynopsisDraftOutcome =
  | 'drafted'
  /** Fewer exchanges than {@link MIN_SYNOPSIS_EXCHANGES}, or fewer whose words can still be read. */
  | 'not_substantial'
  /** The session already has a synopsis, or another writer stored one first. */
  | 'exists'
  | 'paused'
  | 'ceiling_reached'
  /** No active agent in the `synopsis` seat. */
  | 'no_agent'
  /** The model call failed or its reply was refused. Nothing stored. */
  | 'failed';

interface SynopsisAgent {
  id: string;
  provider: string;
  model: string;
  fallbackProviders: string[];
  /** The operator's setting on the agent, as a turn would use it. */
  temperature: number;
  systemPrompt: string;
}

/** The agent in the seat, with its prompt composed from its profile. Null when the seat is empty. */
async function readSeatAgent(): Promise<SynopsisAgent | null> {
  const binding = await getFacilitationBindingByRole(SYNOPSIS_SEAT);
  if (!binding?.agent || !binding.agent.isActive || binding.agent.deletedAt) return null;
  const agent = await prisma.aiAgent.findUnique({
    where: { id: binding.agent.id },
    select: { ...AGENT_SELECT, fallbackProviders: true },
  });
  if (!agent) return null;
  return {
    id: agent.id,
    provider: agent.provider,
    model: agent.model,
    fallbackProviders: agent.fallbackProviders,
    temperature: agent.temperature,
    // Composed exactly as the chat handler composes a turn's, by the one helper
    // the voice comparison and the turn record already share.
    systemPrompt: composeAgentPrompt(agent).systemPrompt,
  };
}

/**
 * Charge the person for the call. Awaited, so the row is inside the work the
 * host keeps alive; never throws, because a lost cost row does not undo the
 * draft.
 */
async function charge(
  userId: string,
  agentId: string,
  call: { model: string; provider: string; inputTokens: number; outputTokens: number }
): Promise<void> {
  await logCost({
    userId,
    agentId,
    model: call.model,
    provider: call.provider,
    inputTokens: call.inputTokens,
    outputTokens: call.outputTokens,
    operation: CostOperation.CHAT,
    metadata: { seat: SYNOPSIS_SEAT, kind: SYNOPSIS_COST_KIND },
  }).catch((err: unknown) => {
    logger.warn('Synopsis cost row failed', {
      error: err instanceof Error ? err.message : String(err),
    });
  });
}

/** Ask the seat's agent for the draft. Throws when the call fails or the reply is refused. */
async function askForDraft(
  userId: string,
  agent: SynopsisAgent,
  lines: Parameters<typeof synopsisMessages>[1]
): Promise<SynopsisReply> {
  const { providerSlug, model } = await resolveAgentProviderAndModel(agent, 'chat');
  const provider = await getProvider(providerSlug);
  try {
    const result = await runStructuredCompletion<SynopsisReply>({
      provider,
      model,
      messages: synopsisMessages(agent.systemPrompt, lines),
      responseSchema: SYNOPSIS_RESPONSE_SCHEMA,
      responseSchemaName: 'journey_synopsis',
      parse: parseSynopsisReply,
      retryUserMessage: SYNOPSIS_RETRY_MESSAGE,
      temperature: agent.temperature,
      maxTokens: SYNOPSIS_MAX_TOKENS,
      timeoutMs: SYNOPSIS_TIMEOUT_MS,
      phase: SYNOPSIS_PHASE,
    });
    await charge(userId, agent.id, {
      model,
      provider: providerSlug,
      inputTokens: result.tokenUsage.input,
      outputTokens: result.tokenUsage.output,
    });
    return result.value;
  } catch (err) {
    // A truncation is the one failure that carries what it was billed.
    if (err instanceof ProviderError && err.usage) {
      await charge(userId, agent.id, { model, provider: providerSlug, ...err.usage });
    }
    throw err;
  }
}

/**
 * Draft the synopsis of a session that has just closed, and store it as a
 * draft. Every refusal is an outcome, not an error; only a failure the caller
 * did not cause (the database) throws.
 */
export async function draftSynopsis(
  userId: string,
  session: ClosedSession,
  now: Date = new Date()
): Promise<SynopsisDraftOutcome> {
  const turns = await readSessionTurns(userId, session.id);
  if (exchangesOf(turns).length < MIN_SYNOPSIS_EXCHANGES) return 'not_substantial';
  if (await hasSynopsis(userId, session.id)) return 'exists';
  if (await isGenerationPaused()) return 'paused';
  const allowance = await mayStartGeneratedTurn(userId, now);
  if (!allowance.allowed) return 'ceiling_reached';
  const agent = await readSeatAgent();
  if (!agent) return 'no_agent';

  const material = await readSynopsisMaterial(userId, session, turns);
  // Held to the exchanges that can still be read, so a session whose
  // conversation was deleted since is a look-in now, not a model call.
  if (material.readable < MIN_SYNOPSIS_EXCHANGES) return 'not_substantial';
  let reply: SynopsisReply;
  try {
    reply = await askForDraft(userId, agent, material.lines);
  } catch (err) {
    // Never the reply itself: it is an account of what the person said.
    logger.warn('Synopsis draft failed; the session has none', {
      userId,
      sessionId: session.id,
      error: err instanceof Error ? err.message : String(err),
    });
    return 'failed';
  }

  const stored = await writeSynopsisDraft(userId, {
    sessionId: session.id,
    occurredAt: session.startedAt,
    summary: reply.summary,
    body: reply.body,
    outcomes: reply.outcomes,
    modules: material.modules,
    notes: material.notes,
  });
  return stored ? 'drafted' : 'exists';
}

/**
 * {@link draftSynopsis}, without anyone waiting: what an arrival calls when it
 * closes a session. Returns the work, settled and never rejecting, for the
 * host to keep alive; the outcome is logged.
 */
export function queueSynopsisDraft(userId: string, session: ClosedSession): Promise<void> {
  return draftSynopsis(userId, session)
    .then((outcome) => {
      logger.info('Synopsis draft', { userId, sessionId: session.id, outcome });
    })
    .catch((err: unknown) => {
      logger.error(
        'Synopsis draft could not be written',
        err instanceof Error ? err : new Error(String(err)),
        { userId, sessionId: session.id }
      );
    });
}
