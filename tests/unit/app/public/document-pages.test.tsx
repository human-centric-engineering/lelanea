// @vitest-environment happy-dom

/**
 * The five pages that render her documents: `/lelanea`, `/mission`, `/data`,
 * `/disclaimer` and `/terms`.
 *
 * Replaces `stub-pages.test.tsx`, which pinned the three B31 placeholders t-5
 * shipped in their place. Two of its cases survive here in spirit — each page
 * is distinct, and each sets its own canonical — and the two that were written
 * to fail when the real copy landed are gone deliberately: the "says it is not
 * finished yet" case, and the one asserting `robots: { index: false }` on all
 * three. That was the point of writing them to be noticed.
 *
 * ## What this file does NOT do
 *
 * It does not check that the words are hers — `authored-provenance.test.ts`
 * does that, from the other direction, by proving they are in no source file.
 * It does not check that the selectors resolve — `sections.test.ts` does that
 * against the content. What is left for here is what only rendering can show:
 * that each page assembles, that the outline is sound, and that the disclosures
 * a visitor most needs actually reach the DOM.
 */

import { vi, beforeEach, describe, expect, it } from 'vitest';

// Her documents are read from the database since t-86. This serves exactly the
// rows the seed writes, through the real projection.
vi.mock('@/lib/app/content/document-store', async () =>
  (await import('@/tests/helpers/app/foundational-documents')).fakeDocumentStore()
);
import { render, screen, within } from '@testing-library/react';

import LelaneaPage, {
  dynamic as lelaneaDynamic,
  metadata as lelaneaMeta,
} from '@/app/(public)/lelanea/page';
import MissionPage, {
  dynamic as missionDynamic,
  metadata as missionMeta,
} from '@/app/(public)/mission/page';
import DataPage, {
  dynamic as dataDynamic,
  metadata as dataMeta,
} from '@/app/(public)/data/page';
import DisclaimerPage, {
  dynamic as disclaimerDynamic,
  metadata as disclaimerMeta,
} from '@/app/(public)/disclaimer/page';
import TermsPage, {
  dynamic as termsDynamic,
  metadata as termsMeta,
} from '@/app/(public)/terms/page';
import { fakeDocumentStore } from '@/tests/helpers/app/foundational-documents';
import type { StoredDocumentBlock } from '@/lib/app/content/schemas';

const store = fakeDocumentStore();
beforeEach(() => store.reset());

/** Replace the first paragraph of a stored document. */
function editFirstParagraph(id: string, text: string): void {
  store.editBlocks(id, (blocks) => {
    const index = blocks.findIndex((block) => block.type === 'paragraph');
    return blocks.map(
      (block, i): StoredDocumentBlock =>
        i === index && block.type === 'paragraph' ? { ...block, text } : block
    );
  });
}

const PAGES = [
  ['/lelanea', LelaneaPage, lelaneaMeta] as const,
  ['/mission', MissionPage, missionMeta] as const,
  ['/data', DataPage, dataMeta] as const,
  ['/disclaimer', DisclaimerPage, disclaimerMeta] as const,
  ['/terms', TermsPage, termsMeta] as const,
];

