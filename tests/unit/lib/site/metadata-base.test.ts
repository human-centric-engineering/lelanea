/**
 * `resolveMetadataBase` — which app-URL inputs produce which origin.
 *
 * The case that matters is the EMPTY STRING. `Dockerfile` does
 * `ARG NEXT_PUBLIC_APP_URL` then `ENV NEXT_PUBLIC_APP_URL=$NEXT_PUBLIC_APP_URL`,
 * which sets the variable to `''` rather than leaving it unset when the build
 * arg is omitted — `lib/env.ts`'s `withoutBlankClientValues` documents that in
 * as many words. The first version of this code used `??`, which falls back
 * only on `undefined`, so `''` reached `new URL('')` and threw
 * `ERR_INVALID_URL` while the ROOT LAYOUT was still evaluating: every page
 * down, with a stack trace naming neither the variable nor the Dockerfile.
 *
 * That case previously "passed" as `expect(() => new URL('' || fallback))`,
 * which tests JavaScript's `||` rather than this app — and TypeScript flagged
 * it as always-falsy, which is what exposed it.
 */

import { describe, it, expect } from 'vitest';

import { resolveMetadataBase, DEFAULT_APP_ORIGIN } from '@/lib/site/metadata-base';

describe('resolveMetadataBase', () => {
  it('uses a configured absolute URL', () => {
    expect(resolveMetadataBase('https://lelanea.com').origin).toBe('https://lelanea.com');
  });

  it('keeps a non-default port', () => {
    expect(resolveMetadataBase('http://localhost:3014').origin).toBe('http://localhost:3014');
  });

  it.each([
    ['undefined', undefined],
    ['an empty string, as Docker produces', ''],
    ['whitespace', '   '],
  ])('falls back to the default origin for %s', (_label, value) => {
    expect(resolveMetadataBase(value).origin).toBe(new URL(DEFAULT_APP_ORIGIN).origin);
  });

  it('never throws on the inputs a build can actually produce', () => {
    for (const value of [undefined, '', ' ', '\t\n']) {
      expect(() => resolveMetadataBase(value)).not.toThrow();
    }
  });

  it('trims a value with stray whitespace rather than failing on it', () => {
    expect(resolveMetadataBase('  https://lelanea.com  ').origin).toBe('https://lelanea.com');
  });

  it('fails loudly on a value that is set but unparseable', () => {
    // Deliberately NOT swallowed into the localhost fallback: a misconfigured
    // URL that silently becomes localhost is the same invisible failure the
    // whole module exists to prevent, one layer further in.
    expect(() => resolveMetadataBase('lelanea.com')).toThrow(/NEXT_PUBLIC_APP_URL/);
    expect(() => resolveMetadataBase('not a url')).toThrow(/not a valid absolute URL/);
  });

  it('names the offending value in the error, so the fix is obvious', () => {
    expect(() => resolveMetadataBase('lelanea.com')).toThrow(/"lelanea\.com"/);
  });
});
