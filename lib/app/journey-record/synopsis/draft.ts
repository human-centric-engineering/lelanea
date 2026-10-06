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
 * arrival never waits on a model. A failure is logged and lost: the session
 * gets no draft, which is what every session before this task has.
 *
 * **Only a session of substance**: {@link MIN_SYNOPSIS_EXCHANGES} exchanges or
 * more (`material.ts`). A look-in gets none.
 *
 * **Once.** Three things stand between a session and a second draft: a
 * session that already has a synopsis is skipped; a draft already running in
 * this process for it is skipped, so two arrivals cannot pay for two calls;
 * and the unique index on `sessionId` refuses a second row from anywhere else.
 * A draft the person removed is not redrafted, because the session never
 * closes again.
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
import {
  composeSystemPromptString,
  resolveEffectivePrompt,
  type FieldMode,
} from '@/lib/orchestration/agents/resolve-effective-prompt';
import { getFacilitationBindingByRole } from '@/lib/framework/facilitation/agents/binding-queries';
import { CostOperation } from '@/types/orchestration';
import { isGenerationPaused } from '@/lib/app/agent/availability';
import { mayStartGeneratedTurn } from '@/lib/app/agent/ceiling';
import { SYNOPSIS_SEAT } from '@/lib/app/agent/pins';
import type { Session } from '@/lib/app/sessions/store';
import { hasSynopsis, writeSynopsisDraft } from '@/lib/app/journey-record/record';
import {
  countExchanges,
  MIN_SYNOPSIS_EXCHANGES,
  readSynopsisMaterial,
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
  /** Fewer exchanges than {@link MIN_SYNOPSIS_EXCHANGES}. */
  | 'not_substantial'
  /** The session already has a synopsis, or another writer stored one first. */
  | 'exists'
  /** This process is already drafting it. */
  | 'in_flight'
  | 'paused'
  | 'ceiling_reached'
  /** No active agent in the `synopsis` seat. */
  | 'no_agent'
  /** The model call failed or its reply was refused. Nothing stored. */
  | 'failed';

/** Sessions this process is drafting now, so two arrivals cannot pay for two calls. */
const inFlight = new Set<string>();

interface SynopsisAgent {
  id: string;
  provider: string;
  model: string;
  fallbackProviders: string[];
  systemPrompt: string;
}

/** The agent in the seat, with its prompt composed from its profile. Null when the seat is empty. */
async function readSeatAgent(): Promise<SynopsisAgent | null> {
  const binding = await getFacilitationBindingByRole(SYNOPSIS_SEAT);
  if (!binding?.agent || !binding.agent.isActive || binding.agent.deletedAt) return null;
  const agent = await prisma.aiAgent.findUnique({
    where: { id: binding.agent.id },
    select: {
      id: true,
      provider: true,
      model: true,
      fallbackProviders: true,
      systemInstructions: true,
      persona: true,
      brandVoiceInstructions: true,
      guardrails: true,
      personaMode: true,
      voiceMode: true,
      guardrailsMode: true,
      profile: {
        select: {
          id: true,
          name: true,
          persona: true,
          brandVoiceInstructions: true,
          guardrails: true,
        },
      },
    },
  });
  if (!agent) return null;
  const mode = (value: string): FieldMode => (value === 'append' ? 'append' : 'override');
  const systemPrompt = composeSystemPromptString(
    resolveEffectivePrompt(
      {
        systemInstructions: agent.systemInstructions,
        persona: agent.persona,
        brandVoiceInstructions: agent.brandVoiceInstructions,
        guardrails: agent.guardrails,
        personaMode: mode(agent.personaMode),
        voiceMode: mode(agent.voiceMode),
        guardrailsMode: mode(agent.guardrailsMode),
      },
      agent.profile
    )
  );
  return {
    id: agent.id,
    provider: agent.provider,
    model: agent.model,
    fallbackProviders: agent.fallbackProviders,
    systemPrompt,
  };
}

/** Charge the person for the call. Never throws: the draft is not undone by a lost cost row. */
function charge(
  userId: string,
  agentId: string,
  call: { model: string; provider: string; inputTokens: number; outputTokens: number }
): void {
  void logCost({
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
      maxTokens: SYNOPSIS_MAX_TOKENS,
      timeoutMs: SYNOPSIS_TIMEOUT_MS,
      phase: SYNOPSIS_PHASE,
    });
    charge(userId, agent.id, {
      model,
      provider: providerSlug,
      inputTokens: result.tokenUsage.input,
      outputTokens: result.tokenUsage.output,
    });
    return result.value;
  } catch (err) {
    // A truncation is the one failure that carries what it was billed.
    if (err instanceof ProviderError && err.usage) {
      charge(userId, agent.id, { model, provider: providerSlug, ...err.usage });
    }
    throw err;
  }
}

/**
 * Draft the synopsis of a session that has just closed, and store it as a
 * draft. Every refusal is an outcome, not an error; only a failure the caller
 * did not cause (the database) throws.
 *
 * @param closedAt - when the session went quiet: the end of its window
 */
export async function draftSynopsis(
  userId: string,
  session: Session,
  closedAt: Date,
  now: Date = new Date()
): Promise<SynopsisDraftOutcome> {
  const key = `${userId}\u0000${session.id}`;
  if (inFlight.has(key)) return 'in_flight';
  inFlight.add(key);
  try {
    if ((await countExchanges(userId, session.id)) < MIN_SYNOPSIS_EXCHANGES) {
      return 'not_substantial';
    }
    if (await hasSynopsis(userId, session.id)) return 'exists';
    if (await isGenerationPaused()) return 'paused';
    const allowance = await mayStartGeneratedTurn(userId, now);
    if (!allowance.allowed) return 'ceiling_reached';
    const agent = await readSeatAgent();
    if (!agent) return 'no_agent';

    const material = await readSynopsisMaterial(userId, session, closedAt);
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
  } finally {
    inFlight.delete(key);
  }
}

/**
 * {@link draftSynopsis}, without anyone waiting: what an arrival calls when it
 * closes a session. Returns at once; the outcome is logged.
 */
export function queueSynopsisDraft(userId: string, session: Session, closedAt: Date): void {
  void draftSynopsis(userId, session, closedAt)
    .then((outcome) => {
      logger.info('Synopsis draft', { userId, sessionId: session.id, outcome });
    })
    .catch((err: unknown) => {
      logger.error('Synopsis draft could not be written', {
        userId,
        sessionId: session.id,
        error: err instanceof Error ? err.message : String(err),
      });
    });
}
