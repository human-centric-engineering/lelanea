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

const getFoundationalCollectionMeta = vi.hoisted(() =>
  vi.fn(async () => ({ locale: 'zz-COLLECTION' }))
);
vi.mock('@/lib/app/content/document-store', () => ({
  // A distinctive value, not `'en-US'`. With the real fallback the "falls back"
  // cases below would pass just as well against a hard-coded `'en-US'` in the
  // implementation — which is precisely the thing they exist to rule out.
  getFoundationalCollectionMeta,
}));

import { resolveJoinLocale } from '@/lib/app/waitlist/locale';

const FALLBACK = 'zz-COLLECTION';

describe('resolveJoinLocale', () => {
  it('reads the collection locale only when the header offers nothing', async () => {
    // Since t-86 the fallback is a database read. A well-formed header must
    // not cost one.
    getFoundationalCollectionMeta.mockClear();
    expect(await resolveJoinLocale('en-GB')).toBe('en-GB');
    expect(getFoundationalCollectionMeta).not.toHaveBeenCalled();

    expect(await resolveJoinLocale(null)).toBe(FALLBACK);
    expect(getFoundationalCollectionMeta).toHaveBeenCalledTimes(1);
  });

  it.each([
    ['en', 'en'],
    ['en-GB', 'en-GB'],
    ['pt-BR', 'pt-BR'],
    ['zh-Hant-TW', 'zh-Hant-TW'],
  ])('keeps a well-formed tag: %s', async (header, expected) => {
    expect(await resolveJoinLocale(header)).toBe(expected);
  });

  it('takes the highest-weighted tag, not the first one', async () => {
    expect(await resolveJoinLocale('en-GB,en;q=0.9,fr;q=0.8')).toBe('en-GB');
  });

  it('does NOT take the first tag when a later one outranks it', async () => {
    // The case the earlier implementation got wrong, and the reason it survived
    // review: browsers emit list order and q-order in agreement, so a
    // first-tag shortcut looks right against every real browser and records
    // `fr` for this. RFC 9110 gives list order no meaning; `q` carries it.
    expect(await resolveJoinLocale('fr;q=0.1,en-GB;q=0.9')).toBe('en-GB');
    expect(await resolveJoinLocale('de;q=0.2,es;q=0.4,it;q=0.9,nl;q=0.3')).toBe('it');
  });

  it('treats a missing q as 1, which is what outranks an explicit 0.9', async () => {
    expect(await resolveJoinLocale('fr;q=0.9,en-GB')).toBe('en-GB');
  });

  it('keeps list order as the tie-break, and only as that', async () => {
    expect(await resolveJoinLocale('en-GB;q=0.5,fr;q=0.5')).toBe('en-GB');
    expect(await resolveJoinLocale('fr;q=0.5,en-GB;q=0.5')).toBe('fr');
  });

  it('skips a tag the client explicitly refused with q=0', async () => {
    // `q=0` means "not this one". Reading it as a preference would record the
    // one language the visitor said they did not want.
    expect(await resolveJoinLocale('fr;q=0')).toBe(FALLBACK);
    expect(await resolveJoinLocale('fr;q=0,en-GB;q=0.3')).toBe('en-GB');
  });

  it('does not let a malformed weight outrank a real preference', async () => {
    // `q=banana` parsed as the DEFAULT would score 1 and beat everything. A
    // client that sent nonsense has not expressed a preference.
    expect(await resolveJoinLocale('fr;q=banana,en-GB;q=0.4')).toBe('en-GB');
    expect(await resolveJoinLocale('fr;q=99,en-GB;q=0.4')).toBe('en-GB');
  });

  it('ignores parameters that are not q', async () => {
    expect(await resolveJoinLocale('en-GB;charset=utf-8')).toBe('en-GB');
  });

  it('skips a junk tag rather than letting it win on weight', async () => {
    // A high-q value on something that is not a language tag must not beat a
    // low-q value on something that is.
    expect(await resolveJoinLocale('<script>;q=1.0,en-GB;q=0.1')).toBe('en-GB');
  });

  it('returns a single weighted tag without its q', async () => {
    expect(await resolveJoinLocale('fr;q=0.7')).toBe('fr');
  });

  it('tolerates the whitespace a browser may send', async () => {
    expect(await resolveJoinLocale('  de-AT ,  en;q=0.5')).toBe('de-AT');
  });

  it.each([
    ['no header at all', null],
    ['an empty header', ''],
    ['a header that is only separators', ',,'],
    ['the wildcard, which is the absence of a preference', '*'],
  ])('falls back to the collection locale for %s', async (_why, header) => {
    expect(await resolveJoinLocale(header)).toBe(FALLBACK);
  });

  it.each([
    ['a sentence', 'give me everything'],
    ['a SQL fragment', "en'; DROP TABLE app_waitlist_entry; --"],
    ['an HTML tag', '<script>alert(1)</script>'],
    ['a single letter', 'e'],
    ['a tag with too many subtags', 'en-GB-oed-x-extra'],
  ])('discards %s rather than storing it', async (_why, header) => {
    // The header is caller-controlled. A column that will one day be compared
    // against a real locale must not accumulate whatever a scanner sends.
    expect(await resolveJoinLocale(header)).toBe(FALLBACK);
  });

  it('bounds the work by ENTRY COUNT, not by slicing the header', async () => {
    // 10k of `a` in one entry: skipped whole as over-long, and the next entry
    // is still read. Slicing the string would have cut mid-entry instead.
    expect(await resolveJoinLocale(`${'a'.repeat(10_000)},en-GB`)).toBe('en-GB');
  });

  it('never invents a tag by truncating one the client did send', async () => {
    // THE finding. `slice(0, 200)` cuts at a byte offset: a boundary inside
    // `zh-Hant-TW` yields `zh-Hant`, which passes the tag test and is stored as
    // if it had been asked for. Padding puts a real tag across where that
    // boundary used to fall.
    const padding = Array.from({ length: 8 }, (_, i) => `x${i}-AA;q=0.1`).join(',');
    expect(await resolveJoinLocale(`${padding},zh-Hant-TW;q=0.9`)).toBe('zh-Hant-TW');
  });

  it('never turns a q-weight into a refusal by cutting it in half', async () => {
    // The other half of the same bug: a boundary inside `;q=0.85` yields `q=0.`,
    // which `parseFloat` reads as 0 — scoring the client's STRONGEST preference
    // as "explicitly not this one".
    const padding = Array.from({ length: 8 }, (_, i) => `y${i}-BB;q=0.1`).join(',');
    expect(await resolveJoinLocale(`${padding},pt-BR;q=0.85`)).toBe('pt-BR');
  });

  it('stops after a sane number of entries', async () => {
    // The real bound. A tag beyond the cap is not considered at all.
    const many = Array.from({ length: 40 }, (_, i) => `z${i}-CC;q=0.1`).join(',');
    expect(await resolveJoinLocale(`${many},en-GB;q=0.9`)).toBe(FALLBACK);
  });
});
