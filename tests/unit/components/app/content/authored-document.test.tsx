// @vitest-environment happy-dom

/**
 * AuthoredDocument — the one renderer for Lelañea Fulton's foundational documents.
 *
 * These cases are written against the REAL content, loaded through
 * `lib/app/content`, because the property under test is "what she wrote is what
 * a reader sees". A fixture would prove the renderer consistent with a fixture.
 *
 * The expectations are derived from the authored blocks rather than pasted, so
 * the suite cannot rot as copy is corrected — but the set of documents it walks
 * is pinned, so a content change that removed one could not quietly shrink the
 * test to nothing.
 *
 * FORK NOTE — this reads the real `lib/app/content` seam (no `vi.mock`), so a
 * fork that has not filled `content/` has nothing for these cases to render.
 * The seam here is the LOADER, not the renderer: `AuthoredDocument` takes a
 * plain `FoundationalDocumentDetail`, so a fork keeps the component as-is and
 * repoints the fixtures. Pin your own document ids in `DOCUMENT_IDS` and your
 * own merge-field sites in the D7 block; every other case builds its input with
 * `synthetic()` and is content-independent.
 *
 * Production behaviour of the placeholder marker lives in
 * `authored-document.production.test.tsx`: `vi.mock` is hoisted per file, and
 * the `doMock` + `resetModules` alternative races the module graph on CI (see
 * the note in `tests/unit/components/brand/brand-mark.test.tsx`).
 *
 * @see components/app/content/authored-document.tsx
 * @see .context/app/content.md
 */

import { readFileSync } from 'node:fs';

import { render } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';

import {
  AuthoredDocument,
  applyFirstName,
  tokenizeInline,
} from '@/components/app/content/authored-document';
import {
  getFoundationalDocument,
  listFoundationalDocuments,
  type FoundationalDocumentDetail,
} from '@/lib/app/content';

vi.mock('@/lib/env', () => ({ env: { NODE_ENV: 'test' } }));

/** The seven documents, pinned in reading order — see content.md. */
const DOCUMENT_IDS = [
  'the_initiation',
  'the_heart_behind_lelanea',
  'the_mission',
  'about_the_creator',
  'the_lineage_of_lelanea',
  'disclaimer',
  'terms_of_use',
] as const;

function load(id: string): FoundationalDocumentDetail {
  const doc = getFoundationalDocument(id);
  if (doc === null) throw new Error(`authored document '${id}' is missing`);
  return doc;
}

/**
 * What a reader with a name on file should end up seeing: bold markers gone and
 * the merge field replaced.
 *
 * Deliberately NOT `applyFirstName()`. Calling the component's own function here
 * would put any bug in it on both sides of the assertion — a stand-in returning
 * "MANGLED" for every merge-field string passes. With a name supplied the
 * expected value is a plain substitution, so the test can derive it itself; the
 * comma rules for a reader with no name are pinned literally in the D7 block,
 * which is where that logic is actually checked.
 */
function expectedFor(text: string, firstName: string): string {
  return text.replaceAll('**', '').split('{{first_name}}').join(firstName);
}

/**
 * Source with comments removed, so a scan for a banned API cannot be tripped by
 * a docblock that names the API in order to rule it out.
 *
 * Deliberately crude — it is scanning one known file, not parsing TypeScript.
 * `authored-document.test.tsx` proves it strips prose and keeps code.
 */
