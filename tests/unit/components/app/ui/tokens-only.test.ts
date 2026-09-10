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
import { readdirSync, readFileSync } from 'node:fs';
import path from 'node:path';

import { describe, expect, it } from 'vitest';

/**
 * SCANNED RECURSIVELY FROM `components/app/`, not just `components/app/ui/`.
 *
 * The rule below was written for the kit, but nothing in its reasoning is about
 * the kit: a literal cannot follow the theme, and a literal is invisible to
 * `tests/unit/app/brand-theme.test.ts`, wherever it is written. §04 added
 * `components/app/shell/` — the largest brand surface in the product, four
 * columns of it — and a directory-scoped guard would have watched the eight
 * files that already comply while the shell went unwatched.
 *
 * Recursive rather than a second literal path, so `components/app/views/` (§04
 * t-11) and everything after it are covered on arrival rather than when someone
 * remembers to add them.
 */
const APP_DIR = path.join(process.cwd(), 'components', 'app');

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

/** Paths relative to `components/app/`, so a failure names `shell/shell-nav.tsx`. */
function sourceFiles(dir: string = APP_DIR, prefix = ''): string[] {
  const found: string[] = [];
  for (const entry of readdirSync(dir, { withFileTypes: true })) {
    const rel = prefix ? `${prefix}/${entry.name}` : entry.name;
    if (entry.isDirectory()) {
      found.push(...sourceFiles(path.join(dir, entry.name), rel));
    } else if (/\.(tsx?|css)$/.test(entry.name)) {
      found.push(rel);
    }
  }
  return found.sort();
}

describe('components/app — colour comes from tokens, never from a literal', () => {
  it('has files to scan', () => {
    // Without this the whole suite passes on an empty directory, which is
    // exactly what it would do if the folder were ever renamed. `.every` over
    // nothing is `true`.
    const files = sourceFiles();
    expect(files.length).toBeGreaterThanOrEqual(8);
    expect(files).toContain('ui/lotus.tsx');
    expect(files).toContain('ui/button.tsx');
    // The shell is the reason this scan went recursive; if it ever stops being
    // found, the widening has silently come undone and the kit alone would keep
    // this suite green.
    expect(files.some((name) => name.startsWith('shell/'))).toBe(true);
  });

  it.each(sourceFiles())('%s declares no colour of its own', (file) => {
    const code = stripComments(readFileSync(path.join(APP_DIR, file), 'utf8'));
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

  it('never names a brand token as a bare utility, which compiles to nothing', () => {
    // The `card.tsx` defect, as a rule. Tailwind 4 generates colour utilities
    // from `@theme` ONLY, and `app/brand-theme.css` is unlayered on purpose —
    // its tokens are real CSS variables and produce no classes at all. So
    // `border-card-border` emitted no rule: `border` still applied its 1px, the
    // colour fell through to the global `*` border, and every card wore a
    // hairline §6.4 forbids. Nothing failed. The class was in the source and in
    // the DOM, and only the compiled stylesheet knew it meant nothing — which is
    // why a class-name assertion in `surfaces.test.tsx` passed throughout.
    //
    // These tokens have to be reached through `var()`. That is what the rest of
    // this directory already does, and this case is what keeps it true.
    const themeBlock = /@theme[^{]*\{([\s\S]*?)\n\}/.exec(
      readFileSync(path.join(process.cwd(), 'app', 'globals.css'), 'utf8')
    );
    expect(themeBlock).not.toBeNull();
    const generated = new Set(
      [...themeBlock![1].matchAll(/--color-([\w-]+)\s*:/g)].map((match) => match[1])
    );
    expect(generated.size).toBeGreaterThan(10);

    const brandOnly = [
      ...new Set(
        [
          ...readFileSync(path.join(process.cwd(), 'app', 'brand-theme.css'), 'utf8').matchAll(
            /--color-([\w-]+)\s*:/g
          ),
        ].map((match) => match[1])
      ),
    ].filter((name) => !generated.has(name));
    // If this ever empties, the case below is vacuous rather than passing.
    expect(brandOnly).toContain('card-border');

    const UTILITY = new RegExp(
      String.raw`(?<![\w:[-])(?:[a-z-]+:)*(?:bg|text|border|ring|outline|fill|stroke|shadow|from|via|to|decoration|divide|accent|caret|placeholder)-(?:${brandOnly.join('|')})(?![\w-])`,
      'g'
    );

    const offenders: string[] = [];
    for (const file of sourceFiles()) {
      const code = stripComments(readFileSync(path.join(APP_DIR, file), 'utf8'));
      for (const match of code.matchAll(UTILITY)) offenders.push(`${file}: ${match[0]}`);
    }
    expect(offenders).toEqual([]);

    // The negative control — the pattern is proved to fire on the real defect.
    expect('border-card-border'.match(UTILITY)).toEqual(['border-card-border']);
    expect('border-[var(--color-card-border)]'.match(UTILITY) ?? []).toEqual([]);
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
      const code = stripComments(readFileSync(path.join(APP_DIR, file), 'utf8'));
      for (const match of code.matchAll(/var\((--[\w-]+)\)/g)) referenced.add(match[1]);
    }

    expect(referenced.size).toBeGreaterThan(10);
    expect([...referenced].filter((name) => !declared.has(name))).toEqual([]);
  });
});
