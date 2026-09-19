/**
 * Global slots beside module slots, over repeated boots — the partition proof for
 * the seam carried ahead of Daybreak (`.context/app/divergences.md`, Row 22).
 *
 * The unit test pins the calls each pass issues; this one runs both passes against
 * a small STATEFUL in-memory table (no live DB in vitest), so "the global pass
 * never touches a module row, nor the module pass a global one" is proved on the
 * rows themselves, not argued from a `where` clause. Mirrors the fake in
 * `registration-visibility.test.ts`, plus exact-match `scope` filtering, which the
 * global pass uses and that fake does not model.
 */

import { describe, it, expect, beforeEach, vi } from 'vitest';
import { z } from 'zod';
import type { SlotDefinition } from '@prisma/client';
import type { SlotDefinitionInput } from '@/lib/framework/data-slots/definition';

const { prismaFake, store, writes } = vi.hoisted(() => {
  const store = new Map<string, SlotDefinition>();
  const writes = { count: 0 };

  type Where = {
    slug?: { in?: string[]; notIn?: string[] };
    isActive?: boolean;
    scope?: string | { startsWith?: string };
  };

  function matches(r: SlotDefinition, where: Where): boolean {
    if (where.slug?.in && !where.slug.in.includes(r.slug)) return false;
    if (where.slug?.notIn && where.slug.notIn.includes(r.slug)) return false;
    if (where.isActive !== undefined && r.isActive !== where.isActive) return false;
    if (typeof where.scope === 'string' && r.scope !== where.scope) return false;
    if (typeof where.scope === 'object' && where.scope.startsWith) {
      if (!r.scope.startsWith(where.scope.startsWith)) return false;
    }
    return true;
  }

  const prismaFake = {
    slotDefinition: {
      findMany: async (args: { where: Where }) =>
        [...store.values()].filter((r) => matches(r, args.where)).map((r) => ({ ...r })),
      createMany: async (args: {
        data: Array<Record<string, unknown>>;
        skipDuplicates?: boolean;
      }) => {
        for (const d of args.data) {
          if (store.has(String(d.slug))) continue;
          store.set(String(d.slug), {
            id: `slot_${String(d.slug)}`,
            isActive: true,
            createdAt: new Date(0),
            updatedAt: new Date(0),
            ...(d as Omit<SlotDefinition, 'id' | 'isActive' | 'createdAt' | 'updatedAt'>),
          });
          writes.count++;
        }
        return { count: args.data.length };
      },
      update: async (args: { where: { slug: string }; data: Partial<SlotDefinition> }) => {
        const r = store.get(args.where.slug);
        if (!r) throw new Error(`no slot ${args.where.slug}`);
        Object.assign(r, args.data);
        writes.count++;
        return { ...r };
      },
      updateMany: async (args: { where: Where; data: Partial<SlotDefinition> }) => {
        let count = 0;
        for (const r of store.values()) {
          if (matches(r, args.where)) {
            Object.assign(r, args.data);
            count++;
          }
        }
        writes.count += count;
        return { count };
      },
    },
  };

  return { prismaFake, store, writes };
});

vi.mock('@/lib/db/utils', () => ({
  executeTransaction: async (cb: (tx: typeof prismaFake) => Promise<unknown>) => cb(prismaFake),
}));
vi.mock('@/lib/logging', () => ({
  logger: { info: vi.fn(), error: vi.fn(), warn: vi.fn(), debug: vi.fn() },
}));

const {
  syncRegisteredSlotDefinitions,
  syncGlobalSlotDefinitions,
  registerGlobalSlotDefinitionProvider,
} = await import('@/lib/framework/data-slots');
const { __resetGlobalSlotDefinitionProviderForTests } =
  await import('@/lib/framework/data-slots/sync');
const { registerModule } = await import('@/lib/framework/modules');
const { __resetModuleRegistryForTests } = await import('@/lib/framework/modules/registry');

function registerModuleWithSlots(slug: string, slotDefinitions: SlotDefinitionInput[]): void {
  registerModule({
    slug,
    name: `Module ${slug}`,
    description: `The ${slug} module`,
    configSchema: z.object({}),
    slotDefinitions,
  });
}

/** A provider backed by a mutable list — stands in for an admin-edited table. */
let globalSource: SlotDefinitionInput[] = [];

function snapshot(): Record<string, { scope: string; isActive: boolean; description: string }> {
  return Object.fromEntries(
    [...store.values()].map((r) => [
      r.slug,
      { scope: r.scope, isActive: r.isActive, description: r.description },
    ])
  );
}

