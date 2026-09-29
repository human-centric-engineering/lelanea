/**
 * End-to-end slot-definition visibility (f-slots t-1).
 *
 * Proves the definition side composes: slots declared on a module in code are
 * reconciled to `framework_slot_definition` rows by the real
 * `syncRegisteredSlotDefinitions`, then surfaced by the real `listSlotDefinitions`
 * — registration → row → read visibility, scoped `module:<slug>`, with nothing a
 * fork strips (the fixture lives here in `tests/`, not the app).
 *
 * No live DB in vitest (house style), so Prisma is a small STATEFUL in-memory fake:
 * `createMany`/`update`/`updateMany` mutate a store and `findMany` reads it back, so
 * the real reconcile + query logic runs against a coherent backing store. Mirrors
 * tests/integration/lib/framework/modules/registration-visibility.test.ts.
 */

import { describe, it, expect, beforeEach, vi } from 'vitest';
import { z } from 'zod';
import type { SlotDefinition } from '@prisma/client';
import type { SlotDefinitionInput } from '@/lib/framework/data-slots/definition';

const { prismaFake, resetStore, seedRow } = vi.hoisted(() => {
  const store = new Map<string, SlotDefinition>();

  function rowFrom(data: Record<string, unknown>): SlotDefinition {
    return {
      id: `slot_${String(data.slug)}`,
      orgId: (data.orgId as string | null | undefined) ?? null,
      slug: String(data.slug),
      group: String(data.group),
      description: String(data.description),
      scope: (data.scope as string) ?? 'global',
      visibility: (data.visibility as string) ?? 'open',
      mode: (data.mode as string) ?? 'targeted',
      dataType: (data.dataType as string) ?? 'text',
      sensitivity: (data.sensitivity as string) ?? 'standard',
      priorityWeight: (data.priorityWeight as number) ?? 0,
      isActive: (data.isActive as boolean) ?? true,
      createdAt: new Date(0),
      updatedAt: new Date(0),
    };
  }

  function matches(
    r: SlotDefinition,
    where: {
      slug?: string | { in?: string[]; notIn?: string[] };
      isActive?: boolean;
      scope?: { startsWith?: string };
    }
  ): boolean {
    if (typeof where.slug === 'string' && r.slug !== where.slug) return false;
    if (typeof where.slug === 'object') {
      if (where.slug.in && !where.slug.in.includes(r.slug)) return false;
      if (where.slug.notIn && where.slug.notIn.includes(r.slug)) return false;
    }
    if (where.isActive !== undefined && r.isActive !== where.isActive) return false;
    if (where.scope?.startsWith && !r.scope.startsWith(where.scope.startsWith)) return false;
    return true;
  }

  const prismaFake = {
    slotDefinition: {
      findMany: async (args?: {
        where?: { slug?: { in?: string[]; notIn?: string[] } };
        orderBy?: { slug?: 'asc' | 'desc' };
      }) => {
        let rows = [...store.values()].map((r) => ({ ...r }));
        if (args?.where) rows = rows.filter((r) => matches(r, args.where!));
        if (args?.orderBy?.slug === 'asc') {
          rows.sort((a, b) => (a.slug < b.slug ? -1 : a.slug > b.slug ? 1 : 0));
        }
        return rows;
      },
      createMany: async (args: { data: Record<string, unknown>[]; skipDuplicates?: boolean }) => {
        let count = 0;
        for (const d of args.data) {
          if (args.skipDuplicates && store.has(String(d.slug))) continue;
          store.set(String(d.slug), rowFrom(d));
          count++;
        }
        return { count };
      },
      update: async (args: { where: { id: string }; data: Record<string, unknown> }) => {
        const r = [...store.values()].find((row) => row.id === args.where.id);
        if (!r) throw new Error(`no slot with id ${args.where.id}`);
        Object.assign(r, args.data);
        return { ...r };
      },
      updateMany: async (args: {
        where: {
          slug?: { in?: string[]; notIn?: string[] };
          isActive?: boolean;
          scope?: { startsWith?: string };
        };
        data: { isActive?: boolean };
      }) => {
        let count = 0;
        for (const r of store.values()) {
          if (matches(r, args.where)) {
            Object.assign(r, args.data);
            count++;
          }
        }
        return { count };
      },
    },
  };

  return {
    prismaFake,
    resetStore: () => store.clear(),
    // Inject a row the module sync didn't author (e.g. a global/facilitation slot).
    seedRow: (data: Record<string, unknown>) => {
      const r = rowFrom(data);
      store.set(r.slug, r);
    },
  };
});

vi.mock('@/lib/db/client', () => ({ prisma: prismaFake }));
vi.mock('@/lib/db/utils', () => ({
  executeTransaction: async (cb: (tx: typeof prismaFake) => Promise<unknown>) => cb(prismaFake),
}));
vi.mock('@/lib/logging', () => ({
  logger: { info: vi.fn(), error: vi.fn(), warn: vi.fn(), debug: vi.fn() },
}));

const { syncRegisteredSlotDefinitions, listSlotDefinitions } =
  await import('@/lib/framework/data-slots');
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

beforeEach(() => {
  vi.clearAllMocks();
  __resetModuleRegistryForTests();
  resetStore();
});

