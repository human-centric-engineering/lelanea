/**
 * Unit Tests: nothing the app runs can reach her material (f-content-seeds t-89)
 *
 * `content/` and `seed-data/drafted/` are seed and reference input — never
 * content the running app refers to (owner ruling 2026-09-21). The lint
 * boundary in `lib/app/eslint.config.mjs` enforces the direct half of that: a
 * file under `app/`, `components/` or `lib/` may not import a JSON file.
 *
 * **It cannot enforce the reachable half, and that is what went wrong.** ESLint
 * sees one file at a time, so it could say nothing about the fact that
 * `lib/app/content/index.ts` — permitted, because the old rule exempted the
 * whole of `lib/app/content/**` — imported the voice fingerprint and the golden
 * set while 347 import paths reached it. One of those was
 * `components/app/content/authored-document.tsx`, a client component asking for
 * `findPlaceholders`, so both drafted files shipped to the browser. A second
 * leak had the same shape: `lib/app/slots/definitions-admin.ts` imported the
 * taxonomy *schema* from the module that parses the taxonomy *file*, putting
 * 60KB of JSON behind six admin routes.
 *
 * So this walks the graph. From every file under `app/`, `components/` and
 * `lib/` that is not itself seed input, it follows `@/` imports and fails on
 * any path that reaches an authored file or a `lib/app/content/seed-input/`
 * module. The failure message prints the shortest path, because "something
 * reaches the JSON" is not actionable and `a → b → c → the file` is.
 *
 * **Type imports count.** A `import type` is erased and costs no bytes, so this
 * is stricter than the bundle requires — deliberately. The rule people have to
 * hold is "a runtime module does not name `seed-input/`", which is greppable and
 * has no exceptions; "a runtime module may name it, but only after the word
 * `type`, and only if no value specifier rides along" is neither. The six
 * `*Seed` shapes the stores read back are declared in the `*-view.ts` modules
 * for exactly this reason.
 *
 * ---------------------------------------------------------------------------
 * FORK NOTE — this reads the real tree
 * ---------------------------------------------------------------------------
 * A fork that deliberately serves a collection from files rather than a
 * database should add that module to {@link SEED_INPUT} — it is then seed input
 * by a different name, and every other module is still held to the property. A
 * fork that drops the ruling entirely should delete this file rather than empty
 * the roots: a graph walk over nothing passes.
 *
 * @see lib/app/eslint.config.mjs — `contentJsonImportBoundary`, the other half
 * @see lib/app/content/index.ts
 * @see .context/app/content.md
 */

import { readFileSync, existsSync, readdirSync, statSync } from 'node:fs';
import { join } from 'node:path';
import { describe, it, expect } from 'vitest';

/**
 * The trees the app is built from. `scripts/` and `prisma/` are not shipped.
 *
 * `hooks/`, `emails/` and `types/` are here rather than left to luck: every one
 * of them happens to be reachable from `lib/` today, so the walk covered them by
 * accident, and the first module in one of them that nothing else imports would
 * have dropped out of the walk with nothing to say so.
 */
const ROOT_DIRS = ['app', 'components', 'emails', 'hooks', 'lib', 'types'] as const;

/**
 * Shipped code that is not in any of those trees.
 *
 * `proxy.ts` is the Next middleware — the security and rate-limit layer, which
 * runs on the Edge runtime for every request — and `instrumentation.ts` runs at
 * boot. **Neither is imported from any root above**, so before they were listed
 * the walk could not reach them transitively either: an import of a
 * `seed-input/` module added to `proxy.ts` would have been caught by nothing.
 * Not by the lint boundary either, which restricts `@/content/…` and
 * `@/seed-data/drafted/…` and says nothing about `seed-input/`.
 */
const ROOT_FILES = ['proxy.ts', 'instrumentation.ts'] as const;

/** The folder that is allowed to read a file, and is itself off-limits. */
const SEED_INPUT = 'lib/app/content/seed-input/';

/** An import specifier naming one of the two authored folders. */
const AUTHORED_FILE = /^@\/(content|seed-data\/drafted)\//;

