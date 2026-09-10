import { ImageResponse } from 'next/og';
import { readFile } from 'node:fs/promises';
import { join } from 'node:path';

import { BRAND } from '@/lib/brand';

export const alt = 'Lelañea — an invitation into conscious living';
export const size = { width: 1200, height: 630 };
export const contentType = 'image/png';

/**
 * The social preview card, for every route that does not set its own.
 *
 * ## The lotus is read from `public/`, not from the design kit
 *
 * `.context/` is documentation and there is no promise it reaches a deployed
 * build; `public/` is the directory that exists to be served. So the mark is a
 * copy that lives with the app. It is read at render rather than imported
 * because Satori takes an image SOURCE, and a data URI is the one form that
 * needs no second network fetch from inside the renderer.
 *
 * ## The type is not the brand serif, and that is a known gap
 *
 * The three faces come from `next/font/google`, which resolves them into the
 * build output rather than into a path this file could read. Satori only uses
 * fonts handed to it, so the wordmark below renders in the renderer's bundled
 * face. Closing this properly means vendoring an Instrument Serif `.ttf` into
 * the repo — the licence (OFL) permits it, but adding a binary font asset is a
 * deliberate call rather than something to slip into this task. The card is
 * correct in palette, mark and words meanwhile.
 *
 * Everything else is the brand: the oyster ground, the ink, and the lotus.
 *
 * ## The three colours are the light-mode token VALUES, copied by hand
 *
 * Satori resolves no CSS variables — there is no stylesheet in this renderer —
 * so `var(--color-background)` would render as nothing. The literals below are
 * therefore the only place in the app where a brand colour is written out, and
 * they are exported so a test can compare them against
 * `app/brand-theme.css` rather than trusting a comment. The first version of
 * this file claimed to track the tokens and did not: the ground was an invented
 * `#F7F3EE`, and the ink was `--color-foreground` under a comment saying
 * `--color-heading`.
 */

/**
 * `:root` values from `app/brand-theme.css`, light mode. Pinned by
 * `tests/unit/app/opengraph-image.test.tsx`, which parses the stylesheet — so
 * a palette change fails there rather than shipping a card that no longer
 * matches the site.
 */
export const OG_COLORS = {
  background: '#f3f0ec',
  heading: '#11181a',
  mutedForeground: '#5a5f62',
} as const;
export default async function OpengraphImage() {
  const lotus = await readFile(join(process.cwd(), 'public', 'lotus-mark.svg'));
  const lotusSrc = `data:image/svg+xml;base64,${lotus.toString('base64')}`;

  return new ImageResponse(
    <div
      style={{
        width: '100%',
        height: '100%',
        display: 'flex',
        flexDirection: 'column',
        alignItems: 'center',
        justifyContent: 'center',
        gap: 24,
        backgroundColor: OG_COLORS.background,
        color: OG_COLORS.heading,
      }}
    >
      {/* A bare <img> is what Satori renders; next/image does not exist
            inside ImageResponse. Decorative — the name is the next element. */}
      <img src={lotusSrc} alt="" width={300} height={194} />
      <div style={{ fontSize: 76, letterSpacing: -1 }}>{BRAND.name}</div>
      <div style={{ fontSize: 30, color: OG_COLORS.mutedForeground, letterSpacing: 4 }}>
        transcendental coaching, at your own pace
      </div>
    </div>,
    size
  );
}
