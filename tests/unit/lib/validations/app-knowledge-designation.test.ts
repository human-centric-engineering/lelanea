/**
 * The wire contract — where `null` and "omitted" have to stay different things.
 *
 * This is the schema the PATCH route hands its body to, and every safety property
 * downstream rests on one distinction it makes: `{ purpose: null }` means CLEAR
 * the answer, `{}` means change nothing. Zod collapses the two under `.optional()`
 * and keeps them apart under `.nullish()`, and nothing else in the suite would
 * notice the difference — a schema that silently dropped `null` would turn "undo
 * this mis-designation" into "no-op", leaving a document quotable that an admin
 * believed they had just taken off the tool path.
 *
 * `/pre-pr`'s `check:missing-tests` named this file as an outright gap on §07
 * t-25, which it was.
 *
 * @see lib/validations/app-knowledge-designation.ts
 * @see lib/app/voice/designation-admin.ts — `undefined` leaves alone, `null` clears
 */

import { describe, it, expect } from 'vitest';

import {
  designationUpdateSchema,
  designationAdminQuerySchema,
  DESIGNATION_ADMIN_PAGE_SIZE,
  LICENSING_MAX,
} from '@/lib/validations/app-knowledge-designation';
import { DOCUMENT_PURPOSES, DOCUMENT_SENSITIVITIES } from '@/lib/app/voice/designation';

describe('designationUpdateSchema', () => {
  it('keeps null apart from omitted, which is the whole point of the schema', () => {
    const cleared = designationUpdateSchema.parse({ purpose: null });
    const untouched = designationUpdateSchema.parse({ sensitivity: 'client' });

    // `null` SURVIVES as null — the instruction to remove the purpose tag.
    expect(cleared.purpose).toBeNull();
    expect('purpose' in cleared).toBe(true);

    // And an unmentioned field is `undefined`, not null: `setDesignation` reads
    // `!== undefined` to decide whether to touch the family at all, so a schema
    // that defaulted this to null would clear a tag nobody mentioned.
    expect(untouched.purpose).toBeUndefined();
  });

  it('accepts every value in the vocabulary, and nothing outside it', () => {
    // Built from the vocabulary rather than restated, so a value REMOVED from
    // `designation.ts` stops being accepted rather than being written as a tag
    // slug nothing seeds.
    for (const purpose of DOCUMENT_PURPOSES) {
      expect(designationUpdateSchema.parse({ purpose }).purpose).toBe(purpose);
    }
    for (const sensitivity of DOCUMENT_SENSITIVITIES) {
      expect(designationUpdateSchema.parse({ sensitivity }).sensitivity).toBe(sensitivity);
    }

    expect(designationUpdateSchema.safeParse({ purpose: 'knowledge-ish' }).success).toBe(false);
    expect(designationUpdateSchema.safeParse({ sensitivity: 'secret' }).success).toBe(false);
  });

  it('rejects a body that says nothing at all', () => {
    // A PATCH with no answer in it is a write that would log an audit entry and
    // evict the resolver cache for nothing.
    const result = designationUpdateSchema.safeParse({});

    expect(result.success).toBe(false);
    expect(result.error?.issues[0]?.message).toMatch(/at least one/i);
  });

  describe('the licensing note', () => {
    it('normalises a blank note to null rather than storing an empty string', () => {
      // A textarea submits `''` when cleared, and an empty string in a nullable
      // column reads in a query exactly like an answer nobody gave.
      expect(designationUpdateSchema.parse({ licensing: '' }).licensing).toBeNull();
      expect(designationUpdateSchema.parse({ licensing: '   ' }).licensing).toBeNull();
    });

    it('trims, and keeps a real note intact', () => {
      expect(designationUpdateSchema.parse({ licensing: '  Hers, CC BY.  ' }).licensing).toBe(
        'Hers, CC BY.'
      );
    });

    it('accepts a note at the cap and refuses one past it, naming the number', () => {
      // The cap the `<Textarea maxLength>` mirrors. If these two ever disagree the
      // admin surface discovers the limit by having a long paste rejected.
      expect(
        designationUpdateSchema.safeParse({ licensing: 'x'.repeat(LICENSING_MAX) }).success
      ).toBe(true);

      const over = designationUpdateSchema.safeParse({ licensing: 'x'.repeat(LICENSING_MAX + 1) });
      expect(over.success).toBe(false);
      expect(over.error?.issues[0]?.message).toContain(String(LICENSING_MAX));
    });

    it('accepts an explicit null — removing the note is an answer', () => {
      const parsed = designationUpdateSchema.parse({ licensing: null });
      expect(parsed.licensing).toBeNull();
    });
  });
});

describe('designationAdminQuerySchema', () => {
  it('defaults to the first page of her documents with no filter', () => {
    const parsed = designationAdminQuerySchema.parse({});

    expect(parsed).toMatchObject({
      page: 1,
      limit: DESIGNATION_ADMIN_PAGE_SIZE,
      undesignatedOnly: false,
    });
    expect(parsed.q).toBeUndefined();
  });

  it('reads undesignatedOnly as a boolean, and only from the two strings', () => {
    expect(designationAdminQuerySchema.parse({ undesignatedOnly: 'true' }).undesignatedOnly).toBe(
      true
    );
    expect(designationAdminQuerySchema.parse({ undesignatedOnly: 'false' }).undesignatedOnly).toBe(
      false
    );
    // Not "anything truthy": `?undesignatedOnly=1` silently meaning `false` would
    // show every document under a filter the operator believes is on.
    expect(designationAdminQuerySchema.safeParse({ undesignatedOnly: '1' }).success).toBe(false);
  });

  it('rejects purpose and undesignatedOnly together instead of dropping one', () => {
    // They contradict each other — a document with a purpose is designated. The
    // service ANDs them (so a direct caller gets an empty set, which is true),
    // and the wire says so in a sentence rather than returning purpose matches
    // under a filter that asked for the opposite.
    const result = designationAdminQuerySchema.safeParse({
      purpose: 'knowledge',
      undesignatedOnly: 'true',
    });

    expect(result.success).toBe(false);
    expect(result.error?.issues[0]?.message).toMatch(/contradict/i);
  });

  it('refuses a blank search term rather than matching everything', () => {
    // `.trim().min(1)` — the admin table trims before deciding to send `q` at all,
    // and this is the half that makes that necessary.
    expect(designationAdminQuerySchema.safeParse({ q: '   ' }).success).toBe(false);
  });

  it('caps the page size so a headless caller cannot ask for the whole table', () => {
    expect(designationAdminQuerySchema.parse({ limit: '100' }).limit).toBe(100);
    expect(designationAdminQuerySchema.safeParse({ limit: '101' }).success).toBe(false);
    expect(designationAdminQuerySchema.safeParse({ page: '0' }).success).toBe(false);
  });
});
