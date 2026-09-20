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
