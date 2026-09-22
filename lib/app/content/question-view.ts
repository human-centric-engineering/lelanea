/**
 * How the stored discovery questions are served (f-content-seeds t-87).
 *
 * The served shape and the one projection from rows to it. Pure, with no
 * database import, so the store, the seed's tests and the fake store all build
 * the set the same way.
 *
 * **Validated on the way out.** `preamble`, `pacing` and `conditionalFollowUp`
 * are JSON, `inputType` is free text in the column, and the numbering must run
 * 1…n. A row that fails throws rather than rendering.
 *
 * @see lib/app/content/question-store.ts — the reads and writes
 */

import { z } from 'zod';
import { discoveryQuestionSchema } from '@/lib/app/content/schemas';
import type { ContentCollectionMeta } from '@/lib/app/content/document-view';

// ============================================================================
// Served shape
// ============================================================================

/** One discovery question, as served. `hint` and `conditionalFollowUp` are omitted where absent. */
export interface DiscoveryQuestionView {
  id: string;
  number: number;
  text: string;
  inputType: 'long_text';
  hint?: string;
  conditionalFollowUp?: { ifYes: string; ifNo: string };
  /** Counts every write to the question. */
  revision: number;
}

/** The onboarding module's thirty discovery questions, with pacing guidance. */
export interface DiscoveryQuestionSet {
  collection: ContentCollectionMeta & {
    chartTitle: string;
    /** The module id the set belongs to. */
    module: string;
    phase: number;
    /** Counts every write to the set's framing. */
    revision: number;
  };
  preamble: { style: string; text: string };
  pacing: { rushDiscouraged: boolean; allowPartialCompletion: boolean; note: string };
  questions: readonly DiscoveryQuestionView[];
}

// ============================================================================
// Stored JSON
// ============================================================================

export const storedPreambleSchema = z.strictObject({
  style: z.string().min(1),
  text: z.string().min(1),
});

export const storedPacingSchema = z.strictObject({
  rushDiscouraged: z.boolean(),
  allowPartialCompletion: z.boolean(),
  note: z.string().min(1),
});

const inputTypeSchema = discoveryQuestionSchema.shape.inputType;

export const storedFollowUpSchema = z
  .strictObject({ ifYes: z.string().min(1), ifNo: z.string().min(1) })
  .nullable();

// ============================================================================
// Rows
// ============================================================================

export interface QuestionSetRow {
  id: string;
  title: string;
  chartTitle: string;
  moduleId: string;
  phase: number;
  preamble: unknown;
  pacing: unknown;
  version: string;
  locale: string;
  revision: number;
}

export interface DiscoveryQuestionRow {
  id: string;
  number: number;
  text: string;
  inputType: string;
  hint: string | null;
  conditionalFollowUp: unknown;
  revision: number;
}

// ============================================================================
// Projection
// ============================================================================

/** One stored question as served. @throws when it fails validation. */
export function toQuestionView(row: DiscoveryQuestionRow): DiscoveryQuestionView {
  const inputType = inputTypeSchema.safeParse(row.inputType);
  const followUp = storedFollowUpSchema.safeParse(row.conditionalFollowUp ?? null);
  if (!inputType.success || !followUp.success) {
    throw new Error(`Discovery question "${row.id}" failed validation on read`);
  }
  return {
    id: row.id,
    number: row.number,
    text: row.text,
    inputType: inputType.data,
    ...(row.hint !== null && { hint: row.hint }),
    ...(followUp.data !== null && { conditionalFollowUp: followUp.data }),
    revision: row.revision,
  };
}

/**
 * The set as served, its questions in number order.
 *
 * @throws when the set's JSON fails validation, or the numbers do not run 1…n
 * (a gap would read as a missing question, a repeat as one asked twice).
 */
export function toQuestionSet(
  set: QuestionSetRow,
  questionRows: readonly DiscoveryQuestionRow[]
): DiscoveryQuestionSet {
  const preamble = storedPreambleSchema.safeParse(set.preamble);
  const pacing = storedPacingSchema.safeParse(set.pacing);
  if (!preamble.success || !pacing.success) {
    throw new Error(`Question set "${set.id}" failed validation on read`);
  }
  const questions = [...questionRows].sort((a, b) => a.number - b.number).map(toQuestionView);
  questions.forEach((question, index) => {
    if (question.number !== index + 1) {
      throw new Error(
        `Question set "${set.id}": question ${question.id} is numbered ${question.number} ` +
          `but sits at position ${index + 1}`
      );
    }
  });

  return {
    collection: {
      id: set.id,
      title: set.title,
      chartTitle: set.chartTitle,
      module: set.moduleId,
      phase: set.phase,
      version: set.version,
      locale: set.locale,
      revision: set.revision,
    },
    preamble: preamble.data,
    pacing: pacing.data,
    questions,
  };
}
