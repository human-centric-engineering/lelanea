/**
 * Boot-time slot-definition sync — reconciles the slots declared by registered
 * modules into `framework_slot_definition` rows (spec §6.1: module-owned
 * definitions "upserted at registration").
 *
 * Called once at startup by `syncFramework()` (after every tier has registered its
 * modules), it collects each registered module's `slotDefinitions`, stamps
 * `scope = module:<module.slug>`, and reconciles that set into rows.
 *
 * **Why this differs from the module sync (`modules/sync.ts`).** A `framework_module`
 * row carries *operator*-owned columns (status, config, window), so module sync
 * seeds a row once (`createMany … skipDuplicates`) and never rewrites it. A
 * `framework_slot_definition` row has **no operator columns** — it is a pure
 * projection of code — so an authored edit (a changed `sensitivity`, which drives
 * downstream masking; a reworded `description`) *must* propagate. This sync reads
 * the current rows and reconciles fully:
 *
 * 1. **Create** rows for newly-declared slugs.
 * 2. **Update** rows whose code changed — guarded by a field diff, so a boot where
 *    nothing changed writes zero rows and never bumps `updatedAt` (the
 *    no-write-when-unchanged invariant). Re-declaring a previously-removed slug is
 *    just an update that flips `isActive` back to `true`.
 * 3. **Deactivate** module-owned rows whose code was removed (`isActive = false`,
 *    row retained for audit) — guarded by `isActive: true` so already-inactive rows
 *    aren't rewritten, and **scoped to `module:%` rows** so a global/facilitation
 *    slot (a different, schema-permitted source — see `definition.ts`) is never
 *    touched by the module sync.
 *
 * **The "did registration run?" guard keys on modules, not slots.** A booted app
 * with **zero registered modules** means registration didn't run (a caught leaf-init
 * error, an HMR reset), so we skip entirely and never mass-deactivate on a fluke —
 * the same protection module sync has. But a module registered with **zero slots**
 * is a *normal* state that must still reconcile: that is how removing a module's
 * *last* slot deactivates its row (an empty slot set is common even when
 * registration fully succeeded, so it must not short-circuit the deactivate pass).
 *
 * Wrapped in one interactive transaction via `executeTransaction`; the `{ timeout }`
 * option (#368) gives headroom for the write set.
 *
 * ## Global slots — a provider a leaf registers
 *
 * **Carried by Lelañea ahead of Daybreak** (`.context/app/divergences.md`,
 * Row 22). Spec §6.1's second source — app-seeded `global` slots, belonging to no
 * module — has no registration upstream. A leaf registers one async provider
 * ({@link registerGlobalSlotDefinitionProvider}); after the module pass the sync
 * reconciles what it returns as `scope = global`, and the leaf calls
 * {@link syncGlobalSlotDefinitions} again whenever its source changes (an admin
 * edit). With no provider registered the global pass does nothing — no query, no
 * transaction — so the sync is exactly the module pass it always was.
 *
 * The two passes are two writers into one table, so each owns a partition (fp4):
 * - **Removal is partitioned.** The module pass deactivates only `module:%` rows,
 *   the global pass only `global` rows.
 * - **A slug is claimed by at most one pass.** A module declaring a slug keeps it
 *   (that is the module pass's existing behaviour); the global pass skips, with a
 *   warning, any slug whose row is in another scope, rather than flipping it back
 *   on every boot.
 * - **Safe on empty.** A provider returning nothing is read as a fluke (its source
 *   not yet seeded, or unreadable), never as "retire every global slot": the pass
 *   writes nothing. The cost is that retiring the *last* global slot is not
 *   propagated until another exists.
 * - **A provider fault never stops the boot.** It is leaf code; at boot its error is
 *   logged and the remaining framework syncs still run. On demand it throws, so the
 *   caller who asked can say so.
 */

import type { Prisma, SlotDefinition } from '@prisma/client';
import { executeTransaction } from '@/lib/db/utils';
import { logger } from '@/lib/logging';
import { getRegisteredModules } from '@/lib/framework/modules/registry';
import type { SlotDefinitionInput } from '@/lib/framework/data-slots/definition';
import {
  SLOT_VISIBILITY,
  SLOT_MODE,
  SLOT_DATA_TYPE,
  SLOT_SENSITIVITY,
  SLOT_SCOPE,
  SLOT_SCOPE_MODULE_PREFIX,
  moduleSlotScope,
} from '@/lib/framework/data-slots/vocabulary';

/** Timeout (ms) for the sync transaction — a ceiling above Prisma's 5s default (#368). */
const SYNC_TX_TIMEOUT_MS = 20_000;

/**
 * A `SlotDefinitionInput` with every default resolved and `scope` stamped — the
 * exact set of code-owned columns the sync writes (everything except the DB-managed
 * `id`/`createdAt`/`updatedAt` and the sync-managed `isActive`). Derived from the
 * input type so a new slot column is added in one place (the input) and flows here,
 * to the create payload, and to the field diff automatically.
 */
