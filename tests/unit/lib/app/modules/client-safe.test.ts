/**
 * `lib/app/modules/definitions.ts` stays safe to bundle for the browser.
 *
 * Client components reach it (`resources-panel.tsx` → `resource-view.ts` →
 * `resources.ts` → `moduleSlugFromId`), so anything it imports at runtime is
 * bundled for the browser. t-101 once had it import the Core Set reader, which
 * reads the database: `pg` was pulled into the client bundle and every admin
 * content page failed to build ("Can't resolve 'dns'"). Nothing in the unit
 * suite noticed, because vitest runs everything in Node.
 *
 * This walks the file's static, non-type imports and fails if they ever reach
 * the database client.
 */

import { existsSync, readFileSync } from 'node:fs';
import path from 'node:path';

import { describe, expect, it } from 'vitest';

const ROOT = process.cwd();
const DB_CLIENT = path.join(ROOT, 'lib/db/client.ts');

/** `@/x/y` → the file on disk, or null for a package or an unresolvable path. */
function resolveAlias(specifier: string): string | null {
  if (!specifier.startsWith('@/')) return null;
  const base = path.join(ROOT, specifier.slice(2));
  for (const candidate of [
    `${base}.ts`,
    `${base}.tsx`,
    path.join(base, 'index.ts'),
    path.join(base, 'index.tsx'),
  ]) {
    if (existsSync(candidate)) return candidate;
  }
  return null;
}

/** The `@/` modules a file imports at runtime: `import type` and `export type` are erased. */
function runtimeImports(file: string): string[] {
  const source = readFileSync(file, 'utf8');
  const specifiers: string[] = [];
  const statement = /^(?:import|export)\s+(?!type\b)[^;]*?from\s+['"]([^'"]+)['"]/gms;
  for (const match of source.matchAll(statement)) {
    if (match[1]) specifiers.push(match[1]);
  }
  return specifiers;
}

/** Every file reachable from `entry` by runtime imports, with the path that reached it. */
function reachable(entry: string): Map<string, string[]> {
  const seen = new Map<string, string[]>([[entry, [entry]]]);
  const queue = [entry];
  while (queue.length > 0) {
    const file = queue.shift()!;
    for (const specifier of runtimeImports(file)) {
      const target = resolveAlias(specifier);
      if (!target || seen.has(target)) continue;
      seen.set(target, [...seen.get(file)!, target]);
      queue.push(target);
    }
  }
  return seen;
}

const relative = (file: string) => path.relative(ROOT, file);

describe('lib/app/modules/definitions.ts', () => {
  it('never reaches the database client, so client components can import it', () => {
    const graph = reachable(path.join(ROOT, 'lib/app/modules/definitions.ts'));

    // The walk is real: it follows the file into the modules it depends on.
    expect(graph.has(path.join(ROOT, 'lib/app/onboarding/discovery-config.ts'))).toBe(true);
    expect(graph.get(DB_CLIENT)?.map(relative)).toBeUndefined();
  });

  it('would catch it: the Core Set reader does reach the database client', () => {
    const graph = reachable(path.join(ROOT, 'lib/app/onboarding/discovery-config-store.ts'));

    expect(graph.has(DB_CLIENT)).toBe(true);
  });
});
