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
 * Lelañea's own boundary: authored content is reached through
 * `lib/app/content`, never by importing the JSON.
 *
 * `content/*.json` holds Lelañea Fulton's words. The feature they belong to
 * exists so that every client — this web app, a native client later — reads them
 * through one validated, versioned API instead of each growing its own copy. A
 * page that does `import docs from '@/content/lelanea_foundational_documents.json'`
 * gets unvalidated `any`-shaped data, bypasses the schemas, bypasses the
 * placeholder and referential-integrity checks, and quietly forks the pipeline
 * this feature exists to prevent. So: only `lib/app/content/**` may import them.
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
 * fixture from inside and outside the folder and asserts the rule is wired into
 * the resolved project config.
 */
export const contentJsonImportBoundary = {
  name: 'lelanea/content-json-boundary',
  files: ['**/*.{ts,tsx}'],
  ignores: ['lib/app/content/**'],
  rules: {
    'no-restricted-syntax': [
      'error',
      {
        selector: 'ImportDeclaration[source.value=/^@\\/content\\//]',
        message:
          'Authored content is read through `@/lib/app/content`, not by importing ' +
          'content/*.json — the loader is what validates it and what a native ' +
          'client will share. See lib/app/content/index.ts.',
      },
      {
        selector: 'ImportExpression[source.value=/^@\\/content\\//]',
        message:
          'Authored content is read through `@/lib/app/content`, not by importing ' +
          'content/*.json — the loader is what validates it and what a native ' +
          'client will share. See lib/app/content/index.ts.',
      },
    ],
  },
};

export default [contentJsonImportBoundary];
