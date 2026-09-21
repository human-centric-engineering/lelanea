/**
 * Slot-definition validation — what an admin may write into the taxonomy
 * (f-slots t-71).
 *
 * The taxonomy is the set of things the app is trying to learn about a person,
 * and it is edited rather than deployed. These schemas are what stands between
 * that editor and `app_slot_definition`.
 *
 * **No schema here admits `slug` on an edit.** A slug is the identity a captured
 * `framework_slot_value.slotSlug` points at, so renaming one would orphan every
 * answer already given under it; a rename is an add plus a retire (owner ruling,
 * 19 September 2026). The slug appears on {@link slotDefinitionCreateSchema} and
 * nowhere else, and on every other route it arrives in the path — where
 * `validatePathParam` reads it and no body can reach it.
 *
 * **Nor does any of them admit `mode`.** `.context/app/slots.md` names a
 * `mode: open` definition as an anti-pattern rather than a choice: a definition
 * row *is* the pre-declaration, and open-mode capture mints a slug with no
 * backing row. Every row is written `targeted`, which is what all 53 seeded
 * slots already are. {@link slotTaxonomyUploadSchema} is the one path where an
 * `open` row could arrive from outside, and it is refused there by name.
 *
 * The bounds are on typos, not policy — except `description`, which is the
 * wording the capture agent is given and so is allowed to be a paragraph.
 *
 * ## Why this is not in `lib/validations/`
 *
 * That is where the crisis-resources schemas live, and it was the first place
 * these went. It is the wrong tier: `lib/validations/**` is core / app-shell
 * code, and ESLint's `no-restricted-imports` refuses `@/lib/framework` from
 * there — the framework is built on core, not the reverse, and a build-time
 * import would break a Sunrise fork with no `lib/framework/` folder at all.
 * These schemas are built on Daybreak's slot vocabulary by construction
 * (validating against a second copy of it is how a value Daybreak stops
 * recognising reaches `framework_slot_definition`), so they belong beside the
 * store that uses them. The crisis schemas import no framework tier and so had
 * no such pull.
 *
 * @see lib/app/slots/definitions-admin.ts — what these schemas feed
 * @see .context/app/slots.md
 */

import { z } from 'zod';

// The vocabulary module directly, NOT the `@/lib/framework/data-slots` barrel.
// The barrel re-exports the value engine, which imports `@/lib/db/client` and
// so drags `pg` behind it — and this module is imported by a client component
// for its bounds, which puts the whole chain in the browser bundle. That fails
// as `Module not found: Can't resolve 'dns'` at the page, with a stack naming
// `pg` and nothing naming the import that caused it. `vocabulary.ts` imports
// nothing at all, which is what makes it safe to reach for from either side.
import {
  SLOT_VISIBILITY,
  SLOT_DATA_TYPE,
  SLOT_SENSITIVITY,
} from '@/lib/framework/data-slots/vocabulary';

/**
 * A slug is lower-case letters, digits and underscores, starting with a letter.
 *
 * **One rule, read from here by both ends.** `lib/app/content/slot-taxonomy.ts`
 * imports it to parse the bundled file, and the routes use it for the path
 * param and the create body, so a file the seed would accept and a slug the
 * editor would accept cannot drift apart. It lives in this module rather than
 * in the content one because a client component may import these schemas, and
 * the content module pulls the whole 53-slot JSON in behind it.
 *
 * Group keys are slugs too — same shape, same reason (they are written into a
 * column and read back as an identifier, never displayed raw).
 */
export const slotSlugSchema = z
  .string()
  .regex(/^[a-z][a-z0-9_]*$/, 'a slot slug is lower-case letters, digits and underscores');

/** Longest a slug may be. A column key, not prose. */
export const MAX_SLUG_LENGTH = 80;

/** Longest a description may be. It is the prompt text, so it is allowed to be a paragraph. */
export const MAX_DESCRIPTION_LENGTH = 1200;

const boundedSlug = (label: string) =>
  slotSlugSchema.max(MAX_SLUG_LENGTH, `${label} is longer than ${MAX_SLUG_LENGTH} characters.`);

/**
 * Everything about a definition an admin may change after it exists.
 *
 * `dataType` is in here deliberately. Changing it does not invalidate anything
 * already captured — `framework_slot_value.value` is always plain text and
 * `valueJson` is the optional typed form — and the revision chain is what
 * explains an old answer against the wording, type included, that stood when it
 * was given. A guard against retyping would be a guard against a state the
 * history already accounts for.
 *
 * `isActive` is NOT in here. Retirement has its own route so that a reword
 * cannot retire a slot by a stray field, and so the two produce different audit
 * actions.
 */
