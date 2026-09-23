/**
 * Fork-owned ESLint config seam.
 *
 * **Fork-owned scaffold** — Sunrise ships this as `export default []` and does
 * NOT change it after release, so your edits here merge cleanly on upgrade (the
 * stable contract is this file's default export — an array of flat-config
 * blocks — not its contents). Treat it like the other `lib/app/*` seams.
 *
 * Auto-wired: the root `eslint.config.mjs` spreads this array **after** all
 * Sunrise core blocks, so a fork adds its own import-boundary rules (e.g. a
 * `framework ↔ core` layer boundary) here instead of editing the platform
 * config — no merge conflict on `git merge vX.Y.Z`.
 *
 * Two load-bearing rules of the seam:
 *
 * 1. **Spread order matters — this array lands LAST.** Because a later
 *    flat-config block overrides an earlier one for overlapping `files`, a fork
 *    block here wins for its own paths. A framework-tier fork (Sunrise →
 *    framework → leaf) spreads its `lib/framework/eslint.config.mjs` first and
 *    keeps this leaf seam last.
 *
 * 2. **`no-restricted-imports` REPLACES, it does not merge.** Flat config does
 *    not deep-merge rule options: a block that sets `no-restricted-imports` for
 *    a glob fully replaces any earlier setting for the files it matches — it
 *    does NOT add to it. So a fork block that restricts its own imports must
 *    **restate the base `@/`-alias ban** (the `no-restricted-imports` rule from
 *    core) for its globs, or relative-import enforcement silently drops on those
 *    paths. Restate the whole rule per glob; don't assume core's still applies.
 *
 * Example (a fork's `framework ↔ core` boundary — put the blocks in this array):
 *
 *   export default [
 *     {
 *       files: ['lib/framework/**\/*.{ts,tsx}'],
 *       rules: {
 *         'no-restricted-imports': ['error', { patterns: [
 *           // restate the core @/-alias ban for this glob (replace-not-merge)…
 *           { group: ['./*', '../*'], message: 'Use the @/ alias, not relative paths.' },
 *           // …then add the fork's own boundary rule:
 *           { group: ['@/lib/app/*'], message: 'framework must not import the leaf app tier.' },
 *         ] }],
 *       },
 *     },
 *   ];
 *
 * See CUSTOMIZATION.md §4 and .context/architecture/lint-toolchain.md.
 */
/**
 * Lelañea's own boundary: her material is seed input, so only a seed reads it.
 *
 * `content/*.json` holds Lelañea Fulton's words; `seed-data/drafted/*.json`
 * holds what was drafted FOR her in her register. **Neither is content the
 * running app refers to** (§22, owner ruling 2026-09-21). The seeds project
 * both into the database once, the admin surfaces are how they change after
 * that, and every surface reads the database — which is what lets a word change
 * without a deploy, and what a native client will share.
 *
 * So the files may be imported from exactly two places, and this block's
 * `ignores` is that list:
 *
 * - **`lib/app/content/seed-input/**`** — the builders that parse a file into
 *   the rows a seed writes. Reached from `prisma/seeds/`, the smoke scripts and
 *   tests, and from nothing else.
 * - **`tests/**`** — a test asserting something about the file on disk needs
 *   the file, and a test ships in no build.
 *
 * **`prisma/seeds/**` is deliberately NOT on that list**, though t-89 briefly
 * put it there. A seed unit reads a file *through* its `seed-input/` builder,
 * which is where the Zod schema runs — so a seed that imported the JSON itself
 * would write unvalidated rows, skipping the referential and placeholder checks
 * that are the whole reason the builders exist. Nothing needed the allowance
 * (no seed imports a file directly, before or after t-89) and nothing would have
 * caught its use: the graph walk below roots at the shipped trees, not
 * `prisma/`. Caught by /code-review.
 *
 * **This used to permit the whole of `lib/app/content/**`, and that is how the
 * property was violated while the rule passed** (t-89). `content/index.ts`
 * imported the voice fingerprint and the golden set, so every one of the 347
 * import paths that reached the barrel — including a client component reaching
 * it for `findPlaceholders` — carried both files; and
 * `lib/app/slots/definitions-admin.ts` imported the taxonomy *schema* from the
 * module that parses the taxonomy *file*, putting 60KB of JSON behind six admin
 * routes. A folder-shaped allowance is what makes those unwritable rather than
 * merely discouraged.
 *
 * **A lint rule can only see one file at a time**, which is the other half of
 * why that went unnoticed: nothing here can tell that a permitted module is
 * reachable from a page. `tests/unit/lib/app/content/runtime-import-graph.test.ts`
 * is the half that can — it walks the graph and fails on any path from a shipped
 * tree (`app/`, `components/`, `emails/`, `hooks/`, `types/`, the rest of `lib/`)
 * or a shipped entry file (`proxy.ts`, `instrumentation.ts`) into `seed-input/`
 * or a file. Neither check replaces the other: this one cannot see reachability,
 * and that one says nothing about `prisma/` or `scripts/`.
 *
 * **Why `no-restricted-syntax` and not `no-restricted-imports`.** The obvious
 * rule is the wrong one here, because of the replace-not-merge footgun the
 * docblock above warns about. `no-restricted-imports` is already configured
 * twice in the root config — once for the `@/`-alias ban, once (as the
 * `@typescript-eslint/` variant) for the five framework-agnostic patterns on
 * `lib/app/**`. A block here setting it for `**\/*.{ts,tsx}` would REPLACE both
 * for every file it matched, and the failure is silent: relative-import
 * enforcement and the `lib/app/**` boundary would simply stop applying, with
 * nothing to notice it. Restating those patterns instead would leave a copy in
 * the leaf that goes stale the first time Daybreak or Sunrise adds a sixth.
 *
 * `no-restricted-syntax` is configured nowhere in either tier, so this block
 * adds a rule rather than replacing one, and stays correct across syncs. Both
 * static `import` and dynamic `import()` are covered.
 *
 * Proved by `tests/unit/lib/app/content/eslint-boundary.test.ts`, which lints a
 * fixture from each permitted folder and from outside them all, and asserts the
 * rule is wired into the resolved project config.
 */