type ResolvedSlotDefinition = Required<SlotDefinitionInput> & { scope: string };

/** Resolve every unset classifier to its documented default and stamp `scope`. */
function resolveSlotDefinition(input: SlotDefinitionInput, scope: string): ResolvedSlotDefinition {
  return {
    slug: input.slug,
    group: input.group,
    description: input.description,
    scope,
    visibility: input.visibility ?? SLOT_VISIBILITY.open,
    mode: input.mode ?? SLOT_MODE.targeted,
    dataType: input.dataType ?? SLOT_DATA_TYPE.text,
    sensitivity: input.sensitivity ?? SLOT_SENSITIVITY.standard,
    priorityWeight: input.priorityWeight ?? 0,
  };
}

/**
 * Collect every registered module's `slotDefinitions`, resolve defaults, and stamp
 * `scope = module:<slug>`. Deduped by slug — a slot slug is globally unique (spec
 * §6.1), so a repeat (within a module or across two) is an authoring error: the last
 * registration wins, logged with the module that supplied it.
 * Exported for unit testing of the collection/stamping step.
 */
export function collectRegisteredSlotDefinitions(): ResolvedSlotDefinition[] {
  const bySlug = new Map<string, ResolvedSlotDefinition>();

  for (const mod of getRegisteredModules()) {
    for (const input of mod.slotDefinitions ?? []) {
      if (bySlug.has(input.slug)) {
        logger.warn(
          'collectRegisteredSlotDefinitions: duplicate slot slug — last registration wins (slugs must be globally unique)',
          { slug: input.slug, moduleSlug: mod.slug }
        );
      }
      bySlug.set(input.slug, resolveSlotDefinition(input, moduleSlotScope(mod.slug)));
    }
  }

  return [...bySlug.values()];
}

/**
 * Whether a row's code-owned fields (or its active flag) differ from the resolved
 * definition. Iterates the resolved keys so a newly-added column is diffed
 * automatically — no hand-maintained field list to fall out of step.
 */
function slotDefinitionNeedsUpdate(row: SlotDefinition, desired: ResolvedSlotDefinition): boolean {
  if (!row.isActive) return true;
  return (Object.keys(desired) as (keyof ResolvedSlotDefinition)[]).some(
    (key) => row[key] !== desired[key]
  );
}

type Tx = Prisma.TransactionClient;

/** The rows one pass owns, and whether it may take over a slug another scope holds. */
interface SlotPartition {
  /** The `scope` filter bounding this pass's deactivate — it touches no other row. */
  scope: Prisma.SlotDefinitionWhereInput['scope'];
  /** Whether this pass may rewrite an existing row with the same slug. */
  mayWrite: (row: SlotDefinition) => boolean;
}

interface ReconcileCounts {
  created: number;
  updated: number;
  deactivated: number;
  /** Slugs this pass left alone because another partition holds them. */
  skipped: string[];
}

/**
 * Reconcile one partition's definitions into rows: create new slugs, update rows
 * whose code changed (no write when unchanged), and deactivate this partition's
 * rows whose slug is gone. The `notIn` filter is omitted when no slugs remain so it
 * never degenerates to `notIn: []`.
 */
async function reconcileSlotDefinitions(
  tx: Tx,
  definitions: ResolvedSlotDefinition[],
  partition: SlotPartition
): Promise<ReconcileCounts> {
  const slugs = definitions.map((d) => d.slug);
  const existing =
    slugs.length > 0 ? await tx.slotDefinition.findMany({ where: { slug: { in: slugs } } }) : [];
  const bySlug = new Map(existing.map((row) => [row.slug, row]));

  // Create newly-declared slugs (all code-owned fields; `isActive` defaults true).
  const toCreate = definitions.filter((d) => !bySlug.has(d.slug));
  if (toCreate.length > 0) {
    await tx.slotDefinition.createMany({ data: toCreate, skipDuplicates: true });
  }

  // Propagate code edits (and re-activation) to existing rows — only when changed.
  let updated = 0;
  const skipped: string[] = [];
  for (const desired of definitions) {
    const row = bySlug.get(desired.slug);
    if (!row) continue;
    if (!partition.mayWrite(row)) {
      skipped.push(desired.slug);
      continue;
    }
    if (slotDefinitionNeedsUpdate(row, desired)) {
      await tx.slotDefinition.update({
        where: { slug: desired.slug },
        data: { ...desired, isActive: true },
      });
      updated++;
    }
  }

  // Deactivate this partition's rows whose code was removed (retain for audit).
  const { count: deactivated } = await tx.slotDefinition.updateMany({
    where: {
      isActive: true,
      scope: partition.scope,
      ...(slugs.length > 0 ? { slug: { notIn: slugs } } : {}),
    },
    data: { isActive: false },
  });

  return { created: toCreate.length, updated, deactivated, skipped };
}

/** Module slots own every `module:%` row, and take over a slug from any other scope. */
const MODULE_PARTITION: SlotPartition = {
  scope: { startsWith: SLOT_SCOPE_MODULE_PREFIX },
  mayWrite: () => true,
};

