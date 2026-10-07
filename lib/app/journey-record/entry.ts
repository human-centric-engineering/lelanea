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
/** How many times a person may ask for another draft of one synopsis (t-147). */
export const MAX_SYNOPSIS_REGENERATIONS = 3;
/** What a person may say about a draft when asking for another. */
export const SYNOPSIS_STEER_MAX = 500;

export const journeyOutcomeSchema = z.object({
  kind: z.enum(JOURNEY_OUTCOME_KINDS),
  text: z.string().trim().min(1).max(JOURNEY_OUTCOME_TEXT_MAX),
});
export type JourneyOutcome = z.infer<typeof journeyOutcomeSchema>;

/** What `app_journey_entry.outcomes` holds. */
export const journeyOutcomesSchema = z.array(journeyOutcomeSchema).max(JOURNEY_OUTCOMES_MAX);

/**
 * A note a synopsis lists beside it: the slot, and the version its session
 * wrote. A reference, never a reading, so removing the note takes its words
 * and nothing here keeps a copy. Keeping the synopsis confirms the ones still
 * ticked (owner ruling 2, t-147).
 */
export const journeyNoteRefSchema = z.object({
  slotSlug: z.string().min(1),
  version: z.number().int().positive(),
});
export type JourneyNoteRef = z.infer<typeof journeyNoteRefSchema>;

/** What `app_journey_entry.notes` holds. */
export const journeyNoteRefsSchema = z.array(journeyNoteRefSchema);

/**
 * A note some entry on the page lists, as the notes panel holds it now (t-148).
 * What the timeline's ticks are drawn from, so a draft shows each note's
 * heading and reading without a fetch of its own.
 *
 * Only a note the notes panel shows is here: one hidden since it was listed is
 * absent, and the page leaves its tick out. The `version` is the note's current
 * one, so a note that moved on since the session wrote it is told apart from
 * one still at the version listed.
 */
export interface JourneyListedNote {
  slotSlug: string;
  /** The slug in words, as the notes panel titles a card. */
  label: string;
  /** The current reading; null when it was withheld at capture. */
  reading: string | null;
  version: number;
  /** Whether keeping may still write to it: the notes panel would let the person correct it. */
  confirmable: boolean;
}

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
  /** The visible notes its session wrote, for keeping to confirm. Empty on an own entry. */
  notes: JourneyNoteRef[];
  /** "Keep this from her": no agent reads this entry. Own entries only. */
  withheldFromAgent: boolean;
  /** How many more drafts the person may ask for. Null unless it is a draft synopsis. */
  regenerationsLeft: number | null;
  /**
   * A kept synopsis written from an exchange the person has since deleted, so
   * it may still describe or quote it. Cleared when they change it.
   */
  sourceRemoved: boolean;
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
