/**
 * The slot taxonomy: what the app aims to learn about a person, as authored
 * content (f-slots t-70; product description §5).
 *
 * Validated once, frozen, reached only through here — the way the rest of
 * `content/` is. Its own module rather than a member of `./index` for the same
 * reason as `crisis-resources.ts`: the seed and the boot provider read this and
 * nothing else, and `./index` bundles six other files, the largest of them 60KB
 * of prose neither path wants.
 *
 * **It ships as a draft.** `provenance.status` is `draft` and the accessor
 * returns it, because every slug and every wording here is a content decision
 * the owner signs off. The schema admits nothing but `draft` and `signed_off`.
 *
 * **This file is the seed, not the source.** `prisma/seeds/app-lelanea/011-slot-taxonomy.ts`
 * copies it into `app_slot_definition` once; after that the tables are the
 * taxonomy and the editor (t-71) is how it changes. Unlike the crisis resource
 * there is no fallback to this file at read time — see the note on
 * `loadGlobalSlotDefinitions` in `lib/app/slots/taxonomy-store.ts` for why.
 *
 * The classifier values are checked against the framework's own vocabulary
 * rather than a second copy of it, so a value Daybreak stops recognising fails
 * here at parse rather than silently reaching `framework_slot_definition`.
 *
 * @see lib/app/slots/taxonomy-store.ts — the store this is loaded into
 * @see .context/app/slots.md
 */

import { z } from 'zod';

import rawSlotTaxonomy from '@/content/lelanea_slot_taxonomy.json';
import { deepFreezeParsed } from '@/lib/app/content/deep-freeze';
import {
  SLOT_VISIBILITY,
  SLOT_MODE,
  SLOT_DATA_TYPE,
  SLOT_SENSITIVITY,
} from '@/lib/framework/data-slots';
import { slotSlugSchema } from '@/lib/app/slots/validation';

/**
 * A slug is lower-case, digits and underscores. Immutable once seeded — it is
 * what a captured `framework_slot_value.slotSlug` points at.
 *
 * Read from `lib/validations/app-slot-definitions.ts` rather than declared here
 * (t-71): the editor writes slugs into the same column this file seeds, so one
 * rule has to govern both or a file the seed accepts and a slug the editor
 * accepts drift apart. It lives over there because a client component may
 * import the validation schemas, and importing them from *here* would pull this
 * module's 60KB of bundled JSON into the browser with them.
 */
const slugSchema = slotSlugSchema;

const slotSchema = z.strictObject({
  slug: slugSchema,
  /** Must be one of the keys declared in `groups` — checked below, across the file. */
  group: slugSchema,
  description: z.string().trim().min(1),
  visibility: z.enum(SLOT_VISIBILITY),
  mode: z.enum(SLOT_MODE),
  dataType: z.enum(SLOT_DATA_TYPE),
  sensitivity: z.enum(SLOT_SENSITIVITY),
  priorityWeight: z.number().int().min(0).max(100),
});

const groupSchema = z.strictObject({
  key: slugSchema,
  title: z.string().trim().min(1),
  description: z.string().trim().min(1),
});

export const slotTaxonomyFileSchema = z
  .strictObject({
    taxonomy: z.strictObject({
      id: z.literal('lelanea_slot_taxonomy'),
      title: z.string().min(1),
      version: z.string().regex(/^\d+\.\d+$/),
      locale: z.string().min(1),
      provenance: z.strictObject({
        status: z.enum(['draft', 'signed_off']),
        awaitingSignOffFrom: z.string().min(1),
        note: z.string().min(1),
      }),
      notes: z.array(z.string().min(1)),
    }),
    groups: z
      .array(groupSchema)
      .min(1)
      .refine((groups) => new Set(groups.map((g) => g.key)).size === groups.length, {
        message: 'each group key may appear once',
      }),
    // Deliberately `.min(1)`: an empty taxonomy is a mistake in this file, and
    // the seed's own "safe on empty" guarantee is about the DATABASE, not here.
    slots: z.array(slotSchema).min(1),
  })
  // Referential checks, the way the foundational-document loader checks its own
  // cross-references. Both run on the real file in
  // `tests/unit/lib/app/content/slot-taxonomy.test.ts`.
  .refine((file) => new Set(file.slots.map((s) => s.slug)).size === file.slots.length, {
    message: 'each slot slug may appear once',
    path: ['slots'],
  })
  .refine(
    (file) => {
      const declared = new Set(file.groups.map((g) => g.key));
      return file.slots.every((s) => declared.has(s.group));
    },
    {
      message: 'every slot must name a group declared in `groups`',
      path: ['slots'],
    }
  )
  .refine(
    (file) => {
      const used = new Set(file.slots.map((s) => s.group));
      return file.groups.every((g) => used.has(g.key));
    },
    {
      // A group with no slots would render as an empty section in the editor
      // and read as "nothing learned here" rather than "nothing declared here".
      message: 'every declared group must have at least one slot',
      path: ['groups'],
    }
  );

export type SlotTaxonomyFile = z.infer<typeof slotTaxonomyFileSchema>;
export type SlotTaxonomyEntry = SlotTaxonomyFile['slots'][number];

let parsed: SlotTaxonomyFile | null = null;

/** The whole file, validated and frozen. Throws if the file is malformed. */
export function getSlotTaxonomy(): SlotTaxonomyFile {
  parsed ??= deepFreezeParsed(slotTaxonomyFileSchema.parse(rawSlotTaxonomy));
  return parsed;
}