describe('the authored public pages', () => {
  it.each(PAGES)('%s renders exactly one h1', async (_route, Page) => {
    render(await Page());

    // One, not "at least one". Three of these pages host several documents or
    // document sections, and the mistake each invites is a second `h1` from a
    // document header rendered where a section heading belonged.
    expect(screen.getAllByRole('heading', { level: 1 })).toHaveLength(1);
  });

  it.each(PAGES)('%s has a heading outline with no skipped level', async (_route, Page) => {
    const { container } = render(await Page());

    const levels = Array.from(container.querySelectorAll('h1,h2,h3,h4,h5,h6')).map((el) =>
      Number(el.tagName[1])
    );

    // Never jump more than one level going down. This is what `baseLevel` on
    // `AuthoredBlocks` exists for: without it, a document's own `h2`s land
    // beside the page's own and the outline claims they are siblings.
    for (const [index, level] of levels.entries()) {
      if (index === 0) continue;
      expect(level - levels[index - 1]).toBeLessThanOrEqual(1);
    }
  });

  it.each(PAGES)('%s sets its own title, description and canonical', (route, _Page, meta) => {
    expect(meta.title).toBeTruthy();
    expect(meta.description).toBeTruthy();
    expect(meta.alternates?.canonical).toBe(route);
  });

  it.each(PAGES)('%s is no longer withheld from search', (_route, _Page, meta) => {
    // The three stubs carried `robots: { index: false }` while their bodies
    // were one placeholder sentence repeated. They carry her words now, and
    // leaving the flag on would keep the site's real pages out of search
    // indefinitely with nothing to say it was still there.
    expect(meta.robots).toBeUndefined();
  });

  it('gives each page a distinct heading and canonical', async () => {
    const headings: (string | undefined)[] = [];
    for (const [, Page] of PAGES) {
      const { unmount } = render(await Page());
      headings.push(screen.getByRole('heading', { level: 1 }).textContent?.trim());
      unmount();
    }

    expect(new Set(headings).size).toBe(PAGES.length);
    expect(new Set(PAGES.map(([, , meta]) => meta.alternates?.canonical)).size).toBe(PAGES.length);
  });

  it('never renders the brand name twice in a resolved title', () => {
    // The group layout's template is `%s - Lelañea`, so a page titled "Lelañea"
    // resolves to "Lelañea - Lelañea" in the tab and in search results. Only
    // `/lelanea` needs the `{ absolute }` escape; the rest read correctly.
    for (const [route, , meta] of PAGES) {
      const title = meta.title;

      let resolved: string;
      if (typeof title === 'string') {
        resolved = `${title} - Lelañea`;
      } else if (title && typeof title === 'object' && 'absolute' in title) {
        resolved = String(title.absolute);
      } else {
        throw new Error(`${route} has a title shape this check does not model`);
      }

      expect(resolved.split('Lelañea').length - 1, `${route} resolves to "${resolved}"`).toBeLessThanOrEqual(1);
    }
  });
});

describe('the database is what is read (t-86)', () => {
  // Each page renders a stored row that differs from the file. A page still
  // reading `content/` could not show these words.
  it.each([
    ['/lelanea', LelaneaPage, 'about_the_creator'],
    ['/mission', MissionPage, 'the_mission'],
    ['/disclaimer', DisclaimerPage, 'disclaimer'],
    ['/terms', TermsPage, 'terms_of_use'],
  ] as const)('%s renders the edited row of %s', async (_route, Page, id) => {
    editFirstParagraph(id, `Stored edit to ${id}.`);

    const { container } = render(await Page());

    expect(container.textContent).toContain(`Stored edit to ${id}.`);
  });

  it('/data renders the edited crisis section of the stored disclaimer', async () => {
    store.editBlocks('disclaimer', (blocks) =>
      blocks.map((block) =>
        block.section === 'crisis' && block.type === 'paragraph'
          ? { ...block, text: 'Stored edit to the crisis guidance.' }
          : block
      )
    );

    render(await DataPage());

    expect(screen.getAllByText('Stored edit to the crisis guidance.').length).toBeGreaterThan(0);
  });

  it.each([
    ['/lelanea', lelaneaDynamic],
    ['/mission', missionDynamic],
    ['/data', dataDynamic],
    ['/disclaimer', disclaimerDynamic],
    ['/terms', termsDynamic],
  ] as const)('%s renders at request time, so an edit is not frozen into a build', (_route, dynamic) => {
    expect(dynamic).toBe('force-dynamic');
  });
});

describe('/lelanea', () => {
  it('renders all three documents, each as its own section', async () => {
    render(await LelaneaPage());

    expect(screen.getByRole('heading', { level: 1, name: 'The Heart Behind Lelañea' })).toBeTruthy();
    expect(screen.getByRole('heading', { level: 2, name: 'About the Creator' })).toBeTruthy();
    expect(screen.getByRole('heading', { level: 2, name: 'The Lineage of Lelañea' })).toBeTruthy();
  });

  it("names the teachers she credits, which a chip row could not have carried", async () => {
    // The prototype ends this page with twenty name chips. Four of them are
    // attested nowhere in the authored document, and the rest exist only inside
    // sentences — so the document is rendered whole instead. This is the case
    // that says the substitution actually delivered the attributions: if the
    // lineage section were dropped or truncated, the page would still render
    // and still pass every structural check above.
    const { container } = render(await LelaneaPage());
    const text = container.textContent ?? '';

    for (const name of ['Carl Jung', 'Stephen Porges', 'Advaita Vedanta', 'Feroshia Knight']) {
      expect(text, `the lineage section is missing "${name}"`).toContain(name);
    }
  });

  it('shows a deliberate stand-in while there is no portrait', async () => {
    render(await LelaneaPage());

    // `CREATOR_PORTRAIT` is null (D3's shape). What must not happen is an
    // `<img>` with an empty or placeholder `src`, which renders as a broken
    // image on the page introducing her.
    expect(screen.queryByRole('img')).toBeNull();
    expect(screen.getByText(/portrait of Lelañea Fulton will appear here/i)).toBeTruthy();
  });
});

