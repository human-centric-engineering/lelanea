/**
 * Unit Tests: `components/app/ui/tints.css` — the temporary picker's tints
 * (f-prism t-180; deleted with the picker by t-181).
 *
 * A tint is a candidate set of token values, and the picker offers it to
 * Lelañea as a choice for the brand. So each one is held to what the palette
 * itself is held to: body text, secondary text and links clear 4.5:1 over the
 * light it makes, measured the way `tests/unit/app/brand-theme.test.ts`
 * measures the palette (`tests/helpers/app/prism-light.ts`). A tint that does
 * not clear is not offered.
 *
 * Also pinned: every tint the catalogue (`tints.ts`) names has a block and a
 * swatch here and nothing else does, and a block moves only the ground, glow
 * and fold — never an ink or a glass ground, which would put the palette's
 * measured values out of reach of this test.
 */
import { readFileSync } from 'node:fs';
import path from 'node:path';

import { describe, expect, it } from 'vitest';

import { DEFAULT_TINT, namedTints, TINTS, type TintTheme } from '@/components/app/ui/tints';
import {
  customProperties,
  INKS,
  litGrounds,
  paintedAs,
  paletteScopes,
  parseRules,
  SHELL_GROUNDS,
  SHELL_VEIL,
  SITE_VEIL,
  stripCssComments,
  token,
  worstContrast,
} from '@/tests/helpers/app/prism-light';

const RULES = parseRules(
  stripCssComments(
    readFileSync(path.join(process.cwd(), 'components', 'app', 'ui', 'tints.css'), 'utf8')
  )
);

const SELECTOR: Record<TintTheme, (id: string) => string> = {
  light: (id) => `[data-surface='consumer'][data-tint='${id}']:not(.dark)`,
  dark: (id) => `[data-surface='consumer'].dark[data-tint-dark='${id}']`,
};

/** What a tint is allowed to move: the light, and nothing a word is drawn in. */
const TINT_TOKENS = ['--color-ground', '--glow-1', '--glow-2', '--glow-3', '--fold'];

const THEMES = ['light', 'dark'] as const;

const PALETTE = paletteScopes();

function blockFor(theme: TintTheme, id: string): Map<string, string> {
  const rule = RULES.find((candidate) => candidate.selector === SELECTOR[theme](id));
  if (!rule) throw new Error(`tints.css has no block for the ${theme} tint \`${id}\``);
  return customProperties(rule.body);
}

/** The theme's palette with the tint's block over it, as the page resolves it. */
function tinted(theme: TintTheme, id: string): Map<string, string> {
  return new Map([...PALETTE[theme], ...blockFor(theme, id)]);
}

/** The glass grounds of the site, which the tint shows through. */
const SITE_GROUNDS = ['--color-background', '--color-card', '--color-muted'];

const OFFERED = THEMES.flatMap((theme) => namedTints(theme).map((id) => [theme, id] as const));

describe('the tint picker’s tints', () => {
  it('offers more than the prototype in both themes', () => {
    // The owner's ruling (3 Nov 2026): more than the prototype's four lights,
    // and dark variants where it had one.
    expect(TINTS.light.length).toBeGreaterThan(4);
    expect(TINTS.dark.length).toBeGreaterThan(1);
    for (const theme of THEMES) expect(TINTS[theme][0].id).toBe(DEFAULT_TINT);
  });

  it('has a block and a swatch for every tint it names, and nothing else', () => {
    const blocks = RULES.filter((rule) => !rule.selector.includes('data-swatch')).map(
      (rule) => rule.selector
    );
    expect(blocks.sort()).toEqual(OFFERED.map(([theme, id]) => SELECTOR[theme](id)).sort());
    const swatches = RULES.flatMap((rule) =>
      [...rule.selector.matchAll(/data-swatch='([\w-]+)'/g)].map((match) => match[1])
    );
    expect(swatches.sort()).toEqual(
      THEMES.flatMap((theme) => TINTS[theme].map((tint) => `${theme}-${tint.id}`)).sort()
    );
  });

  it.each(OFFERED)('the %s tint %s moves only the light', (theme, id) => {
    expect([...blockFor(theme, id).keys()].sort()).toEqual([...TINT_TOKENS].sort());
  });

  it.each(OFFERED)('the %s tint %s really is a different light', (theme, id) => {
    // A block that restated the default would pass every contrast case below
    // while offering nothing to choose.
    expect(token(tinted(theme, id), '--color-ground')).not.toBe(
      token(PALETTE[theme], '--color-ground')
    );
  });

  describe('every offered tint clears 4.5:1, as the palette does', () => {
    const cases = OFFERED.flatMap(([theme, id]) => INKS.map((ink) => [theme, id, ink] as const));

    it.each(cases)('%s %s: %s on the site’s glass', (theme, id, ink) => {
      const scope = tinted(theme, id);
      const grounds = SITE_GROUNDS.flatMap((ground) => paintedAs(scope, ground, SITE_VEIL));
      expect(worstContrast(token(scope, ink), grounds)).toBeGreaterThanOrEqual(4.5);
    });

    it.each(cases)('%s %s: %s straight on the ground, inside the veil', (theme, id, ink) => {
      const scope = tinted(theme, id);
      expect(worstContrast(token(scope, ink), litGrounds(scope, [1]))).toBeGreaterThanOrEqual(4.5);
    });

    it.each(cases)('%s %s: %s in the shell', (theme, id, ink) => {
      const scope = tinted(theme, id);
      const grounds = SHELL_GROUNDS.flatMap((ground) => paintedAs(scope, ground, SHELL_VEIL));
      expect(worstContrast(token(scope, ink), grounds)).toBeGreaterThanOrEqual(4.5);
    });

    it('would refuse a tint whose light is too bright behind dark-mode text', () => {
      // The negative control: the model is not inert for a tint. A dark ground
      // lit by a near-white glow takes muted text below AA.
      const scope = new Map(PALETTE.dark);
      scope.set('--glow-1', 'rgba(250, 240, 230, 0.9)');
      expect(
        worstContrast(token(scope, '--color-muted-foreground'), litGrounds(scope, [1]))
      ).toBeLessThan(4.5);
    });
  });
});
