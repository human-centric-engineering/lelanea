import { renderToStaticMarkup } from 'react-dom/server';

import {
  colourRgba,
  parseColour,
  rgbaString,
  type Colour,
  type Rgba,
} from '@/components/app/ui/lotus-colour';
import { measureLotusFrames, stillLotus, type LotusFrame } from '@/components/app/ui/lotus-draw';
import { emailLotusSize, ogLotusSize } from '@/components/app/ui/lotus-sizes';
import { lotusSvgElements } from '@/components/app/ui/lotus-svg';

/**
 * The still copies of the lotus, baked from the same draw list as the animated
 * bloom, with the tokens resolved to literals.
 *
 * Every still mark is one of these files rather than inline SVG. Inline, the
 * open bloom is ~270KB of markup — ~240 shaded gradient bands — repeated in
 * the HTML of every page that shows it, and the glyph again in every chat
 * avatar; as an `<img>` it is one cached request. That is safe because the
 * lotus tokens are deliberately the same in both modes (`brand-theme.css`):
 * the bloom is a mark, not a surface. The social card, favicon and email could
 * not read `var()` anyway.
 *
 * Pure: give it `app/brand-theme.css` and it returns file contents. The script
 * `scripts/app/render-lotus-assets.ts` writes them (and rasterises the PNGs);
 * `tests/unit/scripts/app/lotus-assets.test.ts` regenerates them and compares, so
 * retinting the lotus without re-running the script fails the build.
 */

/** The FIRST declaration of each token — light mode comes first in the file. */
export function lightTokens(stylesheet: string): Map<string, string> {
  const out = new Map<string, string>();
  for (const [, name, value] of stylesheet.matchAll(/(--color-[a-z-]+):\s*([^;]+);/g)) {
    if (!out.has(name)) out.set(name, value.trim());
  }
  return out;
}

function resolver(stylesheet: string): (c: Colour) => string {
  const tokens = lightTokens(stylesheet);
  const token = (name: string): Rgba => {
    const value = tokens.get(name);
    const parsed = value ? parseColour(value) : null;
    if (!parsed) throw new Error(`lotus assets: ${name} is not a colour in brand-theme.css`);
    return parsed;
  };
  return (c) => rgbaString(colourRgba(c, token));
}

/** A frame's viewBox grown to a square, centred — for the icons. */
function square(frame: LotusFrame, margin: number): string {
  const [x, y, w, h] = frame.box;
  const side = Math.max(w, h) * (1 + margin * 2);
  return [x + w / 2 - side / 2, y + h / 2 - side / 2, side, side]
    .map((n) => Math.round(n * 100) / 100)
    .join(' ');
}

function svg(attrs: Record<string, string | number>, body: React.ReactNode, background?: string) {
  const markup = renderToStaticMarkup(
    <svg xmlns="http://www.w3.org/2000/svg" {...attrs}>
      {background && <rect x="-1000" y="-1000" width="3000" height="3000" fill={background} />}
      {body}
    </svg>
  );
  // One decimal of a 100-unit model is a seventh of a pixel at the largest
  // size any of these is shown — and a third off every file.
  return `${markup.replace(/(\d\.\d)\d+/g, '$1')}\n`;
}

export interface LotusAssets {
  /** The bloom on water: `LotusMark water`, and the OG card. */
  'public/lotus-mark.svg': string;
  /** The bloom alone: `LotusMark water={false}` from 48px up. */
  'public/lotus-bloom.svg': string;
  /** The half-open glyph: `LotusMark water={false}` under 48px. */
  'public/lotus-glyph.svg': string;
  /** Rasterised to `public/lotus-mark.png` for email. */
  'email-lotus.svg': string;
  /** The favicon: the half-open glyph, square, transparent. */
  'app/icon.svg': string;
  /** Rasterised to `app/apple-icon.png`: the glyph on the oyster ground. */
  'apple-icon.svg': string;
}

export function lotusAssets(stylesheet: string): LotusAssets {
  const paint = resolver(stylesheet);
  // Measured, not the baked constant: the script writes both in one run.
  const measured = measureLotusFrames();
  const frames = measured.still;
  const background = lightTokens(stylesheet).get('--color-background');
  if (!background) throw new Error('lotus assets: --color-background missing');

  const og = ogLotusSize(measured);
  const email = emailLotusSize(measured);
  return {
    'public/lotus-mark.svg': svg(
      {
        viewBox: frames.water.box.join(' '),
        width: og.width,
        height: og.height,
        role: 'img',
        'aria-label': 'Lelañea lotus',
      },
      lotusSvgElements(stillLotus('open', true), 'l', paint)
    ),
    'public/lotus-bloom.svg': svg(
      { viewBox: frames.tight.box.join(' '), role: 'img', 'aria-label': 'Lelañea lotus' },
      lotusSvgElements(stillLotus('open', false), 'l', paint)
    ),
    'public/lotus-glyph.svg': svg(
      { viewBox: frames.glyph.box.join(' '), role: 'img', 'aria-label': 'Lelañea lotus' },
      lotusSvgElements(stillLotus('glyph', false), 'l', paint)
    ),
    'email-lotus.svg': svg(
      { viewBox: frames.tight.box.join(' '), width: email.width * 2, height: email.height * 2 },
      lotusSvgElements(stillLotus('open', false), 'l', paint)
    ),
    'app/icon.svg': svg(
      { viewBox: square(frames.glyph, 0.04), role: 'img', 'aria-label': 'Lelañea' },
      lotusSvgElements(stillLotus('glyph', false), 'l', paint)
    ),
    'apple-icon.svg': svg(
      { viewBox: square(frames.glyph, 0.14), width: 180, height: 180 },
      lotusSvgElements(stillLotus('glyph', false), 'l', paint),
      background
    ),
  };
}

/** `components/app/ui/lotus-frames.ts`, from a fresh measurement. */
export function lotusFramesSource(): string {
  const f = measureLotusFrames();
  const frame = (x: LotusFrame) =>
    `{ box: [${x.box.join(', ')}], bloomFraction: ${x.bloomFraction} }`;
  return `/**
 * GENERATED by \`npm run lotus:assets\` from \`measureLotusFrames()\` — do not edit.
 * \`tests/unit/scripts/app/lotus-assets.test.ts\` re-measures and fails on drift.
 */
import type { LotusFrames } from '@/components/app/ui/lotus-draw';

export const LOTUS_FRAMES: LotusFrames = {
  animated: {
    tight: ${frame(f.animated.tight)},
    water: ${frame(f.animated.water)},
  },
  still: {
    tight: ${frame(f.still.tight)},
    water: ${frame(f.still.water)},
    glyph: ${frame(f.still.glyph)},
  },
};
`;
}
