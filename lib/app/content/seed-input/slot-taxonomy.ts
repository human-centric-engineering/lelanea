/**
 * The slot taxonomy as drafted: what the app aims to learn about a person
 * (f-slots t-70; product description §5).
 *
 * Seed input, and nothing else. Its callers are
 * `prisma/seeds/app-lelanea/011-slot-taxonomy.ts` and `013-agent-slot-tools.ts`,
 * `scripts/app/smoke-slot-capture.ts`, and tests. Nothing under `app/`,
 * `components/` or the rest of `lib/` may reach this module — until t-89
 * `lib/app/slots/definitions-admin.ts` did, for the file *schema*, which put
 * 60KB of JSON behind six admin routes. The schema is now
 * `lib/app/slots/taxonomy-file.ts` and the file stays here.
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
 * @see lib/app/slots/taxonomy-file.ts — the shape this file is parsed against
 * @see lib/app/slots/taxonomy-store.ts — the store this is loaded into
 * @see .context/app/slots.md
 */

import rawSlotTaxonomy from '@/seed-data/drafted/lelanea_slot_taxonomy.json';
import { deepFreezeParsed } from '@/lib/app/content/deep-freeze';
import { slotTaxonomyFileSchema, type SlotTaxonomyFile } from '@/lib/app/slots/taxonomy-file';

let parsed: SlotTaxonomyFile | null = null;

/** The whole file, validated and frozen. Throws if the file is malformed. */
export function getSlotTaxonomy(): SlotTaxonomyFile {
  parsed ??= deepFreezeParsed(slotTaxonomyFileSchema.parse(rawSlotTaxonomy));
  return parsed;
}

/**
 * The groups she may read back — every declared group none of whose slots is
 * hidden (f-slots t-72).
 *
 * This is the `read` half of her slot exposure allowlist
 * (seed 013's stored `customConfig`, shaped by {@link slotExposureConfig}),
 * and it is **derived from
 * the taxonomy rather than typed out** so that marking a slot hidden is the
 * whole act. Naming the five open groups by hand would mean a slot turned hidden
 * inside one of them kept being read back into her context — §12's "never a
 * grade" undone by a list nobody remembered to edit.
 *
 * **Group-level, because the allowlist is.** Daybreak's facet filters on
 * `group`, so a group is readable or it is not; there is no per-slot axis to
 * filter on. `tests/unit/lib/app/content/seed-input/slot-taxonomy.test.ts` asserts each
 * group is wholly open or wholly hidden, which is what makes that coarseness
 * lossless — and fails, loudly, on the first mixed group, rather than letting
 * this quietly withhold a group's open slots or expose its hidden one.
 *
 * Read from the BUNDLED file, which is what a fresh database is seeded from and
 * what the grant's stored config is written from — once, at seed, after which
 * the config is operator-owned like the grant itself.
 *
 * **Seed-time only.** Until t-88 this was invoked at module scope by
 * `lib/app/agent/pins.ts`, which made importing a constant of capability slugs
 * parse a 60KB taxonomy file. Its one production caller is now seed 013, where
 * reading seed material is what a seed is for; {@link slotExposureConfig}
 * wraps it in the shape the grant stores.
 */
export function readableSlotGroups(): string[] {
  const file = getSlotTaxonomy();
  const hidden = new Set(
    file.slots.filter((slot) => slot.visibility === 'hidden').map((slot) => slot.group)
  );
  return file.groups.map((group) => group.key).filter((key) => !hidden.has(key));
}

/**
 * The exposure allowlist as seed 013 stores it on both slot grants.
 *
 * Shaped here rather than at the call site so the seed, the smoke script and
 * their tests cannot drift into three spellings of the same config. See
 * `lib/app/agent/pins.ts` for why there is a `read` facet and deliberately no
 * `write` one.
 */
export function slotExposureConfig(): { read: { groups: string[] } } {
  return { read: { groups: readableSlotGroups() } };
}
