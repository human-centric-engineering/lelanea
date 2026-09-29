/**
 * Module agent-binding read queries (f-module-bindings t-1).
 *
 * `listModuleBindings` stitches each binding with the bound agent's display fields
 * via a batched follow-up query (no Prisma relation on `agentId`, X6). These tests
 * mock `@/lib/db/client` and assert the stitch, the ordering, the soft-deleted /
 * missing-agent resolution, and the unknown-module 404.
 *
 * @see lib/framework/modules/bindings/queries.ts
 */

import { describe, it, expect, beforeEach, vi } from 'vitest';

const db = vi.hoisted(() => ({
  module: { findFirst: vi.fn() },
  moduleAgentBinding: { findMany: vi.fn() },
  aiAgent: { findMany: vi.fn() },
}));
const registry = vi.hoisted(() => ({ getRegisteredModule: vi.fn() }));

vi.mock('@/lib/db/client', () => ({ prisma: db }));
vi.mock('@/lib/framework/modules/registry', () => registry);

import { listModuleBindings, getModuleAgentRoles } from '@/lib/framework/modules/bindings/queries';
import { NotFoundError } from '@/lib/api/errors';

function binding(over: Partial<Record<string, unknown>> = {}): Record<string, unknown> {
  return {
    id: 'b1',
    moduleId: 'm1',
    agentId: 'agent-1',
    role: 'companion',
    isPrimary: false,
    config: null,
    createdAt: new Date(0),
    updatedAt: new Date(0),
    ...over,
  };
}

beforeEach(() => vi.clearAllMocks());

describe('listModuleBindings', () => {
  it('404s for an unknown module (never an empty list)', async () => {
    db.module.findFirst.mockResolvedValue(null);
    await expect(listModuleBindings('ghost')).rejects.toBeInstanceOf(NotFoundError);
    expect(db.moduleAgentBinding.findMany).not.toHaveBeenCalled();
  });

  it('returns [] for a real module with no bindings — and does not query agents', async () => {
    db.module.findFirst.mockResolvedValue({ id: 'm1' });
    db.moduleAgentBinding.findMany.mockResolvedValue([]);
    const rows = await listModuleBindings('reading');
    expect(rows).toEqual([]);
    expect(db.aiAgent.findMany).not.toHaveBeenCalled();
  });

  it('stitches each binding with its agent display fields (batched, deduped)', async () => {
    db.module.findFirst.mockResolvedValue({ id: 'm1' });
    db.moduleAgentBinding.findMany.mockResolvedValue([
      binding({ id: 'b1', agentId: 'agent-1', isPrimary: true }),
      binding({ id: 'b2', agentId: 'agent-1', role: 'reviewer' }),
    ]);
    db.aiAgent.findMany.mockResolvedValue([
      {
        id: 'agent-1',
        name: 'Companion',
        slug: 'companion-agent',
        isActive: true,
        deletedAt: null,
      },
    ]);

    const rows = await listModuleBindings('reading');

    // One batched agent query for the deduped id set, selecting deletedAt too.
    expect(db.aiAgent.findMany).toHaveBeenCalledTimes(1);
    expect(db.aiAgent.findMany).toHaveBeenCalledWith(
      expect.objectContaining({
        where: { id: { in: ['agent-1'] } },
        select: expect.objectContaining({ deletedAt: true }),
      })
    );
    expect(rows).toHaveLength(2);
    expect(rows[0].agent).toMatchObject({ id: 'agent-1', name: 'Companion', isActive: true });
    expect(rows[1].agent).toMatchObject({ id: 'agent-1' });
  });

  it('distinguishes a tombstoned agent (deletedAt set) from a merely-deactivated one, and a missing agent (null)', async () => {
    const tombstonedAt = new Date(0);
    db.module.findFirst.mockResolvedValue({ id: 'm1' });
    db.moduleAgentBinding.findMany.mockResolvedValue([
      binding({ id: 'b1', agentId: 'tomb' }),
      binding({ id: 'b2', agentId: 'off' }),
      binding({ id: 'b3', agentId: 'gone' }),
    ]);
    db.aiAgent.findMany.mockResolvedValue([
      {
        id: 'tomb',
        name: 'Retired',
        slug: '-deleted-tomb',
        isActive: false,
        deletedAt: tombstonedAt,
      },
      { id: 'off', name: 'Paused', slug: 'paused', isActive: false, deletedAt: null },
    ]);

    const rows = await listModuleBindings('reading');
    // Tombstoned: deletedAt set → a consumer can filter it out.
    expect(rows.find((r) => r.id === 'b1')?.agent).toMatchObject({
      isActive: false,
      deletedAt: tombstonedAt,
    });
    // Merely deactivated: isActive false but deletedAt null → still a live binding.
    expect(rows.find((r) => r.id === 'b2')?.agent).toMatchObject({
      isActive: false,
      deletedAt: null,
    });
    // Gone entirely (hard-deleted → FK cascade normally removes it) → null.
    expect(rows.find((r) => r.id === 'b3')?.agent).toBeNull();
  });
});

describe('getModuleAgentRoles', () => {
  it('404s for an unknown module', async () => {
    db.module.findFirst.mockResolvedValue(null);
    await expect(getModuleAgentRoles('ghost')).rejects.toBeInstanceOf(NotFoundError);
    expect(registry.getRegisteredModule).not.toHaveBeenCalled();
  });

  it('returns the declared seats when the module is registered', async () => {
    db.module.findFirst.mockResolvedValue({ id: 'm1' });
    registry.getRegisteredModule.mockReturnValue({
      slug: 'reading',
      agentRoles: ['companion', 'coach'],
    });
    await expect(getModuleAgentRoles('reading')).resolves.toEqual({
      registered: true,
      roles: ['companion', 'coach'],
    });
  });

  it('returns registered:false with no seats when the code was removed (row still exists)', async () => {
    db.module.findFirst.mockResolvedValue({ id: 'm1' });
    registry.getRegisteredModule.mockReturnValue(undefined);
    await expect(getModuleAgentRoles('reading')).resolves.toEqual({ registered: false, roles: [] });
  });

  it('treats a registered module with no declared agentRoles as an empty seat list', async () => {
    db.module.findFirst.mockResolvedValue({ id: 'm1' });
    registry.getRegisteredModule.mockReturnValue({ slug: 'reading' });
    await expect(getModuleAgentRoles('reading')).resolves.toEqual({ registered: true, roles: [] });
  });
});
