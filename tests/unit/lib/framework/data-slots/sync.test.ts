/**
 * Boot-time slot-definition sync unit tests — the reconcile proof.
 *
 * House style: no live DB in vitest (real-DB verification is via `smoke:*`
 * scripts). We mock `executeTransaction` to forward its callback to a prisma `tx`
 * mock and assert the reconcile shape `syncRegisteredSlotDefinitions()` issues.
 * Unlike module sync (seed-once — the row has operator columns to preserve), a slot
 * definition is a pure code projection, so this sync *propagates edits*:
 *   - `createMany` writes newly-declared slugs, defaults resolved + `scope` stamped
 *     `module:<slug>`;
 *   - a per-slug `update` fires ONLY when a row's code-owned fields (or `isActive`)
 *     changed — an unchanged boot writes nothing;
 *   - a guarded `updateMany` deactivates code-removed rows, scoped to `module:%`;
 *   - the "did registration run?" guard keys on MODULES: zero registered modules is
 *     a no-op, but a module with zero slots still reconciles (so removing a module's
 *     last slot deactivates its row).
 * The module registry is real (slots are collected from registered modules).
 */

import { describe, it, expect, beforeEach, vi } from 'vitest';
import { z } from 'zod';
import type { SlotDefinition } from '@prisma/client';
import type { SlotDefinitionInput } from '@/lib/framework/data-slots/definition';

const txMock = {
  slotDefinition: {
    findMany: vi.fn(),
    createMany: vi.fn(),
    update: vi.fn(),
    updateMany: vi.fn(),
  },
};

vi.mock('@/lib/db/utils', () => ({
  executeTransaction: vi.fn(async (cb: (tx: unknown) => Promise<unknown>, _opts?: unknown) =>
    cb(txMock)
  ),
}));

vi.mock('@/lib/logging', () => ({
  logger: { info: vi.fn(), error: vi.fn(), warn: vi.fn(), debug: vi.fn() },
}));

const {
  syncRegisteredSlotDefinitions,
  syncGlobalSlotDefinitions,
  registerGlobalSlotDefinitionProvider,
  __resetGlobalSlotDefinitionProviderForTests,
} = await import('@/lib/framework/data-slots/sync');
const { registerModule, __resetModuleRegistryForTests } =
  await import('@/lib/framework/modules/registry');
const { executeTransaction } = await import('@/lib/db/utils');
const { logger } = await import('@/lib/logging');

const executeTransactionMock = executeTransaction as ReturnType<typeof vi.fn>;
const loggerInfo = logger.info as ReturnType<typeof vi.fn>;
const loggerWarn = logger.warn as ReturnType<typeof vi.fn>;
const loggerError = logger.error as ReturnType<typeof vi.fn>;

/** Register a module owning the given slot definitions. */
function registerModuleWithSlots(slug: string, slotDefinitions: SlotDefinitionInput[]): void {
  registerModule({
    slug,
    name: `Module ${slug}`,
    description: `The ${slug} module`,
    configSchema: z.object({}),
    slotDefinitions,
  });
}

/** A full row as the fake DB would return it — start from a resolved definition. */
function row(overrides: Partial<SlotDefinition> & Pick<SlotDefinition, 'slug'>): SlotDefinition {
  return {
    id: `slot_${overrides.slug}`,
    group: 'goals',
    description: 'A goal',
    scope: 'module:onboarding',
    visibility: 'open',
    mode: 'targeted',
    dataType: 'text',
    sensitivity: 'standard',
    priorityWeight: 0,
    isActive: true,
    createdAt: new Date(0),
    updatedAt: new Date(0),
    ...overrides,
  };
}

beforeEach(() => {
  vi.clearAllMocks();
  __resetModuleRegistryForTests();
  __resetGlobalSlotDefinitionProviderForTests();
  txMock.slotDefinition.findMany.mockResolvedValue([]);
  txMock.slotDefinition.updateMany.mockResolvedValue({ count: 0 });
});