/** Every `.ts`/`.tsx` file under a directory, repo-relative, forward-slashed. */
function walk(dir: string): string[] {
  const out: string[] = [];
  for (const entry of readdirSync(join(process.cwd(), dir))) {
    const rel = `${dir}/${entry}`;
    if (statSync(join(process.cwd(), rel)).isDirectory()) {
      out.push(...walk(rel));
    } else if (/\.tsx?$/.test(entry) && !entry.endsWith('.d.ts')) {
      out.push(rel);
    }
  }
  return out;
}

/**
 * Every module specifier a file imports from — static, dynamic and re-exported.
 *
 * Comments are stripped first. Without that, the docblocks this feature wrote
 * about the boundary would themselves be read as imports of it, and the test
 * would fail on the prose explaining why it passes.
 */
function specifiersOf(relativePath: string): string[] {
  const source = readFileSync(join(process.cwd(), relativePath), 'utf-8')
    .replace(/\/\*[\s\S]*?\*\//g, '')
    .replace(/^[^\n'"`]*\/\/.*$/gm, '');

  const out: string[] = [];
  // `import x from '…'`, `export { x } from '…'`, `export * from '…'`, and the
  // `type` variants of each — every form that creates an edge in the graph.
  for (const match of source.matchAll(/(?:^|\n)\s*(?:import|export)\b[\s\S]*?from\s+'([^']+)'/g)) {
    out.push(match[1]);
  }
  // Bare side-effect import, and dynamic `import('…')`.
  for (const match of source.matchAll(/(?:^|\n)\s*import\s+'([^']+)'/g)) out.push(match[1]);
  for (const match of source.matchAll(/\bimport\(\s*'([^']+)'/g)) out.push(match[1]);
  return out;
}

/** `@/x/y` to the file on disk, trying the extensions the bundler tries. */
function resolveAlias(specifier: string): string | null {
  if (!specifier.startsWith('@/')) return null;
  const base = specifier.slice(2);
  for (const candidate of [`${base}.ts`, `${base}.tsx`, `${base}/index.ts`, `${base}/index.tsx`]) {
    if (existsSync(join(process.cwd(), candidate))) return candidate;
  }
  return null;
}

/**
 * The shortest import path from `root` to her material, or `null`.
 *
 * Breadth-first, so the path reported is the shortest one and therefore the
 * one edge someone has to remove. Each module is visited once across the whole
 * search, which is what keeps a walk of the entire tree cheap.
 */
function pathToMaterial(
  root: string,
  seen: Set<string>,
  readSpecifiers: (file: string) => string[] = specifiersOf
): string[] | null {
  const queue: string[][] = [[root]];

  while (queue.length > 0) {
    const path = queue.shift() as string[];
    const current = path[path.length - 1];
    if (seen.has(current)) continue;
    seen.add(current);

    for (const specifier of readSpecifiers(current)) {
      if (AUTHORED_FILE.test(specifier)) return [...path, specifier];

      const resolved = resolveAlias(specifier);
      if (!resolved) continue;
      if (resolved.startsWith(SEED_INPUT)) return [...path, resolved];
      queue.push([...path, resolved]);
    }
  }
  return null;
}

/** Every runtime file: the trees and the two entry files, minus seed-input. */
function runtimeFiles(): string[] {
  return [...ROOT_DIRS.flatMap((dir) => walk(dir)), ...ROOT_FILES].filter(
    (file) => !file.startsWith(SEED_INPUT)
  );
}

describe('the runtime import graph', () => {
  it('covers the whole app — a walk over nothing would pass', () => {
    // The counterfactual for the case below. An empty or mis-rooted file list
    // reports clean, which is the one way this guard could go quiet without
    // anyone noticing, so the population is asserted before the absence is.
    const files = runtimeFiles();

    expect(files.length).toBeGreaterThan(500);
    expect(files).toContain('lib/app/content/index.ts');
    expect(files).toContain('components/app/content/authored-document.tsx');
    expect(files).toContain('lib/app/slots/definitions-admin.ts');
    // The two entry files nothing imports. Named individually because a tree
    // root that vanishes takes hundreds of files with it and trips the count
    // above, while one of these dropping out is invisible to it.
    expect(files).toContain('proxy.ts');
    expect(files).toContain('instrumentation.ts');
    expect(files.some((file) => file.startsWith(SEED_INPUT))).toBe(false);
  });

  it('reaches neither an authored file nor a seed-input module, from anywhere', () => {
    const seen = new Set<string>();
    const leaks = runtimeFiles()
      .map((file) => pathToMaterial(file, seen))
      .filter((path): path is string[] => path !== null)
      .map((path) => path.join('\n      → '));

    expect(
      leaks,
      `her material is reachable at runtime:\n\n      ${leaks.join('\n\n      ')}`
    ).toEqual([]);
  });

  it('would report the two leaks t-89 closed, had they survived', () => {
    // The point of this case is that the walk CATCHES A LEAK FROM A RUNTIME
    // ROOT. An earlier version rooted at the two `seed-input/` modules and
    // asserted each reaches its own JSON — true by construction, excluded from
    // the real walk by `runtimeFiles()`, and true even if the walk were broken
    // for every runtime root. It was an anti-regression case that could not
    // regress. Caught by /code-review.
    //
    // So the removed edge is put back, on the one module that carried it, and
    // the walk is run over the real tree from the real client component. Every
    // file named here exists and every other edge is read from disk — only
    // `index.ts`'s import list is the historical one.
    const withBarrelLeak = (file: string): string[] =>
      file === 'lib/app/content/index.ts'
        ? ['@/lib/app/content/seed-input/voice-fingerprint']
        : specifiersOf(file);

    expect(
      pathToMaterial('components/app/content/authored-document.tsx', new Set(), withBarrelLeak)
    ).toEqual([
      'components/app/content/authored-document.tsx',
      'lib/app/content/index.ts',
      'lib/app/content/seed-input/voice-fingerprint.ts',
    ]);

    // Leak 2 was one hop: an admin module importing the taxonomy SCHEMA from the
    // module that parses the taxonomy FILE. `taxonomy-file.ts` is where that
    // schema lives now, and `definitions-admin.ts` imports it from there.
    const withAdminLeak = (file: string): string[] =>
      file === 'lib/app/slots/definitions-admin.ts'
        ? ['@/lib/app/content/seed-input/slot-taxonomy']
        : specifiersOf(file);

    expect(pathToMaterial('lib/app/slots/definitions-admin.ts', new Set(), withAdminLeak)).toEqual([
      'lib/app/slots/definitions-admin.ts',
      'lib/app/content/seed-input/slot-taxonomy.ts',
    ]);
  });

  it('reports the shortest path, so the edge to remove is the one named', () => {
    // The message is the deliverable: "something reaches the JSON" is not
    // actionable. With two ways into the barrel, the walk must print the two-hop
    // one rather than whichever it happened to enqueue first.
    const twoWaysIn = (file: string): string[] => {
      if (file === 'components/app/content/authored-document.tsx') {
        return ['@/lib/app/content/document-view', '@/lib/app/content/index'];
      }
      if (file === 'lib/app/content/document-view.ts') return ['@/lib/app/content/index'];
      if (file === 'lib/app/content/index.ts') {
        return ['@/lib/app/content/seed-input/voice-fingerprint'];
      }
      return specifiersOf(file);
    };

    expect(
      pathToMaterial('components/app/content/authored-document.tsx', new Set(), twoWaysIn)
    ).toHaveLength(3);
  });

  it('follows an edge more than one hop out, which is how both leaks hid', () => {
    // The first version of the fingerprint test's closure walk scanned only a
    // root's own import list and reported clean while the property was already
    // violated one hop away. This asserts the walk is transitive, using a real
    // two-hop path: the seed unit → the seed-input module → the file.
    const path = pathToMaterial('prisma/seeds/app-lelanea/003-voice-fingerprint.ts', new Set());

    expect(path).toEqual([
      'prisma/seeds/app-lelanea/003-voice-fingerprint.ts',
      'lib/app/content/seed-input/voice-fingerprint.ts',
    ]);
  });

  it('reads an import out of code and not out of the prose about it', () => {
    // This file's own docblock names `@/content/` and the seed-input folder
    // several times, and so do the modules it walks. A comment-blind matcher
    // fails on the documentation explaining the boundary, which is a failure
    // nobody can act on.
    expect(specifiersOf('lib/app/content/index.ts')).not.toContain(
      '@/lib/app/content/seed-input/voice-fingerprint'
    );
    expect(specifiersOf('lib/app/content/index.ts')).toContain('@/lib/app/content/document-view');
  });
});
