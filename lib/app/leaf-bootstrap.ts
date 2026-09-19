/**
 * Leaf-app boot hook — Lelañea's one-time startup steps.
 *
 * Runs at server startup after the framework is initialised (called by
 * `lib/app/bootstrap.ts`'s `initApp()`) — nodejs runtime, production and
 * development — and again from the seed runner's framework boot
 * (`prisma/seeds/_framework/000-framework-boot.ts`), so a fresh database and
 * `db:reset` find the same registrations. That boot seed re-runs only when
 * `lib/framework/**` changes, so on a database it has already applied to an
 * incremental `db:seed` skips it; a leaf seed that needs the module rows calls
 * `syncFrameworkForSeed({ registerLeaf: initLeafApp })` at the top of its own
 * `run()`, as the boot seed's docblock says. Upstream Daybreak ships this
 * empty; the row in `tests/unit/lib/app/defaults.test.ts` is PINNED to what we
 * register rather than deleted, so a stray SECOND registration still fails
 * there (`HB2`).
 *
 * **A throw here skips the framework module sync**, deliberately — see the
 * comment on the `await initLeafApp()` call in `bootstrap.ts`. Everything
 * registered from this function must therefore be a pure, synchronous
 * registration: no I/O, no database, no network. The one step that CAN throw
 * — deriving the module definitions parses the bundled structure file — goes
 * last, so a content mistake can never leave the Art. 17 hook unregistered.
 * CI parses the real file first anyway (`tests/unit/lib/app/content/schemas.test.ts`).
 */

import { registerModule } from '@/lib/framework/modules/registry';
import { getModuleDefinitions } from '@/lib/app/modules/definitions';
import { registerWaitlistErasureHook } from '@/lib/app/waitlist/service';
import { registerFacilitationTurnHook } from '@/lib/framework/facilitation/agents/turn-hook';
import { runRecordedTurn } from '@/lib/app/agent/turns';
import { excludeFromConsumerChat } from '@/lib/orchestration/chat/consumer-exclusions';
import { VOICE_AGENT_SLUG } from '@/lib/app/voice/fingerprint';

export function initLeafApp(): Promise<void> {
  // GDPR Art. 17. `app_waitlist_entry` is keyed by EMAIL, so the FK cascade
  // cannot reach the rows of anyone who joined before signing up — which is
  // everyone who has not accepted an invitation, since only the user-created
  // hook (`lib/app/user-created.ts`) writes `userId`. Without this hook an
  // erased account would leave that person's address, name and stated intent
  // on a table nothing points at. See `lib/app/waitlist/service.ts`. First,
  // because it cannot fail and must not be skipped by anything below that can.
  registerWaitlistErasureHook();

  // §08 t-54. Every turn on a facilitation seat is claimed by its id, tagged with
  // its seat and recorded (`lib/app/agent/turns.ts`). Before anything that can
  // throw: with no hook the route falls back to the pass-through, and her turns
  // would run unrecorded — and bill twice on a retry — with nothing saying so.
  // A pure registration, as this function requires. The seam is carried ahead
  // of Daybreak — `.context/app/divergences.md` Row 18.
  registerFacilitationTurnHook(runRecordedTurn);

  // f-safety t-61. She is `public` for the facilitation surface's sake, which
  // also opens Sunrise's general consumer chat route to her — a door with no
  // turn hook behind it, so no crisis check, no ceiling and no record. Keep her
  // off it: that route now answers her slug as an unknown agent and its listing
  // omits her. Before anything that can throw, for the same reason as the hook
  // above. The seam is carried ahead of Sunrise — `.context/app/divergences.md`
  // Row 21.
  excludeFromConsumerChat(VOICE_AGENT_SLUG);

  // The seventeen modules of the journey, each a real place with an empty
  // interior. `registerModule()` is idempotent by slug, so a hot reload or a
  // second boot in the same process replaces rather than duplicates; the
  // framework's boot sync then upserts a `framework_module` row per slug and
  // leaves the operator columns alone. See `lib/app/modules/definitions.ts`.
  for (const definition of getModuleDefinitions()) {
    registerModule(definition);
  }

  return Promise.resolve();
}
