/**
 * A malformed taxonomy file fails, naming the fault (f-slots t-70)
 *
 * Every case here would otherwise produce a taxonomy that looks fine in the
 * file and is wrong in the database — a duplicate slug silently losing one of
 * two definitions, a group nothing declares rendering as an unlabelled section,
 * a classifier Daybreak does not recognise reaching `framework_slot_definition`
 * and from there the capture prompt.
 *
 * **One schema, both ends of the round trip**, which is why these cases matter
 * beyond the seed: the bundled file is parsed with it, and `exportTaxonomyFile`
 * re-parses its own output with it, so an export that could not be re-imported
 * fails before it is offered. The admin upload path is parsed with it too.
 *
 * These cases lived in `tests/unit/lib/app/content/slot-taxonomy.test.ts` until
 * t-89 moved the schema out of the module that imports the JSON. They moved
 * with it; what stayed there is what the bundled file itself says.
 *
 * @see lib/app/slots/taxonomy-file.ts
 * @see lib/app/slots/definitions-admin.ts — the upload / export round trip
 */

import { describe, it, expect } from 'vitest';

import { getSlotTaxonomy } from '@/lib/app/content/seed-input/slot-taxonomy';
import { slotTaxonomyFileSchema } from '@/lib/app/slots/taxonomy-file';

/**
 * A mutable deep clone of the real file, to break one field of per case.
 *
 * Cloned from the LOADER's output rather than from the raw JSON. A test IS
 * permitted a raw import (t-89 narrowed the boundary to `seed-input/`,
 * `prisma/seeds/` and `tests/`), but the parsed value round-trips through the
 * same schema, so each case below still starts from a file that parses — and
 * reading it the way the seed does keeps this honest about what the seed sees.
 */
function draft(): Record<string, unknown> {
  return structuredClone(getSlotTaxonomy()) as unknown as Record<string, unknown>;
}

/** The parse error's messages and paths, joined for a readable assertion. */
function failure(file: unknown): string {
  const result = slotTaxonomyFileSchema.safeParse(file);
  expect(result.success).toBe(false);
  if (result.success) throw new Error('unreachable');
  return result.error.issues
    .map((issue) => `${issue.path.join('.')}: ${issue.message}`)
    .join(' | ');
}

it('accepts the real file, so every rejection below is caused by the break', () => {
  // The counterfactual the negative cases rest on: if `draft()` produced
  // something the schema already refused, each case would pass for the wrong
  // reason and the specific message assertions would be the only thing left
  // holding them honest.
  expect(slotTaxonomyFileSchema.safeParse(draft()).success).toBe(true);
});

describe('a malformed taxonomy fails, naming the fault', () => {
  it('rejects a duplicate slug', () => {
    const file = draft();
    const slots = file.slots as Array<Record<string, unknown>>;
    slots.push({ ...slots[0] });
    expect(failure(file)).toContain('each slot slug may appear once');
  });

  it('rejects a slot naming a group nothing declares', () => {
    const file = draft();
    (file.slots as Array<Record<string, unknown>>)[0].group = 'not_a_group';
    expect(failure(file)).toContain('must name a group declared in `groups`');
  });

  it('rejects a declared group with no slots', () => {
    const file = draft();
    (file.groups as Array<Record<string, unknown>>).push({
      key: 'unused_group',
      title: 'Unused',
      description: 'Nothing points at this.',
    });
    expect(failure(file)).toContain('every declared group must have at least one slot');
  });

  it('rejects a duplicate group key', () => {
    const file = draft();
    const groups = file.groups as Array<Record<string, unknown>>;
    groups.push({ ...groups[0] });
    expect(failure(file)).toContain('each group key may appear once');
  });

  it('rejects a classifier the framework does not recognise', () => {
    const file = draft();
    (file.slots as Array<Record<string, unknown>>)[0].sensitivity = 'very_secret';
    expect(failure(file)).toContain('sensitivity');
  });

  it('rejects a slug that is not a slug', () => {
    const file = draft();
    (file.slots as Array<Record<string, unknown>>)[0].slug = 'Not A Slug';
    expect(failure(file)).toContain('lower-case letters, digits and underscores');
  });

  it('rejects an unknown key rather than dropping it', () => {
    // `strictObject`, like every other authored file: a field somebody added to
    // the JSON and nothing reads is a mistake, not something to ignore.
    const file = draft();
    (file.slots as Array<Record<string, unknown>>)[0].retired = true;
    expect(failure(file)).toContain('slots.0');
  });

  it('rejects an empty slot list', () => {
    const file = draft();
    file.slots = [];
    expect(failure(file)).toContain('slots');
  });
});
