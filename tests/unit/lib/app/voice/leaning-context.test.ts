/**
 * What the AI is told each turn about the person's leanings, and the rule
 * that travels with them (f-leanings t-137).
 *
 * @see lib/app/voice/leaning-context.ts
 */

import { describe, it, expect } from 'vitest';

import { LEANING_DIMENSIONS } from '@/lib/app/voice/leanings';
import type { LeaningDialView, LeaningsView } from '@/lib/app/voice/leanings-store';
import { LEANING_RULE, composeLeaningContext } from '@/lib/app/voice/leaning-context';
import { SET_LEANING_DEFINITION } from '@/lib/app/voice/leaning-capability';

function view(overrides: Partial<Record<string, Partial<LeaningDialView>>> = {}): LeaningsView {
  return {
    configured: true,
    dials: LEANING_DIMENSIONS.map((dimension) => ({
      key: dimension.key,
      left: dimension.left,
      right: dimension.right,
      stored: 0,
      position: 0,
      min: -2,
      max: 2,
      locked: false,
      suggest: true,
      ...overrides[dimension.key],
    })),
  };
}

const lineFor = (block: string, key: string) =>
  block.split('\n').find((line) => line.startsWith(`- ${key}:`));

describe('the leanings block', () => {
  it('names every dial with its poles, where it is, and the rule after them', () => {
    const block = composeLeaningContext(view({ length: { position: 2, stored: 2 } }));

    for (const dimension of LEANING_DIMENSIONS) {
      expect(lineFor(block, dimension.key)).toContain(`${dimension.left} ↔ ${dimension.right}`);
    }
    expect(lineFor(block, 'length')).toContain('Now strongly toward Concise and spare.');
    expect(lineFor(block, 'pace')).toContain('Now at rest.');
    expect(block.endsWith(LEANING_RULE)).toBe(true);
  });

  it('says a locked dial cannot change, a narrowed one how far it goes, and which may not be suggested', () => {
    const block = composeLeaningContext(
      view({
        devotion: { min: 0, max: 0, locked: true },
        questions: { max: 1 },
        warmth: { suggest: false },
      })
    );

    expect(lineFor(block, 'devotion')).toBe(
      '- devotion: Spiritual and devotional ↔ Secular and plain. Fixed; it cannot be changed.'
    );
    expect(lineFor(block, 'questions')).toContain(
      'It goes from strongly toward Question-led to toward Guidance-led.'
    );
    expect(lineFor(block, 'questions')).toContain('You may suggest a change.');
    expect(lineFor(block, 'warmth')).toContain('Change it only if they ask.');
    expect(lineFor(block, 'warmth')).not.toContain('You may suggest');
  });

  it('is empty when nothing can change: bounds unread, or every dial locked', () => {
    expect(composeLeaningContext({ ...view(), configured: false })).toBe('');
    const locked = view(
      Object.fromEntries(
        LEANING_DIMENSIONS.map((d) => [d.key, { min: 0 as const, max: 0 as const, locked: true }])
      )
    );
    expect(composeLeaningContext(locked)).toBe('');
  });
});

describe('a proposal awaiting an answer', () => {
  it('names it after the rule, with the one call that makes it on a yes', () => {
    const block = composeLeaningContext(view(), [
      { leaning: 'length', from: 0, to: 1, how: 'proposed' },
    ]);

    expect(
      block.endsWith(
        'In your last reply you proposed setting length toward Concise and spare. If their message now says yes, call set_leaning with how: agreed, leaning: length, toward: "Concise and spare". If it does not, let it go.'
      )
    ).toBe(true);
  });

  it('drops one for a dial that has since moved or locked', () => {
    const proposal = {
      leaning: 'length' as const,
      from: 0 as const,
      to: 1 as const,
      how: 'proposed' as const,
    };

    expect(composeLeaningContext(view({ length: { position: 1 } }), [proposal])).not.toContain(
      'In your last reply'
    );
    expect(
      composeLeaningContext(view({ length: { locked: true, min: 0, max: 0 } }), [proposal])
    ).not.toContain('In your last reply');
    expect(composeLeaningContext(view(), [proposal])).toContain('In your last reply');
  });
});

describe('propose, then call only on a yes', () => {
  // The owner's ruling (4 Oct 2026), said in the two places the model reads
  // when it weighs a change. Both pinned, so neither can drift into letting
  // the AI move a dial on its own reading.
  it('is the rule in the block', () => {
    expect(LEANING_RULE).toContain('use set_leaning with how: asked');
    expect(LEANING_RULE).toContain('call set_leaning with how: proposed, which changes nothing');
    expect(LEANING_RULE).toContain(
      'Only if they say yes in their next message, call set_leaning with how: agreed'
    );
    expect(LEANING_RULE).toContain('Never change a leaning on your own inference.');
    // Its notes are evidence, never a setting.
    expect(LEANING_RULE).toContain(
      'What you have noted about how they like to be met is your evidence; it is never a reason to change a leaning yourself.'
    );
  });

  it('is the rule in the tool’s description', () => {
    expect(SET_LEANING_DEFINITION.description).toContain(
      'Only if they say yes in their next message, call it again with how: agreed'
    );
    expect(SET_LEANING_DEFINITION.description).toContain(
      'Never change a leaning on your own inference.'
    );
  });
});