describe('/data', () => {
  it('lists the seven things Lelañea is not, with the emphasis intact', async () => {
    render(await DataPage());

    const items = screen.getAllByRole('listitem');
    const isNot = items.filter((item) => item.textContent?.startsWith('Lelañea is not'));

    expect(isNot).toHaveLength(7);
    // `**not**` reaches the DOM as a `<strong>`, not as literal asterisks. The
    // first version of this page stripped the markers with `replaceAll`, which
    // silently removed the author's emphasis from the one word the page is for.
    for (const item of isNot) {
      expect(within(item).getByText('not').tagName).toBe('STRONG');
    }
    expect(document.body.textContent).not.toContain('**');
  });

  it('carries the crisis guidance in full, not a summary of it', async () => {
    render(await DataPage());
    const text = document.body.textContent ?? '';

    // The three instructions the footer's old one-liner had trimmed to one.
    expect(text).toContain('stop using this application immediately');
    expect(text).toContain('nearest emergency department');
    expect(text).toContain('without delay');
    // And the conditions list, which lives in a `list` block between them.
    expect(text).toContain('thoughts of suicide');
  });

  it('keeps the qualifying paragraph out of the crossed column', async () => {
    render(await DataPage());

    const items = screen.getAllByRole('listitem').map((item) => item.textContent ?? '');

    // It is on the page — just not as an eighth thing Lelañea is not.
    expect(document.body.textContent).toContain('Although some concepts discussed within the app');
    expect(items.some((item) => item.startsWith('Although some concepts'))).toBe(false);
  });

  it('shows the GDPR rights as a footing to the cards, not as a fourth card', async () => {
    render(await DataPage());

    // Three cards, not four. The prototype's fourth ("GDPR rights") is a legal
    // standing rather than a thing you can do, and as a peer it both read as a
    // fourth feature and orphaned onto its own row at the page's own width.
    const cardTitles = ['See what is held', 'Delete any part of it', 'Export a full copy'];
    for (const title of cardTitles) {
      expect(screen.getByText(title)).toBeTruthy();
    }
    expect(screen.queryByText('GDPR rights')).toBeNull();

    // All five rights still reach the reader — the claim is unchanged, only its
    // presentation. Asserted by name, because "the strip renders" would pass on
    // a strip that had quietly lost two of them.
    for (const right of [
      'Access',
      'Rectification',
      'Erasure',
      'Portability',
      'Restriction of processing',
    ]) {
      expect(screen.getByText(right)).toBeTruthy();
    }
  });

  it('separates the rights visually without putting the separator in the text', async () => {
    // The middots are `::after` content, so the list semantics carry the
    // separation for a screen reader. A middot typed between the items would be
    // announced — "Access middot Rectification" — and would also break the
    // by-name assertions above.
    render(await DataPage());

    expect(document.body.textContent).not.toContain('·');
  });

  it('links to the full disclosures rather than claiming to be them', async () => {
    render(await DataPage());

    const link = screen.getByRole('link', { name: /full disclosures/i });
    expect(link.getAttribute('href')).toBe('/disclaimer');
  });
});

describe('/terms and /disclaimer', () => {
  it('/terms renders the Terms of Use, not the starter placeholder', async () => {
    render(await TermsPage());
    const text = document.body.textContent ?? '';

    expect(text).not.toContain('placeholder');
    expect(text).toContain('Effective Date:');
    expect(text).toContain('Eligibility');
  });

  it('/terms marks its unfilled placeholders outside production', async () => {
    // D8. `[Month Day, Year]` and `[Support Email]` are launch blockers, and the
    // renderer highlights them everywhere except production. Vitest is not
    // production, so they must be marked here — and the attribute is what the
    // build-time reader is meant to see.
    const { container } = render(await TermsPage());

    const marked = Array.from(container.querySelectorAll('[data-unresolved-placeholder]')).map(
      (el) => el.getAttribute('data-unresolved-placeholder')
    );

    expect(marked).toContain('[Month Day, Year]');
    expect(marked).toContain('[Support Email]');
  });

  it('/disclaimer renders the whole document, including what /data leaves out', async () => {
    render(await DisclaimerPage());
    const text = document.body.textContent ?? '';

    // `/data` lifts four sections. These three are the ones it does not, and
    // they are why the full page exists rather than being a duplicate of it.
    expect(text).toContain('Mental Health Conditions');
    expect(text).toContain('Spiritual Perspectives');
    expect(text).toContain('Personal Responsibility');
  });
});
