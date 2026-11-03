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
const BANDS = 'components/app/site/bands.module.css';
const PUBLIC_MODULES = [...filesUnder('app/(public)'), ...filesUnder('components/app/site')].filter(
  (file) => file.endsWith('.module.css')
);

describe('the public pages in the prism (t-178)', () => {
  it('scans the modules it means to', () => {
    // `.every` over nothing is true; prove the lists are populated.
    expect(PUBLIC_MODULES).toContain(HOME);
    expect(PUBLIC_MODULES).toContain(DOCUMENT);
    expect(PUBLIC_MODULES).toContain('components/app/site/atmosphere.module.css');
    expect(PUBLIC_MODULES).toContain(BANDS);
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

  it('draws each band behind its section, in both themes', () => {
    const source = css(BANDS);
    for (const band of ['cool', 'blush', 'warm']) {
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

  it('draws the bands once, for every page that has them', () => {
    // One copy, so /lelanea and /data can never drift from the home page.
    for (const file of [HOME, DOCUMENT]) expect(css(file)).not.toMatch(/\.tint\w*::before/);
  });

  it('gives two bands that meet one shared edge, not two stacked', () => {
    // The band above draws the join; the band below drops its own top line.
    expect(css(BANDS)).toMatch(/\.band\s*\+\s*\.band::before\s*\{[^}]*border-top:\s*0/);
    // The closing band opens off the last band, so it draws no top line either.
    const closing = /\.closing\s*\{([^}]*)\}/.exec(css('components/app/site/atmosphere.module.css'));
    expect(closing![1]).not.toMatch(/border-top|box-shadow/);
  });

  it('colours the blush band from a band token, not a status colour', () => {
    expect(css(BANDS)).not.toMatch(/--color-status-/);
    expect(css(BANDS)).toMatch(/var\(--band-blush-ink\)/);
  });

  it('draws the dusk sky in light only, and drifts it only when motion is welcome', () => {
    const source = css(HOME);
    // Every rule that paints the sky is keyed to light mode.
    // Hidden by default; every rule that paints it is keyed to light mode.
    expect(source).toMatch(/(?:^|\n)\.sky\s*\{\s*display:\s*none;?\s*\}/);
    const skyRules = [...source.matchAll(/([^{}]*)\.sky(?:::(?:before|after))?\s*[,{]/g)]
      .map((m) => m[1])
      .filter((selector) => selector.trim() !== '');
    expect(skyRules.length).toBeGreaterThan(0);
    for (const selector of skyRules) expect(selector).toContain(':global(html:not(.dark))');

    // Each drift is declared once, inside the no-preference query.
    const motionBlock = source.indexOf('@media (prefers-reduced-motion: no-preference)');
    expect(motionBlock).toBeGreaterThan(-1);
    for (const name of ['sky-drift-west', 'sky-drift-east']) {
      const animated = new RegExp(String.raw`animation:\s*${name}`, 'g');
      expect(source.match(animated)).toHaveLength(1);
      const drift = source.search(animated);
      const opening = source.lastIndexOf('@media (prefers-reduced-motion: no-preference)', drift);
      expect(opening).toBe(motionBlock);
      // The query is still open at the drift: more `{` than `}` since it began.
      const between = source.slice(opening, drift);
      expect((between.match(/\{/g) ?? []).length).toBeGreaterThan(
        (between.match(/\}/g) ?? []).length
      );
    }

    // Slid by the compositor, never by repainting the background.
    expect(source).not.toMatch(/@keyframes sky[\w-]*\s*\{[^@]*background-position/);
  });

  it('measures the sky from the hero, not from copies of its values', () => {
    const source = css(HOME);
    expect(source).toMatch(/top:\s*calc\(-1 \* var\(--hero-top\)\)/);
    expect(source).toMatch(/bottom:\s*calc\(-0\.5 \* var\(--hero-gap\)\)/);
    expect(source).toMatch(/\.hero\s*\{[^}]*padding-top:\s*var\(--hero-top\)/);
    expect(source).toMatch(/\.hero\s*\{[^}]*gap:\s*var\(--hero-gap\)/);
  });

  it('closes the home page on the theme, not on deep water', () => {
    const closing = /\.closing\s*\{([^}]*)\}/.exec(css('components/app/site/atmosphere.module.css'));
    expect(closing).not.toBeNull();
    expect(closing![1]).toContain('var(--closing-base)');
    expect(closing![1]).not.toContain('--color-lotus-pad');
  });

  it("feathers the mission's water by its own mask, with no overlay in the page ground", () => {
    const ripple = css('components/app/site/mission-ripple.module.css');
    const water = /(?:^|\n)\.water\s*\{([^}]*)\}/.exec(ripple);
    expect(water).not.toBeNull();
    // Grey, not a blend: inside the isolated stage a blend has nothing behind it.
    expect(water![1]).toMatch(/filter:\s*grayscale\(1\)/);
    expect(ripple).not.toMatch(/mix-blend-mode/);
    // Prefixed for older Chromium as well as unprefixed.
    expect(water![1]).toMatch(/-webkit-mask-image:/);
    expect(water![1]).toMatch(/(?:^|[^-])mask-image:/);
    expect(css(DOCUMENT)).not.toMatch(/\.companion::after/);
  });

  it("does not blur behind the mission's scroll-animated centre", () => {
    const centre = /(?:^|\n)\.centre\s*\{([^}]*)\}/.exec(
      css('components/app/site/mission-ripple.module.css')
    );
    expect(centre).not.toBeNull();
    expect(centre![1]).not.toMatch(/backdrop-filter/);
  });
});