describe('syncRegisteredSlotDefinitions', () => {
  it('no registered modules is a no-op: no transaction, no writes', async () => {
    await syncRegisteredSlotDefinitions();

    expect(executeTransactionMock).not.toHaveBeenCalled();
    expect(txMock.slotDefinition.createMany).not.toHaveBeenCalled();
    expect(txMock.slotDefinition.update).not.toHaveBeenCalled();
    expect(txMock.slotDefinition.updateMany).not.toHaveBeenCalled();
    expect(loggerInfo).toHaveBeenCalledWith(
      'syncRegisteredSlotDefinitions: no registered modules — nothing to sync'
    );
  });

  it('a module registered with zero slots still reconciles (deactivates all module-owned rows)', async () => {
    // A module is present (registration ran) but declares no slots — its last slot
    // was removed. The deactivate pass must run, scoped to module:% with no slug filter.
    registerModuleWithSlots('onboarding', []);

    await syncRegisteredSlotDefinitions();

    expect(executeTransactionMock).toHaveBeenCalledTimes(1);
    expect(txMock.slotDefinition.findMany).not.toHaveBeenCalled(); // no slugs to look up
    expect(txMock.slotDefinition.createMany).not.toHaveBeenCalled();
    expect(txMock.slotDefinition.update).not.toHaveBeenCalled();
    expect(txMock.slotDefinition.updateMany).toHaveBeenCalledWith({
      where: { isActive: true, scope: { startsWith: 'module:' } },
      data: { isActive: false },
    });
  });

  it('creates new slugs with defaults resolved and scope stamped module:<slug>', async () => {
    registerModuleWithSlots('onboarding', [
      { slug: 'primary_goal', group: 'goals', description: 'The main goal' },
      {
        slug: 'health_note',
        group: 'health',
        description: 'A health note',
        sensitivity: 'special_category',
        dataType: 'json',
        visibility: 'hidden',
        mode: 'open',
        priorityWeight: 5,
      },
    ]);

    await syncRegisteredSlotDefinitions();

    expect(txMock.slotDefinition.createMany).toHaveBeenCalledTimes(1);
    expect(txMock.slotDefinition.createMany).toHaveBeenCalledWith({
      data: [
        {
          slug: 'primary_goal',
          group: 'goals',
          description: 'The main goal',
          scope: 'module:onboarding',
          visibility: 'open',
          mode: 'targeted',
          dataType: 'text',
          sensitivity: 'standard',
          priorityWeight: 0,
        },
        {
          slug: 'health_note',
          group: 'health',
          description: 'A health note',
          scope: 'module:onboarding',
          visibility: 'hidden',
          mode: 'open',
          dataType: 'json',
          sensitivity: 'special_category',
          priorityWeight: 5,
        },
      ],
      skipDuplicates: true,
    });
    // Nothing existing ⇒ no per-row updates.
    expect(txMock.slotDefinition.update).not.toHaveBeenCalled();
  });

  it('does not update an existing row whose code is unchanged (no churn)', async () => {
    registerModuleWithSlots('onboarding', [
      { slug: 'primary_goal', group: 'goals', description: 'The main goal' },
    ]);
    // The DB already holds the identical resolved row.
    txMock.slotDefinition.findMany.mockResolvedValue([
      row({
        slug: 'primary_goal',
        group: 'goals',
        description: 'The main goal',
        scope: 'module:onboarding',
      }),
    ]);

    await syncRegisteredSlotDefinitions();

    // Nothing new to create, nothing changed to update — the row is left alone.
    expect(txMock.slotDefinition.createMany).not.toHaveBeenCalled();
    expect(txMock.slotDefinition.update).not.toHaveBeenCalled();
  });

  it('updates an existing row whose code changed, writing the resolved fields + isActive true', async () => {
    registerModuleWithSlots('onboarding', [
      {
        slug: 'primary_goal',
        group: 'goals',
        description: 'A reworded goal',
        sensitivity: 'sensitive',
      },
    ]);
    // The DB row is stale (old description, previously deactivated).
    txMock.slotDefinition.findMany.mockResolvedValue([
      row({
        slug: 'primary_goal',
        group: 'goals',
        description: 'The main goal',
        sensitivity: 'standard',
        isActive: false,
      }),
    ]);

    await syncRegisteredSlotDefinitions();

    expect(txMock.slotDefinition.update).toHaveBeenCalledTimes(1);
    expect(txMock.slotDefinition.update).toHaveBeenCalledWith({
      where: { slug: 'primary_goal' },
      data: {
        slug: 'primary_goal',
        group: 'goals',
        description: 'A reworded goal',
        scope: 'module:onboarding',
        visibility: 'open',
        mode: 'targeted',
        dataType: 'text',
        sensitivity: 'sensitive',
        priorityWeight: 0,
        isActive: true,
      },
    });
  });

  it('deactivates module-owned rows whose code was removed, guarded to only active rows', async () => {
    registerModuleWithSlots('onboarding', [
      { slug: 'primary_goal', group: 'goals', description: 'The main goal' },
    ]);

    await syncRegisteredSlotDefinitions();

    // Scoped to module:% (never touches global/facilitation rows) and to active rows.
    expect(txMock.slotDefinition.updateMany).toHaveBeenCalledWith({
      where: {
        isActive: true,
        scope: { startsWith: 'module:' },
        slug: { notIn: ['primary_goal'] },
      },
      data: { isActive: false },
    });
  });

  it('dedupes a slug declared twice — last registration wins, logged', async () => {
    registerModuleWithSlots('onboarding', [
      { slug: 'goal', group: 'goals', description: 'From onboarding' },
    ]);
    registerModuleWithSlots('review', [
      { slug: 'goal', group: 'goals', description: 'From review' },
    ]);

    await syncRegisteredSlotDefinitions();

    const created = txMock.slotDefinition.createMany.mock.calls[0]?.[0]?.data as Array<{
      slug: string;
      description: string;
      scope: string;
    }>;
    expect(created).toHaveLength(1);
    expect(created[0]?.description).toBe('From review');
    expect(created[0]?.scope).toBe('module:review');
    expect(loggerWarn).toHaveBeenCalledWith(
      'collectRegisteredSlotDefinitions: duplicate slot slug — last registration wins (slugs must be globally unique)',
      { slug: 'goal', moduleSlug: 'review' }
    );
  });

  it('runs the writes in one transaction with a raised timeout (#368)', async () => {
    registerModuleWithSlots('onboarding', [
      { slug: 'primary_goal', group: 'goals', description: 'The main goal' },
    ]);

    await syncRegisteredSlotDefinitions();

    expect(executeTransactionMock).toHaveBeenCalledTimes(1);
    expect(executeTransactionMock.mock.calls[0]?.[1]).toEqual({ timeout: 20_000 });
  });

  it('logs registered / created / updated / deactivated counts', async () => {
    registerModuleWithSlots('onboarding', [
      { slug: 'primary_goal', group: 'goals', description: 'The main goal' },
    ]);
    txMock.slotDefinition.updateMany.mockResolvedValue({ count: 3 });

    await syncRegisteredSlotDefinitions();

    expect(loggerInfo).toHaveBeenCalledWith(
      'syncRegisteredSlotDefinitions: framework slot definitions synced',
      { registered: 1, created: 1, updated: 0, deactivated: 3 }
    );
  });
});

