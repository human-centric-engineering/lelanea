/**
 * Bake the lotus's still assets from the model (t-134).
 *
 *   npm run lotus:assets
 *
 * Writes the three still marks `LotusMark` shows (`public/lotus-mark.svg` —
 * also the social card — `lotus-bloom.svg`, `lotus-glyph.svg`), the email
 * header `public/lotus-mark.png`, the favicon `app/icon.svg` (and its copies
 * `public/favicon.{svg,ico}` — divergence row 13) and `app/apple-icon.png`. Run it
 * after changing the lotus model or any `--color-lotus-*` token; the unit test
 * on `scripts/app/lotus-assets.tsx` fails until the SVGs are regenerated.
 */
import { readFileSync, writeFileSync } from 'node:fs';
import path from 'node:path';

import sharp from 'sharp';

import { lotusAssets, lotusFramesSource } from '@/scripts/app/lotus-assets';

/** An ICO container holding PNG images — every browser since IE9 reads it. */
function ico(sizes: number[], pngs: Buffer[]): Buffer {
  const header = Buffer.alloc(6);
  header.writeUInt16LE(0, 0);
  header.writeUInt16LE(1, 2); // icon
  header.writeUInt16LE(pngs.length, 4);
  let offset = 6 + 16 * pngs.length;
  const entries = pngs.map((png, i) => {
    const entry = Buffer.alloc(16);
    entry.writeUInt8(sizes[i] % 256, 0);
    entry.writeUInt8(sizes[i] % 256, 1);
    entry.writeUInt16LE(1, 4); // colour planes
    entry.writeUInt16LE(32, 6); // bits per pixel
    entry.writeUInt32LE(png.length, 8);
    entry.writeUInt32LE(offset, 12);
    offset += png.length;
    return entry;
  });
  return Buffer.concat([header, ...entries, ...pngs]);
}

async function main() {
  const root = process.cwd();
  // Frames first: the assets below are sized from them.
  writeFileSync(path.join(root, 'components/app/ui/lotus-frames.ts'), lotusFramesSource());
  const assets = lotusAssets(readFileSync(path.join(root, 'app', 'brand-theme.css'), 'utf8'));

  for (const file of [
    'public/lotus-mark.svg',
    'public/lotus-bloom.svg',
    'public/lotus-glyph.svg',
  ] as const) {
    writeFileSync(path.join(root, file), assets[file]);
  }
  writeFileSync(path.join(root, 'app', 'icon.svg'), assets['app/icon.svg']);
  // Divergence row 13: the Sunrise-owned favicons carry the same glyph.
  writeFileSync(path.join(root, 'public', 'favicon.svg'), assets['app/icon.svg']);
  const sizes = [16, 32, 48];
  const pngs = await Promise.all(
    sizes.map((size) =>
      sharp(Buffer.from(assets['app/icon.svg']), { density: 300 })
        .resize(size, size)
        .png()
        .toBuffer()
    )
  );
  writeFileSync(path.join(root, 'public', 'favicon.ico'), ico(sizes, pngs));

  await sharp(Buffer.from(assets['email-lotus.svg']))
    .png({ compressionLevel: 9 })
    .toFile(path.join(root, 'public', 'lotus-mark.png'));
  await sharp(Buffer.from(assets['apple-icon.svg']), { density: 144 })
    .resize(180, 180)
    .flatten()
    .png({ compressionLevel: 9 })
    .toFile(path.join(root, 'app', 'apple-icon.png'));

  console.log(
    'lotus assets written: public/lotus-{mark,bloom,glyph}.svg, public/lotus-mark.png, public/favicon.{svg,ico}, app/icon.svg, app/apple-icon.png'
  );
}

void main();
