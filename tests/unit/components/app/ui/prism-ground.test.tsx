// @vitest-environment happy-dom

/**
 * `PrismGround` — the light a consumer page sits in (t-177).
 *
 * Three properties fail silently, so each is pinned here:
 *
 *  1. **Decoration only.** The ground is `aria-hidden`. A screen reader that
 *     reached it would announce eleven empty spans on every page.
 *  2. **Once per consumer page, never on `/admin`.** Mounted by the frame, not
 *     by a component inside it. Mounted twice, the light paints twice over and
 *     every contrast ratio in `tests/unit/app/brand-theme.test.ts` describes a
 *     page that does not exist; mounted under `/admin`, Sunrise's flat admin
 *     sits on a lit ground with glass it was never designed for.
 *  3. **Still under reduced motion.** The rays drift and the sparks glint;
 *     `prefers-reduced-motion: reduce` holds both.
 *
 * The mount and motion checks read source, because what matters is which
 * frames mount the ground and what the stylesheet says, and neither renders in
 * jsdom: the frames are async server components behind the maintenance
 * wrapper, and there is no layout engine to evaluate a media query.
 *
 * @see components/app/ui/prism-ground.tsx
 */

import { readdirSync, readFileSync, statSync } from 'node:fs';
import path from 'node:path';

import { render } from '@testing-library/react';
import { describe, expect, it } from 'vitest';

import { PrismGround } from '@/components/app/ui/prism-ground';

const ROOT = process.cwd();

function read(relative: string): string {
  return readFileSync(path.join(ROOT, relative), 'utf8');
}

/** Every `.tsx` file under a directory, as repo-relative paths. */
function tsxUnder(relative: string): string[] {
  const out: string[] = [];
  for (const entry of readdirSync(path.join(ROOT, relative))) {
    const child = path.join(relative, entry);
    if (statSync(path.join(ROOT, child)).isDirectory()) out.push(...tsxUnder(child));
    else if (child.endsWith('.tsx')) out.push(child);
  }
  return out;
}

/** The `variant`s a file mounts the ground with, one entry per mount. */
function mounts(relative: string): string[] {
  return [...read(relative).matchAll(/<PrismGround\s+variant="(\w+)"/g)].map((match) => match[1]);
}

/** The layouts that wrap a route file: every `layout.tsx` from `app/` down to its folder. */
function enclosingLayouts(relative: string): string[] {
  const parts = path.dirname(relative).split(path.sep);
  const out: string[] = [];
  for (let depth = 1; depth <= parts.length; depth += 1) {
    const candidate = path.join(...parts.slice(0, depth), 'layout.tsx');
    if (candidate !== relative && tsxUnder(path.dirname(candidate)).includes(candidate)) {
      out.push(candidate);
    }
  }
  return out;
}