describe('slot-definition registration → row → read visibility', () => {
  it('module-declared slots become listable rows scoped module:<slug>, ordered by slug', async () => {
    registerModuleWithSlots('onboarding', [
      { slug: 'primary_goal', group: 'goals', description: 'The main goal' },
      {
        slug: 'health_note',
        group: 'health',
        description: 'A note',
        sensitivity: 'special_category',
      },
    ]);

    await syncRegisteredSlotDefinitions();
    const slots = await listSlotDefinitions();

    expect(slots.map((s) => s.slug)).toEqual(['health_note', 'primary_goal']);
    expect(slots.every((s) => s.scope === 'module:onboarding')).toBe(true);
    expect(slots.every((s) => s.isActive)).toBe(true);
    expect(slots.find((s) => s.slug === 'health_note')?.sensitivity).toBe('special_category');
    // Defaults resolved on the row.
    expect(slots.find((s) => s.slug === 'primary_goal')?.mode).toBe('targeted');
  });

  it('an authored edit propagates to the existing row on the next sync', async () => {
    registerModuleWithSlots('onboarding', [
      {
        slug: 'primary_goal',
        group: 'goals',
        description: 'The main goal',
        sensitivity: 'standard',
      },
    ]);
    await syncRegisteredSlotDefinitions();

    // Author reworks the slot in code and redeploys.
    __resetModuleRegistryForTests();
    registerModuleWithSlots('onboarding', [
      {
        slug: 'primary_goal',
        group: 'goals',
        description: 'A sharper goal',
        sensitivity: 'sensitive',
      },
    ]);
    await syncRegisteredSlotDefinitions();

    const slot = (await listSlotDefinitions()).find((s) => s.slug === 'primary_goal');
    expect(slot?.description).toBe('A sharper goal');
    expect(slot?.sensitivity).toBe('sensitive');
  });

  it('removing a slot from code deactivates its row but keeps it visible; re-adding reactivates', async () => {
    registerModuleWithSlots('onboarding', [
      { slug: 'primary_goal', group: 'goals', description: 'The main goal' },
      { slug: 'secondary_goal', group: 'goals', description: 'A secondary goal' },
    ]);
    await syncRegisteredSlotDefinitions();

    // Next boot: 'secondary_goal' removed from code.
    __resetModuleRegistryForTests();
    registerModuleWithSlots('onboarding', [
      { slug: 'primary_goal', group: 'goals', description: 'The main goal' },
    ]);
    await syncRegisteredSlotDefinitions();

    let slots = await listSlotDefinitions();
    expect(slots.map((s) => s.slug)).toEqual(['primary_goal', 'secondary_goal']);
    expect(slots.find((s) => s.slug === 'secondary_goal')?.isActive).toBe(false);
    expect(slots.find((s) => s.slug === 'primary_goal')?.isActive).toBe(true);

    // Re-add it: reactivated.
    __resetModuleRegistryForTests();
    registerModuleWithSlots('onboarding', [
      { slug: 'primary_goal', group: 'goals', description: 'The main goal' },
      { slug: 'secondary_goal', group: 'goals', description: 'A secondary goal' },
    ]);
    await syncRegisteredSlotDefinitions();

    slots = await listSlotDefinitions();
    expect(slots.find((s) => s.slug === 'secondary_goal')?.isActive).toBe(true);
  });

  it('a module that keeps registering but drops its last slot deactivates that row', async () => {
    registerModuleWithSlots('onboarding', [
      { slug: 'primary_goal', group: 'goals', description: 'The main goal' },
    ]);
    await syncRegisteredSlotDefinitions();

    // The module still registers (registration ran) but now declares zero slots —
    // its last slot was removed. It must deactivate, not linger active (unlike the
    // fluke-empty case below where NO module registers).
    __resetModuleRegistryForTests();
    registerModuleWithSlots('onboarding', []);
    await syncRegisteredSlotDefinitions();

    const slot = (await listSlotDefinitions()).find((s) => s.slug === 'primary_goal');
    expect(slot?.isActive).toBe(false);
  });

  it('zero registered modules is a no-op and leaves prior rows untouched', async () => {
    registerModuleWithSlots('onboarding', [
      { slug: 'primary_goal', group: 'goals', description: 'The main goal' },
    ]);
    await syncRegisteredSlotDefinitions();

    // A boot where NO module registers (fluke — a caught init error) must not
    // mass-deactivate; "no modules" ≠ "a module intentionally declaring no slots".
    __resetModuleRegistryForTests();
    await syncRegisteredSlotDefinitions();

    const slots = await listSlotDefinitions();
    expect(slots).toHaveLength(1);
    expect(slots[0]?.isActive).toBe(true);
  });

  it('the module sync never deactivates a non-module (global) slot', async () => {
    // A global slot exists (a different, schema-permitted source — default scope).
    seedRow({ slug: 'person_name', group: 'identity', description: 'Name', scope: 'global' });

    // A module registers its own slot; its sync runs the deactivate pass.
    registerModuleWithSlots('onboarding', [
      { slug: 'primary_goal', group: 'goals', description: 'The main goal' },
    ]);
    await syncRegisteredSlotDefinitions();

    // The global row is untouched — the deactivate is scoped to module:% rows.
    const global = (await listSlotDefinitions()).find((s) => s.slug === 'person_name');
    expect(global?.isActive).toBe(true);
    expect(global?.scope).toBe('global');
  });
});
