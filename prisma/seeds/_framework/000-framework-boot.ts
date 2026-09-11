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

import { readdirSync } from 'node:fs';
import { dirname, join, sep } from 'node:path';
import { fileURLToPath } from 'node:url';

import type { SeedUnit } from '@/prisma/runner';
import { syncFrameworkForSeed } from '@/lib/framework/seed';
import { initLeafApp } from '@/lib/app/leaf-bootstrap';

/**
 * `__dirname` equivalent for ESM — the idiom `prisma/seed.ts` and
 * `prisma/seeds/007-knowledge-chunks.ts` already use in this tree. A bare
 * `__dirname` works today only because `package.json` has no `"type": "module"`,
 * so tsx loads these as CJS; `import.meta.url` keeps working either way.
 */
const here = dirname(fileURLToPath(import.meta.url));

/** The framework's source tree, relative to this file. */
const FRAMEWORK_DIR = '../../../lib/framework';

/**
 * **Every `.ts` file under `lib/framework/`**, sorted, as paths relative to this
 * file — the shape `hashInputs` takes.
 *
 * ## Why the whole tree, and not a narrower list
 *
 * This unit's job is to reconcile the framework's registration surface into the
 * database, so its hash should be *the framework's source*. Every narrower
 * definition is a guess about which files feed a `ai_capability` row, and that
 * guess has now been wrong twice:
 *
 *   1. Naming the four capability **barrels** caught a capability being *added*
 *      (which edits `index.ts`) and missed every later **edit** to one.
 *   2. Naming every capability **source file** then missed the constants those
 *      files build their schemas from — `fill-slot.ts` takes its `enum` from
 *      `SLOT_SOURCE_TYPE` in `data-slots/vocabulary.ts`, and `submit-proposal.ts`
 *      from `PROPOSAL_SUBJECT_TYPES` in `emergence/pipeline.ts`. Add a value to
 *      either and the `functionDefinition` the LLM sees should change, while no
 *      capability file does — seed skipped, row stale, silently.
 *
 * Hand-naming those two would be the third guess, and a transitive import added
 * tomorrow would be the fourth. The tree is 155 files and ~700 KB, so reading it
 * costs a few milliseconds against a seed that is idempotent and takes ~65 ms —
 * a good trade for ending the class.
 *
 * The cost worth naming: this unit now re-runs whenever **any** framework file
 * changes, including ones that touch no database row. That is intentional. It is
 * a no-op reconcile, and `syncFrameworkCapabilities()` treats `requiresApproval`,
 * `rateLimit`, `approvalTimeoutMs`, `isIdempotent` and the quarantine columns as
 * operator-owned — written once on create, never propagated — so re-running more
 * often cannot weaken a capability's controls.
 *
 * **Sorted deliberately.** `readdirSync` order is filesystem-dependent and the
 * runner hashes in the order given, so an unsorted list would produce a different
 * hash on a different machine and re-run the seed for no reason.
 *
 * **Recursive**, obviously — but stated because the non-recursive version was the
 * second wrong guess above, one level down.
 *
 * Throws at import time if the directory is missing. The runner imports this
 * module before hashing, so that surfaces as a loud seed failure rather than a
 * silently shorter hash input — which is the failure mode this exists to prevent.
 */
function frameworkSources(): string[] {
  return (
    readdirSync(join(here, FRAMEWORK_DIR), { recursive: true })
      // Entry names use `/` on POSIX and `\` on Windows; the runner resolves these
      // as relative paths, so normalise before joining.
      .map((name) => String(name).split(sep).join('/'))
      .filter((name) => name.endsWith('.ts'))
      .sort()
      .map((name) => `${FRAMEWORK_DIR}/${name}`)
  );
}

const unit: SeedUnit = {
  name: 'framework-boot',
  // Fold the framework's ENTIRE source tree into this unit's content hash, so any
  // framework change re-runs it (see "It runs once, ever" above, and
  // `frameworkSources()` for why the whole tree rather than a narrower list).
  //
  // Without this the once-ever property bites DAYBREAK as well as a leaf — and
  // worse, because the documented remedy does not apply. A leaf that adds a module
  // also adds a seed for it, and can call `syncFrameworkForSeed()` from that seed's
  // own `run()`. Add or edit a framework CAPABILITY, though, and there is no seed
  // of your own to hook into: the `ai_capability` row never appears (or silently
  // keeps saying the old thing) on an existing dev database, with nothing to edit
  // to fix it short of touching this file.
  hashInputs: frameworkSources(),
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
