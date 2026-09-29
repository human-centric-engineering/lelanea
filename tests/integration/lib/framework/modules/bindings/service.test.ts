/**
 * Module agent-binding service (f-module-bindings t-1).
 *
 * Exercises the real bind / update / unbind logic against a small STATEFUL
 * in-memory Prisma fake — `create`/`updateMany`/`update`/`delete` mutate a store
 * and the finders read it back, so the single-primary invariant and the
 * belongs-to-this-module guard are proven for real, not asserted call-by-call
 * (house style: no live DB in vitest). The HTTP contract is the routes test.
 *
 * The real `@prisma/client` is NOT mocked — the P2002 duplicate path must raise a
 * genuine `PrismaClientKnownRequestError`. The seat vocabulary comes from the real
 * in-memory module registry (`registerModule`), the true source of `agentRoles`.
 *
 * @see lib/framework/modules/bindings/service.ts
 */

import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { Prisma } from '@prisma/client';

// ─── Stateful in-memory Prisma fake ──────────────────────────────────────────
const { prismaFake, store, resetStore } = vi.hoisted(() => {
  const store = {
    modules: new Map<string, any>(),
    agents: new Map<string, any>(),
    bindings: new Map<string, any>(),
    seq: 0,
  };
  const id = (p: string) => `${p}${(store.seq += 1)}`;

  const moduleModel = {
    findFirst: async ({ where }: any) => {
      for (const m of store.modules.values()) if (m.slug === where.slug) return { ...m };
      return null;
    },
  };

  const aiAgent = {
    findFirst: async ({ where }: any) => {
      const row = store.agents.get(where.id);
      if (!row) return null;
      if (where.deletedAt === null && row.deletedAt !== null) return null;
      return { ...row };
    },
  };

  const moduleAgentBinding = {
    create: async ({ data }: any) => {
      for (const b of store.bindings.values()) {
        if (b.moduleId === data.moduleId && b.agentId === data.agentId && b.role === data.role) {
          throw new Prisma.PrismaClientKnownRequestError('Unique constraint', {
            code: 'P2002',
            clientVersion: 'test',
          });
        }
      }
      const row = {
        id: id('b'),
        moduleId: data.moduleId,
        agentId: data.agentId,
        role: data.role,
        isPrimary: data.isPrimary ?? false,
        config: data.config ?? null,
        createdAt: new Date(0),
        updatedAt: new Date(0),
      };
      store.bindings.set(row.id, row);
      return { ...row };
    },
    updateMany: async ({ where, data }: any) => {
      let count = 0;
      for (const b of store.bindings.values()) {
        if (where.moduleId && b.moduleId !== where.moduleId) continue;
        if (where.isPrimary !== undefined && b.isPrimary !== where.isPrimary) continue;
        if (where.id?.not && b.id === where.id.not) continue;
        if (data.isPrimary !== undefined) b.isPrimary = data.isPrimary;
        count += 1;
      }
      return { count };
    },
    findFirst: async ({ where }: any) => {
      const row = store.bindings.get(where.id);
      if (!row) return null;
      if (where.moduleId && row.moduleId !== where.moduleId) return null;
      return { ...row };
    },
    update: async ({ where, data }: any) => {
      const row = store.bindings.get(where.id);
      if (!row) throw new Error('not found');
      if (data.isPrimary !== undefined) row.isPrimary = data.isPrimary;
      if ('config' in data) row.config = data.config === Prisma.JsonNull ? null : data.config;
      return { ...row };
    },
    delete: async ({ where }: any) => {
      const row = store.bindings.get(where.id);
      if (!row) throw new Error('not found');
      store.bindings.delete(where.id);
      return { ...row };
    },
  };

  const prismaFake: any = {
    module: moduleModel,
    aiAgent,
    moduleAgentBinding,
    $transaction: async (fn: any) => fn(prismaFake),
  };

  return {
    prismaFake,
    store,
    resetStore: () => {
      store.modules.clear();
      store.agents.clear();
      store.bindings.clear();
      store.seq = 0;
    },
  };
});

