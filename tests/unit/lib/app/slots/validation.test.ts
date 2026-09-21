/**
 * What an admin may write into the taxonomy (f-slots t-71).
 *
 * Two jobs. Most of this is the schemas: what they accept, and — more
 * usefully — the four things they refuse that a caller might expect them to
 * tolerate.
 *
 * The last case is different in kind. It reads this module's own source to
 * assert it does not import the framework's **barrel**, and it exists because
 * nothing else in the suite can catch that: see its own comment.
 *
 * @see lib/app/slots/validation.ts
 */

import { readFileSync } from 'node:fs';
import { join } from 'node:path';

import { describe, it, expect } from 'vitest';

import {
  MAX_DESCRIPTION_LENGTH,
  MAX_MINTED_SLUG_LENGTH,
  slotCorrectionSchema,
  slotDefinitionActiveSchema,
  slotDefinitionCreateSchema,
  slotDefinitionSaveSchema,
  slotSlugSchema,
  slotTaxonomyUploadSchema,
} from '@/lib/app/slots/validation';

const AUTHORED = {
  group: 'life_areas',
  description: 'How their working life stands right now.',
  visibility: 'open',
  dataType: 'text',
  sensitivity: 'sensitive',
  priorityWeight: 70,
};

describe('a slug', () => {
  it.each(['life_work', 'a', 'life_work_2'])('accepts %s', (slug) => {
    expect(slotSlugSchema.safeParse(slug).success).toBe(true);
  });

  it.each([
    ['an upper-case letter', 'Life_work'],
    ['a leading digit', '1_life'],
    ['a space', 'life work'],
    ['a hyphen', 'life-work'],
    ['nothing at all', ''],
  ])('refuses %s', (_label, slug) => {
    expect(slotSlugSchema.safeParse(slug).success).toBe(false);
  });
});

describe('the write schemas', () => {
  it('takes a whole definition on a create', () => {
    expect(slotDefinitionCreateSchema.safeParse({ slug: 'life_work', ...AUTHORED }).success).toBe(
      true
    );
  });

  it.each([
    ['a slug, which is not editable', { ...AUTHORED, version: 1, slug: 'renamed' }],
    [
      'an isActive, which belongs to the retire route',
      { ...AUTHORED, version: 1, isActive: false },
    ],
    ['a mode, which is never an admin’s to choose', { ...AUTHORED, version: 1, mode: 'targeted' }],
    ['no version at all', { ...AUTHORED }],
  ])('refuses a save carrying %s', (_label, payload) => {
    // Refused rather than stripped: each of these means the caller believed
    // something about this route that is not true, and silently dropping the
    // field would leave them believing it.
    expect(slotDefinitionSaveSchema.safeParse(payload).success).toBe(false);
  });

  it.each([
    ['a version of zero', { version: 0, isActive: true }],
    ['a version that is not whole', { version: 1.5, isActive: true }],
    ['an isActive that is not a boolean', { version: 1, isActive: 'yes' }],
  ])('refuses a retirement with %s', (_label, payload) => {
    expect(slotDefinitionActiveSchema.safeParse(payload).success).toBe(false);
  });

  it('bounds the description but allows a paragraph', () => {
    const long = 'x'.repeat(MAX_DESCRIPTION_LENGTH);
    expect(
      slotDefinitionSaveSchema.safeParse({ ...AUTHORED, description: long, version: 1 }).success
    ).toBe(true);
    expect(
      slotDefinitionSaveSchema.safeParse({ ...AUTHORED, description: long + 'x', version: 1 })
        .success
    ).toBe(false);
  });

  it('refuses a description that is only whitespace', () => {
    expect(
      slotDefinitionSaveSchema.safeParse({ ...AUTHORED, description: '   ', version: 1 }).success
    ).toBe(false);
  });

  it.each([
    ['below zero', -1],
    ['past one hundred', 101],
    ['not whole', 50.5],
  ])('refuses a priority weight %s', (_label, priorityWeight) => {
    expect(
      slotDefinitionSaveSchema.safeParse({ ...AUTHORED, priorityWeight, version: 1 }).success
    ).toBe(false);
  });
});

