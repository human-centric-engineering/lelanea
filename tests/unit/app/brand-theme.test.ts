/**
 * Unit Tests: `app/brand-theme.css` — the fork-owned per-surface palette
 *
 * These assert the properties the stylesheet has to hold that a screenshot
 * cannot tell you about, because each one fails SILENTLY: the page still
 * renders, it is just wrong somewhere nobody looks.
 *
 *  1. **Unlayered.** Tailwind 4 emits its `@theme` tokens inside a layer and
 *     `globals.css` puts the `.dark` overrides in `@layer base`. Unlayered beats
 *     layered whatever the specificity — that is the ONLY reason our values win.
 *     Wrap any of this in `@layer` and the whole file quietly stops applying.
 *
 *  2. **Nothing escapes the consumer surface.** A `:root` scope, or a rule that
 *     forgot its `[data-surface='consumer']` prefix, repaints `/admin` too. That
 *     shows up as an admin screenshot diff long after the change that caused it.
 *
 *  3. **Every dark token has a light twin.** The light block also matches in
 *     dark mode (`[data-surface='consumer']` matches `<html class="dark">`), so
 *     the dark block only restates what CHANGES. The failure mode is the reverse
 *     of the obvious one: a token declared only under `.dark` has no light value
 *     at all, and light mode falls through to Sunrise's blue.
 *
 *  4. **Text clears 4.5:1 over the light.** In the prism (t-177) the page is
 *     lit and its grounds are glass, so there is no single ground colour to
 *     measure against. Every ratio below is the WORST over the lit ground the
 *     stylesheet describes — each glow, the fold, each edge of a ray, the spark,
 *     the veil on and off — with the glass token composited over it. The values
 *     are MEASURED from the stylesheet rather than restated here, so editing a
 *     token to something that fails is caught by this test and not by a user.
 *     The method is `.context/app/brand-theme.md` § "Contrast over the light".
 *
 * The stylesheet is parsed rather than imported: Vitest does not run PostCSS
 * over it, and what we want to assert is the authored source anyway.
 */
import { readFileSync } from 'node:fs';
import path from 'node:path';

import { describe, expect, it } from 'vitest';

const SOURCE = readFileSync(path.join(process.cwd(), 'app', 'brand-theme.css'), 'utf8');

/**
 * Comments are stripped FIRST and this matters more than it looks: the file's
 * own header documents the `@layer` ban and quotes `.dark` selectors, so every
 * assertion below would read its own documentation as code.
 */
