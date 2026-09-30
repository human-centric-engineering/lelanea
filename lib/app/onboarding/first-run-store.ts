/**
 * Reading and recording the first-run beats on the person's onboarding node
 * (t-103). The rules are in `first-run.ts`; this is the database half.
 *
 * ## When there is no node to record on
 *
 * `recordNodeProgress` refuses a journey that has not started or a node never
 * entered. Neither retries here: this is also reachable from the API, and
 * starting a journey belongs to passing the gate, which a caller of this may
 * not have done. The remedy already exists: the shell layout calls
 * `ensureJourneyStarted` on every entry, so the next entry starts the journey
 * and the beat, replayed once, records then. A refusal is logged and answered
 * as `failed`.
 *
 * ## Reads that fail say "unknown", not "nothing recorded"
 *
 * {@link getFirstRunProgress} answers `null` when it could not read. The shell
 * home page renders nothing on `null` rather than greeting someone again whose
 * welcome is already behind them: a missed welcome returns on the next entry,
 * a replayed one cannot be taken back.
 */

import { getJourney, getNodeStates } from '@/lib/framework/facilitation/journey/queries';
import { recordNodeProgress } from '@/lib/framework/facilitation/journey/progress';
import { JOURNEY_MAP_SLUG, ONBOARDING_NODE_KEY } from '@/lib/app/journey/map-definition';
import {
  NOTHING_RECORDED,
  progressFromLedger,
  progressKeyFor,
  type FirstRunBeat,
  type FirstRunProgress,
} from '@/lib/app/onboarding/first-run';
import { logger } from '@/lib/logging';

/** What {@link recordFirstRunBeat} did. */
export type RecordBeatOutcome = 'recorded' | 'already' | 'failed';

/**
 * The onboarding node's `progress` payload for `userId`, or `null` when there
 * is no journey or the node was never entered. The person's own ledger: every
 * caller is that person's request. Shared with the discovery questions
 * (`discovery-store.ts`), which record their skips on the same node. Throws on
 * a failed read.
 */
export async function readOnboardingProgress(userId: string): Promise<unknown> {
  const viewer = { userId };
  const journey = await getJourney(viewer, { userId, graphSlug: JOURNEY_MAP_SLUG });
  if (!journey) return null;
  const states = await getNodeStates(viewer, { journeyId: journey.id, subject: userId });
  return states.find((state) => state.nodeKey === ONBOARDING_NODE_KEY)?.progress ?? null;
}

async function readLedger(userId: string): Promise<FirstRunProgress> {
  const progress = await readOnboardingProgress(userId);
  return progress === null ? NOTHING_RECORDED : progressFromLedger(progress);
}

/**
 * The first-run beats recorded for `userId`, or `null` when they could not be
 * read (logged). A person with no journey yet has nothing recorded.
 */
export async function getFirstRunProgress(userId: string): Promise<FirstRunProgress | null> {
  try {
    return await readLedger(userId);
  } catch (error) {
    logger.error('First-run progress could not be read', error, { userId });
    return null;
  }
}

/**
 * Record that `userId` has moved past `beat`. Once: a beat already recorded is
 * left with the time it was first recorded. Never throws — the person has
 * already moved on, and nothing they do next should wait on this.
 */
export async function recordFirstRunBeat(
  userId: string,
  beat: FirstRunBeat
): Promise<RecordBeatOutcome> {
  try {
    const progress = await readLedger(userId);
    const already =
      beat === 'initiation'
        ? progress.initiationShown
        : progress.readsOffered.some((id) => `read:${id}` === beat);
    if (already) return 'already';

    const result = await recordNodeProgress(
      { userId },
      { userId, graphSlug: JOURNEY_MAP_SLUG },
      ONBOARDING_NODE_KEY,
      { [progressKeyFor(beat)]: new Date().toISOString() }
    );
    if (!result.ok) {
      logger.warn('First-run beat not recorded', {
        userId,
        beat,
        rejection: result.rejection.code,
      });
      return 'failed';
    }
    return 'recorded';
  } catch (error) {
    logger.error('First-run beat could not be recorded', error, { userId, beat });
    return 'failed';
  }
}
