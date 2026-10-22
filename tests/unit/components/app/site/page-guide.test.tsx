// @vitest-environment happy-dom

/**
 * "On this page" (t-171). The guide links by fragment to headings that
 * `AuthoredDocument` renders with `anchors`, so the test that matters renders
 * both and follows every link to its target.
 */

import { render, screen, within } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';

import { AuthoredDocument, headingAnchor } from '@/components/app/content/authored-document';
import { PageGuide, guideItems } from '@/components/app/site/page-guide';
import { toDocumentDetail } from '@/lib/app/content/document-view';
import { seededDocumentRows } from '@/tests/helpers/app/foundational-documents';

vi.mock('@/lib/env', () => ({ env: { NODE_ENV: 'test' } }));

function load(id: string) {
  const row = seededDocumentRows().find((candidate) => candidate.slug === id);
  if (!row) throw new Error(`${id} is missing`);
  return toDocumentDetail(row);
}

describe('PageGuide', () => {
  it.each(['disclaimer', 'terms_of_use'])(
    'links every section of %s to a heading that exists',
    (id) => {
      const document = load(id);
      const { container } = render(
        <>
          <AuthoredDocument document={document} anchors />
          <PageGuide items={guideItems(document.blocks)} />
        </>
      );

      const links = within(screen.getByRole('navigation', { name: 'On this page' })).getAllByRole(
        'link'
      );
      expect(links.length).toBeGreaterThan(5);
      for (const link of links) {
        const target = link.getAttribute('href')!.slice(1);
        expect(container.querySelector(`[id="${target}"]`), target).not.toBeNull();
      }
    }
  );

  it('keeps the terms’ own numbering', () => {
    const items = guideItems(load('terms_of_use').blocks);

    expect(items[0].number).toBe(1);
    expect(items.at(-1)?.number).toBe(items.length);
  });

  it('adds no ids when a page does not ask for anchors', () => {
    const { container } = render(<AuthoredDocument document={load('disclaimer')} />);

    expect(container.querySelectorAll('h2').length).toBeGreaterThan(5);
    expect(container.querySelector('h2[id]')).toBeNull();
  });
});

describe('headingAnchor', () => {
  it('makes a stable, url-safe fragment from a heading', () => {
    expect(headingAnchor('What Lelañea Is Not')).toBe('what-lelanea-is-not');
    expect(headingAnchor('**Crisis** Situations')).toBe('crisis-situations');
  });
});