/** Global slots own the `global` rows, and never take a slug another scope holds. */
const GLOBAL_PARTITION: SlotPartition = {
  scope: SLOT_SCOPE.global,
  mayWrite: (row) => row.scope === SLOT_SCOPE.global,
};

async function syncModuleSlotDefinitions(): Promise<void> {
  // "Did registration run?" is a question about MODULES, not slots (see the file
  // header): zero registered modules ⇒ a fluke boot ⇒ skip, never mass-deactivate.
  if (getRegisteredModules().length === 0) {
    logger.info('syncRegisteredSlotDefinitions: no registered modules — nothing to sync');
    return;
  }

  const definitions = collectRegisteredSlotDefinitions();

  const { created, updated, deactivated } = await executeTransaction(
    (tx) => reconcileSlotDefinitions(tx, definitions, MODULE_PARTITION),
    { timeout: SYNC_TX_TIMEOUT_MS }
  );

  logger.info('syncRegisteredSlotDefinitions: framework slot definitions synced', {
    registered: definitions.length,
    created,
    updated,
    deactivated,
  });
}

/**
 * Supplies the leaf's global slot definitions. Async because a leaf may keep them
 * as data (an admin-edited table) rather than code; called on every sync, never at
 * registration.
 */
export type GlobalSlotDefinitionProvider = () => Promise<readonly SlotDefinitionInput[]>;

// On `globalThis` for the module registry's reason (#160): the boot seam registers
// in the instrumentation graph, and an admin route asking for a re-sync may run in
// another.
const globalForSlotProvider = globalThis as unknown as {
  daybreakGlobalSlotDefinitionProvider?: GlobalSlotDefinitionProvider;
};

/**
 * Register the provider of global slot definitions. One per app: a later
 * registration replaces the earlier (HMR / repeat-import safe). Call from the
 * leaf's boot seam, before `syncFramework()`.
 */
export function registerGlobalSlotDefinitionProvider(provider: GlobalSlotDefinitionProvider): void {
  globalForSlotProvider.daybreakGlobalSlotDefinitionProvider = provider;
}

/** Test-only: forget the registered provider. */
export function __resetGlobalSlotDefinitionProviderForTests(): void {
  delete globalForSlotProvider.daybreakGlobalSlotDefinitionProvider;
}

/** What one global pass did. `status` says why a pass wrote nothing. */
export type GlobalSlotSyncResult =
  | { status: 'no_provider' }
  | { status: 'empty' }
  | ({ status: 'synced'; provided: number } & ReconcileCounts);

/**
 * Reconcile the registered provider's definitions as `scope = global`. Idempotent:
 * a call with nothing changed writes no row. Throws when the provider or the write
 * fails — call it after an edit to the provider's source and report the failure.
 */
export async function syncGlobalSlotDefinitions(): Promise<GlobalSlotSyncResult> {
  const provider = globalForSlotProvider.daybreakGlobalSlotDefinitionProvider;
  if (!provider) return { status: 'no_provider' };

  const bySlug = new Map<string, ResolvedSlotDefinition>();
  for (const input of await provider()) {
    if (bySlug.has(input.slug)) {
      logger.warn('syncGlobalSlotDefinitions: duplicate slot slug — last one wins', {
        slug: input.slug,
      });
    }
    bySlug.set(input.slug, resolveSlotDefinition(input, SLOT_SCOPE.global));
  }
  const definitions = [...bySlug.values()];

  // Safe on empty (see the file header): nothing provided is never "retire them all".
  if (definitions.length === 0) {
    logger.warn('syncGlobalSlotDefinitions: provider returned no definitions — nothing written');
    return { status: 'empty' };
  }

  const counts = await executeTransaction(
    (tx) => reconcileSlotDefinitions(tx, definitions, GLOBAL_PARTITION),
    { timeout: SYNC_TX_TIMEOUT_MS }
  );

  if (counts.skipped.length > 0) {
    logger.warn(
      'syncGlobalSlotDefinitions: slug already held by another scope — left to its owner',
      { slugs: counts.skipped }
    );
  }
  logger.info('syncGlobalSlotDefinitions: global slot definitions synced', {
    provided: definitions.length,
    created: counts.created,
    updated: counts.updated,
    deactivated: counts.deactivated,
  });

  return { status: 'synced', provided: definitions.length, ...counts };
}

/**
 * The boot sync: module slots, then the leaf's global slots. The global pass runs
 * second so a slug both declare is settled for the module on the same boot.
 */
export async function syncRegisteredSlotDefinitions(): Promise<void> {
  await syncModuleSlotDefinitions();
  try {
    await syncGlobalSlotDefinitions();
  } catch (error) {
    // Leaf code must not stop the framework's remaining syncs (see the file header).
    logger.error(
      'syncRegisteredSlotDefinitions: global slot sync failed — module slots are synced',
      {
        error: error instanceof Error ? error.message : String(error),
      }
    );
  }
}
