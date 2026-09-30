/**
 * Reading and writing a person's discovery answers (f-onboarding t-104). The
 * rules are in `discovery.ts`; this is the database half.
 *
 * - **Answers** are slot values, appended through Daybreak's `appendSlotValue`
 *   with the onboarding module's provenance. A revision appends a version; an
 *   answer identical to the current one writes nothing.
 * - **Skips and the first sitting** are beats on the onboarding node, through
 *   `recordNodeProgress`, as the first run's are. With no journey yet there is
 *   no node to record on: the write answers `failed` and the person's place is
 *   only lost for that skip, which comes back on their next visit. The shell
 *   layout's `ensureJourneyStarted` starts the journey on the next entry.
 *   Answers need no journey.
 */

import {
  SLOT_SOURCE_TYPE,
  appendSlotValue,
  getSlotHeads,
  type SlotValueProvenance,
} from '@/lib/framework/data-slots';
import { recordNodeProgress } from '@/lib/framework/facilitation/journey/progress';
import { JOURNEY_MAP_SLUG, ONBOARDING_NODE_KEY } from '@/lib/app/journey/map-definition';
import {
  DISCOVERY_STARTED_KEY,
  answerValue,
  discoveryLedgerFrom,
  discoveryPosition,
  readAnswer,
  skippedKeyFor,
  type DiscoveryAnswer,
  type DiscoveryPosition,
} from '@/lib/app/onboarding/discovery';
import {
  getDiscoverySet,
  type DiscoveryQuestionToAsk,
  type DiscoverySetToAsk,
} from '@/lib/app/onboarding/discovery-slots';
import { readOnboardingProgress } from '@/lib/app/onboarding/first-run-store';
import { logger } from '@/lib/logging';

/** Everything the questions surface needs, for one person, from server state alone. */
export interface DiscoveryState {
  set: DiscoverySetToAsk;
  /** The current answers to questions in the set, by question id. */
  answers: Record<string, DiscoveryAnswer>;
  position: DiscoveryPosition;
  /** The person has been through a first sitting: answered, skipped or left. */
  started: boolean;
}

/**
 * The person's discovery state, or `null` when it could not be read (logged).
 * The shell renders nothing on `null` rather than asking again from the start.
 */
export async function getDiscoveryState(userId: string): Promise<DiscoveryState | null> {
  try {
    const set = await getDiscoverySet();
    const ids = set.questions.map((q) => q.id);
    const [heads, progress] = await Promise.all([
      // `getSlotHeads` reads every head for an empty list, so never pass one.
      ids.length === 0
        ? Promise.resolve([])
        : getSlotHeads(userId, { slotSlugs: set.questions.map((q) => q.slotSlug) }),
      readOnboardingProgress(userId),
    ]);
    const ledger = discoveryLedgerFrom(progress);

    const answers: Record<string, DiscoveryAnswer> = {};
    for (const question of set.questions) {
      const head = heads.find((h) => h.slotSlug === question.slotSlug);
      if (head) answers[question.id] = readAnswer(head.value, !!question.conditionalFollowUp);
    }
    const answered = new Set(Object.keys(answers));
    const position = discoveryPosition(set.questions, answered, new Set(ledger.skipped));
    return {
      set,
      answers,
      position,
      started: ledger.started || answered.size > 0 || ledger.skipped.length > 0,
    };
  } catch (error) {
    logger.error('Discovery state could not be read', error, { userId });
    return null;
  }
}

/** What {@link answerDiscoveryQuestion} did. */
export type AnswerOutcome = 'written' | 'unchanged';

/** Daybreak's `(userId, slotSlug, version)` backstop, hit by a racing save. */
function isUniqueViolation(error: unknown): boolean {
  return typeof error === 'object' && error !== null && 'code' in error && error.code === 'P2002';
}

/**
 * Write `answer` as the value of `question`'s slot. Appends a version, never
 * overwrites. Throws when the write fails: the person's words are the thing
 * being saved, so the caller must hear it did not land.
 *
 * Two saves racing on one question both compute the same next version and
 * the loser hits Daybreak's unique backstop. It is retried once, against the
 * fresh head, so a double-submit lands rather than erroring.
 */
export async function answerDiscoveryQuestion(
  userId: string,
  set: Pick<DiscoverySetToAsk, 'moduleSlug'>,
  question: Pick<DiscoveryQuestionToAsk, 'id' | 'slotSlug'>,
  answer: DiscoveryAnswer
): Promise<AnswerOutcome> {
  const value = answerValue(answer);
  const [head] = await getSlotHeads(userId, { slotSlugs: [question.slotSlug] });
  if (head?.value === value) return 'unchanged';

  const provenance: SlotValueProvenance = {
    moduleSlug: set.moduleSlug,
    nodeKey: ONBOARDING_NODE_KEY,
  };
  const write = () =>
    appendSlotValue({
      userId,
      slotSlug: question.slotSlug,
      value,
      // Daybreak's convention for a text slot: the typed form is the words.
      valueJson: value,
      confidence: 10,
      sourceType: SLOT_SOURCE_TYPE.direct,
      reasoningNote: `The person's own answer to discovery question ${question.id}, written in onboarding.`,
      provenance,
    });
  try {
    await write();
  } catch (error) {
    if (!isUniqueViolation(error)) throw error;
    await write();
  }
  return 'written';
}

/** What a beat on the onboarding node did. */
export type DiscoveryBeatOutcome = 'recorded' | 'failed';

async function recordBeat(
  userId: string,
  key: string,
  context: Record<string, unknown>
): Promise<DiscoveryBeatOutcome> {
  try {
    const result = await recordNodeProgress(
      { userId },
      { userId, graphSlug: JOURNEY_MAP_SLUG },
      ONBOARDING_NODE_KEY,
      { [key]: new Date().toISOString() }
    );
    if (!result.ok) {
      logger.warn('Discovery beat not recorded', {
        userId,
        ...context,
        rejection: result.rejection.code,
      });
      return 'failed';
    }
    return 'recorded';
  } catch (error) {
    logger.error('Discovery beat could not be recorded', error, { userId, ...context });
    return 'failed';
  }
}

/** Record that the person skipped `questionId`. It stays unanswered. Never throws. */
export function skipDiscoveryQuestion(
  userId: string,
  questionId: string
): Promise<DiscoveryBeatOutcome> {
  return recordBeat(userId, skippedKeyFor(questionId), { questionId });
}

/**
 * Record that the person left the questions for now, which ends their first
 * sitting: from then on `/app` offers the next question rather than asking it.
 * Recorded once. Never throws.
 */
export async function leaveDiscovery(userId: string): Promise<DiscoveryBeatOutcome> {
  try {
    // Once: the time kept is when the first sitting ended.
    if (discoveryLedgerFrom(await readOnboardingProgress(userId)).started) return 'recorded';
  } catch (error) {
    logger.error('Discovery ledger could not be read', error, { userId, action: 'leave' });
    return 'failed';
  }
  return recordBeat(userId, DISCOVERY_STARTED_KEY, { action: 'leave' });
}
