/**
 * The baked lotus — every still copy of the mark — is what the model and the
 * tokens produce TODAY. Retinting a `--color-lotus-*` token or changing the
 * model without re-running `npm run lotus:assets` fails here, rather than
 * shipping a site whose marks, favicon and social card are a different flower
 * from the one that opens.
 *
 * @see scripts/app/lotus-assets.tsx
 */
import { existsSync, readFileSync } from 'node:fs';
import path from 'node:path';

import { describe, expect, it } from 'vitest';

import { emailLotusSize } from '@/components/app/ui/lotus-sizes';
import { lightTokens, lotusAssets, lotusFramesSource } from '@/scripts/app/lotus-assets';

const root = process.cwd();
const stylesheet = readFileSync(path.join(root, 'app', 'brand-theme.css'), 'utf8');
const assets = lotusAssets(stylesheet);

const read = (file: string) => readFileSync(path.join(root, file), 'utf8');

/** Width and height from a PNG's IHDR chunk. */
function pngSize(file: string) {
  const buf = readFileSync(path.join(root, file));
  return { width: buf.readUInt32BE(16), height: buf.readUInt32BE(20) };
}

describe('the baked lotus', () => {
  it.each([
    'public/lotus-mark.svg',
    'public/lotus-bloom.svg',
    'public/lotus-glyph.svg',
    'public/lotus-anim-bud.svg',
    'public/lotus-anim-bud-water.svg',
    'public/lotus-anim-open.svg',
    'public/lotus-anim-open-water.svg',
    'app/icon.svg',
  ] as const)('%s is up to date — run `npm run lotus:assets`', (file) => {
    expect(read(file)).toBe(assets[file]);
  });

  it('components/app/ui/lotus-frames.ts is the measured frames — run `npm run lotus:assets`', () => {
    expect(read('components/app/ui/lotus-frames.ts')).toBe(lotusFramesSource());
  });

  it('keeps the Sunrise-owned app/favicon.ico as our 16/32/48 lotus (divergence row 13)', () => {
    // Upstream's is a different ICO; ours is the three PNG entries the
    // generator writes. ICONDIR: count at 4, then 16-byte entries from 6.
    const buf = readFileSync(path.join(root, 'app', 'favicon.ico'));
    const count = buf.readUInt16LE(4);
    const sizes = Array.from({ length: count }, (_, i) => buf[6 + i * 16]);
    expect(sizes).toEqual([16, 32, 48]);
    expect(buf.subarray(buf.readUInt32LE(6 + 12), buf.readUInt32LE(6 + 12) + 4)).toEqual(
      Buffer.from([0x89, 0x50, 0x4e, 0x47])
    );
  });

  it('leaves no favicon in public/, which would clash with the app/ icons', () => {
    expect(existsSync(path.join(root, 'public', 'favicon.ico'))).toBe(false);
    expect(existsSync(path.join(root, 'public', 'favicon.svg'))).toBe(false);
  });

  it('bakes literal colours, which a favicon, Satori and email can all read', () => {
    for (const svg of Object.values(assets)) {
      expect(svg).not.toContain('var(');
      expect(svg).not.toContain('color-mix');
    }
  });

  it('bakes the colours from the tokens, so retinting one moves the mark', () => {
    const retinted = stylesheet.replace(
      /--color-lotus-petal-outer:\s*#[0-9a-f]+;/i,
      '--color-lotus-petal-outer: #ff0000;'
    );
    expect(retinted).not.toBe(stylesheet);
    expect(lotusAssets(retinted)['public/lotus-mark.svg']).not.toBe(
      assets['public/lotus-mark.svg']
    );
  });

  it('refuses to bake when a lotus token is missing, rather than baking black', () => {
    const without = stylesheet.replace(/--color-lotus-pad:[^;]+;/, '');
    expect(() => lotusAssets(without)).toThrow(/--color-lotus-pad is not a colour/);
  });

  it('refuses to bake the apple icon without the ground it sits on', () => {
    const without = stylesheet.replaceAll(/--color-background:[^;]+;/g, '');
    expect(() => lotusAssets(without)).toThrow(/--color-background missing/);
  });

  it('reads the light value of each token, which comes first in the file', () => {
    const tokens = lightTokens(stylesheet);
    expect(tokens.get('--color-lotus-petal-outer')).toBe('#17718a');
    expect(tokens.get('--color-lotus-pad')).toMatch(/^#[0-9a-f]{6}$/);
  });

  it('rasterises the email header at twice its display size', () => {
    const shown = emailLotusSize();
    const png = pngSize('public/lotus-mark.png');
    expect(Math.abs(png.width - shown.width * 2)).toBeLessThanOrEqual(1);
    expect(Math.abs(png.height - shown.height * 2)).toBeLessThanOrEqual(1);
  });

  it('rasterises the apple touch icon at 180 × 180', () => {
    expect(pngSize('app/apple-icon.png')).toEqual({ width: 180, height: 180 });
  });
});
