/**
 * The header's narrow-viewport `order` rules must stay scoped to `.nav`.
 *
 * `SiteHeader` and `SiteFooter` share one CSS module and share two class names,
 * `.wordmark` and `.spacer`. The footer's `.footTop` is a wrapping flex
 * container, so an `order` declared on a bare `.wordmark` inside the ≤880px
 * block applies there too: the domain and the link list float ABOVE the lotus
 * on every public page, on every phone. Nothing throws, no component test
 * notices — jsdom and happy-dom do not do layout — and the CSS is valid.
 *
 * So the assertion is over the stylesheet SOURCE, which is the only place the
 * bug is visible without a real browser. The prototype scopes each of these
 * under `.site-nav` for the same reason.
 */

import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import path from 'node:path';

const SOURCE = readFileSync(
  path.join(process.cwd(), 'components', 'app', 'site', 'site.module.css'),
  'utf8'
);

/**
 * Comments stripped before anything is matched.
 *
 * The block above the ≤880px media query SPELLS OUT the bug — it contains the
 * literal text `.wordmark { order: 1 }` as the thing not to write. Scanning the
 * raw file therefore flagged the warning against writing it, which is the
 * scanner reading prose rather than rules. Both cases below failed on their own
 * documentation before this line existed.
 */
const CSS = SOURCE.replace(/\/\*[\s\S]*?\*\//g, '');

/** Class names used by BOTH components, so a bare rule reaches both. */
const SHARED = ['wordmark', 'wordmarkText', 'spacer'];

describe('site.module.css', () => {
  it('reads the stylesheet, so the checks below are not vacuous', () => {
    expect(CSS).toContain('.nav');
    expect(CSS).toContain('.footTop');
    expect(CSS).toContain('order:');
    // Stripping worked: the prose that describes the bug is gone, the rules
    // are not.
    expect(CSS).not.toContain('load-bearing');
  });

  it.each(SHARED)('never declares `order` on a bare .%s', (name) => {
    // Matches `.wordmark {` or `.wordmark,` NOT preceded by `.nav ` / `.foot `.
    const bare = new RegExp(`(^|[^ ])\\.${name}\\s*[,{][^}]*order\\s*:`, 'm');
    expect(bare.test(CSS), `a bare .${name} rule sets \`order\``).toBe(false);
  });

  it('scopes every order rule to a component root', () => {
    const orderRules = [...CSS.matchAll(/([^{}]+)\{[^}]*order\s*:[^}]*\}/g)].map((m) =>
      m[1].trim()
    );

    expect(orderRules.length).toBeGreaterThan(0);
    for (const selector of orderRules) {
      expect(
        selector.startsWith('.nav') || selector.startsWith('.foot'),
        `"${selector}" sets order without a component root`
      ).toBe(true);
    }
  });

  it('keeps the narrow wordmark size off the footer', () => {
    // The footer sizes its own wordmark inline at 21px; an unscoped
    // `.wordmarkText { font-size: 22px }` at ≤620px would fight it.
    expect(CSS).toContain('.nav .wordmarkText');
  });
});
