/**
 * What a person may send to their journey record (f-journey-record t-145).
 *
 * @see lib/app/journey-record/validation.ts
 */

import { describe, expect, it } from 'vitest';

import { JOURNEY_BODY_MAX, JOURNEY_SUMMARY_MAX } from '@/lib/app/journey-record/entry';
import { ownEntryCreateSchema, ownEntryEditSchema } from '@/lib/app/journey-record/validation';

describe('ownEntryCreateSchema', () => {
  it('trims the words and treats a blank summary as none', () => {
    expect(ownEntryCreateSchema.parse({ body: '  Woke at three.  ', summary: '   ' })).toEqual({
      body: 'Woke at three.',
      summary: null,
    });
  });

  it('refuses an entry with nothing in it, or too much', () => {
    expect(ownEntryCreateSchema.safeParse({ body: '   ' }).success).toBe(false);
    expect(ownEntryCreateSchema.safeParse({}).success).toBe(false);
    expect(ownEntryCreateSchema.safeParse({ body: 'x'.repeat(JOURNEY_BODY_MAX + 1) }).success).toBe(
      false
    );
    expect(
      ownEntryCreateSchema.safeParse({ body: 'x', summary: 'x'.repeat(JOURNEY_SUMMARY_MAX + 1) })
        .success
    ).toBe(false);
  });
});

describe('ownEntryEditSchema', () => {
  it('accepts a change to any one field, including clearing the summary', () => {
    expect(ownEntryEditSchema.parse({ withheldFromAgent: true })).toEqual({
      withheldFromAgent: true,
    });
    expect(ownEntryEditSchema.parse({ summary: '' })).toEqual({ summary: null });
  });

  it('refuses an edit that changes nothing, and one that empties the words', () => {
    expect(ownEntryEditSchema.safeParse({}).success).toBe(false);
    expect(ownEntryEditSchema.safeParse({ body: '  ' }).success).toBe(false);
  });
});
