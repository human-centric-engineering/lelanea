/**
 * Render "light through water", the public site's one picture (t-171).
 *   npm run water:image
 *
 * Writes `public/lelanea/light-through-water.webp`: sunlight coming down
 * through shallow water, softly out of focus, drawn in the lotus's own colours
 * so it belongs to the same pond as the mark. It stands in the place a
 * photograph would — the soft refracted photography on her own site is the
 * reference — and is meant to be replaced by one if she has it.
 *
 * Every colour is read from the `--color-lotus-*` tokens in
 * `app/brand-theme.css`, as `npm run lotus:assets` reads them, so the image
 * cannot drift from the palette. Rerun after changing one of them.
 *
 * The caustic network is the well-known iterated-warp water caustic (after
 * joltz0r's and Dave Hoskins's tileable water shaders), evaluated on the CPU
 * once rather than in a shader on every visit.
 */
import { mkdirSync, readFileSync } from 'node:fs';
import path from 'node:path';

import sharp from 'sharp';

const WIDTH = 2000;
const HEIGHT = 1600;

type Rgb = [number, number, number];

/** A `--color-*` token's hex value — the FIRST declaration, the light block's. */
function token(css: string, name: string): Rgb {
  const match = new RegExp(`--color-${name}:\\s*#([0-9a-f]{6})`, 'i').exec(css);
  if (!match) throw new Error(`--color-${name} is not a hex in app/brand-theme.css`);
  const hex = match[1];
  return [0, 2, 4].map((i) => parseInt(hex.slice(i, i + 2), 16)) as Rgb;
}

const mix = (a: Rgb, b: Rgb, t: number): Rgb => [
  a[0] + (b[0] - a[0]) * t,
  a[1] + (b[1] - a[1]) * t,
  a[2] + (b[2] - a[2]) * t,
];

const screen = (base: Rgb, light: Rgb, amount: number): Rgb =>
  base.map((channel, i) => {
    const lit = 255 - ((255 - channel) * (255 - light[i])) / 255;
    return channel + (lit - channel) * amount;
  }) as Rgb;

const smoothstep = (edge0: number, edge1: number, x: number): number => {
  const t = Math.min(1, Math.max(0, (x - edge0) / (edge1 - edge0)));
  return t * t * (3 - 2 * t);
};

/** 0..1 brightness of the caustic network at a point. */
function caustic(x: number, y: number, time: number): number {
  const ITERATIONS = 5;
  const INTENSITY = 0.005;
  // Not wrapped to one period, as the tileable original is: a picture should
  // not visibly repeat.
  const px = x * Math.PI * 2 - 250;
  const py = y * Math.PI * 2 - 250;
  let ix = px;
  let iy = py;
  let c = 1;
  for (let n = 0; n < ITERATIONS; n++) {
    const t = time * (1 - 3.5 / (n + 1));
    const nx = px + Math.cos(t - ix) + Math.sin(t + iy);
    const ny = py + Math.sin(t - iy) + Math.cos(t + ix);
    ix = nx;
    iy = ny;
    c += 1 / Math.hypot(px / (Math.sin(ix + t) / INTENSITY), py / (Math.cos(iy + t) / INTENSITY));
  }
  c /= ITERATIONS;
  c = 1.17 - Math.pow(c, 1.4);
  return Math.min(1, Math.pow(Math.abs(c), 8));
}

