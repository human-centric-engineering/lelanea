/**
 * Leaf-app boot hook — Lelañea's one-time startup steps.
 *
 * Runs at server startup after the framework is initialised (called by
 * `lib/app/bootstrap.ts`'s `initApp()`) — nodejs runtime, production and
 * development — and again from the seed runner's framework boot
 * (`prisma/seeds/_framework/000-framework-boot.ts`), so `db:reset` finds the
 * same registrations. Upstream Daybreak ships this empty; the row in
 * `tests/unit/lib/app/defaults.test.ts` is PINNED to what we register rather
 * than deleted, so a stray SECOND registration still fails there (`HB2`).
 *
 * **A throw here skips the framework module sync**, deliberately — see the
 * comment on the `await initLeafApp()` call in `bootstrap.ts`. Everything
 * registered from this function must therefore be a pure, synchronous
 * registration that cannot fail: no I/O, no database, no network.
 */

import { registerModule } from '@/lib/framework/modules/registry';
import { getModuleDefinitions } from '@/lib/app/modules/definitions';
import { registerWaitlistErasureHook } from '@/lib/app/waitlist/service';

export function initLeafApp(): Promise<void> {
  // The seventeen modules of the journey, each a real place with an empty
  // interior. `registerModule()` is idempotent by slug, so a hot reload or a
  // second boot in the same process replaces rather than duplicates; the
  // framework's boot sync then upserts a `framework_module` row per slug and
  // leaves the operator columns alone. See `lib/app/modules/definitions.ts`.
  for (const definition of getModuleDefinitions()) {
    registerModule(definition);
  }

  // GDPR Art. 17. `app_waitlist_entry` is keyed by EMAIL, so the FK cascade
  // cannot reach the rows of anyone who joined before signing up — which is
  // everyone, since nothing writes `userId` yet. Without this hook an erased
  // account would leave that person's address, name and stated intent on a
  // table nothing points at. See `lib/app/waitlist/service.ts`.
  registerWaitlistErasureHook();

  return Promise.resolve();
}
