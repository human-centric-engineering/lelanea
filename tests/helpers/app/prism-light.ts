/**
 * The prism's light, as a contrast model: what a word in the consumer surface
 * is actually read against.
 *
 * The prism (t-177) has no single ground colour. The page is lit, its grounds
 * are glass, and the colour behind a word depends on where on the screen it
 * sits. So every ratio is a WORST CASE over the lit ground the stylesheet
 * describes. The method is `.context/app/brand-theme.md` § "Contrast over the
 * light"; this module is that method in code, shared by the palette's own test
 * (`tests/unit/app/brand-theme.test.ts`) and the tint picker's
 * (`tests/unit/components/app/ui/tints.test.ts`), so the two cannot measure
 * differently.
 *
 * Stylesheets are parsed rather than imported: Vitest does not run PostCSS over
 * them, and what we want to assert is the authored source anyway.
 */

import { readFileSync } from 'node:fs';
import path from 'node:path';

export interface Rule {
  selector: string;
  body: string;
}

/** A theme's resolved tokens: name → value, as the stylesheet writes them. */
export type TokenScope = ReadonlyMap<string, string>;

/**
 * Comments are stripped FIRST and this matters more than it looks: the files'
 * own headers quote selectors and document the bans their tests enforce, so an
 * assertion would otherwise read the documentation as code.
 */
