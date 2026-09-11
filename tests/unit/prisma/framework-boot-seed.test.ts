/**
 * The framework boot seed's ORDER among the seed units (#158).
 *
 * `prisma/seeds/_framework/000-framework-boot.ts` establishes the `Module` rows a
 * leaf's own seeds depend on, so it has to run after the core seeds (which create
 * the service account it inherits) and before any leaf directory named `app-…`.
 *
 * That ordering is bought entirely by the **directory name**: `prisma/runner.ts`
 * sorts units by path relative to `seeds/`, and ASCII puts digits < `_` < letters.
 * Rename `_framework/` to `framework/` and it silently moves to *after* the leaf
 * directories
 * — no error, no warning, just a leaf seed that cannot find its module. That is
 * the failure this file exists to catch, and it is why the assertion is about the
 * real directory listing rather than a hard-coded expectation.
 *
 * It reads the tree, so it is declared in `ALWAYS_RUN_TESTS` — a scoped run
 * selects tests by module graph, and nothing imports a seed file.
 */

import { describe, it, expect } from 'vitest';
import { existsSync, readFileSync, readdirSync } from 'node:fs';
import { join, resolve } from 'node:path';

const SEEDS = join(process.cwd(), 'prisma', 'seeds');
const BOOT = '_framework/000-framework-boot.ts';
/** Mirrors `SEED_FILE_PATTERN` in `prisma/runner.ts`. */
const SEED_FILE = /^\d{3}-[a-z0-9-]+\.ts$/;

/** Every seed unit's path relative to `seeds/`, in the order the runner runs them. */
function seedOrder(): string[] {
  const found: string[] = [];
  const walk = (dir: string, prefix: string): void => {
    for (const entry of readdirSync(join(SEEDS, dir), { withFileTypes: true })) {
      const rel = prefix ? `${prefix}/${entry.name}` : entry.name;
      if (entry.isDirectory()) walk(join(dir, entry.name), rel);
      else if (SEED_FILE.test(entry.name)) found.push(rel);
    }
  };
  walk('.', '');
  // `runSeeds` does exactly this: `(await discoverSeedFiles(...)).sort()`.
  return found.sort();
}

describe('framework boot seed ordering', () => {
  it('exists where the runner will discover it', () => {
    expect(seedOrder()).toContain(BOOT);
  });

  it('runs AFTER every core seed, so the service account exists', () => {
    const order = seedOrder();
    const bootAt = order.indexOf(BOOT);
    // Core seeds are the digit-prefixed units at the TOP level (no `/`).
    const coreSeeds = order.filter((p) => !p.includes('/'));

    expect(coreSeeds.length).toBeGreaterThan(0);
    for (const core of coreSeeds) {
      expect(order.indexOf(core)).toBeLessThan(bootAt);
    }
  });

  it('runs BEFORE any app-* leaf directory, so leaf seeds find their module rows', () => {
    const order = seedOrder();
    const bootAt = order.indexOf(BOOT);
    // Daybreak ships no `app-*` seeds — the leaf surface is reserved empty — so
    // prove the ORDERING RULE against the real sort rather than against files that
    // do not exist here and will exist in every leaf.
    const withLeaf = [...order, 'app-example/001-init.ts'].sort();

    expect(withLeaf.indexOf(BOOT)).toBeLessThan(withLeaf.indexOf('app-example/001-init.ts'));
    expect(bootAt).toBeGreaterThanOrEqual(0);
  });

  it('would sort into the WRONG place if the directory were renamed to framework/', () => {
    // The mutation this file exists to catch, asserted directly: the sibling
    // `prisma/seeds/framework/` sorts AFTER the leaf directories, fine for what lives
    // there and fatal for the boot seed.
    const renamed = 'framework/000-framework-boot.ts';
    const sorted = [renamed, 'app-example/001-init.ts'].sort();

    expect(sorted.indexOf(renamed)).toBeGreaterThan(sorted.indexOf('app-example/001-init.ts'));
    // …whereas the name actually used sorts before it.
    expect([BOOT, 'app-example/001-init.ts'].sort()[0]).toBe(BOOT);
  });
});

describe('the _framework directory holds only the bridge', () => {
  it('contains exactly the boot seed', () => {
    // `_framework/` exists for ORDERING, and its single unit is a bridge: it is the
    // one seed exempt from both tier bans, because composing the two tiers is its
    // whole job (the seed-time twin of `lib/app/bootstrap.ts`). A genuine framework
    // seed dropped here would inherit an exemption it has no claim to — those go in
    // `prisma/seeds/framework/`.
    //
    // The ESLint exemption now names this file exactly rather than the directory,
    // so a second file fails lint on its first `@/lib/framework` import. This
    // asserts the same invariant with a message that says WHY, rather than leaving
    // the next person to decode a restricted-import error.
    const entries = readdirSync(join(SEEDS, '_framework'));
    expect(entries).toEqual(['000-framework-boot.ts']);
  });
});