/**
 * The global-slot seam carried ahead of Daybreak (`.context/app/divergences.md`,
 * Row 22). The first block is the neutrality proof: with no provider registered,
 * the sync must issue exactly the module pass's calls and nothing else.
 */
describe('syncRegisteredSlotDefinitions — no global provider registered (neutral at rest)', () => {
  it('issues exactly the module pass: one transaction, one read, one create, one scoped deactivate', async () => {
    registerModuleWithSlots('onboarding', [
      { slug: 'primary_goal', group: 'goals', description: 'The main goal' },
    ]);

    await syncRegisteredSlotDefinitions();

    expect(executeTransactionMock).toHaveBeenCalledTimes(1);
    expect(txMock.slotDefinition.findMany).toHaveBeenCalledTimes(1);
    expect(txMock.slotDefinition.findMany).toHaveBeenCalledWith({
      where: { slug: { in: ['primary_goal'] } },
    });
    expect(txMock.slotDefinition.createMany).toHaveBeenCalledTimes(1);
    expect(txMock.slotDefinition.update).not.toHaveBeenCalled();
    expect(txMock.slotDefinition.updateMany).toHaveBeenCalledTimes(1);
    expect(txMock.slotDefinition.updateMany).toHaveBeenCalledWith({
      where: {
        isActive: true,
        scope: { startsWith: 'module:' },
        slug: { notIn: ['primary_goal'] },
      },
      data: { isActive: false },
    });
    expect(loggerWarn).not.toHaveBeenCalled();
    expect(loggerError).not.toHaveBeenCalled();
  });

  it('an on-demand global sync with no provider touches nothing', async () => {
    await expect(syncGlobalSlotDefinitions()).resolves.toEqual({ status: 'no_provider' });
    expect(executeTransactionMock).not.toHaveBeenCalled();
  });
});