beforeEach(() => {
  store.clear();
  writes.count = 0;
  __resetModuleRegistryForTests();
  __resetGlobalSlotDefinitionProviderForTests();
  globalSource = [
    { slug: 'relationship', group: 'person', description: 'Who they share life with' },
    {
      slug: 'health',
      group: 'person',
      description: 'How their body is',
      sensitivity: 'special_category',
    },
  ];
  registerModuleWithSlots('onboarding', [
    { slug: 'primary_goal', group: 'goals', description: 'The main goal' },
  ]);
  registerGlobalSlotDefinitionProvider(async () => globalSource);
});

describe('global and module slots share one table without touching each other', () => {
  it('a boot lands both, each in its own scope', async () => {
    await syncRegisteredSlotDefinitions();

    expect(snapshot()).toEqual({
      primary_goal: { scope: 'module:onboarding', isActive: true, description: 'The main goal' },
      relationship: { scope: 'global', isActive: true, description: 'Who they share life with' },
      health: { scope: 'global', isActive: true, description: 'How their body is' },
    });
  });

  it('a slug the provider drops is deactivated; the module row is untouched', async () => {
    await syncRegisteredSlotDefinitions();
    globalSource = globalSource.filter((d) => d.slug !== 'health');

    await syncGlobalSlotDefinitions();

    expect(store.get('health')?.isActive).toBe(false);
    expect(store.get('relationship')?.isActive).toBe(true);
    expect(store.get('primary_goal')).toMatchObject({ isActive: true, scope: 'module:onboarding' });
  });

  it('a module losing every slot deactivates its rows and leaves the global rows active', async () => {
    await syncRegisteredSlotDefinitions();
    __resetModuleRegistryForTests();
    registerModuleWithSlots('onboarding', []);

    await syncRegisteredSlotDefinitions();

    expect(store.get('primary_goal')?.isActive).toBe(false);
    expect(store.get('relationship')?.isActive).toBe(true);
    expect(store.get('health')?.isActive).toBe(true);
  });

  it('an empty provider on a fluke boot leaves every global row active', async () => {
    await syncRegisteredSlotDefinitions();
    globalSource = [];

    await syncRegisteredSlotDefinitions();

    expect(store.get('relationship')?.isActive).toBe(true);
    expect(store.get('health')?.isActive).toBe(true);
  });

  it('a slug both declare stays the module’s across boots — no flip-flop', async () => {
    globalSource = [
      ...globalSource,
      { slug: 'primary_goal', group: 'goals', description: 'Global' },
    ];

    await syncRegisteredSlotDefinitions();
    await syncRegisteredSlotDefinitions();

    expect(store.get('primary_goal')).toMatchObject({
      scope: 'module:onboarding',
      description: 'The main goal',
      isActive: true,
    });
  });

  it('a slug a module retires can move to the global taxonomy, and back if the module reclaims it', async () => {
    await syncRegisteredSlotDefinitions();
    __resetModuleRegistryForTests();
    registerModuleWithSlots('onboarding', []);
    globalSource = [
      ...globalSource,
      { slug: 'primary_goal', group: 'goals', description: 'Global' },
    ];

    await syncRegisteredSlotDefinitions();
    expect(store.get('primary_goal')).toMatchObject({ scope: 'global', isActive: true });

    __resetModuleRegistryForTests();
    registerModuleWithSlots('onboarding', [
      { slug: 'primary_goal', group: 'goals', description: 'The main goal' },
    ]);
    await syncRegisteredSlotDefinitions();
    await syncRegisteredSlotDefinitions();
    expect(store.get('primary_goal')).toMatchObject({
      scope: 'module:onboarding',
      isActive: true,
    });
  });

  it('re-syncing after an edit writes the edit, and re-syncing again writes nothing', async () => {
    await syncRegisteredSlotDefinitions();
    globalSource = globalSource.map((d) =>
      d.slug === 'relationship' ? { ...d, description: 'Reworded by an admin' } : d
    );

    writes.count = 0;
    await syncGlobalSlotDefinitions();
    expect(writes.count).toBe(1);
    expect(store.get('relationship')?.description).toBe('Reworded by an admin');

    writes.count = 0;
    await syncGlobalSlotDefinitions();
    await syncRegisteredSlotDefinitions();
    expect(writes.count).toBe(0);
  });
});
