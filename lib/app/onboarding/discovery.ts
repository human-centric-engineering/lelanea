/**
 * Where a person is in the discovery questions, and how an answer is written
 * (f-onboarding t-104). **Pure**: no database, safe in a client bundle. The
 * reads and writes are in `discovery-store.ts`.
 *
 * ## An answer is the slot value, and nothing else holds it
 *
 * Each answer is the head value of that question's slot (`discovery_<id>`,
 * t-101), appended through Daybreak's `appendSlotValue`. A revision appends a
 * version, never overwrites. So "which questions has this person answered?"
 * is read from the slot heads, not from a list of ours that could disagree.
 *
 * ## A skip is a beat on the onboarding node
 *
 * A skipped question has no value: it stays unanswered, never blank. The skip
 * itself is recorded where the first run records its beats, the onboarding
 * node's `progress`, one flat key per question (`discovery_skipped_at:<id>`),
 * because `recordNodeProgress` merges shallowly. So is the first sitting:
 * `discovery_started_at`, recorded once, at the person's first answer, skip
 * or leave.
 *
 * ## Where the person resumes
 *
 * At the first question in the **current** set that is neither answered nor
 * skipped (owner ruling, 30 Sept 2026). Skipped questions wait at the end, in
 * Onboarding's own area, where they are offered again. Computed from server
 * state every time, so a reload, a week away, or a change to the Core Set
 * switch all land on the right question: the set is read fresh, and the
 * answers and skips are keyed on question ids that never change.
 *
 * ## The two questions that branch
 *
 * A question with a `conditionalFollowUp` asks yes or no first, then the
 * follow-up for that answer. The value is written as `Yes. <words>` or
 * `No. <words>`, so it reads whole to her and to the person, beside the
 * question, without the branch held anywhere else. {@link readAnswer} parses it
 * back to prefill a revision.
 */

import { z } from 'zod';

/** The longest answer accepted, in characters. Long-form, but bounded. */
export const MAX_ANSWER_LENGTH = 10_000;

/** A question id as the route accepts it; membership of the set is checked after. */
const questionIdSchema = z.string().trim().min(1).max(64);

export const DISCOVERY_BRANCHES = ['yes', 'no'] as const;
export type DiscoveryBranch = (typeof DISCOVERY_BRANCHES)[number];

/** How a branch opens the stored value. */
export const BRANCH_LABEL: Record<DiscoveryBranch, string> = { yes: 'Yes', no: 'No' };

/** What the client posts. */
export const discoveryActionSchema = z.discriminatedUnion(
  'action',
  [
    z.strictObject({
      action: z.literal('answer'),
      questionId: questionIdSchema,
      answer: z
        .string()
        .trim()
        .min(1, 'An answer cannot be empty. To leave a question for now, skip it.')
        .max(MAX_ANSWER_LENGTH, `An answer can be up to ${MAX_ANSWER_LENGTH} characters.`),
      branch: z.enum(DISCOVERY_BRANCHES).optional(),
    }),
    z.strictObject({ action: z.literal('skip'), questionId: questionIdSchema }),
    z.strictObject({ action: z.literal('leave') }),
  ],
  { error: 'action is "answer", "skip" or "leave"' }
);
export type DiscoveryAction = z.infer<typeof discoveryActionSchema>;

// ============================================================================
// The ledger keys
// ============================================================================

export const DISCOVERY_STARTED_KEY = 'discovery_started_at';
const SKIPPED_KEY_PREFIX = 'discovery_skipped_at:';

export function skippedKeyFor(questionId: string): string {
  return `${SKIPPED_KEY_PREFIX}${questionId}`;
}

/** What the onboarding node's `progress` says about the questions. */
export interface DiscoveryLedger {
  started: boolean;
  skipped: string[];
}

export const NOTHING_SKIPPED: DiscoveryLedger = { started: false, skipped: [] };

/**
 * The discovery keys in a node's `progress` payload, which the first run's
 * beats share. A key counts when present and not `null` (`recordNodeProgress`
 * stores `null` as "recorded, and empty").
 */
export function discoveryLedgerFrom(progress: unknown): DiscoveryLedger {
  if (progress === null || typeof progress !== 'object' || Array.isArray(progress)) {
    return NOTHING_SKIPPED;
  }
  const skipped: string[] = [];
  let started = false;
  for (const [key, value] of Object.entries(progress)) {
    if (value === null || value === undefined) continue;
    if (key === DISCOVERY_STARTED_KEY) started = true;
    else if (key.startsWith(SKIPPED_KEY_PREFIX)) skipped.push(key.slice(SKIPPED_KEY_PREFIX.length));
  }
  return { started, skipped };
}

// ============================================================================
// Answers
// ============================================================================

/** One answer as the surface edits it. `branch` only on a question that branches. */
export interface DiscoveryAnswer {
  words: string;
  branch?: DiscoveryBranch;
}

/** The slot value an answer is written as. */
export function answerValue(answer: DiscoveryAnswer): string {
  return answer.branch ? `${BRANCH_LABEL[answer.branch]}. ${answer.words}` : answer.words;
}

/**
 * A stored value read back as an answer. On a question that branches, a value
 * opening `Yes. ` or `No. ` gives the branch back; one that does not (the
 * follow-up was added after it was written) is all words, with no branch.
 */
export function readAnswer(value: string, branches: boolean): DiscoveryAnswer {
  if (branches) {
    for (const branch of DISCOVERY_BRANCHES) {
      const opening = `${BRANCH_LABEL[branch]}. `;
      if (value.startsWith(opening)) return { words: value.slice(opening.length), branch };
    }
  }
  return { words: value };
}

// ============================================================================
// Position
// ============================================================================

/** The minimum of a question the position needs. */
export interface PositionQuestion {
  id: string;
}

/** Where a person is in the current set. */
export interface DiscoveryPosition {
  /** The first question neither answered nor skipped; `null` when every one is behind them. */
  next: string | null;
  /** Skipped and still unanswered, in set order. Offered again at the end. */
  skipped: string[];
  /** Every question in the set is answered or skipped. */
  finished: boolean;
}

/**
 * The person's place in `questions`, the current set in order. Answers and
 * skips outside the set (a question the Core Set now leaves out, or one
 * removed) are ignored, not counted. A skipped question later answered is
 * answered.
 */
export function discoveryPosition(
  questions: readonly PositionQuestion[],
  answered: ReadonlySet<string>,
  skipped: ReadonlySet<string>
): DiscoveryPosition {
  const next = questions.find((q) => !answered.has(q.id) && !skipped.has(q.id))?.id ?? null;
  return {
    next,
    skipped: questions.filter((q) => skipped.has(q.id) && !answered.has(q.id)).map((q) => q.id),
    finished: next === null,
  };
}

/** The minimum of a set `asksIn` needs. */
export interface AskingSet {
  moduleSlug: string;
  questions: readonly unknown[];
}

/**
 * Whether `set` asks any questions in the area of the module `slug`. Lives
 * here rather than on the module page: the page sits in a route group the
 * framework boundary check reads as core, where the set's field names are
 * framework vocabulary. A workaround: daybreak#285 asks for a leaf seam in
 * that check, and on the sync that lands it this can go back inline.
 */
export function asksIn(set: AskingSet, slug: string): boolean {
  return set.moduleSlug === slug && set.questions.length > 0;
}
