/**
 * Leaf-app CI declarations — RESERVED, empty by default.
 *
 * A leaf app (a fork of Daybreak) declares its **own** coverage exclusions and
 * whole-tree always-run tests here. Daybreak keeps both lists empty: this is the
 * leaf's CI seam, reserved so a leaf's entries merge cleanly on a Daybreak
 * upgrade — the CI analogue of `lib/app/leaf-bootstrap.ts`,
 * `lib/app/leaf-admin-nav.ts` and `lib/app/leaf-db-drift.ts`.
 *
 * ## Why this file exists at all
 *
 * Sunrise's seam (#759, `lib/app/ci.ts`) is built for **two** tiers — a platform
 * and a fork — and hands the fork one file to fill. Daybreak is the middle of
 * **three**, so `lib/app/ci.ts` is a surface Daybreak is supposed to keep empty
 * *for its own forks*. Filling it directly would put Daybreak's entries in the
 * file a leaf is invited to edit, and the two would collide on every upgrade —
 * precisely the conflict #759 removed one tier up.
 *
 * So `lib/app/ci.ts` becomes one of Daybreak's `lib/app/*` **bridges** (rostered
 * in CLAUDE.md's banner): it declares the
 * framework tier's entries and spreads these two lists after them. Both lists
 * are append-shaped, so the tiers compose rather than override — unlike
 * `lib/app/brand.ts`, where a leaf replaces Daybreak's value because brand
 * identity is single-valued.
 *
 * ## What your entries are judged by
 *
 * They are spread into `lib/app/ci.ts`, which is spread into Sunrise's own core
 * lists — so every guard Sunrise wrote over those lists judges your entries too,
 * in your checkout. A coverage entry needs a `reason` of at least 20 characters
 * and a pattern nothing else already declares. An always-run entry additionally
 * has to name a file that **exists**, be something the runner can pass to
 * `vitest` as an argument, and sit in a directory `vitest.config.ts` actually
 * collects (`tests/e2e/**` is excluded there, so a spec declared inside it would
 * pass every other check and then silently never run).
 *
 * See `lib/app/ci.ts` for the two worked examples and the types.
 */

// RELATIVE for the same reason as the import in `ci.ts` — this module is reached
// from `vitest.config.ts` at config-load time, before the `@/` alias exists.
// eslint-disable-next-line @typescript-eslint/no-restricted-imports -- see above; the @/ alias does not exist at vitest config-load time.
import type { AppCoverageExclusion, AppAlwaysRunTest } from './ci';

/** Coverage exclusions this LEAF adds. Daybreak ships this empty. */
export const leafCoverageExclusions: AppCoverageExclusion[] = [];

/**
 * Whole-tree always-run tests this LEAF adds.
 *
 * Every entry here shares one property, and it is the only thing that earns a
 * place on this list: **the test's inputs are files rather than modules**, so no
 * import chain reaches it and `--changed` never selects it. The branch that
 * breaks each one is precisely the branch a scoped run would not have chosen.
 *
 * These four lived in `scripts/ci/scoped-tests.ts` until Daybreak 0.3.0 — a
 * Sunrise-owned file, carried as Row 4 of `.context/app/divergences.md`. The
 * seam arriving is what retired that row; the entries and their reasons did not
 * change.
 */
export const leafAlwaysRunTests: AppAlwaysRunTest[] = [
  {
    path: 'tests/unit/components/app/ui/tokens-only.test.ts',
    reason:
      'walks `components/app/ui/` off disk and fails on any colour literal, ' +
      'and separately checks that every `var(--color-…)` those components ' +
      'name is actually declared in a stylesheet. Both inputs are files, not ' +
      'modules: the change it exists to catch is a NEW component with a hex ' +
      'in it, or a token deleted from `app/brand-theme.css` — and neither ' +
      'reaches this test through any import chain. A branch touching only the ' +
      'stylesheet would not select it, which is exactly when a token ' +
      'disappears out from under a component that still references it.',
  },
  {
    path: 'tests/unit/app/public/authored-provenance.test.ts',
    reason:
      'reads every file under `app/(public)/` and `components/app/site/` off ' +
      "disk and fails if any of Lelañea Fulton's authored sentences — or a " +
      'trimmed cut of one — appears in the source. It imports only the ' +
      'content loader, so the module graph connects it to NOTHING it scans: a ' +
      'branch that retypes a sentence into a page edits that page and selects ' +
      'every test that imports it, which is not this one. That is the whole ' +
      'blind spot, and it is the exact change the guard exists to catch. It ' +
      'found four such violations already shipped when it was added. Named ' +
      '`.test.ts` rather than `.test.tsx` because `validateAlwaysRun` rejects ' +
      'the latter outright — sunrise#763; the file has no JSX, so the rename ' +
      'is the correct name rather than a workaround.',
  },
  {
    path: 'tests/unit/context/app-docs-paths.test.ts',
    reason:
      'checks that every repo path `.context/app/*.md` names still exists. Its ' +
      'inputs are files and it imports none of them, so BOTH branches that ' +
      'break it are invisible to a scoped run: one that renames a component ' +
      'reaches this through no module graph, and one that only edits markdown ' +
      'reaches it through none either. A doc pointing at a moved file is worse ' +
      'than no doc — it reads as authoritative — and nothing else in the suite ' +
      'can see it, since a rename fails type-check while its mention in prose ' +
      'fails nothing. §04 t-22, when `shell.md` arrived naming dozens of ' +
      'paths. `.test.ts` not `.test.tsx`, per sunrise#763, as above.',
  },
  {
    path: 'tests/unit/app/shell-not-found-streaming.test.ts',
    reason:
      'asserts that no `loading` file and no `<Suspense>` wrapping ' +
      '`{children}` sits between the root and a page under `/app`. Next sets ' +
      'a 404 only on a response that has not begun streaming, so breaking ' +
      'either turns every mistyped URL under `/app` into a soft 200 with ' +
      'nothing else failing. Its inputs are files and it imports none of ' +
      'them: the branch that adds a loading state touches no module this ' +
      'would be selected by. Split out of `shell-not-found.test.tsx` in t-22 ' +
      'precisely so it could be declared here — that file is `.test.tsx`, ' +
      'which validateAlwaysRun rejects (sunrise#763), and its render cases ' +
      'genuinely need JSX.',
  },
];
