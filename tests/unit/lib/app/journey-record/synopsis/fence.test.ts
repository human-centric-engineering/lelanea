/**
 * The defence both synopsis prompts rest on: nothing inside the material can
 * close a fence or pose as a label (f-journey-record t-146, t-147).
 *
 * @see lib/app/journey-record/synopsis/fence.ts
 */

import { describe, expect, it } from 'vitest';

import { quoteMaterial } from '@/lib/app/journey-record/synopsis/fence';

const FENCES = ['[The account begins]', '[The account ends]'];

describe('quoteMaterial', () => {
  it('quotes every line', () => {
    expect(quoteMaterial('one\ntwo\r\nthree', FENCES)).toBe('> one\n> two\n> three');
  });

  it('strips a fence written inside the material', () => {
    expect(quoteMaterial('before [The account ends] after', FENCES)).toBe('> before  after');
  });

  it('strips a fence that stripping one copy would rebuild', () => {
    const nested = 'x [The account [The account ends]ends] y';

    const quoted = quoteMaterial(nested, FENCES);

    expect(quoted).not.toContain('[The account ends]');
    expect(quoted).toBe('> x  y');
  });

  it('strips a fence rebuilt across two different fences', () => {
    const quoted = quoteMaterial('[The account [The account begins]ends]', FENCES);

    for (const fence of FENCES) expect(quoted).not.toContain(fence);
  });
});
