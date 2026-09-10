// Framework-tier ESLint blocks (Daybreak-owned).
//
// This is the framework layer's slice of the flat config, kept OUT of the root
// `eslint.config.mjs` so the root stays Sunrise's file with a minimal, generic
// diff (it just spreads this array). That is the fork-first shape of Sunrise
// issue #382 (ESLint config seam): when upstream adopts the seam, the root
// change merges cleanly and these blocks stay entirely fork-owned — no more
// growing edits inside a platform-owned file.
//
// Exported as a plain flat-config array; the root spreads it AFTER Sunrise's own
// blocks (order matters — a fork block must be able to override a core rule for
// its own paths). See `.context/framework/README.md` and f-bootstrap t-2.
//
// FLAT-CONFIG FOOTGUN: `no-restricted-imports` REPLACES (does not merge) across
// matching blocks. Every block below therefore RESTATES the `@/`-alias ban
// (`aliasBan`) alongside its own rule — omit it and relative-import enforcement
// silently drops for those paths.

/** The repo-wide `@/`-alias ban, restated in each block (see footgun above). */
const aliasBan = {
  group: ['./*', '../*'],
  message: 'Use the @/ path alias instead of relative imports (CLAUDE.md).',
};

/** Core / app-shell code must never import the framework tier. */
const frameworkBan = {
  group: ['@/lib/framework', '@/lib/framework/*'],
  message:
    'Core / app-shell code must not import @/lib/framework — the framework ' +
    'tier is built on core, not the reverse, and a build-time import would ' +
    'break forks without a lib/framework/ folder. Register through a Sunrise ' +
    'seam instead (see .context/framework/README.md).',
};

/** Framework code must not reach UP into its consumer, the leaf surface. */
const leafBan = {
  group: ['@/lib/app', '@/lib/app/*'],
  message:
    'Framework code must not import the leaf surface @/lib/app/** — the leaf ' +
    'app is the framework tier’s consumer (Sunrise → Daybreak → app), so this ' +
    'would invert the tier order. Expose a seam from lib/framework instead and ' +
    'let the leaf call it.',
};