export const contentJsonImportBoundary = {
  name: 'lelanea/content-json-boundary',
  files: ['**/*.{ts,tsx}'],
  ignores: ['lib/app/content/seed-input/**', 'tests/**'],
  rules: {
    'no-restricted-syntax': [
      'error',
      {
        selector: 'ImportDeclaration[source.value=/^@\\/(content|seed-data\\/drafted)\\//]',
        message:
          'content/ and seed-data/drafted/ are SEED INPUT, not what the app reads. ' +
          'Only lib/app/content/seed-input/** and tests may import one — a seed unit ' +
          'reads a file through its builder, which is where the schema runs. ' +
          'Every surface reads the database through a *-store.ts — which is what ' +
          'lets her words change without a deploy. See lib/app/content/index.ts.',
      },
      {
        selector: 'ImportExpression[source.value=/^@\\/(content|seed-data\\/drafted)\\//]',
        message:
          'content/ and seed-data/drafted/ are SEED INPUT, not what the app reads. ' +
          'Only lib/app/content/seed-input/** and tests may import one — a seed unit ' +
          'reads a file through its builder, which is where the schema runs. ' +
          'Every surface reads the database through a *-store.ts — which is what ' +
          'lets her words change without a deploy. See lib/app/content/index.ts.',
      },
      // Re-export is an import with a different keyword, and it launders the
      // JSON to every consumer of the re-exporting module rather than just the
      // one file — so it is the worse form, not a lesser one. Missed by the
      // first version of this rule, which matched only the two import shapes.
      {
        selector: 'ExportNamedDeclaration[source.value=/^@\\/(content|seed-data\\/drafted)\\//]',
        message:
          'content/ and seed-data/drafted/ are SEED INPUT, and a re-export is the worse ' +
          'form: it hands the file to every consumer of this module rather than to one ' +
          'file. Only lib/app/content/seed-input/** and tests may import one. ' +
          'See lib/app/content/index.ts.',
      },
      {
        selector: 'ExportAllDeclaration[source.value=/^@\\/(content|seed-data\\/drafted)\\//]',
        message:
          'content/ and seed-data/drafted/ are SEED INPUT, and a re-export is the worse ' +
          'form: it hands the file to every consumer of this module rather than to one ' +
          'file. Only lib/app/content/seed-input/** and tests may import one. ' +
          'See lib/app/content/index.ts.',
      },
    ],
  },
};

/**
 * Lelañea's tests of its own `lib/app/**` code may import the framework.
 *
 * Daybreak bans `@/lib/framework` imports from everything outside the two tiers
 * that legitimately touch it, and exempts its own tests (`tests/**\/lib/framework/**`)
 * on the grounds that a test ships in no build, so the build-time reason for
 * the ban — a fork with no `lib/framework/` folder — cannot reach it. Our tests
 * under `tests/**\/lib/app/**` qualify by the same reasoning and are not in that
 * list, because Daybreak's config carries no leaf vocabulary; its docblock says
 * a leaf re-permits its own paths here, spread last. So this block does that,
 * and only for tests: `lib/app/**` itself is already exempt, and the app shell
 * (`app/(lelanea)/**`, `components/app/**`) stays behind `lib/app/journey/*`.
 *
 * The concrete need: `tests/unit/lib/app/modules/registration.test.ts` boots the
 * real `initLeafApp()` and asserts the framework's module registry holds exactly
 * seventeen slugs. The registry is `globalThis`-backed and shared across the
 * worker, so the test has to reset it — and the reset helper is deliberately
 * not on any leaf seam, because nothing but a test should call it.
 *
 * **Replace-not-merge.** Setting `no-restricted-imports` here REPLACES the
 * framework block's setting for these files, so the `@/`-alias ban is restated
 * (its wording matches Daybreak's so a reader sees one rule, not two). Proved
 * by `tests/unit/lib/app/content/eslint-boundary.test.ts`, which checks both
 * that the framework ban is lifted for a leaf test and that the alias ban still
 * fires there.
 */
export const leafTestsMayImportFramework = {
  name: 'lelanea/leaf-tests-may-import-framework',
  files: ['tests/**/lib/app/**/*.{ts,tsx}'],
  rules: {
    'no-restricted-imports': [
      'error',
      {
        patterns: [
          {
            group: ['./*', '../*'],
            message: 'Use the @/ path alias instead of relative imports (CLAUDE.md).',
          },
        ],
      },
    ],
  },
};

export default [contentJsonImportBoundary, leafTestsMayImportFramework];
