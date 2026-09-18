/**
 * Whether she can be talked to right now — the operator's pause switch, and
 * what recent turns say (§08 t-55; product description §8.1).
 *
 * ## The pause switch
 *
 * An incident switch: on, and every turn on her seats is refused before any
 * model call with the `paused` ending, while every read route carries on. It is
 * a Sunrise feature flag, `LELANEA_GENERATION_PAUSED` — DB-backed, so it holds
 * across every instance of a serverless deploy, and flipped at `/admin/features`
 * with no deploy. `prisma/seeds/app-lelanea/008-generation-pause-flag.ts` creates
 * it, off, and never writes it again: the switch is operator-owned.
 *
 * **Not the circuit breaker.** The platform's breaker is per-process memory: on
 * a serverless host it does not hold between two requests, so it can say
 * nothing about "now" to the next one. Availability is learned from the switch
 * and from how turns actually ended, both of which are rows.
 *
 * ## The status read
 *
 * {@link getGenerationStatus} is what the conversation pane, and later a banner,
 * ask before or between turns:
 *
 * - `paused` — the switch is on. Deliberate; reading still works.
 * - `unavailable` — the most recent turn anyone finished, within
 *   {@link RECENT_OUTCOME_MS}, ended because the model could not answer or ran
 *   out of time. A hint, not a refusal: the next turn is still tried.
 * - `available` — otherwise.
 *
 * Install-wide and anonymous: it reads one row's status and code, never whose
 * turn it was.
 *
 * @see .context/app/agent.md — "When she can't answer"
 */

import { prisma } from '@/lib/db/client';
import { isFeatureEnabled } from '@/lib/feature-flags';
import { REPLY_NOT_LINKED } from '@/lib/app/agent/turn-record';
import { endingForCode } from '@/lib/app/agent/endings';

/** The feature flag that pauses generation. Upper-case, as the flag store keys it. */
export const GENERATION_PAUSED_FLAG = 'LELANEA_GENERATION_PAUSED';

export const GENERATION_PAUSED_FLAG_DESCRIPTION =
  'Incident switch. When enabled, every conversation turn with Lelañea is refused before any model call, with a plain "paused" ending; everything readable keeps working. Turn it off to resume.';

/** How far back a turn's outcome still says something about now. */
export const RECENT_OUTCOME_MS = 5 * 60_000;

/**
 * Failure codes that are about the person's turn, not about whether she can be
 * reached — a message the input guard blocked, a conversation at its cap, a turn
 * over its cost cap, a reply that finished but could not be linked. One of these
 * being the latest outcome says nothing about the model.
 */
const NOT_AVAILABILITY_CODES: ReadonlySet<string> = new Set([
  REPLY_NOT_LINKED,
  'input_blocked',
  'output_blocked',
  'budget_exceeded_per_turn',
  'conversation_cap_reached',
  'conversation_length_cap_reached',
  'conversation_not_found',
]);

export type GenerationStatus = 'available' | 'unavailable' | 'paused';

/**
 * Whether the operator has paused generation.
 *
 * Fails open: the flag store answers `false` on a database error. A database
 * that cannot be read fails the turn on its own a moment later, with the
 * `unavailable` ending — a pause nobody asked for would say something untrue.
 */
export function isGenerationPaused(): Promise<boolean> {
  return isFeatureEnabled(GENERATION_PAUSED_FLAG);
}

/** What the conversation pane should expect right now. One flag read, one indexed row read. */
export async function getGenerationStatus(now: Date = new Date()): Promise<GenerationStatus> {
  if (await isGenerationPaused()) return 'paused';

  const latest = await prisma.appTurn.findFirst({
    where: {
      status: { in: ['completed', 'failed'] },
      completedAt: { gte: new Date(now.getTime() - RECENT_OUTCOME_MS) },
      // `OR` null, because SQL's `NOT IN` is unknown for a null code — which
      // would drop every completed turn from the read.
      OR: [{ errorCode: null }, { errorCode: { notIn: [...NOT_AVAILABILITY_CODES] } }],
    },
    orderBy: { completedAt: 'desc' },
    select: { status: true, errorCode: true },
  });

  if (latest?.status !== 'failed' || latest.errorCode === null) return 'available';
  return endingForCode(latest.errorCode) === 'paused' ? 'available' : 'unavailable';
}