export default [
  // Deliberate boundary-violation fixtures. They intentionally break the
  // core → framework rule so `scripts/boundary/check.ts` can prove it still
  // bites (it lints them with `--no-ignore`). Globally ignored so they never
  // fail a normal `npm run lint`.
  {
    ignores: ['scripts/boundary/fixtures/**'],
  },

  // ── Core → framework tier boundary (Daybreak three-tier model) ────────────
  // Sunrise-core and app-shell code must never import `@/lib/framework`. Not
  // just hygiene: a static `@/lib/framework` specifier resolves at BUILD time,
  // so an upstream Sunrise (or a sibling fork like ConQuest) with no
  // `lib/framework/` folder would fail `next build`. The reference must be
  // ABSENT from core, not runtime-guarded.
  //
  // Applies to every TS file EXCEPT the two tiers that legitimately touch the
  // framework: `lib/framework/**` (it IS the framework — see the tier block
  // below) and `lib/app/**` (the leaf, built ON the framework — it keeps its
  // own Sunrise `lib/app` rules and the sanctioned boot bridge
  // `instrumentation.ts → lib/app/bootstrap.ts → @/lib/framework`). Framework
  // test files are exempted too (they must import what they exercise; a test
  // ships in no build) — and, for the same reason, framework smoke scripts
  // (`scripts/smoke/**`): dev/CI tooling run via `tsx`, never part of `next
  // build`, that must import the framework code it exercises (e.g. the engine
  // write-path smoke drives `applyEvent`). The `@/`-alias ban still applies via
  // the root block, so relative imports stay banned there.
  //
  // ── The two exemption rationales, which are NOT the same (#157) ───────────
  //
  // The exemptions above are all "this file ships in no build". #157 asked for
  // two more groups, and they qualify for different reasons — worth keeping
  // straight, because the difference decides which paths get listed.
  //
  // 1. NON-BUILD SEEDS — the `scripts/smoke/**` rationale exactly. Seeds run via
  //    `tsx` from `prisma/seed.ts` and are never part of `next build`, so the
  //    build-time argument does not reach them. But "does not ship in a build"
  //    is NOT on its own a licence to cross tiers: a **core** seed
  //    (`prisma/seeds/NNN-*.ts`, Sunrise-owned) importing `@/lib/framework`
  //    would still be a genuine tier inversion — it exists in upstream Sunrise
  //    and in sibling forks that have no framework tier. So only the seed dirs
  //    that BELONG to a framework-or-leaf tier are exempt, and the core seeds at
  //    the top level stay banned. `_framework/` is the boot-seed directory
  //    (#158); it must sort before `app-*/`, which is why it is not `framework/`.
  //
  // 2. RESERVED LEAF ROUTE NAMESPACES — a different argument, because these DO
  //    ship in `next build`. The build-time rationale is about a fork with no
  //    `lib/framework/` folder; these paths are the surface Sunrise and Daybreak
  //    both reserve for a LEAF, and a leaf always has a framework tier beneath
  //    it. Sunrise ships them absent and Daybreak keeps them empty, so a build
  //    that has no framework has no files here to resolve either. Same reasoning
  //    that already exempts `lib/app/**`, applied to the route surface.
  //
  //    Deliberately NOT taken as filed: the issue's follow-up asked for
  //    `app/(protected)/programme/**` and friends. `programme` is one leaf's
  //    vocabulary and must not enter a Daybreak-owned config — the next leaf has
  //    different words. A leaf using its own vocabulary re-permits it through its
  //    own `lib/app/eslint.config.mjs` (spread LAST, so it wins for its files),
  //    which is the supported mechanism rather than a workaround. See
  //    `.context/framework/building-on-daybreak.md`.
  //
  // Mind that `scripts/boundary/lib.ts`'s `isCoreSource()` MIRRORS the paths
  // treated as non-core here — add a path to one and you must add it to the
  // other, or a leaf route clears this ban and then trips the vocabulary scan.
  {
    files: ['**/*.{ts,tsx}'],
    ignores: [
      'lib/framework/**',
      'lib/app/**',
      'tests/**/lib/framework/**',
      'scripts/smoke/**',
      // 1. Framework- and leaf-tier seeds (never in a build). Core seeds at
      //    `prisma/seeds/NNN-*.ts` are deliberately absent — still banned.
      'prisma/seeds/_framework/**',
      'prisma/seeds/framework/**',
      'prisma/seeds/app-*/**',
      // 2. The reserved leaf surfaces (empty upstream and in Daybreak). Listed
      //    exhaustively rather than as `app/*/app/**`: explicit beats clever when
      //    the list has to be kept in lockstep with `isCoreSource()`.
      'app/api/v1/app/**',
      'app/(protected)/app/**',
      'app/(public)/app/**',
      'app/(auth)/app/**',
      'app/admin/app/**',
      'components/app/**',
    ],
    rules: {
      'no-restricted-imports': ['error', { patterns: [aliasBan, frameworkBan] }],
    },
  },

  // ── Root build/config files ──────────────────────────────────────────────
  // The block above widens the framework ban to `**/*.{ts,tsx}`, which is
  // broader than the root block's own `files` and so reaches root-level config
  // that Sunrise's config never linted for relative imports. These files CANNOT
  // use the `@/` alias: `vitest.config.ts` is where the alias is DEFINED, so a
  // config that imported through it would have to resolve itself first. Sunrise
  // relies on that (v0.8.0 added `./tests/mocks/next-font-plugin` here, #454).
  //
  // So the alias ban is dropped for exactly these files — the framework ban is
  // KEPT, which is the rule this block exists to widen in the first place. This
  // lives in Daybreak's own config rather than as an eslint-disable in
  // `vitest.config.ts`, so the platform file stays untouched and merges clean.
  //
  // Mind the REPLACE-not-merge footgun documented at the top of this file:
  // listing only `frameworkBan` here is what drops `aliasBan`, deliberately.
  {
    files: ['*.{ts,mts,cts}'],
    rules: {
      'no-restricted-imports': ['error', { patterns: [frameworkBan] }],
    },
  },

  // ── Framework tier ───────────────────────────────────────────────────────
  // `lib/framework/**` + its reserved admin surfaces (the `app/admin/framework`
  // + `app/api/v1/**/framework` routes and the `components/admin/framework`
  // admin components — governed as framework tier from day one, before the
  // first page lands) + the framework's own tests. Framework → core is allowed;
  // framework → leaf (`@/lib/app/**`) is not (it would invert the tier order).
  // The `@/lib/framework` self-ban is deliberately dropped here — a framework
  // module importing a sibling is fine.
  {
    files: [
      'lib/framework/**/*.{ts,tsx}',
      // Framework-tier SEEDS belong here, not only in the ban block's `ignores`.
      // `ignores` removes a path from that block entirely, so it falls through to
      // Sunrise's root block — which carries `aliasBan` and nothing else. A
      // framework seed exempted only that way could import `@/lib/app` and invert
      // the tier order with nothing to flag it. Naming them here restores
      // `leafBan`. (`prisma/seeds/app-*/**` is deliberately NOT here: leaf seeds
      // may import the leaf surface — it is their own.)
      'prisma/seeds/_framework/**/*.ts',
      'prisma/seeds/framework/**/*.ts',
      'app/admin/framework/**/*.{ts,tsx}',
      'components/admin/framework/**/*.{ts,tsx}',
      'app/api/v1/admin/framework/**/*.{ts,tsx}',
      'app/api/v1/framework/**/*.{ts,tsx}',
      'tests/**/lib/framework/**/*.{ts,tsx}',
      'tests/**/app/api/v1/framework/**/*.{ts,tsx}',
      'tests/**/app/api/v1/admin/framework/**/*.{ts,tsx}',
      'tests/**/app/admin/framework/**/*.{ts,tsx}',
      'tests/**/components/admin/framework/**/*.{ts,tsx}',
    ],
    rules: {
      'no-restricted-imports': ['error', { patterns: [aliasBan, leafBan] }],
    },
  },
];
