/**
 * Unit Tests: `app/fonts.ts` — the three brand typefaces and how they reach `<html>`
 *
 * ## Why some of this reads the source instead of calling the code
 *
 * `next/font` loaders are erased by the Next compiler at build time — the real
 * `next/font/google/index.js` is an empty file — so under Vitest they resolve to
 * a stub (`tests/mocks/next-font-plugin.ts`) that answers every font with the
 * SAME handle: `{ className: 'mock-font', variable: '--mock-font' }`. The
 * options we pass are therefore unobservable at runtime by construction, and a
 * test that called `brandSans()` and asserted on the result would be asserting
 * on the stub.
 *
 * So the two things worth guarding are guarded the only way they can be:
 *
 *  - **The weights and styles** (§6.3 — nothing bolder than 600; the quote face
 *    is never set upright) are read from the source. Ship the wrong weight and
 *    nothing errors: the browser synthesises it and the page is subtly off.
 *  - **The wiring onto `<html>`** is read from `app/layout.tsx`. That line is a
 *    carried divergence (`.context/app/divergences.md` row 1) and the most
 *    likely thing to be lost in an upstream merge — at which point every page
 *    silently falls back to the browser's default face.
 *
 * The mapping half — that the variables only become fonts on the consumer
 * surface, so `/admin` keeps the platform's — lives in `brand-theme.test.ts`,
 * because that is a property of the stylesheet.
 */
import { readFileSync } from 'node:fs';
import path from 'node:path';

import { describe, expect, it } from 'vitest';

import { brandDisplay, brandFontVariables, brandQuote, brandSans } from '@/app/fonts';

const FONTS_SOURCE = readFileSync(path.join(process.cwd(), 'app', 'fonts.ts'), 'utf8');
const LAYOUT_SOURCE = readFileSync(path.join(process.cwd(), 'app', 'layout.tsx'), 'utf8');

/** The `Font_Name({ … })` call for one family, as authored. */
function loaderCall(family: string): string {
  const match = FONTS_SOURCE.match(new RegExp(`${family}\\(\\{([\\s\\S]*?)\\}\\);`));
  if (!match) throw new Error(`app/fonts.ts has no ${family}({ … }) call`);
  return match[1];
}

describe('app/fonts.ts', () => {
  it('exports one handle per family', () => {
    for (const handle of [brandDisplay, brandSans, brandQuote]) {
      expect(handle.variable).toBeTruthy();
    }
  });

  it('joins all three families into the class <html> receives', () => {
    // Asserted from SOURCE, not from the handles. The stub answers every loader
    // with the identical `{ variable: '--mock-font' }`, so a runtime check would
    // pass just as happily if this listed `brandSans.variable` three times, or
    // if `brandQuote` were wired to the Instrument_Serif loader — the two
    // failures most worth catching here.
    const joined = FONTS_SOURCE.match(/export const brandFontVariables = \[([\s\S]*?)\]/)?.[1];
    expect(joined).toBeDefined();
    for (const family of ['brandDisplay', 'brandSans', 'brandQuote']) {
      expect(joined).toContain(`${family}.variable`);
    }
    // Still three at runtime, so the exported string shape is what <html> wants.
    expect(brandFontVariables.split(' ')).toHaveLength(3);
  });

  it('names each variable for its register, not its family', () => {
    // Components read `var(--font-brand-display)`. Renaming a family later must
    // not mean touching every call site.
    expect(FONTS_SOURCE).toContain("variable: '--font-brand-display'");
    expect(FONTS_SOURCE).toContain("variable: '--font-brand-sans'");
    expect(FONTS_SOURCE).toContain("variable: '--font-brand-quote'");
  });

  describe('the weights and styles of §6.3', () => {
    it('loads body text at 400/500/600 and no bolder', () => {
      const options = loaderCall('Hanken_Grotesk');
      expect(options).toMatch(/weight:\s*\['400',\s*'500',\s*'600'\]/);
      expect(options).not.toMatch(/'700'|'800'|'900'|'variable'/);
    });

    it('loads the display face in both styles', () => {
      // The italic carries the ceremonial register; without it the browser
      // synthesises a slant that is not the drawn italic.
      const options = loaderCall('Instrument_Serif');
      expect(options).toMatch(/weight:\s*'400'/);
      expect(options).toMatch(/style:\s*\['normal',\s*'italic'\]/);
    });

    it('loads the quote face italic only', () => {
      // This face is never set upright in the product, so the upright cut is
      // weight the user should not have to download.
      const options = loaderCall('Cormorant_Garamond');
      expect(options).toMatch(/style:\s*'italic'/);
      expect(options).not.toMatch(/'normal'/);
    });

    it('gives every family a fallback stack and swaps rather than blocking', () => {
      for (const family of ['Instrument_Serif', 'Hanken_Grotesk', 'Cormorant_Garamond']) {
        const options = loaderCall(family);
        expect(options).toMatch(/display:\s*'swap'/);
        expect(options).toMatch(/fallback:\s*\[/);
      }
    });
  });

  describe('the wiring onto <html> (divergence row 1)', () => {
    it('applies the variables to the root element', () => {
      // On <html>, not a route-group wrapper: body-portaled overlays (dialogs,
      // dropdowns, toasts, the cookie banner) mount outside every route subtree
      // and would otherwise render in the browser's default face.
      expect(LAYOUT_SOURCE).toMatch(/<html[^>]*className=\{brandFontVariables\}/s);
      expect(LAYOUT_SOURCE).toContain("from '@/app/fonts'");
    });

    it('points at the ledger row that explains the edit', () => {
      // The comment is what stops a future sync resolving this conflict by
      // taking upstream and silently dropping the brand's typography.
      expect(LAYOUT_SOURCE).toContain('divergences.md');
    });
  });
});
