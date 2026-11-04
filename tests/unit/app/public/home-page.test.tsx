// @vitest-environment happy-dom

/**
 * The home page reads her words from the database, by section key
 * (f-content-seeds t-86).
 *
 * Two things only a render can show. First, the page shows what the ROW says:
 * each case edits a stored document in the fake store and finds the edit on the
 * page, which a page still reading the file could not produce. Second, its
 * metadata is built per request from her `purpose` section, not from the
 * paraphrase that used to be typed into the file.
 *
 * `layout-metadata.test.ts` (Sunrise's) checks a page's static title for a
 * doubled brand. This page exports `generateMetadata` instead, so that row skips
 * it (`.context/app/divergences.md` row 24), and the title case here replaces it.
 *
 * @see app/(public)/page.tsx
 */

import { beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('@/lib/app/content/document-store', async () =>
  (await import('@/tests/helpers/app/foundational-documents')).fakeDocumentStore()
);
vi.mock('@/lib/app/content/journey-store', async () =>
  (await import('@/tests/helpers/app/content-stores')).fakeJourneyStore()
);

import { render, screen } from '@testing-library/react';

import HomePage, { dynamic, generateMetadata } from '@/app/(public)/page';
import { STRAPLINE } from '@/lib/site/config';
import { fakeDocumentStore, rewriteSection } from '@/tests/helpers/app/foundational-documents';

const store = fakeDocumentStore();

beforeEach(() => store.reset());

describe('home page metadata', () => {
  it('describes the site in her own sentence, without the bold markers', async () => {
    const metadata = await generateMetadata();

    expect(metadata.description).toBe(
      'Its purpose is not simply to help individuals improve themselves, but to support them in ' +
        'remembering who they are beneath conditioning, inherited beliefs, unconscious patterns, ' +
        'and the countless identities accumulated throughout life.'
    );
  });

  it('takes the description from the row, so an edit reaches search results', async () => {
    store.editBlocks('the_heart_behind_lelanea', (blocks) =>
      rewriteSection(blocks, 'purpose', () => 'An **edited** purpose.')
    );

    expect((await generateMetadata()).description).toBe('An edited purpose.');
  });

  it('keeps an absolute title, so the group template cannot double the brand', async () => {
    const metadata = await generateMetadata();

    expect(metadata.title).toEqual({ absolute: 'Lelañea — an invitation into conscious living' });
    expect(metadata.alternates?.canonical).toBe('/');
  });

  it('renders at request time, so an edit is not frozen into a build', () => {
    expect(dynamic).toBe('force-dynamic');
  });
});

describe('home page content', () => {
  it('renders the hero and the quote band from the stored philosophy document', async () => {
    store.editBlocks('the_heart_behind_lelanea', (blocks) =>
      rewriteSection(
        rewriteSection(blocks, 'invitation', () => 'Edited opening line.'),
        'remembrance',
        (index) => `Edited closing beat ${index}.`
      )
    );

    render(await HomePage());

    expect(screen.getByRole('heading', { level: 1 }).textContent).toBe('Edited opening line.');
    expect(screen.getByText(/Edited closing beat 0\./).textContent).toContain(
      'Edited closing beat 1.'
    );
  });

  it('renders each card from its section key in the stored documents', async () => {
    store.editBlocks('the_initiation', (blocks) =>
      rewriteSection(
        rewriteSection(blocks, 'invitation', () => 'Edited invitation beat.'),
        'guide',
        () => 'Edited guide beat.'
      )
    );
    store.editBlocks('disclaimer', (blocks) =>
      rewriteSection(blocks, 'commitment', () => 'Edited commitment.')
    );

    render(await HomePage());

    expect(screen.getAllByText('Edited invitation beat.')).toHaveLength(3);
    expect(screen.getAllByText('Edited guide beat.')).toHaveLength(9);
    expect(screen.getAllByText('Edited commitment.')).toHaveLength(2);
  });

  it('says the strapline once: the arc on the water repeats the caption (t-184)', async () => {
    render(await HomePage());

    // The caption is in the page, above the heading, for assistive technology
    // only; the words on the water are decoration.
    const caption = screen.getByText(STRAPLINE);
    expect(caption.className).toContain('sr-only');
    expect(caption.compareDocumentPosition(screen.getByRole('heading', { level: 1 }))).toBe(
      Node.DOCUMENT_POSITION_FOLLOWING
    );
    const arc = screen.getByTestId('dot-lotus-strap');
    expect(arc).toHaveAttribute('aria-hidden', 'true');

    // The same words, letter for letter: change one and this fails.
    const written = [...arc.querySelectorAll('tspan')]
      .map((letter) => letter.textContent?.replace('\u00a0', ' '))
      .join('');
    expect(written).toBe(caption.textContent);
  });

  it('fails loudly when a key a card needs has gone, rather than rendering an empty card', async () => {
    store.editBlocks('disclaimer', (blocks) =>
      blocks.map((block) => (block.section === 'commitment' ? { ...block, section: null } : block))
    );

    await expect(HomePage()).rejects.toThrow(/no section "commitment"/);
  });
});
