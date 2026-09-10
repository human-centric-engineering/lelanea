// @vitest-environment happy-dom

/**
 * The placeholder catch-all — the route that stops the nav being eight dead
 * links between this task and t-11.
 *
 * The defect it closes was invisible to every test that existed: the nav
 * rendered seven destinations and an account link, only `/app` had a page, and
 * `shell-routing.test.ts`'s "points at pages a signed-in user can actually
 * reach" asserted only that the proxy did not bounce — which is equally true of
 * a 404. So the two properties worth pinning are that every offered destination
 * resolves, and that nothing ELSE does: a catch-all that swallowed every URL
 * under `/app` would turn every typo and stale link into a page that looks
 * deliberate.
 *
 * @see app/(lelanea)/app/[...slug]/page.tsx
 */

import { render, screen } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';

const notFound = vi.hoisted(() =>
  vi.fn(() => {
    throw new Error('NEXT_NOT_FOUND');
  })
);
vi.mock('next/navigation', () => ({ notFound }));

import ShellPlaceholderPage, { generateMetadata } from '@/app/(lelanea)/app/[...slug]/page';
import { isNavItem, SHELL_NAV } from '@/components/app/shell/nav-items';

async function renderAt(pathname: string) {
  const slug = pathname.replace(/^\/app\//, '').split('/');
  return render(await ShellPlaceholderPage({ params: Promise.resolve({ slug }) }));
}

/** Every destination the nav offers, other than the shell root. */
const OFFERED = [
  ...SHELL_NAV.filter(isNavItem)
    .map((item) => item.href)
    .filter((href) => href !== '/app'),
  '/app/account',
];

describe('every destination the nav offers resolves', () => {
  it('covers all of them, so none is a dead link', async () => {
    // Derived from `SHELL_NAV` rather than hardcoded: a destination added to
    // the nav without a page fails here rather than in someone's browser.
    for (const href of OFFERED) {
      notFound.mockClear();
      await renderAt(href);
      expect(notFound, `${href} has no destination`).not.toHaveBeenCalled();
    }
  });

  it('names the destination the reader clicked', async () => {
    await renderAt('/app/situations');
    expect(screen.getByText('Life situations')).toBeTruthy();
    expect(screen.getByText(/What you are living through/)).toBeTruthy();
  });

  it('says plainly that it is not built yet', async () => {
    await renderAt('/app/journey');
    expect(screen.getByText(/still being built/)).toBeTruthy();
  });

  it('handles the account link, which is not in SHELL_NAV', async () => {
    await renderAt('/app/account');
    expect(screen.getByText('Your account')).toBeTruthy();
  });

  it('invents nothing', async () => {
    const { container } = await renderAt('/app/usage');
    // Usage and billing is the one most likely to grow a fake number.
    expect(container.textContent ?? '').not.toMatch(/\d/);
  });
});

describe('every destination names itself in the tab', () => {
  it('gives each one its own title', async () => {
    // Without a page-level title the layout's `%s` template never fires, so all
    // eight destinations shared one tab label and browser history could not
    // tell them apart. Derived from `SHELL_NAV`, so this covers a destination
    // added later too.
    const seen = new Set<string>();
    for (const href of OFFERED) {
      const slug = href.replace(/^\/app\//, '').split('/');
      const meta = await generateMetadata({ params: Promise.resolve({ slug }) });
      // `Metadata['title']` also admits `{ absolute }` / `{ template }` objects,
      // and either would defeat the layout's `%s` template. Assert the plain
      // string rather than coercing, so the wrong SHAPE fails here too.
      expect(typeof meta.title, `${href} has no plain-string title`).toBe('string');
      seen.add(meta.title as string);
    }
    expect(seen.size).toBe(OFFERED.length);
  });

  it('uses the same words as the nav item that led here', async () => {
    const meta = await generateMetadata({
      params: Promise.resolve({ slug: ['situations'] }),
    });
    expect(meta.title).toBe('Life situations');
  });

  it('leaves the title to the layout on a path that 404s', async () => {
    const meta = await generateMetadata({ params: Promise.resolve({ slug: ['nonsense'] }) });
    expect(meta.title).toBeUndefined();
  });
});

describe('nothing else resolves', () => {
  it.each(['/app/nonsense', '/app/journey/deeper', '/app/admin'])(
    '404s on %s rather than looking deliberate',
    async (pathname) => {
      await expect(renderAt(pathname)).rejects.toThrow('NEXT_NOT_FOUND');
    }
  );
});