export function stripCssComments(source: string): string {
  return source.replace(/\/\*[\s\S]*?\*\//g, '');
}

/** The files are flat — no nesting, no at-rules — so a rule is `selector { … }`. */
export function parseRules(css: string): Rule[] {
  return [...css.matchAll(/([^{}]+)\{([^{}]*)\}/g)].map((match) => ({
    selector: match[1].trim(),
    body: match[2],
  }));
}

/** The custom properties a rule body declares, in source order. */
export function customProperties(body: string): Map<string, string> {
  const declared = new Map<string, string>();
  for (const match of body.matchAll(/(--[\w-]+)\s*:\s*([^;]+);/g)) {
    declared.set(match[1], match[2].trim().replace(/\s+/g, ' '));
  }
  return declared;
}

/** Reads a token's value, so a test measures what ships. */
export function token(scope: TokenScope, name: string): string {
  const value = scope.get(name);
  if (value === undefined) throw new Error(`no \`${name}\` declared in this scope`);
  return value;
}

// ---------------------------------------------------------------- contrast

function channelToLinear(channel: number): number {
  const proportion = channel / 255;
  return proportion <= 0.03928 ? proportion / 12.92 : Math.pow((proportion + 0.055) / 1.055, 2.4);
}

/** WCAG 2.1 relative luminance. Opaque hex only — every value tested is one. */
function relativeLuminance(hex: string): number {
  const value = hex.trim().replace('#', '');
  if (!/^[0-9a-f]{6}$/i.test(value)) {
    throw new Error(`expected an opaque 6-digit hex colour, got \`${hex}\``);
  }
  const [red, green, blue] = [0, 2, 4].map((offset) =>
    channelToLinear(Number.parseInt(value.slice(offset, offset + 2), 16))
  );
  return 0.2126 * red + 0.7152 * green + 0.0722 * blue;
}

export function contrastRatio(foreground: string, background: string): number {
  const a = relativeLuminance(foreground);
  const b = relativeLuminance(background);
  const [lighter, darker] = a > b ? [a, b] : [b, a];
  return (lighter + 0.05) / (darker + 0.05);
}

export function rgbaParts(value: string): { channels: number[]; alpha: number } {
  const trimmed = value.trim();
  if (trimmed.startsWith('#')) {
    const hex = trimmed.replace('#', '');
    return {
      channels: [0, 2, 4].map((offset) => Number.parseInt(hex.slice(offset, offset + 2), 16)),
      alpha: 1,
    };
  }
  const parts = trimmed.match(/^rgba?\(\s*(\d+)\s*,\s*(\d+)\s*,\s*(\d+)\s*(?:,\s*([\d.]+)\s*)?\)$/);
  if (!parts) throw new Error(`cannot composite \`${value}\` — not a hex or rgb()/rgba()`);
  return {
    channels: [1, 2, 3].map((index) => Number.parseInt(parts[index], 10)),
    alpha: parts[4] === undefined ? 1 : Number.parseFloat(parts[4]),
  };
}

function toHex(channels: number[]): string {
  return `#${channels.map((channel) => Math.round(channel).toString(16).padStart(2, '0')).join('')}`;
}

/**
 * Composites a colour over an opaque ground and returns the hex it PAINTS AS.
 *
 * `blend` is the layer's `mix-blend-mode` and `opacity` its element opacity,
 * because that is how the prism's rays reach the page: in dark they SCREEN onto
 * the ground at `--ray-opacity`. A hairline or a glass ground is the plain case,
 * `normal` at full opacity. An opaque colour at full opacity is returned
 * untouched, so a caller does not have to know which kind it has.
 */
export function flattenOver(
  value: string,
  ground: string,
  { blend = 'normal', opacity = 1 }: { blend?: string; opacity?: number } = {}
): string {
  const { channels, alpha } = rgbaParts(value);
  if (alpha === 1 && opacity === 1 && blend === 'normal') return value.trim();
  const under = rgbaParts(ground).channels;
  const painted =
    blend === 'screen'
      ? channels.map((channel, index) => 255 - ((255 - channel) * (255 - under[index])) / 255)
      : channels;
  const weight = alpha * opacity;
  return toHex(painted.map((channel, index) => weight * channel + (1 - weight) * under[index]));
}

/** A token's contrast against the ground it is painted on, alpha resolved. */
export function contrastOn(value: string, ground: string): number {
  return contrastRatio(flattenOver(value, ground), ground);
}

// --------------------------------------------------------------- the light

/**
 * Every colour the lit ground can paint at one point, as the stylesheet
 * describes it, in the order `components/app/ui/prism-ground.tsx` stacks the
 * layers: the ground, one glow, the fold, one edge of a ray, the veil, a spark.
 *
 * EACH LAYER AT ITS PEAK and every combination of them, which over-states the
 * light — the three glows never peak at one point, and a ray's own blur softens
 * its core — so a ratio that clears here clears on the page. One glow at a time
 * rather than all three stacked, because the three peak at opposite corners and
 * their stack is a colour the page never paints.
 *
 * `veil` is the veil's element opacity at each state to include: `0` is the
 * veil off, `1` the site's veil, and the shell's quarter-strength veil is its
 * own value (`prism-ground.module.css`). Text straight on the site's ground is
 * only ever inside the veil — the ground keys it to the reading column — so
 * that case passes `[1]`; a glass surface can sit anywhere, so it takes the
 * veil both off and on.
 */
export function litGrounds(scope: TokenScope, veil: readonly number[]): string[] {
  const blend = token(scope, '--ray-blend');
  const opacity = Number.parseFloat(token(scope, '--ray-opacity'));
  const out: string[] = [];
  for (const glow of [null, '--glow-1', '--glow-2', '--glow-3']) {
    for (const fold of [false, true]) {
      for (const ray of [null, '--ray-core', '--ray-warm', '--ray-cool']) {
        for (const spark of [false, true]) {
          for (const veilOpacity of veil) {
            let colour = token(scope, '--color-ground');
            if (glow) colour = flattenOver(token(scope, glow), colour);
            if (fold) colour = flattenOver(token(scope, '--fold'), colour);
            if (ray) colour = flattenOver(token(scope, ray), colour, { blend, opacity });
            if (veilOpacity > 0) {
              colour = flattenOver(token(scope, '--veil'), colour, { opacity: veilOpacity });
            }
            if (spark) colour = flattenOver(token(scope, '--spark'), colour, { blend });
            out.push(colour);
          }
        }
      }
    }
  }
  return out;
}

/** The site's veil states a glass surface can sit over: off, and full. */
export const SITE_VEIL = [0, 1] as const;

/**
 * Every colour a ground token can paint as. An opaque token (the popover, a
 * sheet) is itself; a glass one is composited over every lit ground.
 */
export function paintedAs(
  scope: TokenScope,
  ground: string,
  veil: readonly number[] = SITE_VEIL
): string[] {
  const value = token(scope, ground);
  if (rgbaParts(value).alpha === 1) return [value];
  return litGrounds(scope, veil).map((lit) => flattenOver(value, lit));
}

/** The tightest ratio of `ink` over every colour in `grounds`. */
export function worstContrast(ink: string, grounds: readonly string[]): number {
  return Math.min(...grounds.map((ground) => contrastRatio(ink, ground)));
}

/** As `worstContrast`, for a non-text mark that may itself be an alpha. */
export function worstContrastOn(value: string, grounds: readonly string[]): number {
  return Math.min(...grounds.map((ground) => contrastOn(value, ground)));
}

/** The three inks D5 names: body text, secondary text, links. */
export const INKS = ['--color-foreground', '--color-muted-foreground', '--color-secondary-ink'];

/**
 * The shell's own grounds (t-179): the frame (`--app-*`) and the reading panes
 * (`--read-*`), measured over the shell's light with `SHELL_VEIL`.
 */
export const SHELL_GROUNDS = [
  '--app-background',
  '--app-card',
  '--app-muted',
  '--read-background',
  '--read-card',
  '--read-muted',
];

/**
 * The shell veil's opacity, read from the module that sets it, so thinning it
 * further is measured rather than assumed.
 */
function shellVeilOpacity(): number {
  const groundCss = stripCssComments(
    readFileSync(
      path.join(process.cwd(), 'components', 'app', 'ui', 'prism-ground.module.css'),
      'utf8'
    )
  );
  const rule = parseRules(groundCss).find(
    (candidate) => candidate.selector === ".ground[data-prism='app'] .veil"
  );
  const opacity = rule?.body.match(/opacity:\s*([\d.]+)/)?.[1];
  if (opacity === undefined) throw new Error('prism-ground.module.css sets no shell veil opacity');
  return Number.parseFloat(opacity);
}

/** The shell's veil states: off, and at the quarter strength its ground gives it. */
export const SHELL_VEIL = [0, shellVeilOpacity()] as const;

/**
 * The palette as each theme resolves it, from `app/brand-theme.css`: the light
 * block, and in dark the light block with the dark block over it (the light
 * block also matches in dark — brand-theme.css note 3).
 */
export function paletteScopes(): { light: Map<string, string>; dark: Map<string, string> } {
  const rules = parseRules(
    stripCssComments(readFileSync(path.join(process.cwd(), 'app', 'brand-theme.css'), 'utf8'))
  );
  const block = (selector: string) => {
    const found = rules.find((rule) => rule.selector === selector);
    if (!found) throw new Error(`no rule in brand-theme.css with selector \`${selector}\``);
    return customProperties(found.body);
  };
  const light = block("[data-surface='consumer']");
  return { light, dark: new Map([...light, ...block("[data-surface='consumer'].dark")]) };
}