async function main() {
  const root = process.cwd();
  const css = readFileSync(path.join(root, 'app', 'brand-theme.css'), 'utf8');

  const surface = token(css, 'lotus-vein');
  const shallow = token(css, 'lotus-petal-inner');
  const mid = token(css, 'lotus-petal-mid');
  const deep = token(css, 'lotus-petal-outer');
  const sun = token(css, 'lotus-core-light');
  const glint = token(css, 'lotus-glint');
  const sage = token(css, 'lotus-ripple-far');
  // The page's own oyster, so the water sits on the site rather than beside it.
  const oyster = token(css, 'background');

  const pixels = Buffer.alloc(WIDTH * HEIGHT * 3);

  for (let y = 0; y < HEIGHT; y++) {
    const v = y / HEIGHT;
    for (let x = 0; x < WIDTH; x++) {
      const u = x / WIDTH;

      // Depth: bright at the surface, deepening towards the bottom, with a
      // touch of the sage the ripples carry low on the left.
      let colour =
        v < 0.45
          ? mix(surface, shallow, v / 0.45)
          : v < 0.8
            ? mix(shallow, mid, (v - 0.45) / 0.35)
            : mix(mid, deep, (v - 0.8) / 0.2);
      colour = mix(colour, sage, 0.18 * smoothstep(0.35, 1, v) * (1 - u));

      // The caustic network, seen at a slight angle: squashed vertically, and
      // fading with depth as light does.
      // The pattern underneath is periodic, so the plane is bent by slow waves
      // of unrelated wavelengths first, and the finer layer is turned against
      // the coarse one: nothing lines up, and the eye finds no repeat.
      const wu = u + 0.11 * Math.sin(v * 4.3 + 1.1) + 0.06 * Math.sin(u * 2.9 + v * 1.7);
      const wv = v + 0.09 * Math.sin(u * 3.7 + 0.4) + 0.05 * Math.cos(v * 5.1 - u * 2.3);
      const lines = caustic(wu * 3.1 + 0.07, wv * 2.2 + 0.31, 46.3);
      const ru = wu * 0.8 - wv * 0.6;
      const rv = wu * 0.6 + wv * 0.8;
      const fine = caustic(ru * 5.7 + 0.41, rv * 4.3 + 0.13, 12.7);
      const fade = 1 - smoothstep(0.05, 1.05, v) * 0.7;
      colour = screen(colour, oyster, (lines * 0.6 + fine * 0.22) * fade);

      // Shafts of light from the upper right, where the sun enters.
      const angle = Math.atan2(v + 0.25, u - 0.95);
      const shafts =
        Math.pow(0.5 + 0.5 * Math.sin(angle * 23 + 1.3), 6) * 0.5 +
        Math.pow(0.5 + 0.5 * Math.sin(angle * 9.0), 8) * 0.5;
      colour = screen(colour, surface, shafts * 0.16 * (1 - smoothstep(0.0, 0.95, v)));

      // The warm bloom of the sun itself, the lotus centre's orange.
      const distance = Math.hypot((u - 0.84) * 1.25, v + 0.06);
      colour = mix(colour, sun, 0.42 * Math.exp(-distance * distance * 4));
      colour = screen(colour, glint, 0.5 * Math.exp(-distance * distance * 20));

      // A little of the oyster over everything: muted, as the site is.
      colour = mix(colour, oyster, 0.12);

      const offset = (y * WIDTH + x) * 3;
      for (let i = 0; i < 3; i++) {
        pixels[offset + i] = Math.max(0, Math.min(255, Math.round(colour[i])));
      }
    }
  }

  const out = path.join(root, 'public', 'lelanea', 'light-through-water.webp');
  mkdirSync(path.dirname(out), { recursive: true });
  // "Softly out of focus": the network should read as light, not as lines.
  const soft = await sharp(pixels, { raw: { width: WIDTH, height: HEIGHT, channels: 3 } })
    .blur(1.8)
    .raw()
    .toBuffer();

  // Grain AFTER the blur, so the long gradients never band once encoded. A
  // fixed seed, so a rerun with unchanged tokens is byte-stable.
  let seed = 171;
  for (let i = 0; i < soft.length; i += 3) {
    seed = (seed * 1664525 + 1013904223) >>> 0;
    const grain = (seed / 2 ** 32 - 0.5) * 5;
    for (let c = 0; c < 3; c++)
      soft[i + c] = Math.max(0, Math.min(255, Math.round(soft[i + c] + grain)));
  }

  await sharp(soft, { raw: { width: WIDTH, height: HEIGHT, channels: 3 } })
    .webp({ quality: 80, effort: 6 })
    .toFile(out);

  console.log(`wrote ${path.relative(root, out)}`);
}

main().catch((error: unknown) => {
  console.error(error);
  process.exit(1);
});