describe('the upload body', () => {
  it.each(['merge', 'replace'])('accepts mode %s', (mode) => {
    expect(slotTaxonomyUploadSchema.safeParse({ mode, file: {} }).success).toBe(true);
  });

  it.each([
    ['a mode that retires nothing it did not name', { mode: 'wipe', file: {} }],
    ['an extra key', { mode: 'merge', file: {}, force: true }],
  ])('refuses %s', (_label, payload) => {
    expect(slotTaxonomyUploadSchema.safeParse(payload).success).toBe(false);
  });

  it('leaves the file itself to the store, which parses it with the seed’s own schema', () => {
    // `file: unknown` here on purpose: describing the format twice is how the
    // admin ends up reading a weaker error than the seed would have given.
    expect(slotTaxonomyUploadSchema.safeParse({ mode: 'merge', file: 'nonsense' }).success).toBe(
      true
    );
  });
});

describe('client safety', () => {
  it('does not import the framework barrel, which would drag pg into the browser', () => {
    // A source-level assertion, which is unusual here and is the point.
    //
    // This module is imported by `components/app/admin/slot-definitions.tsx`
    // for its bounds. The `@/lib/framework/data-slots` BARREL re-exports the
    // value engine, which imports `@/lib/db/client`, which imports `pg` — so
    // importing the barrel here puts `pg` in the client bundle and the page
    // dies with `Module not found: Can't resolve 'dns'`, a stack naming `pg`,
    // and nothing naming the import that did it.
    //
    // Nothing else in the suite can see this. Vitest runs in Node, where `pg`
    // resolves fine, so every unit test — including the component's — passes
    // against a page that 500s in a browser. This was not hypothetical: it is
    // what the first version of this module did, and only opening the page
    // found it.
    //
    // `vocabulary.ts` imports nothing at all, which is why it is safe from
    // either side.
    const source = readFileSync(join(process.cwd(), 'lib/app/slots/validation.ts'), 'utf8');

    expect(source).not.toMatch(/from '@\/lib\/framework\/data-slots'/);
    expect(source).toMatch(/from '@\/lib\/framework\/data-slots\/vocabulary'/);
  });
});

/**
 * A correction names a slug a NOTE sits under, which is not the same set as the
 * slugs an admin may write into the taxonomy (t-73, /security-review).
 */
describe('slotCorrectionSchema', () => {
  it('accepts exactly the slugs the write path accepts, pinned to fill_slot itself', async () => {
    // Read from the capability's advertised definition rather than restated:
    // the schema it validates with is protected, and a second copy of "120"
    // here is the drift this test exists to catch. If Daybreak widens or
    // narrows its bound, this fails and says which way.
    const { FillSlotCapability } =
      await import('@/lib/framework/data-slots/capabilities/fill-slot');
    const advertised = new FillSlotCapability().functionDefinition.parameters as {
      properties: { slotSlug: { maxLength: number } };
    };
    expect(MAX_MINTED_SLUG_LENGTH).toBe(advertised.properties.slotSlug.maxLength);
  });

  it('accepts a slug Lelañea coined that the taxonomy rule would refuse', () => {
    // Capitals and a hyphen: legal for `fill_slot`, illegal for an admin. A
    // note under one of these offered "That's not right" and then refused every
    // save until this schema stopped borrowing the taxonomy's rule.
    expect(slotCorrectionSchema.safeParse({ slotSlug: 'Weekly-Rhythm', value: 'x' }).success).toBe(
      true
    );
    expect(slotSlugSchema.safeParse('Weekly-Rhythm').success).toBe(false);
  });

  it('holds the bound at both ends', () => {
    const at = 'a'.repeat(MAX_MINTED_SLUG_LENGTH);
    expect(slotCorrectionSchema.safeParse({ slotSlug: at, value: 'x' }).success).toBe(true);
    expect(slotCorrectionSchema.safeParse({ slotSlug: `${at}a`, value: 'x' }).success).toBe(false);
    expect(slotCorrectionSchema.safeParse({ slotSlug: '', value: 'x' }).success).toBe(false);
  });

  it('still refuses a body that names anything else', () => {
    // Strict: a `userId` is a 400 rather than a field quietly dropped.
    expect(
      slotCorrectionSchema.safeParse({ slotSlug: 'life_work', value: 'x', userId: 'someone' })
        .success
    ).toBe(false);
  });
});
