/**
 * Reading and writing a person's discovery answers (f-onboarding t-104). The
 * rules are in `discovery.ts`; this is the database half.
 *
 * - **Answers** are slot values, appended through Daybreak's `appendSlotValue`
 *   with the onboarding module's provenance. A revision appends a version; an
 *   answer identical to the current one writes nothing.
 * - **Skips and the first sitting** are beats on the onboarding node, through
 *   `recordNodeProgress`, as the first run's are. The first sitting is marked
 *   started by the first answer, skip or leave, once. With no journey yet there is
 *   no node to record on: the write answers `failed` and the person's place is
 *   only lost for that skip, which comes back on their next visit. The shell
 *   layout's `ensureJourneyStarted` starts the journey on the next entry.
 *   Answers need no journey.
 * - **A written answer** also drops the cached block that carries the person's
 *   answers into a turn (`answers-context.ts`, t-105).
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
import {
  readJourneyNodeStates,
  readOnboardingProgress,
} from '@/lib/app/onboarding/first-run-store';
import { handedOffFrom } from '@/lib/app/onboarding/hand-off-state';
import { isRemoved } from '@/lib/app/slots/removed';
import { READABLE_SEATS } from '@/lib/app/conversation/seats';
import { FACILITATION_CONTEXT_TYPE } from '@/lib/app/voice/context-contributor';
import { invalidateContext } from '@/lib/orchestration/chat/context-builder';
import { logger } from '@/lib/logging';
import { isRecord } from '@/lib/utils';

/** Everything the questions surface needs, for one person, from server state alone. */
export interface DiscoveryState {
  set: DiscoverySetToAsk;
  /** The current answers to questions in the set, by question id. */
  answers: Record<string, DiscoveryAnswer>;
  /**
   * The slot version each current answer is, by question id. The surface
   * keeps an answer it saved only while it is newer than the server's, so a
   * revision made on another device is never hidden by an older one here.
   */
  versions: Record<string, number>;
  position: DiscoveryPosition;
  /** The person has been through a first sitting: answered, skipped or left. */
  started: boolean;
  /** The person has begun the journey: onboarding handed them into Values (t-106). */
  handedOff: boolean;
}

/**
 * The person's discovery state, or `null` when it could not be read (logged).
 * The shell renders nothing on `null` rather than asking again from the start.
 * `preloaded` is the set when the caller has already read it.
 */
export async function getDiscoveryState(
  userId: string,
  preloaded?: DiscoverySetToAsk
): Promise<DiscoveryState | null> {
  try {
    const set = preloaded ?? (await getDiscoverySet());
    const ids = set.questions.map((q) => q.id);
    const [heads, states] = await Promise.all([
      // `getSlotHeads` reads every head for an empty list, so never pass one.
      ids.length === 0
        ? Promise.resolve([])
        : getSlotHeads(userId, { slotSlugs: set.questions.map((q) => q.slotSlug) }),
      readJourneyNodeStates(userId),
    ]);
    const progress = states.find((s) => s.nodeKey === ONBOARDING_NODE_KEY)?.progress ?? null;
    const ledger = discoveryLedgerFrom(progress);

    const answers: Record<string, DiscoveryAnswer> = {};
    const versions: Record<string, number> = {};
    for (const question of set.questions) {
      const head = heads.find((h) => h.slotSlug === question.slotSlug);
      // A removed answer (t-78) is unanswered again: its placeholder holds
      // nothing of theirs, and the question is theirs to answer afresh.
      if (!head || isRemoved(head)) continue;
      answers[question.id] = readAnswer(head.value, !!question.conditionalFollowUp);
      versions[question.id] = head.version;
    }
    const answered = new Set(Object.keys(answers));
    const position = discoveryPosition(set.questions, answered, new Set(ledger.skipped));
    return {
      set,
      answers,
      versions,
      position,
      started: ledger.started || answered.size > 0 || ledger.skipped.length > 0,
      handedOff: handedOffFrom(states),
    };
  } catch (error) {
    logger.error('Discovery state could not be read', error, { userId });
    return null;
  }
}

