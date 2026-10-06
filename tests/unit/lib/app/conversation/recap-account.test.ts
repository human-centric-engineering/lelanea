/**
 * What a recap drew on, as the turn row keeps it and the pane reads it
 * (f-recap t-142). Lenient: an account that does not parse is no account,
 * never a thrown read.
 *
 * @see lib/app/conversation/recap-account.ts
 */

import { describe, expect, it } from 'vitest';

import { parseRecapAccount } from '@/lib/app/conversation/recap-account';

const ACCOUNT = { since: '2026-10-01T09:00:00.000Z', words: 2, notes: ['life wealth'], journey: 1 };

describe('parseRecapAccount', () => {
  it('reads an account as stored', () => {
    expect(parseRecapAccount(ACCOUNT)).toEqual(ACCOUNT);
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