describe('the boot seed re-runs when the framework changes', () => {
  it('declares hashInputs over the framework registration sources', async () => {
    // The once-ever property bites Daybreak too, and there the leaf's remedy does
    // not exist: adding a framework CAPABILITY brings no seed of your own to call
    // `syncFrameworkForSeed()` from, so without this the `ai_capability` row never
    // appears on an existing dev database. `hashInputs` folds these files into the
    // unit's content hash, so editing one re-runs the seed.
    const unit = (await import('@/prisma/seeds/_framework/000-framework-boot')).default;
    expect(unit.hashInputs).toBeDefined();

    // Every declared path must exist — `applySeed` throws at seed time otherwise,
    // which is a runtime failure for a purely static mistake.
    const seedDir = join(SEEDS, '_framework');
    for (const rel of unit.hashInputs ?? []) {
      expect(existsSync(resolve(seedDir, rel))).toBe(true);
    }

    // And it must cover every capability collection `initFramework()` registers —
    // a fifth group added there without a matching entry here silently reopens the
    // hole for that group.
    const init = readFileSync(join(process.cwd(), 'lib/framework/index.ts'), 'utf8');
    // Derive the collections from the REGISTRATION LOOP, not from import names:
    // `initFramework()` iterates each as `for (const capability of X)`. Matching on
    // the name shape instead swept in `registerRegisteredModuleCapabilities` — a
    // function, and one whose contents come from the module registry the LEAF
    // populates, so it is covered by the leaf's remedy rather than by hashInputs.
    const identifiers = [...init.matchAll(/for \(const capability of (\w+)\)/g)].map((m) => m[1]);
    const collections = identifiers.map((id) => {
      const imported = new RegExp(`import \\{ ${id} \\} from '@/([^']+)'`).exec(init);
      expect(imported, `no import found for ${id}`).not.toBeNull();
      return imported?.[1] ?? '';
    });
    expect(collections.length).toBeGreaterThan(0);
    for (const mod of collections) {
      const declared = (unit.hashInputs ?? []).some((h) => resolve(seedDir, h).includes(mod));
      expect(declared, `hashInputs is missing ${mod}`).toBe(true);
    }
  });

  it('covers every file in the framework tree, not a guess about which ones matter (#245)', async () => {
    const unit = (await import('@/prisma/seeds/_framework/000-framework-boot')).default;
    const seedDir = join(SEEDS, '_framework');

    // Three progressively-wrong guesses preceded this, and the test is written
    // against the tree so a fourth is impossible:
    //
    //   1. the four capability BARRELS  — caught a capability being added, missed
    //      every later edit to one;
    //   2. every capability SOURCE file — missed the constants those files build
    //      their schemas from (`SLOT_SOURCE_TYPE` in `data-slots/vocabulary.ts`
    //      feeds `fill-slot`'s `enum`, and is in neither list);
    //   3. a non-recursive read of those directories — missed anything nested.
    //
    // `syncFrameworkCapabilities()` propagates `name`, `description` and the
    // parameter schema to the `ai_capability` row, so any of those misses leaves
    // the row silently stale on an existing dev database, which is the whole
    // failure `hashInputs` exists to prevent.
    const declared = new Set((unit.hashInputs ?? []).map((h) => resolve(seedDir, h)));
    const root = join(process.cwd(), 'lib', 'framework');

    const found: string[] = [];
    for (const entry of readdirSync(root, { recursive: true })) {
      const name = String(entry);
      if (!name.endsWith('.ts')) continue;
      found.push(name);
      expect(declared.has(join(root, name)), `hashInputs is missing lib/framework/${name}`).toBe(
        true
      );
    }

    // Guard the guard: an empty or tiny walk would make every assertion above pass
    // while proving nothing. Asserted as a floor rather than an exact count,
    // because a count is a stale witness waiting to happen — the previous version
    // of this test shipped one that was already wrong.
    expect(found.length).toBeGreaterThan(100);
    // And the transitive case specifically, by name, since it is the one a
    // narrower rule would drop first.
    expect(declared.has(join(root, 'data-slots', 'vocabulary.ts'))).toBe(true);
  });
});
