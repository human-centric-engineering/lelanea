/**
 * What an admin may write into her content (f-content-seeds t-91).
 *
 * Each edit schema is built from the schema the store already validates the
 * row with on every read (`storedDocumentBlocksSchema`, `storedPhasesSchema`,
 * `filmSchema` …), so the editor cannot save something the read path would then
 * refuse, and the admin reads the same message the seed would give.
 *
 * **No schema here admits an id.** A document id is its API path and the key
 * the gate maps an acknowledgement kind to; a module or tier id is the roster's;
 * a question id is how an answer will be filed; a resource id is what a past
 * suggestion in a conversation names. Ids arrive in the path, where
 * `validatePathParam` reads them, and appear in a body only when creating.
 *
 * Every save carries the lock it read: `revision` for a row with a history,
 * `updatedAt` for the three collection rows without one. See `shared.ts`.
 *
 * Client-safe: no database, no server imports. The editor's components import
 * these for their bounds.
 */

import { z } from 'zod';

import { storedDocumentBlocksSchema } from '@/lib/app/content/schemas';
import {
  storedPhasesSchema,
  storedPhaseTiersSchema,
  storedProducesSchema,
} from '@/lib/app/content/journey-view';
import {
  storedFollowUpSchema,
  storedPacingSchema,
  storedPreambleSchema,
} from '@/lib/app/content/question-view';
import {
  filmSchema,
  provenanceSchema,
  readingSchema,
  relatesToSchema,
  resourceIdSchema,
  resourceKeySchema,
  wordsSchema,
} from '@/lib/app/content/resources';

// ─── Shared bounds ──────────────────────────────────────────────────────────

/** A title, a label, a heading: one line. */
const line = (label: string, max = 300) =>
  z
    .string()
    .trim()
    .min(1, `${label} cannot be empty.`)
    .max(max, `${label} is longer than ${max} characters.`);

/** An optional line: empty means "none", and is stored as null. */
const optionalLine = (label: string, max = 500) =>
  z
    .string()
    .trim()
    .max(max, `${label} is longer than ${max} characters.`)
    .nullable()
    .transform((value) => (value === null || value === '' ? null : value));

/** A prose passage she wrote. Long enough for a paragraph of hers, not a book. */
const prose = (label: string) => line(label, 5000);

const revision = z.number().int().positive();
const updatedAt = z.iso.datetime();

/** Restoring an earlier revision: which one, and the revision the admin read. */
export const restoreSchema = z.strictObject({
  revision: z.number().int().positive(),
  revisionRead: revision,
});

/** A new order: every item once, each with the revision the admin read. */
export const reorderSchema = z.strictObject({
  order: z
    .array(z.strictObject({ id: z.string().min(1).max(80), revision }))
    .min(1)
    .max(500),
});

// ─── Documents ──────────────────────────────────────────────────────────────

/** A version label: short, and no whitespace, because it is compared exactly. */
const versionLabel = z
  .string()
  .trim()
  .min(1, 'A version cannot be empty.')
  .max(40, 'A version is longer than 40 characters.')
  .regex(/^\S+$/, 'A version has no spaces.');

/**
 * One document's editable fields. `requiresAcknowledgement` is not here: which
 * documents gate is code (`DOCUMENT_FOR_KIND`). Nor is `position`, which is a
 * reorder, or `locale`, which is the collection's.
 */
export const documentEditSchema = z.strictObject({
  title: line('A title'),
  subtitle: optionalLine('A subtitle'),
  category: z.enum(['onboarding', 'about', 'legal']),
  surface: line('A surface', 80),
  placeholders: z.array(line('A placeholder', 80)).max(20),
  renderStyle: optionalLine('A render style', 40),
  renderNote: optionalLine('A render note', 1000),
  blocks: storedDocumentBlocksSchema,
  version: versionLabel,
});
export const documentSaveSchema = documentEditSchema.extend({ revision });

export const documentCollectionEditSchema = z.strictObject({
  title: line('A title'),
  version: versionLabel,
  locale: line('A locale', 35),
});
export const documentCollectionSaveSchema = documentCollectionEditSchema.extend({ updatedAt });

// ─── Journey ────────────────────────────────────────────────────────────────

