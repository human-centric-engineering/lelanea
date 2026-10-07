/**
 * What a recap drew on, as the turn row keeps it and the pane reads it
 * (f-recap t-142). Lenient: an account that does not parse is no account,
 * never a thrown read.
 *
 * @see lib/app/conversation/recap-account.ts
 */

import { describe, expect, it } from 'vitest';

import { parseRecapAccount } from '@/lib/app/conversation/recap-account';

const ACCOUNT = {
  since: '2026-10-01T09:00:00.000Z',
  source: 'words' as const,
  words: 2,
  notes: ['life wealth'],
  journey: 1,
};

describe('parseRecapAccount', () => {
  it('reads an account as stored', () => {
    expect(parseRecapAccount(ACCOUNT)).toEqual(ACCOUNT);
  });

  it('reads one drawn on a kept account (t-149)', () => {
    const kept = { ...ACCOUNT, source: 'synopsis' as const, words: 0 };
    expect(parseRecapAccount(kept)).toEqual(kept);
  });

  it('reads one stored before t-149, which has no source, as drawn on their words', () => {
    const { source: _source, ...before } = ACCOUNT;
    expect(parseRecapAccount(before)).toEqual({ ...before, source: 'words' });
  });

  it.each([
    ['nothing', null],
    ['a turn that was not a recap', undefined],
    ['a negative count', { ...ACCOUNT, words: -1 }],
    ['a count that is not whole', { ...ACCOUNT, journey: 1.5 }],
    ['headings that are not strings', { ...ACCOUNT, notes: [3] }],
    ['a missing field', { words: 2, notes: [], journey: 0 }],
  ])('is null for %s', (_name, raw) => {
    expect(parseRecapAccount(raw)).toBeNull();
  });
});
