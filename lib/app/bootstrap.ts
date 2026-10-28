/**
 * App boot bridge — the fork-owned target of core's generic `initApp()` seam.
 *
 * Core's `instrumentation.ts` calls `initApp()` once at server startup (nodejs
 * runtime, production + development). In upstream Sunrise this file is empty by
 * default (the generic seam is fork-first here — to be filed upstream, see the
 * boot-seam follow-up in the f-bootstrap plan); Daybreak fills it to boot the
 * framework tier, then delegates to a reserved leaf hook. This is the ONE
 * `lib/app/*` file Daybreak fills — the single sanctioned core → framework bridge
 * (the ESLint boundary exempts `lib/app/**` for exactly this reason; see
 * f-bootstrap t-2 ↔ t-3).
 *
 * `@/lib/framework` is imported DYNAMICALLY on purpose: a static specifier is
 * resolved at BUILD time, so Sunrise or a sibling fork (no `lib/framework/`
 * folder) would fail `next build`. The reference lives only in this fork-owned
 * file, never in core — which is why `instrumentation.ts` calls this seam rather
 * than importing the framework directly.
 *
 * **This is the only `lib/app/` hook that may be async.** Do not copy its
 * `async` onto the `initApp*` registration seams (`initAppJobs`,
 * `initAppAuthorizationPolicy`, …): those must be synchronous, and one that
 * returns a promise is refused and disabled at its first read. See
 * `.context/architecture/fork-init-seams.md` — "A seam must be synchronous".
 */

import { logger } from '@/lib/logging';
import { initLeafApp } from '@/lib/app/leaf-bootstrap';

export async function initApp(): Promise<void> {
  // Framework init is isolated from leaf init: a framework boot bug (including a
  // failure to even load `@/lib/framework`) is logged, not thrown, so core degrades
  // gracefully (`buildContext` still works without the contributor) AND the leaf hook
  // below still runs. A failure of the leaf hook (or of this whole function) is in
  // turn isolated from the rest of server startup by the try/catch around `initApp()`
  // in `instrumentation.ts`.
  try {
    const { initFramework } = await import('@/lib/framework');
    initFramework();
  } catch (err) {
    logger.error('initApp: framework initialisation failed', {
      error: err instanceof Error ? err.message : String(err),
    });
  }

  // Leaf app (a fork of Daybreak) — reserved, empty by default. Registers the
  // leaf's own modules (via the framework's `registerModule()`) before the sync.
  //
  // Deliberately NOT wrapped in try/catch: if the leaf boot throws, the rejection
  // propagates and the sync below is SKIPPED (caught by instrumentation.register's
  // outer try/catch). That is the fail-safe — a half-populated registry must not be
  // reconciled, because `syncFramework()` would then flag partially-registered
  // modules as removed. A leaf failure delays the sync to the next clean boot
  // (the sync is idempotent) rather than corrupting `framework_module` state.
  await initLeafApp();

  // Framework DB sync — runs after framework + leaf registration have completed
  // cleanly (see above). Its own try/catch (the dynamic import is cached, so
  // re-importing is cheap): a DB-unavailable boot must not crash
  // `instrumentation.register()` or disarm the dev ticker; a fork with no registered
  // modules is a no-op (syncFramework returns early without touching the table).
  try {
    const { syncFramework } = await import('@/lib/framework');
    await syncFramework();
  } catch (err) {
    logger.error('initApp: framework sync failed', {
      error: err instanceof Error ? err.message : String(err),
    });
  }
}
