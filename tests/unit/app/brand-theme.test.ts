/**
 * Unit Tests: `app/brand-theme.css` — the fork-owned per-surface palette
 *
 * These assert the four properties the stylesheet has to hold that a screenshot
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
 *  4. **Secondary text clears 4.5:1 in all four pairings.** The design kit's
 *     original `#6F7376` failed all four; decision D5 replaced it. The values
 *     are MEASURED from the stylesheet rather than restated here, so editing a
 *     token to something that fails is caught by this test and not by a user.
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

/** Reads a token's value from the stylesheet, so the test measures what ships. */
function token(scope: Map<string, string>, name: string): string {
  const value = scope.get(name);
  if (value === undefined) throw new Error(`brand-theme.css declares no \`${name}\``);
  return value;
}

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
      // Split on `,` first. A grouped selector — `[data-surface='consumer'] .x,
      // .brand-display { … }` — starts with the scope while its second half
      // repaints /admin, which is precisely the escape this test exists to
      // catch, and a `startsWith` on the whole string waves it through.
      const escaped = RULES.flatMap((rule) =>
        rule.selector
          .split(',')
          .map((compound) => compound.trim())
          .filter((compound) => compound.length > 0 && !compound.startsWith(LIGHT_SCOPE))
      );
      expect(escaped).toEqual([]);
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

  describe('secondary text clears WCAG AA (decision D5)', () => {
    // The four places secondary text actually lands: on the page ground and on
    // a card, in each theme. Meta lines, timestamps, hints and helper copy all
    // use it, so it is read constantly.
    // EVERY ground secondary text can land on, not just the two the plan named.
    // `--color-popover` is the one that caught a real failure: <FieldHelp>
    // renders its whole body as muted text on it, and CLAUDE.md mandates one on
    // every non-trivial form field, so it is arguably the most-read of the four.
    // Select and dropdown content share the ground.
    const GROUNDS = ['--color-background', '--color-card', '--color-muted', '--color-popover'];
    const pairings = GROUNDS.flatMap((ground) => [
      ['light', ground] as const,
      ['dark', ground] as const,
    ]);

    // `%s` twice — an earlier version used `%#`, which prints the CASE INDEX, so
    // a failure read "light: secondary text on 0" and named no ground at all.
    it.each(pairings)('%s: secondary text on %s', (theme, ground) => {
      const scope = theme === 'light' ? lightTokens : darkTokens;
      const ratio = contrastRatio(token(scope, '--color-muted-foreground'), token(scope, ground));
      expect(ratio).toBeGreaterThanOrEqual(4.5);
    });

    it('keeps the kit original only where contrast carries no meaning', () => {
      // #6F7376 measures 4.21 / 3.85 / 2.95 / 2.23 across the four pairings —
      // it is why D5 exists. It may still base the border and divider alphas.
      expect(token(lightTokens, '--color-muted-foreground')).toBe('#5a5f62');
      expect(token(darkTokens, '--color-muted-foreground')).toBe('#a8aeb1');
      expect(token(lightTokens, '--color-border')).toContain('111, 115, 118');
    });

    it('would fail if the token regressed to the kit value', () => {
      // Proves the measurement above can actually fail — without this, the four
      // assertions pass for free if `token()` ever returned something inert.
      expect(contrastRatio('#6f7376', token(lightTokens, '--color-background'))).toBeLessThan(4.5);
      expect(contrastRatio('#6f7376', token(darkTokens, '--color-card'))).toBeLessThan(4.5);
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
      // therefore not be overridden by any class at all, and
      // `<h2 class="brand-display text-secondary-ink">` would silently ignore
      // the second half. Type is the register's; colour is the caller's.
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
