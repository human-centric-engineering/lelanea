/**
 * The public pages in the prism (t-178), held where the defects would hide.
 *
 * The prism prototype (`.context/app/planning/design/prism/index.html`) reaches
 * the site's modules through attribute selectors — `[class*='__tintTeal']` —
 * because a demo cannot edit the modules. Copied into the code, such a selector
 * matches a hashed class name by substring, silently stops matching when the
 * module or class is renamed, and overrides each module from outside it. So
 * every surface is changed in its own module, and the first case below keeps it
 * that way.
 *
 * Read as source, with comments stripped, for the reason
 * `public-page-styles.test.ts` gives: jsdom does no layout and a CSS module
 * under Vitest answers every key, so the stylesheet text is the only place
 * these are visible without a browser.
 */
import { readdirSync, readFileSync } from 'node:fs';
import path from 'node:path';

import { describe, expect, it } from 'vitest';

const ROOT = process.cwd();

function stripComments(source: string): string {
  return source.replace(/\/\*[\s\S]*?\*\//g, '').replace(/^\s*\/\/.*$/gm, '');
}

function filesUnder(dir: string): string[] {
  const found: string[] = [];
  for (const entry of readdirSync(path.join(ROOT, dir), { withFileTypes: true })) {
    const rel = path.join(dir, entry.name);
    if (entry.isDirectory()) found.push(...filesUnder(rel));
    else if (/\.(tsx?|css)$/.test(entry.name)) found.push(rel);
  }
  return found;
}

function css(file: string): string {
  return stripComments(readFileSync(path.join(ROOT, file), 'utf8'));
}

const HOME = 'app/(public)/home.module.css';
const DOCUMENT = 'app/(public)/document-page.module.css';
const PUBLIC_MODULES = [...filesUnder('app/(public)'), ...filesUnder('components/app/site')].filter(
  (file) => file.endsWith('.module.css')
);

describe('the public pages in the prism (t-178)', () => {
  it('scans the modules it means to', () => {
    // `.every` over nothing is true; prove the lists are populated.
    expect(PUBLIC_MODULES).toContain(HOME);
    expect(PUBLIC_MODULES).toContain(DOCUMENT);
    expect(PUBLIC_MODULES).toContain('components/app/site/atmosphere.module.css');
  });

  it('reaches no module through an attribute selector', () => {
    const offenders = [...filesUnder('app'), ...filesUnder('components/app')].filter((file) =>
      /\[class\*=/.test(stripComments(readFileSync(path.join(ROOT, file), 'utf8')))
    );
    expect(offenders).toEqual([]);
  });

  it.each(PUBLIC_MODULES)('%s names no class after the old teal', (file) => {
    const classes = [...css(file).matchAll(/\.([A-Za-z_][\w-]*)/g)].map((match) => match[1]);
    expect(classes.filter((name) => /teal/i.test(name))).toEqual([]);
  });

  it.each([
    [HOME, ['tintCool', 'tintBlush', 'tintWarm']],
    [DOCUMENT, ['tintCool', 'tintWarm']],
  ])('%s draws each band behind its section, in both themes', (file, bands) => {
    const source = css(file);
    for (const band of bands) {
      // A wash over a frosting of the sheet, in light and again in dark.
      const light = new RegExp(String.raw`(?:^|\n)\.${band}::before\s*\{[^}]*var\(--color-sheet\)`);
      const dark = new RegExp(
        String.raw`:global\(html\.dark\)\s*\.${band}::before\s*\{[^}]*var\(--color-sheet\)`
      );
      expect(source, `.${band} light wash`).toMatch(light);
      expect(source, `.${band} dark wash`).toMatch(dark);
    }
    // Translucent, not the old opaque spread shadow and clip.
    expect(source).not.toMatch(/0 0 0 100vmax/);
    expect(source).toMatch(/border-block:\s*1px solid var\(--band-line\)/);
  });

  it('draws the dusk sky in light only, and drifts it only when motion is welcome', () => {
    const source = css(HOME);
    // Every rule that paints the sky is keyed to light mode.
    const skyRules = [...source.matchAll(/([^{}]*)\.bloom::after\s*\{/g)].map((m) => m[1]);
    expect(skyRules.length).toBeGreaterThan(0);
    for (const selector of skyRules) expect(selector).toContain(':global(html:not(.dark))');

    // The drift is declared once, inside the no-preference query.
    const animated = /animation:\s*sky-light/g;
    expect(source.match(animated)).toHaveLength(1);
    const query = source.indexOf('@media (prefers-reduced-motion: no-preference)', 0);
    const drift = source.search(animated);
    const motionBlock = source.lastIndexOf('@media (prefers-reduced-motion: no-preference)', drift);
    expect(query).toBeGreaterThan(-1);
    expect(motionBlock).toBeGreaterThan(-1);
    // Nothing closes that query between its opening and the drift.
    expect(source.slice(motionBlock, drift).match(/\}/g) ?? []).toHaveLength(0);
  });

  it('closes the home page on the theme, not on deep water', () => {
    const closing = /\.closing\s*\{([^}]*)\}/.exec(css('components/app/site/atmosphere.module.css'));
    expect(closing).not.toBeNull();
    expect(closing![1]).toContain('var(--closing-base)');
    expect(closing![1]).not.toContain('--color-lotus-pad');
  });

  it("feathers the mission's water by its own mask, with no overlay in the page ground", () => {
    expect(css('components/app/site/mission-ripple.module.css')).toMatch(
      /\.water\s*\{[^}]*mix-blend-mode:\s*luminosity[^}]*mask-image:/
    );
    expect(css(DOCUMENT)).not.toMatch(/\.companion::after/);
  });
});
