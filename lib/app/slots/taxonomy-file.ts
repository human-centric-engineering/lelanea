/**
 * The shape of a slot-taxonomy FILE — the seed's input, and the admin export's
 * output (f-content-seeds t-89).
 *
 * Split out of `lib/app/content/seed-input/slot-taxonomy.ts`, which is where
 * this schema used to live beside the accessor that parses the bundled file.
 * That put `lelanea_slot_taxonomy.json` — 60KB of it — into every build that
 * reached `definitions-admin.ts`, which is six admin routes, because a module
 * importing a schema gets the file the schema's neighbour imported. The
 * accessor stayed in `seed-input/`; the schema is here, where the upload, the
 * preview, the apply and the export can all reach it without the file.
 *
 * **One schema for both ends of the round trip.** The seed parses the bundled
 * file with it and `exportTaxonomyFile` re-parses its own output with it, so an
 * export that could not be re-imported fails before it is offered rather than
 * when someone tries.
 *
 * The classifier values are checked against the framework's own vocabulary
 * rather than a second copy of it, so a value Daybreak stops recognising fails
 * here at parse rather than silently reaching `framework_slot_definition`.
 *
 * @see lib/app/content/seed-input/slot-taxonomy.ts — the bundled file, seed-only
 * @see lib/app/slots/definitions-admin.ts — the upload / export round trip
 * @see .context/app/slots.md
 */

import { z } from 'zod';

// The vocabulary module directly, NOT the `@/lib/framework/data-slots` barrel,
// for the reason `./validation.ts` records: the barrel re-exports the value
// engine, which imports `@/lib/db/client` and drags `pg` behind it. This module
// is now reached from the admin routes rather than only from a seed, so it has
// the same obligation its neighbour does.
import {
  SLOT_VISIBILITY,
  SLOT_MODE,
  SLOT_DATA_TYPE,
  SLOT_SENSITIVITY,
} from '@/lib/framework/data-slots/vocabulary';
import { slotSlugSchema } from '@/lib/app/slots/validation';

/**
 * A slug is lower-case, digits and underscores. Immutable once seeded — it is
 * what a captured `framework_slot_value.slotSlug` points at.
 *
 * Read from `lib/app/slots/validation.ts` rather than declared here (t-71): the
 * editor writes slugs into the same column a taxonomy file seeds, so one rule
 * has to govern both or a file the seed accepts and a slug the editor accepts
 * drift apart. (That module's own header records why it is not under
 * `lib/validations/`, which is where this pointer used to send you.)
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
    //
    // `.max()` because this schema is the only thing standing between the admin
    // upload routes and an unbounded `createMany` inside one transaction: there
    // is no platform-wide body-size ceiling (`lib/api/multipart-guard.ts` guards
    // `request.formData()` only), and the routes' docblocks wrongly claimed
    // there was. It belongs here rather than in a route so the preview, the
    // apply, the seed and the export's round-trip check all inherit the same
    // bound. 1000 against today's 53 is headroom, not a target.
    slots: z
      .array(slotSchema)
      .min(1)
      .max(1000, 'a taxonomy file may not declare more than 1000 slots'),
  })
  // Referential checks, the way the foundational-document loader checks its own
  // cross-references. Both run on the real file in
  // `tests/unit/lib/app/content/seed-input/slot-taxonomy.test.ts`.
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
