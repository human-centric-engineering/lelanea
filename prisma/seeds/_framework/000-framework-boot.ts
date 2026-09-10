/**
 * Framework boot, for seed runs (#158).
 *
 * A standalone `db:seed` — what `db:reset` and CI run — never boots the app, so
 * `initFramework() → initLeafApp() → syncFramework()` never runs and the `Module`
 * rows, their slot definitions and the framework capability rows do not exist. A
 * leaf that seeds framework *configuration* (activating a module, binding an
 * agent, publishing a map that references one) then has nothing to operate on.
 * This unit closes that gap so a leaf needs no boot code of its own.
 *
 * ## The directory name is load-bearing: `_framework/`, not `framework/`
 *
 * `prisma/runner.ts` runs units in the lexicographic order of their path relative
 * to `seeds/`, and ASCII puts digits (`0x30`) < `_` (`0x5F`) < lowercase letters
 * (`0x61`). So this sorts:
 *
 *   - **after** every core `NNN-*.ts` at the top level — `001-system-owner`'s
 *     service account exists by the time anything here runs; and
 *   - **before** any leaf directory named `app-…` — the leaf's own seeds find
 *     the rows already in place.
 *
 * The sibling `prisma/seeds/framework/` sorts *after* the leaf directories, fine for
 * what lives there (it depends on core only) and fatal here. Renaming this
 * directory would break the ordering silently — no error, just a leaf seed that
 * cannot find a module. `tests/unit/prisma/framework-boot-seed.test.ts` pins it.
 *
 * ## This unit is the composer, deliberately
 *
 * It touches both tiers — `@/lib/framework` for the boot sequence and
 * `@/lib/app/leaf-bootstrap` for the leaf's module registration — which is exactly
 * what `lib/app/bootstrap.ts` does at server boot. It can, because `prisma/seeds/`
 * is subject to neither the core→framework import ban (lifted for framework/leaf
 * seed dirs in #157) nor the framework→leaf `leafBan`. `syncFrameworkForSeed()`
 * cannot compose the leaf itself: it lives in `lib/framework/**`, which must not
 * import upward into `@/lib/app/**`.
 *
 * ## It runs once, ever — and that is not the whole story
 *
 * The runner skips a unit whose source hash matches its `SeedHistory` row, so this
 * re-runs only when its own source changes. Fresh database, `db:reset` and CI are
 * all fine. An **incremental `db:seed` after a leaf adds a module** is not: this is
 * skipped, the new `Module` row is never synced, and the leaf's new seed fails.
 *
 * Two different remedies, because the two cases differ:
 *
 *   - **A leaf adding a module** also adds a seed to configure it, so it calls
 *     `syncFrameworkForSeed()` at the top of that seed's `run()` — that unit's hash
 *     changes when the leaf edits it. See `lib/framework/seed.ts`.
 *   - **Daybreak adding a framework capability** has no such seed to hook into, so
 *     this unit declares `hashInputs` over the framework's registration sources
 *     (below) and re-runs itself when they change.
 */

import type { SeedUnit } from '@/prisma/runner';
import { syncFrameworkForSeed } from '@/lib/framework/seed';
import { initLeafApp } from '@/lib/app/leaf-bootstrap';

const unit: SeedUnit = {
  name: 'framework-boot',
  // Fold the framework's own registration sources into this unit's content hash,
  // so editing them re-runs it (see "It runs once, ever" above).
  //
  // Without this, the once-ever property bites DAYBREAK as well as a leaf — and
  // worse, because the documented remedy does not apply. A leaf that adds a module
  // also adds a seed for it, and can call `syncFrameworkForSeed()` from that seed's
  // own `run()`. Add a framework CAPABILITY, though, and there is no seed of your
  // own to hook into: `ai_capability` row never appears on an existing dev
  // database, and the tool cannot be granted to an agent, with nothing to edit to
  // fix it short of touching this file.
  //
  // `index.ts` covers a new capability GROUP (it is where each is registered); the
  // four collections cover a new capability inside an existing group, which does
  // not touch `index.ts`. Adding a fifth group means editing `index.ts` AND adding
  // its collection here.
  hashInputs: [
    '../../../lib/framework/index.ts',
    '../../../lib/framework/data-slots/capabilities/index.ts',
    '../../../lib/framework/guidance/capabilities/index.ts',
    '../../../lib/framework/engagement/capabilities/index.ts',
    '../../../lib/framework/facilitation/emergence/capabilities/index.ts',
  ],
  async run({ logger }) {
    // Throws on failure rather than logging and continuing — the difference from
    // `initApp()`, and the point of the seed-specific entry point. A sync that
    // failed silently here would be recorded as applied and strand every seed
    // after it behind a missing `Module` row.
    await syncFrameworkForSeed({ registerLeaf: initLeafApp });

    logger.info(
      'Framework synced for seeding — module, slot-definition and capability rows are current.'
    );
  },
};

export default unit;