describe('syncGlobalSlotDefinitions', () => {
  it("lands the provider's slots scope global, defaults resolved", async () => {
    registerGlobalSlotDefinitionProvider(async () => [
      { slug: 'relationship', group: 'person', description: 'Who they share life with' },
    ]);

    const result = await syncGlobalSlotDefinitions();

    expect(txMock.slotDefinition.createMany).toHaveBeenCalledWith({
      data: [
        {
          slug: 'relationship',
          group: 'person',
          description: 'Who they share life with',
          scope: 'global',
          visibility: 'open',
          mode: 'targeted',
          dataType: 'text',
          sensitivity: 'standard',
          priorityWeight: 0,
        },
      ],
      skipDuplicates: true,
    });
    expect(result).toMatchObject({ status: 'synced', provided: 1, created: 1, updated: 0 });
  });

  it('deactivates only global rows whose slug the provider dropped', async () => {
    registerGlobalSlotDefinitionProvider(async () => [
      { slug: 'relationship', group: 'person', description: 'Who they share life with' },
    ]);

    await syncGlobalSlotDefinitions();

    expect(txMock.slotDefinition.updateMany).toHaveBeenCalledWith({
      where: { isActive: true, scope: 'global', slug: { notIn: ['relationship'] } },
      data: { isActive: false },
    });
  });

  it('writes nothing when nothing changed (idempotent re-sync)', async () => {
    registerGlobalSlotDefinitionProvider(async () => [
      { slug: 'relationship', group: 'person', description: 'Who they share life with' },
    ]);
    txMock.slotDefinition.findMany.mockResolvedValue([
      row({
        slug: 'relationship',
        group: 'person',
        description: 'Who they share life with',
        scope: 'global',
      }),
    ]);

    const result = await syncGlobalSlotDefinitions();

    expect(txMock.slotDefinition.createMany).not.toHaveBeenCalled();
    expect(txMock.slotDefinition.update).not.toHaveBeenCalled();
    expect(result).toMatchObject({ created: 0, updated: 0, deactivated: 0 });
  });

  it('propagates an edited wording to the global row', async () => {
    registerGlobalSlotDefinitionProvider(async () => [
      { slug: 'relationship', group: 'person', description: 'Reworded' },
    ]);
    txMock.slotDefinition.findMany.mockResolvedValue([
      row({ slug: 'relationship', group: 'person', description: 'Original', scope: 'global' }),
    ]);

    await syncGlobalSlotDefinitions();

    expect(txMock.slotDefinition.update).toHaveBeenCalledWith({
      where: { slug: 'relationship' },
      data: expect.objectContaining({ description: 'Reworded', scope: 'global', isActive: true }),
    });
  });

  it('never rewrites a slug a module holds — skipped and warned, not flipped to global', async () => {
    registerGlobalSlotDefinitionProvider(async () => [
      { slug: 'primary_goal', group: 'goals', description: 'A global take on it' },
      { slug: 'relationship', group: 'person', description: 'Who they share life with' },
    ]);
    txMock.slotDefinition.findMany.mockResolvedValue([
      row({ slug: 'primary_goal', scope: 'module:onboarding' }),
    ]);

    const result = await syncGlobalSlotDefinitions();

    expect(txMock.slotDefinition.update).not.toHaveBeenCalled();
    const created = txMock.slotDefinition.createMany.mock.calls[0]?.[0]?.data as Array<{
      slug: string;
    }>;
    expect(created.map((d) => d.slug)).toEqual(['relationship']);
    expect(result).toMatchObject({ skipped: ['primary_goal'] });
    expect(loggerWarn).toHaveBeenCalledWith(
      'syncGlobalSlotDefinitions: slug already held by another scope — left to its owner',
      { slugs: ['primary_goal'] }
    );
  });

  it('takes over a slug whose module retired it (inactive row), stamping it global', async () => {
    registerGlobalSlotDefinitionProvider(async () => [
      { slug: 'relationship', group: 'person', description: 'Who they share life with' },
    ]);
    txMock.slotDefinition.findMany.mockResolvedValue([
      row({ slug: 'relationship', scope: 'module:onboarding', isActive: false }),
    ]);

    const result = await syncGlobalSlotDefinitions();

    expect(txMock.slotDefinition.update).toHaveBeenCalledWith({
      where: { slug: 'relationship' },
      data: expect.objectContaining({ scope: 'global', isActive: true }),
    });
    expect(result).toMatchObject({ skipped: [], updated: 1 });
  });

  it('runs overlapping re-syncs one at a time, each reading the provider on its turn', async () => {
    const order: string[] = [];
    let release!: () => void;
    const gate = new Promise<void>((resolve) => (release = resolve));
    let calls = 0;
    registerGlobalSlotDefinitionProvider(async () => {
      const n = ++calls;
      order.push(`read ${n}`);
      if (n === 1) await gate;
      return [{ slug: 'relationship', group: 'person', description: `Edit ${n}` }];
    });
    const recordWrite = () => {
      order.push('write');
      return Promise.resolve({ count: 1 });
    };
    txMock.slotDefinition.createMany.mockImplementationOnce(recordWrite);
    txMock.slotDefinition.createMany.mockImplementationOnce(recordWrite);

    const first = syncGlobalSlotDefinitions();
    const second = syncGlobalSlotDefinitions();
    await Promise.resolve();
    release();
    await Promise.all([first, second]);

    // The second never reads before the first has written.
    expect(order).toEqual(['read 1', 'write', 'read 2', 'write']);
  });

  it('a failed re-sync does not wedge the ones queued behind it', async () => {
    let calls = 0;
    registerGlobalSlotDefinitionProvider(async () => {
      if (++calls === 1) throw new Error('taxonomy unreadable');
      return [{ slug: 'relationship', group: 'person', description: 'Who' }];
    });

    const first = syncGlobalSlotDefinitions();
    const second = syncGlobalSlotDefinitions();

    await expect(first).rejects.toThrow('taxonomy unreadable');
    await expect(second).resolves.toMatchObject({ status: 'synced' });
  });

  it('an empty provider writes nothing — no mass deactivation (safe on empty)', async () => {
    registerGlobalSlotDefinitionProvider(async () => []);

    const result = await syncGlobalSlotDefinitions();

    expect(result).toEqual({ status: 'empty' });
    expect(executeTransactionMock).not.toHaveBeenCalled();
    expect(txMock.slotDefinition.updateMany).not.toHaveBeenCalled();
  });

  it('dedupes a slug the provider repeats — last wins, logged', async () => {
    registerGlobalSlotDefinitionProvider(async () => [
      { slug: 'relationship', group: 'person', description: 'First' },
      { slug: 'relationship', group: 'person', description: 'Second' },
    ]);

    await syncGlobalSlotDefinitions();

    const created = txMock.slotDefinition.createMany.mock.calls[0]?.[0]?.data as Array<{
      description: string;
    }>;
    expect(created).toHaveLength(1);
    expect(created[0]?.description).toBe('Second');
    expect(loggerWarn).toHaveBeenCalledWith(
      'syncGlobalSlotDefinitions: duplicate slot slug — last one wins',
      { slug: 'relationship' }
    );
  });

  it('on demand, a provider failure reaches the caller', async () => {
    registerGlobalSlotDefinitionProvider(async () => {
      throw new Error('taxonomy unreadable');
    });

    await expect(syncGlobalSlotDefinitions()).rejects.toThrow('taxonomy unreadable');
    expect(executeTransactionMock).not.toHaveBeenCalled();
  });
});

