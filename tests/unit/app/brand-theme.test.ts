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

/**
 * Composites a token over an opaque ground and returns the hex it PAINTS AS.
 *
 * Needed because the boundary tokens are `rgba()` — they are hairlines, and a
 * hairline is an alpha by design — while `relativeLuminance` deliberately
 * refuses anything but opaque hex, since a ratio measured against a colour with
 * an alpha still in it is not a ratio of anything on screen. An opaque token is
 * returned untouched, so a caller does not have to know which kind it has.
 */
function flattenOver(value: string, ground: string): string {
  const trimmed = value.trim();
  if (trimmed.startsWith('#')) return trimmed;

  const parts = trimmed.match(/^rgba?\(\s*(\d+)\s*,\s*(\d+)\s*,\s*(\d+)\s*(?:,\s*([\d.]+)\s*)?\)$/);
  if (!parts) throw new Error(`cannot composite \`${value}\` — not a hex or rgb()/rgba()`);

  const alpha = parts[4] === undefined ? 1 : Number.parseFloat(parts[4]);
  const base = ground.trim().replace('#', '');
  const blended = [1, 2, 3].map((channel, index) => {
    const over = Number.parseInt(parts[channel], 10);
    const under = Number.parseInt(base.slice(index * 2, index * 2 + 2), 16);
    return Math.round(alpha * over + (1 - alpha) * under);
  });
  return `#${blended.map((channel) => channel.toString(16).padStart(2, '0')).join('')}`;
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
  const [red, green, blue] = [0, 2, 4].map((offset) =>
    Number.parseInt(hex.replace('#', '').slice(offset, offset + 2), 16)
  );
  return flattenOver(`rgba(${red}, ${green}, ${blue}, ${alpha})`, ground);
}

/**
 * Every opaque ground a control or a line can land on, in either theme. The
 * page ground, a card, a sunk surface, and a popover — <FieldHelp>, <Select>
 * and <DropdownMenu> all render onto the last of these, and it is the one that
 * has twice turned out to be the tightest of the four.
 */
const GROUNDS = ['--color-background', '--color-card', '--color-muted', '--color-popover'];

/** `[theme, ground]` for every combination, for `it.each`. */
const GROUND_PAIRINGS = GROUNDS.flatMap((ground) => [
  ['light', ground] as const,
  ['dark', ground] as const,
]);

