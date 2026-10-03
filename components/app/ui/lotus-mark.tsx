import { cn } from '@/lib/utils';

import { LOTUS_GLYPH_BELOW, lotusFrameSize, lotusFrames } from '@/components/app/ui/lotus-draw';

export interface LotusMarkProps {
  /**
   * The rendered width of the BLOOM in pixels — not of the frame around it.
   *
   * §6.6: "`size` is the rendered width of the bloom rather than of the SVG
   * frame, so the two are interchangeable at the same size." A 32px `LotusMark`
   * and a 32px `Lotus` show the same bloom; the water frame around it is simply
   * wider. See `LotusFrame.bloomFraction`.
   */
  size?: number;
  /** Include the lily pads and sage ripples. §6.6 says drop them under about 40px. */
  water?: boolean;
  className?: string;
}

/**
 * The lotus as a still mark — the landing hero, the header and footer, the
 * shell nav, the chat avatar (§6.7).
 *
 * It is a baked image of the same flower the animated `Lotus` draws, made from
 * the model by `npm run lotus:assets` (`scripts/app/lotus-assets.tsx`). Inline, the
 * open bloom is ~270KB of shaded SVG repeated in every page's HTML — and the
 * glyph again in every chat turn's avatar; as an image it is one cached
 * request. The lotus tokens are the same in both modes by design, so a baked
 * file loses nothing a live one would show, and a test fails if the tokens or
 * the model change without re-baking.
 *
 * Three forms: the bloom on water, the bloom alone, and — without water, below
 * 48px — the half-open GLYPH, because the open flower is ~2.3× wider than tall
 * and at avatar size would be a sliver.
 *
 * DECORATIVE BY DEFAULT. Empty `alt` and `aria-hidden`: every use §6.7 names
 * sits beside the name it stands for. Where the mark is the *only* content of
 * a link, label the LINK, as the header and the shell nav do.
 *
 * @see .context/app/brand-theme.md — the lotus
 */
export function LotusMark({ size = 32, water = true, className }: LotusMarkProps) {
  const glyph = !water && size < LOTUS_GLYPH_BELOW;
  const frames = lotusFrames().still;
  const frame = water ? frames.water : glyph ? frames.glyph : frames.tight;
  const src = water ? '/lotus-mark.svg' : glyph ? '/lotus-glyph.svg' : '/lotus-bloom.svg';
  const { width, height } = lotusFrameSize(size, frame);

  return (
    // A plain <img>, not next/image: a static SVG gains nothing from the
    // optimiser, which refuses SVG unless `dangerouslyAllowSVG` is set.
    // eslint-disable-next-line @next/next/no-img-element
    <img
      src={src}
      width={Math.round(width)}
      height={Math.round(height)}
      alt=""
      aria-hidden="true"
      draggable={false}
      className={cn('inline-block select-none', className)}
    />
  );
}
