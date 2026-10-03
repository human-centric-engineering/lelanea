/**
 * The lotus's colours as expressions over tokens, and the two ways to read one.
 *
 * NO COLOUR IN THIS FILE. A `Colour` names `--color-lotus-*` tokens and mixes
 * them; nothing here is a value. The SVG mark reads an expression as CSS
 * (`var()` inside `color-mix()`), which the browser resolves against
 * `app/brand-theme.css`. The canvas animation, and the script that bakes the
 * static assets, cannot use `var()` — so they resolve the tokens themselves and
 * mix in JS, in the same OKLab space `color-mix(in oklab, …)` uses, so the two
 * readings agree.
 */

/** A token name (`--color-…`), `white`, or a mix: `[a, b, t]` is `t` of `b` in `a`. */
export type Colour = string | { readonly mix: readonly [Colour, Colour, number] };

export const mix = (a: Colour, b: Colour, t: number): Colour => ({ mix: [a, b, t] });

/** As CSS, for an SVG attribute. */
export function colourCss(c: Colour): string {
  if (typeof c === 'string') return c.startsWith('--') ? `var(${c})` : c;
  const [a, b, t] = c.mix;
  if (t <= 0) return colourCss(a);
  if (t >= 1) return colourCss(b);
  return `color-mix(in oklab, ${colourCss(a)}, ${colourCss(b)} ${Math.round(t * 100)}%)`;
}

export type Rgba = readonly [number, number, number, number];

/** Parse `#rgb`, `#rrggbb`, `rgb()`/`rgba()` as browsers serialise them. */
export function parseColour(value: string): Rgba | null {
  const v = value.trim().toLowerCase();
  if (v === 'white') return [255, 255, 255, 1];
  if (v === 'black') return [0, 0, 0, 1];
  const hex = /^#([0-9a-f]{3}|[0-9a-f]{6})$/.exec(v);
  if (hex) {
    const h = hex[1].length === 3 ? [...hex[1]].map((x) => x + x).join('') : hex[1];
    return [
      Number.parseInt(h.slice(0, 2), 16),
      Number.parseInt(h.slice(2, 4), 16),
      Number.parseInt(h.slice(4, 6), 16),
      1,
    ];
  }
  const fn = /^rgba?\(\s*([\d.]+)[\s,]+([\d.]+)[\s,]+([\d.]+)(?:[\s,/]+([\d.]+))?\s*\)$/.exec(v);
  if (fn)
    return [Number(fn[1]), Number(fn[2]), Number(fn[3]), fn[4] === undefined ? 1 : Number(fn[4])];
  return null;
}

const toLinear = (c: number) => {
  const s = c / 255;
  return s <= 0.04045 ? s / 12.92 : ((s + 0.055) / 1.055) ** 2.4;
};
const fromLinear = (c: number) => {
  const s = c <= 0.0031308 ? 12.92 * c : 1.055 * c ** (1 / 2.4) - 0.055;
  return Math.round(Math.min(1, Math.max(0, s)) * 255);
};

function toOklab([r, g, b, a]: Rgba): Rgba {
  const lr = toLinear(r);
  const lg = toLinear(g);
  const lb = toLinear(b);
  const l = Math.cbrt(0.4122214708 * lr + 0.5363325363 * lg + 0.0514459929 * lb);
  const m = Math.cbrt(0.2119034982 * lr + 0.6806995451 * lg + 0.1073969566 * lb);
  const s = Math.cbrt(0.0883024619 * lr + 0.2817188376 * lg + 0.6299787005 * lb);
  return [
    0.2104542553 * l + 0.793617785 * m - 0.0040720468 * s,
    1.9779984951 * l - 2.428592205 * m + 0.4505937099 * s,
    0.0259040371 * l + 0.7827717662 * m - 0.808675766 * s,
    a,
  ];
}

function fromOklab([L, A, B, alpha]: Rgba): Rgba {
  const l = (L + 0.3963377774 * A + 0.2158037573 * B) ** 3;
  const m = (L - 0.1055613458 * A - 0.0638541728 * B) ** 3;
  const s = (L - 0.0894841775 * A - 1.291485548 * B) ** 3;
  return [
    fromLinear(4.0767416621 * l - 3.3077115913 * m + 0.2309699292 * s),
    fromLinear(-1.2684380046 * l + 2.6097574011 * m - 0.3413193965 * s),
    fromLinear(-0.0041960863 * l - 0.7034186147 * m + 1.707614701 * s),
    alpha,
  ];
}

/**
 * Evaluate an expression to RGBA, given how to read a token. Mixes in OKLab
 * with premultiplied alpha, as `color-mix(in oklab, …)` specifies.
 */
export function colourRgba(c: Colour, token: (name: string) => Rgba): Rgba {
  if (typeof c === 'string') {
    return c.startsWith('--') ? token(c) : (parseColour(c) ?? [0, 0, 0, 1]);
  }
  const [a, b, t] = c.mix;
  const x = toOklab(colourRgba(a, token));
  const y = toOklab(colourRgba(b, token));
  const alpha = x[3] * (1 - t) + y[3] * t;
  if (alpha === 0) return [0, 0, 0, 0];
  const lerp = (i: number) => (x[i] * x[3] * (1 - t) + y[i] * y[3] * t) / alpha;
  return fromOklab([lerp(0), lerp(1), lerp(2), alpha]);
}

/** As a canvas/SVG colour string from resolved RGBA. */
export function rgbaString([r, g, b, a]: Rgba): string {
  if (a >= 1) return `#${[r, g, b].map((x) => x.toString(16).padStart(2, '0')).join('')}`;
  return `rgba(${r}, ${g}, ${b}, ${Math.round(a * 1000) / 1000})`;
}