describe('PrismGround', () => {
  describe('decoration only', () => {
    it('is hidden from assistive technology and names its variant', () => {
      const { container } = render(<PrismGround variant="site" />);
      const ground = container.firstElementChild as HTMLElement;
      expect(ground.getAttribute('aria-hidden')).toBe('true');
      expect(ground.dataset.prism).toBe('site');
    });

    it('draws every layer of the prototype, with nothing a reader could reach', () => {
      // A wash, two folds, five rays, the veil and two sparks. Not a count for
      // its own sake: a layer that went missing is a change in the light, and
      // the contrast model in the stylesheet's test assumes all of them.
      const { container } = render(<PrismGround variant="app" />);
      const ground = container.firstElementChild as HTMLElement;
      expect(ground.dataset.prism).toBe('app');
      expect(ground.children).toHaveLength(11);
      expect(ground.textContent).toBe('');
      expect(ground.querySelectorAll('a, button, input, [tabindex]')).toHaveLength(0);
    });

    it('hands each ray its own angle, thickness, blur and drift', () => {
      const { container } = render(<PrismGround variant="site" />);
      const styled = [...(container.firstElementChild as HTMLElement).children].filter((child) =>
        (child as HTMLElement).style.getPropertyValue('--t')
      ) as HTMLElement[];
      expect(styled).toHaveLength(5);
      for (const ray of styled) {
        for (const property of ['--r', '--y', '--h', '--b']) {
          expect(ray.style.getPropertyValue(property), property).not.toBe('');
        }
      }
    });
  });

  describe('once per consumer page', () => {
    const ROUTES = tsxUnder('app');
    const MOUNTING = ROUTES.filter((file) => mounts(file).length > 0);

    it('is mounted by the consumer frames and nothing else under app/', () => {
      expect(Object.fromEntries(MOUNTING.map((file) => [file, mounts(file)]))).toEqual({
        [path.join('app', '(gate)', 'app', 'begin', 'page.tsx')]: ['site'],
        [path.join('app', '(lelanea)', 'app', 'layout.tsx')]: ['app'],
        [path.join('app', '(public)', 'layout.tsx')]: ['site'],
      });
    });

    it('is never mounted inside a frame that already mounts it', () => {
      // "Once" is a property of the PAGE, not the file: a page under two
      // mounting layouts would paint the light twice.
      for (const file of MOUNTING) {
        const doubled = enclosingLayouts(file).filter((layout) => mounts(layout).length > 0);
        expect(doubled, file).toEqual([]);
      }
    });

    it('is mounted by no component, only by a frame', () => {
      // A component that mounted it — a header, a view — would add a second
      // ground to whichever frame rendered it.
      const components = tsxUnder('components').filter(
        (file) => file !== path.join('components', 'app', 'ui', 'prism-ground.tsx')
      );
      expect(components.filter((file) => mounts(file).length > 0)).toEqual([]);
    });

    it('stays out of /admin', () => {
      const admin = ROUTES.filter((file) => file.startsWith(path.join('app', 'admin') + path.sep));
      expect(admin.length).toBeGreaterThan(0);
      expect(admin.filter((file) => /PrismGround/.test(read(file)))).toEqual([]);
    });

    it('takes the opaque ground off the frames it lights', () => {
      // The frame's wrapper painted `bg-background`, which is glass in the
      // prism — over the ground it would dim the light on every page.
      for (const frame of [
        path.join('app', '(public)', 'layout.tsx'),
        path.join('app', '(lelanea)', 'app', 'layout.tsx'),
      ]) {
        const code = read(frame)
          .replace(/\/\/.*$/gm, '')
          .replace(/\/\*[\s\S]*?\*\//g, '');
        expect(code, frame).not.toMatch(/['"`][^'"`]*\bbg-background\b/);
      }
    });
  });

  describe('the stylesheet', () => {
    const CSS = read(path.join('components', 'app', 'ui', 'prism-ground.module.css')).replace(
      /\/\*[\s\S]*?\*\//g,
      ''
    );

    function block(opening: RegExp): string {
      const start = CSS.search(opening);
      expect(start, String(opening)).toBeGreaterThanOrEqual(0);
      let depth = 0;
      for (let index = CSS.indexOf('{', start); index < CSS.length; index += 1) {
        if (CSS[index] === '{') depth += 1;
        if (CSS[index] === '}') depth -= 1;
        if (depth === 0) return CSS.slice(start, index + 1);
      }
      throw new Error(`unclosed block at ${String(opening)}`);
    }

    it('animates the rays and the sparks', () => {
      // Without this the reduced-motion case below would pass on a ground that
      // never moved at all.
      expect(block(/^\.ray\s*\{/m)).toMatch(/animation:\s*drift/);
      expect(block(/^\.spark\s*\{/m)).toMatch(/animation:\s*glint/);
    });

    it('holds the rays and the sparks still under reduced motion', () => {
      const reduced = block(/@media\s*\(prefers-reduced-motion:\s*reduce\)/);
      expect(reduced).toMatch(/\.ray\s*,\s*\.spark\s*\{\s*animation:\s*none;?\s*\}/);
    });

    it('sits behind the page and takes no pointer', () => {
      const ground = block(/^\.ground\s*\{/m);
      expect(ground).toMatch(/position:\s*fixed/);
      expect(ground).toMatch(/z-index:\s*-1/);
      expect(ground).toMatch(/pointer-events:\s*none/);
    });

    it('keys the site veil to the reading column', () => {
      // The contrast guard for text straight on the ground measures it INSIDE
      // the veil; this is what makes that true at every width.
      const veil = block(/^\.veil\s*\{/m);
      expect(veil).toContain('calc(50% - 590px)');
      expect(veil).toContain('calc(50% + 590px)');
    });

    it('takes every colour from a token', () => {
      expect(CSS).not.toMatch(/#[0-9a-f]{3,8}\b/i);
      expect(CSS).not.toMatch(/\b(?:rgb|rgba|hsl|hsla)\(\s*[\d.]/i);
    });
  });
});
