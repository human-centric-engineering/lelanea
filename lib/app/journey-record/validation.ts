/**
 * What a person may send to their journey record (f-journey-record t-145).
 *
 * Only an own entry is written through these. A synopsis is drafted by the
 * synopsis seat (t-146) and changed only by keeping it (t-147).
 */

import { z } from 'zod';

import { cuidSchema } from '@/lib/validations/common';
import { JOURNEY_BODY_MAX, JOURNEY_SUMMARY_MAX } from '@/lib/app/journey-record/entry';

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
