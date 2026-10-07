/**
 * The `synopsis` seat's agent, asked one thing one-shot and charged to the
 * person (f-journey-record t-146, t-147).
 *
 * Three callers share it, so they cannot drift apart on who may ask, who
 * answers, or who pays:
 * - drafting a closed session (`draft.ts`);
 * - regenerating a draft (`regenerate.ts`);
 * - re-reading an edited synopsis against its notes (`reread.ts`).
 *
 * **Who may ask** ({@link openSeat}): the same question a turn asks. Generation
 * paused refuses, a person at or over their monthly ceiling is refused, and an
 * empty seat answers nothing. As for a turn, the ceiling check fails open on a
 * read error, and a call that starts under the ceiling may cross it by its own
 * cost.
 *
 * **Who answers**: the agent bound to the seat, on its own provider and model,
 * through `runStructuredCompletion`: Daybreak's slot extractor's shape
 * (`lib/framework/data-slots/capabilities/extract.ts`). Only its primary
 * provider is tried, as the extractor does.
 *
 * **Who pays** ({@link askSeat}): the person, tagged with the seat and what
 * the call was for. A reply refused after its retry carries no usage and is
 * not charged: under-charged, never overdrawn. A truncated one is.
 *
 * @see .context/app/journey-record.md — "What it costs, and who pays"
 */

import { prisma } from '@/lib/db/client';
import { logger } from '@/lib/logging';
import { logCost } from '@/lib/orchestration/llm/cost-tracker';
import { getProvider } from '@/lib/orchestration/llm/provider-manager';
import { resolveAgentProviderAndModel } from '@/lib/orchestration/llm/agent-resolver';
import { runStructuredCompletion } from '@/lib/orchestration/llm/structured-completion';
import { ProviderError } from '@/lib/orchestration/llm/provider';
import type { LlmMessage } from '@/lib/orchestration/llm/types';
import { getFacilitationBindingByRole } from '@/lib/framework/facilitation/agents/binding-queries';
import { CostOperation } from '@/types/orchestration';
import { isGenerationPaused } from '@/lib/app/agent/availability';
import { mayStartGeneratedTurn } from '@/lib/app/agent/ceiling';
import { SYNOPSIS_SEAT } from '@/lib/app/agent/pins';
import { AGENT_SELECT, composeAgentPrompt } from '@/lib/app/voice/comparison';

/** Span phase for every call through the seat: a synopsis, not evaluation work. */
const SYNOPSIS_PHASE = 'journey-synopsis';

/** Off the request path or not, a slow provider is allowed this long. Per attempt. */
const SYNOPSIS_TIMEOUT_MS = 60_000;

export interface SeatAgent {
  id: string;
  provider: string;
  model: string;
  fallbackProviders: string[];
  /** The operator's setting on the agent, as a turn would use it. */
  temperature: number;
  /** Her voice and the seat's instructions, composed as a turn's prompt is. */
  systemPrompt: string;
}

/** Why the seat would not be asked. */
export type SeatRefusal = 'paused' | 'ceiling_reached' | 'no_agent';

/** The agent in the seat, with its prompt composed from its profile. Null when the seat is empty. */
async function readSeatAgent(): Promise<SeatAgent | null> {
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
 * Whether the person may be charged for a call through the seat now, and the
 * agent that would answer it. Asked before every call, in this order: paused,
 * ceiling, seat.
 */
export async function openSeat(
  userId: string,
  now: Date = new Date()
): Promise<{ agent: SeatAgent } | { refused: SeatRefusal }> {
  if (await isGenerationPaused()) return { refused: 'paused' };
  const allowance = await mayStartGeneratedTurn(userId, now);
  if (!allowance.allowed) return { refused: 'ceiling_reached' };
  const agent = await readSeatAgent();
  if (!agent) return { refused: 'no_agent' };
  return { agent };
}

/**
 * Charge the person for the call. Awaited, so the row is inside whatever work
 * the host keeps alive; never throws, because a lost cost row does not undo
 * what the call produced.
 */
async function charge(
  userId: string,
  agentId: string,
  kind: string,
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
    metadata: { seat: SYNOPSIS_SEAT, kind },
  }).catch((err: unknown) => {
    logger.warn('Synopsis seat cost row failed', {
      kind,
      error: err instanceof Error ? err.message : String(err),
    });
  });
}

/** One structured call through the seat. */
export interface SeatCall<T> {
  /** The cost row's `kind`, so the meter can say what this was. */
  kind: string;
  messages: LlmMessage[];
  responseSchema: Record<string, unknown>;
  responseSchemaName: string;
  /** The reply, or null when it is not exactly the contract. */
  parse: (raw: string) => T | null;
  retryUserMessage: string;
  maxTokens: number;
  /** Defaults to the agent's own setting, as a turn's would. */
  temperature?: number;
}

/**
 * Ask the seat's agent, and charge the person for it. Throws when the call
 * fails or the reply is refused; the caller decides what that costs them.
 */
export async function askSeat<T>(userId: string, agent: SeatAgent, call: SeatCall<T>): Promise<T> {
  const { providerSlug, model } = await resolveAgentProviderAndModel(agent, 'chat');
  const provider = await getProvider(providerSlug);
  try {
    const result = await runStructuredCompletion<T>({
      provider,
      model,
      messages: call.messages,
      responseSchema: call.responseSchema,
      responseSchemaName: call.responseSchemaName,
      parse: call.parse,
      retryUserMessage: call.retryUserMessage,
      temperature: call.temperature ?? agent.temperature,
      maxTokens: call.maxTokens,
      timeoutMs: SYNOPSIS_TIMEOUT_MS,
      phase: SYNOPSIS_PHASE,
    });
    await charge(userId, agent.id, call.kind, {
      model,
      provider: providerSlug,
      inputTokens: result.tokenUsage.input,
      outputTokens: result.tokenUsage.output,
    });
    return result.value;
  } catch (err) {
    // A truncation is the one failure that carries what it was billed.
    if (err instanceof ProviderError && err.usage) {
      await charge(userId, agent.id, call.kind, { model, provider: providerSlug, ...err.usage });
    }
    throw err;
  }
}
