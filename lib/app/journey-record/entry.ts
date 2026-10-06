/**
 * One entry in the journey record, as the API and the page see it
 * (f-journey-record t-145; product description §3.16).
 *
 * Shared by the server and the page, so it imports nothing that touches the
 * database.
 *
 * @see lib/app/journey-record/record.ts — the reads and writes
 * @see .context/app/journey-record.md
 */

import { z } from 'zod';

/**
 * What can come of a session. "So a user can see at a glance whether a sitting
 * resolved something or opened something" (§3.16): an action they decided on,
 * an insight they came to, a tension still open.
 */
export const JOURNEY_OUTCOME_KINDS = ['action', 'insight', 'tension'] as const;
export type JourneyOutcomeKind = (typeof JOURNEY_OUTCOME_KINDS)[number];

export const JOURNEY_ENTRY_KINDS = ['synopsis', 'own'] as const;
export type JourneyEntryKind = (typeof JOURNEY_ENTRY_KINDS)[number];

export const JOURNEY_ENTRY_STATES = ['draft', 'kept'] as const;
export type JourneyEntryState = (typeof JOURNEY_ENTRY_STATES)[number];

/** The one line a closed stop shows. */
export const JOURNEY_SUMMARY_MAX = 200;
/** A synopsis's account, or an own entry's words. Generous: people write at length. */
export const JOURNEY_BODY_MAX = 20_000;
export const JOURNEY_OUTCOME_TEXT_MAX = 500;
export const JOURNEY_OUTCOMES_MAX = 20;

export const journeyOutcomeSchema = z.object({
  kind: z.enum(JOURNEY_OUTCOME_KINDS),
  text: z.string().trim().min(1).max(JOURNEY_OUTCOME_TEXT_MAX),
});
export type JourneyOutcome = z.infer<typeof journeyOutcomeSchema>;

/** What `app_journey_entry.outcomes` holds. */
export const journeyOutcomesSchema = z.array(journeyOutcomeSchema).max(JOURNEY_OUTCOMES_MAX);

/** The session a synopsis is about, with its window. */
export interface JourneyEntrySession {
  id: string;
  /** 1 for the person's first session. */
  ordinal: number;
  startedAt: string;
  /** Null while it is the current session. */
  closedAt: string | null;
}

export interface JourneyEntry {
  id: string;
  kind: JourneyEntryKind;
  state: JourneyEntryState;
  summary: string | null;
  body: string;
  outcomes: JourneyOutcome[];
  modules: string[];
  /** "Keep this from her": no agent reads this entry. Own entries only. */
  withheldFromAgent: boolean;
  /** Where it sits in time: a synopsis at its session's start, an own entry when written. */
  occurredAt: string;
  keptAt: string | null;
  updatedAt: string;
  /** Set for a synopsis; null for an own entry, and for a synopsis whose session row is unreadable. */
  session: JourneyEntrySession | null;
}

/** How many of each kind of outcome a list of entries holds. */
export interface JourneyOutcomeCounts {
  action: number;
  insight: number;
  tension: number;
}

export function countOutcomes(outcomes: readonly JourneyOutcome[]): JourneyOutcomeCounts {
  const counts: JourneyOutcomeCounts = { action: 0, insight: 0, tension: 0 };
  for (const outcome of outcomes) counts[outcome.kind] += 1;
  return counts;
}
