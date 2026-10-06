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
 * empty seat drafts nothing, and an operator can rebind it in the admin. The
 * gate, the call and the charge are `seat.ts`'s, shared with regenerating and
 * the re-read.
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

import { logger } from '@/lib/logging';
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
  type SynopsisRetake,
} from '@/lib/app/journey-record/synopsis/prompt';
import { askSeat, openSeat, type SeatAgent } from '@/lib/app/journey-record/synopsis/seat';

/** The cost row's tag, so the meter can say what this was. */
export const SYNOPSIS_COST_KIND = 'journey_synopsis';

/** An account, not a scalar: room for a few paragraphs and the outcomes. */
const SYNOPSIS_MAX_TOKENS = 2_000;

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

/**
 * Ask the seat's agent for a draft of these lines: the first, or another one
 * the person asked for (`regenerate.ts`). Throws when the call fails or the
 * reply is refused.
 */
export function askForDraft(
  userId: string,
  agent: SeatAgent,
  lines: Parameters<typeof synopsisMessages>[1],
  retake?: SynopsisRetake
): Promise<SynopsisReply> {
  return askSeat(userId, agent, {
    kind: SYNOPSIS_COST_KIND,
    messages: synopsisMessages(agent.systemPrompt, lines, retake),
    responseSchema: SYNOPSIS_RESPONSE_SCHEMA,
    responseSchemaName: 'journey_synopsis',
    parse: parseSynopsisReply,
    retryUserMessage: SYNOPSIS_RETRY_MESSAGE,
    maxTokens: SYNOPSIS_MAX_TOKENS,
  });
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
  const seat = await openSeat(userId, now);
  if ('refused' in seat) return seat.refused;
  const { agent } = seat;

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
