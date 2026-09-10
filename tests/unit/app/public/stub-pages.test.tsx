// @vitest-environment happy-dom

/**
 * `/lelanea`, `/mission` and `/data` while their words are still being written
 * (t-5).
 *
 * These three are B31 deliberate stubs. They exist because the site frame this
 * task ships links to them from both the header and the footer, and the design
 * keeps those links — a route that 404s is a worse answer than a page that says
 * the copy is coming. t-6 replaces each file whole.
 *
 * What is worth pinning while that is true:
 *
 * - Each renders something, so a nav link never lands on a blank page.
 * - Each is DISTINCT. Three files written from one template is exactly the
 *   shape that ships with a copy-paste left in — the same `h1` on all three,
 *   or `/data` titled "The mission" — and nothing else in the tree compares
 *   them to each other.
 * - Each says it is unfinished. A placeholder that reads like finished copy is
 *   how a stub survives into production.
 *
 * When t-6 lands, the first two cases should still pass against the real pages;
 * the third is the one that must be deleted deliberately.
 */

import { describe, it, expect } from 'vitest';
import { render, screen } from '@testing-library/react';

import LelaneaPage, { metadata as lelaneaMeta } from '@/app/(public)/lelanea/page';
import MissionPage, { metadata as missionMeta } from '@/app/(public)/mission/page';
import DataPage, { metadata as dataMeta } from '@/app/(public)/data/page';

const PAGES = [
  ['/lelanea', LelaneaPage, lelaneaMeta] as const,
  ['/mission', MissionPage, missionMeta] as const,
  ['/data', DataPage, dataMeta] as const,
];

describe('the placeholder public pages', () => {
  it.each(PAGES)('%s renders a heading and a body', (_route, Page) => {
    render(<Page />);

    const heading = screen.getByRole('heading', { level: 1 });
    expect(heading.textContent?.trim().length).toBeGreaterThan(10);
  });

  it.each(PAGES)('%s says it is not finished yet', (_route, Page) => {
    render(<Page />);

    expect(screen.getByText(/being written/i)).toBeTruthy();
  });

  it.each(PAGES)('%s sets its own title and canonical', (route, _Page, meta) => {
    expect(meta.title).toBeTruthy();
    expect(meta.description).toBeTruthy();
    expect(meta.alternates?.canonical).toBe(route);
  });

  it('gives each page a different heading and title', () => {
    const headings = PAGES.map(([, Page]) => {
      const { unmount } = render(<Page />);
      const text = screen.getByRole('heading', { level: 1 }).textContent?.trim();
      unmount();
      return text;
    });

    expect(new Set(headings).size).toBe(PAGES.length);

    const titles = PAGES.map(([, , meta]) => meta.title);
    expect(new Set(titles).size).toBe(PAGES.length);
  });

  it('never renders the brand name twice in a resolved title', () => {
    // The group layout's template is `%s - Lelañea`. A stub titled 'Lelañea'
    // resolves to "Lelañea - Lelañea" in the tab and in search results, which
    // is why that one page opts out with `{ absolute }`. Nothing else in the
    // tree checks these three.
    for (const [route, , meta] of PAGES) {
      const title = meta.title;

      // `Metadata['title']` is a union: a bare string goes through the group
      // template, an `{ absolute }` object opts out of it. Narrowed rather
      // than stringified, so a `{ template }` or `{ default }` form added
      // later fails the type-check here instead of resolving to
      // "[object Object]" and passing.
      let resolved: string;
      if (typeof title === 'string') {
        resolved = `${title} - Lelañea`;
      } else if (title && typeof title === 'object' && 'absolute' in title) {
        resolved = String(title.absolute);
      } else {
        throw new Error(`${route} has a title shape this check does not model`);
      }

      const occurrences = resolved.split('Lelañea').length - 1;
      expect(occurrences, `${route} resolves to "${resolved}"`).toBeLessThanOrEqual(1);
    }
  });

  it('gives each page a canonical matching its own route', () => {
    // The copy-paste this catches: three files from one template, one of which
    // kept the template's canonical and now tells crawlers it is a duplicate of
    // a page it is not.
    const canonicals = PAGES.map(([, , meta]) => meta.alternates?.canonical);
    expect(new Set(canonicals).size).toBe(PAGES.length);
  });
});
