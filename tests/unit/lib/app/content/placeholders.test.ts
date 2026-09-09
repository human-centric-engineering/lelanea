/**
 * Unit Tests: authored-content placeholders
 *
 * Lelañea's copy carries three merge fields and no more. Two of them are
 * unfilled launch blockers the author flagged herself (`[Month Day, Year]` and
 * `[Support Email]` in the Terms of Use); one is a personalisation the app
 * substitutes (`{{first_name}}`, twice, in the welcome statement).
 *
 * This test pins that set exactly, in both directions:
 *   - a new bracket appearing in the prose fails, because a placeholder nobody
 *     substitutes ships to a reader as literal `[Support Email]`;
 *   - a placeholder declared on a document but absent from its blocks fails too,
 *     because the renderer would offer a substitution that never lands.
 *
 * If a fourth placeholder is genuinely introduced, the fix is to add it here AND
 * to whatever substitutes it — not to loosen the assertion.
 *
 * ---------------------------------------------------------------------------
 * FORK NOTE — this reads the real `lib/app/content` seam
 * ---------------------------------------------------------------------------
 * `KNOWN_PLACEHOLDERS` is Lelañea's set, pinned deliberately. A fork with its own
 * copy should replace that constant with its own merge fields and keep every
 * case: the assertion "the prose contains exactly the placeholders something
 * substitutes, and no others" is what stops a literal `[Support Email]` reaching
 * a reader, and it is worth having in any fork.
 *
 * @see lib/app/content/index.ts — `PLACEHOLDER_PATTERN`, `findPlaceholders`
 */

import { describe, it, expect } from 'vitest';
import {
  findPlaceholders,
  getFoundationalDocument,
  listDeclaredPlaceholders,
  listFoundationalDocuments,
  listOccurringPlaceholders,
} from '@/lib/app/content';

/** Every merge field the app knows how to deal with. Grow this deliberately. */
const KNOWN_PLACEHOLDERS = ['[Month Day, Year]', '[Support Email]', '{{first_name}}'];

describe('authored content placeholders', () => {
  it('the documents declare exactly the known placeholders', () => {
    expect(listDeclaredPlaceholders()).toEqual(KNOWN_PLACEHOLDERS);
  });

  it('the prose contains exactly the known placeholders and no stray brackets', () => {
    expect(listOccurringPlaceholders()).toEqual(KNOWN_PLACEHOLDERS);
  });

  it('every declared placeholder actually occurs in the document that declares it', () => {
    for (const summary of listFoundationalDocuments().documents) {
      if (summary.placeholders.length === 0) continue;

      const document = getFoundationalDocument(summary.id);
      const occurring = new Set(
        document?.blocks.flatMap((block) =>
          (block.type === 'list' ? block.items : [block.text]).flatMap(findPlaceholders)
        )
      );

      expect([...occurring].sort()).toEqual([...summary.placeholders].sort());
    }
  });

  it('attributes each placeholder to the document that owns it', () => {
    expect(getFoundationalDocument('the_initiation')?.placeholders).toEqual(['{{first_name}}']);
    expect(getFoundationalDocument('terms_of_use')?.placeholders).toEqual([
      '[Month Day, Year]',
      '[Support Email]',
    ]);
  });

  describe('findPlaceholders', () => {
    it('finds both conventions in one string', () => {
      expect(findPlaceholders('Welcome, {{first_name}} — write to [Support Email].')).toEqual([
        '{{first_name}}',
        '[Support Email]',
      ]);
    });

    it('reports each placeholder once however often it appears', () => {
      expect(findPlaceholders('{{first_name}}, you, {{first_name}}, are here.')).toEqual([
        '{{first_name}}',
      ]);
    });

    it('returns nothing for prose without merge fields', () => {
      expect(findPlaceholders('You are far more powerful than you know.')).toEqual([]);
    });
  });
});
