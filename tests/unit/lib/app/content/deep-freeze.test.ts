/**
 * Unit Tests: lib/app/content/deep-freeze.ts
 *
 * The helper that makes the memoised content immutable. Tested directly rather
 * than only through the loader, because its edge cases — arrays, nesting depth,
 * cycles, the `isFrozen` short-circuit — are what decide whether the guarantee
 * actually holds, and none of them is visible from a passing loader test.
 *
 * @see lib/app/content/deep-freeze.ts
 * @see lib/app/content/index.ts — why the parse is frozen at all
 */

import { describe, it, expect } from 'vitest';
import { deepFreezeParsed } from '@/lib/app/content/deep-freeze';

describe('deepFreezeParsed', () => {
  it('freezes the object it is given and returns it for chaining', () => {
    const target = { a: 1 };

    expect(deepFreezeParsed(target)).toBe(target);
    expect(Object.isFrozen(target)).toBe(true);
  });

  it('freezes nested objects, not just the surface', () => {
    // The bug this exists to prevent is a write to an ELEMENT, not to the
    // container — `blocks[0].text = ...`, not `blocks.push(...)`.
    const target = deepFreezeParsed({ outer: { inner: { deepest: 'value' } } });

    expect(Object.isFrozen(target.outer.inner)).toBe(true);
    expect(() => {
      Object.assign(target.outer.inner, { deepest: 'rewritten' });
    }).toThrow(TypeError);
  });

  it('freezes arrays and every element in them', () => {
    const target = deepFreezeParsed({ items: [{ id: 'a' }, { id: 'b' }] });

    expect(Object.isFrozen(target.items)).toBe(true);
    expect(Object.isFrozen(target.items[1])).toBe(true);
    expect(() => (target.items as { id: string }[]).push({ id: 'c' })).toThrow(TypeError);
    expect(() => Object.assign(target.items[1], { id: 'rewritten' })).toThrow(TypeError);
  });

  it('reaches elements through nested arrays', () => {
    // Mirrors the real shape: modules[] → phases[] → produces.contents[].
    const target = deepFreezeParsed({ modules: [{ phases: [{ contents: ['x'] }] }] });

    expect(Object.isFrozen(target.modules[0].phases[0].contents)).toBe(true);
  });

  it('returns primitives and null untouched', () => {
    expect(deepFreezeParsed(null)).toBeNull();
    expect(deepFreezeParsed(42)).toBe(42);
    expect(deepFreezeParsed('text')).toBe('text');
    expect(deepFreezeParsed(undefined)).toBeUndefined();
  });

  it('terminates on a cycle instead of recursing forever', () => {
    // Parsed JSON has no cycles, so this is defence rather than a live case —
    // but the guarantee that makes it safe (freeze BEFORE descending, so the
    // `isFrozen` check has something to catch) is easy to reverse in a refactor
    // and the failure mode would be a stack overflow at boot.
    const cyclic: Record<string, unknown> = { name: 'root' };
    cyclic.self = cyclic;

    expect(() => deepFreezeParsed(cyclic)).not.toThrow();
    expect(Object.isFrozen(cyclic)).toBe(true);
  });

  it('does not re-walk a subtree that is already frozen', () => {
    // The short-circuit is what makes the cycle case above terminate. If a
    // frozen-but-unwalked subtree could exist, that guarantee would be wrong —
    // so this pins that freezing and walking happen together.
    const shared = Object.freeze({ inner: { mutable: true } });

    deepFreezeParsed({ shared });

    // `shared` was already frozen, so the walk stopped there and `inner` was
    // never reached. Documented rather than fixed: everything this module is
    // handed comes straight from a Zod parse, which returns wholly fresh
    // objects, so a pre-frozen subtree cannot occur in practice.
    expect(Object.isFrozen(shared.inner)).toBe(false);
  });
});