function scopeFor(theme: 'light' | 'dark'): Map<string, string> {
  return theme === 'light' ? lightTokens : darkTokens;
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

    // `%s` twice — an earlier version used `%#`, which prints the CASE INDEX, so
    // a failure read "light: secondary text on 0" and named no ground at all.
    it.each(GROUND_PAIRINGS)('%s: secondary text on %s', (theme, ground) => {
      const scope = scopeFor(theme);
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

  describe('controls are visible (t-18)', () => {
    // t-1 shipped TWO measured gaps here and raised them with the owner rather
    // than patching them, because closing either read as a palette decision.
    // Auditing the second turned up the third, the focus ring. This is that
    // decision, measured rather than restated: every number below is read out
    // of the stylesheet, so a later edit that regresses one fails here and not
    // in front of a person who cannot see it.
    //
    // WHAT THESE GUARDS COVER, and what they deliberately do not. Every
    // assertion below pairs a token against a PAGE GROUND, because that is what
    // WCAG 1.4.11 governs — the boundary or indicator against the surface
    // behind it. Two adjacencies are knowingly outside them, both recorded at
    // their site in the stylesheet with the arithmetic showing no value can
    // satisfy both constraints at once:
    //
    //   `--color-input` against `--color-primary` (a <Switch>'s off-track
    //   beside its on-track, 1.37:1), and `--color-ring` against a filled
    //   button's own fill (1.00:1 on `secondary`).
    //
    // Neither is asserted, because neither is achievable by choosing a colour,
    // and a failing assertion for an accepted trade is noise. If a future
    // change adds a ring OFFSET to our own Button, the second becomes solvable
    // and an assertion belongs here then.

    it('puts oyster on a filled destructive button at AA', () => {
      // 3.93:1 was the gap. `#A95146` is §6.2's terracotta darkened five points
      // of lightness — the same move `--color-primary` makes on the accent —
      // and measures 4.68:1. The foreground is read too: pinning only the fill
      // would let the pairing regress from the other side.
      const ratio = contrastRatio(
        token(lightTokens, '--color-destructive-foreground'),
        token(lightTokens, '--color-destructive')
      );
      expect(ratio).toBeGreaterThanOrEqual(4.5);
    });

    // `--color-destructive` has two roles pulling opposite ways: a FILL dark
    // enough to hold oyster, and INK light enough to read on charcoal.
    // Darkening the fill for the button took the ink from 2.86:1 to 2.44:1 in
    // dark mode, so the ink role is sent to `--color-status-red-ink` by a rule
    // after the dark block. Both guards below read the status ink rather than
    // the token the utility is named after, because that is what paints.

    it.each(GROUND_PAIRINGS)('%s: destructive TEXT on a bare %s', (theme, ground) => {
      // A plain `text-destructive` line with no wash behind it —
      // `components/forms/avatar-upload.tsx` renders exactly that on a card.
      const scope = scopeFor(theme);
      const ratio = contrastRatio(token(scope, '--color-status-red-ink'), token(scope, ground));
      expect(ratio).toBeGreaterThanOrEqual(4.5);
    });

    // The grounds an error BANNER can appear on. Not `--color-popover`: no
    // component renders `bg-destructive/10` inside a popover, and the wash over
    // the dark popover is the tightest number in the palette at 4.44 — so
    // asserting it would fail on a case that does not exist, while dropping the
    // threshold to accommodate it would stop guarding the three that do.
    const BANNER_GROUNDS = ['--color-background', '--color-card', '--color-muted'];

    it.each(
      BANNER_GROUNDS.flatMap((ground) => [['light', ground] as const, ['dark', ground] as const])
    )('%s: destructive TEXT on a bg-destructive/10 wash over %s', (theme, ground) => {
      // The measurement that matches what twelve form banners actually paint.
      // The wash is lighter than a dark ground, so it eats margin the bare-
      // ground guard above cannot see: dark card is 4.93 bare and 4.65 washed.
      // A future palette nudge that keeps the bare numbers at 4.5 can still
      // take the real banner under it, which is what this catches.
      const scope = scopeFor(theme);
      // The FILL is read from the light block in both themes, because it is
      // declared only there — it holds across both modes by design, which the
      // `holds the destructive fill across both themes` case below asserts.
      // Reading it from `scope` throws in dark, and that throw is how this
      // comment came to exist.
      const wash = washOver(token(lightTokens, '--color-destructive'), 0.1, token(scope, ground));
      expect(contrastRatio(token(scope, '--color-status-red-ink'), wash)).toBeGreaterThanOrEqual(
        4.5
      );
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
      // Proves the pairing above can fail: the fill value is what
      // `text-destructive` resolves to without the rule, and in dark mode on a
      // card it measures 2.01:1.
      expect(
        contrastRatio(token(lightTokens, '--color-destructive'), token(darkTokens, '--color-card'))
      ).toBeLessThan(4.5);
    });

    it('holds the destructive fill across both themes', () => {
      // §6.2: the functional colours do not change between modes. A dark-only
      // restatement is also how the 2.99:1 pairing got in — the status red
      // lightens for its badge, and that lighter value under oyster fails.
      expect(darkTokens.has('--color-destructive')).toBe(false);
      expect(darkTokens.has('--color-destructive-foreground')).toBe(false);
    });

    it.each(GROUND_PAIRINGS)('%s: the control boundary on %s clears 1.4.11', (theme, ground) => {
      // `--color-input` is the edge of <Input>, <Textarea>, <SelectTrigger>,
      // <Checkbox> and the outline <Button>, and the off-track FILL of
      // <Switch> — which is live on this surface in the cookie-consent modal,
      // so this token is not only ever a hairline. WCAG 1.4.11 asks 3:1 of
      // anything needed to identify a control. It was ~1.33:1 light and
      // ~1.45:1 dark.
      const scope = scopeFor(theme);
      const ratio = contrastOn(token(scope, '--color-input'), token(scope, ground));
      expect(ratio).toBeGreaterThanOrEqual(3);
    });

    it.each(GROUND_PAIRINGS)('%s: the focus ring on %s clears 1.4.11', (theme, ground) => {
      // The ring is a state indicator, so the same 3:1 applies — and it is the
      // one of the three that matters most, because a focus ring is the only
      // thing telling a keyboard user where they are. The ceremonial orange
      // measured 2.90 on the light card and 2.83 on the dark popover. This is
      // the ring against the GROUND it is drawn on; against a filled button's
      // own fill it is a mechanism problem, not a colour one — see the block
      // comment above.
      const scope = scopeFor(theme);
      const ratio = contrastOn(token(scope, '--color-ring'), token(scope, ground));
      expect(ratio).toBeGreaterThanOrEqual(3);
    });

    it('keeps the focus ring on the secondary ink in both themes', () => {
      // Not decoration: §6.2 gives teal and aqua the active states, and the
      // prototype focuses a field with `border-color: var(--color-secondary)`.
      // The ring is declared as a hex so this file can measure it, which means
      // the two can drift — this is what notices.
      expect(token(lightTokens, '--color-ring')).toBe(token(lightTokens, '--color-secondary-ink'));
      expect(token(darkTokens, '--color-ring')).toBe(token(darkTokens, '--color-secondary-ink'));
    });

    it('leaves the decorative hairline at the design\u2019s alphas', () => {
      // The whole point of moving `--color-input` alone was NOT to coarsen the
      // rest. §6.4: hairline 1px at 24% in light, 14% in dark, cards bordered
      // only in dark at 8%. A later "just make the borders 3:1 too" would
      // repaint every card and divider in the product, so it fails here first.
      expect(token(lightTokens, '--color-border')).toBe('rgba(111, 115, 118, 0.24)');
      expect(token(lightTokens, '--color-divider')).toBe('rgba(111, 115, 118, 0.16)');
      expect(token(lightTokens, '--color-card-border')).toBe('rgba(111, 115, 118, 0)');
      expect(token(darkTokens, '--color-border')).toBe('rgba(227, 218, 209, 0.14)');
      expect(token(darkTokens, '--color-divider')).toBe('rgba(227, 218, 209, 0.08)');
      expect(token(darkTokens, '--color-card-border')).toBe('rgba(227, 218, 209, 0.08)');
    });

    it('would fail if any of the three regressed to what t-1 shipped', () => {
      // Proves the four measurements above can actually fail. Without it they
      // pass for free if `contrastOn` ever returned something inert — which is
      // exactly what a new compositing helper is able to do.
      expect(
        contrastRatio(token(lightTokens, '--color-destructive-foreground'), '#b75d52')
      ).toBeLessThan(4.5);
      expect(
        contrastOn('rgba(111, 115, 118, 0.24)', token(lightTokens, '--color-background'))
      ).toBeLessThan(3);
      expect(
        contrastOn('rgba(227, 218, 209, 0.14)', token(darkTokens, '--color-background'))
      ).toBeLessThan(3);
      expect(contrastOn('#c96f43', token(lightTokens, '--color-card'))).toBeLessThan(3);
      expect(contrastOn('#c96f43', token(darkTokens, '--color-popover'))).toBeLessThan(3);
    });

    it('composites an alpha rather than measuring the channels raw', () => {
      // The helper is the load-bearing new thing in this file: read raw, a
      // hairline's channels measure as if it were opaque, and every boundary
      // assertion above would pass while the line stayed invisible.
      expect(flattenOver('rgba(17, 24, 26, 0.5)', '#f3f0ec')).toBe('#828483');
      expect(flattenOver('#a95146', '#f3f0ec')).toBe('#a95146');
      expect(() => flattenOver('oklch(0.5 0 0)', '#f3f0ec')).toThrow(/cannot composite/);
      // And the wash form, which is the same arithmetic reached from a hex.
      expect(washOver('#a95146', 0.1, '#f3f0ec')).toBe('#ece0db');
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