export const journeyEditSchema = z.strictObject({
  title: line('A title'),
  subtitle: line('A subtitle', 500),
  version: versionLabel,
  locale: line('A locale', 35),
});
export const journeySaveSchema = journeyEditSchema.extend({ updatedAt });

/** A tier's text. Both are required: the drawer shows both, and the file needs both. */
export const tierEditSchema = z.strictObject({
  label: line('A label'),
  intent: prose('An intent'),
});
export const tierSaveSchema = tierEditSchema.extend({ revision });

/** A module's text. Its number and tier are the roster's and are not here. */
export const moduleEditSchema = z.strictObject({
  displayNumber: line('A display number', 20),
  title: line('A title'),
  subtitle: optionalLine('A subtitle'),
  chartTitle: optionalLine('A chart title', 300),
  phases: storedPhasesSchema,
  phaseTiers: storedPhaseTiersSchema,
  produces: storedProducesSchema,
});
export const moduleSaveSchema = moduleEditSchema.extend({ revision });

// ─── Discovery questions ────────────────────────────────────────────────────

export const questionSetEditSchema = z.strictObject({
  title: line('A title'),
  chartTitle: line('A chart title'),
  moduleId: z.string().regex(/^module_\d{2}_[a-z0-9_]+$/, 'A module id is module_NN_words.'),
  phase: z.number().int().positive(),
  preamble: storedPreambleSchema,
  pacing: storedPacingSchema,
  version: versionLabel,
  locale: line('A locale', 35),
});
export const questionSetSaveSchema = questionSetEditSchema.extend({ revision });

/** One question. `inputType` has one value today, and is kept so the row says it. */
export const questionEditSchema = z.strictObject({
  text: prose('A question'),
  inputType: z.literal('long_text'),
  hint: optionalLine('A hint', 2000),
  conditionalFollowUp: storedFollowUpSchema,
});
export const questionSaveSchema = questionEditSchema.extend({ revision });

/** A new question goes at the end, with the next free id. */
export const questionCreateSchema = questionEditSchema;

// ─── Resources ──────────────────────────────────────────────────────────────

export const resourceCollectionEditSchema = z.strictObject({
  title: line('A title'),
  version: z.string().regex(/^\d+\.\d+$/, 'The library version is major.minor, e.g. "1.0".'),
  locale: line('A locale', 35),
  provenance: provenanceSchema,
});
export const resourceCollectionSaveSchema = resourceCollectionEditSchema.extend({ updatedAt });

const [readingByDocument, readingByLink] = readingSchema.options;

/**
 * One resource's fields, by kind. The kind itself is fixed once created: a
 * film and a reading are offered in different places, and turning one into the
 * other is a new resource.
 */
export const resourceEditSchema = z.union([
  filmSchema.omit({ id: true }).extend({ kind: z.literal('film') }),
  readingByDocument.omit({ id: true }).extend({ kind: z.literal('reading') }),
  readingByLink.omit({ id: true }).extend({ kind: z.literal('reading') }),
]);
export const resourceSaveSchema = z.intersection(resourceEditSchema, z.object({ revision }));
export const resourceCreateSchema = z.intersection(
  resourceEditSchema,
  z.object({ id: resourceIdSchema })
);

/** Retiring or restoring a resource, against the revision read. */
export const resourceRetireSchema = z.strictObject({ retired: z.boolean(), revision });

export const wordsEditSchema = wordsSchema;
export const wordsSaveSchema = wordsSchema.extend({ revision });
export const wordsCreateSchema = wordsSchema.extend({ key: resourceKeySchema });

export { relatesToSchema };

// ─── Types ──────────────────────────────────────────────────────────────────

export type DocumentEdit = z.infer<typeof documentEditSchema>;
export type DocumentCollectionEdit = z.infer<typeof documentCollectionEditSchema>;
export type JourneyEdit = z.infer<typeof journeyEditSchema>;
export type TierEdit = z.infer<typeof tierEditSchema>;
export type ModuleEdit = z.infer<typeof moduleEditSchema>;
export type QuestionSetEdit = z.infer<typeof questionSetEditSchema>;
export type QuestionEdit = z.infer<typeof questionEditSchema>;
export type ResourceCollectionEdit = z.infer<typeof resourceCollectionEditSchema>;
export type ResourceEdit = z.infer<typeof resourceEditSchema>;
export type WordsEdit = z.infer<typeof wordsEditSchema>;
