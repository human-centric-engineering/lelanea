import { lotusFrameSize, lotusFrames, type LotusFrames } from '@/components/app/ui/lotus-draw';

/**
 * The display sizes of the two baked lotus images that are shown outside React
 * components — the social card and the email header. Both are sized from the
 * same frames `npm run lotus:assets` baked them in, so the <img> attributes
 * cannot disagree with the file's own aspect.
 */

/** The OG card shows the bloom on water at this width. */
export const OG_LOTUS_BLOOM = 300;
/** The email header shows the bloom (no water) at this width. */
export const EMAIL_LOTUS_BLOOM = 72;

export interface PixelSize {
  readonly width: number;
  readonly height: number;
}

function rounded({ width, height }: PixelSize): PixelSize {
  return { width: Math.round(width), height: Math.round(height) };
}

export function ogLotusSize(frames: LotusFrames = lotusFrames()): PixelSize {
  return rounded(lotusFrameSize(OG_LOTUS_BLOOM, frames.still.water));
}

export function emailLotusSize(frames: LotusFrames = lotusFrames()): PixelSize {
  return rounded(lotusFrameSize(EMAIL_LOTUS_BLOOM, frames.still.tight));
}
