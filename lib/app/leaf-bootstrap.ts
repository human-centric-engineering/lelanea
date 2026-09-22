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
 * `run()`, as the boot seed's docblock says. One leaf seed calls THIS function
 * directly instead — `prisma/seeds/app-lelanea/011-slot-taxonomy.ts` needs only
 * the global slot provider registered, not the framework's module rows, and
 * says so at its call site. Upstream Daybreak ships this
 * empty; the row in `tests/unit/lib/app/defaults.test.ts` is PINNED to what we
 * register rather than deleted, so a stray SECOND registration still fails
 * there (`HB2`).
 *
 * **A throw here skips the framework module sync**, deliberately — see the
 * comment on the `await initLeafApp()` call in `bootstrap.ts`. Everything
 * registered from this function is therefore a pure, synchronous registration:
 * no I/O, no database, no network. **One step reads the database, and it cannot
 * throw** (t-87): the modules are registered from the code roster first, then
 * renamed from their `app_journey_module` rows, and a failed read is logged and
 * leaves the roster's registration standing. See the module loop below.
 */

import { logger } from '@/lib/logging';
import { registerModule } from '@/lib/framework/modules/registry';
import { getModuleDefinitions } from '@/lib/app/modules/definitions';
import { getJourneyStructure } from '@/lib/app/content/journey-store';
import { registerWaitlistErasureHook } from '@/lib/app/waitlist/service';
import { registerFacilitationTurnHook } from '@/lib/framework/facilitation/agents/turn-hook';
import { runRecordedTurn } from '@/lib/app/agent/turns';
import { excludeFromConsumerChat } from '@/lib/orchestration/chat/consumer-exclusions';
import { VOICE_AGENT_SLUG } from '@/lib/app/voice/fingerprint';
import { registerGlobalSlotDefinitionProvider } from '@/lib/framework/data-slots';
import { loadGlobalSlotDefinitions } from '@/lib/app/slots/taxonomy-store';

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

  // f-slots t-70. The authored slot taxonomy — what the app aims to learn about
  // a person (§5) — lives in `app_slot_definition`, and this hands Daybreak the
  // function that reads it. The framework's boot sync then calls it, stamps
  // `scope = global` and reconciles the result into `framework_slot_definition`;
  // the taxonomy editor calls `syncGlobalSlotDefinitions()` again after an edit.
  // The seam is carried ahead of Daybreak — `.context/app/divergences.md` Row 22,
  // proposed upstream as daybreak#266 — and this is its first production caller.
  //
  // A pure registration, as this function requires: the provider is async and
  // is not invoked here, so no database is touched at boot time by this line.
  // It is before the module loop for the same reason as the hooks above — with
  // no provider registered the global pass does nothing at all, silently, and
  // the whole taxonomy would be missing with nothing saying so.
  registerGlobalSlotDefinitionProvider(loadGlobalSlotDefinitions);

  // The seventeen modules of the journey, each a real place with an empty
  // interior. `registerModule()` is idempotent by slug, so a hot reload or a
  // second boot in the same process replaces rather than duplicates; the
  // framework's boot sync then upserts a `framework_module` row per slug and
  // leaves the operator columns alone. See `lib/app/modules/definitions.ts`.
  //
  // First from the roster alone, synchronously, so every slug is registered
  // whatever happens next: the sync after this function must never see a
  // half-populated registry, or it would flag the missing modules as removed.
  for (const definition of getModuleDefinitions()) {
    registerModule(definition);
  }

  // Then with her words (t-87). A module's title is owned by its
  // `app_journey_module` row, and the definition's name is derived from it, so
  // the agent's module context and the map-node embeddings say what the drawer
  // says. It is the same slugs again, so this replaces each definition in place.
  // Not awaited as a throw: a database that cannot be read at startup leaves
  // the roster's names, which are spelled from the slug, and says so. The sync
  // still runs, and the next boot that can read the rows renames them in the
  // registry. It does NOT rename `framework_module.name`: the framework writes
  // that column only when it creates the row. So a first boot of a new
  // environment that fails this read keeps the slug-spelled names there, as
  // Daybreak's admin display label, until an operator renames them. Nothing of
  // hers reads that column (see `.context/app/journey.md`, "Who owns what").
  return registerModuleTexts();
}

async function registerModuleTexts(): Promise<void> {
  try {
    const structure = await getJourneyStructure();
    for (const definition of getModuleDefinitions(structure)) {
      registerModule(definition);
    }
  } catch (err) {
    logger.warn('initLeafApp: module names could not be read; registered from the roster', {
      error: err instanceof Error ? err.message : String(err),
    });
  }
}