vi.mock('@/lib/db/client', () => ({ prisma: prismaFake }));
vi.mock('@/lib/orchestration/audit/admin-audit-logger', () => ({ logAdminAction: vi.fn() }));
vi.mock('@/lib/orchestration/knowledge/resolveAgentDocumentAccess', () => ({
  invalidateAgentAccess: vi.fn(),
}));

import { bindAgent, updateBinding, unbindAgent } from '@/lib/framework/modules/bindings/service';
import { registerModule, __resetModuleRegistryForTests } from '@/lib/framework/modules/registry';
import { logAdminAction } from '@/lib/orchestration/audit/admin-audit-logger';
import { invalidateAgentAccess } from '@/lib/orchestration/knowledge/resolveAgentDocumentAccess';
import { NotFoundError, ValidationError } from '@/lib/api/errors';
import { z } from 'zod';

const USER = 'admin-1';

/** Register a module with seats and seed its `framework_module` row + an agent. */
function seedModule(slug: string, agentRoles: string[]): void {
  registerModule({
    slug,
    name: slug,
    description: `${slug} module`,
    configSchema: z.object({}),
    agentRoles,
  });
  store.modules.set(`m-${slug}`, { id: `m-${slug}`, slug, name: slug });
}
function seedAgent(id: string, opts: { deletedAt?: Date | null } = {}): void {
  store.agents.set(id, {
    id,
    name: id,
    slug: id,
    isActive: true,
    deletedAt: opts.deletedAt ?? null,
  });
}

beforeEach(() => {
  resetStore();
  __resetModuleRegistryForTests();
  vi.clearAllMocks();
});

describe('bindAgent', () => {
  it('binds an agent into a declared seat and audits it', async () => {
    seedModule('reading', ['companion']);
    seedAgent('agent-1');

    const binding = await bindAgent({
      moduleSlug: 'reading',
      agentId: 'agent-1',
      role: 'companion',
      userId: USER,
    });

    expect(binding).toMatchObject({ agentId: 'agent-1', role: 'companion', isPrimary: false });
    expect(store.bindings.size).toBe(1);
    // The agent now inherits the module's knowledge scope → its resolver cache is evicted.
    expect(invalidateAgentAccess).toHaveBeenCalledWith('agent-1');
    expect(logAdminAction).toHaveBeenCalledWith(
      expect.objectContaining({ action: 'module_agent_binding.create', entityId: binding.id })
    );
  });

  it('rejects a role that is not a declared seat (ValidationError, no write)', async () => {
    seedModule('reading', ['companion']);
    seedAgent('agent-1');
    await expect(
      bindAgent({ moduleSlug: 'reading', agentId: 'agent-1', role: 'reviewer', userId: USER })
    ).rejects.toBeInstanceOf(ValidationError);
    expect(store.bindings.size).toBe(0);
    expect(logAdminAction).not.toHaveBeenCalled();
  });

  it('rejects any bind when the module declares no seats', async () => {
    seedModule('reading', []);
    seedAgent('agent-1');
    await expect(
      bindAgent({ moduleSlug: 'reading', agentId: 'agent-1', role: 'companion', userId: USER })
    ).rejects.toBeInstanceOf(ValidationError);
  });

  it('404s when the module is not registered', async () => {
    // No registerModule call — even a stray DB row cannot be bound without a code seat.
    store.modules.set('m-ghost', { id: 'm-ghost', slug: 'ghost', name: 'ghost' });
    await expect(
      bindAgent({ moduleSlug: 'ghost', agentId: 'agent-1', role: 'companion', userId: USER })
    ).rejects.toBeInstanceOf(NotFoundError);
  });

  it('404s when the module is registered but has no synced row', async () => {
    registerModule({
      slug: 'reading',
      name: 'reading',
      description: 'x',
      configSchema: z.object({}),
      agentRoles: ['companion'],
    });
    seedAgent('agent-1');
    await expect(
      bindAgent({ moduleSlug: 'reading', agentId: 'agent-1', role: 'companion', userId: USER })
    ).rejects.toBeInstanceOf(NotFoundError);
  });

  it('rejects an unknown or soft-deleted agent (ValidationError)', async () => {
    seedModule('reading', ['companion']);
    await expect(
      bindAgent({ moduleSlug: 'reading', agentId: 'nobody', role: 'companion', userId: USER })
    ).rejects.toBeInstanceOf(ValidationError);

    seedAgent('gone', { deletedAt: new Date(0) });
    await expect(
      bindAgent({ moduleSlug: 'reading', agentId: 'gone', role: 'companion', userId: USER })
    ).rejects.toBeInstanceOf(ValidationError);
  });

  it('maps a duplicate (module, agent, role) to a ValidationError, not a raw P2002', async () => {
    seedModule('reading', ['companion']);
    seedAgent('agent-1');
    await bindAgent({ moduleSlug: 'reading', agentId: 'agent-1', role: 'companion', userId: USER });
    await expect(
      bindAgent({ moduleSlug: 'reading', agentId: 'agent-1', role: 'companion', userId: USER })
    ).rejects.toBeInstanceOf(ValidationError);
    expect(store.bindings.size).toBe(1);
  });

  it('demotes an existing primary when a new primary is bound (≤ 1 per module)', async () => {
    seedModule('reading', ['companion', 'reviewer']);
    seedAgent('agent-1');
    seedAgent('agent-2');

    const first = await bindAgent({
      moduleSlug: 'reading',
      agentId: 'agent-1',
      role: 'companion',
      isPrimary: true,
      userId: USER,
    });
    const second = await bindAgent({
      moduleSlug: 'reading',
      agentId: 'agent-2',
      role: 'reviewer',
      isPrimary: true,
      userId: USER,
    });

    const primaries = [...store.bindings.values()].filter((b) => b.isPrimary);
    expect(primaries).toHaveLength(1);
    expect(primaries[0].id).toBe(second.id);
    expect(store.bindings.get(first.id).isPrimary).toBe(false);
  });

  it('persists a per-binding config object', async () => {
    seedModule('reading', ['companion']);
    seedAgent('agent-1');
    const binding = await bindAgent({
      moduleSlug: 'reading',
      agentId: 'agent-1',
      role: 'companion',
      config: { tone: 'warm' },
      userId: USER,
    });
    expect(store.bindings.get(binding.id).config).toEqual({ tone: 'warm' });
  });
});

