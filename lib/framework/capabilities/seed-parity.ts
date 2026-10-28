/**
 * The framework's entries in Sunrise's capability seed-parity test.
 *
 * `tests/unit/prisma/seeds/capability-class-seed-parity.test.ts` (Sunrise #1013) runs every seed
 * under a strict mock client and checks each capability it writes against its class. The framework
 * boot seed cannot run that way: `syncFrameworkForSeed()` reconciles modules, slot definitions and
 * capabilities through the app's own Prisma client, inside its own transactions, as the server does
 * at boot. Threading the seed's client through every framework sync would test nothing new: the
 * capability rows it writes are each class's own `functionDefinition`
 * (`lib/framework/capabilities/sync.ts` builds the row from the instance), so seed and class agree
 * by construction, and `tests/integration/lib/framework/capabilities/sync.test.ts` pins that
 * projection.
 *
 * Read by the `lib/app/capability-seed-pairs.ts` bridge. Test-only: nothing at runtime reads it.
 */
export const FRAMEWORK_UNCHECKED_SEEDS: Readonly<Record<string, string>> = {
  '_framework/000-framework-boot.ts':
    'reconciles framework rows through the app client (syncFrameworkForSeed), as server boot does; each capability row is its class’s own functionDefinition, so parity holds by construction',
};