function stripComments(source: string): string {
  return source.replace(/\/\*[\s\S]*?\*\//g, '').replace(/\/\/[^\n]*/g, '');
}

/** The block elements the renderer is expected to emit, in order. */
function renderedBlocks(container: HTMLElement): Element[] {
  return Array.from(container.querySelectorAll('article > :not(header)'));
}

function synthetic(overrides: Partial<FoundationalDocumentDetail>): FoundationalDocumentDetail {
  return {
    id: 'synthetic',
    title: 'Synthetic',
    subtitle: null,
    category: 'about',
    surface: 'test',
    requiresAcknowledgement: false,
    placeholders: [],
    renderStyle: null,
    renderNote: null,
    blockCount: 0,
    blocks: [],
    ...overrides,
  };
}

describe('the seven documents render block for block', () => {
  it('walks exactly the seven documents the collection declares', () => {
    const index = listFoundationalDocuments();
    expect(index.documents.map((doc) => doc.id)).toEqual([...DOCUMENT_IDS]);
  });

  it.each(DOCUMENT_IDS)('%s renders every block, in order, at the right level', (id) => {
    const doc = load(id);
    const { container } = render(<AuthoredDocument document={doc} firstName="Maya" />);
    const elements = renderedBlocks(container);

    expect(elements).toHaveLength(doc.blocks.length);

    doc.blocks.forEach((block, index) => {
      const element = elements[index];

      switch (block.type) {
        case 'heading': {
          expect(element.tagName).toBe(`H${Math.min(6, Math.max(2, block.level))}`);
          const text = expectedFor(block.text, 'Maya');
          const expected = block.number === undefined ? text : `${block.number}. ${text}`;
          expect(element.textContent).toBe(expected);
          break;
        }
        case 'paragraph': {
          expect(element.tagName).toBe('P');
          expect(element.textContent).toBe(expectedFor(block.text, 'Maya'));
          break;
        }
        case 'list': {
          expect(element.tagName).toBe('UL');
          const items = Array.from(element.querySelectorAll('li'));
          expect(items.map((li) => li.textContent)).toEqual(
            block.items.map((item) => expectedFor(item, 'Maya'))
          );
          break;
        }
      }
    });
  });

  it.each(DOCUMENT_IDS)('%s leaves no markdown markers or merge fields visible', (id) => {
    const { container } = render(<AuthoredDocument document={load(id)} firstName="Maya" />);
    const text = container.textContent ?? '';

    expect(text).not.toContain('**');
    expect(text).not.toContain('{{');
  });

  it('applies the cadence class to the document that asked for it', () => {
    // Previously asserted only on a synthetic doc, so nothing tied the class to
    // `renderStyle` as the real content carries it.
    const doc = load('the_initiation');
    expect(doc.renderStyle).toBe('cadence');

    const { container } = render(<AuthoredDocument document={doc} />);
    for (const paragraph of container.querySelectorAll('article > p')) {
      expect(paragraph.className).toContain('whitespace-pre-line');
    }
  });

  it('does not reflow the welcome statement into prose', () => {
    const doc = load('the_initiation');
    const { container } = render(<AuthoredDocument document={doc} firstName="Maya" />);

    // 70 single-sentence beats, 70 elements. Joining any two would show up here
    // long before it showed up as a paragraph that reads slightly differently.
    expect(container.querySelectorAll('article > p')).toHaveLength(doc.blocks.length);
    expect(doc.blocks.length).toBeGreaterThan(50);
  });
});

describe('cadence', () => {
  it('keeps a line break inside a cadence beat', () => {
    const doc = synthetic({
      renderStyle: 'cadence',
      blocks: [{ type: 'paragraph', text: 'line one\nline two' }],
    });
    const { container } = render(<AuthoredDocument document={doc} />);
    const paragraph = container.querySelector('article > p');

    expect(paragraph?.className).toContain('whitespace-pre-line');
    expect(paragraph?.textContent).toBe('line one\nline two');
  });

  it('does not apply pre-line to a document that did not ask for it', () => {
    const doc = synthetic({ blocks: [{ type: 'paragraph', text: 'ordinary prose' }] });
    const { container } = render(<AuthoredDocument document={doc} />);

    expect(container.querySelector('article > p')?.className).not.toContain('whitespace-pre-line');
  });
});

describe('inline emphasis', () => {
  it('renders **bold** as a strong element and keeps the surrounding sentence', () => {
    const { container } = render(<AuthoredDocument document={load('disclaimer')} />);
    const strongs = Array.from(container.querySelectorAll('strong')).map((el) => el.textContent);

    expect(strongs).toContain('Lelañea Fulton');
    expect(strongs).toContain('Transcendental Coach');
    expect(container.textContent ?? '').toContain(
      'created by Lelañea Fulton, a Transcendental Coach and Unity-Consciousness Guide.'
    );
  });

  it('splits three spans in one sentence into three, not one', () => {
    expect(tokenizeInline('a **one** b **two** c **three** d')).toEqual([
      { text: 'a ', bold: false, placeholder: false },
      { text: 'one', bold: true, placeholder: false },
      { text: ' b ', bold: false, placeholder: false },
      { text: 'two', bold: true, placeholder: false },
      { text: ' c ', bold: false, placeholder: false },
      { text: 'three', bold: true, placeholder: false },
      { text: ' d', bold: false, placeholder: false },
    ]);
  });

  it('leaves an unpaired marker as literal text rather than swallowing the rest', () => {
    expect(tokenizeInline('two ** three')).toEqual([
      { text: 'two ** three', bold: false, placeholder: false },
    ]);
  });

  it('renders markup in the source as text, never as elements', () => {
    const doc = synthetic({
      blocks: [{ type: 'paragraph', text: '<script>alert(1)</script> & <b>hi</b>' }],
    });
    const { container } = render(<AuthoredDocument document={doc} />);

    expect(container.querySelector('script')).toBeNull();
    expect(container.querySelector('b')).toBeNull();
    expect(container.querySelector('article > p')?.textContent).toBe(
      '<script>alert(1)</script> & <b>hi</b>'
    );
  });

  it('has no HTML-injection path in the source at all', () => {
    const source = stripComments(
      readFileSync('components/app/content/authored-document.tsx', 'utf8')
    );

    // The positive assertion proves the read and the strip found real code, so
    // the negative one below cannot pass by scanning an empty string.
    expect(source).toContain('export function AuthoredDocument');
    expect(source).not.toContain('dangerouslySetInnerHTML');
  });

  it('the comment stripper removes prose and keeps code', () => {
    // Without this, the check above would be satisfied by a stripper that
    // deleted everything — and the component's own docblock says the words
    // "dangerouslySetInnerHTML" while promising not to use it, which is exactly
    // the false positive the strip exists to avoid.
    const stripped = stripComments(
      ['/* dangerouslySetInnerHTML */', 'const keep = 1; // dangerouslySetInnerHTML'].join('\n')
    );

    expect(stripped).toContain('const keep = 1;');
    expect(stripped).not.toContain('dangerouslySetInnerHTML');
  });
});

describe('headings', () => {
  it('numbers the clauses of the Terms of Use', () => {
    const doc = load('terms_of_use');
    const { container } = render(<AuthoredDocument document={doc} />);
    const headings = Array.from(container.querySelectorAll('article > h2'));

    expect(headings).toHaveLength(doc.blocks.filter((b) => b.type === 'heading').length);
    expect(headings[0].textContent).toBe('1. About Lelañea');
    expect(headings[1].textContent).toBe('2. Eligibility');
  });

  it('leaves the document title as the only h1', () => {
    const { container } = render(<AuthoredDocument document={load('terms_of_use')} />);
    const h1s = Array.from(container.querySelectorAll('h1'));

    expect(h1s).toHaveLength(1);
    expect(h1s[0].textContent).toBe('Lelañea™');
  });

  it('clamps an authored level into the h2–h6 range', () => {
    const doc = synthetic({
      blocks: [
        { type: 'heading', text: 'top', level: 1 },
        { type: 'heading', text: 'third', level: 3 },
        { type: 'heading', text: 'deep', level: 9 },
      ],
    });
    const { container } = render(<AuthoredDocument document={doc} />);

    expect(renderedBlocks(container).map((el) => el.tagName)).toEqual(['H2', 'H3', 'H6']);
  });
});

describe('{{first_name}} (decision D7)', () => {
  const initiation = () => load('the_initiation');

  it('substitutes the reader’s name at both sites', () => {
    const { container } = render(<AuthoredDocument document={initiation()} firstName="Maya" />);
    const text = container.textContent ?? '';

    expect(text).toContain('Welcome, Maya.');
    expect(text).toContain('You, Maya, are far more powerful than you know.');
  });

  it('closes the sentence over the gap when there is no name on file', () => {
    const { container } = render(<AuthoredDocument document={initiation()} />);
    const text = container.textContent ?? '';

    expect(text).toContain('Welcome.');
    expect(text).not.toContain('Welcome,');
    // The vocative is bracketed by two commas; dropping only the first would
    // leave "You, are far more powerful…".
    expect(text).toContain('You are far more powerful than you know.');
    expect(text).not.toContain('You, are');
  });

  it('treats an empty or blank string as no name rather than as a name', () => {
    expect(applyFirstName('Welcome, {{first_name}}.', '')).toBe('Welcome.');
    expect(applyFirstName('Welcome, {{first_name}}.', '   ')).toBe('Welcome.');
    expect(applyFirstName('Welcome, {{first_name}}.', null)).toBe('Welcome.');
    expect(applyFirstName('Welcome, {{first_name}}.', undefined)).toBe('Welcome.');
  });

  it('trims a name rather than rendering its padding', () => {
    expect(applyFirstName('Welcome, {{first_name}}.', ' Maya ')).toBe('Welcome, Maya.');
  });

  it('leaves text without the merge field untouched', () => {
    expect(applyFirstName('And that matters.', null)).toBe('And that matters.');
  });

  it('never writes the substitution back into the memoised document', () => {
    render(<AuthoredDocument document={initiation()} firstName="Maya" />);

    const reloaded = load('the_initiation');
    expect(reloaded.blocks[0]).toEqual({ type: 'paragraph', text: 'Welcome, {{first_name}}.' });
  });
});

describe('unresolved placeholders', () => {
  it('marks the two unfilled legal placeholders outside production', () => {
    const { container } = render(<AuthoredDocument document={load('terms_of_use')} />);
    const marked = Array.from(container.querySelectorAll('[data-unresolved-placeholder]')).map(
      (el) => el.textContent
    );

    expect(marked).toEqual(['[Month Day, Year]', '[Support Email]']);
  });

  it('marks nothing in a document that has no unfilled placeholders', () => {
    const { container } = render(<AuthoredDocument document={load('disclaimer')} />);

    expect(container.querySelectorAll('[data-unresolved-placeholder]')).toHaveLength(0);
  });

  it('keeps a placeholder inside a bold span emphasised', () => {
    const doc = synthetic({
      blocks: [{ type: 'paragraph', text: '**Effective: [Month Day, Year]**' }],
    });
    const { container } = render(<AuthoredDocument document={doc} />);
    const strong = container.querySelector('strong');

    expect(strong?.textContent).toBe('Effective: [Month Day, Year]');
    expect(strong?.querySelector('[data-unresolved-placeholder]')).not.toBeNull();
  });

  it('finds a placeholder wherever it sits in the string', () => {
    // These used to be labelled as proving the `lastIndex` reset in
    // `tokenizeInline`. They cannot: both `exec` loops drain to `null`, and
    // `exec` zeroes `lastIndex` when it returns `null`, so a stale index is
    // unreachable and these pass with the reset deleted. The reset stays as
    // belt-and-braces; these cases prove position-independence, which is real.
    expect(tokenizeInline('a long stretch of prose then [Support Email]').at(-1)).toEqual({
      text: '[Support Email]',
      bold: false,
      placeholder: true,
    });
    expect(tokenizeInline('[Support Email] first')).toEqual([
      { text: '[Support Email]', bold: false, placeholder: true },
      { text: ' first', bold: false, placeholder: false },
    ]);
  });
});

describe('the merge field in every block type', () => {
  // The heading and list branches call `applyFirstName` too, and no authored
  // heading or list item carries the field — so without these, dropping either
  // call would ship green.
  it('substitutes inside a heading', () => {
    const doc = synthetic({
      blocks: [{ type: 'heading', text: 'Welcome, {{first_name}}', level: 2 }],
    });
    const { container } = render(<AuthoredDocument document={doc} firstName="Maya" />);

    expect(container.querySelector('h2')?.textContent).toBe('Welcome, Maya');
  });

  it('substitutes inside a list item', () => {
    const doc = synthetic({
      blocks: [{ type: 'list', style: 'unordered', items: ['for you, {{first_name}}'] }],
    });
    const { container } = render(<AuthoredDocument document={doc} firstName="Maya" />);

    expect(container.querySelector('li')?.textContent).toBe('for you, Maya');
  });

  it('closes the gap inside a heading and a list item too', () => {
    const doc = synthetic({
      blocks: [
        { type: 'heading', text: 'Welcome, {{first_name}}', level: 2 },
        { type: 'list', style: 'unordered', items: ['for you, {{first_name}}, always'] },
      ],
    });
    const { container } = render(<AuthoredDocument document={doc} />);

    expect(container.querySelector('h2')?.textContent).toBe('Welcome');
    expect(container.querySelector('li')?.textContent).toBe('for you always');
  });
});

describe('a name is data, not a replacement pattern', () => {
  // `replaceAll(field, name)` interprets `$&`, `` $` ``, `$'` and `$$` in the
  // replacement. The name is reader-supplied, so `A$&B` re-emitted a literal
  // `{{first_name}}` into her sentence — in production, unmarked.
  it.each([
    ['A$&B', 'Welcome, A$&B.'],
    ["$'", "Welcome, $'."],
    ['$`', 'Welcome, $`.'],
    ['Ada$$', 'Welcome, Ada$$.'],
    ['$1', 'Welcome, $1.'],
  ])('renders the name %s literally', (name, expected) => {
    expect(applyFirstName('Welcome, {{first_name}}.', name)).toBe(expected);
  });

  it('does not re-emit the merge field for any of them', () => {
    for (const name of ['A$&B', "$'", '$`', 'Ada$$']) {
      expect(applyFirstName('Welcome, {{first_name}}.', name)).not.toContain('{{first_name}}');
    }
  });

  it('removes every occurrence, not just the first', () => {
    // Without the `g` flag a second field in one block ships to an anonymous
    // reader as raw `{{first_name}}`. No authored block carries two today, and
    // the occurrence-count test below cannot see this: its two sites are in
    // separate blocks.
    expect(applyFirstName('Hi, {{first_name}}, and again, {{first_name}}.', null)).toBe(
      'Hi and again.'
    );
    expect(applyFirstName('Hi, {{first_name}}, and again, {{first_name}}.', 'Maya')).toBe(
      'Hi, Maya, and again, Maya.'
    );
  });

  it('takes the comma across a non-breaking space, but never across a line break', () => {
    // The removal spans horizontal whitespace only. `\s` would cross a newline
    // and reflow the cadence document; `[ \t]` would miss these two and leave
    // the comma stranded. Both directions ship green without this case.
    expect(applyFirstName('Welcome,\u00a0{{first_name}}.', null)).toBe('Welcome.');
    expect(applyFirstName('Welcome,\u3000{{first_name}}.', null)).toBe('Welcome.');

    // The line break is kept, and so is the comma in front of it — removing the
    // break is the worse error. Characterised, not endorsed; nothing authored
    // contains a newline.
    expect(applyFirstName('Welcome,\n{{first_name}}.', null)).toBe('Welcome,\n.');
    expect(applyFirstName('You,\n{{first_name}},\nare here.', null)).toBe('You,\n\nare here.');
  });

  it('leaves the rest of the authored block alone', () => {
    // The gap-closing branch used to collapse whitespace and trim across the
    // WHOLE string, so a named and an anonymous reader saw different whitespace
    // in the same block — in the one document whose cadence makes it matter.
    const authored = 'I see you.\n\nWelcome, {{first_name}}. Far  apart.';

    expect(applyFirstName(authored, 'Maya')).toBe('I see you.\n\nWelcome, Maya. Far  apart.');
    expect(applyFirstName(authored, null)).toBe('I see you.\n\nWelcome. Far  apart.');
  });
});

describe('what the renderer does not handle, pinned so a change is visible', () => {
  it('has exactly two merge-field sites in the authored content', () => {
    // The reason `applyFirstName` does not handle a sentence-initial field is
    // that no such line exists. `placeholders.test.ts` cannot protect that: it
    // pins the set of distinct placeholder STRINGS, and a third occurrence of
    // `{{first_name}}` leaves that set unchanged. This counts occurrences.
    const sites = DOCUMENT_IDS.flatMap((id) =>
      load(id).blocks.flatMap((block) =>
        (block.type === 'list' ? block.items : [block.text]).filter((text) =>
          text.includes('{{first_name}}')
        )
      )
    );

    expect(sites).toEqual([
      'Welcome, {{first_name}}.',
      'You, {{first_name}}, are far more powerful than you know.',
    ]);
  });

  it('loses the capital on a sentence-initial field — characterised, not endorsed', () => {
    expect(applyFirstName('{{first_name}}, welcome.', null)).toBe(' welcome.');
    expect(applyFirstName('{{first_name}}, welcome.', 'Maya')).toBe('Maya, welcome.');
  });

  it('leaves an empty bold span when the merge field itself was emphasised', () => {
    // Substitution runs before the inline pass, so removing a field wrapped in
    // its own `**…**` leaves the markers behind — and `****` renders literally.
    // Same class as the straddling case below: the two passes cannot see each
    // other's boundaries. No authored site emphasises a merge field.
    expect(applyFirstName('Welcome, **{{first_name}}**.', null)).toBe('Welcome, ****.');
    expect(applyFirstName('Welcome, **{{first_name}}**.', 'Maya')).toBe('Welcome, **Maya**.');
  });

  it('treats a name of only zero-width characters as a name', () => {
    // `trim()` removes whitespace, and a zero-width space is not whitespace, so
    // this renders as a near-blank vocative. Left alone deliberately: the
    // obvious fix — stripping zero-width characters — strips ZWJ too, which
    // would break a legitimate emoji name like 👩‍👩‍👧.
    expect(applyFirstName('Welcome, {{first_name}}.', '\u200b')).toBe('Welcome, \u200b.');
    expect(applyFirstName('Welcome, {{first_name}}.', '👩‍👩‍👧')).toBe('Welcome, 👩‍👩‍👧.');
  });

  it('misses a placeholder that straddles a bold boundary', () => {
    // Bold is split first, so neither run holds a complete `[…]`. No authored
    // string does this; there is no ordering that handles both nestings.
    expect(tokenizeInline('[Support **Email**]').some((token) => token.placeholder)).toBe(false);
  });

  it('renders an empty bold span as literal asterisks', () => {
    expect(tokenizeInline('****')).toEqual([{ text: '****', bold: false, placeholder: false }]);
  });
});

describe('document chrome', () => {
  it.each([
    ['the_initiation', 'welcome'],
    ['the_mission', 'about lelañea'],
    ['terms_of_use', 'important disclosures'],
  ])('labels the eyebrow for %s', (id, label) => {
    const { container } = render(<AuthoredDocument document={load(id)} />);
    expect(container.querySelector('.brand-eyebrow')?.textContent).toBe(label);
  });

  it('shows the category eyebrow and the subtitle', () => {
    const { container } = render(<AuthoredDocument document={load('disclaimer')} />);
    const header = container.querySelector('header');

    expect(header?.querySelector('.brand-eyebrow')?.textContent).toBe('important disclosures');
    expect(header?.textContent).toContain('What It Is, What It Is Not, and Important Disclosures');
  });

  it('omits the subtitle where the source has none', () => {
    const doc = load('the_mission');
    expect(doc.subtitle).toBeNull();

    const { container } = render(<AuthoredDocument document={doc} />);
    expect(container.querySelectorAll('header p')).toHaveLength(1);
  });

  it('sets the brand display face on the title', () => {
    const { container } = render(<AuthoredDocument document={load('the_mission')} />);
    expect(container.querySelector('h1')?.className).toContain('brand-display');
  });

  it('passes a caller’s className through to the article', () => {
    const { container } = render(
      <AuthoredDocument document={load('the_mission')} className="max-w-prose" />
    );
    expect(container.querySelector('article')?.className).toContain('max-w-prose');
  });
});
