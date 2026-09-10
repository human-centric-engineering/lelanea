/**
 * The social preview card (t-5).
 *
 * A broken OG image is invisible from inside the app: nothing renders it, no
 * page links to it, and the first anyone hears is a link posted somewhere that
 * unfurls as a grey box. The two things that can break it are both silent — the
 * lotus file not being where the route reads it from, and the exported metadata
 * disagreeing with what is actually drawn.
 *
 * The route is exercised for real rather than mocked, so a Satori failure (an
 * unsupported style, a bad data URI) fails here rather than on Twitter.
 */

import { describe, it, expect } from 'vitest';
import { existsSync, readFileSync } from 'node:fs';
import path from 'node:path';

import OpengraphImage, { alt, size, contentType, OG_COLORS } from '@/app/opengraph-image';
import { metadata as rootMetadata } from '@/app/layout';

describe('app/opengraph-image', () => {
  it('declares the metadata Next writes into the <head>', () => {
    expect(contentType).toBe('image/png');
    expect(size).toEqual({ width: 1200, height: 630 });
    expect(alt.length).toBeGreaterThan(10);
  });

  it('uses the 1.91:1 ratio the platforms crop to', () => {
    // 1200x630 is the documented Open Graph size. A square or a 16:9 card gets
    // cropped, usually through the wordmark.
    expect(size.width / size.height).toBeCloseTo(1.91, 1);
  });

  it('reads the lotus from public/, where a deployed build can reach it', () => {
    // The route reads this path at render. `.context/` — where the design kit
    // keeps the original — is documentation and is not guaranteed to ship.
    expect(existsSync(path.join(process.cwd(), 'public', 'lotus-mark.svg'))).toBe(true);
  });

  describe('the palette', () => {
    // Satori resolves no CSS variables, so this file holds the only written-out
    // brand colours in the app. That is a drift surface with nothing watching
    // it — `tokens-only.test.ts` scans `components/app/ui/` and never sees this
    // file. The first version invented `#F7F3EE` for the ground and labelled
    // `--color-foreground` as `--color-heading`; the card simply did not match
    // the site, and no check said so.
    const stylesheet = readFileSync(path.join(process.cwd(), 'app', 'brand-theme.css'), 'utf8');

    /** The light-mode value of a token, read from the stylesheet's first block. */
    function lightToken(name: string): string {
      const match = stylesheet.match(new RegExp(`--${name}:\\s*(#[0-9a-fA-F]{3,8})`));
      if (!match) throw new Error(`--${name} not found as a hex value in app/brand-theme.css`);
      return match[1].toLowerCase();
    }

    it.each([
      ['background', 'color-background'],
      ['heading', 'color-heading'],
      ['mutedForeground', 'color-muted-foreground'],
    ])('uses the real --%s token value', (key, token) => {
      expect(OG_COLORS[key as keyof typeof OG_COLORS].toLowerCase()).toBe(lightToken(token));
    });

    it('reads real values from the stylesheet, so the comparison is not vacuous', () => {
      // If `lightToken` silently returned '' the cases above would compare two
      // empty strings and pass.
      expect(lightToken('color-background')).toMatch(/^#[0-9a-f]{3,8}$/);
      expect(lightToken('color-heading')).not.toBe(lightToken('color-background'));
    });
  });

  describe('the URL the card is served from', () => {
    // Rendering the image proves the route works. It says NOTHING about the
    // `og:image` URL Next writes into the <head>, and that is the half that
    // actually breaks: with no `metadataBase`, Next resolves a relative
    // `og:image` against VERCEL_URL → VERCEL_PROJECT_PRODUCTION_URL →
    // `http://localhost:3000`. This app deploys via Docker, so all three
    // Vercel variables are absent and every shared link unfurls against
    // localhost. Nothing throws, no test fails, and it is invisible from
    // inside the app — the first anyone hears is a grey box in Slack.
    it('declares a metadataBase, so og:image resolves to an absolute URL', () => {
      expect(rootMetadata.metadataBase).toBeInstanceOf(URL);
    });

    it('does not fall back to localhost when an app URL is configured', () => {
      const base = rootMetadata.metadataBase as URL;

      if (process.env.NEXT_PUBLIC_APP_URL) {
        expect(base.origin).toBe(new URL(process.env.NEXT_PUBLIC_APP_URL).origin);
      } else {
        // No app URL configured in this environment, so localhost IS correct
        // here — what must hold is that the value tracks the variable rather
        // than being hardcoded. Which inputs produce which output is exercised
        // properly in `tests/unit/lib/site/metadata-base.test.ts`; this only
        // checks the layout is wired to that resolver.
        expect(base.origin).toBe('http://localhost:3000');
      }
    });
  });

  it('renders a PNG of the declared size', async () => {
    const response = await OpengraphImage();

    expect(response.headers.get('content-type')).toBe('image/png');

    const bytes = new Uint8Array(await response.arrayBuffer());
    expect(bytes.byteLength).toBeGreaterThan(1000);

    // PNG magic number — proof it is an image rather than an error page that
    // happened to come back with a 200.
    expect([...bytes.slice(0, 4)]).toEqual([0x89, 0x50, 0x4e, 0x47]);

    // IHDR carries the dimensions at a fixed offset; this is what catches the
    // `size` export drifting away from what is actually drawn.
    const view = new DataView(bytes.buffer, bytes.byteOffset);
    expect(view.getUint32(16)).toBe(size.width);
    expect(view.getUint32(20)).toBe(size.height);
  }, 30_000);
});
