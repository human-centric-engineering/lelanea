/**
 * Every colour in `components/app/ui/` comes from a token.
 *
 * The design kit hard-codes its palette into each component — twelve hexes in
 * `Banner`, eleven in `Lotus`, a light-mode-only set in `Card`. That is correct
 * for a kit, which has no stylesheet to belong to, and wrong here for two
 * reasons that only show up later: a literal cannot follow the theme, so a
 * banner built that way paints a pale wash with dark text on a charcoal page;
 * and a literal is invisible to `tests/unit/app/brand-theme.test.ts`, which is
 * where every contrast ruling in this product is measured. A colour that file
 * cannot see is a colour nobody is checking.
 *
 * So the rule is absolute rather than nearly absolute, and that is what made
 * `--color-lotus-*` worth adding: the alternative was exempting `lotus.tsx`,
 * which is the one file in the directory that would most have needed the guard.
 *
 * SCANNED WITH COMMENTS STRIPPED, the same way the stylesheet's own test strips
 * them. These files document the contrast arithmetic they descend from — the
 * amethyst that measured 4.25:1, the dark hover that measured 3.84:1 — and
 * without stripping, every one of those explanations would read as the defect it
 * is explaining.
 */
import { readFileSync, readdirSync } from 'node:fs';
import path from 'node:path';

import { describe, expect, it } from 'vitest';

const UI_DIR = path.join(process.cwd(), 'components', 'app', 'ui');

/** `#abc`, `#abcdef`, `#abcdef12` — anything a browser reads as a colour. */
const HEX_LITERAL = /#[0-9a-f]{3,8}\b/gi;

/**
 * `rgb()` / `rgba()` / `hsl()` with numeric channels.
 *
 * The hex rule alone would be trivially sidestepped by writing the same colour
 * a different way, and the kit does exactly that for its washes and its ripple
 * opacities.
 */
const FUNCTIONAL_COLOUR = /\b(?:rgb|rgba|hsl|hsla)\(\s*[\d.]/gi;

function stripComments(source: string): string {
  return source.replace(/\/\*[\s\S]*?\*\//g, '').replace(/^\s*\/\/.*$/gm, '');
}

function sourceFiles(): string[] {
  return readdirSync(UI_DIR)
    .filter((name) => /\.(tsx?|css)$/.test(name))
    .sort();
}

describe('components/app/ui — colour comes from tokens, never from a literal', () => {
  it('has files to scan', () => {
    // Without this the whole suite passes on an empty directory, which is
    // exactly what it would do if the folder were ever renamed. `.every` over
    // nothing is `true`.
    const files = sourceFiles();
    expect(files.length).toBeGreaterThanOrEqual(8);
    expect(files).toContain('lotus.tsx');
    expect(files).toContain('button.tsx');
  });

  it.each(sourceFiles())('%s declares no colour of its own', (file) => {
    const code = stripComments(readFileSync(path.join(UI_DIR, file), 'utf8'));
    expect(code.match(HEX_LITERAL) ?? []).toEqual([]);
    expect(code.match(FUNCTIONAL_COLOUR) ?? []).toEqual([]);
  });

  it('would catch a literal that was added tomorrow', () => {
    // The negative control. Both patterns are proved to fire, and the comment
    // stripper is proved NOT to hide a literal that is actually in the code —
    // the failure mode of a guard that pre-processes its input.
    expect(stripComments('const a = 1;').match(HEX_LITERAL) ?? []).toEqual([]);
    expect(stripComments("fill: '#17718A'").match(HEX_LITERAL)).toEqual(['#17718A']);
    expect(stripComments("stroke: 'rgba(69,123,106,0.55)'").match(FUNCTIONAL_COLOUR)).toHaveLength(
      1
    );
    // A hex inside prose is stripped; a hex on a line of code beside prose is not.
    expect(stripComments('/* #806C7B was 4.25:1 */').match(HEX_LITERAL) ?? []).toEqual([]);
    expect(stripComments("const x = '#806c7b'; // was 4.25:1").match(HEX_LITERAL)).toEqual([
      '#806c7b',
    ]);
  });

  it('reads the tokens it relies on out of the stylesheet', () => {
    // The other half of the rule, and the half a grep cannot express: a
    // `var(--color-…)` that names a token nothing declares resolves to nothing
    // and paints the inherited colour, which on a fill means an invisible
    // button. So every token these components reference must actually exist.
    const stylesheet = readFileSync(path.join(process.cwd(), 'app', 'brand-theme.css'), 'utf8');
    const globals = readFileSync(path.join(process.cwd(), 'app', 'globals.css'), 'utf8');
    const declared = new Set(
      [...`${stylesheet}\n${globals}`.matchAll(/(--[\w-]+)\s*:/g)].map((match) => match[1])
    );

    const referenced = new Set<string>();
    for (const file of sourceFiles()) {
      const code = stripComments(readFileSync(path.join(UI_DIR, file), 'utf8'));
      for (const match of code.matchAll(/var\((--[\w-]+)\)/g)) referenced.add(match[1]);
    }

    expect(referenced.size).toBeGreaterThan(10);
    expect([...referenced].filter((name) => !declared.has(name))).toEqual([]);
  });
});
