/**
 * The lotus's colour expressions, read two ways: as CSS for the live SVG, and
 * resolved in JS for the canvas and the baked assets. The two must agree, so
 * the JS mix is pinned against what `color-mix(in oklab, …)` produces.
 *
 * @see components/app/ui/lotus-colour.ts
 */
import { describe, expect, it } from 'vitest';

import {
  colourCss,
  colourRgba,
  mix,
  parseColour,
  rgbaString,
  type Rgba,
} from '@/components/app/ui/lotus-colour';

const TOKENS: Record<string, Rgba> = {
  '--a': [23, 113, 138, 1],
  '--clear': [124, 192, 214, 0],
};
const token = (name: string): Rgba => TOKENS[name] ?? [0, 0, 0, 1];

describe('colourCss', () => {
  it('reads a token as var() and white as itself', () => {
    expect(colourCss('--a')).toBe('var(--a)');
    expect(colourCss('white')).toBe('white');
  });

  it('nests mixes as color-mix in oklab, as a percentage of the second', () => {
    expect(colourCss(mix(mix('--a', 'white', 0.25), '--b', 0.5))).toBe(
      'color-mix(in oklab, color-mix(in oklab, var(--a), white 25%), var(--b) 50%)'
    );
  });

  it('collapses a mix at either end to the colour itself', () => {
    expect(colourCss(mix('--a', '--b', 0))).toBe('var(--a)');
    expect(colourCss(mix('--a', '--b', 1))).toBe('var(--b)');
  });
});

describe('colourRgba', () => {
  it('mixes in OKLab, not sRGB — mid-grey is #636363, not #808080', () => {
    // color-mix(in oklab, white, black 50%) is L = 0.5, which is sRGB 99.
    expect(rgbaString(colourRgba(mix('white', 'black', 0.5), token))).toBe('#636363');
  });

  it('returns the token itself for an unmixed token', () => {
    expect(rgbaString(colourRgba('--a', token))).toBe('#17718a');
  });

  it('mixes alpha premultiplied, as color-mix specifies', () => {
    // Half toward a fully transparent colour keeps the opaque one's hue.
    const [r, g, b, a] = colourRgba(mix('--a', '--clear', 0.5), token);
    expect(a).toBeCloseTo(0.5, 5);
    expect([r, g, b]).toEqual([23, 113, 138]);
  });
});

describe('parseColour', () => {
  it('reads the forms computed style serialises', () => {
    expect(parseColour('#17718a')).toEqual([23, 113, 138, 1]);
    expect(parseColour(' #abc ')).toEqual([170, 187, 204, 1]);
    expect(parseColour('rgba(124, 192, 214, 0.2)')).toEqual([124, 192, 214, 0.2]);
    expect(parseColour('rgb(1 2 3 / 0.5)')).toEqual([1, 2, 3, 0.5]);
  });

  it('refuses what it cannot read rather than guessing', () => {
    expect(parseColour('')).toBeNull();
    expect(parseColour('var(--x)')).toBeNull();
  });
});
