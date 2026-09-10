/**
 * Every CSS-module class the public pages name actually exists.
 *
 * ## The failure this exists for shipped, and nothing anywhere noticed
 *
 * A tidy-up of `document-page.module.css` deleted `.cards` along with the rules
 * that really were dead. `/data` kept saying `className={styles.cards}`, which
 * resolved to `undefined`, which React renders as no `className` at all — so
 * the data-rights cards silently fell out of their grid and stacked
 * full-width, one per row, down the page.
 *
 * Consider everything that did not catch it. TypeScript types a CSS module as
 * an index signature, so `styles.anything` is `string` and never an error.
 * CSS-modules itself has no notion of an unused or missing class. ESLint has no
 * rule for it. Every test passed, because a page's tests assert what it renders
 * and the div still rendered. `npm run validate` was clean. The gates were
 * clean. It took a person looking at the page.
 *
 * That is the whole argument for this file: the mistake is invisible to every
 * automated layer between the stylesheet and a human's eyes, and there is no
 * screenshot test here to be the backstop.
 *
 * ## It reads text, not modules, and that is deliberate
 *
 * Importing the module under Vitest would not help — the CSS transform returns
 * a proxy that answers every key, which is exactly the behaviour being guarded
 * against. So both sides are parsed as source: the class selectors declared in
 * the stylesheet, and the `styles.X` references in the pages that import it.
 *
 * FORK NOTE: reads no `lib/app/*` seam. It walks the directories in
 * `SCANNED_DIRS` for components that import a local CSS module and checks each
 * reference against that module's own declarations, so a fork's own pages and
 * stylesheets are covered on arrival with nothing to update. A fork that
 * renames or removes those directories should update `SCANNED_DIRS`, or delete
 * this file, rather than leave it pinned to paths that no longer exist.
 */

import { readFileSync, readdirSync } from 'node:fs';
import path from 'node:path';

import { describe, expect, it } from 'vitest';

const REPO_ROOT = path.resolve(__dirname, '../../../..');
/**
 * Every directory whose components carry a local CSS module.
 *
 * `components/app/site/` is here for the same reason `authored-provenance`
 * scans it: the header, footer and waitlist card render on every public page,
 * so a class that resolves to `undefined` there is broken site-wide rather than
 * on one route. `site.module.css` also just gained `.footNote a`, which is what
 * makes the footer's crisis link visible at all — exactly the kind of rule
 * whose loss shows up nowhere.
 */
const SCANNED_DIRS = ['app/(public)', 'components/app/site'];

/** `import styles from '@/app/(public)/x.module.css'` → the module's path. */
const STYLES_IMPORT = /import\s+(\w+)\s+from\s+'@\/([^']+\.module\.css)'/g;

/** A class selector at the head of a rule: `.cards {`, `.listRow svg {`, `.a,`. */
const CLASS_DECL = /\.([A-Za-z_][\w-]*)/g;

function sourceFiles(): string[] {
  return SCANNED_DIRS.flatMap((dir) =>
    readdirSync(path.join(REPO_ROOT, dir), { withFileTypes: true, recursive: true })
      .filter((entry) => entry.isFile() && /\.tsx?$/.test(entry.name))
      .map((entry) => path.join(entry.parentPath, entry.name))
  );
}

/**
 * Class names a stylesheet declares.
 *
 * Comments are stripped first: these files explain the rules they deleted and
 * why (`.cards` names itself in its own docblock, and the header names
 * `home.module.css`'s `.band`), and without stripping every such explanation
 * would register as a declaration that does not exist.
 */
function declaredClasses(cssPath: string): Set<string> {
  const css = readFileSync(path.join(REPO_ROOT, cssPath), 'utf8').replace(/\/\*[\s\S]*?\*\//g, ' ');

  // Selectors only — everything before each `{`. Scanning the whole file would
  // read `.5s` in a declaration value as a class named `5s`, and, worse, would
  // treat a class appearing only inside a media query's BODY as declared.
  const selectors = css.split('{').map((chunk) => chunk.split('}').at(-1) ?? '');
  return new Set(selectors.flatMap((sel) => [...sel.matchAll(CLASS_DECL)].map((m) => m[1])));
}

describe('public page CSS module references', () => {
  const pages = sourceFiles()
    .map((file) => ({ file, source: readFileSync(file, 'utf8') }))
    .flatMap(({ file, source }) =>
      [...source.matchAll(STYLES_IMPORT)].map(([, binding, cssPath]) => ({
        file: path.relative(REPO_ROOT, file),
        binding,
        cssPath,
        source,
      }))
    );

  it('finds the pages and their stylesheets at all', () => {
    // Guard on the guard. A scanner that matches nothing reports a clean sweep
    // while checking nothing, which is the failure mode of every
    // filesystem-driven check in this tree.
    expect(pages.length).toBeGreaterThanOrEqual(5);
    expect(pages.map((p) => p.cssPath)).toContain('app/(public)/document-page.module.css');
    expect(pages.map((p) => p.cssPath)).toContain('app/(public)/home.module.css');
    // Both scanned directories are actually reached — a `flatMap` over a list
    // that silently resolved one of them to nothing would still satisfy the
    // count above.
    expect(pages.map((p) => p.cssPath)).toContain('components/app/site/site.module.css');
  });

  it('can tell a real class from a missing one', () => {
    // Proves the parser before any clean result is trusted. `.cards` is
    // declared in the shared module; `.notAClassInThisFile` is not.
    const declared = declaredClasses('app/(public)/document-page.module.css');

    expect(declared.has('cards')).toBe(true);
    expect(declared.has('listRow')).toBe(true);
    expect(declared.has('notAClassInThisFile')).toBe(false);
  });

  it('never names a class its stylesheet does not declare', () => {
    const missing: string[] = [];

    for (const { file, binding, cssPath, source } of pages) {
      const declared = declaredClasses(cssPath);
      const used = new RegExp(`\\b${binding}\\.([A-Za-z_][\\w]*)`, 'g');

      for (const [, name] of source.matchAll(used)) {
        if (!declared.has(name)) {
          missing.push(`${file} uses \`${binding}.${name}\`, absent from ${cssPath}`);
        }
      }
    }

    expect([...new Set(missing)]).toEqual([]);
  });
});
