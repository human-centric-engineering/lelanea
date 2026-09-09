// @vitest-environment happy-dom

/**
 * AuthoredDocument in production: an unresolved placeholder is her copy, plain.
 *
 * FORK NOTE — this reads the real `lib/app/content` seam (no `vi.mock`). It
 * asserts one property of the renderer — an unresolved placeholder is plain in
 * production — using `terms_of_use` because that is where this app's unfilled
 * placeholders are. A fork swaps in a document of its own that still carries
 * one, or drops the file if it has none left.
 *
 * Its own file because `vi.mock` is hoisted for the whole module, and the
 * `doMock` + `resetModules` alternative races the module graph on CI — the same
 * reason `tests/unit/components/brand/brand-mark.test.tsx` splits its cases.
 *
 * @see components/app/content/authored-document.tsx
 */

import { render } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';

import { AuthoredDocument } from '@/components/app/content/authored-document';
import { getFoundationalDocument, type FoundationalDocumentDetail } from '@/lib/app/content';

vi.mock('@/lib/env', () => ({ env: { NODE_ENV: 'production' } }));

function load(id: string): FoundationalDocumentDetail {
  const doc = getFoundationalDocument(id);
  if (doc === null) throw new Error(`authored document '${id}' is missing`);
  return doc;
}

describe('placeholder marking in production', () => {
  it('renders an unfilled placeholder plain, with no highlight', () => {
    const { container } = render(<AuthoredDocument document={load('terms_of_use')} />);

    expect(container.querySelectorAll('[data-unresolved-placeholder]')).toHaveLength(0);
  });

  it('still shows the words themselves — the copy is not stripped', () => {
    const { container } = render(<AuthoredDocument document={load('terms_of_use')} />);
    const text = container.textContent ?? '';

    expect(text).toContain('[Month Day, Year]');
    expect(text).toContain('[Support Email]');
  });

  it('renders the document otherwise identically', () => {
    const doc = load('terms_of_use');
    const { container } = render(<AuthoredDocument document={doc} />);

    expect(container.querySelectorAll('article > :not(header)')).toHaveLength(doc.blocks.length);
  });
});
