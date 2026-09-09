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
    // Counting blocks alone would pass on a production build that emitted every
    // block empty, at the wrong tag, or with the markdown markers intact.
    const doc = load('terms_of_use');
    const { container } = render(<AuthoredDocument document={doc} />);
    const text = container.textContent ?? '';

    expect(container.querySelectorAll('article > :not(header)')).toHaveLength(doc.blocks.length);
    expect(container.querySelector('h1')?.textContent).toBe('Lelañea™');
    expect(container.querySelector('article > h2')?.textContent).toBe('1. About Lelañea');
    expect(Array.from(container.querySelectorAll('strong')).map((el) => el.textContent)).toContain(
      'Effective Date:'
    );
    expect(text).not.toContain('**');
    expect(text).toContain('Welcome to Lelañea.');
  });

  it('still substitutes the merge field', () => {
    const { container } = render(
      <AuthoredDocument document={load('the_initiation')} firstName="Maya" />
    );
    const text = container.textContent ?? '';

    expect(text).toContain('Welcome, Maya.');
    expect(text).not.toContain('{{first_name}}');
  });
});
