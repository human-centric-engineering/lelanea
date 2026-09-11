// @vitest-environment happy-dom

/**
 * Every destination the nav offers is a real route now, and this is what says so.
 *
 * ## What it replaces, and why the old shape stopped working
 *
 * t-9 answered all eight destinations with one `[...slug]` catch-all, and
 * `shell-placeholder-page.test.tsx` called that component directly. Once each
 * destination had a page of its own, that test would have gone on passing
 * forever while testing a module the router could no longer reach — a real
 * route beats a catch-all, so nothing would have hit it again. The catch-all is
 * deleted; this asks the same two questions of the routes that replaced it.
 *
 * The list is derived from `SHELL_NAV`, so a destination added to the nav
 * without a page fails here rather than in someone's browser. `MODULES` is
 * written out rather than globbed because a module has to be imported by a
 * literal path to be resolved — and the row below pins the two lists together,
 * so a new nav item fails until it has one.
 *
 * ## It reads the tree, and it is still not an always-run test
 *
 * `scripts/ci/scoped-tests.ts` flags this file as reading from the repo root
 * and asks whether it belongs in `ALWAYS_RUN_TESTS`. It does not. That list is
 * for invariants NO import chain reaches, and every input here is imported:
 * `SHELL_NAV` and all seven page modules. A nav item added without a page
 * changes `nav-items.ts`; a page changed changes the page. The two `existsSync`
 * calls confirm what those imports already imply — that the module the router
 * will load sits at the path the router looks in — rather than being the
 * test's actual trigger.
 *
 * @see components/app/shell/nav-items.ts
 */

import { render, screen } from '@testing-library/react';
import { existsSync } from 'node:fs';
import path from 'node:path';
import { describe, expect, it } from 'vitest';

import { isNavItem, SHELL_NAV } from '@/components/app/shell/nav-items';
import { ThemeProvider } from '@/hooks/use-theme';

import JourneyPage, { metadata as journeyMeta } from '@/app/(lelanea)/app/journey/page';
import SettingsPage, { metadata as settingsMeta } from '@/app/(lelanea)/app/settings/page';
import SharePage, { metadata as shareMeta } from '@/app/(lelanea)/app/share/page';
import SituationsPage, { metadata as situationsMeta } from '@/app/(lelanea)/app/situations/page';
import UsagePage, { metadata as usageMeta } from '@/app/(lelanea)/app/usage/page';
import WorkspacePage, { metadata as workspaceMeta } from '@/app/(lelanea)/app/workspace/page';
import { metadata as accountMeta } from '@/app/(lelanea)/app/account/page';

/** Every destination the nav offers, other than the shell root, plus account. */
const OFFERED = [
  ...SHELL_NAV.filter(isNavItem)
    .map((item) => item.href)
    .filter((href) => href !== '/app'),
  '/app/account',
];

/** The name the nav (or the account footer) calls each one. */
const LABELS: Record<string, string> = {
  ...Object.fromEntries(SHELL_NAV.filter(isNavItem).map((item) => [item.href, item.label])),
  '/app/account': 'Your account',
};

const MODULES = {
  '/app/workspace': { Page: WorkspacePage, metadata: workspaceMeta, placeholder: true },
  '/app/journey': { Page: JourneyPage, metadata: journeyMeta, placeholder: true },
  '/app/situations': { Page: SituationsPage, metadata: situationsMeta, placeholder: true },
  '/app/share': { Page: SharePage, metadata: shareMeta, placeholder: true },
  '/app/usage': { Page: UsagePage, metadata: usageMeta, placeholder: true },
  '/app/settings': { Page: SettingsPage, metadata: settingsMeta, placeholder: false },
  // Account is async and reads the session, so it is rendered in
  // `shell-account-page.test.tsx` where the session can be stood up. Its
  // metadata is still checked here, with everything else's.
  '/app/account': { Page: null, metadata: accountMeta, placeholder: false },
} as const;

describe('every destination the nav offers is a route', () => {
  it('has a module for each, so a new nav item cannot slip through', () => {
    expect(Object.keys(MODULES).sort()).toEqual([...OFFERED].sort());
  });

  it.each(OFFERED)('%s has a page file at its own path', (href) => {
    // Not just an importable module: the FILE has to sit where the router looks
    // for it, which an alias in this test could otherwise paper over.
    const segment = href.replace(/^\/app/, '');
    expect(
      existsSync(path.join(process.cwd(), 'app', '(lelanea)', 'app', segment, 'page.tsx'))
    ).toBe(true);
  });

  it('has no catch-all left behind it', () => {
    // Once every destination is real, `[...slug]` answers nothing. A route
    // nobody can reach is a route nobody maintains, and it would quietly
    // shadow-document a set of destinations that had moved on.
    expect(existsSync(path.join(process.cwd(), 'app', '(lelanea)', 'app', '[...slug]'))).toBe(
      false
    );
  });
});

describe('every destination names itself in the tab', () => {
  it.each(OFFERED)('%s uses the words the reader clicked', (href) => {
    const { metadata } = MODULES[href as keyof typeof MODULES];
    // `Metadata['title']` also admits `{ absolute }` / `{ template }` objects,
    // and either would defeat the layout's `%s` template. Assert the plain
    // string, so the wrong SHAPE fails here too.
    expect(typeof metadata.title).toBe('string');
    expect(metadata.title).toBe(LABELS[href]);
  });

  it('gives each one a title of its own, so history can tell them apart', () => {
    const titles = OFFERED.map((href) => MODULES[href as keyof typeof MODULES].metadata.title);
    expect(new Set(titles).size).toBe(OFFERED.length);
  });
});

/** Renders a page, wrapping the one that needs a provider. */
function renderPage(href: string) {
  const { Page } = MODULES[href as keyof typeof MODULES];
  if (!Page) throw new Error(`${href} is rendered elsewhere`);
  const element = <Page />;
  return render(href === '/app/settings' ? <ThemeProvider>{element}</ThemeProvider> : element);
}

const RENDERED = OFFERED.filter((href) => MODULES[href as keyof typeof MODULES].Page !== null);

describe('every destination arrives with an eyebrow and a title', () => {
  it.each(RENDERED)('%s has both', (href) => {
    renderPage(href);
    // The pairing IS the shell's promise that a destination is a real place.
    expect(screen.getByRole('heading', { level: 1 }).textContent?.trim()).toBeTruthy();
    expect(screen.getByRole('main').querySelector('p')?.textContent?.trim()).toBeTruthy();
  });

  it('uses the prototype’s own words where it has them', () => {
    renderPage('/app/situations');
    expect(screen.getByText('life situations')).toBeTruthy();
    expect(screen.getByRole('heading', { level: 1 }).textContent).toBe(
      'What you are living through'
    );
  });
});

const PLACEHOLDERS = OFFERED.filter((href) => MODULES[href as keyof typeof MODULES].placeholder);

describe('the destinations that are not built yet say so', () => {
  it.each(PLACEHOLDERS)('%s is tagged as unbuilt', (href) => {
    renderPage(href);
    expect(screen.getByText('not built yet')).toBeTruthy();
  });

  it.each(PLACEHOLDERS)('%s invents no numbers', (href) => {
    // The rule D6 is actually about. Usage and billing is the one most likely
    // to grow a fake total, and journey the one most likely to grow a count of
    // sessions nobody has had.
    const { container } = renderPage(href);
    expect(container.textContent ?? '').not.toMatch(/\d/);
  });
});