describe('updateBinding', () => {
  beforeEach(() => {
    seedModule('reading', ['companion', 'reviewer']);
    seedAgent('agent-1');
    seedAgent('agent-2');
  });

  it('updates config and promotes to primary, demoting the current primary', async () => {
    const a = await bindAgent({
      moduleSlug: 'reading',
      agentId: 'agent-1',
      role: 'companion',
      isPrimary: true,
      userId: USER,
    });
    const b = await bindAgent({
      moduleSlug: 'reading',
      agentId: 'agent-2',
      role: 'reviewer',
      userId: USER,
    });

    const updated = await updateBinding({
      moduleSlug: 'reading',
      bindingId: b.id,
      isPrimary: true,
      config: { note: 'lead now' },
      userId: USER,
    });

    expect(updated.isPrimary).toBe(true);
    expect(store.bindings.get(a.id).isPrimary).toBe(false);
    expect(store.bindings.get(b.id).config).toEqual({ note: 'lead now' });
    expect(logAdminAction).toHaveBeenCalledWith(
      expect.objectContaining({ action: 'module_agent_binding.update' })
    );
  });

  it('clears config when passed null', async () => {
    const b = await bindAgent({
      moduleSlug: 'reading',
      agentId: 'agent-1',
      role: 'companion',
      config: { tone: 'warm' },
      userId: USER,
    });
    await updateBinding({ moduleSlug: 'reading', bindingId: b.id, config: null, userId: USER });
    expect(store.bindings.get(b.id).config).toBeNull();
  });

  it('404s when the binding belongs to a different module', async () => {
    seedModule('writing', ['companion']);
    store.modules.set('m-writing', { id: 'm-writing', slug: 'writing', name: 'writing' });
    const b = await bindAgent({
      moduleSlug: 'reading',
      agentId: 'agent-1',
      role: 'companion',
      userId: USER,
    });
    await expect(
      updateBinding({ moduleSlug: 'writing', bindingId: b.id, isPrimary: true, userId: USER })
    ).rejects.toBeInstanceOf(NotFoundError);
  });
});

