/**
 * The first-run sequence: the Initiation, then the reads, each once (§3.9,
 * §15, t-103). **Pure** — no database, safe in a client bundle. The reads and
 * writes are in `first-run-store.ts`.
 *
 * ## The order is the description's
 *
 * §3.9 has the app welcome first and orient second. So the Initiation comes
 * first, read with the person's name, and then the reads that orient: the
 * heart behind Lelañea, the mission, the creator, the lineage. After them the
 * sequence continues to the discovery questions (t-104); until those land it
 * ends in the empty shell, which is the conversation.
 *
 * ## Each beat is recorded once, on the onboarding node
 *
 * Owner ruling at claim: the reads are offered once and not pushed again on
 * return; they stay in the resources drawer for good. So "has this person been
 * shown it?" has to survive a reload, and it lives where Daybreak keeps a
 * node's once-only beats: `UserNodeState.progress` on the `onboarding` node,
 * written through `recordNodeProgress`. No table of ours.
 *
 * A beat is recorded when the person **moves past it**: continues from the
 * Initiation, or reads or skips a read. Not when it mounts. A person who
 * closes the tab a second into her welcome has not been welcomed, and meets it
 * again next time; one who has moved on never does.
 *
 * ## One flat key per beat
 *
 * `recordNodeProgress` merges shallowly (`jsonb ||`), so a list of offered
 * reads under one key would be replaced by whichever write landed last, and a
 * read skipped on one tab could be lost to a write from another. A key per
 * beat merges without loss. Each holds the ISO time it was recorded.
 */

import { z } from 'zod';

/**
 * The reads, in the order they are offered: heart, mission, creator, lineage.
 * Foundational document ids, so each is edited where every other document is.
 */
export const ONBOARDING_READS = [
  'the_heart_behind_lelanea',
  'the_mission',
  'about_the_creator',
  'the_lineage_of_lelanea',
] as const;
export type OnboardingRead = (typeof ONBOARDING_READS)[number];

export function isOnboardingRead(id: string): id is OnboardingRead {
  return ONBOARDING_READS.some((read) => read === id);
}

/** Where the shell renders a read, in the workspace. */
export const READ_PATH_PREFIX = '/app/read';

export function readPath(id: OnboardingRead): string {
  return `${READ_PATH_PREFIX}/${id}`;
}

/** A beat the person can move past: the Initiation, or one read. */
export type FirstRunBeat = 'initiation' | `read:${OnboardingRead}`;

export const FIRST_RUN_BEATS: readonly FirstRunBeat[] = [
  'initiation',
  ...ONBOARDING_READS.map((id): FirstRunBeat => `read:${id}`),
];

export const firstRunBeatSchema = z.object({
  beat: z.union([z.literal('initiation'), z.templateLiteral(['read:', z.enum(ONBOARDING_READS)])], {
    error: 'beat is "initiation" or "read:<one of the reads>"',
  }),
});

/** The `progress` key a beat is recorded under. Flat — see the docblock. */
export function progressKeyFor(beat: FirstRunBeat): string {
  return beat === 'initiation' ? 'initiation_shown_at' : `read_offered_at:${beat.slice(5)}`;
}

/** What the ledger says has happened. */
export interface FirstRunProgress {
  initiationShown: boolean;
  /** The reads already offered, in the order they are offered. */
  readsOffered: OnboardingRead[];
}

export const NOTHING_RECORDED: FirstRunProgress = { initiationShown: false, readsOffered: [] };

/**
 * The first-run beats in a node's `progress` payload.
 *
 * The payload is shared with anything else the onboarding module records
 * there (the discovery questions will), so this reads only its own keys. A
 * key counts as recorded when it is present and not `null` —
 * `recordNodeProgress` stores a `null` as a tombstone, "recorded, and empty".
 */
export function progressFromLedger(progress: unknown): FirstRunProgress {
  if (progress === null || typeof progress !== 'object' || Array.isArray(progress)) {
    return NOTHING_RECORDED;
  }
  const ledger = new Map<string, unknown>(Object.entries(progress));
  const recorded = (beat: FirstRunBeat): boolean => {
    const value = ledger.get(progressKeyFor(beat));
    return value !== undefined && value !== null;
  };
  return {
    initiationShown: recorded('initiation'),
    readsOffered: ONBOARDING_READS.filter((id) => recorded(`read:${id}`)),
  };
}

/** The beats not yet recorded, in order. Empty when the sequence is over. */
export function pendingBeats(progress: FirstRunProgress): FirstRunBeat[] {
  return FIRST_RUN_BEATS.filter((beat) =>
    beat === 'initiation'
      ? !progress.initiationShown
      : !progress.readsOffered.some((id) => `read:${id}` === beat)
  );
}
