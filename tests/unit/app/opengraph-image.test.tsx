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
import { existsSync } from 'node:fs';
import path from 'node:path';

import OpengraphImage, { alt, size, contentType } from '@/app/opengraph-image';

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