describe('write-error mapping (concurrency races)', () => {
  const p2002 = (target: string) =>
    new Prisma.PrismaClientKnownRequestError('unique', {
      code: 'P2002',
      clientVersion: 'test',
      meta: { target },
    });
  const p2025 = () =>
    new Prisma.PrismaClientKnownRequestError('not found', {
      code: 'P2025',
      clientVersion: 'test',
    });

  afterEach(() => vi.restoreAllMocks());

  it('bindAgent: a single-primary index violation → ValidationError (not a raw 500)', async () => {
    seedModule('reading', ['companion']);
    seedAgent('agent-1');
    vi.spyOn(prismaFake.moduleAgentBinding, 'create').mockRejectedValueOnce(
      p2002('framework_module_agent_single_primary')
    );
    await expect(
      bindAgent({
        moduleSlug: 'reading',
        agentId: 'agent-1',
        role: 'companion',
        isPrimary: true,
        userId: USER,
      })
    ).rejects.toBeInstanceOf(ValidationError);
  });

  it('updateBinding: a concurrent primary-promote (P2002 single_primary) → ValidationError', async () => {
    seedModule('reading', ['companion', 'reviewer']);
    seedAgent('agent-1');
    const b = await bindAgent({
      moduleSlug: 'reading',
      agentId: 'agent-1',
      role: 'companion',
      userId: USER,
    });
    vi.spyOn(prismaFake.moduleAgentBinding, 'update').mockRejectedValueOnce(
      p2002('framework_module_agent_single_primary')
    );
    await expect(
      updateBinding({ moduleSlug: 'reading', bindingId: b.id, isPrimary: true, userId: USER })
    ).rejects.toBeInstanceOf(ValidationError);
  });

  it('updateBinding: the binding vanishing mid-update (P2025) → NotFoundError, not 500', async () => {
    seedModule('reading', ['companion']);
    seedAgent('agent-1');
    const b = await bindAgent({
      moduleSlug: 'reading',
      agentId: 'agent-1',
      role: 'companion',
      userId: USER,
    });
    vi.spyOn(prismaFake.moduleAgentBinding, 'update').mockRejectedValueOnce(p2025());
    await expect(
      updateBinding({ moduleSlug: 'reading', bindingId: b.id, config: { x: 1 }, userId: USER })
    ).rejects.toBeInstanceOf(NotFoundError);
  });

  it('unbindAgent: the binding vanishing mid-delete (P2025) → NotFoundError, not 500', async () => {
    seedModule('reading', ['companion']);
    seedAgent('agent-1');
    const b = await bindAgent({
      moduleSlug: 'reading',
      agentId: 'agent-1',
      role: 'companion',
      userId: USER,
    });
    vi.spyOn(prismaFake.moduleAgentBinding, 'delete').mockRejectedValueOnce(p2025());
    await expect(
      unbindAgent({ moduleSlug: 'reading', bindingId: b.id, userId: USER })
    ).rejects.toBeInstanceOf(NotFoundError);
  });
});

describe('unbindAgent', () => {
  it('removes the binding and audits it', async () => {
    seedModule('reading', ['companion']);
    seedAgent('agent-1');
    const b = await bindAgent({
      moduleSlug: 'reading',
      agentId: 'agent-1',
      role: 'companion',
      userId: USER,
    });

    await unbindAgent({ moduleSlug: 'reading', bindingId: b.id, userId: USER });

    expect(store.bindings.size).toBe(0);
    // Unbinding revokes the module's knowledge scope → evict the agent's cache now
    // (fail-to-revoke guard), not after the resolver's 60s TTL.
    expect(invalidateAgentAccess).toHaveBeenCalledWith('agent-1');
    expect(logAdminAction).toHaveBeenCalledWith(
      expect.objectContaining({ action: 'module_agent_binding.delete', entityId: b.id })
    );
  });

  it('404s for a binding that is not in the named module', async () => {
    seedModule('reading', ['companion']);
    await expect(
      unbindAgent({ moduleSlug: 'reading', bindingId: 'nope', userId: USER })
    ).rejects.toBeInstanceOf(NotFoundError);
  });
});
