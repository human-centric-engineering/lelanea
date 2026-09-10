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

/** Whole-tree always-run tests this LEAF adds. Daybreak ships this empty. */
export const leafAlwaysRunTests: AppAlwaysRunTest[] = [];
