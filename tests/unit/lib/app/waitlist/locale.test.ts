/**
 * `resolveJoinLocale` — which language a joiner arrived in.
 *
 * The value is provenance on a row that will outlive the single-locale site, so
 * the two things worth holding are that a real preference survives intact and
 * that caller-controlled junk never reaches the column.
 *
 * @see lib/app/waitlist/locale.ts
 */

import { describe, it, expect, vi } from 'vitest';

vi.mock('@/lib/app/content', () => ({
  // A distinctive value, not `'en-US'`. With the real fallback the "falls back"
  // cases below would pass just as well against a hard-coded `'en-US'` in the
  // implementation — which is precisely the thing they exist to rule out.
  getFoundationalCollectionMeta: () => ({ locale: 'zz-COLLECTION' }),
}));

import { resolveJoinLocale } from '@/lib/app/waitlist/locale';

const FALLBACK = 'zz-COLLECTION';

describe('resolveJoinLocale', () => {
  it.each([
    ['en', 'en'],
    ['en-GB', 'en-GB'],
    ['pt-BR', 'pt-BR'],
    ['zh-Hant-TW', 'zh-Hant-TW'],
  ])('keeps a well-formed tag: %s', (header, expected) => {
    expect(resolveJoinLocale(header)).toBe(expected);
  });

  it('takes the first tag, because the header is already in preference order', () => {
    expect(resolveJoinLocale('en-GB,en;q=0.9,fr;q=0.8')).toBe('en-GB');
  });

  it('drops the q-weight from a single weighted tag', () => {
    expect(resolveJoinLocale('fr;q=0.7')).toBe('fr');
  });

  it('tolerates the whitespace a browser may send', () => {
    expect(resolveJoinLocale('  de-AT ,  en;q=0.5')).toBe('de-AT');
  });

  it.each([
    ['no header at all', null],
    ['an empty header', ''],
    ['a header that is only separators', ',,'],
    ['the wildcard, which is the absence of a preference', '*'],
  ])('falls back to the collection locale for %s', (_why, header) => {
    expect(resolveJoinLocale(header)).toBe(FALLBACK);
  });

  it.each([
    ['a sentence', 'give me everything'],
    ['a SQL fragment', "en'; DROP TABLE app_waitlist_entry; --"],
    ['an HTML tag', '<script>alert(1)</script>'],
    ['a single letter', 'e'],
    ['a tag with too many subtags', 'en-GB-oed-x-extra'],
  ])('discards %s rather than storing it', (_why, header) => {
    // The header is caller-controlled. A column that will one day be compared
    // against a real locale must not accumulate whatever a scanner sends.
    expect(resolveJoinLocale(header)).toBe(FALLBACK);
  });

  it('does not read past its length cap, so a pathological header costs nothing', () => {
    // 10k of `a` followed by a valid tag: the cap truncates mid-run, the
    // truncated value is not a language tag, and the fallback answers.
    expect(resolveJoinLocale(`${'a'.repeat(10_000)},en-GB`)).toBe(FALLBACK);
  });
});
