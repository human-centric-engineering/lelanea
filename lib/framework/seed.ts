/**
 * `syncFrameworkForSeed` (#158) — the framework boot sequence, for processes that
 * never boot the app.
 *
 * The `Module` rows, their slot definitions and the framework capability rows are
 * materialised by `initFramework() → initLeafApp() → syncFramework()`, which runs
 * at **server startup** via `lib/app/bootstrap.ts`. A standalone `db:seed` (what
 * `db:reset` and CI run) and the `smoke:*` scripts never boot the app, so none of
 * those rows exist — and a leaf seeding framework *configuration* (activating a
 * module, binding an agent, publishing a map that references one) has nothing to
 * operate on. Before this, the only way through was to call the three boot
 * functions inline, i.e. to depend on the order of framework boot internals.
 *
 * ## Why the leaf step is a callback rather than a call
 *
 * The sequence is not two steps with a gap; the middle step is a *leaf* concern:
 * `initLeafApp()` registers the leaf's modules, and `syncFramework()` reconciles
 * the registry into rows. Run the sync before the leaf has registered and it sees
 * a half-empty registry — which is not merely incomplete, it actively flags
 * partially-registered modules as **removed**.
 *
 * So the ordering has to live somewhere. It cannot live in a function here that
 * calls `initLeafApp()` directly: `lib/framework/**` must not import
 * `@/lib/app/**` (the ESLint `leafBan` — the framework is the leaf's dependency,
 * not the reverse, and importing upward inverts the tier order). Hence
 * {@link SeedBootOptions.registerLeaf}: the caller — a seed unit or a smoke
 * script, neither of which is subject to that ban — passes the leaf hook *in*,
 * and the correct ordering stays encoded here, in one place, rather than being
 * re-derived at every call site.
 *
 * ## Why this throws where `initApp()` swallows
 *
 * `lib/app/bootstrap.ts` wraps both halves in try/catch that logs and continues.
 * That is right for **server boot** — a framework boot failure should degrade the
 * app, not kill `instrumentation.register()`. It is wrong for a **seed**: the
 * runner would record the unit as applied, and the next seed would fail with a
 * mystifying "no `Module` row" a long way from the cause. A seed that cannot
 * establish the framework must fail loudly, so this deliberately does not catch.
 *
 * ## Idempotent, and safe to call more than once
 *
 * `initFramework()` replaces its registrations per key and `syncFramework()`
 * reconciles rather than inserts, so calling this twice in a process is harmless —
 * though not silent: `registerFrameworkCapability` warns `duplicate slug — last
 * registration wins` for each already-registered capability, and its store is
 * `globalThis`-backed, so the warnings accumulate across callers in one process.
 * Harmless (the last registration is identical to the first), but a caller invoking
 * this from several seed units will see them pile up.
 * That matters because of a runner property worth knowing:
 *
 * > **A seed unit runs once, ever.** `prisma/runner.ts` skips any unit whose
 * > source hash matches its `SeedHistory` row, so the boot seed
 * > (`prisma/seeds/_framework/000-framework-boot.ts`) re-runs only when *its own
 * > source* changes. A fresh database, `db:reset` and CI are all fine — their
 * > history is empty. What is not fine is an **incremental `db:seed` on an
 * > existing dev database after a leaf adds a module**: the boot seed is skipped,
 * > the new `Module` row is never synced, and the leaf's new seed fails.
 *
 * That is the case this export exists for. A leaf seed that depends on its own
 * module rows should call this at the top of its own `run()` — that unit's hash
 * *does* change when the leaf edits it, so the sync happens exactly when it needs
 * to. Treating this export as a convenience for smoke scripts and relying on the
 * boot seed alone leaves that hole open.
 */

import { initFramework, syncFramework } from '@/lib/framework';

export interface SeedBootOptions {
  /**
   * The leaf's module registration — `initLeafApp` from `@/lib/app/leaf-bootstrap`.
   * Runs **between** framework registration and the DB reconcile, which is the only
   * correct position for it (see the module header).
   *
   * Omit it when the caller has no leaf modules to register — a framework smoke
   * script exercising framework-owned rows only. Omitting it in a process that
   * *does* have leaf modules means `syncFramework()` sees a registry without them.
   */
  registerLeaf?: () => Promise<void>;
}

/**
 * Run the framework boot sequence against the database, for a process that has no
 * app boot: register the framework's pieces, let the caller register the leaf's,
 * then reconcile both into `framework_*` rows.
 *
 * Throws if any step fails — unlike `initApp()`, which logs and continues (see the
 * module header for why the difference is deliberate).
 */
export async function syncFrameworkForSeed(options?: SeedBootOptions): Promise<void> {
  initFramework();
  await options?.registerLeaf?.();
  await syncFramework();
}
