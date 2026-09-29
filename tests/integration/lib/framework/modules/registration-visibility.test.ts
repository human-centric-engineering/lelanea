/**
 * End-to-end visibility (f-module-core t-3, decision 1).
 *
 * Proves the three module tasks compose: a module registered in code (t-1) is
 * reconciled to a row by the real `syncRegisteredModules` (t-1) and then surfaced
 * by the real `listModules` (t-3) — registration → row → admin-read visibility,
 * with nothing a fork strips (the fixture lives here in `tests/`, not the app).
 *
 * There is no live DB in vitest (house style), so Prisma is a small STATEFUL
 * in-memory fake: `createMany`/`updateMany` mutate a store and `findMany` reads it
 * back, so the real sync + query logic runs against a coherent backing store rather
 * than fixed per-call stubs. The HTTP contract (auth guard, envelope) is proven
 * separately in tests/integration/api/v1/admin/framework/modules/route.test.ts.
 */

import { describe, it, expect, beforeEach, vi } from 'vitest';
import { z } from 'zod';
import type { Module } from '@prisma/client';

const { prismaFake, resetStore } = vi.hoisted(() => {
  const store = new Map<string, Module>();

  function row(slug: string, name: string): Module {
    return {
      id: `mod_${slug}`,
      orgId: null,
      slug,
      name,
      status: 'draft',
      featureFlagName: null,
      availableFrom: null,
      availableUntil: null,
      audience: 'all',
      config: {},
      isRegistered: true,
      createdAt: new Date(0),
      updatedAt: new Date(0),
    };
  }

  function matches(
    r: Module,
    where: { slug?: { in?: string[]; notIn?: string[] }; isRegistered?: boolean }
  ): boolean {
    if (where.slug?.in && !where.slug.in.includes(r.slug)) return false;
    if (where.slug?.notIn && where.slug.notIn.includes(r.slug)) return false;
    if (where.isRegistered !== undefined && r.isRegistered !== where.isRegistered) return false;
    return true;
  }

  const prismaFake = {
    module: {
      createMany: async (args: {
        data: { slug: string; name: string }[];
        skipDuplicates?: boolean;
      }) => {
        let count = 0;
        for (const d of args.data) {
          if (args.skipDuplicates && store.has(d.slug)) continue;
          store.set(d.slug, row(d.slug, d.name));
          count++;
        }
        return { count };
      },
      updateMany: async (args: {
        where: { slug?: { in?: string[]; notIn?: string[] }; isRegistered?: boolean };
        data: { isRegistered?: boolean };
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
      findMany: async (args?: { orderBy?: { slug?: 'asc' | 'desc' } }) => {
        const rows = [...store.values()].map((r) => ({ ...r }));
        if (args?.orderBy?.slug === 'asc') {
          rows.sort((a, b) => (a.slug < b.slug ? -1 : a.slug > b.slug ? 1 : 0));
        }
        return rows;
      },
    },
  };

  return { prismaFake, resetStore: () => store.clear() };
});

vi.mock('@/lib/db/client', () => ({ prisma: prismaFake }));
vi.mock('@/lib/db/utils', () => ({
  executeTransaction: async (cb: (tx: typeof prismaFake) => Promise<unknown>) => cb(prismaFake),
}));
vi.mock('@/lib/logging', () => ({
  logger: { info: vi.fn(), error: vi.fn(), warn: vi.fn(), debug: vi.fn() },
}));

const { registerModule, syncRegisteredModules, listModules } =
  await import('@/lib/framework/modules');
const { __resetModuleRegistryForTests } = await import('@/lib/framework/modules/registry');

function register(slug: string): void {
  registerModule({
    slug,
    name: `Module ${slug}`,
    description: `The ${slug} module`,
    configSchema: z.object({}),
  });
}

beforeEach(() => {
  vi.clearAllMocks();
  __resetModuleRegistryForTests();
  resetStore();
});

describe('module registration → row → admin-read visibility', () => {
  it('a code-registered module becomes a listable row after sync', async () => {
    register('beta');
    register('alpha');

    await syncRegisteredModules();
    const modules = await listModules();

    // Both appear, ordered by slug, flagged registered.
    expect(modules.map((m) => m.slug)).toEqual(['alpha', 'beta']);
    expect(modules.every((m) => m.isRegistered)).toBe(true);
    expect(modules.find((m) => m.slug === 'alpha')?.name).toBe('Module alpha');
  });

  it('removing a module from code retires its row (isRegistered=false) but keeps it visible', async () => {
    register('alpha');
    register('beta');
    await syncRegisteredModules();

    // Next boot: 'beta' was removed from code; only 'alpha' registers.
    __resetModuleRegistryForTests();
    register('alpha');
    await syncRegisteredModules();

    const modules = await listModules();
    // The row is retained for audit, flagged unregistered.
    expect(modules.map((m) => m.slug)).toEqual(['alpha', 'beta']);
    expect(modules.find((m) => m.slug === 'alpha')?.isRegistered).toBe(true);
    expect(modules.find((m) => m.slug === 'beta')?.isRegistered).toBe(false);
  });

  it('a re-added module is re-flagged registered on the next sync', async () => {
    register('alpha');
    await syncRegisteredModules();
    __resetModuleRegistryForTests();
    await syncRegisteredModules(); // empty registry ⇒ no-op, 'alpha' stays registered
    expect((await listModules()).find((m) => m.slug === 'alpha')?.isRegistered).toBe(true);

    // Now genuinely retire it, then re-add.
    register('other');
    await syncRegisteredModules(); // 'alpha' notIn ⇒ retired
    expect((await listModules()).find((m) => m.slug === 'alpha')?.isRegistered).toBe(false);

    register('alpha'); // reappears alongside 'other'
    register('other');
    await syncRegisteredModules();
    expect((await listModules()).find((m) => m.slug === 'alpha')?.isRegistered).toBe(true);
  });
});
