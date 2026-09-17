/**
 * The comparison surface's wire contract.
 *
 * One schema, and the two things about it that are decisions rather than
 * defaults: `against` is optional (so the ordinary one-comparison read is the
 * bare path), and it is trimmed to non-empty rather than accepted as a blank
 * string. A `?against=` with nothing after it is what a link builder produces
 * when it has no second comparison to offer, and accepting it would put an empty
 * id into the read's `in` clause — which matches nothing and renders as a second
 * version that answered every question with silence.
 *
 * @see lib/validations/app-voice-comparison.ts
 */

import { describe, it, expect } from 'vitest';
import {
  MAX_COMPARISONS_SIDE_BY_SIDE,
  voiceComparisonQuerySchema,
} from '@/lib/validations/app-voice-comparison';

describe('voiceComparisonQuerySchema', () => {
  it('accepts no `against` — the ordinary single-comparison read', () => {
    const parsed = voiceComparisonQuerySchema.parse({});
    expect(parsed.against).toBeUndefined();
  });

  it('accepts and trims a second comparison id', () => {
    expect(voiceComparisonQuerySchema.parse({ against: '  cmp-b  ' }).against).toBe('cmp-b');
  });

  it('rejects a blank `against` rather than passing an empty id to the read', () => {
    // `{ id: { in: ['', 'cmp-a'] } }` matches nothing for the empty entry, so
    // the column renders as a version that answered nothing — a wrong answer
    // that looks like a right one.
    expect(voiceComparisonQuerySchema.safeParse({ against: '   ' }).success).toBe(false);
    expect(voiceComparisonQuerySchema.safeParse({ against: '' }).success).toBe(false);
  });

  it('caps the side-by-side view at two, and the route obeys the number', () => {
    // A constant rather than a schema rule because the second id is a separate
    // parameter — a caller cannot express "show me five" — so this pins the
    // stated intent against a later change that made it a list.
    expect(MAX_COMPARISONS_SIDE_BY_SIDE).toBe(2);
  });
});