export const slotDefinitionUpdateSchema = z.strictObject({
  group: boundedSlug('A group key'),
  description: z
    .string()
    .trim()
    .min(1, 'A description cannot be empty — it is the wording the agent is given.')
    .max(
      MAX_DESCRIPTION_LENGTH,
      `A description is longer than ${MAX_DESCRIPTION_LENGTH} characters.`
    ),
  visibility: z.enum(SLOT_VISIBILITY),
  dataType: z.enum(SLOT_DATA_TYPE),
  sensitivity: z.enum(SLOT_SENSITIVITY),
  priorityWeight: z
    .number()
    .int('A priority weight is a whole number.')
    .min(0, 'A priority weight is between 0 and 100.')
    .max(100, 'A priority weight is between 0 and 100.'),
});

/** Adding a definition: the slug, then everything an edit may change. */
export const slotDefinitionCreateSchema = slotDefinitionUpdateSchema.extend({
  slug: boundedSlug('A slug'),
});

/** The version the admin read, sent with every write that changes a row. */
const versionRead = z.number().int().positive();

/**
 * A save names the version it was edited from. If another admin saved in
 * between, it is refused 409 rather than silently putting their wording back —
 * the lost update that would otherwise send the capture agent after the wrong
 * thing with nobody aware the edit had been undone.
 */
export const slotDefinitionSaveSchema = slotDefinitionUpdateSchema.extend({ version: versionRead });

/**
 * Retiring or restoring names the version it read, for the same reason. A
 * retirement is a field change like any other: it writes a revision and bumps
 * the version, and the row itself is never deleted.
 */
export const slotDefinitionActiveSchema = z.strictObject({
  version: versionRead,
  isActive: z.boolean(),
});

/**
 * How a taxonomy file is reconciled against what is stored.
 *
 * - `merge` — add what is missing, reword what differs, and leave a slug the
 *   file does not mention exactly as it is.
 * - `replace` — the same, and additionally retire the slugs the file omits.
 *
 * **Neither mode ever deletes, and neither retires anything the preview did not
 * name.** `replace` is the only one that retires at all, and the preview it is
 * applied from lists every retirement by slug.
 */
export const SLOT_UPLOAD_MODES = ['merge', 'replace'] as const;
export type SlotUploadMode = (typeof SLOT_UPLOAD_MODES)[number];

/**
 * An upload body. `file` is left `unknown` here and parsed by
 * `slotTaxonomyFileSchema` in the store, so the admin reads the same
 * referential errors the seed would ("every slot must name a group declared in
 * `groups`") rather than a second, weaker description of the same file format.
 */
export const slotTaxonomyUploadSchema = z.strictObject({
  mode: z.enum(SLOT_UPLOAD_MODES),
  file: z.unknown(),
});

/**
 * Longest a member's correction may be. A note is a sentence or two she wrote;
 * this is generous against that without being a door for a paste of a book.
 */
export const MAX_NOTE_LENGTH = 2000;

/**
 * A member correcting one of her notes (t-73).
 *
 * Not a definition schema, and it is here for the reason the header gives: the
 * panel is a client component and imports these bounds, so the schema cannot
 * live beside the Prisma-backed store it feeds.
 *
 * `slotSlug` is in the **body** rather than the path, unlike every admin route
 * above. A slug is the identity of a question, not of a resource the member
 * owns — there is no `/notes/<slug>` to `PUT`, because a member cannot create
 * one and cannot address one that has no answer. The route refuses any slug
 * with no head of the caller's own, which is what stops the body being a
 * write-anything door.
 */
export const slotCorrectionSchema = z.strictObject({
  slotSlug: boundedSlug('A slot slug'),
  value: z
    .string()
    .trim()
    .min(1, 'A correction cannot be empty.')
    .max(MAX_NOTE_LENGTH, `A correction is longer than ${MAX_NOTE_LENGTH} characters.`),
});

export type SlotCorrection = z.infer<typeof slotCorrectionSchema>;

export type SlotDefinitionUpdate = z.infer<typeof slotDefinitionUpdateSchema>;
export type SlotDefinitionCreate = z.infer<typeof slotDefinitionCreateSchema>;
