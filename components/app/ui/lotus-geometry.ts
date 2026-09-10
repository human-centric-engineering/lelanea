/**
 * The lotus, as numbers.
 *
 * §6.9 specifies the mark exactly — three petal tiers over sage ripples with a
 * burnt orange core — and the design kit ships the same geometry twice, in
 * `components/Lotus/Lotus.jsx` and `components/LotusMark/LotusMark.jsx`, with a
 * header on each telling you to keep them in sync with two SVG assets and a
 * thumbnail. Four copies of a bezier is four chances to drift, and the kit's own
 * comment says as much. Here it is written once and imported twice.
 *
 * NO COLOUR IN THIS FILE. The tiers carry `var(--color-lotus-*)` references, not
 * values, so the bloom is re-tintable from `app/brand-theme.css` and the
 * no-hex-literal guard over `components/app/ui/` needs no exception for the one
 * file that would otherwise have earned one.
 *
 * The coordinate system is the kit's and is deliberately not normalised: every
 * petal rises from (160, 175), which is why the transform origin below is a
 * literal point rather than a percentage. Rewriting it to a 0–100 box would be a
 * silent chance to move the mark, and the mark is approved.
 *
 * @see .context/app/planning/lelanea-product-description.md §6.9
 * @see .context/app/planning/design/Lelanea_Design_System/components/Lotus
 */

/** Every petal rotates about this point, so it unfurls from the calyx. */
export const LOTUS_ORIGIN = { x: 160, y: 175 } as const;

/**
 * One petal, as a path.
 *
 * A broad pointed petal rising from the origin: two mirrored cubics meeting at
 * the tip. `length` is how far it reaches, `width` how far it bows out. The kit
 * rounds every control point to one decimal, and that is kept — the strings then
 * match the shipped assets byte for byte, so a diff against them is meaningful.
 *
 * Wide-angle tiers are short and upright ones long, which is what makes the
 * bloom read as a wide fan (measured 134 × 118, aspect 1.14) rather than a ball.
 */
export function lotusPetal(length: number, width: number): string {
  const out = (fraction: number) => (LOTUS_ORIGIN.x + width * fraction).toFixed(1);
  const up = (fraction: number) => (LOTUS_ORIGIN.y - length * fraction).toFixed(1);
  return (
    `M160 175C${out(0.58)} ${up(0.29)},${out(0.49)} ${up(0.73)},160 ${LOTUS_ORIGIN.y - length}` +
    `C${out(-0.49)} ${up(0.73)},${out(-0.58)} ${up(0.29)},160 175Z`
  );
}

export interface LotusTier {
  /** The petal path this tier repeats. */
  readonly d: string;
  /** Token reference for the petal body. */
  readonly fill: string;
  /** Token reference for its edge. */
  readonly stroke: string;
  /** Degrees, one entry per petal. Signs are mirrored pairs; 0° is the crown. */
  readonly angles: readonly number[];
  /** Milliseconds before this tier begins to open. */
  readonly base: number;
}

/**
 * Outer to inner — which is also back to front, so a later tier paints over an
 * earlier one and the bloom has depth. The opening runs the other way (§6.9:
 * "staggered inner to outer"), which is why `base` descends as the array
 * advances rather than ascending with it.
 */
export const LOTUS_TIERS: readonly LotusTier[] = [
  {
    d: lotusPetal(60, 48),
    fill: 'var(--color-lotus-petal-outer)',
    stroke: 'var(--color-lotus-petal-outer-edge)',
    angles: [-66, 66, -46, 46, -25, 25],
    base: 340,
  },
  {
    d: lotusPetal(78, 50),
    fill: 'var(--color-lotus-petal-mid)',
    stroke: 'var(--color-lotus-petal-mid-edge)',
    angles: [-42, 42, -26, 26, -11, 11],
    base: 180,
  },
  {
    d: lotusPetal(98, 52),
    fill: 'var(--color-lotus-petal-inner)',
    stroke: 'var(--color-lotus-petal-inner-edge)',
    angles: [-30, 30, -15, 15, 0],
    base: 40,
  },
] as const;

