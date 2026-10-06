/**
 * What a person may send to their journey record (f-journey-record t-145,
 * t-147).
 *
 * An own entry is written and edited through the first two. A synopsis is
 * drafted by the synopsis seat (t-146) and changed only by keeping it, or by
 * asking for another draft (t-147).
 */

import { z } from 'zod';

import { cuidSchema } from '@/lib/validations/common';
import {
  JOURNEY_BODY_MAX,
  JOURNEY_SUMMARY_MAX,
  journeyNoteRefSchema,
  journeyOutcomesSchema,
  SYNOPSIS_STEER_MAX,
} from '@/lib/app/journey-record/entry';

/** An optional one-line summary: blank is none. */
const summarySchema = z
  .string()
  .trim()
  .max(JOURNEY_SUMMARY_MAX)
  .transform((summary) => (summary ? summary : null));

const bodySchema = z.string().trim().min(1, 'Write something to keep').max(JOURNEY_BODY_MAX);

export const ownEntryCreateSchema = z.object({
  summary: summarySchema.optional(),
  body: bodySchema,
  withheldFromAgent: z.boolean().optional(),
});
export type OwnEntryCreate = z.infer<typeof ownEntryCreateSchema>;

/** At least one field: an empty edit is a client bug, not a no-op to answer 200. */
export const ownEntryEditSchema = z
  .object({
    summary: summarySchema.optional(),
    body: bodySchema.optional(),
    withheldFromAgent: z.boolean().optional(),
  })
  .refine(
    (edit) =>
      edit.summary !== undefined || edit.body !== undefined || edit.withheldFromAgent !== undefined,
    { message: 'Nothing to change' }
  );
export type OwnEntryEdit = z.infer<typeof ownEntryEditSchema>;

export const journeyEntryIdSchema = cuidSchema;

/**
 * The account as the person keeps it, whole: a synopsis always has its line,
 * so a changed one does too.
 */
const synopsisTextSchema = z.object({
  summary: z.string().trim().min(1, 'Give it a line').max(JOURNEY_SUMMARY_MAX),
  body: bodySchema,
  outcomes: journeyOutcomesSchema,
});

/**
 * Keeping a synopsis (t-147): the listed notes still ticked, and the person's
 * changes, if any. `confirm` is required, so an empty list (nothing ticked)
 * is said rather than assumed.
 */
export const synopsisKeepSchema = z.object({
  confirm: z.array(journeyNoteRefSchema).max(200),
  edit: synopsisTextSchema.optional(),
});
export type SynopsisKeepInput = z.infer<typeof synopsisKeepSchema>;

/** Asking for another draft: optionally, what was wrong with this one. Blank is none. */
export const synopsisRegenerateSchema = z.object({
  steer: z
    .string()
    .trim()
    .max(SYNOPSIS_STEER_MAX)
    .transform((steer) => (steer ? steer : null))
    .optional(),
});
