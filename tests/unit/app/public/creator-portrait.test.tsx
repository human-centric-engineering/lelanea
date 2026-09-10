// @vitest-environment happy-dom

/**
 * `/lelanea` when a portrait of Lelañea Fulton exists.
 *
 * `CREATOR_PORTRAIT` is `null` in the tree, so `document-pages.test.tsx` can
 * only ever exercise the stand-in. This file mocks the config to prove the
 * other half — and it is the half that matters, because it is the one nobody
 * will look at again until the day the photograph lands, when a mistake in it
 * ships as a broken image on the page introducing her.
 *
 * A separate file rather than a case in the other one: the constant is read at
 * render time from a module, so a `vi.mock` at the top of a shared file would
 * apply to the stand-in case too and quietly delete the coverage it has.
 *
 * FORK NOTE: this reads no `lib/app/*` seam — `lib/site/config.ts` is Lelañea's
 * own, born full, and is mocked here rather than read. A fork with no creator
 * portrait should delete this file along with the page section it covers.
 */

import { describe, expect, it, vi } from 'vitest';
import { render, screen } from '@testing-library/react';

vi.mock('@/lib/site/config', async (importOriginal) => ({
  // Spread the real module so `SITE_NAV`, `LAUNCH_WINDOW` and the rest keep
  // their values — the page imports one constant, but anything it pulls in
  // transitively must not become undefined.
  ...(await importOriginal<typeof import('@/lib/site/config')>()),
  CREATOR_PORTRAIT: '/lelanea/creator.jpg',
}));

describe('/lelanea with a portrait', () => {
  it('renders the photograph instead of the stand-in', async () => {
    const { default: LelaneaPage } = await import('@/app/(public)/lelanea/page');
    render(<LelaneaPage />);

    const portrait = screen.getByRole('img', { name: 'Lelañea Fulton' });

    // `next/image` rewrites `src` through its loader, so the assertion is that
    // the configured path is in there — not that it is the whole attribute.
    expect(portrait.getAttribute('src')).toContain('creator.jpg');
    expect(screen.queryByText(/portrait of Lelañea Fulton will appear here/i)).toBeNull();
  });

  it('names her in the alt text rather than describing the photograph', () => {
    // The image IS her, on the page about her, so the alt text is her name.
    // "Portrait of a woman smiling" would be a description of a picture where
    // an identification is wanted.
    expect(screen.queryByRole('img', { name: /photo|portrait of a/i })).toBeNull();
  });
});