const CSS = SOURCE.replace(/\/\*[\s\S]*?\*\//g, '');

const LIGHT_SCOPE = "[data-surface='consumer']";
const DARK_SCOPE = "[data-surface='consumer'].dark";

interface Rule {
  selector: string;
  body: string;
}

/** The file is flat — no nesting, no at-rules — so a rule is `selector { … }`. */
function parseRules(css: string): Rule[] {
  return [...css.matchAll(/([^{}]+)\{([^{}]*)\}/g)].map((match) => ({
    selector: match[1].trim(),
    body: match[2],
  }));
}

/**
 * The compound selectors of a selector list: split on the TOP-LEVEL commas
 * only. `:is(p, h1)` is one compound with commas inside it, and a plain split
 * would read `h1)` as a selector that escaped the consumer scope.
 */
function compounds(selector: string): string[] {
  const out: string[] = [];
  let depth = 0;
  let current = '';
  for (const char of selector) {
    if (char === '(') depth += 1;
    if (char === ')') depth -= 1;
    if (char === ',' && depth === 0) {
      out.push(current.trim());
      current = '';
    } else {
      current += char;
    }
  }
  out.push(current.trim());
  return out.filter((compound) => compound.length > 0);
}

/** The custom properties a rule body declares, in source order. */
function customProperties(body: string): Map<string, string> {
  const declared = new Map<string, string>();
  for (const match of body.matchAll(/(--[\w-]+)\s*:\s*([^;]+);/g)) {
    declared.set(match[1], match[2].trim().replace(/\s+/g, ' '));
  }
  return declared;
}

const RULES = parseRules(CSS);

function ruleFor(selector: string): Rule {
  const found = RULES.find((rule) => rule.selector === selector);
  if (!found) throw new Error(`no rule in brand-theme.css with selector \`${selector}\``);
  return found;
}

const lightTokens = customProperties(ruleFor(LIGHT_SCOPE).body);
const darkTokens = customProperties(ruleFor(DARK_SCOPE).body);
/** What dark mode RESOLVES to: the light block, with the dark block over it. */
const darkResolved = new Map([...lightTokens, ...darkTokens]);

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

function contrastRatio(foreground: string, background: string): number {
  const a = relativeLuminance(foreground);
  const b = relativeLuminance(background);
  const [lighter, darker] = a > b ? [a, b] : [b, a];
  return (lighter + 0.05) / (darker + 0.05);
}

function rgbaParts(value: string): { channels: number[]; alpha: number } {
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
function flattenOver(
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
function contrastOn(value: string, ground: string): number {
  return contrastRatio(flattenOver(value, ground), ground);
}

/**
 * The ground a Tailwind `bg-<token>/<n>` wash actually paints — the token at
 * that alpha, over whatever is behind it. Every form's error banner is
 * `bg-destructive/10 text-destructive`, so the ink there is read against this
 * and not against the page ground.
 */
function washOver(hex: string, alpha: number, ground: string): string {
  const [red, green, blue] = rgbaParts(hex).channels;
  return flattenOver(`rgba(${red}, ${green}, ${blue}, ${alpha})`, ground);
}

type Theme = 'light' | 'dark';

function scopeFor(theme: Theme): Map<string, string> {
  return theme === 'light' ? lightTokens : darkResolved;
}

/** Reads a token's value from the stylesheet, so the test measures what ships. */
function token(scope: Map<string, string>, name: string): string {
  const value = scope.get(name);
  if (value === undefined) throw new Error(`brand-theme.css declares no \`${name}\``);
  return value;
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
 * `veil` says which veil states to include. Text straight on the ground is only
 * ever inside the veil — the ground keys it to the reading column — so that
 * case passes `[true]`; a glass surface can sit anywhere, so it takes both.
 */
function litGrounds(theme: Theme, veil: readonly boolean[]): string[] {
  const scope = scopeFor(theme);
  const blend = token(scope, '--ray-blend');
  const opacity = Number.parseFloat(token(scope, '--ray-opacity'));
  const out: string[] = [];
  for (const glow of [null, '--glow-1', '--glow-2', '--glow-3']) {
    for (const fold of [false, true]) {
      for (const ray of [null, '--ray-core', '--ray-warm', '--ray-cool']) {
        for (const spark of [false, true]) {
          for (const veiled of veil) {
            let colour = token(scope, '--color-ground');
            if (glow) colour = flattenOver(token(scope, glow), colour);
            if (fold) colour = flattenOver(token(scope, '--fold'), colour);
            if (ray) colour = flattenOver(token(scope, ray), colour, { blend, opacity });
            if (veiled) colour = flattenOver(token(scope, '--veil'), colour);
            if (spark) colour = flattenOver(token(scope, '--spark'), colour, { blend });
            out.push(colour);
          }
        }
      }
    }
  }
  return out;
}

/**
 * Every colour a ground token can paint as. An opaque token (the popover, a
 * sheet) is itself; a glass one is composited over every lit ground.
 */
function paintedAs(theme: Theme, ground: string): string[] {
  const value = token(scopeFor(theme), ground);
  if (rgbaParts(value).alpha === 1) return [value];
  return litGrounds(theme, [false, true]).map((lit) => flattenOver(value, lit));
}

/** The tightest ratio of `ink` over every colour in `grounds`. */
function worstContrast(ink: string, grounds: readonly string[]): number {
  return Math.min(...grounds.map((ground) => contrastRatio(ink, ground)));
}

/** As `worstContrast`, for a non-text mark that may itself be an alpha. */
function worstContrastOn(value: string, grounds: readonly string[]): number {
  return Math.min(...grounds.map((ground) => contrastOn(value, ground)));
}

/**
 * The grounds text and controls sit on. The page ground, a card and a sunk
 * surface — all three glass in the prism — and the opaque popover, which
 * <FieldHelp>, <Select> and <DropdownMenu> render onto. The read grounds are
 * where the shell puts the conversation and the workspace (t-179).
 */
const GROUNDS = [
  '--color-background',
  '--color-card',
  '--color-muted',
  '--color-popover',
  '--read-background',
  '--read-card',
  '--read-muted',
];

/** `[theme, ground]` for every combination, for `it.each`. */
const GROUND_PAIRINGS = GROUNDS.flatMap((ground) => [
  ['light', ground] as const,
  ['dark', ground] as const,
]);

const THEMES = ['light', 'dark'] as const;

/** The three inks the done-when names: body text, secondary text, links. */
const INKS = ['--color-foreground', '--color-muted-foreground', '--color-secondary-ink'];

// -------------------------------------------------------------------- tests

describe('app/brand-theme.css', () => {
  describe('the cascade it depends on', () => {
    it('declares nothing inside a cascade layer', () => {
      // Not a style preference. Layered rules lose to Tailwind's own layered
      // tokens by layer order, so this would disable the entire brand.
      expect(CSS).not.toMatch(/@layer/);
    });

    it('is imported after globals.css in the root layout', () => {
      const layout = readFileSync(path.join(process.cwd(), 'app', 'layout.tsx'), 'utf8');
      const globals = layout.indexOf("'@/app/globals.css'");
      const brand = layout.indexOf("'@/app/brand-theme.css'");
      expect(globals).toBeGreaterThanOrEqual(0);
      expect(brand).toBeGreaterThan(globals);
    });
  });

  describe('surface isolation — /admin must be untouched', () => {
    it('scopes every rule to the consumer surface', () => {
      // Split into compounds first. A grouped selector — `[data-surface=
      // 'consumer'] .x, .brand-display { … }` — starts with the scope while its
      // second half repaints /admin, which is precisely the escape this test
      // exists to catch, and a `startsWith` on the whole string waves it through.
      const escaped = RULES.flatMap((rule) =>
        compounds(rule.selector).filter((compound) => !compound.startsWith(LIGHT_SCOPE))
      );
      expect(escaped).toEqual([]);
    });

    it('splits a selector list only at its top level', () => {
      // The halo rule's `:is(p, h1, …)` is why the split is depth-aware: a plain
      // split on `,` would fail the case above on a rule that is scoped.
      expect(compounds('[a] :is(p, h1), [b] x')).toEqual(['[a] :is(p, h1)', '[b] x']);
    });

    it('declares nothing at :root', () => {
      // `:root` IS `<html>`, the same element carrying data-surface — so a
      // `:root` block here would repaint the admin as well.
      expect(CSS).not.toMatch(/:root/);
    });

    it('never targets the admin surface', () => {
      expect(CSS).not.toMatch(/data-surface=['"]admin['"]/);
    });
  });

  describe('light and dark are both complete', () => {
    it('gives every dark token a light twin', () => {
      const orphans = [...darkTokens.keys()].filter((name) => !lightTokens.has(name));
      expect(orphans).toEqual([]);
    });

    it('does not restate tokens the two themes share', () => {
      // Keeps the dark block honest: a token repeated with an IDENTICAL value is
      // a second place to update, and the two will drift.
      const redundant = [...darkTokens].filter(([name, value]) => lightTokens.get(name) === value);
      expect(redundant.map(([name]) => name)).toEqual([]);
    });

    it('uses the compound dark selector, not the descendant form', () => {
      // `.dark` sits on <html> beside data-surface. The descendant form
      // (`.dark [data-surface='consumer']`) matches nothing at this level, and
      // the whole surface would render light-on-light in dark mode.
      expect(CSS).toContain(DARK_SCOPE);
      expect(CSS).not.toMatch(/\.dark\s+\[data-surface/);
    });

    it('flips color-scheme with the theme', () => {
      expect(ruleFor(LIGHT_SCOPE).body).toMatch(/color-scheme:\s*light/);
      expect(ruleFor(DARK_SCOPE).body).toMatch(/color-scheme:\s*dark/);
    });
  });

  describe('the prism families (t-177)', () => {
    // The families the prism introduced. Each must have a LIGHT value — the
    // orphan check above only catches a dark-only token, not one that was
    // never declared at all, and a missing `--glow-2` renders as nothing.
    const FAMILIES = [
      '--color-ground',
      '--glow-1',
      '--glow-2',
      '--glow-3',
      '--fold',
      '--ray-core',
      '--ray-warm',
      '--ray-cool',
      '--ray-blend',
      '--ray-opacity',
      '--spark',
      '--veil',
      '--ground-halo',
      '--glass',
      '--color-sheet',
      '--read-background',
      '--read-card',
      '--read-muted',
      '--app-background',
      '--app-card',
      '--app-muted',
    ];

    it.each(FAMILIES)('declares %s in light', (name) => {
      expect(lightTokens.has(name)).toBe(true);
    });

    it.each(FAMILIES.filter((name) => name !== '--glass'))(
      'moves %s in dark, where the prism lights the page differently',
      (name) => {
        // Every one of these changes between the themes in the prototype; one
        // left unrestated would paint the light theme's glow on the umber.
        expect(darkTokens.has(name)).toBe(true);
      }
    );

    it('keeps the glass the same in both themes', () => {
      expect(darkTokens.has('--glass')).toBe(false);
    });

    it('screens the light onto the ground in dark only', () => {
      expect(token(lightTokens, '--ray-blend')).toBe('normal');
      expect(token(darkTokens, '--ray-blend')).toBe('screen');
    });

    it('stands the sparks down in dark, and only in dark', () => {
      // The ruling in the stylesheet: no spark brightness keeps muted text at
      // 4.5:1 where a spark sits behind it on the umber, so the dark spark is
      // transparent. The light spark only ever RAISES dark text's contrast.
      expect(rgbaParts(token(darkTokens, '--spark')).alpha).toBe(0);
      expect(rgbaParts(token(lightTokens, '--spark')).alpha).toBeGreaterThan(0);
    });

    it('would fail if the dark spark were the prototype’s', () => {
      // The negative control for the ruling above, measured the way the text
      // guards below measure: the prototype's spark over the dark veil.
      const withSpark = new Map(darkResolved);
      withSpark.set('--spark', 'rgba(255, 228, 196, 0.65)');
      const ground = token(withSpark, '--color-ground');
      const sparked = flattenOver(
        token(withSpark, '--spark'),
        flattenOver(token(withSpark, '--veil'), ground),
        { blend: 'screen' }
      );
      expect(contrastRatio(token(darkResolved, '--color-muted-foreground'), sparked)).toBeLessThan(
        4.5
      );
    });

    it('lifts the halo in light and drops it in dark', () => {
      expect(token(lightTokens, '--ground-halo')).toContain('var(--color-ground)');
      expect(token(darkTokens, '--ground-halo')).toBe('none');
    });
  });

  describe('the page, the sheets and the glass', () => {
    it('paints the page with the opaque ground', () => {
      // `globals.css` paints <body> with `--color-background`, which is glass in
      // the prism; glass over nothing is the browser's white.
      expect(ruleFor(`${LIGHT_SCOPE} body`).body).toMatch(
        /background-color:\s*var\(--color-ground\)/
      );
      expect(rgbaParts(token(lightTokens, '--color-ground')).alpha).toBe(1);
      expect(rgbaParts(token(darkTokens, '--color-ground')).alpha).toBe(1);
    });

    it('makes every dialog a solid sheet', () => {
      // A dialog's ground is `bg-background`; as glass it would show the page
      // through the dialog. Each glass token is re-pointed at an opaque one.
      const rule = RULES.find((candidate) => candidate.selector.includes("[role='dialog']"));
      expect(compounds(rule?.selector ?? '')).toEqual([
        `${LIGHT_SCOPE} [role='dialog']`,
        `${LIGHT_SCOPE} [role='alertdialog']`,
      ]);
      const sheet = customProperties(rule?.body ?? '');
      for (const name of ['--color-background', '--color-card', '--color-muted']) {
        const target = token(sheet, name).match(/^var\((--[\w-]+)\)$/)?.[1];
        expect(target, `${name} inside a dialog`).toBeDefined();
        for (const theme of THEMES) {
          expect(rgbaParts(token(scopeFor(theme), target as string)).alpha).toBe(1);
        }
      }
    });

    it('gives a card the glass blur, from the token', () => {
      expect(ruleFor(`${LIGHT_SCOPE} .bg-card`).body).toMatch(/backdrop-filter:\s*var\(--glass\)/);
    });

    it('puts the halo on site text only', () => {
      // Keyed on the site's ground, so the shell's panes carry no halo.
      const halo = RULES.find((rule) => rule.body.includes('var(--ground-halo)'));
      expect(halo?.selector).toContain("[data-prism='site']");
    });
  });

  describe('text clears WCAG AA over the light (D5, t-177)', () => {
    // Body text, secondary text and links, on every ground they land on, in
    // each theme. `%s` three times: a failure names the ink, theme and ground.
    it.each(GROUND_PAIRINGS.flatMap(([theme, ground]) => INKS.map((ink) => [ink, theme, ground])))(
      '%s in %s on %s',
      (ink, theme, ground) => {
        const ratio = worstContrast(
          token(scopeFor(theme as Theme), ink),
          paintedAs(theme as Theme, ground)
        );
        expect(ratio).toBeGreaterThanOrEqual(4.5);
      }
    );

    it.each(THEMES.flatMap((theme) => INKS.map((ink) => [ink, theme])))(
      '%s in %s straight on the ground, inside the veil',
      (ink, theme) => {
        const ratio = worstContrast(
          token(scopeFor(theme as Theme), ink),
          litGrounds(theme as Theme, [true])
        );
        expect(ratio).toBeGreaterThanOrEqual(4.5);
      }
    );

    it('would fail on the bare ground outside the veil', () => {
      // The negative control, and the reason the ground keys its veil to the
      // reading column: without it, links at a line's edge fall below AA in
      // light, and muted text far below it in dark.
      expect(
        worstContrast(token(lightTokens, '--color-secondary-ink'), litGrounds('light', [false]))
      ).toBeLessThan(4.5);
      expect(
        worstContrast(token(darkResolved, '--color-muted-foreground'), litGrounds('dark', [false]))
      ).toBeLessThan(4.5);
    });

    it('measures over a light that is actually lit', () => {
      // Proves the model is not inert: a glow, a ray and the veil each move the
      // ground. If `litGrounds` ever returned only the ground, every case above
      // would be measuring the flat page the prism replaced.
      for (const theme of THEMES) {
        const grounds = new Set(litGrounds(theme, [false, true]));
        expect(grounds.size).toBeGreaterThan(20);
        expect(grounds.has(token(scopeFor(theme), '--color-ground'))).toBe(true);
      }
    });
  });

  describe('controls are visible (t-18)', () => {
    // Every assertion below pairs a mark against the grounds it lands on,
    // because that is what WCAG 1.4.11 governs. Two adjacencies are knowingly
    // outside them: `--color-input` against `--color-primary` (a <Switch>'s
    // off-track beside its on-track), and `--color-ring` against a filled
    // button's own fill — which `components/app/ui/button.tsx` closes with an
    // offset outline, so the indicator clears the ground instead.

    it.each(THEMES)('%s: a pale label on a filled destructive button at AA', (theme) => {
      // The fill holds across both themes; the label is each theme's own.
      const ratio = contrastRatio(
        token(scopeFor(theme), '--color-destructive-foreground'),
        token(lightTokens, '--color-destructive')
      );
      expect(ratio).toBeGreaterThanOrEqual(4.5);
    });

    // `--color-destructive` has two roles pulling opposite ways: a FILL dark
    // enough to hold its label, and INK light enough to read on the umber. The
    // ink role is sent to `--color-status-red-ink` by a rule after the dark
    // block, so the guards below read the status ink, because that is what
    // paints.

    it.each(GROUND_PAIRINGS)('%s: destructive TEXT on a bare %s', (theme, ground) => {
      const ratio = worstContrast(
        token(scopeFor(theme), '--color-status-red-ink'),
        paintedAs(theme, ground)
      );
      expect(ratio).toBeGreaterThanOrEqual(4.5);
    });

    // The grounds an error BANNER can appear on. Not the popover or a read
    // ground: no component renders `bg-destructive/10` there.
    const BANNER_GROUNDS = ['--color-background', '--color-card', '--color-muted'];

    it.each(
      BANNER_GROUNDS.flatMap((ground) => [['light', ground] as const, ['dark', ground] as const])
    )('%s: destructive TEXT on a bg-destructive/10 wash over %s', (theme, ground) => {
      // The wash eats margin the bare-ground guard above cannot see. The FILL is
      // read from the light block in both themes, because it holds across both.
      const washes = paintedAs(theme, ground).map((painted) =>
        washOver(token(lightTokens, '--color-destructive'), 0.1, painted)
      );
      expect(
        worstContrast(token(scopeFor(theme), '--color-status-red-ink'), washes)
      ).toBeGreaterThanOrEqual(4.5);
    });

    it('sends the destructive TEXT role away from the fill', () => {
      // The measurement above is only about what ships if this rule exists and
      // points where it says. Delete the rule and `text-destructive` silently
      // falls back to the fill value, with nothing else noticing.
      const rule = ruleFor(`${LIGHT_SCOPE} .text-destructive`);
      expect(rule.body).toMatch(/color:\s*var\(--color-status-red-ink\)/);
      expect(token(lightTokens, '--color-status-red-ink')).not.toBe(
        token(lightTokens, '--color-destructive')
      );
    });

    it('would fail if the ink role were left on the fill', () => {
      // The fill value is what `text-destructive` resolves to without the rule,
      // and in dark on the popover it is far below AA.
      expect(
        contrastRatio(
          token(lightTokens, '--color-destructive'),
          token(darkTokens, '--color-popover')
        )
      ).toBeLessThan(4.5);
    });

    it('holds the destructive fill across both themes', () => {
      // A dark-only restatement is how a 2.99:1 pairing once got in — the status
      // red lightens for its badge, and that lighter value under a label fails.
      expect(darkTokens.has('--color-destructive')).toBe(false);
      expect(darkTokens.has('--color-destructive-foreground')).toBe(false);
    });

    it.each(GROUND_PAIRINGS)('%s: the control boundary on %s clears 1.4.11', (theme, ground) => {
      // `--color-input` is the edge of <Input>, <Textarea>, <SelectTrigger>,
      // <Checkbox> and the outline <Button>, and the off-track FILL of
      // <Switch>. WCAG 1.4.11 asks 3:1 of anything needed to identify a control.
      const ratio = worstContrastOn(
        token(scopeFor(theme), '--color-input'),
        paintedAs(theme, ground)
      );
      expect(ratio).toBeGreaterThanOrEqual(3);
    });

    it.each(GROUND_PAIRINGS)('%s: the focus ring on %s clears 1.4.11', (theme, ground) => {
      // The ring is a state indicator, so the same 3:1 applies — and it is the
      // one that matters most, because a focus ring is the only thing telling
      // a keyboard user where they are.
      const ratio = worstContrastOn(
        token(scopeFor(theme), '--color-ring'),
        paintedAs(theme, ground)
      );
      expect(ratio).toBeGreaterThanOrEqual(3);
    });

    it('keeps the focus ring on the secondary ink in both themes', () => {
      // The ring is declared as a hex so this file can measure it, which means
      // the two can drift — this is what notices.
      expect(token(lightTokens, '--color-ring')).toBe(token(lightTokens, '--color-secondary-ink'));
      expect(token(darkTokens, '--color-ring')).toBe(token(darkTokens, '--color-secondary-ink'));
    });

    it('leaves the decorative hairline at the prism’s alphas', () => {
      // The whole point of moving `--color-input` alone was NOT to coarsen the
      // rest. A later "just make the borders 3:1 too" would repaint every card
      // and divider in the product, so it fails here first.
      expect(token(lightTokens, '--color-border')).toBe('rgba(92, 74, 82, 0.2)');
      expect(token(lightTokens, '--color-divider')).toBe('rgba(92, 74, 82, 0.12)');
      expect(token(darkTokens, '--color-border')).toBe('rgba(242, 214, 190, 0.16)');
      expect(token(darkTokens, '--color-divider')).toBe('rgba(242, 214, 190, 0.09)');
    });

    it('would fail if the boundary or the ring were left on the decorative values', () => {
      // Proves the measurements above can actually fail. Without it they pass
      // for free if `contrastOn` ever returned something inert.
      expect(
        worstContrastOn(token(lightTokens, '--color-border'), paintedAs('light', '--color-muted'))
      ).toBeLessThan(3);
      expect(
        worstContrastOn(token(darkTokens, '--color-border'), paintedAs('dark', '--color-card'))
      ).toBeLessThan(3);
      // The prism's own `.input` edge is the hairline; that is the deviation.
      expect(
        worstContrastOn('rgba(31, 26, 28, 0.4)', paintedAs('light', '--color-muted'))
      ).toBeLessThan(3);
    });

    it('composites an alpha rather than measuring the channels raw', () => {
      // The helper is load-bearing: read raw, a hairline's channels measure as
      // if it were opaque, and every boundary assertion above would pass while
      // the line stayed invisible.
      expect(flattenOver('rgba(17, 24, 26, 0.5)', '#f3f0ec')).toBe('#828483');
      expect(flattenOver('#a95146', '#f3f0ec')).toBe('#a95146');
      expect(() => flattenOver('oklch(0.5 0 0)', '#f3f0ec')).toThrow(/cannot composite/);
      expect(washOver('#a95146', 0.1, '#f3f0ec')).toBe('#ece0db');
      // And the screen blend the dark rays use: white screened is white, black
      // screened is the ground, at full strength.
      expect(flattenOver('#ffffff', '#2c2421', { blend: 'screen', opacity: 1 })).toBe('#ffffff');
      expect(flattenOver('#000000', '#2c2421', { blend: 'screen', opacity: 1 })).toBe('#2c2421');
    });
  });

  describe('a filled control is still legible while you are on it (t-2)', () => {
    // shadcn writes a filled button's hover as a 90% alpha of its own fill,
    // which composites against whatever is behind it and lands somewhere nobody
    // measured. The fix is a hover TOKEN per filled variant, which is a known
    // colour and therefore measurable. That the COMPONENT reaches for the token
    // rather than the alpha is asserted in
    // `tests/unit/components/app/ui/button.test.tsx`.
    //
    // The prism moves the primary and secondary fills between themes, so each
    // theme is measured against its own fill, hover and label.

    const FILLED_VARIANTS = [
      ['primary', '--color-primary', '--color-primary-hover', '--color-primary-foreground'],
      ['secondary', '--color-secondary', '--color-secondary-hover', '--color-secondary-foreground'],
      [
        'destructive',
        '--color-destructive',
        '--color-destructive-hover',
        '--color-destructive-foreground',
      ],
    ] as const;

    const VARIANT_THEMES = FILLED_VARIANTS.flatMap((variant) =>
      THEMES.map((theme) => [...variant, theme] as const)
    );

    it.each(VARIANT_THEMES)(
      '%s carries its label on the hover fill (%s, %s, %s, %s)',
      (_name, _rest, hover, ink, theme) => {
        const scope = scopeFor(theme);
        expect(contrastRatio(token(scope, ink), token(scope, hover))).toBeGreaterThanOrEqual(4.5);
      }
    );

    it.each(VARIANT_THEMES)(
      '%s carries its label at rest (%s, %s, %s, %s)',
      (_name, rest, _hover, ink, theme) => {
        const scope = scopeFor(theme);
        expect(contrastRatio(token(scope, ink), token(scope, rest))).toBeGreaterThanOrEqual(4.5);
      }
    );

    it.each(VARIANT_THEMES)(
      '%s hovers DARKER than it rests (%s, %s, %s, %s)',
      (_name, rest, hover, ink, theme) => {
        // The direction is the property, not the threshold. A hover that deepens
        // can only IMPROVE a label's contrast — so this is what stops a future
        // edit satisfying the case above with a value that happens to clear 4.5
        // while lifting off the resting colour.
        const scope = scopeFor(theme);
        const atRest = contrastRatio(token(scope, ink), token(scope, rest));
        const onHover = contrastRatio(token(scope, ink), token(scope, hover));
        expect(onHover).toBeGreaterThan(atRest);
      }
    );

    it('restates a hover in dark exactly when its fill moves', () => {
      // A fill restated in dark with no hover beside it would hover to the
      // LIGHT theme's step of a different colour — which is the 3.84:1 defect
      // t-2 found, arriving by another route.
      for (const [, rest, hover] of FILLED_VARIANTS) {
        expect(darkTokens.has(hover), hover).toBe(darkTokens.has(rest));
      }
    });

    it('would fail on a hover that lifts', () => {
      // The negative control: the dark primary's resting fill used as the light
      // primary's hover is LIGHTER than rest, and the direction case catches it.
      const ink = token(lightTokens, '--color-primary-foreground');
      expect(contrastRatio(ink, token(darkTokens, '--color-primary'))).toBeLessThan(
        contrastRatio(ink, token(lightTokens, '--color-primary'))
      );
    });

    it('puts a label on a selected chip at AA, which the named heather does not', () => {
      // The heather is named for reading, not for sitting on: as a fill it is
      // 4.25:1. `--color-selected` is that hue three points darker, and a token
      // of its own because the status hues LIGHTEN in dark mode for badge use.
      const ink = token(lightTokens, '--color-selected-foreground');
      expect(contrastRatio(ink, token(lightTokens, '--color-selected'))).toBeGreaterThanOrEqual(
        4.5
      );
      expect(contrastRatio(ink, token(lightTokens, '--color-selected-hover'))).toBeGreaterThan(
        contrastRatio(ink, token(lightTokens, '--color-selected'))
      );
      expect(darkTokens.has('--color-selected')).toBe(false);
      // The negative control: the named heather is what this replaced.
      expect(contrastRatio(ink, token(lightTokens, '--color-status-purple'))).toBeLessThan(4.5);
    });

    it.each(GROUND_PAIRINGS)('%s: the info banner reads on %s', (theme, ground) => {
      // `Banner`'s `info` tone: the ink on the wash it is painted on, over every
      // colour the ground under that wash can be.
      const scope = scopeFor(theme);
      const washes = paintedAs(theme, ground).map((painted) =>
        flattenOver(token(scope, '--color-status-blue-bg'), painted)
      );
      expect(worstContrast(token(scope, '--color-status-blue-ink'), washes)).toBeGreaterThanOrEqual(
        4.5
      );
      // The base carries the dot and the edge, which are non-text (1.4.11).
      expect(
        worstContrastOn(token(scope, '--color-status-blue'), paintedAs(theme, ground))
      ).toBeGreaterThanOrEqual(3);
    });

    it('gives the lotus its own values rather than borrowing UI roles', () => {
      // The bloom is a MARK. `--color-secondary` is byte-identical to the outer
      // petal today and is a UI role that can be re-tuned for contrast. This
      // pins the prism's iris and rose-gold on the lotus tokens themselves.
      expect(token(lightTokens, '--color-lotus-petal-outer')).toBe('#55609a');
      expect(token(lightTokens, '--color-lotus-petal-mid')).toBe('#7f86be');
      expect(token(lightTokens, '--color-lotus-petal-inner')).toBe('#b4bce4');
      expect(token(lightTokens, '--color-lotus-core')).toBe('#b86e4c');
      // A mark does not change between modes, so none of them is restated —
      // and the still marks are baked once on the strength of it.
      const lotusInDark = [...darkTokens.keys()].filter((name) => name.startsWith('--color-lotus'));
      expect(lotusInDark).toEqual([]);
    });

    it('holds the cinema across both themes', () => {
      // A cinema is dark whatever the page is, so none of it is restated.
      const cinemaInDark = [...darkTokens.keys()].filter((name) =>
        name.startsWith('--color-cinema')
      );
      expect(cinemaInDark).toEqual([]);
    });
  });

  describe('typography', () => {
    it('maps the three next/font variables onto the font tokens', () => {
      expect(token(lightTokens, '--font-sans')).toContain('var(--font-brand-sans)');
      expect(token(lightTokens, '--font-serif')).toContain('var(--font-brand-display)');
      expect(token(lightTokens, '--font-quote')).toContain('var(--font-brand-quote)');
    });

    it('gives every family a fallback stack', () => {
      // A bare `var(--font-brand-sans)` renders in the browser default for the
      // whole of the font's load, and forever if the load fails.
      for (const name of ['--font-sans', '--font-serif', '--font-quote']) {
        expect(token(lightTokens, name).split(',').length).toBeGreaterThan(1);
      }
    });

    it('ships the four registers as consumer-scoped classes', () => {
      for (const register of ['brand-display', 'brand-quote', 'brand-eyebrow', 'brand-num']) {
        expect(RULES.some((rule) => rule.selector === `${LIGHT_SCOPE} .${register}`)).toBe(true);
      }
    });

    it('lets a utility set the colour of every register', () => {
      // These rules are unlayered, so they beat Tailwind utilities on the same
      // element — and `@layer utilities` is where ARBITRARY values land too, so
      // even `text-[var(--color-heading)]` would lose. A `color` here could
      // therefore not be overridden by any class at all. Type is the register's;
      // colour is the caller's.
      for (const register of ['brand-display', 'brand-quote', 'brand-eyebrow', 'brand-num']) {
        expect(ruleFor(`${LIGHT_SCOPE} .${register}`).body).not.toMatch(/(^|[\s;]) *color:/);
      }
    });

    it('does not force casing on the eyebrow', () => {
      // §6.10 says eyebrows MAY be lowercase; forcing it would strip the capital
      // from Lelañea's name wherever an eyebrow carries it.
      expect(ruleFor(`${LIGHT_SCOPE} .brand-eyebrow`).body).not.toMatch(/text-transform/);
    });
  });
});