/** The pale centre veins of §6.9, on the inner tier's five petals only. */
export const LOTUS_VEIN_ANGLES = [-30, 30, -15, 15, 0] as const;
export const LOTUS_VEIN_D = 'M160 164 160 88';

/** Milliseconds between one petal opening and the next within a tier. */
export const LOTUS_PETAL_STAGGER = 70;

export const LOTUS_CORE = { cx: 160, cy: 172, rx: 8, ry: 10 } as const;
export const LOTUS_GLINT = { cx: 160, cy: 169, rx: 2.8, ry: 3.4 } as const;

export interface LotusRipple {
  readonly rx: number;
  readonly ry: number;
  readonly stroke: string;
  readonly opacity: number;
  readonly width: number;
}

/** Three concentric rings reading as stillness on water rather than foliage. */
export const LOTUS_RIPPLES: readonly LotusRipple[] = [
  { rx: 50, ry: 6, stroke: 'var(--color-lotus-ripple)', opacity: 0.55, width: 1.6 },
  { rx: 74, ry: 9, stroke: 'var(--color-lotus-ripple)', opacity: 0.34, width: 1.4 },
  { rx: 97, ry: 12, stroke: 'var(--color-lotus-ripple-far)', opacity: 0.2, width: 1.2 },
] as const;

export const LOTUS_RIPPLE_CY = 188;

export interface LotusFrame {
  /** SVG `viewBox`. */
  readonly box: string;
  /** Frame height as a multiple of its width. */
  readonly aspect: number;
  /**
   * The measured share of the frame's width that the BLOOM occupies.
   *
   * This is what makes §6.6's promise true — "`size` is the rendered width of
   * the bloom rather than of the SVG frame, so the two are interchangeable at
   * the same size". The frame is derived from `size`, never the other way
   * round, so a 32px `LotusMark` beside a 32px `Lotus` shows two blooms of the
   * same width even though the water frame is half as wide again.
   */
  readonly bloomFraction: number;
  /** Petal edge width. The tight crop is larger, so the edge holds at 16px. */
  readonly stroke: number;
}

export const LOTUS_FRAMES = {
  /** The full mark, ripples included. */
  water: { box: '58 72 204 132', aspect: 132 / 204, bloomFraction: 0.658, stroke: 1.5 },
  /** Cropped to the bloom — §6.6 says use it under about 40px. */
  tight: { box: '86 74 148 126', aspect: 126 / 148, bloomFraction: 0.95, stroke: 1.9 },
} as const satisfies Record<string, LotusFrame>;

/** Frame pixel dimensions for a requested bloom width. */
export function lotusFrameSize(size: number, frame: LotusFrame): { width: number; height: number } {
  const width = size / frame.bloomFraction;
  return { width, height: width * frame.aspect };
}

/**
 * §6.5's breath easing, as a literal.
 *
 * `var(--ease-brand)` would be the tidier reference and is deliberately not used
 * for the petals: these transitions are set as inline styles, and an inline
 * `transition` resolving a custom property is the one place a missing token
 * degrades to "no transition at all" instead of to a wrong-but-visible value.
 * The mark's opening is the app's first gesture (§6.9), so it does not depend on
 * a token being in scope. The keyframed breath, which is in the stylesheet
 * rather than inline, does use the token.
 */
export const LOTUS_EASE = 'cubic-bezier(0.22, 0.61, 0.36, 1)';

/** §6.9: the bloom opens over 2200ms. */
export const LOTUS_OPEN_MS = 2200;

/* §6.9's 4s idle breath is NOT here. It is a keyframed animation rather than a
 * transition, so `lotus.module.css` declares it and owns its duration — a copy
 * of the figure in this file would be a second source of truth that nothing
 * reads. */
