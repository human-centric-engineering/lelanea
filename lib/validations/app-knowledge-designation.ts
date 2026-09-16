/**
 * Designation validation — what an admin may say about one of her documents.
 *
 * Three answers, each independently optional on the wire so the admin surface
 * can save one without restating the other two: a document can be marked
 * `voice` today and licensed next week. `null` is a meaningful value here and is
 * NOT the same as omitting the key — it CLEARS the answer, which is how a
 * mis-designation is undone. `undefined` (omitted) leaves it alone.
 *
 * That distinction is the whole reason `.nullish()` appears below rather than
 * `.optional()`: a body of `{ purpose: null }` must reach the service as an
 * instruction to remove the purpose tag, and a body of `{}` must reach it as an
 * instruction to change nothing.
 *
 * The purpose and sensitivity enums are built from
 * `lib/app/voice/designation.ts` rather than restated, so a value added to the
 * vocabulary is accepted by the route without a second edit — and, more to the
 * point, so a value REMOVED from the vocabulary stops being accepted rather than
 * being written as a tag slug nothing seeds.
 *
 * @see lib/app/voice/designation-admin.ts — what these schemas feed
 * @see app/api/v1/admin/app/knowledge/designations/[documentId]/route.ts
 */

import { z } from 'zod';
import { DOCUMENT_PURPOSES, DOCUMENT_SENSITIVITIES } from '@/lib/app/voice/designation';

/** How many documents the designation list shows per page. */
export const DESIGNATION_ADMIN_PAGE_SIZE = 25;

/** Longest licensing note we will store. Long enough for a permission email's gist. */
const LICENSING_MAX = 2000;

/**
 * The licensing note: trimmed, capped, and `null` when blank.
 *
 * A textarea submits `''` when cleared, and an empty string in a nullable column
 * reads in a query exactly like an answer nobody gave — so blank normalises to
 * `null`, which is what "nobody has said yet" is stored as.
 */
const licensingSchema = z
  .string()
  .trim()
  .max(LICENSING_MAX, `Keep the licensing note under ${LICENSING_MAX} characters.`)
  .transform((value) => (value.length === 0 ? null : value))
  .nullable();

export const designationUpdateSchema = z
  .object({
    purpose: z.enum(DOCUMENT_PURPOSES).nullish(),
    sensitivity: z.enum(DOCUMENT_SENSITIVITIES).nullish(),
    licensing: licensingSchema.optional(),
  })
  .refine(
    (body) =>
      body.purpose !== undefined || body.sensitivity !== undefined || body.licensing !== undefined,
    { message: 'Say at least one of purpose, sensitivity or licensing.' }
  );

export type DesignationUpdate = z.infer<typeof designationUpdateSchema>;

/**
 * The admin list's query.
 *
 * `undesignated` is the filter the surface actually gets used through: the whole
 * risk this feature exists to remove is a document nobody has designated sitting
 * in the knowledge base looking like knowledge, so "show me the ones I have not
 * answered for" needs to be one click rather than a scan.
 */
export const designationAdminQuerySchema = z.object({
  q: z.string().trim().min(1).max(200).optional(),
  purpose: z.enum(DOCUMENT_PURPOSES).optional(),
  undesignatedOnly: z
    .enum(['true', 'false'])
    .default('false')
    .transform((value) => value === 'true'),
  page: z.coerce.number().int().positive().default(1),
  limit: z.coerce.number().int().positive().max(100).default(DESIGNATION_ADMIN_PAGE_SIZE),
});

export type DesignationAdminQuery = z.infer<typeof designationAdminQuerySchema>;
