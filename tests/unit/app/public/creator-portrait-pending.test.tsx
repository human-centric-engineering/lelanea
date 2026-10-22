// @vitest-environment happy-dom

/**
 * `/lelanea` while there is no portrait of Lelañea Fulton.
 *
 * The other half of `creator-portrait.test.tsx`. Until t-171 this case lived
 * in `document-pages.test.tsx`, which could exercise it only because the real
 * `CREATOR_PORTRAIT` was null; the constant now carries a photograph, so the
 * stand-in is pinned here by mocking it back to null. Its own file for the
 * reason that one gives: a top-level `vi.mock` applies to every case in a file.
 */

import { describe, expect, it, vi } from 'vitest';

vi.mock('@/lib/app/content/document-store', async () =>
  (await import('@/tests/helpers/app/foundational-documents')).fakeDocumentStore()
);
import { render, screen } from '@testing-library/react';

vi.mock('@/lib/site/config', async (importOriginal) => ({
  ...(await importOriginal<typeof import('@/lib/site/config')>()),
  CREATOR_PORTRAIT: null,
}));

describe('/lelanea without a portrait', () => {
  it('shows a deliberate stand-in, never a broken image', async () => {
    const { default: LelaneaPage } = await import('@/app/(public)/lelanea/page');
    render(await LelaneaPage());

    // The arch holds the site's water, which is decorative (`alt=""`) and so
    // has no `img` role. What must not happen is an image that claims to be
    // her, or one with an empty or placeholder `src`.
    expect(screen.queryByRole('img', { name: /Lelañea/ })).toBeNull();
    expect(screen.getByText(/portrait of Lelañea Fulton will appear here/i)).toBeTruthy();
  });
});