describe('syncRegisteredSlotDefinitions — with a global provider', () => {
  it('runs the module pass, then the global pass, in separate transactions', async () => {
    registerModuleWithSlots('onboarding', [
      { slug: 'primary_goal', group: 'goals', description: 'The main goal' },
    ]);
    registerGlobalSlotDefinitionProvider(async () => [
      { slug: 'relationship', group: 'person', description: 'Who they share life with' },
    ]);

    await syncRegisteredSlotDefinitions();

    expect(executeTransactionMock).toHaveBeenCalledTimes(2);
    const scopes = txMock.slotDefinition.updateMany.mock.calls.map(
      (call) => (call[0] as { where: { scope: unknown } }).where.scope
    );
    expect(scopes).toEqual([{ startsWith: 'module:' }, 'global']);
  });

  it('at boot, a provider failure is logged and does not throw (later framework syncs still run)', async () => {
    registerModuleWithSlots('onboarding', [
      { slug: 'primary_goal', group: 'goals', description: 'The main goal' },
    ]);
    registerGlobalSlotDefinitionProvider(async () => {
      throw new Error('taxonomy unreadable');
    });

    await expect(syncRegisteredSlotDefinitions()).resolves.toBeUndefined();

    expect(executeTransactionMock).toHaveBeenCalledTimes(1); // the module pass only
    expect(loggerError).toHaveBeenCalledWith(
      'syncRegisteredSlotDefinitions: global slot sync failed — module slots are synced',
      { error: 'taxonomy unreadable' }
    );
  });
});
