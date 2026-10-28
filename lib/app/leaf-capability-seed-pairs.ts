/**
 * Leaf-app capability seed pairs — FILLED by Lelañea.
 *
 * A leaf app (a fork of Daybreak) that seeds capabilities names the class for each slug here, and
 * lists any seed of its own the strict mock client cannot run (Sunrise #1013; the contract is the
 * docblock of `lib/app/capability-seed-pairs.ts`). Daybreak keeps this empty: it is the leaf's
 * seam, reserved so a leaf's entries merge cleanly on upgrade.
 *
 * Spread by `lib/app/capability-seed-pairs.ts` into `APP_CAPABILITY_PAIRS` and
 * `APP_UNCHECKED_SEEDS`, beside the framework's own entry for `_framework/000-framework-boot.ts`.
 * Test-only: nothing at runtime reads it.
 *
 * ```ts
 * import { WithdrawTaskCapability } from '@/lib/tasks/capabilities/withdraw-task';
 *
 * export const LEAF_CAPABILITY_PAIRS: readonly AppCapabilityPair[] = [
 *   { slug: 'withdraw_task', instance: new WithdrawTaskCapability() },
 * ];
 * ```
 */
import type { AppCapabilityPair } from '@/lib/app/capability-seed-pairs';
import { SuggestResourceCapability } from '@/lib/app/resources/suggest';
import { SetRegisterCapability } from '@/lib/app/voice/register-capability';
import { SearchPersonMemoryCapability } from '@/lib/app/memory/search-capability';
import { SetLeaningCapability } from '@/lib/app/voice/leaning-capability';

/**
 * Every capability this app seeds a row for (`prisma/seeds/app-lelanea/014`,
 * `023`, `024`, `025`). Carried as a divergence in the parity test itself until
 * the Daybreak 0.9.0 sync (t-174) brought this seam.
 */
export const LEAF_CAPABILITY_PAIRS: readonly AppCapabilityPair[] = [
  { slug: 'suggest_resource', instance: new SuggestResourceCapability() },
  { slug: 'set_register', instance: new SetRegisterCapability() },
  { slug: 'search_person_memory', instance: new SearchPersonMemoryCapability() },
  { slug: 'set_leaning', instance: new SetLeaningCapability() },
];

/**
 * Leaf seeds the parity test cannot run, keyed by path under `prisma/seeds/`, each with why.
 *
 * None of these writes a capability: the four that do (`014`, `023`, `024`, `025`)
 * run under the strict mock and are checked. These either reach the database
 * through a Daybreak or app service that holds the app client, or read rows an
 * earlier unit wrote, which the mock does not hold. Routing them through the
 * handed client would mean editing the seed files, and an edited seed unit
 * re-runs on every database that already applied it.
 */
export const LEAF_UNCHECKED_SEEDS: Readonly<Record<string, string>> = {
  'app-lelanea/001-journey-map.ts':
    'reconciles the framework through the app client (syncFrameworkForSeed), as Daybreak’s own boot seed does, then publishes the journey map; writes no capability',
  'app-lelanea/005-agent-models.ts':
    'pins a model on the two agents units 003 and 004 created, which the mock does not hold; writes no capability',
  'app-lelanea/006-agent-seats.ts':
    'binds facilitation seats through Daybreak’s seat service, which uses the app client; writes no capability',
  'app-lelanea/007-agent-reachable.ts':
    'grants the built-in search_knowledge_base capability, which earlier units created and the mock does not hold; writes no capability',
  'app-lelanea/011-slot-taxonomy.ts':
    'fills the slot taxonomy through the app’s slot service and Daybreak’s global slot sync, both on the app client; writes no capability',
  'app-lelanea/013-agent-slot-tools.ts':
    'grants Daybreak’s data-slot capabilities, which earlier units created and the mock does not hold; writes no capability',
  'app-lelanea/020-knowledge-mirror.ts':
    'runs the knowledge mirror reconcile, which reads the founding documents through the app client; writes no capability',
  'app-lelanea/026-synopsis-seat.ts':
    'creates the synopsis agent and binds its seat through Daybreak’s seat service, on the app client; writes no capability',
};