/** What {@link answerDiscoveryQuestion} did, and the slot version that now holds the answer. */
export interface AnswerResult {
  outcome: 'written' | 'unchanged';
  version: number;
}

/** Daybreak's `(userId, slotSlug, version)` backstop, hit by a racing save. */
function isUniqueViolation(error: unknown): boolean {
  return isRecord(error) && error.code === 'P2002';
}

/**
 * Write `answer` as the value of `question`'s slot. Appends a version, never
 * overwrites. Throws when the write fails: the person's words are the thing
 * being saved, so the caller must hear it did not land.
 *
 * Two saves racing on one question both compute the same next version and
 * the loser hits Daybreak's unique backstop. It is retried once, against the
 * fresh head, so a double-submit lands rather than erroring, and lands as
 * `unchanged` when the winner wrote the same words.
 *
 * A written answer also marks the first sitting started (never throws).
 */
export async function answerDiscoveryQuestion(
  userId: string,
  set: Pick<DiscoverySetToAsk, 'moduleSlug'>,
  question: Pick<DiscoveryQuestionToAsk, 'id' | 'slotSlug'>,
  answer: DiscoveryAnswer,
  retried = false
): Promise<AnswerResult> {
  const value = answerValue(answer);
  const [head] = await getSlotHeads(userId, { slotSlugs: [question.slotSlug] });
  if (head?.value === value) return { outcome: 'unchanged', version: head.version };

  const provenance: SlotValueProvenance = {
    moduleSlug: set.moduleSlug,
    nodeKey: ONBOARDING_NODE_KEY,
  };
  let written: { version: number };
  try {
    written = await appendSlotValue({
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
  } catch (error) {
    if (retried || !isUniqueViolation(error)) throw error;
    return answerDiscoveryQuestion(userId, set, question, answer, true);
  }
  forgetCachedAnswers(userId);
  await markDiscoveryStarted(userId, { action: 'answer', questionId: question.id });
  return { outcome: 'written', version: written.version };
}

/**
 * Drop the person's cached facilitation block on every seat they can talk to,
 * so the next turn quotes the answer just written rather than a copy of the
 * block up to a minute old (t-105). Process-local, like the cache itself.
 */
function forgetCachedAnswers(userId: string): void {
  for (const seat of READABLE_SEATS) {
    invalidateContext(FACILITATION_CONTEXT_TYPE, seat, { userId });
  }
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

/**
 * Mark the first sitting started, once: the time kept is the person's first
 * answer, skip or leave. Held on the node rather than derived from answers,
 * so it survives a change to the Core Set that takes those questions out of
 * the set. Never throws.
 */
async function markDiscoveryStarted(
  userId: string,
  context: Record<string, unknown>
): Promise<DiscoveryBeatOutcome> {
  try {
    if (discoveryLedgerFrom(await readOnboardingProgress(userId)).started) return 'recorded';
  } catch (error) {
    logger.error('Discovery ledger could not be read', error, { userId, ...context });
    return 'failed';
  }
  return recordBeat(userId, DISCOVERY_STARTED_KEY, context);
}

/**
 * Record that the person skipped `questionId`. It stays unanswered. Also marks
 * the first sitting started. Never throws.
 */
export async function skipDiscoveryQuestion(
  userId: string,
  questionId: string
): Promise<DiscoveryBeatOutcome> {
  const outcome = await recordBeat(userId, skippedKeyFor(questionId), { questionId });
  if (outcome === 'recorded') await markDiscoveryStarted(userId, { action: 'skip', questionId });
  return outcome;
}

/**
 * Record that the person left the questions for now, which ends their first
 * sitting: from then on `/app` offers the next question rather than asking it.
 * Recorded once. Never throws.
 */
export function leaveDiscovery(userId: string): Promise<DiscoveryBeatOutcome> {
  return markDiscoveryStarted(userId, { action: 'leave' });
}
